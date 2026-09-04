/**
 * A deterministic stand-in for an OpenAI-compatible endpoint.
 *
 * The tests steer it from the message they send:
 *   "!prose"  one paragraph holding narration and two quoted lines, which is
 *             the only shape book style actually has work to do on
 *   "!slow"   stream one word every 120 ms, so Stop has something to cut into
 *   "!error"  answer 500 before streaming
 *   "!401"    answer 401
 *   "!long"   stream a long passage
 *   "!nolore" answer 500 to the lore request only, and stream as usual
 * Anything else gets a short canned scene with speech and an action in it,
 * suffixed with a counter so a regenerated answer is visibly different.
 *
 * A request that is not streamed is the lore extraction, and comes back as one
 * JSON object rather than as prose. The model id decides how well this endpoint
 * speaks JSON:
 *   fake/no-json-schema   refuses `response_format` with a 400, the way an
 *                         endpoint that has never heard of it does, and then
 *                         answers with the object inside a ```json fence
 * Anything else takes the schema and answers with a bare object. That id is
 * deliberately not in the list above: a spec that wants it names it in the
 * settings it seeds, and two specs count what `/models` returns.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_API_PORT ?? 4310);

const MODELS = [
  {
    id: 'fake/storyteller-large',
    owned_by: 'fake',
    created: 1,
    name: 'Storyteller Large',
  },
  { id: 'fake/storyteller-small', owned_by: 'fake', created: 2 },
  { id: 'other/echo-1', owned_by: 'other', created: 3 },
];

const SCENE = [
  'The knight lowered her lantern.',
  '"You are smaller than the songs promised," she said.',
  '*The dragon shifted, scales grinding on stone.*',
  '"And you are louder," it answered.',
];

const LONG = Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of the long passage.`);

/** Everything in one paragraph, the way plenty of real models answer. */
const PROSE = [
  'The knight lowered her lantern. "You are smaller than the songs promised," she said.',
  '*The dragon shifted.* "And you are louder," it answered.',
].join(' ');

let turn = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  // Browser calls carry Authorization and Content-Type, so preflight matters.
  cors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === '/v1/models' && request.method === 'GET') {
    json(response, 200, { object: 'list', data: MODELS });
    return;
  }

  if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
    const body = await readJson(request);
    const prompt = lastUserMessage(body);

    if (prompt.includes('!401') || request.headers.authorization === 'Bearer bad-key') {
      json(response, 401, {
        error: {
          message: 'Incorrect API key provided.',
          code: 'invalid_api_key',
        },
      });
      return;
    }
    if (prompt.includes('!error')) {
      json(response, 500, {
        error: { message: 'The upstream model is on fire.' },
      });
      return;
    }

    // Not streamed: the only request in the app shaped like that is the one
    // asking what a chapter established, and it wants JSON back.
    if (body?.stream === false) {
      lore(response, body, prompt);
      return;
    }

    await stream(response, body, prompt);
    return;
  }

  json(response, 404, {
    error: { message: `No route for ${request.method} ${url.pathname}` },
  });
});

async function stream(response, body, prompt) {
  const model = body?.model ?? 'fake/storyteller-large';
  const slow = prompt.includes('!slow');
  const words = pick(prompt).split(/(?<=\s)/);

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let promptTokens = 0;
  for (const message of body?.messages ?? []) promptTokens += Math.ceil(message.content.length / 4);

  for (const word of words) {
    if (response.writableEnded || response.destroyed) return;
    send(response, {
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { content: word }, finish_reason: null }],
    });
    if (slow) await delay(120);
  }

  send(response, {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  });
  if (body?.stream_options?.include_usage) {
    send(response, {
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      model,
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: words.length,
        total_tokens: promptTokens + words.length,
      },
    });
  }
  response.write('data: [DONE]\n\n');
  response.end();
}

/**
 * The lore extraction: one JSON object, and a chance to be an endpoint that
 * cannot do schemas.
 *
 * What it proposes is read out of the chapter it was sent, so a test plants a
 * town in the story and gets that town back rather than a fixture nobody can
 * trace: `Ashport` becomes a place, and an entry the world already holds comes
 * back as an update to it.
 */
function lore(response, body, prompt) {
  const model = body?.model ?? 'fake/storyteller-large';
  // Only this request fails, so a spec can watch a chapter close with the
  // summary written and the entries not.
  if (prompt.includes('!nolore')) {
    json(response, 500, { error: { message: 'The upstream model is on fire.' } });
    return;
  }
  if (model === 'fake/no-json-schema' && body?.response_format) {
    json(response, 400, {
      error: { message: "Unknown parameter: 'response_format'.", type: 'invalid_request_error' },
    });
    return;
  }

  const entries = [];
  if (prompt.includes('Ashport')) {
    entries.push({
      title: 'Ashport',
      category: 'place',
      keys: ['ashport', 'the town'],
      content: 'A town of nine hundred at the mouth of the estuary, an hour up the coast road.',
      updates: '',
    });
  }
  // Named in the list of what the world already holds, so it is an update.
  if (prompt.includes('Old Tomas')) {
    entries.push({
      title: 'Old Tomas',
      category: 'person',
      keys: ['tomas', 'keeper'],
      content: 'Kept the light before Mara’s father, and was last seen boarding the Ashport ferry.',
      updates: 'Old Tomas',
    });
  }

  const object = JSON.stringify({ entries });
  const content = model === 'fake/no-json-schema' ? '```json\n' + object + '\n```' : object;

  let promptTokens = 0;
  for (const message of body?.messages ?? []) promptTokens += Math.ceil(message.content.length / 4);

  json(response, 200, {
    id: 'chatcmpl-fake-lore',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: Math.ceil(content.length / 4),
      total_tokens: promptTokens + Math.ceil(content.length / 4),
    },
  });
}

/** The passage this turn answers with, before it is cut into deltas. */
function pick(prompt) {
  if (prompt.includes('!long')) return LONG.join('\n\n');
  if (prompt.includes('!prose')) return PROSE;
  return [...SCENE, `(take ${++turn})`].join('\n\n');
}

function send(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function lastUserMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return String(messages[i].content ?? '');
  }
  return '';
}

function readJson(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
}

function cors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.listen(PORT, () => console.log(`fake OpenAI endpoint on http://localhost:${PORT}/v1`));
