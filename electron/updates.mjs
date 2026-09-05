/**
 * Whether this start may ask GitHub, and nothing else.
 *
 * Everything the answer is made of needs a packaged build to see at all — an
 * installed app, a stick, an environment, a preference in someone's profile —
 * so the answer itself is a function of four plain values with nothing
 * imported above it, which a test can simply ask.
 *
 * The shell's own updater is the half of the update check that downloads about
 * a hundred megabytes and changes the version on disk, so "not now" has to
 * reach it too, by whichever of the four says so.
 *
 * @param {object} conditions
 * @param {boolean} conditions.isPackaged an installed build, rather than the repository.
 * @param {boolean} conditions.portable the one .exe on a stick.
 * @param {Record<string, string | undefined>} [conditions.env] the process environment.
 * @param {boolean} [conditions.setting] Preferences → Advanced, as the app reports it.
 */
export function shouldCheck({ isPackaged, portable, env = {}, setting }) {
  // A copy running from the repository upgrades with `git pull`, and there is
  // no installer for electron-updater to find in the first place.
  if (!isPackaged) return false;

  // The portable build installs nothing and is not installed: it is one .exe
  // on a stick, beside the stories. electron-updater does not know that and
  // would download the installer and run it on quit, leaving an installed
  // Lamplit with an empty profile while the stick stayed as it was. The pill
  // from /api/updates still tells a portable reader there is a new version.
  if (portable) return false;

  // The same switch the server's own checker reads, so one line in the
  // environment answers for both halves of the same question.
  if (env['LAMPLIT_UPDATE_CHECK'] === '0') return false;

  // Preferences → Advanced. Off means the request does not happen, rather than
  // happening and being ignored, which is what the app promises in as many
  // words. Unsaid is the app's own default, which is on.
  return setting !== false;
}
