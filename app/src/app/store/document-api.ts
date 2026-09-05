import { Injectable } from '@angular/core';
import { KEYS } from './documents';

/**
 * The wire side of persistence: where a storage key lives on the server, and
 * the calls that move a document across. Nothing here knows what is in a
 * document — the server does not either, beyond the `rev` it stamps on one.
 */

export type Collection = 'settings' | 'stories' | 'chapters';

export interface DocRef {
  collection: Collection;
  id: string;
}

const REQUEST_TIMEOUT = 10_000;

/** The revision a write says it was based on. See the server's DocumentStore. */
const REV_HEADER = 'x-doc-rev';

/** Every collection there is, in the order the bootstrap read asks for them. */
export const COLLECTIONS: Collection[] = ['settings', 'stories', 'chapters'];

/**
 * The server's considered no, as opposed to its silence.
 *
 * A 4xx is a document this server will never take: a body it cannot parse, an
 * id it will not have, a document past the body limit, a Host it does not
 * answer to. Sending it again changes nothing, so whatever is holding it has
 * to stop and say so rather than retry for ever.
 *
 * `status` is the code the server answered with.
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

/**
 * The document was written somewhere else between this session reading it and
 * writing it back — the phone, or a second tab.
 *
 * Carries the document as the server actually holds it, because the server
 * sends it with the refusal: reloading is therefore something the client can
 * simply do, rather than a second request that could itself be overtaken.
 * `document` is null when the answer is that there is no document any more,
 * which is what a stale write on top of a delete gets.
 */
export class Conflict extends Error {
  constructor(
    readonly rev: string,
    readonly document: unknown,
  ) {
    super('changed on another device');
    this.name = 'Conflict';
  }
}

/** One line of a collection's index: what is there, and whether it moved. */
export interface IndexEntry {
  id: string;
  updatedAt: string | null;
  rev: string;
}

/** The `rev` the server stamped a document with, or '' for one it has not. */
export function revIn(document: unknown): string {
  if (typeof document !== 'object' || document === null) return '';
  const rev = (document as Record<string, unknown>)['rev'];
  return typeof rev === 'string' ? rev : '';
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
    const documents = new Map<string, unknown>();
    const lists = await Promise.all(COLLECTIONS.map((collection) => this.list(collection)));
    COLLECTIONS.forEach((collection, index) => {
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

  /** What is there now and whether it has moved, without fetching any of it. */
  async index(collection: Collection): Promise<IndexEntry[]> {
    const response = await this.request(`${this.base}/docs/${collection}?index`);
    return (await response.json()) as IndexEntry[];
  }

  async get(ref: DocRef): Promise<unknown> {
    const response = await fetch(this.urlOf(ref), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    // Not an error: something else deleted it, and that is an answer.
    if (response.status === 404) return null;
    if (!response.ok) throw await failure(response);
    return await response.json();
  }

  /**
   * Writes the document, saying which revision it was based on, and answers
   * with the revision it now has. `''` is "there was nothing here", which is
   * both a fresh document and the honest thing to say when this session has
   * never seen one.
   */
  async put(ref: DocRef, document: unknown, basedOn: string): Promise<string> {
    const response = await fetch(this.urlOf(ref), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [REV_HEADER]: basedOn },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (response.status === 409) throw await conflict(response);
    if (!response.ok) throw await failure(response);
    return revIn(await response.json().catch(() => null));
  }

  /**
   * Unconditional, as it is on the server: deleting is a person saying so, and
   * a story takes chapters with it that nobody has looked at. See the comment
   * on `DocumentStore.remove`.
   */
  async remove(ref: DocRef): Promise<void> {
    const response = await fetch(this.urlOf(ref), {
      method: 'DELETE',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    // A document that is already gone is the outcome we wanted.
    if (response.status === 404) return;
    if (!response.ok) throw await failure(response);
  }

  /**
   * The last write of a session, sent from `beforeunload`. `keepalive` is what
   * lets it outlive the page; it is fire-and-forget by nature.
   */
  sendBeacon(ref: DocRef, body: string, basedOn: string): void {
    this.beacon(ref, 'PUT', basedOn, body);
  }

  /** The same, for a document the session deleted and then closed the tab on. */
  sendBeaconRemove(ref: DocRef): void {
    this.beacon(ref, 'DELETE');
  }

  private beacon(ref: DocRef, method: 'PUT' | 'DELETE', basedOn?: string, body?: string): void {
    try {
      void fetch(this.urlOf(ref), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(basedOn === undefined ? {} : { [REV_HEADER]: basedOn }),
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

/** A 409 and the document it came with, which is the whole of the recovery. */
async function conflict(response: Response): Promise<Conflict> {
  const body: unknown = await response.json().catch(() => undefined);
  const answer = (body ?? {}) as { rev?: unknown; document?: unknown };
  return new Conflict(typeof answer.rev === 'string' ? answer.rev : '', answer.document ?? null);
}
