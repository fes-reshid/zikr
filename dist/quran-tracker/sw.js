/*
 * Service worker for the Qur'ān Daily Tracker.
 *
 * Registered from /quran-tracker/, so its scope is that directory and nothing
 * else on the site can be intercepted by it. Requests to the Quran.com API and
 * to the recitation audio are deliberately left alone — they are far too large
 * to cache and both pages already handle them failing.
 *
 * CACHE carries the build id, so a deploy creates a new cache and the old one
 * is deleted on activate rather than serving a stale page forever.
 */
var CACHE = 'quran-tracker-ba90945758aa';
var SCOPE_PATH = new URL(self.registration.scope).pathname;

var SHELL = [
    './',
    './index.html',
    './reader/',
    './reader/index.html',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE).then(function (cache) {
            // One missing entry must not fail the whole install.
            return Promise.all(SHELL.map(function (url) {
                return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
            }));
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== CACHE && key.indexOf('quran-tracker-') === 0) return caches.delete(key);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;      // API, audio, fonts
    if (url.pathname.indexOf(SCOPE_PATH) !== 0) return;   // the rest of the site

    /*
     * Serve from cache at once so moving between the tracker and the reader
     * does not blank the page, then refresh the entry in the background so the
     * next open has the new build.
     */
    event.respondWith(
        caches.open(CACHE).then(function (cache) {
            var options = request.mode === 'navigate' ? { ignoreSearch: true } : undefined;
            return cache.match(request, options).then(function (cached) {
                var network = fetch(request).then(function (response) {
                    if (response && response.ok && response.type === 'basic') {
                        cache.put(request, response.clone());
                    }
                    return response;
                }).catch(function () { return null; });

                if (cached) return cached;
                return network.then(function (response) {
                    return response || cache.match('./index.html');
                });
            });
        })
    );
});
