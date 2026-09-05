/**
 * Where Lamplit lives, said once.
 *
 * These two addresses used to be copied into four files, so moving the project
 * meant finding all four. The app is one of three places that has to know them
 * — `server/src/updates.js` polls the releases API and `electron/main.mjs`
 * fills the Help menu — and those two run in their own processes and cannot
 * import from here. Three copies is the floor; five was not.
 */

/** The repository: releases, issues, the source. */
export const REPOSITORY = 'https://github.com/lamplit-app/lamplit';

/** The download page, which is the repository's GitHub Pages site. */
export const WEBSITE = 'https://lamplit-app.github.io/lamplit/';
