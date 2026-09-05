import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTIONS, DocumentStore, isCollection, isId } from './store.js';
import { createUpdateChecker } from './updates.js';

/** The header the client stamps each write with. See DocumentStore. */
const SEQ_HEADER = 'x-doc-seq';

/**
 * What the page is allowed to load, and from where. Nothing here is load-bearing
 * against a threat this app has today — it serves its own bundle to its own
 * window — but it is the difference between one injected script and none, for
 * the price of a header.
 *
 * The two that are not the strictest thing they could be, and why:
 *
 * - `connect-src *`, because where the story is sent is the reader's own
 *   choice: a URL typed into Connection, any OpenAI-compatible endpoint on the
 *   web. Anything narrower would be this app deciding which providers exist.
 * - `style-src 'unsafe-inline'`, because Angular puts a component's styles on
 *   the page as a `<style>` element when the component is first rendered. The
 *   alternative is a nonce, which means a per-response index.html and a build
 *   that knows about it.
 *
 * `script-src 'self'` is why `optimization.styles.inlineCritical` is off in
 * app/angular.json: that step rewrites the stylesheet link into a deferred one
 * with an `onload=""` attribute, which is an inline script and is forbidden
 * here — and a stylesheet that never applies is an unreadable app.
 *
 * `base-uri 'self'` rather than `'none'`: index.html carries `<base href="/">`,
 * which the router reads. `'self'` still refuses an injected `<base>` pointing
 * anywhere else, which is the trick this directive exists for.
 *
 * Only pages served from here get this. `ng serve` serves its own, and a
 * development server is not what anything ships.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'connect-src *',
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

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
  /** Whether another page on this machine may call the API; see devCors. */
  devCors = false,
}) {
  const store = new DocumentStore(dataDir);
  const app = express();

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });
  app.use(corsFor(devCors));
  app.use('/api', sameMachineOnly(hosts));
  // An empty body parses as `{}`, which would then be written over a document
  // as if somebody had meant it; nobody sends nothing on purpose.
  app.use(
    '/api',
    express.json({
      limit: '16mb',
      verify: (request, response, body) => {
        if (!body.length)
          throw Object.assign(new Error('body must be a JSON document'), { status: 400 });
      },
    }),
  );

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
      // Where the writing is kept — a path that on Windows carries the account
      // name — so About can show it under developer mode. To the app itself
      // and to a command line, not to another page that happened to ask.
      ...(sameOrigin(request) ? { dataDir } : {}),
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
    if (!isDocument(request.body)) {
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

/** One JSON object: not a string, not a number, not a list, not nothing. */
function isDocument(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
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
 * Whether a request came from the app itself: a browser sends no `Origin` on a
 * same-origin GET, and always sends one cross-origin. No `Origin` at all is
 * curl, or the app; an `Origin` naming this server is the app; anything else is
 * some other page that happens to be running on this machine.
 */
function sameOrigin(request) {
  const origin = request.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.get('host');
  } catch {
    return false;
  }
}

/**
 * Whether another page on this machine may read what this API answers.
 *
 * Off, because nothing needs it on: the app asks for `/api/...` relative to
 * wherever it was served, so a packaged copy is same-origin, and `npm start`
 * proxies `/api` from the dev server (app/proxy.conf.json) rather than calling
 * across. What was on the other side of that allowance was every story, every
 * setting and the API key in plain text, readable by any page the reader
 * happened to have open on any loopback port.
 *
 * `LAMPLIT_DEV_CORS=1` puts it back, for a dev server run without the proxy.
 * Localhost origins only, even then.
 */
function corsFor(enabled) {
  return enabled ? localhostCors : noCors;
}

function noCors(request, response, next) {
  // Answered, but with nothing that authorises anything: a browser refuses the
  // request it was asking permission for, which is the point.
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
}

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
