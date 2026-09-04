import { describe, expect, it } from 'vitest';
import { readSseData } from './sse';
import { buildBody, normaliseBaseUrl, parseChunk } from './model-client';
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
