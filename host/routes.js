/**
 * dsh-grok-bot — host HTTP surface used by the Web panel.
 *
 *   GET  /api/dsh-grok-bot/state      one full snapshot
 *   POST /api/dsh-grok-bot/action     one closed action, returns the fresh snapshot
 *   GET  /api/dsh-grok-bot/events     SSE change stream (client re-pulls state)
 *   GET  /api/dsh-grok-bot/room       one page of a room's messages
 *
 * The routes ride the host webserver, so they share the Web GUI's own
 * authentication. A headless host without a webserver simply has no panel.
 */
const ACTION_BODY_MAX_BYTES = 64 * 1024;
const HEARTBEAT_MS = 15_000;

/**
 * @param {object} res node response.
 * @param {number} status HTTP status.
 * @param {unknown} body JSON body.
 */
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Read a bounded JSON request body.
 * @param {object} req node request.
 * @param {number} maxBytes maximum accepted size.
 * @returns {Promise<any>} parsed body.
 */
async function readBoundedJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') throw new Error('empty body');
  return JSON.parse(text);
}

/**
 * Read one query parameter from a request URL.
 * @param {object} req node request.
 * @param {string} name parameter name.
 * @returns {string | undefined} decoded value.
 */
export function queryParam(req, name) {
  const raw = (req.url ?? '').split('?')[1];
  if (raw === undefined) return undefined;
  for (const part of raw.split('&')) {
    if (!part.startsWith(`${name}=`)) continue;
    try {
      const value = decodeURIComponent(part.slice(name.length + 1));
      return value === '' ? undefined : value;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Remove this plugin's own stale route entries before registering again.
 *
 * The packager can reload the host row (plugin enable/disable) without a
 * process restart. A row that fails after registering its routes leaves the
 * webserver table entries behind; on the next reload the duplicate check would
 * reject the reload and the panel would keep talking to a dead handler. Every
 * path below is owned by this plugin alone, so dropping any pre-existing entry
 * for it is always safe; on a fresh process this is a no-op.
 * @param {object} webServer host webserver service.
 * @param {string[]} paths exact paths this plugin owns.
 * @param {(level: string, message: string) => void} [log] logger.
 */
export function clearOwnedRoutes(webServer, paths, log = () => undefined) {
  for (const table of [webServer?.exact, webServer?.prefixes]) {
    if (table === undefined || table === null || typeof table.delete !== 'function') continue;
    for (const path of paths) {
      if (table.has(path)) {
        table.delete(path);
        log('warn', `dsh-grok-bot: reclaimed a stale route ${path} left by a previous plugin load`);
      }
    }
  }
}

/**
 * Install the panel routes when a webserver is composed.
 * @param {object} ctx host plugin context.
 * @param {{snapshot: Function, action: Function, subscribe: Function, room: Function}} service panel service.
 * @returns {() => void} combined disposer.
 */
export function installRoutes(ctx, service) {
  const webServer = ctx.get('webServer', false);
  if (webServer === undefined || webServer === null) {
    ctx.logger.info('dsh-grok-bot: no webserver composed; panel routes not installed');
    return () => undefined;
  }
  const paths = [
    '/api/dsh-grok-bot/state',
    '/api/dsh-grok-bot/action',
    '/api/dsh-grok-bot/events',
    '/api/dsh-grok-bot/room',
  ];
  clearOwnedRoutes(webServer, paths, (level, message) => ctx.logger[level](message));
  const disposers = [];

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-grok-bot/state',
      handler: (req, res) => {
        void service
          .snapshot(queryParam(req, 'workspace'))
          .then((snapshot) => writeJson(res, 200, snapshot))
          .catch((error) => writeJson(res, 500, { code: 'internal_error', message: String(error?.message ?? error) }));
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-grok-bot/action',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { code: 'bad_action', message: 'POST required' });
          return;
        }
        void readBoundedJson(req, ACTION_BODY_MAX_BYTES)
          .then((body) => service.action(body))
          .then((result) => {
            if (result.ok) writeJson(res, 200, result);
            else writeJson(res, 400, result);
          })
          .catch((error) => {
            writeJson(res, 400, { ok: false, code: 'bad_action', message: String(error?.message ?? error) });
          });
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-grok-bot/events',
      handler: (req, res) => {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        let closed = false;
        const send = (payload) => {
          if (closed || res.writableEnded) return;
          res.write(payload);
        };
        const unsubscribe = service.subscribe((event, data) => {
          send(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
        });
        const heartbeat = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_MS);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        send(': connected\n\n');
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-grok-bot/room',
      handler: (req, res) => {
        void service
          .room(queryParam(req, 'id'), queryParam(req, 'before'), queryParam(req, 'limit'))
          .then((page) => writeJson(res, 200, page))
          .catch((error) => writeJson(res, 500, { code: 'internal_error', message: String(error?.message ?? error) }));
      },
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
