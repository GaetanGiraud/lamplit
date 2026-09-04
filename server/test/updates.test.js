import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createUpdateChecker, isNewer } from '../src/updates.js';

/**
 * What GitHub answers, trimmed to the fields the checker reads. The date is
 * derived from the tag so that a list of them sorts the way a real one would.
 */
function release(tag, patch = {}) {
  const [, minor = '1', point = '0'] = tag.replace(/^v/, '').split('.');
  return {
    tag_name: tag,
    name: `Lamplit ${tag}`,
    published_at: `2026-0${minor}-0${Number(point) + 1}T00:00:00Z`,
    body: `What changed in ${tag}.`,
    html_url: `https://github.com/GaetanGiraud/lamplit/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'Lamplit.zip',
        browser_download_url: `https://example.invalid/${tag}/Lamplit.zip`,
        size: 1024,
      },
    ],
    ...patch,
  };
}

/** A `fetch` that answers with a body and counts how often it was called. */
function fakeGithub(body, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

const quiet = () => {};

describe('isNewer', () => {
  it('compares segment by segment, numerically', () => {
    assert.equal(isNewer('0.2.0', '0.1.0'), true);
    assert.equal(isNewer('0.10.0', '0.9.9'), true);
    assert.equal(isNewer('0.1.0', '0.1.0'), false);
    assert.equal(isNewer('0.1.0', '0.2.0'), false);
    assert.equal(isNewer('1.0.0', '0.99.99'), true);
  });
});

describe('the update check', () => {
  it('reports what is newer than the running version, newest first', async () => {
    const { calls, fetchImpl } = fakeGithub([
      release('v0.1.0'),
      release('v0.2.0'),
      release('v0.3.0'),
    ]);
    const checker = createUpdateChecker({ version: '0.1.0', fetchImpl, log: quiet });

    const report = await checker.check();

    assert.equal(calls.length, 1);
    assert.equal(report.enabled, true);
    assert.equal(report.checked, true);
    assert.deepEqual(
      report.newer.map((r) => r.version),
      ['0.3.0', '0.2.0'],
    );
    assert.equal(report.latest.version, '0.3.0');
    assert.equal(report.releases.length, 3);
    // Everything the sheet draws a release with.
    assert.equal(report.newer[0].name, 'Lamplit v0.3.0');
    assert.equal(report.newer[0].body, 'What changed in v0.3.0.');
    assert.ok(report.newer[0].publishedAt);
    assert.deepEqual(report.newer[0].assets, [
      {
        name: 'Lamplit.zip',
        url: 'https://example.invalid/v0.3.0/Lamplit.zip',
        size: 1024,
      },
    ]);
  });

  it('says nothing is newer when the running version is the latest', async () => {
    const { fetchImpl } = fakeGithub([release('v0.1.0'), release('v0.2.0')]);
    const checker = createUpdateChecker({ version: '0.2.0', fetchImpl, log: quiet });

    const report = await checker.check();

    assert.deepEqual(report.newer, []);
    assert.equal(report.latest.version, '0.2.0');
    // The whole list is still there: the notes are readable without an update.
    assert.equal(report.releases.length, 2);
  });

  it('leaves out drafts and pre-releases', async () => {
    const { fetchImpl } = fakeGithub([
      release('v0.2.0', { draft: true }),
      release('v0.3.0', { prerelease: true }),
      release('v0.1.5'),
    ]);
    const checker = createUpdateChecker({ version: '0.1.0', fetchImpl, log: quiet });

    const report = await checker.check();

    assert.deepEqual(
      report.releases.map((r) => r.version),
      ['0.1.5'],
    );
  });

  it('asks once per run, however many times it is called', async () => {
    const { calls, fetchImpl } = fakeGithub([release('v0.2.0')]);
    const checker = createUpdateChecker({ version: '0.1.0', fetchImpl, log: quiet });

    const [first, second, third] = await Promise.all([
      checker.check(),
      checker.check(),
      checker.check(),
    ]);

    assert.equal(calls.length, 1);
    assert.equal(first, second);
    assert.equal(second, third);
  });

  /** The acceptance case: off means the request is not made at all. */
  it('does not ask GitHub at all when the check is switched off', async () => {
    const { calls, fetchImpl } = fakeGithub([release('v0.2.0')]);
    const checker = createUpdateChecker({
      version: '0.1.0',
      enabled: false,
      fetchImpl,
      log: quiet,
    });

    const report = await checker.check();

    assert.equal(calls.length, 0);
    assert.equal(report.enabled, false);
    assert.equal(report.checked, false);
    assert.deepEqual(report.newer, []);
    assert.equal(report.latest, null);
  });

  it('does not ask until it is asked', async () => {
    const { calls, fetchImpl } = fakeGithub([release('v0.2.0')]);
    createUpdateChecker({ version: '0.1.0', fetchImpl, log: quiet });

    assert.equal(calls.length, 0);
  });

  it('is quiet and empty when GitHub cannot be reached', async () => {
    const said = [];
    const checker = createUpdateChecker({
      version: '0.1.0',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      log: (message) => said.push(message),
    });

    const report = await checker.check();

    assert.equal(report.ok, true);
    assert.equal(report.checked, true);
    assert.deepEqual(report.newer, []);
    assert.deepEqual(report.releases, []);
    // One line, and no retry loop behind it.
    assert.equal(said.length, 1);
    assert.match(said[0], /fetch failed/);
  });

  it('is quiet and empty when GitHub refuses', async () => {
    const said = [];
    const { fetchImpl } = fakeGithub({ message: 'rate limited' }, { status: 403 });
    const checker = createUpdateChecker({
      version: '0.1.0',
      fetchImpl,
      log: (message) => said.push(message),
    });

    const report = await checker.check();

    assert.deepEqual(report.newer, []);
    assert.match(said[0], /403/);
  });

  it('survives an answer that is not the shape it expected', async () => {
    const { fetchImpl } = fakeGithub({ message: 'Not Found' });
    const checker = createUpdateChecker({ version: '0.1.0', fetchImpl, log: quiet });

    const report = await checker.check();

    assert.deepEqual(report.releases, []);
    assert.equal(report.latest, null);
  });
});
