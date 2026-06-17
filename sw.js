
const CACHE_NAME = 'ravn-offline-v1';

// Install Event: Takes over immediately
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

// Activate Event: Cleans up old caches if we update the version
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(
        keys.map(key => {
            if (key !== CACHE_NAME) return caches.delete(key);
        })
    )));
    self.clients.claim();
});

// Fetch Event: Stale-While-Revalidate Strategy
self.addEventListener('fetch', (e) => {
    // Only cache GET requests (HTML, CSS, Fonts, Images)
    if (e.request.method !== 'GET') return;
    
    // Do NOT cache API calls. Let them hit the network or fail gracefully.
    if (e.request.url.includes('/api/')) return;

    e.respondWith(
        caches.match(e.request).then(cachedResponse => {
            // Fetch from network in the background to keep cache fresh
            const fetchPromise = fetch(e.request).then(networkResponse => {
                caches.open(CACHE_NAME).then(cache => {
                    // Store the fresh copy (crucial for Tailwind CDNs and Phosphor Icons)
                    cache.put(e.request, networkResponse.clone());
                });
                return networkResponse;
            }).catch(() => {
                // Network failed (You are offline). 
                console.log("[RAVN Offline] Serving from cache: ", e.request.url);
            });

            // Return the instant cached version if we have it, otherwise wait for the network
            return cachedResponse || fetchPromise; 
        })
    );
});
