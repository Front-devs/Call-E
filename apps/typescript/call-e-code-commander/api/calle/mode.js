/**
 * Deployed equivalent of the dev server's mode endpoint.
 *
 * The Vite plugin in vite.config.js only runs under `npm run dev` and
 * `npm run preview`. A production build is static files, so a deployed copy has
 * no server to hold the key and falls back to a labelled simulation. That is
 * safe, but it means a reviewer opening the hosted link never sees a phone ring.
 *
 * These functions are that server. They are the same arrangement as the dev
 * proxy: the key is read from the platform's environment, the page asks which
 * mode it is in, and requests leaving the browser carry no credential.
 */

import { readRotaFromEnv } from '../../src/config/rota.js';

export default function handler(req, res) {
  const apiKey = (process.env.CALLE_API_KEY || '').trim();

  res.setHeader('content-type', 'application/json');
  // The answer depends on server configuration, not on the request, but it must
  // not be cached across a key change.
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    serverKey: Boolean(apiKey),
    baseUrl: apiKey ? '/api/calle' : null,
    rota: readRotaFromEnv(process.env)
  });
}
