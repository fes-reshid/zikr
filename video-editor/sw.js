// Service worker for the video editor: works offline after the first visit.
// The version comes from the registration URL (sw.js?v=…), so a new release gets a new cache.
'use strict';
const V = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'video-editor-' + V;
const RUNTIME = 'video-editor-runtime';
const q = (f) => f + '?v=' + V;
const PRECACHE = ['./', 'index.html', 'help.html', 'manifest.webmanifest',
    q('consent.js'), q('timeline.js'), q('hands.js'), q('handwriting.js'), q('studio.js'), q('art-gallery.js'), q('preview-edit.js'), q('creator-tools.js'), q('creative-effects.js'), q('assets/hand-real.webp'), q('audio-core.js'), q('webm.js'), q('editor.js'), q('media-store.js'), q('audio-mix.js'),
    q('export-fast.js'), q('quran.js'), q('captions.js'), q('transcribe-worker.js'), q('vendor/mediabunny.min.mjs'),
    'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('video-editor-') && k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // Pages: fresh from the network when online, the saved copy when offline.
    if (req.mode === 'navigate') {
        e.respondWith(fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
        return;
    }
    // Our own files, fonts and the libraries loaded on demand (speech model,
    // noise remover): saved copy first, otherwise download and keep. The
    // Quran.com API and recitation audio are left alone — they change, and
    // the audio is imported into the project anyway.
    const ours = url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.location).pathname);
    const lib = /(^|\.)(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|huggingface\.co|hf\.co)$/.test(url.hostname);
    const model = url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/mediapipe-models/image_segmenter/');
    if (!ours && !lib && !model) return;
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(ours ? CACHE : RUNTIME).then((c) => c.put(req, copy));
        }
        return res;
    })));
});
