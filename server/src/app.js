import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTIONS, DocumentStore, isCollection, isId } from './store.js';

/** The header the client stamps each write with. See DocumentStore. */
const SEQ_HEADER = 'x-doc-seq';

/**
 * The whole API, and the built app in front of it.
 *
 * Deliberately tiny: the client owns the document shapes, the server owns
 * nothing but the bytes. Anything the server understood about a document would
 * be a second place to change when the shape changes.
 */
export function createApp({ dataDir, publicDir, version = '0.0.0' }) {
  const store = new DocumentStore(dataDir);
  const app = express();

  app.disable('x-powered-by');
  app.use(localhostCors);
  app.use('/api', express.json({ limit: '16mb' }));

  app.get('/api/health', (request, response) => {
    response.json({ ok: true, name: 'lamplit', version, dataDir });
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
    app.use(express.static(publicDir, { index: 'index.html', maxAge: '1h' }));
    // A single page, so anything that is not a file is still the app. Express 5
    // has no `*` route any more; a middleware is the way to say "everything".
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
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
