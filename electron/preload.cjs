const { contextBridge, ipcRenderer } = require('electron');

/**
 * As close to nothing as the shell can get away with.
 *
 * The app is a web page and stays one: context isolation on, node integration
 * off, sandbox on — which is also why this file is CommonJS, since a sandboxed
 * preload cannot be a module. The single thing exposed is the one action a page
 * genuinely cannot do for itself, and the docs' **Your data** page names it.
 *
 * Nothing in `app/` reads this today, and nothing has to: the same action is on
 * the File menu. It is here so that when the app wants it, the answer is one
 * line rather than a redesign.
 */
contextBridge.exposeInMainWorld('lamplit', {
  openDataFolder: () => ipcRenderer.invoke('lamplit:open-data-folder'),
});
