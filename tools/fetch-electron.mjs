import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Downloads Electron's binary, because installing the package does not.
 *
 * Electron 44 publishes no `scripts` at all — no postinstall, nothing. `npm ci`
 * therefore gives you `node_modules/electron` full of JavaScript and no
 * executable, and nothing says so. It went unnoticed here for a day because the
 * two things that want Electron want it differently:
 *
 * - electron-builder downloads its own copy through @electron/get, so
 *   `npm run desktop:dist` works on a machine that has never had the binary.
 * - Playwright's `_electron.launch()` runs the one in node_modules, so the
 *   desktop spec — and `npm run desktop` — have nothing to open without it.
 *
 * Which is why the first release workflow got as far as the end-to-end tests on
 * both runners and stopped there. Wired to `postinstall` in the root
 * package.json, so `npm ci` is once again all anyone has to run.
 *
 * `install.js` checks for the binary first and exits at once when it is there,
 * so this costs nothing on every install after the first.
 */

const require = createRequire(import.meta.url);

try {
  execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });
} catch (error) {
  // Never fail an install over it: the app, the server and the whole browser
  // build are usable without a desktop binary. Whatever needs it says so
  // loudly — the desktop spec throws rather than skipping when CI is set.
  console.warn(`\nCould not fetch Electron's binary: ${error.message}`);
  console.warn('The desktop build and its spec will not run until `npm run electron` succeeds.\n');
}
