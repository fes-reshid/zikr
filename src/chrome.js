/* Site header behaviour, shared by every page. */
(function () {
    'use strict';
    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    var menuBtn = document.getElementById('menuBtn');
    var mainNav = document.getElementById('mainNav');
    if (!menuBtn || !mainNav) return;

    menuBtn.addEventListener('click', function () {
        var open = mainNav.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', String(open));
    });
    mainNav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
            mainNav.classList.remove('open');
            menuBtn.setAttribute('aria-expanded', 'false');
        });
    });
})();
