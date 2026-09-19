/* Site header behaviour, shared by every page. */
(function () {
    'use strict';
    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    var menuBtn = document.getElementById('menuBtn');
    var appMenu = document.getElementById('appMenu');

    function closeMenu() {
        appMenu.classList.add('is-hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
    }

    if (menuBtn && appMenu) {
        menuBtn.addEventListener('click', function () {
            var willOpen = appMenu.classList.contains('is-hidden');
            appMenu.classList.toggle('is-hidden', !willOpen);
            menuBtn.setAttribute('aria-expanded', String(willOpen));
        });
        // A link (or any button whose own handler opens something else)
        // closes the dropdown on its way out, rather than leaving it open
        // behind whatever it just triggered.
        appMenu.addEventListener('click', function (event) {
            if (event.target.closest('a, button')) closeMenu();
        });
        document.addEventListener('click', function (event) {
            if (appMenu.classList.contains('is-hidden')) return;
            if (appMenu.contains(event.target) || menuBtn.contains(event.target)) return;
            closeMenu();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !appMenu.classList.contains('is-hidden')) closeMenu();
        });
    }

    /** Wires a menu button to open/close a self-contained overlay by id. */
    function wireOverlay(openBtnId, overlayId, closeBtnId) {
        var openBtn = document.getElementById(openBtnId);
        var overlay = document.getElementById(overlayId);
        var closeBtn = document.getElementById(closeBtnId);
        if (!openBtn || !overlay) return;

        openBtn.addEventListener('click', function () { overlay.classList.remove('is-hidden'); });
        if (closeBtn) closeBtn.addEventListener('click', function () { overlay.classList.add('is-hidden'); });
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) overlay.classList.add('is-hidden');
        });
    }

    wireOverlay('menu-about-btn', 'about-overlay', 'close-about-btn');
    wireOverlay('menu-benefits-btn', 'benefits-overlay', 'close-benefits-btn');
})();
