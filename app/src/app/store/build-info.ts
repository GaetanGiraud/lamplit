import { Injectable, computed, signal } from '@angular/core';

/**
 * Which build is answering, straight from `/api/health`.
 *
 * The server is the only one that can know: the version, the commit and the CI
 * run come from the stamp written next to the built app, and `previousVersion`
 * comes from the data folder — which is the only thing that survives an
 * upgrade and can therefore say one happened.
 *
 * Read once at start-up and never again. Nothing waits for it: the app is
 * perfectly usable without knowing its own build number, so a slow or missing
 * answer costs a line in the About sheet and nothing else.
 */

export interface BuildInfo {
  version: string;
  /** Short SHA, `+` when it was built from a dirty tree. Empty if unknown. */
  commit: string;
  /** ISO date, empty for a build nothing stamped. */
  builtAt: string;
  /** The CI run number, or `local`. */
  build: string;
  channel: 'desktop' | 'zip' | 'dev' | (string & {});
  /** The version whose data folder this is, when it is not this one. */
  previousVersion: string | null;
}

const REQUEST_TIMEOUT = 5000;

@Injectable({ providedIn: 'root' })
export class BuildInfoStore {
  private readonly state = signal<BuildInfo | null>(null);

  readonly info = this.state.asReadonly();
  readonly version = computed(() => this.state()?.version ?? '');

  /** `build 42 · a1b2c3d · 2026-09-03`, with whatever of it is known. */
  readonly buildLine = computed(() => {
    const info = this.state();
    if (!info) return '';
    return [
      info.build === 'local' ? 'built by hand' : `build ${info.build}`,
      info.commit,
      info.builtAt.slice(0, 10),
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /**
   * True when this run is the first the writer sees of a newer version. A
   * downgrade says nothing: "what's new" would be a page about a version they
   * just left.
   */
  readonly upgradedFrom = computed(() => {
    const info = this.state();
    if (!info?.previousVersion) return null;
    return isNewer(info.version, info.previousVersion) ? info.previousVersion : null;
  });

  async load(): Promise<void> {
    try {
      const response = await fetch('/api/health', {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (!response.ok) return;
      const body = (await response.json()) as Partial<BuildInfo> & { name?: string };
      if (body.name !== 'lamplit') return;
      this.state.set({
        version: body.version ?? '0.0.0',
        commit: body.commit ?? '',
        builtAt: body.builtAt ?? '',
        build: body.build ?? 'local',
        channel: body.channel ?? 'dev',
        previousVersion: body.previousVersion ?? null,
      });
    } catch {
      /* The About sheet says "unknown"; nothing else depends on this. */
    }
  }
}

/** Numeric, segment by segment: 0.10.0 is newer than 0.9.9, and 0.1.0 is not. */
export function isNewer(candidate: string, than: string): boolean {
  const left = segments(candidate);
  const right = segments(than);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

function segments(version: string): number[] {
  return version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
