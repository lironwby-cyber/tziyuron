// Offline support: cache the app shell, serve it cache-first, refresh in the background.
const CACHE = 'tziyuron-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/ui.js', 'js/age.js', 'js/model.js', 'js/zip.js', 'js/image.js',
  'js/scan.js', 'js/camera.js', 'js/crop.js', 'js/recorder.js', 'js/anim.js', 'js/cloud.js',
  'fonts/heebo-hebrew.woff2', 'fonts/heebo-latin.woff2',
  'art/album.webp', 'art/av-bunny.webp', 'art/av-fox.webp', 'art/av-lion.webp', 'art/av-panda.webp', 'art/av-puppy.webp', 'art/av-unicorn.webp', 'art/balloon.webp', 'art/bg-playroom.webp', 'art/book.webp', 'art/bucket-blue.webp', 'art/bucket-red.webp', 'art/bucket-yellow.webp', 'art/chest.webp', 'art/confetti.webp', 'art/eraser.webp', 'art/gift.webp', 'art/hand.webp', 'art/home.webp', 'art/magnifier.webp', 'art/mic.webp', 'art/padlock.webp', 'art/pencil.webp', 'art/rainbow.webp', 'art/rocket.webp', 'art/sheet.webp', 'art/sparkle.webp', 'art/speech.webp', 'art/splat.webp', 'art/star.webp', 'art/sun.webp', 'art/tablet.webp', 'art/ticket.webp',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(fresh); return hit; }
      const res = await fresh;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('index.html');
      return Response.error();
    }),
  );
});
