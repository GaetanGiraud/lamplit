import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSseData } from './sse';
import { ModelClient, buildBody, normaliseBaseUrl, parseChunk } from './model-client';
import { errorFromResponse } from './model-errors';
import { formatTokens, heuristicEstimator } from './tokens';
import { renderMarkdown, renderStoryHtml } from './formatting';
import { GenerationParams } from './models';

/** A body split at awkward places, the way a real socket delivers it. */
function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of readSseData(stream)) out.push(payload);
  return out;
}

describe('readSseData', () => {
  it('yields one payload per event', async () => {
    expect(await collect(streamOf('data: a\n\ndata: b\n\n'))).toEqual(['a', 'b']);
  });

  it('reassembles events split across chunks', async () => {
    expect(await collect(streamOf('data: hel', 'lo\n', '\ndata: world\n\n'))).toEqual([
      'hello',
      'world',
    ]);
  });

  it('handles CRLF framing and ignores comments and other fields', async () => {
    const events = await collect(
      streamOf(': keep-alive\r\n\r\nevent: ping\r\ndata: x\r\n\r\nid: 7\r\n\r\n'),
    );
    expect(events).toEqual(['x']);
  });

  it('joins multi-line data and delivers a final unterminated event', async () => {
    expect(await collect(streamOf('data: one\ndata: two\n\ndata: [DONE]'))).toEqual([
      'one\ntwo',
      '[DONE]',
    ]);
  });
});

describe('streamChat', () => {
  const request = {
    baseUrl: 'https://endpoint.invalid/v1',
    apiKey: '',
    model: 'm',
    messages: [{ role: 'user' as const, content: 'Say something.' }],
    params: { maxResponseTokens: 100, stop: [] } as unknown as GenerationParams,
  };

  /** The endpoint answering with this body, and this content type. */
  function answers(body: ReadableStream<Uint8Array> | string, type = 'text/event-stream'): void {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': type } })),
    );
  }

  const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const said = (content: string) => event({ choices: [{ delta: { content } }] });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps what arrived when the provider errors half way through it', async () => {
    answers(
      streamOf(said('The lantern room, '), said('and then'), event({ error: { message: 'boom' } })),
    );
    const seen: string[] = [];

    const result = await new ModelClient().streamChat(request, (delta) => {
      if (delta.content) seen.push(delta.content);
    });

    // Resolved, not thrown: the reader watched these words arrive.
    expect(result.content).toBe('The lantern room, and then');
    expect(seen).toHaveLength(2);
    expect(result.interrupted?.message).toContain('boom');
    expect(result.aborted).toBe(false);
  });

  it('throws when it fails with nothing to show for it', async () => {
    answers(streamOf(event({ error: { message: 'boom' } })));
    await expect(new ModelClient().streamChat(request, () => {})).rejects.toThrow(/boom/);
  });

  it('says the connection dropped, rather than doubting a URL that was working', async () => {
    // Pulled rather than queued: `error()` throws away whatever is still in the
    // queue, and the point here is a connection that goes after the words came.
    let pulls = 0;
    answers(
      new ReadableStream({
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new TextEncoder().encode(said('Half a ')));
          else controller.error(new TypeError('network error'));
        },
      }),
    );

    const result = await new ModelClient().streamChat(request, () => {});

    expect(result.content).toBe('Half a ');
    expect(result.interrupted?.message).toBe('The connection dropped part-way through the reply.');
  });
});

describe('parseChunk', () => {
  it('reads content, finish reason and usage', () => {
    expect(
      parseChunk('{"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}'),
    ).toMatchObject({ content: 'Hi' });
    expect(parseChunk('{"choices":[{"delta":{},"finish_reason":"length"}]}')).toMatchObject({
      finishReason: 'length',
    });
    expect(
      parseChunk('{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}'),
    ).toMatchObject({ usage: { promptTokens: 10, completionTokens: 4 } });
  });

  it('reads reasoning under either of the two field names', () => {
    expect(parseChunk('{"choices":[{"delta":{"reasoning_content":"hm"}}]}')).toMatchObject({
      reasoning: 'hm',
    });
    expect(parseChunk('{"choices":[{"delta":{"reasoning":"hm"}}]}')).toMatchObject({
      reasoning: 'hm',
    });
  });

  it('surfaces a mid-stream error and shrugs off noise', () => {
    expect(parseChunk('{"error":{"message":"boom"}}')).toMatchObject({ error: 'boom' });
    expect(parseChunk('not json')).toBeNull();
    expect(parseChunk('"a string"')).toBeNull();
  });
});

describe('buildBody', () => {
  const base = {
    baseUrl: 'https://x/v1',
    apiKey: '',
    model: 'm',
    messages: [{ role: 'user' as const, content: 'hi' }],
  };
  const params: GenerationParams = {
    maxContextTokens: 8192,
    maxResponseTokens: 500,
    temperature: 0.8,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stop: [],
  };

  it('sends the OpenAI set and omits everything unset', () => {
    const body = buildBody({ ...base, params });
    expect(body).toMatchObject({
      model: 'm',
      stream: true,
      max_tokens: 500,
      temperature: 0.8,
      top_p: 1,
    });
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('seed');
    expect(body).not.toHaveProperty('stop');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('sends the advanced parameters once they are set', () => {
    const body = buildBody({
      ...base,
      params: {
        ...params,
        topK: 40,
        minP: 0.05,
        repetitionPenalty: 1.1,
        topA: 0.2,
        seed: 7,
        stop: ['THE END'],
        reasoningEffort: 'high',
      },
    });
    expect(body).toMatchObject({
      top_k: 40,
      min_p: 0.05,
      repetition_penalty: 1.1,
      top_a: 0.2,
      seed: 7,
      stop: ['THE END'],
      reasoning_effort: 'high',
    });
  });

  it('treats "none" reasoning as not set, and can drop stream_options', () => {
    expect(
      buildBody({ ...base, params: { ...params, reasoningEffort: 'none' } }),
    ).not.toHaveProperty('reasoning_effort');
    expect(buildBody({ ...base, params }, false)).not.toHaveProperty('stream_options');
  });
});

describe('normaliseBaseUrl', () => {
  it('tolerates trailing slashes and a pasted completions path', () => {
    expect(normaliseBaseUrl('  https://h/v1/  ')).toBe('https://h/v1');
    expect(normaliseBaseUrl('https://h/v1/chat/completions')).toBe('https://h/v1');
  });
});

describe('errorFromResponse', () => {
  it('classifies the statuses that matter and quotes the provider', () => {
    const auth = errorFromResponse(401, '{"error":{"message":"Incorrect API key"}}');
    expect(auth.kind).toBe('auth');
    expect(auth.message).toContain('Incorrect API key');

    expect(errorFromResponse(402, '').kind).toBe('credit');
    expect(errorFromResponse(404, '').kind).toBe('not-found');
    expect(errorFromResponse(429, '').kind).toBe('rate-limit');
    expect(errorFromResponse(503, '').kind).toBe('server');
  });
});

describe('token estimates', () => {
  it('counts per message plus its role overhead', () => {
    expect(heuristicEstimator.count('')).toBe(0);
    expect(heuristicEstimator.countMessages([{ role: 'user', content: '' }])).toBe(4);
    expect(heuristicEstimator.countMessages([{ role: 'user', content: 'a'.repeat(36) }])).toBe(14);
  });

  it('formats for the pill', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(3200)).toBe('3.2k');
    expect(formatTokens(16384)).toBe('16k');
  });

  it('rounds before it chooses the shape, so there is no 10.0k or 1000k', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(9999)).toBe('10k');
    expect(formatTokens(999_999)).toBe('1.0M');
    expect(formatTokens(2_000_000)).toBe('2.0M');
  });
});

describe('renderStoryHtml', () => {
  const plain = { bookStyleDialogue: false };
  const book = { bookStyleDialogue: true };

  it('marks speech and actions', () => {
    const html = renderStoryHtml('He nodded. "Come in," he said. *The door closed.*', plain);
    expect(html).toContain('<span class="speech">"Come in,"</span>');
    expect(html).toContain('class="action"');
  });

  it('recognises curly quotes', () => {
    expect(renderStoryHtml('“Who goes there?”', plain)).toContain('class="speech"');
  });

  it('gives each spoken line its own paragraph in book style', () => {
    const html = renderStoryHtml('He grinned. "Hello." "And you?"', book);
    expect(html.match(/<p>/g)).toHaveLength(3);
    expect(html).toMatch(/<p><span class="speech">"Hello."<\/span><\/p>/);
  });

  it('leaves the paragraph alone when it opens with speech', () => {
    expect(renderStoryHtml('"Just one line," she said.', book).match(/<p>/g)).toHaveLength(1);
  });

  it('does not leave a dangling <br> where it split a line break', () => {
    // A single newline becomes <br>; splitting there must not keep it.
    const html = renderStoryHtml('He nodded.\n"Come in," he said.', book);
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain('<p>He nodded.</p>');
    expect(html).not.toContain('<br>');
  });

  it('keeps line breaks inside a line it did not split', () => {
    expect(renderStoryHtml('One line.\nAnother line.', book)).toContain('<br>');
  });

  it('never reformats code, and strips anything not on the allowlist', () => {
    const html = renderStoryHtml('```\nconst a = "x";\n```', book);
    expect(html).not.toContain('class="speech"');
    const unsafe = renderStoryHtml('<img src=x onerror=alert(1)>text', plain);
    expect(unsafe).not.toContain('onerror');
    expect(unsafe).not.toContain('<img');
  });

  it('renders nothing for nothing', () => {
    expect(renderStoryHtml('', plain)).toBe('');
  });

  it('shows prose it cannot parse as prose, rather than throwing into the view', () => {
    // A thousand levels of nesting is a RangeError out of marked's recursion,
    // and this is read during change detection: a throw here is a blank page.
    const runaway = `${'> - '.repeat(2000)}the lantern room`;
    let html = '';
    expect(() => (html = renderStoryHtml(runaway, plain))).not.toThrow();
    expect(html).toContain('the lantern room');
    expect(renderMarkdown(runaway)).toContain('the lantern room');
  });
});

describe('renderMarkdown', () => {
  it('leaves a wrapped line as one paragraph, unlike story prose', () => {
    // Release notes come out of a changelog a formatter has hard-wrapped, so a
    // newline in the middle of a sentence is the formatter's, not the writer's.
    const wrapped = 'A line about what changed,\nwrapped the way a changelog wraps it.';
    expect(renderMarkdown(wrapped)).not.toContain('<br>');
    expect(renderStoryHtml(wrapped, { bookStyleDialogue: false })).toContain('<br>');
  });

  it('does none of the book-setting: no speech spans, no action classes', () => {
    const html = renderMarkdown('*Ready?* he said, and then "Now."');
    expect(html).not.toContain('class="speech"');
    expect(html).not.toContain('class="action"');
    expect(html).toContain('<em>Ready?</em>');
  });

  it('sanitises what it is given, the same as everything else does', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>**bold**');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders nothing for nothing', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
