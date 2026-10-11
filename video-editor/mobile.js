/*
 * Reel on a phone.
 *
 * - The preview is only as tall as the picture: a 16:9 video on a tall
 *   screen gives the rest of the height to the timeline (until you drag the
 *   bar between them yourself).
 * - Pinch the timeline with two fingers to zoom it.
 * Menus open as a sheet from the bottom of the screen (see the stylesheet).
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const LAYOUT_KEY = 'reel.timelineHeight';
    const narrow = () => window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches;
    let userSized = false;
    try { userSized = !!localStorage.getItem(LAYOUT_KEY); } catch (err) { /* private mode */ }
    const resizer = document.getElementById('resizer');
    if (resizer) resizer.addEventListener('pointerdown', function () { userSized = true; });

    let last = '';
    /** Fits the preview to the picture's shape on a phone held upright. */
    function fit() {
        if (!narrow() || userSized || document.body.classList.contains('drawing-focus')) return;
        const p = app.state.project;
        const top = document.querySelector('.topbar');
        const transport = document.querySelector('.transport');
        const pictureH = Math.min((window.innerWidth - 16) * p.height / p.width, window.innerHeight * 0.6);
        const room = window.innerHeight - (top ? top.offsetHeight : 52) - pictureH - (transport ? transport.offsetHeight : 56) - 8 - 20;
        const h = Math.round(Math.max(window.innerHeight * 0.28, Math.min(window.innerHeight * 0.62, room)));
        const key = h + ':' + p.width + 'x' + p.height;
        if (key === last) return;
        last = key;
        document.body.style.setProperty('--timeline-h', h + 'px');
        window.dispatchEvent(new Event('resize'));
    }
    window.addEventListener('orientationchange', () => setTimeout(fit, 300));
    window.addEventListener('resize', function () { if (!narrow()) last = ''; else setTimeout(fit, 50); });
    // The frame can change from many places (the frame menu, the Qur'an tool, a new tab), so look now and then.
    setInterval(fit, 1000);
    setTimeout(fit, 0);

    /* Two-finger pinch zooms the timeline. */
    const timeline = document.getElementById('timeline');
    const zoom = document.getElementById('zoom');
    let pinch = null;
    const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    if (timeline && zoom) {
        timeline.addEventListener('touchstart', function (e) {
            if (e.touches.length === 2) pinch = { d: gap(e.touches), v: Number(zoom.value) };
        }, { passive: true });
        timeline.addEventListener('touchmove', function (e) {
            if (!pinch || e.touches.length !== 2) return;
            e.preventDefault();
            const v = Math.max(Number(zoom.min), Math.min(Number(zoom.max), pinch.v + Math.log2(gap(e.touches) / pinch.d) * 22));
            if (Math.abs(v - Number(zoom.value)) >= 1) {
                zoom.value = String(Math.round(v));
                zoom.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, { passive: false });
        timeline.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; });
    }

    window.ReelMobile = { fit: function () { last = ''; fit(); }, isPhone: narrow };
}());
