// Service worker so the itinerary and map work with spotty signal underground.
// Bump CACHE when you change any app file below.
const CACHE = "muni-challenge-v7";
const MAP_CACHE = "muni-map-v1"; // basemap tiles/fonts/styles + map library; kept across app updates
const MAP_CACHE_MAX = 4000;
const FILES = ["./", "index.html", "css/styles.css", "js/data.js", "js/plan.js", "js/network.js", "js/map.js", "js/app.js", "icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MAP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAP_CACHE_MAX; i++) await cache.delete(keys[i]); // oldest first
}

// Styles and the tile index change when OpenFreeMap publishes new data: network first.
async function networkFirst(req) {
  const cache = await caches.open(MAP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

// Tiles, fonts, sprites and the map library are versioned by URL: cache first.
async function cacheFirst(req) {
  const cache = await caches.open(MAP_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (Math.random() < 0.02) trim(cache);
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "tiles.openfreemap.org") {
    const index = url.pathname.startsWith("/styles/") || /^\/[a-z_]+$/.test(url.pathname); // e.g. /planet
    e.respondWith(index ? networkFirst(req) : cacheFirst(req));
    return;
  }
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return; // e.g. walking directions: always live
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
