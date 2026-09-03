import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { BuildInfoStore } from '../store/build-info';

/** Where the release notes and the issues are. Also in the desktop Help menu. */
const REPOSITORY = 'https://github.com/GaetanGiraud/lamplit';

/**
 * One sheet, and no settings on it: what this is, which build of it is running,
 * and the two places to go next. The build line is what makes a bug report
 * answerable — "0.1.0" stops being enough the moment two builds have carried
 * that number.
 */
@Component({
  selector: 'ms-about-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">Lamplit</h2>
    <mat-dialog-content>
      <p class="version">{{ version() }}</p>
      <p class="build">{{ build() }}</p>
      <p class="blurb">
        A writing app for stories told a chapter at a time, with a language model of your choosing.
        It runs on this machine; your stories are files you can read, copy and back up.
      </p>
      <p class="links">
        <a [href]="notes()" target="_blank" rel="noreferrer noopener">Release notes</a>
        <span aria-hidden="true">·</span>
        <a [href]="issues" target="_blank" rel="noreferrer noopener">Report a problem</a>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close cdkFocusInitial>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-width: 26rem;
    }

    p {
      margin: 0;
    }

    .version {
      font-family: var(--ms-serif);
      font-size: 1.35rem;
      color: var(--ms-ink);
    }

    .build {
      margin-top: 0.15rem;
      font-size: 0.82rem;
      color: var(--ms-muted);
      /* A SHA and a run number are read character by character. */
      font-variant-numeric: tabular-nums;
    }

    .blurb {
      margin-top: 1.1rem;
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--ms-ink-soft);
    }

    .links {
      display: flex;
      gap: 0.5rem;
      margin-top: 1.1rem;
      font-size: 0.9rem;
    }

    .links span {
      color: var(--ms-muted);
    }
  `,
})
export class AboutDialog {
  private readonly builds = inject(BuildInfoStore);

  protected readonly issues = `${REPOSITORY}/issues`;

  protected readonly version = computed(() => {
    const info = this.builds.info();
    if (!info) return 'Version unknown';
    return `Version ${info.version}`;
  });

  protected readonly build = computed(() => {
    const info = this.builds.info();
    if (!info) return 'The server did not say which build this is.';
    const line = this.builds.buildLine();
    return info.channel === 'dev' ? `${line} · from the repository` : `${line} · ${info.channel}`;
  });

  /**
   * The release for *this* version, which is where its notes are. A build that
   * was never published has no tag, so that one goes to the list.
   */
  protected readonly notes = computed(() => {
    const info = this.builds.info();
    if (!info || info.build === 'local') return `${REPOSITORY}/releases`;
    return `${REPOSITORY}/releases/tag/v${info.version}`;
  });
}
