/**
 * Whether a newer Lamplit has been published, asked once per run.
 *
 * The server asks rather than the browser, for two reasons. The browser talks
 * to exactly one host it was told about — the model endpoint — and it should
 * stay that way; and the desktop shell, which already updates itself through
 * electron-updater, gets the same answer from the same place rather than a
 * second opinion. The request carries nothing but what any HTTP request
 * carries: a URL, a user agent, and an IP.
 *
 * One request per run, memoised on the promise, so ten browser tabs cost one
 * call. Failure is not retried: it is one line in the log, an empty answer to
 * the app, and the next start tries again.
 */

const RELEASES_URL = 'https://api.github.com/repos/lamplit-app/lamplit/releases';
const TIMEOUT = 5000;
/** GitHub refuses a request without one, and this says who is asking. */
const USER_AGENT = 'lamplit-update-check';

/**
 * @typedef {object} ReleaseAsset
 * @property {string} name
 * @property {string} url
 * @property {number} size
 */

/**
 * @typedef {object} Release
 * @property {string} tag          `v0.2.0`, as published
 * @property {string} version      the tag without its `v`
 * @property {string} name         the release's title, or the tag
 * @property {string} publishedAt  ISO date
 * @property {string} body         the release notes, as markdown
 * @property {string} url          the release page
 * @property {ReleaseAsset[]} assets
 */

/**
 * @typedef {object} UpdateReport
 * @property {boolean} ok
 * @property {boolean} enabled   false when this run was told not to ask
 * @property {boolean} checked   true once an answer came back, good or bad
 * @property {string} version    the version doing the asking
 * @property {Release | null} latest
 * @property {Release[]} newer   newer than `version`, newest first
 * @property {Release[]} releases  every published release, newest first
 */

/**
 * @param {{
 *   version: string,
 *   enabled?: boolean,
 *   url?: string,
 *   fetchImpl?: typeof fetch,
 *   log?: (message: string) => void,
 * }} options
 */
export function createUpdateChecker({
  version,
  enabled = true,
  url = RELEASES_URL,
  fetchImpl = fetch,
  log = (message) => console.warn(`[lamplit] ${message}`),
} = {}) {
  /** @type {Promise<UpdateReport> | null} */
  let asked = null;

  const empty = (checked) => ({
    ok: true,
    enabled,
    checked,
    version,
    latest: null,
    newer: [],
    releases: [],
  });

  async function ask() {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': USER_AGENT,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!response.ok) {
        log(`update check: GitHub answered ${response.status}`);
        return empty(true);
      }
      const body = await response.json();
      const releases = published(body);
      return {
        ...empty(true),
        latest: releases[0] ?? null,
        newer: releases.filter((release) => isNewer(release.version, version)),
        releases,
      };
    } catch (error) {
      // Offline, blocked, slow, or rate-limited: all the same to the app.
      log(`update check: ${error.message}`);
      return empty(true);
    }
  }

  return {
    enabled,
    /** @returns {Promise<UpdateReport>} */
    check() {
      if (!enabled) return Promise.resolve(empty(false));
      asked ??= ask();
      return asked;
    },
  };
}

/** Drafts and pre-releases are not something to point anyone at. */
function published(body) {
  if (!Array.isArray(body)) return [];
  return body
    .filter((raw) => raw && !raw.draft && !raw.prerelease && raw.tag_name)
    .map(toRelease)
    .filter((release) => release.version)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function toRelease(raw) {
  const tag = String(raw.tag_name ?? '');
  return {
    tag,
    version: tag.replace(/^v/i, ''),
    name: String(raw.name || tag),
    publishedAt: String(raw.published_at ?? ''),
    body: String(raw.body ?? ''),
    url: String(raw.html_url ?? ''),
    assets: (Array.isArray(raw.assets) ? raw.assets : [])
      .filter((asset) => asset?.browser_download_url)
      .map((asset) => ({
        name: String(asset.name ?? ''),
        url: String(asset.browser_download_url),
        size: Number(asset.size ?? 0),
      })),
  };
}

/**
 * Numeric, segment by segment: 0.10.0 is newer than 0.9.9, and 0.1.0 is not.
 * A pre-release is filtered out of the list before this sees it, but the
 * *running* version can be one, and then `0.2.0-beta.1` has to read as a beta
 * of 0.2.0 — below the release, not a fourth segment above it.
 */
export function isNewer(candidate, than) {
  const left = parse(candidate);
  const right = parse(than);
  for (let i = 0; i < Math.max(left.numbers.length, right.numbers.length); i++) {
    const a = left.numbers[i] ?? 0;
    const b = right.numbers[i] ?? 0;
    if (a !== b) return a > b;
  }
  // The same numbers: the release outranks its own pre-release, and two
  // pre-releases are left alone rather than guessed at.
  return !left.pre && right.pre;
}

/** The dotted numbers at the front, and whether anything hyphenated follows. */
function parse(version) {
  const match = /^v?(\d+(?:\.\d+)*)(-\S+)?/.exec(String(version).trim());
  return {
    numbers: match ? match[1].split('.').map((part) => Number.parseInt(part, 10)) : [],
    pre: Boolean(match?.[2]),
  };
}

export { RELEASES_URL };
