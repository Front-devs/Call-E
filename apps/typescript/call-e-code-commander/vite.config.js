import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { readRotaFromEnv } from './src/config/rota.js';

const CALLE_API = 'https://api.heycall-e.com';

/**
 * Reads the CALL-E key from the server environment.
 *
 * Checks a .env file as well as the process environment, because the inline
 * `VAR=value command` form does not work in PowerShell, which is where this is
 * most likely to be run. The value is only ever read here, on the server, and
 * is never sent to the page.
 */
function readServerKey(mode) {
  if (process.env.CALLE_API_KEY) return process.env.CALLE_API_KEY.trim();
  const fileEnv = loadEnv(mode || 'development', process.cwd(), 'CALLE');
  return (fileEnv.CALLE_API_KEY || '').trim();
}

/**
 * Reads the seeded on-call rota from the server environment.
 *
 * Values set in the process environment win over the .env file, matching how
 * the API key is resolved. The parsing itself lives in src/config/rota.js so it
 * can be tested without starting a server.
 */
function readServerRota(mode) {
  const fileEnv = loadEnv(mode || 'development', process.cwd(), 'CALLE');
  return readRotaFromEnv({ ...fileEnv, ...process.env });
}

/**
 * Server-side CALL-E proxy.
 *
 * CALL-E's own guidance is explicit: the SDK is a server SDK, keys must not be
 * sent to browser code, and a frontend that needs to start a call should go
 * through its own backend. This middleware is that backend.
 *
 * When CALLE_API_KEY is present in the environment, the page talks to
 * /api/calle/v1/* and never sees a key. The middleware attaches the real
 * Authorization header on the way out. Requests from the page carry no
 * credential at all, so there is nothing in the browser worth stealing.
 *
 * With no CALLE_API_KEY set, the proxy reports itself unavailable and the app
 * runs a clearly labelled simulation. There is no browser-side key path at all,
 * so an unconfigured checkout can still be explored without a credential ever
 * being typed into the page.
 */
function callEProxy() {
  let apiKey = '';
  let rota = [];

  const attach = (server) => {
    server.middlewares.use('/api/calle/mode', (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        serverKey: Boolean(apiKey),
        baseUrl: apiKey ? '/api/calle' : null,
        // Seeded rota, so a demo does not open onto three empty rows. Never a
        // credential, and always overridable in the dialog before dialling.
        rota
      }));
    });

    server.middlewares.use('/api/calle/v1', async (req, res) => {
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: { code: 'proxy_not_configured', message: 'No CALLE_API_KEY on the server. Put it in a .env file or the environment and restart.', details: {} }
        }));
        return;
      }

      // req.url is already stripped of the mount path by connect.
      const target = `${CALLE_API}/v1${req.url}`;

      const headers = {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json'
      };
      if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
      // The idempotency key is chosen by the client and must survive the hop,
      // otherwise a retry through the proxy would place a second call.
      if (req.headers['idempotency-key']) headers['idempotency-key'] = req.headers['idempotency-key'];

      let body;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await readBody(req);
      }

      try {
        const upstream = await fetch(target, { method: req.method, headers, body });
        const text = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
        res.end(text);
      } catch (err) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: { code: 'provider_unavailable', message: `Could not reach CALL-E: ${err.message}`, details: {} }
        }));
      }
    });
  };

  return {
    name: 'call-e-proxy',
    config(_config, env) {
      apiKey = readServerKey(env.mode);
      rota = readServerRota(env.mode);
      // Announced once at startup so it is obvious which mode the app is in
      // before anyone tries to page a rota.
      console.log(apiKey
        ? '[call-e] Server key loaded. Live calls enabled, key stays on the server.'
        : '[call-e] No CALLE_API_KEY found. Running in simulation mode. Add one to .env to place real calls.');
      console.log(rota.length
        ? `[call-e] Rota seeded from .env: ${rota.map((c) => `${c.id} ${c.phone || 'no number'}`).join(', ')}`
        : '[call-e] No rota seeded. Set CALLE_ROTA_PRIMARY_PHONE in .env to prefill the dialog.');
    },
    configureServer: attach,
    configurePreviewServer: attach
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [callEProxy()],
  resolve: {
    alias: {
      'node:crypto': path.resolve(__dirname, './src/lib/cryptoShim.js')
    }
  }
});
