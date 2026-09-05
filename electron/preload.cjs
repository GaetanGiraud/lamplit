const { contextBridge, ipcRenderer } = require('electron');

/**
 * As close to nothing as the shell can get away with.
 *
 * The app is a web page and stays one: context isolation on, node integration
 * off, sandbox on — which is also why this file is CommonJS, since a sandboxed
 * preload cannot be a module. What is exposed is the short list of things a
 * page genuinely cannot do for itself:
 *
 * - `openDataFolder`, which the docs' **Your data** page names. Nothing in
 *   `app/` reads it: the same action is on the File menu. It is here so that
 *   when the app wants it, the answer is one line rather than a redesign.
 * - `checkForUpdates`, which the app *does* call, once, at start. The shell's
 *   updater is the half of the check that downloads and installs, and the
 *   switch that governs it is in the app's settings.json — which the shell
 *   deliberately cannot read. So the page reports the answer and the shell
 *   decides what to do with it.
 * - `useSystemProxy`, reported the same way and for the same reason. The window
 *   always starts direct, because resolving a system proxy can take twenty
 *   seconds before anything at all is on screen; this is how someone who needs
 *   that proxy to reach their model says so, once the app is up.
 */
contextBridge.exposeInMainWorld('lamplit', {
  openDataFolder: () => ipcRenderer.invoke('lamplit:open-data-folder'),
  /** @param {boolean} enabled Preferences → Advanced, as the app has it. */
  checkForUpdates: (enabled) => ipcRenderer.invoke('lamplit:check-for-updates', enabled),
  /** @param {boolean} enabled Preferences → Advanced, as the app has it. */
  useSystemProxy: (enabled) => ipcRenderer.invoke('lamplit:use-system-proxy', enabled),
});
