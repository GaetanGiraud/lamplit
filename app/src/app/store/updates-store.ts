import { Injectable, computed, signal } from '@angular/core';

/**
 * Whether a newer Lamplit has been published, as the server found out.
 *
 * The browser does not ask GitHub: it asks the server, which asked GitHub once
 * when it started. That keeps the one outbound host this app talks to — the
 * model endpoint — the only one it talks to, and it means the desktop shell,
 * the zip and a dev server all read the same answer.
 *
 * Nothing waits for this. A missing or slow answer costs a pill in the top bar
 * and nothing else, so it is never on the path to writing anything.
 */

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface Release {
  /** `v0.2.0`, as published. */
  tag: string;
  /** The tag without its `v`, which is what the app compares and shows. */
  version: string;
  name: string;
  publishedAt: string;
  /** The release notes, as markdown. */
  body: string;
  url: string;
  assets: ReleaseAsset[];
}

export interface UpdateReport {
  enabled: boolean;
  checked: boolean;
  version: string;
  latest: Release | null;
  newer: Release[];
  releases: Release[];
}

const REQUEST_TIMEOUT = 8000;

const EMPTY: UpdateReport = {
  enabled: false,
  checked: false,
  version: '',
  latest: null,
  newer: [],
  releases: [],
};

@Injectable({ providedIn: 'root' })
export class UpdatesStore {
  private readonly state = signal<UpdateReport | null>(null);
  private readonly askingState = signal(false);
  private asked: Promise<void> | null = null;

  readonly report = this.state.asReadonly();
  /** True while the first answer is on its way; the sheet says so. */
  readonly asking = this.askingState.asReadonly();

  readonly releases = computed(() => this.state()?.releases ?? []);
  readonly newer = computed(() => this.state()?.newer ?? []);

  /** The one the pill names: the newest release above what is running. */
  readonly available = computed<Release | null>(() => this.newer()[0] ?? null);

  /** Answered, and with nothing in it — offline, switched off, or unpublished. */
  readonly nothingKnown = computed(() => !!this.state() && !this.releases().length);

  /**
   * One request per session, whoever asks first. Start-up asks only when the
   * reader has left the check on; the What's new sheet asks whenever it has
   * nothing to show, because opening it *is* the reader asking.
   */
  load(): Promise<void> {
    this.asked ??= this.ask();
    return this.asked;
  }

  private async ask(): Promise<void> {
    this.askingState.set(true);
    try {
      const response = await fetch('/api/updates', {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const body = response.ok ? ((await response.json()) as Partial<UpdateReport>) : {};
      this.state.set({
        enabled: body.enabled ?? false,
        checked: body.checked ?? false,
        version: body.version ?? '',
        latest: body.latest ?? null,
        newer: Array.isArray(body.newer) ? body.newer : [],
        releases: Array.isArray(body.releases) ? body.releases : [],
      });
    } catch {
      // An answer of "nothing" rather than no answer at all: the sheet has to
      // be able to tell "still asking" from "asked, and there is nothing".
      this.state.set(EMPTY);
    } finally {
      this.askingState.set(false);
    }
  }
}
