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
