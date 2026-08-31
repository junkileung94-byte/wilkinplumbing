'use strict';
/* Same-origin Plausible proxy.
 *
 * The browser only ever talks to wilkinplumbing.ca, so ad-blockers — which match the
 * known analytics hostnames, not ours — leave the tracker alone. This process relays
 * server-to-server to the self-hosted Plausible CE instance:
 *
 *   GET  /js/analytics.js  -> the tracker script (cached in memory 12 h)
 *   POST /api/event        -> the event JSON, carrying the real visitor IP and
 *                             User-Agent, which is what uniques and geo are derived
 *                             from. Drop them and every visitor becomes this server.
 *
 * Page snippet (site/index.html, cloned into the location pages):
 *   <script defer data-domain="wilkinplumbing.ca"
 *           data-api="/api/event" src="/js/analytics.js"></script>
 *
 * The upstream is a cloudflared hostname on the box that runs Plausible; its dashboard
 * is a separate, non-public surface. PLAUSIBLE_UPSTREAM overrides it; PLAUSIBLE=0
 * turns the whole thing off (both routes 404, the page snippet then does nothing).
 */

const UPSTREAM = (process.env.PLAUSIBLE_UPSTREAM || 'https://analytics.battlefriends.org')
  .replace(/\/+$/, '');
/* outbound-links: clicks off to Google reviews and the like.
 * tagged-events:  the named goals the page fires — Call Click, Booking Request. */
const UPSTREAM_SCRIPT = '/js/script.outbound-links.tagged-events.js';

const TRACKER = '/js/analytics.js';
const EVENT = '/api/event';
const CACHE_MS = 12 * 60 * 60 * 1000;
const MAX_EVENT_BODY = 10000;

let cache = { body: null, at: 0 };

function enabled() {
  return process.env.PLAUSIBLE !== '0';
}

function handles(pathname) {
  return enabled() && (pathname === TRACKER || pathname === EVENT);
}

async function serveTracker(res) {
  if (!cache.body || Date.now() - cache.at > CACHE_MS) {
    const up = await fetch(UPSTREAM + UPSTREAM_SCRIPT, { signal: AbortSignal.timeout(10000) });
    const text = await up.text();
    // A truncated or error-page "script" cached for 12 h would silently kill tracking.
    if (!up.ok || text.length < 100) {
      if (!cache.body) { res.writeHead(503); return res.end(); }
    } else {
      cache = { body: text, at: Date.now() };
    }
  }
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=43200',
  });
  res.end(cache.body);
}

async function forwardEvent(req, res, ip) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_EVENT_BODY) { res.writeHead(400); return res.end(); }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) { res.writeHead(400); return res.end(); }

  const up = await fetch(UPSTREAM + EVENT, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': req.headers['user-agent'] || '',
      'X-Forwarded-For': ip,
    },
    signal: AbortSignal.timeout(10000),
  });
  res.writeHead(up.status, { 'Content-Type': 'text/plain' });
  res.end(await up.text());
}

/* Analytics must never take the site down with it: any upstream failure answers the
 * browser and is dropped. A lost pageview is not worth a 500 on a customer's screen. */
async function handle(req, res, pathname, ip) {
  try {
    if (pathname === TRACKER && req.method === 'GET') return await serveTracker(res);
    if (pathname === EVENT && req.method === 'POST') return await forwardEvent(req, res, ip);
    res.writeHead(404);
    return res.end();
  } catch (err) {
    if (!res.headersSent) res.writeHead(502);
    return res.end();
  }
}

module.exports = { handles, handle, TRACKER, EVENT, UPSTREAM };
