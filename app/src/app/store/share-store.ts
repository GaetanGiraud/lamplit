import { Injectable, computed, signal } from '@angular/core';

/**
 * The switch in Preferences → Advanced, and the three requests behind it.
 *
 * Sharing is the server's, not the app's: it lives in `data/server.json`
 * rather than in `settings.json`, because `settings.json` is a document the
 * client owns end to end and the server is not allowed to understand. So this
 * store holds no settings of its own — it asks the server what it is doing and
 * tells it to do something else.
 *
 * `available` is false when the server has no sharing to report: an API-only
 * run, or a build older than this one. The dialog then shows nothing at all,
 * which is better than a switch that cannot be flipped.
 *
 * The pairing token is never here. It exists on the server and inside the QR
 * code the server draws, and nowhere in between — which is why "New code" is a
 * request rather than something this could work out for itself.
 */

export interface ShareState {
  share: boolean;
  port: number;
  /** Every non-internal IPv4 the machine has; a phone reaches one of them. */
  addresses: string[];
}

@Injectable({ providedIn: 'root' })
export class ShareStore {
  private readonly stateOf = signal<ShareState | null>(null);
  private readonly busyOf = signal(false);
  private readonly errorOf = signal('');
  /**
   * Counts the codes this session has asked for. It is in the QR's URL so that
   * rotating changes the address of the picture: the response says `no-store`,
   * but an `<img>` whose `src` has not changed is an `<img>` that never asks.
   */
  private readonly code = signal(0);

  readonly available = computed(() => this.stateOf() !== null);
  readonly on = computed(() => this.stateOf()?.share === true);
  readonly busy = this.busyOf.asReadonly();
  readonly error = this.errorOf.asReadonly();
  readonly addresses = computed(() => this.stateOf()?.addresses ?? []);
  readonly port = computed(() => this.stateOf()?.port ?? 0);

  /** Asked for when the dialog opens. Silence is "there is nothing to show". */
  async load(): Promise<void> {
    try {
      this.stateOf.set(await this.ask('GET'));
      this.errorOf.set('');
    } catch {
      this.stateOf.set(null);
    }
  }

  async set(on: boolean): Promise<void> {
    await this.change({ share: on });
  }

  /** A new code, which unpairs every phone that scanned the old one. */
  async newCode(): Promise<void> {
    await this.change({ rotate: true });
    this.code.update((count) => count + 1);
  }

  /** What to type on a phone that will not scan, and what the QR encodes minus its secret. */
  urlFor(address: string): string {
    return `http://${address}:${this.port()}/`;
  }

  qrUrl(address: string): string {
    return `/api/server/share/qr?address=${encodeURIComponent(address)}&c=${this.code()}`;
  }

  private async change(body: Record<string, unknown>): Promise<void> {
    this.busyOf.set(true);
    try {
      this.stateOf.set(await this.ask('PUT', body));
      this.errorOf.set('');
    } catch (error) {
      // Named rather than swallowed: the usual reason is a port that will not
      // open, and a switch that silently slid back would be a mystery.
      this.errorOf.set(error instanceof Error ? error.message : String(error));
      await this.load();
    } finally {
      this.busyOf.set(false);
    }
  }

  private async ask(method: 'GET' | 'PUT', body?: Record<string, unknown>): Promise<ShareState> {
    const response = await fetch('/api/server/share', {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const said: unknown = await response.json().catch(() => undefined);
      const detail =
        typeof said === 'object' &&
        said !== null &&
        'error' in said &&
        typeof said.error === 'string'
          ? said.error
          : `${response.status} ${response.statusText}`;
      throw new Error(detail);
    }
    return (await response.json()) as ShareState;
  }
}
