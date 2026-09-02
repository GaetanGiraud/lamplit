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
 * Anything else gets a short canned scene with speech and an action in it,
 * suffixed with a counter so a regenerated answer is visibly different.
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
