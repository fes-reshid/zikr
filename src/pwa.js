/*
 * Installability and offline support, shared by both pages.
 *
 * The service worker is registered under /quran-tracker/ only, so nothing
 * else on the site is affected by it.
 */
(function () {
    'use strict';

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('{{ROOT}}sw.js', { scope: '{{ROOT}}' })
                .catch(function (err) {
                    // Offline support is a bonus; the pages work without it.
                    console.warn('Could not register the service worker', err);
                });
        });
    }

    var installRow = document.getElementById('install-row');
    var installBtn = document.getElementById('install-btn');
    var iosHint = document.getElementById('ios-install-hint');
    if (!installRow) return;

    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true;
    if (standalone) return; // already installed

    var deferredPrompt = null;

    // Chrome and the Android browsers offer this; iOS does not.
    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        deferredPrompt = event;
        installRow.classList.remove('is-hidden');
        if (installBtn) installBtn.classList.remove('is-hidden');
        if (iosHint) iosHint.classList.add('is-hidden');
    });

    if (installBtn) {
        installBtn.addEventListener('click', function () {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function () {
                deferredPrompt = null;
                installRow.classList.add('is-hidden');
            });
        });
    }

    window.addEventListener('appinstalled', function () {
        installRow.classList.add('is-hidden');
    });

    // iOS has no install event: Safari installs only through Share → Add to
    // Home Screen, so say that instead of offering a button that cannot work.
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && iosHint) {
        installRow.classList.remove('is-hidden');
        iosHint.classList.remove('is-hidden');
        if (installBtn) installBtn.classList.add('is-hidden');
    }
})();
