const CACHE_NAME = 'baseline-v8';
const ASSETS = ['/'];
 
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});
 
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
 
self.addEventListener('fetch', e => {
  if (
    e.request.url.includes('anthropic.com') ||
    e.request.url.includes('openfoodfacts.org') ||
    e.request.url.includes('googleapis.com') ||
    e.request.url.includes('whoop.com') ||
    e.request.url.includes('netlify') ||
    e.request.url.includes('/.netlify/functions/')
  ) {
    return;
  }
 
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      });
    })
  );
});
 
