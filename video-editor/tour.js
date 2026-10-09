/*
 * Reel: a short tour for first-time visitors.
 *
 * Small tips, one at a time, each pointing at a part of the screen: import,
 * the preview, the timeline (with buttons to make it bigger or smaller), the
 * Create menu, the details panel and Export. Next, Back and Skip; it shows by
 * itself once, and again from Help ▸ Take the tour. Tips whose part is not on
 * the screen (a phone shows fewer panels) are left out.
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp) return;
    const app = window.ReelApp;
    const el = app.el;
    const KEY = 'reel.tourDone';

    const visible = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && getComputedStyle(n).visibility !== 'hidden' ? n : null;
    };
    const first = (list) => list.map(visible).find(Boolean) || null;

    function steps() {
        return [
            { title: 'Welcome to NoorEditor 👋', text: 'A quick tour of the editor — a few short tips. You can skip it any time, and find it again in Help ▸ Take the tour.' },
            { target: ['#import', '#toggle-bin'], title: 'Bring in your files', text: 'Import videos, photos and sound — or drop them anywhere on the page. They stay on your device; nothing is uploaded.' },
            { target: ['#stage'], title: 'Your video', text: 'This is the preview. Click a title or picture on it to select it, then drag to move it. Press Space to play.' },
            {
                target: ['.timeline-panel'], title: 'The timeline', text: 'Your clips in order, on tracks. Drag clips to move them, drag their ends to trim. Make the timeline bigger or smaller here — or drag the bar just above it.',
                extra: function () {
                    return [
                        el('button', { type: 'button', text: '▲ Bigger timeline', onclick: function () { app.setTimelineHeight(app.timelineHeight() + Math.max(90, window.innerHeight * 0.12)); place(); } }),
                        el('button', { type: 'button', text: '▼ Smaller timeline', onclick: function () { app.setTimelineHeight(app.timelineHeight() - Math.max(90, window.innerHeight * 0.12)); place(); } })
                    ];
                }
            },
            { target: ['#create'], title: 'Make something', text: 'Create has titles, templates, Qur’an and hadith videos, Ramadan and Eid videos, stickers, sounds and recording.' },
            { target: ['.panel.inspector', '#toggle-inspector'], title: 'Details', text: 'Select anything and its details appear here: text, colours, animation, the writing hand, sound and more.' },
            { target: ['#export'], title: 'Share it', text: 'When it is ready, press Export and choose YouTube, Shorts, TikTok, Instagram, Facebook or WhatsApp.' },
            { target: ['#help', '#tools'], title: 'Need help?', text: 'Help has step-by-step tutorials with pictures, and this tour. That’s it — enjoy making your video!' }
        ];
    }

    let ring = null, pop = null, list = [], at = 0;

    function close(done) {
        if (ring) ring.remove();
        if (pop) pop.remove();
        ring = pop = null;
        window.removeEventListener('resize', place);
        document.removeEventListener('keydown', keys, true);
        if (done !== false) { try { localStorage.setItem(KEY, '1'); } catch (err) { /* private mode */ } }
    }

    function keys(e) {
        if (!pop) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
    }

    /** Puts the ring round the step's part of the screen and the tip beside it. */
    function place() {
        if (!pop) return;
        const step = list[at];
        const target = step.target ? first(step.target) : null;
        const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        if (!target) {
            ring.className = 'tour-ring center';
            Object.assign(ring.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
            Object.assign(pop.style, { left: Math.max(12, (vw - pw) / 2) + 'px', top: Math.max(12, (vh - ph) / 2) + 'px' });
            return;
        }
        const r = target.getBoundingClientRect();
        ring.className = 'tour-ring';
        Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
        // Below, above, then to the side — wherever it fits.
        let left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), vw - pw - 12);
        let top;
        if (r.bottom + 14 + ph < vh) top = r.bottom + 14;
        else if (r.top - 14 - ph > 0) top = r.top - 14 - ph;
        else {
            top = Math.min(Math.max(12, r.top + r.height / 2 - ph / 2), vh - ph - 12);
            left = r.right + 14 + pw < vw ? r.right + 14 : Math.max(12, r.left - 14 - pw);
        }
        Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
    }

    function go(i) {
        if (i < 0) return;
        if (i >= list.length) { close(); return; }
        at = i;
        const step = list[i];
        const last = i === list.length - 1;
        pop.replaceChildren.apply(pop, [
            el('h3', { text: step.title }),
            el('p', { text: step.text }),
            step.extra ? el('div', { className: 'tour-extra' }, step.extra()) : null,
            el('div', { className: 'tour-foot' }, [
                el('span', { className: 'tour-count', text: (i + 1) + ' / ' + list.length }),
                i ? el('button', { type: 'button', className: 'ghost', text: 'Back', onclick: function () { go(at - 1); } }) : el('button', { type: 'button', className: 'ghost', text: 'Skip', onclick: function () { close(); } }),
                el('button', { type: 'button', className: 'primary', text: last ? 'Done' : (i ? 'Next' : 'Start the tour'), onclick: function () { go(at + 1); } })
            ])].filter(Boolean));
        place();
        const next = pop.querySelector('.tour-foot .primary');
        if (next) next.focus();
    }

    function start() {
        close(false);
        app.pause();
        list = steps().filter((s) => !s.target || first(s.target));
        ring = el('div', { className: 'tour-ring center', 'aria-hidden': 'true' });
        pop = el('div', { className: 'tour-pop', role: 'dialog', 'aria-label': 'Tour' });
        document.body.append(ring, pop);
        window.addEventListener('resize', place);
        document.addEventListener('keydown', keys, true);
        go(0);
    }

    /** Shows the tour once, after the agreement and any first notice are out of the way. */
    function maybeStart() {
        let done = false;
        try { done = localStorage.getItem(KEY) === '1'; } catch (err) { done = true; }
        if (done) return;
        let tries = 0;
        (function wait() {
            const gate = document.getElementById('consentGate');
            const busy = document.documentElement.dataset.ready !== 'true' || (gate && gate.open) || document.querySelector('.modal.generic, .modal:not([hidden])');
            if (busy) { if (++tries < 600) setTimeout(wait, 500); return; }
            start();
        }());
    }

    window.ReelTour = { start: start, close: close, steps: steps };
    setTimeout(maybeStart, 800);
}());
