/**
 * sw.js — keeps the homepage's heavy files on the visitor's device between visits.
 *
 * Why this exists: GitHub Pages serves everything with `Cache-Control:
 * max-age=600`, which can't be changed, and every deploy gives every file a new
 * ETag. The prerender Action deploys after each push, so without this a
 * returning visitor re-downloads all ~6.6 MB of tile thumbnails whenever
 * anything on the site changed.
 *
 * What it caches, and how:
 *   Images under /assets/  cache first; re-checked in the background at most
 *                          once per IMAGE_RECHECK_MS (a conditional request, so
 *                          unchanged files cost a 304, not a download)
 *   three.js + fonts       cache first — pinned CDN versions never change
 *   Everything else        untouched: HTML, JS, CSS and project JSON are small
 *                          (~0.25 MB) and stay fresh, so a publish shows up on
 *                          the very next load
 *
 * Bump VERSION to throw every cache away (e.g. after renaming image files).
 * Registered from main.js; skipped on localhost so local editing never serves
 * stale images (add ?sw=1 to test it locally).
 */

const VERSION = 'v1';
const IMAGE_CACHE = `wr-images-${VERSION}`;
const CDN_CACHE = `wr-cdn-${VERSION}`;
const KEEP = [IMAGE_CACHE, CDN_CACHE];

const IMAGE_RECHECK_MS = 24 * 60 * 60 * 1000;
const IMAGE_MAX_ENTRIES = 250;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // full-size gallery images aren't worth device storage
const FETCHED_AT = 'x-sw-fetched-at';

const IMAGE_PATH = /^\/assets\/.+\.(jpe?g|png|webp|gif|avif)$/i;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('wr-') && !KEEP.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && IMAGE_PATH.test(url.pathname)) {
    event.respondWith(cachedImage(event, request));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
  }
});

// Stamp the time a response was fetched, so the next hit knows if it's due a re-check
async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(FETCHED_AT, String(Date.now()));
  return new Response(await response.blob(), {
    status: response.status, statusText: response.statusText, headers,
  });
}

async function storeImage(cache, request, response) {
  const size = Number(response.headers.get('content-length') || 0);
  if (!response.ok || size > IMAGE_MAX_BYTES) return;
  await cache.put(request, await stamped(response));
  const keys = await cache.keys();
  // Cache API keys come back oldest-inserted first
  for (const old of keys.slice(0, Math.max(0, keys.length - IMAGE_MAX_ENTRIES))) {
    await cache.delete(old);
  }
}

async function cachedImage(event, request) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });

  if (hit) {
    const fetchedAt = Number(hit.headers.get(FETCHED_AT) || 0);
    if (Date.now() - fetchedAt > IMAGE_RECHECK_MS) {
      // Serve the cached copy now; refresh it quietly for next time
      event.waitUntil(
        fetch(request, { cache: 'no-cache' })
          .then(fresh => storeImage(cache, request, fresh))
          .catch(() => {})
      );
    }
    return hit;
  }

  const response = await fetch(request);
  event.waitUntil(storeImage(cache, request, response.clone()).catch(() => {}));
  return response;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Opaque (no-cors) responses report ok=false; they're still fine to replay
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
