import { PARAM_RANGES } from './defaults';

export type ModelErrorKind =
  | 'auth'
  | 'credit'
  | 'rate-limit'
  | 'not-found'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'aborted'
  | 'unknown';

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** Turns an HTTP failure into something a reader can act on. */
export function errorFromResponse(status: number, body: string): ModelError {
  const detail = extractMessage(body);
  const suffix = detail ? ` — ${detail}` : '';
  switch (status) {
    case 400:
      return new ModelError(
        'bad-request',
        `The endpoint rejected the request${suffix}`,
        status,
        detail,
      );
    case 401:
    case 403:
      return new ModelError(
        'auth',
        `The API key was rejected (${status}). Check it in Connection${suffix}`,
        status,
        detail,
      );
    case 402:
      return new ModelError('credit', `Out of credit on this account${suffix}`, status, detail);
    case 404:
      return new ModelError(
        'not-found',
        `No chat-completions endpoint at this URL (404). Check the base URL${suffix}`,
        status,
        detail,
      );
    case 429:
      return new ModelError(
        'rate-limit',
        `Rate limited by the provider — try again in a moment${suffix}`,
        status,
        detail,
      );
    default:
      if (status >= 500) {
        return new ModelError(
          'server',
          `The provider had an error (${status})${suffix}`,
          status,
          detail,
        );
      }
      return new ModelError('unknown', `Request failed (${status})${suffix}`, status, detail);
  }
}

/**
 * What the endpoint said about its window, when it said anything.
 *
 * Both numbers are the endpoint's own and either may be missing: providers
 * word this refusal a dozen ways and only some of them count out loud.
 */
export interface ContextLimit {
  /** The model's real window, in tokens. */
  window?: number;
  /** What this request came to, by the endpoint's own reckoning. */
  requested?: number;
}

/** The wordings that mean "too long", across the providers the app talks to. */
const TOO_LONG = [
  'maximum context length',
  'context_length_exceeded',
  'context length',
  'context window',
  'too many tokens',
  'prompt is too long',
  'input is too long',
  'reduce the length',
  'max_new_tokens',
];

/** Where the window is named. First match wins, so the specific come first. */
const WINDOW = [
  /maximum context length is (\d+)/i,
  /maximum (?:input |prompt )?length is (\d+)/i,
  /context (?:length|window) (?:of |is )?(\d+)/i,
  /must be <=\s*(\d+)/i,
  /(\d+)\s*(?:tokens?\s*)?maximum/i,
];

const REQUESTED = [
  /you requested (\d+)/i,
  /(\d+) tokens?\s*>/i,
  /given:?\s*(\d+)/i,
  /(?:prompt|input|request) (?:is |was |of )?(\d+) tokens/i,
];

/**
 * Whether a refusal is the endpoint saying the turn was longer than the model
 * will take, and what it said about the size — as against a refusal about the
 * key, the model id, or the shape of the request, none of which a smaller
 * budget would help.
 *
 * Nothing here acts on the answer. What is spent on a model is the reader's
 * decision, so the app's part is to find out the number and say it; the press
 * that changes the setting, and the press that sends again, are theirs.
 */
export function contextLimitOf(error: ModelError): ContextLimit | null {
  if (error.kind !== 'bad-request') return null;
  const said = `${error.detail ?? ''} ${error.message}`.toLowerCase();
  if (!TOO_LONG.some((phrase) => said.includes(phrase))) return null;
  const detail = error.detail ?? error.message;
  return { window: firstNumber(detail, WINDOW), requested: firstNumber(detail, REQUESTED) };
}

/**
 * The refusal in the reader's terms: what the model takes, what this turn came
 * to, and what they have the budget set to. The endpoint's own sentence is
 * kept on the end, because it is the only part that is not our reading of it.
 */
export function describeContextLimit(limit: ContextLimit, budget: number, detail: string): string {
  const facts = [
    limit.window ? `this model takes ${limit.window} tokens` : '',
    limit.requested ? `the turn came to ${limit.requested}` : '',
    `your context budget is set to ${budget}`,
  ].filter(Boolean);
  const said = detail.trim() ? ` — ${detail.trim()}` : '';
  return `Too long for this model: ${facts.join(', ')}.${said}`;
}

/**
 * A context budget that fits inside a window of this size — the number the
 * button in the failed bubble offers, and nothing sets without being pressed.
 *
 * Five per cent under, because the endpoint counts with its own tokenizer and
 * the app counts with a heuristic (#30); rounded down to a round number,
 * because 7782 is not a figure anyone chose and it looks like one that was.
 */
export function budgetThatFits(window: number): number {
  const room = Math.floor((window * 0.95) / 256) * 256;
  const { min, max } = PARAM_RANGES.maxContextTokens;
  return Math.min(Math.max(room, min), max);
}

function firstNumber(text: string, patterns: readonly RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) {
      const value = Number(found[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
}

/** Anything thrown by `fetch` itself: offline, DNS, TLS, CORS. */
export function errorFromThrown(e: unknown): ModelError {
  if (e instanceof ModelError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new ModelError('aborted', 'Stopped');
  }
  return new ModelError(
    'network',
    'Could not reach the endpoint. Check the base URL, your connection, and that the endpoint allows browser requests (CORS).',
    undefined,
    e instanceof Error ? e.message : String(e),
  );
}

/** OpenAI-compatible errors nest the useful line in a few different places. */
function extractMessage(body: string): string {
  if (!body) return '';
  try {
    const parsed: unknown = JSON.parse(body);
    const found = findMessage(parsed);
    if (found) return truncate(found);
  } catch {
    /* not JSON, fall through to the raw body */
  }
  return truncate(body.trim());
}

function findMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'error_message']) {
    if (key in record) {
      const found = findMessage(record[key]);
      if (found) return found;
    }
  }
  return '';
}

function truncate(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
