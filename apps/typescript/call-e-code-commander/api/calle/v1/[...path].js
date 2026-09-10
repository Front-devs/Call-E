/**
 * Deployed CALL-E proxy.
 *
 * Mirrors the middleware in vite.config.js so a hosted build behaves exactly
 * like a local one. The key is attached here, on the server, and never reaches
 * the page. Requests arriving from the browser carry no credential at all.
 */

const CALLE_API = 'https://api.heycall-e.com';

// The raw body is forwarded untouched, so a parsed-and-restringified payload
// can never differ from what the page actually sent.
export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const apiKey = (process.env.CALLE_API_KEY || '').trim();

  if (!apiKey) {
    res.status(503).json({
      error: {
        code: 'proxy_not_configured',
        message: 'No CALLE_API_KEY in the deployment environment. Set it in the hosting provider and redeploy.',
        details: {}
      }
    });
    return;
  }

  const incoming = new URL(req.url, 'http://proxy.local');
  const suffix = incoming.pathname.replace(/^\/api\/calle/, '');
  const target = `${CALLE_API}${suffix}${incoming.search}`;

  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json'
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  // Chosen by the client and must survive the hop, otherwise a retry through
  // the proxy would place a second call to a sleeping engineer.
  if (req.headers['idempotency-key']) headers['idempotency-key'] = req.headers['idempotency-key'];

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') body = await readBody(req);

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: { code: 'provider_unavailable', message: `Could not reach CALL-E: ${err.message}`, details: {} }
    });
  }
}
