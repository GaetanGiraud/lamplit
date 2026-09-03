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
 * Storage keys the server holds. Step 1's `chat:` documents are deliberately
 * not among them: they are migrated on load and then gone.
 */
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
      for (const document of lists[index]) {
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
    await this.request(this.urlOf(ref), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [SEQ_HEADER]: String(seq) },
      body: JSON.stringify(document),
    });
  }

  async remove(ref: DocRef, seq: number): Promise<void> {
    const response = await fetch(this.urlOf(ref), {
      method: 'DELETE',
      headers: { [SEQ_HEADER]: String(seq) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    // A document that is already gone is the outcome we wanted.
    if (!response.ok && response.status !== 404) throw await failure(response);
  }

  /**
   * The last write of a session, sent from `beforeunload`. `keepalive` is what
   * lets it outlive the page; it is fire-and-forget by nature.
   */
  sendBeacon(ref: DocRef, document: unknown, seq: number): void {
    try {
      void fetch(this.urlOf(ref), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [SEQ_HEADER]: String(seq) },
        body: JSON.stringify(document),
        keepalive: true,
      }).catch(() => {});
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
  return typeof document?.['id'] === 'string' ? (document['id'] as string) : '';
}

async function failure(response: Response): Promise<Error> {
  const detail = await response
    .json()
    .then((body) => body?.error)
    .catch(() => '');
  return new Error(detail || `${response.status} ${response.statusText}`);
}
