/**
 * The desktop shell, from the page's side of the glass.
 *
 * `electron/preload.cjs` puts exactly this on the window and nothing else, so
 * this file is that file's other half: the shape, and a way to ask for it that
 * answers `null` in a browser tab, where there is no shell at all.
 */
export interface DesktopShell {
  /** Opens `data/` in the file manager. The File menu does the same. */
  openDataFolder(): Promise<void>;
  /**
   * Tells the shell whether it may ask GitHub for a new version. The shell's
   * updater downloads and installs; the pill in the top bar only mentions.
   * Both answer to the same switch, and only the page can read it.
   */
  checkForUpdates(enabled: boolean): Promise<void>;
}

declare global {
  interface Window {
    lamplit?: DesktopShell;
  }
}

/** The shell when Lamplit is running in one, and `null` when it is a tab. */
export function desktop(): DesktopShell | null {
  return window.lamplit ?? null;
}
