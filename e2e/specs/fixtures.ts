import { test as base } from '@playwright/test';
import { IS_BUILT, PersistenceServer } from './persistence-server';

/**
 * Every spec gets its own server, on its own port, with its own empty data
 * folder — and that is the whole arrangement, because it is the only one the
 * app has. There is no browser-storage mode any more and no dev server in the
 * suite: the app reads its documents from the server at startup or does not
 * start, so a test that did not have one would be testing nothing.
 *
 * A side effect worth having: each test is isolated by construction. Nothing
 * carries over, because there is nowhere for it to carry over in.
 */
export const test = base.extend<{ server: PersistenceServer }>({
  server: async ({}, use) => {
    const server = await PersistenceServer.create();
    await server.start();
    await use(server);
    await server.dispose();
  },
});

test.skip(!IS_BUILT, 'the app has not been built — run `npm run e2e`, which builds it first');

export { expect } from '@playwright/test';
export type { PersistenceServer };
