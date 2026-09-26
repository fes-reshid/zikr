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
var CACHE = 'quran-tracker-04949d73d17a';
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
    if (url.origin !== self.location.origin) return;      // Quran.com, audio, fonts
    if (url.pathname.indexOf(SCOPE_PATH) !== 0) return;   // the rest of the site
    // Accounts and the reading log must never be answered from a cache.
    if (url.pathname.indexOf(SCOPE_PATH + 'api') === 0) return;

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

/*
 * The reminder arrives with no payload — encrypting one per subscription buys
 * nothing when the message is always the same — so the worker asks the API
 * which juz is due. If that fails, the wording still stands on its own.
 */
self.addEventListener('push', function (event) {
    event.waitUntil((async function () {
        var body = 'You have not marked today as read. If there is no time to read it, at least listen.';
        var target = SCOPE_PATH + 'reader/';

        try {
            var response = await fetch(SCOPE_PATH + 'api/me', { credentials: 'same-origin' });
            if (response.ok) {
                var data = await response.json();
                if (data.signedIn && data.juzToday) {
                    body = 'Juz ' + data.juzToday + ' is still waiting. ' +
                        'If there is no time to read it, at least listen.';
                    target = SCOPE_PATH + 'reader/?juz=' + data.juzToday;
                }
            }
        } catch (err) { /* offline: the generic wording is still true */ }

        return self.registration.showNotification('Today\u2019s juz is waiting', {
            body: body,
            icon: SCOPE_PATH + 'icons/icon-192.png',
            badge: SCOPE_PATH + 'icons/icon-192.png',
            lang: 'en',
            tag: 'daily-juz',              // one at a time, never a pile
            renotify: false,
            data: { url: target }
        });
    })());
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var target = (event.notification.data && event.notification.data.url) || SCOPE_PATH;

    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (windows) {
            for (var i = 0; i < windows.length; i++) {
                if (windows[i].url.indexOf(SCOPE_PATH) !== -1 && 'focus' in windows[i]) {
                    if ('navigate' in windows[i]) windows[i].navigate(target);
                    return windows[i].focus();
                }
            }
            return self.clients.openWindow(target);
        }));
});
