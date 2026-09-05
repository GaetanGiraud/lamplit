import { Injectable } from '@angular/core';
import { KEYS } from './documents';

/**
 * The wire side of persistence: where a storage key lives on the server, and
 * the four calls that move a document across. Nothing here knows what is in a
 * document — the server does not either.
 */

export type Collection = 'settings' | 'stories' | 'chapters';

export interface DocRef {
  collection: Collection;
  id: string;
}

const REQUEST_TIMEOUT = 10_000;

/** The header the server compares against the last write it applied. */
const SEQ_HEADER = 'x-doc-seq';

/**
 * The server's considered no, as opposed to its silence.
 *
 * A 4xx is a document this server will never take: a body it cannot parse, an
 * id it will not have, a document past the body limit, a Host it does not
 * answer to. Sending it again changes nothing, so whatever is holding it has
 * to stop and say so rather than retry for ever.
 *
 * `status` is the code, or 0 for a write the server took and then dropped for
 * being older than one it had already applied (`skipped`) — nothing is wrong
 * with the document, but it is not on disk.
 */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'Refused';
  }
}

/** Where a storage key lives on the server, or null if it lives nowhere. */
export function refOf(key: string): DocRef | null {
  if (key === KEYS.settings) return { collection: 'settings', id: KEYS.settings };
  if (key.startsWith(KEYS.storyPrefix)) {
    return { collection: 'stories', id: key.slice(KEYS.storyPrefix.length) };
  }
  if (key.startsWith(KEYS.chapterPrefix)) {
    return { collection: 'chapters', id: key.slice(KEYS.chapterPrefix.length) };
  }
  return null;
}

export function keyOf(ref: DocRef): string {
  if (ref.collection === 'settings') return KEYS.settings;
  return ref.collection === 'stories' ? KEYS.story(ref.id) : KEYS.chapter(ref.id);
}

/** Everything the server holds, in one shape, for the bootstrap read. */
export interface Snapshot {
  documents: Map<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class DocumentApi {
  /** Same origin: the packaged server serves the app, and `ng serve` proxies. */
  readonly base = '/api';

  /** Every document the server holds, keyed the way the client files them. */
  async snapshot(): Promise<Snapshot> {
    const collections: Collection[] = ['settings', 'stories', 'chapters'];
    const documents = new Map<string, unknown>();
    const lists = await Promise.all(collections.map((collection) => this.list(collection)));
    collections.forEach((collection, index) => {
      for (const document of lists[index] ?? []) {
        const id = collection === 'settings' ? KEYS.settings : idOf(document);
        if (id) documents.set(keyOf({ collection, id }), document);
      }
    });
    return { documents };
  }

  async list(collection: Collection): Promise<Record<string, unknown>[]> {
    const response = await this.request(`${this.base}/docs/${collection}`);
    return (await response.json()) as Record<string, unknown>[];
  }

  async put(ref: DocRef, document: unknown, seq: number): Promise<void> {
    const response = await this.request(this.urlOf(ref), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [SEQ_HEADER]: String(seq) },
      body: JSON.stringify(document),
    });
    await applied(response);
  }

  async remove(ref: DocRef, seq: number): Promise<void> {
    const response = await fetch(this.urlOf(ref), {
      method: 'DELETE',
      headers: { [SEQ_HEADER]: String(seq) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    // A document that is already gone is the outcome we wanted.
    if (response.status === 404) return;
    if (!response.ok) throw await failure(response);
    await applied(response);
  }

  /**
   * The last write of a session, sent from `beforeunload`. `keepalive` is what
   * lets it outlive the page; it is fire-and-forget by nature.
   */
  sendBeacon(ref: DocRef, body: string, seq: number): void {
    this.beacon(ref, seq, 'PUT', body);
  }

  /** The same, for a document the session deleted and then closed the tab on. */
  sendBeaconRemove(ref: DocRef, seq: number): void {
    this.beacon(ref, seq, 'DELETE');
  }

  private beacon(ref: DocRef, seq: number, method: 'PUT' | 'DELETE', body?: string): void {
    try {
      void fetch(this.urlOf(ref), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          [SEQ_HEADER]: String(seq),
        },
        ...(body === undefined ? {} : { body }),
        keepalive: true,
      }).catch(() => {
        /* the page is leaving; there is nobody left to tell */
      });
    } catch {
      /* nothing left to do at this point in the page's life */
    }
  }

  private urlOf(ref: DocRef): string {
    return `${this.base}/docs/${ref.collection}/${encodeURIComponent(ref.id)}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!response.ok) throw await failure(response);
    return response;
  }
}

function idOf(document: Record<string, unknown>): string {
  return typeof document['id'] === 'string' ? document['id'] : '';
}

async function failure(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => undefined);
  const detail =
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : '';
  const text = detail || `${response.status} ${response.statusText}`;
  // A 5xx is a server having a bad moment and worth asking again; a 4xx is an
  // answer about the document itself and will be the same answer next time.
  return response.status < 500 ? new Refused(text, response.status) : new Error(text);
}

/**
 * The server answers 200 to a write it decided not to apply, saying so with
 * `skipped`. It cannot happen between two writes of one tab — they are
 * serialised and their sequence numbers rise — but it can between two tabs,
 * and a write that never reached the disk must not be reported as saved.
 */
async function applied(response: Response): Promise<void> {
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body === 'object' && body !== null && 'skipped' in body && body.skipped === true) {
    throw new Refused('another window has saved a newer version', 0);
  }
}
