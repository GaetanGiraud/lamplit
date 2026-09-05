import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { productionClosure } from '../lib/production-closure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A repository the way npm leaves one: most packages hoisted to the top, and
 * the ones it could not hoist left where they resolve from.
 *
 *   root/package.json
 *   root/server/package.json            depends on express and qs
 *   root/server/node_modules/qs         another workspace pinned qs 6, so the
 *                                       server's copy could not go to the top
 *   root/server/node_modules/qs/node_modules/side-channel
 *   root/node_modules/express           depends on debug and, optionally, edge
 *   root/node_modules/express/node_modules/debug   pinned to its own version
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'closure-'));
  const pkg = (at, manifest) => {
    const dir = join(root, ...at.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
    return dir;
  };
  pkg('.', { name: 'root', private: true });
  pkg('server', { name: 'server', dependencies: { express: '^5', qs: '^6' } });
  pkg('server/node_modules/qs', { name: 'qs', dependencies: { 'side-channel': '^1' } });
  pkg('server/node_modules/qs/node_modules/side-channel', { name: 'side-channel' });
  pkg('node_modules/express', {
    name: 'express',
    dependencies: { debug: '^4' },
    optionalDependencies: { edge: '^1' },
  });
  pkg('node_modules/express/node_modules/debug', { name: 'debug' });
  // The version of qs some other workspace pinned, which is why the server's
  // is not up here. Copying this one to the stage would ship the wrong qs.
  pkg('node_modules/qs', { name: 'qs', version: 'the other one' });
  return root;
}

const trees = [];
after(() => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
});

function closureOf(build = fixture) {
  const root = build();
  trees.push(root);
  return { root, staged: productionClosure({ root, from: join(root, 'server') }) };
}

describe('the server’s production closure', () => {
  it('keeps every package in the place it resolves from', () => {
    const { root, staged } = closureOf();

    // Not `node_modules/qs`: the stage resolves from server/src, so a copy
    // under server/node_modules is the one it finds, and the top-level one is
    // a different version that another workspace asked for.
    assert.deepEqual([...staged.keys()], ['node_modules/express', 'server/node_modules/qs']);
    assert.equal(staged.get('node_modules/express'), join(root, 'node_modules', 'express'));
    assert.equal(staged.get('server/node_modules/qs'), join(root, 'server', 'node_modules', 'qs'));
  });

  it('lets a nested package travel inside its parent rather than listing it', () => {
    const { staged } = closureOf();
    // Both are copied — their parents are — but neither is copied on its own,
    // which would flatten it to a place Node would not look.
    assert.equal(staged.has('node_modules/express/node_modules/debug'), false);
    assert.equal(staged.has('node_modules/debug'), false);
    assert.equal(staged.has('server/node_modules/qs/node_modules/side-channel'), false);
    assert.equal(staged.has('node_modules/side-channel'), false);
  });

  it('says which package is missing rather than staging without it', () => {
    assert.throws(
      () =>
        closureOf(() => {
          const root = fixture();
          rmSync(join(root, 'node_modules', 'express', 'node_modules', 'debug'), {
            recursive: true,
          });
          return root;
        }),
      /express needs debug/,
    );
  });

  it('walks past an optional dependency that was not installed', () => {
    // `edge` is optional and nowhere in the tree; the closure is still made.
    const { staged } = closureOf();
    assert.equal(staged.has('node_modules/edge'), false);
  });

  it('resolves this repository, where express is at the top', () => {
    const staged = productionClosure({ root: ROOT, from: join(ROOT, 'server') });
    assert.equal(staged.get('node_modules/express'), join(ROOT, 'node_modules', 'express'));
    // Whatever npm did with the rest of them, every place is under the root
    // and none is inside another — a copy loop over these cannot overwrite
    // what an earlier one wrote.
    const places = [...staged.keys()];
    for (const place of places) {
      // Forward slashes whatever the platform: package.mjs splits on them.
      assert.match(place, /^[^\\]+$/);
      assert.ok(!place.startsWith('..'), place);
      assert.equal(
        places.some((other) => place.startsWith(`${other}/`)),
        false,
        `${place} is inside another staged package`,
      );
    }
  });
});
