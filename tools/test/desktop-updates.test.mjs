import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldCheck } from '../../electron/updates.mjs';

/** An installed build with nothing else in the way: the case that may check. */
const INSTALLED = { isPackaged: true, portable: false, env: {}, setting: true };

describe('whether the desktop shell may ask GitHub', () => {
  it('may, when it is installed and the reader left the switch on', () => {
    assert.equal(shouldCheck(INSTALLED), true);
  });

  it('does not when the reader switched it off', () => {
    // The whole point: off means the request does not happen, so nothing is
    // downloaded and nothing is staged to install on quit.
    assert.equal(shouldCheck({ ...INSTALLED, setting: false }), false);
  });

  it('treats an unsaid setting as the default the app ships with, which is on', () => {
    assert.equal(shouldCheck({ isPackaged: true, portable: false }), true);
  });

  it('does not from the repository, which upgrades with git pull', () => {
    assert.equal(shouldCheck({ ...INSTALLED, isPackaged: false }), false);
  });

  it('does not from the portable build, which installs nothing', () => {
    assert.equal(shouldCheck({ ...INSTALLED, portable: true }), false);
  });

  it('honours LAMPLIT_UPDATE_CHECK=0, the same as the server does', () => {
    assert.equal(shouldCheck({ ...INSTALLED, env: { LAMPLIT_UPDATE_CHECK: '0' } }), false);
    // Only the one value silences it; anything else is not an answer.
    assert.equal(shouldCheck({ ...INSTALLED, env: { LAMPLIT_UPDATE_CHECK: '1' } }), true);
    assert.equal(shouldCheck({ ...INSTALLED, env: { LAMPLIT_UPDATE_CHECK: '' } }), true);
  });

  it('needs every one of them to agree', () => {
    assert.equal(shouldCheck({ isPackaged: true, portable: true, env: {}, setting: false }), false);
  });
});
