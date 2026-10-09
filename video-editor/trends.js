/*
 * Reel: trending templates and text designs.
 *
 * Original templates in the styles popular on short-video apps — a bold hook,
 * a photo dump, a 3-2-1 countdown, neon, before & after, a highlighted quote,
 * film memories, word-by-word captions, a spotlight announcement and a travel
 * intro. Each is vertical by default, cuts quickly, and puts your own imported
 * pictures and videos into its photo slots (painted backgrounds fill in when
 * there are none). Everything stays editable, and one undo takes it off.
 *
 * Text designs: ready-made looks for any title (bold caption, yellow hook,
 * neon, highlighter, comic, elegant gold…), shown with a live sample.
 * No artwork or assets are taken from any other app; all of it is drawn here.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelTrends = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Every design starts from this, so switching designs never leaves a glow or box behind.
    const BASE = { glow: null, outline: { width: 0, color: '#000000' }, box: false, italic: false, shadow: false, bold: true };
    const DESIGNS = {
        caption: { label: 'Bold caption', patch: { font: 'sans', fontSize: 64, color: '#ffffff', outline: { width: 6, color: '#111111' }, anim: 'pop' } },
        hook: { label: 'Yellow hook', patch: { font: 'sans', fontSize: 74, color: '#ffe14d', outline: { width: 7, color: '#111111' }, anim: 'pop' } },
        'neon-pink': { label: 'Neon pink', patch: { font: 'sans', fontSize: 66, color: '#fff4fd', glow: '#ff3fd2', outline: { width: 2, color: '#ff3fd2' }, anim: 'blur' } },
        'neon-blue': { label: 'Neon blue', patch: { font: 'sans', fontSize: 66, color: '#effcff', glow: '#2fd8ff', outline: { width: 2, color: '#2fd8ff' }, anim: 'blur' } },
        highlight: { label: 'Highlighter', patch: { font: 'sans', fontSize: 50, color: '#151515', box: true, boxColor: '#ffe14d', anim: 'slide' } },
        label: { label: 'Red label', patch: { font: 'sans', fontSize: 44, color: '#ffffff', box: true, boxColor: '#e5484d', anim: 'slide-right' } },
        comic: { label: 'Comic pop', patch: { font: 'display', fontSize: 80, color: '#ffffff', outline: { width: 9, color: '#1a1a1a' }, anim: 'bounce' } },
        gold: { label: 'Elegant gold', patch: { font: 'cormorant', fontSize: 66, bold: false, italic: true, color: '#f2d27a', shadow: true, anim: 'fade' } },
        note: { label: 'Typewriter note', patch: { font: 'mono', fontSize: 38, bold: false, color: '#1e1e1e', box: true, boxColor: '#f6f1e1', anim: 'typewriter' } },
        words: { label: 'Word by word', patch: { font: 'sans', fontSize: 62, color: '#ffffff', outline: { width: 4, color: '#111111' }, anim: 'words' } },
        'arabic-gold': { label: 'Arabic gold', patch: { font: 'amiri', fontSize: 72, bold: false, color: '#f2d27a', glow: '#8a5a1c', anim: 'fade' } },
        pastel: { label: 'Soft pastel', patch: { font: 'sans', fontSize: 52, color: '#3d2a12', box: true, boxColor: '#ffd8e4', anim: 'rise' } },
        number: { label: 'Big number', patch: { font: 'sans', fontSize: 190, color: '#ffffff', outline: { width: 7, color: '#111111' }, anim: 'zoom-in' } }
    };

    /** The full patch for a design, sized for the frame (tall frames get smaller words). */
    function designPatch(id, tall) {
        const d = DESIGNS[id] || DESIGNS.caption;
        const p = Object.assign({}, BASE, JSON.parse(JSON.stringify(d.patch)));
        if (tall) p.fontSize = Math.round(p.fontSize * 0.78);
        return p;
    }

    const TEMPLATES = [
        { id: 'hook', name: 'Bold hook', bg: 'ink', photos: 0, lines: ['Wait for it…', '3 things you need to know', 'Save this for later'] },
        { id: 'photo-dump', name: 'Photo dump', bg: 'paper', photos: 6, lines: ['PHOTO DUMP', 'Moments from this week', 'Alhamdulillah for everything'] },
        { id: 'countdown', name: '3-2-1 reveal', bg: 'spotlight', photos: 1, lines: ['The big reveal', 'Coming soon', 'Stay tuned'] },
        { id: 'neon', name: 'Neon nights', bg: 'neon', photos: 0, lines: ['NEON NIGHTS', 'Turn the lights on', 'See you there'] },
        { id: 'before-after', name: 'Before & after', bg: 'split', photos: 2, lines: ['Before & after', 'BEFORE', 'AFTER'] },
        { id: 'quote', name: 'Highlighted quote', bg: 'paper', photos: 0, lines: ['Small steps every day', 'add up to big change', '— Your name'] },
        { id: 'film', name: 'Film memories', bg: 'film', photos: 4, lines: ['Memories', 'Summer days', 'Never forget'] },
        { id: 'kinetic', name: 'Word by word', bg: 'sunny', photos: 0, lines: ['Make every word count', 'One idea at a time', 'Share it'] },
        { id: 'spotlight', name: 'Spotlight announcement', bg: 'spotlight', photos: 1, lines: ['BIG NEWS', 'Something new is here', 'Find out more'] },
        { id: 'travel', name: 'Travel intro', bg: 'pastel', photos: 4, lines: ['MY TRIP', 'Where we went', 'Follow for part 2'] }
    ];

    /* ------------------------------------------------- painted backgrounds */
    function paint(style, W, H, canvas) {
        const c = canvas || document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const u = Math.min(W, H);
        const grad = (stops, x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); return gr; };
        if (style === 'neon') {
            g.fillStyle = grad(['#120424', '#2a0a4a', '#05010f'], 0, 0, 0, H); g.fillRect(0, 0, W, H);
            g.lineWidth = Math.max(1, u * 0.004);
            for (let i = 0; i <= 14; i += 1) { // perspective grid
                g.strokeStyle = 'rgba(255,63,210,' + (0.15 + i * 0.02) + ')';
                const y = H * 0.62 + Math.pow(i / 14, 2) * H * 0.38;
                g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
            }
            for (let i = -8; i <= 8; i += 1) {
                g.strokeStyle = 'rgba(47,216,255,.28)';
                g.beginPath(); g.moveTo(W / 2 + i * W * 0.02, H * 0.62); g.lineTo(W / 2 + i * W * 0.22, H); g.stroke();
            }
            const sun = g.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, u * 0.35);
            sun.addColorStop(0, 'rgba(255,90,200,.55)'); sun.addColorStop(1, 'rgba(255,90,200,0)');
            g.fillStyle = sun; g.fillRect(0, 0, W, H);
        } else if (style === 'paper') {
            g.fillStyle = grad(['#f7f1e3', '#efe6d0'], 0, 0, W, H); g.fillRect(0, 0, W, H);
            let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
            for (let i = 0; i < 900; i += 1) { g.fillStyle = 'rgba(120,90,40,' + (r() * 0.08) + ')'; g.fillRect(r() * W, r() * H, u * 0.003, u * 0.003); }
        } else if (style === 'spotlight') {
            g.fillStyle = '#07080c'; g.fillRect(0, 0, W, H);
            const l = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, u * 0.75);
            l.addColorStop(0, 'rgba(255,236,190,.55)'); l.addColorStop(0.45, 'rgba(255,200,120,.16)'); l.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = l; g.fillRect(0, 0, W, H);
        } else if (style === 'film') {
            g.fillStyle = grad(['#1b140f', '#2b2119', '#120d09'], 0, 0, 0, H); g.fillRect(0, 0, W, H);
            const band = H * 0.07;
            g.fillStyle = '#050403'; g.fillRect(0, 0, W, band); g.fillRect(0, H - band, W, band);
            g.fillStyle = '#d9cbb0';
            for (let x = u * 0.03; x < W; x += u * 0.08) { g.fillRect(x, band * 0.3, u * 0.035, band * 0.4); g.fillRect(x, H - band * 0.7, u * 0.035, band * 0.4); }
        } else if (style === 'sunny') {
            g.fillStyle = grad(['#ffcf3f', '#ff8a3d'], 0, 0, W, H); g.fillRect(0, 0, W, H);
            g.save(); g.translate(W / 2, H / 2); g.fillStyle = 'rgba(255,255,255,.12)';
            for (let i = 0; i < 16; i += 1) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(u * 2, -u * 0.12); g.lineTo(u * 2, u * 0.12); g.closePath(); g.fill(); }
            g.restore();
        } else if (style === 'pastel') {
            g.fillStyle = grad(['#ffd8e4', '#ffe6c7', '#d9f0ff'], 0, 0, W, H); g.fillRect(0, 0, W, H);
            [[0.2, 0.25, '#ffffff'], [0.8, 0.7, '#ffc2d6'], [0.7, 0.2, '#c9e8ff']].forEach(([x, y, col]) => {
                const b = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, u * 0.45); b.addColorStop(0, col); b.addColorStop(1, 'rgba(255,255,255,0)');
                g.globalAlpha = 0.6; g.fillStyle = b; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
            });
        } else if (style === 'split') {
            g.fillStyle = '#20232a'; g.fillRect(0, 0, W / 2, H);
            g.fillStyle = '#2e6b58'; g.fillRect(W / 2, 0, W / 2, H);
            g.fillStyle = '#ffffff'; g.fillRect(W / 2 - u * 0.004, 0, u * 0.008, H);
        } else { // ink
            g.fillStyle = grad(['#0b0b0e', '#15151b'], 0, 0, 0, H); g.fillRect(0, 0, W, H);
        }
        return c;
    }

    return { DESIGNS, TEMPLATES, designPatch, paint };
}));

/* ------------------------------------------------------- the editor side */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp) return;
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const R = window.ReelTrends;

    async function bgFile(style, W, H, name) {
        const c = R.paint(style, W, H);
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
        return new File([blob], name + '.png', { type: 'image/png', lastModified: Date.now() });
    }

    /** The project's own pictures and videos, newest first, for the photo slots. */
    function ownPhotos(p) {
        return p.media.filter((m) => (m.type === 'image' || m.type === 'video') && !/^(Trend|Studio|Ramadan|Eid|Hajj|Jumu|Laylat|Nature) /.test(m.name) && !/ – /.test(m.name)).reverse();
    }

    /**
     * Builds template `id` after what is on the timeline (or into an empty project
     * of `shape`): `o` = { lines: [3 strings], shape }.
     */
    async function makeTrend(id, o) {
        const tpl = R.TEMPLATES.find((t) => t.id === id) || R.TEMPLATES[0];
        app.pause();
        let p = app.state.project;
        const empty = !p.clips.length;
        if (empty) {
            const size = { tall: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] }[o.shape || 'tall'];
            const q = T.clone(p); q.width = size[0]; q.height = size[1]; q.name = tpl.name;
            app.apply(q);
            p = app.state.project;
        }
        const W = p.width, H = p.height, tall = H > W;
        const lines = [0, 1, 2].map((i) => ((o.lines && o.lines[i]) || '').trim() || tpl.lines[i]);
        const ids = await app.importFiles([await bgFile(tpl.bg, W, H, 'Trend ' + tpl.name)], { noCommit: true, fresh: true });
        if (!ids.length) throw new Error('The background could not be made.');
        const bgId = ids[0];
        p = T.clone(app.state.project);
        const photos = ownPhotos(p).slice(0, Math.max(tpl.photos, 0));
        const start = T.projectDuration(p);
        const tracks = {};
        const track = function (key, type, name) {
            if (tracks[key]) return tracks[key];
            const tid = T.nextTrackId(p, type);
            p = T.addTrack(p, type, tpl.name + ' · ' + name);
            return (tracks[key] = tid);
        };
        const bg = (at, dur, transition) => {
            const tid = track('bg', 'video', 'background'); // adds the track to p first
            p = T.addClip(p, Object.assign(T.clipFromMedia(T.getMedia(p, bgId), tid, at), { duration: dur, fit: 'cover', transition: transition || null }));
        };
        const photo = (m, at, dur, patch, slot) => {
            const c = Object.assign(T.clipFromMedia(m, track(slot || 'photo', 'video', slot ? 'photo ' + slot : 'photos'), at), { duration: dur, fit: 'cover', muted: true }, patch);
            if (m.type === 'video') c.duration = Math.min(dur, m.duration || dur);
            p = T.addClip(p, c);
        };
        const text = (key, at, dur, words, design, patch) => {
            const c = Object.assign(T.textClip(track(key, 'text', key), at, words), { duration: dur, fadeIn: 0.15, fadeOut: 0.25, x: 0.5 }, R.designPatch(design, tall), patch);
            p = T.addClip(p, c);
        };
        const sticker = (kind, at, dur, patch) => {
            const extra = Object.assign({}, patch);
            const look = Object.assign({ kind: kind, motion: 'pulse', color: '#ffe14d', rotation: 0 }, extra.sticker);
            delete extra.sticker;
            const c = Object.assign(T.drawClip(track('deco', 'text', 'decoration'), at, []), { duration: dur, anim: 'pop', hand: 'none', x: 0.5, y: 0.2, scale: 0.4 }, extra, { sticker: look });
            p = T.addClip(p, c);
        };
        let t = start;
        if (id === 'hook') {
            bg(t, 7.5);
            text('caption', t + 0.1, 2.3, lines[0], 'hook', { y: 0.45 });
            text('caption', t + 2.5, 2.5, lines[1], 'caption', { y: 0.45, anim: 'words' });
            text('caption', t + 5.1, 2.4, lines[2], 'hook', { y: 0.45, anim: 'zoom-in' });
            sticker('arrow', t + 5.3, 2.2, { y: 0.66, scale: 0.35, sticker: { kind: 'arrow', motion: 'bounce', color: '#ffe14d', rotation: 90 } });
            t += 7.5;
        } else if (id === 'photo-dump') {
            const n = Math.max(3, photos.length || 0), each = 0.95, len = 2.2 + n * each;
            bg(t, len + 1.6);
            text('title', t + 0.1, 2.0, lines[0], 'comic', { y: 0.45 });
            for (let i = 0; i < n; i += 1) {
                const at = t + 2.0 + i * each;
                if (photos[i]) photo(photos[i], at, each + 0.05, { fit: 'cover', scale: tall ? 0.78 : 0.62, x: 0.5, y: 0.47, fx: { border: { width: 14, color: '#ffffff' }, shadow: true, rotate: i % 2 ? 4 : -4 }, transition: i ? { type: 'push', duration: 0.25 } : null });
                else bg(at, each + 0.05);
            }
            text('caption', t + 2.0, n * each, lines[1], 'note', { y: tall ? 0.86 : 0.88 });
            text('title', t + len, 1.6, lines[2], 'pastel', { y: 0.47 });
            t += len + 1.6;
        } else if (id === 'countdown') {
            bg(t, 6.2);
            ['3', '2', '1'].forEach((n, i) => text('number', t + i * 0.9, 0.85, n, 'number', { y: 0.47, exit: 'fade' }));
            if (photos[0]) photo(photos[0], t + 2.7, 3.5, { scale: tall ? 0.82 : 0.6, y: 0.45, fx: { radius: 0.06, shadow: true }, enter: 'zoom-in', enterDuration: 0.5 });
            text('title', t + 2.7, 3.5, lines[0], 'hook', { y: photos[0] ? 0.82 : 0.45, anim: 'zoom-in' });
            sticker('sparkles', t + 2.8, 3.3, { y: photos[0] ? 0.13 : 0.28, scale: 0.45, sticker: { kind: 'sparkles', motion: 'pulse', color: '#ffe14d', rotation: 0 } });
            t += 6.2;
        } else if (id === 'neon') {
            bg(t, 7);
            text('title', t + 0.2, 6.6, lines[0], 'neon-pink', { y: 0.36 });
            text('caption', t + 1.4, 5.4, lines[1], 'neon-blue', { y: 0.52, fontSize: tall ? 38 : 44 });
            text('caption2', t + 4.2, 2.6, lines[2], 'neon-pink', { y: 0.68, fontSize: tall ? 34 : 40, anim: 'pop' });
            t += 7;
        } else if (id === 'before-after') {
            bg(t, 6.5);
            text('title', t + 0.1, 1.8, lines[0], 'caption', { y: 0.45 });
            [0, 1].forEach((i) => {
                const at = t + 1.9 + i * 0.6;
                if (photos[i]) photo(photos[i], at, 6.5 - 1.9 - i * 0.6, { fit: 'contain', scale: 0.48, x: i ? 0.75 : 0.25, y: 0.5, fx: { border: { width: 4, color: '#ffffff' } }, enter: i ? 'slide-right' : 'slide', enterDuration: 0.4 }, i ? 'photo-after' : 'photo-before');
                text(i ? 'after' : 'before', at, 6.5 - 1.9 - i * 0.6, lines[i + 1], 'label', { x: i ? 0.75 : 0.25, y: tall ? 0.64 : 0.84, fontSize: tall ? 30 : 34 });
            });
            t += 6.5;
        } else if (id === 'quote') {
            bg(t, 7);
            sticker('rosette', t + 0.1, 6.8, { y: 0.2, scale: 0.3, sticker: { kind: 'rosette', motion: 'float', color: '#c8641e', rotation: 0 } });
            text('line1', t + 0.4, 6.4, lines[0], 'highlight', { y: tall ? 0.4 : 0.42, fontSize: tall ? 30 : 50 });
            text('line2', t + 1.4, 5.4, lines[1], 'highlight', { y: tall ? 0.52 : 0.56, fontSize: tall ? 30 : 50, boxColor: '#bdf0d0' });
            text('author', t + 2.6, 4.2, lines[2], 'gold', { y: tall ? 0.66 : 0.7, color: '#6b5a3f', shadow: false, fontSize: tall ? 34 : 40 });
            t += 7;
        } else if (id === 'film') {
            const n = Math.max(2, photos.length), each = 1.6;
            bg(t, 2.2 + n * each);
            text('title', t + 0.2, 2.0, lines[0], 'gold', { y: 0.45, anim: 'typewriter' });
            for (let i = 0; i < n; i += 1) {
                const at = t + 2.2 + i * each;
                if (photos[i]) {
                    photo(photos[i], at, each, { scale: 0.86, y: 0.5, motion: { type: i % 2 ? 'pan-left' : 'zoom-in', amount: 0.1 }, transition: i ? { type: 'blur', duration: 0.4 } : null });
                    const c = p.clips[p.clips.length - 1];
                    p = T.applyLook(p, c.id, 'vintage');
                }
            }
            text('caption', t + 2.2, n * each, lines[1], 'note', { y: tall ? 0.86 : 0.88, box: false, color: '#f6ead0', outline: { width: 3, color: '#000000' } });
            text('end', t + 2.2 + n * each - 1.4, 1.4, lines[2], 'gold', { y: 0.47 });
            t += 2.2 + n * each;
        } else if (id === 'kinetic') {
            const words = lines[0].split(/\s+/).filter(Boolean);
            const per = 0.5, len = Math.max(4, words.length * per + 2.6);
            bg(t, len);
            const colours = ['#ffffff', '#151515', '#ffffff', '#7a1fff'];
            words.forEach((w, i) => text('w' + (i % 3), t + 0.2 + i * per, per + 0.05, w.toUpperCase(), 'comic', { y: 0.45, color: colours[i % colours.length], outline: { width: 8, color: i % 4 === 1 ? '#ffffff' : '#151515' }, anim: 'pop', exit: 'none', fadeIn: 0, fadeOut: 0 }));
            const after = t + 0.2 + words.length * per;
            text('caption', after, len - (after - t), lines[1], 'caption', { y: 0.45, anim: 'words' });
            text('caption2', after + 0.6, len - (after - t) - 0.6, lines[2], 'label', { y: 0.6, fontSize: tall ? 30 : 34 });
            t += len;
        } else if (id === 'spotlight') {
            bg(t, 6.5);
            text('title', t + 0.2, 6.2, lines[0], 'hook', { y: photos[0] ? 0.16 : 0.4, anim: 'zoom-in' });
            if (photos[0]) photo(photos[0], t + 0.9, 5.6, { scale: tall ? 0.8 : 0.55, y: 0.5, fx: { radius: 0.05, shadow: true, border: { width: 6, color: '#ffe14d' } }, enter: 'pop', enterDuration: 0.4 });
            text('caption', t + 1.6, 4.9, lines[1], 'caption', { y: photos[0] ? 0.8 : 0.55, fontSize: tall ? 40 : 46, anim: 'rise' });
            text('caption2', t + 3.8, 2.7, lines[2], 'label', { y: photos[0] ? 0.9 : 0.68, fontSize: tall ? 30 : 34 });
            sticker('arrow', t + 3.9, 2.6, { x: 0.18, y: photos[0] ? 0.9 : 0.68, scale: 0.28, sticker: { kind: 'arrow', motion: 'wiggle', color: '#ffe14d', rotation: 0 } });
            t += 6.5;
        } else { // travel
            const n = Math.max(3, photos.length), each = 1.4;
            bg(t, n * each + 0.4);
            for (let i = 0; i < n; i += 1) {
                const at = t + i * each;
                if (photos[i]) photo(photos[i], at, each + 0.05, { scale: 1, motion: { type: ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'][i % 4], amount: 0.14 }, transition: i ? { type: 'zoom', duration: 0.35 } : null });
            }
            text('title', t + 0.2, 2.6, lines[0], 'caption', { y: 0.42, fontSize: tall ? 96 : 110, outline: { width: 0, color: '#000000' }, shadow: true, anim: 'zoom-out' });
            sticker('pin', t + 0.4, 2.4, { y: 0.28, scale: 0.3, sticker: { kind: 'pin', motion: 'bounce', color: '#e5484d', rotation: 0 } });
            text('caption', t + 2.8, n * each - 2.6, lines[1], 'pastel', { y: tall ? 0.84 : 0.86 });
            text('end', t + n * each - 1.4, 1.8, lines[2], 'label', { y: tall ? 0.72 : 0.74 });
            t += n * each + 0.4;
        }
        app.apply(p);
        app.zoomToFit();
        app.seek(start + 0.6);
        return { from: start, to: t, photos: photos.length };
    }

    /* --------------------------------------------------------------- dialogs */
    function thumb(tpl) {
        const c = R.paint(tpl.bg, 180, 320);
        const g = c.getContext('2d');
        const d = R.DESIGNS[{ hook: 'hook', 'photo-dump': 'comic', countdown: 'number', neon: 'neon-pink', 'before-after': 'caption', quote: 'highlight', film: 'gold', kinetic: 'comic', spotlight: 'hook', travel: 'caption' }[tpl.id]].patch;
        const word = tpl.id === 'countdown' ? '3' : tpl.lines[0].split(' ').slice(0, 2).join(' ');
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const size = tpl.id === 'countdown' ? 90 : 24;
        g.font = (d.italic ? 'italic ' : '') + (d.bold === false ? '400 ' : '800 ') + size + 'px ' + (d.font === 'cormorant' ? 'Georgia, serif' : d.font === 'mono' ? 'monospace' : 'system-ui, sans-serif');
        if (d.box) { const w = g.measureText(word).width + 16; g.fillStyle = d.boxColor; g.fillRect(90 - w / 2, 160 - size * 0.75, w, size * 1.5); }
        if (d.glow) { g.shadowColor = d.glow; g.shadowBlur = 14; }
        if (d.outline && d.outline.width) { g.lineWidth = d.outline.width * 0.8; g.strokeStyle = d.outline.color; g.lineJoin = 'round'; g.strokeText(word, 90, 160); }
        g.fillStyle = d.color; g.fillText(word, 90, 160);
        if (tpl.photos) {
            g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.85)';
            g.font = '600 11px system-ui, sans-serif';
            g.fillText('▣ ' + tpl.photos + ' photo slot' + (tpl.photos > 1 ? 's' : ''), 90, 292);
        }
        c.setAttribute('aria-hidden', 'true');
        return c;
    }

    function openTrends() {
        app.pause();
        let chosen = R.TEMPLATES[0];
        const grid = el('div', { className: 'trend-grid' });
        const inputs = [0, 1, 2].map(() => el('input', { type: 'text', maxlength: 90 }));
        const shape = el('select', null, [['tall', 'Phone status, Reels, Shorts · 9:16'], ['square', 'Square post · 1:1'], ['wide', 'YouTube · 16:9']].map((o) => el('option', { value: o[0], text: o[1] })));
        const own = ownPhotos(app.state.project).length;
        const photoNote = el('p', { className: 'hint' });
        const cards = [];
        const pick = function (tpl) {
            chosen = tpl;
            tpl.lines.forEach((l, i) => { inputs[i].value = l; });
            cards.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === tpl.id)));
            photoNote.textContent = tpl.photos
                ? (own ? 'Uses your ' + Math.min(own, tpl.photos) + ' newest imported picture' + (Math.min(own, tpl.photos) > 1 ? 's' : '') + ' or video' + (Math.min(own, tpl.photos) > 1 ? 's' : '') + ' for the photo slots.' : 'Import your pictures or videos first (Media ▸ Import) to fill the photo slots; painted backgrounds are used until then.')
                : 'Text and painted backgrounds only — no photos needed.';
        };
        R.TEMPLATES.forEach(function (tpl) {
            const card = el('button', { type: 'button', className: 'trend-card', 'aria-label': tpl.name, 'data-id': tpl.id, onclick: function () { pick(tpl); } }, [thumb(tpl), el('strong', { text: tpl.name })]);
            cards.push(card);
            grid.append(card);
        });
        pick(chosen);
        const empty = !app.state.project.clips.length;
        app.openDialog({
            title: 'Trending templates',
            wide: true,
            intro: 'Short-video styles with fast cuts and bold captions, made here from scratch. Pick one, change the words, and your own pictures go into its photo slots.',
            body: [grid, app.dialogField('First line', inputs[0]), app.dialogField('Second line', inputs[1]), app.dialogField('Third line', inputs[2]), photoNote,
                empty ? app.dialogField('Shape', shape) : el('p', { className: 'hint', text: 'Added after what is on your timeline, in this project’s frame size.' })],
            actions: [{ label: 'Cancel' }, {
                label: 'Use template', primary: true, run: async function (d) {
                    d.busy(true);
                    try {
                        const r = await makeTrend(chosen.id, { lines: inputs.map((i) => i.value), shape: shape.value });
                        app.toast(chosen.name + ' added (' + (r.to - r.from).toFixed(1) + ' s). Select any part to change it; one Undo takes it all off.');
                    } catch (err) { d.busy(false); d.status(err.message); return false; }
                    return true;
                }
            }]
        });
    }

    /** A sample of each text design; clicking one applies it to title `clipId`. */
    function openDesigns(clipId) {
        const clip = T.getClip(app.state.project, clipId);
        if (!clip) return;
        const grid = el('div', { className: 'trend-grid designs' });
        const sample = (clip.text || 'Your title').split('\n')[0].slice(0, 18);
        Object.keys(R.DESIGNS).forEach(function (key) {
            const d = R.DESIGNS[key].patch;
            const c = document.createElement('canvas');
            c.width = 220; c.height = 110;
            const g = c.getContext('2d');
            g.fillStyle = key.indexOf('neon') === 0 ? '#16052b' : (d.box ? '#2b2f36' : '#3a4250'); g.fillRect(0, 0, 220, 110);
            const fam = { cormorant: 'Georgia, serif', mono: 'monospace', amiri: 'serif' }[d.font] || 'system-ui, sans-serif';
            let size = key === 'number' ? 62 : 28;
            g.font = (d.italic ? 'italic ' : '') + (d.bold === false ? '400 ' : '800 ') + size + 'px ' + fam;
            while (g.measureText(key === 'number' ? '1' : sample).width > 196 && size > 12) { size -= 2; g.font = (d.italic ? 'italic ' : '') + (d.bold === false ? '400 ' : '800 ') + size + 'px ' + fam; }
            const word = key === 'number' ? '1' : key === 'arabic-gold' ? 'بسم الله' : sample;
            g.textAlign = 'center'; g.textBaseline = 'middle';
            if (d.box) { const w = g.measureText(word).width + 18; g.fillStyle = d.boxColor; g.fillRect(110 - w / 2, 55 - size * 0.75, w, size * 1.5); }
            if (d.glow) { g.shadowColor = d.glow; g.shadowBlur = 16; }
            if (d.outline && d.outline.width) { g.lineWidth = d.outline.width * 0.9; g.strokeStyle = d.outline.color; g.lineJoin = 'round'; g.strokeText(word, 110, 55); }
            g.fillStyle = d.color; g.fillText(word, 110, 55);
            g.shadowBlur = 0;
            c.setAttribute('aria-hidden', 'true');
            grid.append(el('button', {
                type: 'button', className: 'trend-card', 'aria-label': R.DESIGNS[key].label, onclick: function () {
                    const cur = T.getClip(app.state.project, clipId);
                    if (!cur) return;
                    app.apply(T.updateClip(app.state.project, clipId, R.designPatch(key, app.state.project.height > app.state.project.width)));
                    app.toast(R.DESIGNS[key].label + ' applied. Undo puts the old look back.');
                }
            }, [c, el('strong', { text: R.DESIGNS[key].label })]));
        });
        app.openDialog({ title: 'Text designs', wide: true, intro: 'Tap a design to give the selected title that look. Size, colours and animation stay changeable in the details panel.', body: [grid], actions: [{ label: 'Done' }] });
    }

    app.addTool({ section: 'Create', label: 'Trending templates (Reels, Shorts, TikTok)…', run: openTrends });
    Object.assign(window.ReelTrends, { makeTrend, openTrends, openDesigns, ownPhotos });
}());
