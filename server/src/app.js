import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTIONS, DocumentStore, isCollection, isId } from './store.js';
import { createUpdateChecker } from './updates.js';

/** The header the client stamps each write with. See DocumentStore. */
const SEQ_HEADER = 'x-doc-seq';

/**
 * The whole API, and the built app in front of it.
 *
 * Deliberately tiny: the client owns the document shapes, the server owns
 * nothing but the bytes. Anything the server understood about a document would
 * be a second place to change when the shape changes.
 */
export function createApp({
  dataDir,
  publicDir,
  build = {},
  previousVersion = null,
  updates = createUpdateChecker({ version: build.version ?? '0.0.0', enabled: false }),
  /** Names the API answers to besides the machine's own; see sameMachineOnly. */
  hosts = [],
}) {
  const store = new DocumentStore(dataDir);
  const app = express();

  app.disable('x-powered-by');
  app.use(localhostCors);
  app.use('/api', sameMachineOnly(hosts));
  app.use('/api', express.json({ limit: '16mb' }));

  /**
   * Who is answering, and which build of it. The client reads this for the
   * About sheet and for the notice it shows after an upgrade, so every field
   * the build was stamped with is here rather than in a second endpoint.
   */
  app.get('/api/health', (request, response) => {
    response.json({
      ok: true,
      name: 'lamplit',
      version: build.version ?? '0.0.0',
      commit: build.commit ?? '',
      builtAt: build.builtAt ?? '',
      build: build.build ?? 'local',
      channel: build.channel ?? 'dev',
      previousVersion,
      dataDir,
    });
  });

  /**
   * Whether a newer Lamplit has been published. Nothing asks GitHub until this
   * is called, and it is called only by an app whose reader left the check on —
   * so switching it off in Preferences means the request does not happen,
   * rather than happening and being ignored.
   */
  app.get('/api/updates', async (request, response, next) => {
    try {
      response.json(await updates.check());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/docs/:collection', async (request, response, next) => {
    const { collection } = request.params;
    if (!isCollection(collection)) return notFound(response, 'unknown collection');
    try {
      const light = request.query['index'] !== undefined;
      response.json(light ? await store.index(collection) : await store.list(collection));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/docs/:collection/:id', async (request, response, next) => {
    const { collection, id } = request.params;
    if (!isCollection(collection) || !isId(collection, id)) return notFound(response);
    try {
      const document = await store.read(collection, id);
      if (document === null) return notFound(response);
      response.json(document);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/docs/:collection/:id', async (request, response, next) => {
    const { collection, id } = request.params;
    if (!isCollection(collection) || !isId(collection, id)) return notFound(response);
    if (request.body === undefined || request.body === null || typeof request.body !== 'object') {
      return response.status(400).json({ ok: false, error: 'body must be a JSON document' });
    }
    try {
      response.json(await store.write(collection, id, request.body, seqOf(request)));
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/docs/:collection/:id', async (request, response, next) => {
    const { collection, id } = request.params;
    if (!isCollection(collection) || !isId(collection, id)) return notFound(response);
    try {
      response.json(await store.remove(collection, id, seqOf(request)));
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (request, response) => notFound(response, 'no such endpoint'));

  if (publicDir && existsSync(join(publicDir, 'index.html'))) {
    // The bundles carry a hash in their names and can be cached for as long as
    // anyone likes; index.html is what names them, so it has to be asked about
    // every time or an upgrade leaves the browser asking for bundles that are
    // no longer there.
    app.use(
      express.static(publicDir, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (response, path) => {
          if (path.endsWith('index.html')) response.set('Cache-Control', 'no-cache');
        },
      }),
    );
    // A single page, so a path that is not a file is still the app. Express 5
    // has no `*` route any more; a middleware is the way to say "everything".
    // A path with an extension is a file that is not there, and saying so is
    // worth more than an HTML page where a script was expected.
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      if (/\.[a-z0-9]+$/i.test(request.path)) return next();
      response.set('Cache-Control', 'no-cache');
      response.sendFile(join(publicDir, 'index.html'));
    });
  } else {
    app.get('/', (request, response) => {
      response
        .status(200)
        .type('text/plain')
        .send(
          'Lamplit API is running. The built app is not being served from here.\n' +
            'Run `npm start` in the repository to develop, or `npm run package` to build a copy that is.\n',
        );
    });
  }

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status ?? error.statusCode ?? 500;
    if (status >= 500) console.error('[lamplit]', error);
    response.status(status).json({ ok: false, error: error.message ?? 'server error' });
  });

  app.locals['store'] = store;
  return app;
}

export { COLLECTIONS };

function seqOf(request) {
  const raw = Number(request.get(SEQ_HEADER));
  return Number.isFinite(raw) ? raw : undefined;
}

function notFound(response, error = 'not found') {
  response.status(404).json({ ok: false, error });
}

/**
 * A page on the web cannot read this API through CORS, but it can point a
 * domain of its own at 127.0.0.1 and then talk to "itself" — DNS rebinding —
 * and the browser sees nothing cross-origin about it. What gives it away is
 * the `Host` header, which names the attacker's domain: a request from this
 * machine names the machine. Loopback by name, `*.localhost`, any IP literal
 * (a phone on the LAN types one; an attacker's page cannot be served from one)
 * and whatever the server was told to answer to. Anything else is misdirected.
 */
function sameMachineOnly(extra) {
  const allowed = new Set(['localhost', '127.0.0.1', '::1', ...extra.map(String)]);
  return (request, response, next) => {
    const header = request.get('host');
    // No Host at all is HTTP/1.0 on the command line, not a browser.
    if (!header || isOwnHost(hostnameOf(header), allowed)) return next();
    response.status(421).json({ ok: false, error: 'misdirected request' });
  };
}

/** The name in a Host header, without its port or its IPv6 brackets. */
function hostnameOf(header) {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(header);
  if (bracketed) return bracketed[1].toLowerCase();
  return header.replace(/:\d+$/, '').toLowerCase();
}

function isOwnHost(hostname, allowed) {
  if (allowed.has(hostname) || hostname.endsWith('.localhost')) return true;
  // An IP literal: dotted v4, or the v6 that came in brackets.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || /^[0-9a-f:.]+$/.test(hostname);
}

/**
 * The app is served from this same origin in a packaged run, so CORS only
 * matters while developing, when `ng serve` is on another port. Localhost
 * only: the API holds an API key in plain text and is nobody else's business.
 */
function localhostCors(request, response, next) {
  const origin = request.get('origin');
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
    response.set('Access-Control-Allow-Headers', `Content-Type,${SEQ_HEADER}`);
    response.set('Access-Control-Max-Age', '600');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
}
