/*
 * Reel: the editor UI, preview engine and real-time exporter.
 *
 * The timeline itself is data, edited only through TimelineCore (timeline.js),
 * so every change here is "compute the next project, then commit it". This
 * file owns what that data cannot hold: the imported files, the <video> and
 * <audio> elements that play them, the Web Audio graph, and the DOM.
 *
 * The optional modules loaded after it — media-store.js (keeps files between
 * visits), audio-mix.js (renders the sound offline), export-fast.js (frame-
 * exact export), quran.js (verse videos) and captions.js — reach the editor
 * through window.ReelApp, defined at the bottom.
 *
 * Nothing leaves the device. Files are opened as object URLs, the preview is
 * composited on a canvas, and export happens in this tab.
 */
(function () {
    'use strict';

    const T = window.TimelineCore;
    const $ = (id) => document.getElementById(id);

    const STORAGE_KEY = 'reel.project';
    /** The open project tabs: { active, items: [{ id, project }] }, with each project serialised. */
    const TABS_KEY = 'reel.tabs';
    const MAX_TABS = 5;
    const LAYOUT_KEY = 'reel.timelineHeight';
    const MIN_PPS = 5;
    const MAX_PPS = 500;
    /** Media elements further than this from where they should be get re-seeked. */
    const DRIFT = 0.3;
    /** Stop waiting on a stalled element after this long rather than hanging. */
    const MAX_STALL_MS = 4000;
    const SNAP_PX = 8;
    const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

    /** Title fonts. The Arabic ones and the site's own come from Google Fonts. */
    const FONTS = {
        sans: { label: 'Sans', css: 'system-ui, "Helvetica Neue", Arial, sans-serif' },
        serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
        display: { label: 'Display', css: 'Impact, "Arial Black", "Helvetica Neue", sans-serif' },
        mono: { label: 'Mono', css: 'ui-monospace, Menlo, Consolas, monospace' },
        hand: { label: 'Handwritten', css: '"Caveat", "Comic Sans MS", "Marker Felt", "Segoe Print", cursive' },
        cormorant: { label: 'Cormorant Garamond', css: '"Cormorant Garamond", Georgia, serif' },
        marcellus: { label: 'Marcellus', css: '"Marcellus", Georgia, serif' },
        amiri: { label: 'Amiri', css: '"Amiri", "Scheherazade New", serif', arabic: true },
        scheherazade: { label: 'Scheherazade New', css: '"Scheherazade New", "Amiri", serif', arabic: true },
        naskh: { label: 'Noto Naskh Arabic', css: '"Noto Naskh Arabic", "Amiri", serif', arabic: true },
        kufi: { label: 'Reem Kufi', css: '"Reem Kufi", "Noto Naskh Arabic", sans-serif', arabic: true },
        cairo: { label: 'Cairo', css: '"Cairo", system-ui, sans-serif', arabic: true }
    };

    const TRANSITION_LABELS = {
        none: 'None', crossfade: 'Crossfade', dip: 'Dip to black', slide: 'Slide in',
        push: 'Push', wipe: 'Wipe', zoom: 'Zoom', 'slide-up': 'Slide up',
        'wipe-right': 'Wipe from right', iris: 'Circle reveal', blur: 'Soft dissolve'
    };
    const MOTION_LABELS = {
        none: 'None', 'zoom-in': 'Slow zoom in', 'zoom-out': 'Slow zoom out', 'pan-left': 'Pan left',
        'pan-right': 'Pan right', 'pan-up': 'Pan up', 'pan-down': 'Pan down'
    };
    const ANIM_LABELS = {
        none: 'None', fade: 'Fade in', rise: 'Rise up', pop: 'Pop', slide: 'Slide in',
        typewriter: 'Typewriter', words: 'Word by word', handwrite: 'Handwriting',
        drop: 'Drop in (bounce)', 'slide-right': 'Slide in from right', 'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out (from big)',
        spin: 'Spin in', flip: 'Flip in', blur: 'Blur in', bounce: 'Bounce', swing: 'Swing'
    };
    /** Entrances for pictures, videos and the like: the movements, without the text-only reveals. */
    const ENTER_LABELS = {
        none: 'None', fade: 'Fade in', 'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out (from big)', pop: 'Pop', bounce: 'Bounce',
        rise: 'Rise up', drop: 'Drop in (bounce)', slide: 'Slide in from left', 'slide-right': 'Slide in from right',
        spin: 'Spin in', flip: 'Flip in', blur: 'Blur in', swing: 'Swing'
    };
    const EXIT_LABELS = {
        none: 'None', fade: 'Fade out', 'zoom-in': 'Shrink away', 'zoom-out': 'Grow and fade', rise: 'Sink down',
        slide: 'Slide out left', 'slide-right': 'Slide out right', spin: 'Spin out', flip: 'Flip out', blur: 'Blur out', pop: 'Pop out'
    };
    const DRAW_ANIM_LABELS = { draw: 'Draw on', fade: 'Fade in', none: 'Appear at once' };

    const ICONS = {
        play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path d="M7 4v16M17 4v16" stroke-width="3"/></svg>',
        eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
        eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>',
        sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 010 7M19 5.5a9 9 0 010 13"/></svg>',
        mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
        duck: '<svg viewBox="0 0 24 24"><path d="M3 17h18"/><path d="M5 17V9M9 17v-5M13 17v-3M17 17V8M21 17V6" /></svg>',
        close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
        music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
        warn: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>'
    };

    /* ------------------------------------------------------------------ state */

    const state = {
        project: T.createProject(),
        history: null,
        selection: [],
        selected: null,
        marker: null,
        time: 0,
        playing: false,
        pps: 40,
        snap: true,
        exporting: null,
        clipboard: null
    };
    state.history = new T.History(state.project);

    /** mediaId → { file, url, thumbnail, peaks, peakRate } for files on hand. */
    const files = new Map();
    /** clipId → { el, url, source, gain } — one media element per clip. */
    const pool = new Map();
    /** mediaId → HTMLImageElement */
    const images = new Map();
    /** Commands the modules add to the Tools menu. */
    const tools = [];

    let audio = null;
    let relinkTarget = null;
    /** The open drawing board, or null: see openDrawMode. */
    let drawMode = null;

    const canvas = $('preview');
    const ctx = canvas.getContext('2d');
    const tl = $('timeline');
    const mediaHost = $('media-host');

    /* ---------------------------------------------------------------- helpers */

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                const v = attrs[k];
                if (v === undefined || v === null || v === false) return;
                if (k === 'className') node.className = v;
                else if (k === 'text') node.textContent = v;
                else if (k === 'html') node.innerHTML = v;
                else if (k === 'style') Object.assign(node.style, v);
                else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
                else if (v === true) node.setAttribute(k, '');
                else node.setAttribute(k, v);
            });
        }
        (children || []).forEach(function (c) {
            if (c !== null && c !== undefined && c !== false) node.append(c);
        });
        return node;
    }

    let toastTimer = null;
    function toast(message, ms) {
        const t = $('toast');
        t.textContent = message;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3400);
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: filename });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    function safeName(name) {
        return (name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';
    }

    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
        return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }

    function fmt(t) {
        return T.formatTime(t, state.project.fps);
    }

    function storage(fn) {
        try { return fn(window.localStorage); } catch (err) { return null; }
    }

    /** Resolves when `event` fires on `target`; rejects on `error` or timeout. */
    function waitFor(target, event, ms) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () { done(); reject(new Error('timed out')); }, ms || 10000);
            function ok() { done(); resolve(); }
            function fail() { done(); reject(new Error('the browser cannot decode it')); }
            function done() {
                clearTimeout(timer);
                target.removeEventListener(event, ok);
                target.removeEventListener('error', fail);
            }
            target.addEventListener(event, ok);
            target.addEventListener('error', fail);
        });
    }

    function duration() {
        return T.projectDuration(state.project);
    }

    function selectedClip() {
        return state.selected ? T.getClip(state.project, state.selected) : null;
    }

    function selectedClips() {
        return state.selection.map((id) => T.getClip(state.project, id)).filter(Boolean);    }

    function headWidth() {
        return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-w')) || 132;
    }

    function smoothstep(u) {
        const x = Math.min(1, Math.max(0, u));
        return x * x * (3 - 2 * x);
    }

    /* -------------------------------------------------------------- selection */

    function selectOnly(id) {
        state.selection = id ? [id] : [];
        state.selected = id || null;
        if (id) state.marker = null;
        selectionChanged();
    }

    function toggleSelect(id) {
        const i = state.selection.indexOf(id);
        if (i === -1) state.selection.push(id);
        else state.selection.splice(i, 1);
        state.selected = state.selection.length ? state.selection[state.selection.length - 1] : null;
        selectionChanged();
    }

    function selectMany(ids) {
        state.selection = ids.slice();
        state.selected = ids.length ? ids[ids.length - 1] : null;
        selectionChanged();
    }

    function isSelected(id) {
        return state.selection.indexOf(id) !== -1;
    }

    function selectionChanged() {
        tl.querySelectorAll('.clip').forEach(function (n) {
            n.classList.toggle('selected', isSelected(n.dataset.id));
            n.classList.toggle('primary', n.dataset.id === state.selected);
        });
        tl.querySelectorAll('.marker').forEach(function (n) { n.classList.toggle('selected', n.dataset.id === state.marker); });
        renderInspector();
        updateButtons();
    }

    function pruneSelection() {
        state.selection = state.selection.filter((id) => T.getClip(state.project, id));
        if (state.selected && !T.getClip(state.project, state.selected)) state.selected = state.selection[state.selection.length - 1] || null;
        if (state.marker && !(state.project.markers || []).some((m) => m.id === state.marker)) state.marker = null;
    }

    /* ---------------------------------------------------------------- history */

    let saveTimer = null;
    function persist() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            storage(function (s) {
                s.setItem(STORAGE_KEY, T.serialize(state.project));
                s.setItem(TABS_KEY, JSON.stringify({
                    active: activeTab,
                    items: tabs.map((t, i) => ({ id: t.id, project: T.serialize(i === activeTab ? state.project : t.project) }))
                }));
            });
            if (window.ReelLibrary) window.ReelLibrary.remember();
        }, 250);
    }

    /** Records the current project as an undo step and redraws everything. */
    function commit() {
        state.history.push(state.project);
        afterChange();
    }

    /**
     * Records an edit made from an inspector control that already shows its
     * new value, without rebuilding the inspector — which would take focus
     * away from a slider mid-adjustment.
     */
    function commitQuiet() {
        if (!state.history.push(state.project)) return;
        duckDirty = true;
        persist();
        updateButtons();
        updatePlayhead(false);
    }

    /** Takes `next` as an edit if it differs from the current project. */
    function apply(next) {
        if (next === state.project) return false;
        state.project = next;
        commit();
        return true;
    }

    function afterChange() {
        pruneSelection();
        duckDirty = true;
        persist();
        prunePool();
        renderAll();
    }

    function undo() {
        const p = state.history.undo();
        if (!p) return;
        state.project = p;
        afterChange();
    }

    function redo() {
        const p = state.history.redo();
        if (!p) return;
        state.project = p;
        afterChange();
    }

    /* ------------------------------------------------------------------ audio */

    /**
     * The Web Audio graph: every clip's element → its own gain → master, and
     * master → speakers and → a stream the real-time exporter records. Made
     * on the first user gesture, since browsers start an AudioContext
     * suspended otherwise.
     */
    function audioGraph() {
        if (audio) return audio;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            const actx = new AC();
            const master = actx.createGain();
            master.connect(actx.destination);
            let dest = null;
            if (actx.createMediaStreamDestination) {
                dest = actx.createMediaStreamDestination();
                master.connect(dest);
            }
            audio = { ctx: actx, master: master, dest: dest };
            pool.forEach(connectAudio);
        } catch (err) {
            audio = null;
        }
        return audio;
    }

    function wakeAudio() {
        const a = audioGraph();
        if (a && a.ctx.state === 'suspended') a.ctx.resume().catch(function () {});
        return a;
    }

    function connectAudio(entry) {
        if (!audio || entry.gain) return;
        try {
            entry.source = audio.ctx.createMediaElementSource(entry.el);
            entry.gain = audio.ctx.createGain();
            entry.source.connect(entry.gain);
            entry.gain.connect(audio.master);
        } catch (err) {
            entry.gain = null;
        }
    }

    function setGain(entry, value) {
        const v = Math.max(0, value);
        if (entry.gain) {
            if (Math.abs(entry.gain.gain.value - v) > 1e-3) entry.gain.gain.value = v;
        } else {
            entry.el.volume = Math.min(1, v);
        }
    }

    /* ---------------------------------------------------------------- ducking */

    let duckEnv = null;
    let duckDirty = true;

    /** Loudness of a clip's source at a moment, from its waveform peaks; 1 if unknown. */
    function levelAt(clip, srcTime) {
        const f = files.get(clip.mediaId);
        if (!f || !f.peaks) return 1;
        return f.peaks[Math.floor(srcTime * f.peakRate)] || 0;
    }

    /** A function of time giving the duck gain, or null when no track is ducked. */
    function duckFn() {
        if (!state.project.tracks.some((t) => t.kind === 'audio' && t.duck)) return null;
        if (duckDirty || !duckEnv) {
            duckEnv = T.duckEnvelope(state.project, levelAt, 0.05);
            duckDirty = false;
        }
        const env = duckEnv;
        return function (t) { return T.envelopeAt(env, t); };
    }

    /* --------------------------------------------------------- media elements */

    function elementFor(clip) {
        const f = files.get(clip.mediaId);
        if (!f) return null;
        let entry = pool.get(clip.id);
        if (entry && entry.url !== f.url) { disposeEntry(entry); pool.delete(clip.id); entry = null; }
        if (entry) return entry;
        const media = T.getMedia(state.project, clip.mediaId);
        const node = document.createElement(media && media.type === 'audio' ? 'audio' : 'video');
        node.preload = 'auto';
        node.playsInline = true;
        node.preservesPitch = true;
        node.src = f.url;
        node.addEventListener('seeked', requestDraw);
        node.addEventListener('loadeddata', requestDraw);
        mediaHost.append(node);
        entry = { el: node, url: f.url, source: null, gain: null };
        connectAudio(entry);
        pool.set(clip.id, entry);
        return entry;
    }

    function disposeEntry(entry) {
        try {
            entry.el.pause();
            if (entry.source) entry.source.disconnect();
            if (entry.gain) entry.gain.disconnect();
            entry.el.removeAttribute('src');
            entry.el.load();
        } catch (err) { /* already gone */ }
        entry.el.remove();
    }

    /** Drops elements whose clip no longer exists (deleted, undone, split away). */
    function prunePool() {
        pool.forEach(function (entry, id) {
            if (!T.getClip(state.project, id)) { disposeEntry(entry); pool.delete(id); }
        });
    }

    function imageFor(mediaId) {
        const f = files.get(mediaId);
        if (!f) return null;
        let img = images.get(mediaId);
        if (img && img.dataset.url === f.url) return img;
        img = new Image();
        img.dataset.url = f.url;
        img.onload = requestDraw;
        img.src = f.url;
        images.set(mediaId, img);
        return img;
    }

    /**
     * Brings every media element in line with timeline time `t`. Paused, that
     * means seeking each clip to its frame. Playing, it means starting the
     * ones that should be heard or seen at their clip's speed, holding freeze
     * frames and clips waiting at the edge of a transition, pausing the rest,
     * correcting drift, and seeking upcoming clips ahead of time so cuts
     * land clean.
     *
     * Returns true while a clip that should be playing is still loading or
     * seeking, so the clock can wait for it instead of running ahead.
     */
    function syncMedia(t, playing) {
        const p = state.project;
        const list = T.mediaAt(p, t).filter((m) => files.has(m.clip.mediaId));
        const ids = new Set(list.map((m) => m.clip.id));
        const gains = new Map(T.audibleClips(p, t, duckFn()).map((a) => [a.clip.id, a.gain]));
        const halfFrame = 0.5 / p.fps;

        pool.forEach(function (entry, id) {
            if (!ids.has(id) && !entry.el.paused) entry.el.pause();
        });

        const entries = [];
        list.forEach(function (m) {
            const e = elementFor(m.clip);
            if (!e) return;
            const raw = T.sourceTime(m.clip, t);
            const len = T.sourceLength(p, m.clip);
            const hold = !m.playing || raw < 0 || (isFinite(len) && raw > len - 0.05);
            entries.push({ m: m, e: e, hold: hold, rate: T.speedOf(m.clip) });
        });

        let stalled = false;
        entries.forEach(function (x) {
            setGain(x.e, x.hold ? 0 : (gains.get(x.m.clip.id) || 0));
            if (x.e.el.playbackRate !== x.rate) x.e.el.playbackRate = x.rate;
            const node = x.e.el;
            if (playing && !x.hold && !node.error && !node.ended && (node.seeking || node.readyState < 3)) stalled = true;
        });

        entries.forEach(function (x) {
            const node = x.e.el;
            const target = x.m.sourceTime;
            const off = Math.abs(node.currentTime - target);
            if (!playing || stalled || x.hold) {
                if (!node.paused && (!playing || x.hold || node.readyState >= 3)) node.pause();
                if (!node.seeking && off > (playing && !x.hold ? 0.1 : halfFrame)) node.currentTime = target;
                return;
            }
            if (node.paused) {
                if (off > 0.1) node.currentTime = target;
                const started = node.play();
                if (started && started.catch) started.catch(function () {});
            } else if (off > DRIFT * Math.max(1, x.rate)) {
                node.currentTime = target;
            }
        });

        if (playing) {
            // Seek what is coming up to where it will first be needed.
            T.mediaAt(p, t + 1.2).forEach(function (m) {
                if (ids.has(m.clip.id) || !m.playing || !files.has(m.clip.mediaId)) return;
                const e = elementFor(m.clip);
                if (!e || !e.el.paused || e.el.seeking) return;
                const first = Math.max(0, T.sourceTime(m.clip, Math.max(t, T.soundWindow(p, m.clip).start)));
                if (Math.abs(e.el.currentTime - first) > 0.05) e.el.currentTime = first;
            });
        }
        return stalled;
    }

    /* ------------------------------------------------------------------ fonts */

    const fontState = new Map();

    function fontCss(clip, size) {
        const f = FONTS[clip.font] || FONTS.sans;
        return (clip.italic ? 'italic ' : '') + (clip.bold ? '700 ' : '400 ') + size + 'px ' + f.css;
    }

    /** Starts loading a web font the first time it is drawn, then redraws with it. */
    function ensureFont(css) {
        if (fontState.has(css) || !document.fonts || !document.fonts.load) return;
        fontState.set(css, 'loading');
        document.fonts.load(css, 'بسم Abc').then(function () {
            fontState.set(css, 'ok');
            requestDraw();
        }).catch(function () { fontState.set(css, 'failed'); });
    }

    /** Waits (briefly) for every font the titles use, so an export never draws a fallback. */
    function fontsReady(project) {
        if (!document.fonts || !document.fonts.load) return Promise.resolve();
        const wanted = new Set();
        (project || state.project).clips.forEach(function (c) {
            if (c.type === 'text') wanted.add(fontCss(c, 40));
        });
        const loads = Array.from(wanted).map((css) => document.fonts.load(css, 'بسم Abc').catch(() => null));
        return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 6000))]);
    }

    /* ---------------------------------------------------------------- preview */

    let drawQueued = false;
    function requestDraw() {
        if (drawQueued || state.playing) return;
        drawQueued = true;
        requestAnimationFrame(function () {
            drawQueued = false;
            if (state.playing || state.exporting) return;
            syncMedia(state.time, false);
            drawFrame(state.time);
        });
    }

    /** What the live preview draws a clip from: its media element or image. */
    function liveSource(clip, kind) {
        if (kind === 'image') {
            const img = imageFor(clip.mediaId);
            return img && img.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
        }
        const e = elementFor(clip);
        return e && e.el.readyState >= 2 && e.el.videoWidth ? { src: e.el, w: e.el.videoWidth, h: e.el.videoHeight } : null;
    }

    /**
     * Draws the frame at `t`. The exporter passes its own canvas context and
     * a `source` function that hands over decoded frames instead of the
     * preview's media elements.
     */
    function drawFrame(t, opts) {
        const o = opts || {};
        const p = state.project;
        const W = p.width;
        const H = p.height;
        const c = o.ctx || ctx;
        if (!o.ctx && (canvas.width !== W || canvas.height !== H)) {
            canvas.width = W;
            canvas.height = H;
            fitCanvas();
        }
        const source = o.source || liveSource;
        c.save();
        c.globalAlpha = 1;
        c.filter = 'none';
        c.fillStyle = p.background || '#000';
        c.fillRect(0, 0, W, H);
        T.renderLayers(p, t).forEach(function (layer) {
            if (layer.alpha <= 0) return;
            c.save();
            c.globalAlpha = layer.alpha;
            if (layer.transition) applyTransition(c, layer.transition, W, H);
            const kf = T.keyframeAt(layer.clip, t);
            if (kf) layer = keyframed(c, layer, kf, W, H);
            if (layer.kind !== 'text' || layer.clip.type === 'draw' || layer.clip.sticker) applyMove(c, layer.clip, t, W, H);
            if (layer.clip.sticker && window.ReelEffects) window.ReelEffects.sticker(c, layer.clip, t, W, H);            else if (layer.clip.type === 'draw') drawDrawing(c, layer.clip, t, W, H, source);
            else if (layer.kind === 'text') drawText(c, layer.clip, t, W, H);
            else drawVisual(c, layer.clip, layer.kind, t, W, H, source);
            moveBlur = 0;
            c.restore();
        });
        if (p.progressBar) {
            // A thin bar along the bottom that fills as the video plays (for Shorts).
            const total = T.projectDuration(p);
            const h = Math.max(4, Math.round(H * 0.007));
            c.globalAlpha = 1;
            c.fillStyle = 'rgba(255,255,255,.25)';
            c.fillRect(0, H - h, W, h);
            c.fillStyle = p.progressBar.color || '#f2b84b';
            c.fillRect(0, H - h, total > 0 ? W * T.clamp(t / total, 0, 1) : 0, h);
        }
        if (p.brandLogo && p.brandLogo.src) drawBrandLogo(c, p.brandLogo, W, H);
        if (p.watermark !== false || !mayRemoveWatermark) drawWatermark(c, W, H);
        c.restore();
    }

    /**
     * A layer as its keyframes have it at this moment: moved, resized and
     * faded by drawing a copy of its clip with those values, and turned
     * about its own centre.
     */
    function keyframed(c, layer, kf, W, H) {
        const clip = layer.clip;
        const own = clip.opacity === undefined ? 1 : clip.opacity;
        c.globalAlpha = own > 0 ? layer.alpha * kf.opacity / own : layer.alpha * kf.opacity;
        const copy = Object.assign({}, clip, { x: kf.x, y: kf.y, scale: kf.scale, opacity: kf.opacity });
        if (kf.rotate || (clip.type === 'text' && kf.scale !== 1)) {
            c.translate(kf.x * W, kf.y * H);
            if (kf.rotate) c.rotate(kf.rotate * Math.PI / 180);
            if (clip.type === 'text') c.scale(kf.scale, kf.scale);
            c.translate(-kf.x * W, -kf.y * H);
        }
        return Object.assign({}, layer, { clip: copy });
    }

    /** Blur from a picture's entrance or exit, added to its own filters in drawVisual. */
    let moveBlur = 0;

    /** Moves, turns, scales and fades a picture, video, drawing or sticker for its entrance and exit. */
    function applyMove(c, clip, t, W, H) {
        const m = T.clipMoveAt(clip, t);
        if (T.isStill(m)) return;
        c.globalAlpha *= m.alpha;
        const cx = (clip.x === undefined ? 0.5 : clip.x) * W;
        const cy = (clip.y === undefined ? 0.5 : clip.y) * H;
        c.translate(cx + m.dx * W, cy + m.dy * H);
        if (m.rotate) c.rotate(m.rotate);
        c.scale(m.scale * m.scaleX, m.scale);
        c.translate(-cx, -cy);
        moveBlur = m.blur * H / 720;
    }

    const brandImages = new Map();

    /** Your logo from the brand kit, in its corner on every frame. */
    function drawBrandLogo(c, logo, W, H) {
        let img = brandImages.get(logo.src);
        if (!img) {
            img = new Image();
            img.onload = requestDraw;
            img.src = logo.src;
            brandImages.set(logo.src, img);
        }
        if (!img.complete || !img.naturalWidth) return;
        const short = Math.min(W, H);
        const w = short * (logo.size > 0 ? logo.size : 0.14);
        const h = w * img.naturalHeight / img.naturalWidth;
        const m = short * 0.035;
        const pos = logo.pos || 'tr';
        const x = pos.indexOf('l') !== -1 ? m : W - m - w;
        // The watermark sits in the top-right corner, so a logo there goes just below it.
        const y = pos.indexOf('t') === 0 ? m + (pos === 'tr' && watermarkOn() ? short * 0.06 : 0) : H - m - h;
        c.save();
        c.globalAlpha = logo.opacity > 0 ? logo.opacity : 0.9;
        c.drawImage(img, x, y, w, h);
        c.restore();
    }

    /*
     * What the site hosting the editor can set before loading it, as
     * window.REEL_CONFIG = {
     *   watermark: 'NoorEditor.web.app',      // the text in the corner
     *   siteUrl: 'https://nooreditor.web.app', // shared with exported videos
     *   canRemoveWatermark: () => bool | Promise<bool>,  // e.g. a paid plan
     *   upgrade: (reason) => {},              // shows the host's upgrade offer
     *   features: { readAloud: false }        // switch tools off
     * }. Call ReelApp.refreshPlan() when the visitor's plan changes.
     */
    const CONFIG = Object.assign({ watermark: 'NoorEditor.web.app', siteUrl: 'https://nooreditor.web.app', canRemoveWatermark: null, upgrade: null, features: {} }, window.REEL_CONFIG || {});
    let mayRemoveWatermark = !CONFIG.canRemoveWatermark;
    function refreshPlan() {
        if (!CONFIG.canRemoveWatermark) return Promise.resolve(true);
        return Promise.resolve().then(CONFIG.canRemoveWatermark).catch(() => false).then(function (ok) {
            mayRemoveWatermark = !!ok;
            requestDraw();
            if ($('export-watermark')) $('export-watermark').checked = watermarkOn();
            return mayRemoveWatermark;
        });
    }

    /** Whether the mark is drawn: always while the host says it may not be removed. */
    function watermarkOn() {
        return state.project.watermark !== false || !mayRemoveWatermark;
    }

    const WATERMARK = CONFIG.watermark;

    /** The site's mark (NoorEditor.web.app) in the top-right corner; it can be turned off per project. */
    function drawWatermark(c, W, H) {
        const size = Math.max(10, Math.round(Math.min(W, H) * 0.034));
        const m = Math.round(size * 0.9);
        c.save();
        c.globalAlpha = 0.78;
        c.font = '700 ' + size + 'px ' + FONTS.sans.css;
        c.textAlign = 'right';
        c.textBaseline = 'top';
        c.direction = 'ltr';
        c.shadowColor = 'rgba(0,0,0,.55)';
        c.shadowBlur = size * 0.35;
        c.shadowOffsetY = size * 0.06;
        c.fillStyle = '#ffffff';
        c.fillText(WATERMARK, W - m, m);
        c.restore();
    }

    async function setWatermark(on) {
        if (!on && CONFIG.canRemoveWatermark && !(await refreshPlan())) {
            // Not on a plan that removes it: keep it, and show the host's offer.
            renderInspector();
            if ($('export-watermark')) $('export-watermark').checked = true;
            if (CONFIG.upgrade) CONFIG.upgrade('watermark'); else toast('The watermark cannot be removed on this plan.');
            return;
        }
        if ((state.project.watermark !== false) !== on) {
            const next = T.clone(state.project);
            next.watermark = on;
            apply(next);
        }
        if ($('export-watermark')) $('export-watermark').checked = watermarkOn();
    }

    /** Moves, clips or scales a transition's layer on its way in or out. */
    function applyTransition(c, tr, W, H) {
        const e = smoothstep(tr.progress);
        if (tr.type === 'slide' && tr.role === 'to') {
            c.translate((1 - e) * W, 0);
        } else if (tr.type === 'push') {
            c.translate(tr.role === 'to' ? (1 - e) * W : -e * W, 0);
        } else if (tr.type === 'wipe' && tr.role === 'to') {
            c.beginPath();
            c.rect(0, 0, e * W, H);
            c.clip();
        } else if (tr.type === 'wipe-right' && tr.role === 'to') {
            c.beginPath(); c.rect((1-e)*W, 0, e*W, H); c.clip();
        } else if (tr.type === 'slide-up' && tr.role === 'to') {
            c.translate(0, (1-e)*H);
        } else if (tr.type === 'iris' && tr.role === 'to') {
            c.beginPath(); c.arc(W/2, H/2, e*Math.hypot(W,H)/2, 0, Math.PI*2); c.clip();
        } else if (tr.type === 'blur') {
            // A gentle scale dissolve also works on browsers without canvas filters.
            const scale = tr.role === 'to' ? 1.06-.06*e : 1+.06*e;
            c.translate(W/2,H/2); c.scale(scale,scale); c.translate(-W/2,-H/2);
        } else if (tr.type === 'zoom') {
            const s = tr.role === 'to' ? 1.25 - 0.25 * e : 1 + 0.25 * e;
            c.translate(W / 2, H / 2);
            c.scale(s, s);
            c.translate(-W / 2, -H / 2);
        }
    }

    /** A rounded-rectangle path, built with arcs so it works where Path2D.roundRect does not. */
    function roundedPath(x, y, w, h, r) {
        const p = new Path2D();
        const rr = Math.max(0, Math.min(r, w / 2, h / 2));
        if (!rr) { p.rect(x, y, w, h); return p; }
        p.moveTo(x + rr, y);
        p.arcTo(x + w, y, x + w, y + h, rr);
        p.arcTo(x + w, y + h, x, y + h, rr);
        p.arcTo(x, y + h, x, y, rr);
        p.arcTo(x, y, x + w, y, rr);
        p.closePath();
        return p;
    }

    // Film grain: one fixed tile of noise, shifted each frame (the same shift for the same
    // frame, so preview and export match).
    let noiseCanvas = null;
    const noisePatterns = new WeakMap();
    function noisePattern(c) {
        if (!noiseCanvas) {
            noiseCanvas = document.createElement('canvas');
            noiseCanvas.width = noiseCanvas.height = 160;
            const x = noiseCanvas.getContext('2d');
            const img = x.createImageData(160, 160);
            let seed = 1234567;
            for (let i = 0; i < img.data.length; i += 4) {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                img.data[i] = img.data[i + 1] = img.data[i + 2] = seed % 256;
                img.data[i + 3] = 255;
            }
            x.putImageData(img, 0, 0);
        }
        let pattern = noisePatterns.get(c);
        if (!pattern) { pattern = c.createPattern(noiseCanvas, 'repeat'); noisePatterns.set(c, pattern); }
        return pattern;
    }

    let pixelCanvas = null;

    /**
     * Blurs, pixelates or covers an area of a picture — for faces, number
     * plates or logos. The area is in the picture's own coordinates, so it
     * moves, scales, flips and rotates with it.
     */
    function drawHidden(c, s, cr, hide, x, y, w, h, outline) {
        const aw = hide.w * w;
        const ah = hide.h * h;
        const ax = x + hide.x * w - aw / 2;
        const ay = y + hide.y * h - ah / 2;
        const shape = new Path2D();
        if (hide.shape === 'rect') shape.rect(ax, ay, aw, ah);
        else shape.ellipse(ax + aw / 2, ay + ah / 2, Math.abs(aw / 2), Math.abs(ah / 2), 0, 0, Math.PI * 2);
        const strength = hide.strength === undefined ? 0.6 : hide.strength;
        c.save();
        c.clip(shape);
        if (hide.mode === 'solid') {
            c.fillStyle = hide.color || '#000000';
            c.fillRect(ax, ay, aw, ah);
        } else if (hide.mode === 'pixelate') {
            const block = Math.max(3, Math.min(aw, ah) * (0.04 + strength * 0.16));
            const tw = Math.max(1, Math.round(aw / block));
            const th = Math.max(1, Math.round(ah / block));
            if (!pixelCanvas) pixelCanvas = document.createElement('canvas');
            pixelCanvas.width = tw;
            pixelCanvas.height = th;
            const px = pixelCanvas.getContext('2d');
            px.drawImage(s.src, cr.sx + (ax - x) / w * cr.sw, cr.sy + (ay - y) / h * cr.sh, aw / w * cr.sw, ah / h * cr.sh, 0, 0, tw, th);
            const smooth = c.imageSmoothingEnabled;
            c.imageSmoothingEnabled = false;
            c.drawImage(pixelCanvas, ax, ay, aw, ah);
            c.imageSmoothingEnabled = smooth;
        } else {
            c.filter = 'blur(' + Math.max(3, Math.min(aw, ah) * (0.03 + strength * 0.12)).toFixed(1) + 'px)';
            c.drawImage(s.src, cr.sx, cr.sy, cr.sw, cr.sh, x, y, w, h);
            c.filter = 'none';
        }
        c.restore();
        if (outline) {
            c.save();
            c.setLineDash([8, 6]);
            c.lineWidth = 2;
            c.strokeStyle = '#f2b84b';
            c.stroke(shape);
            c.restore();
        }
    }

    /**
     * Draws a picture with its effects: crop, pan and zoom, rotation, mirror,
     * colour, hidden area, tint, vignette, grain, rounded corners, border and
     * shadow. Everything past the colour filter is clipped to the picture's
     * frame, so effects never spill onto the layers below.
     */
    function drawVisual(c, clip, kind, t, W, H, source) {
        if (!files.has(clip.mediaId)) { drawOffline(c, clip, W, H); return; }
        let s = source(clip, kind);
        if (!s) return;
        if (clip.cutout && window.ReelEffects) s = window.ReelEffects.processBackground(s, clip, t);
        const fx = T.fxOf(clip);
        const cr = T.cropRect(s.w, s.h, fx.crop);
        const m = T.motionAt(clip, t);
        if (clip.bgFill === 'blur' && clip.fit !== 'cover') {
            // A blurred, darkened copy filling the frame behind the picture.
            const b = T.placeRect(cr.sw, cr.sh, W, H, 'cover', 1.1, 0.5, 0.5);
            c.filter = 'blur(' + Math.round(H * 0.035) + 'px) brightness(0.62)';
            c.drawImage(s.src, cr.sx, cr.sy, cr.sw, cr.sh, b.x, b.y, b.w, b.h);
            c.filter = 'none';
        }
        const r = T.placeRect(cr.sw, cr.sh, W, H, clip.fit, (clip.scale || 1) * m.scale,
            (clip.x === undefined ? 0.5 : clip.x) + m.dx, (clip.y === undefined ? 0.5 : clip.y) + m.dy);
        const hw = r.w / 2;
        const hh = r.h / 2;
        const unit = Math.min(W, H);
        c.save();
        c.translate(r.x + hw, r.y + hh);
        if (fx.rotate) c.rotate(fx.rotate * Math.PI / 180);
        const corner = fx.radius * Math.min(hw, hh);
        const frame = roundedPath(-hw, -hh, r.w, r.h, corner);
        if (fx.shadow) {
            c.save();
            c.shadowColor = 'rgba(0,0,0,.6)';
            c.shadowBlur = unit * 0.035;
            c.shadowOffsetY = unit * 0.012;
            c.fillStyle = '#000';
            c.fill(frame);
            c.restore();
        }
        c.save();
        c.clip(frame);
        c.save();
        c.scale(fx.flipH ? -1 : 1, fx.flipV ? -1 : 1);
        const looks = T.filterString(clip.filters);
        c.filter = moveBlur > 0.2 ? (looks === 'none' ? '' : looks + ' ') + 'blur(' + moveBlur.toFixed(1) + 'px)' : looks;
        c.drawImage(s.src, cr.sx, cr.sy, cr.sw, cr.sh, -hw, -hh, r.w, r.h);
        c.filter = 'none';
        if (fx.hide) drawHidden(c, s, cr, fx.hide, -hw, -hh, r.w, r.h, source === liveSource && clip.id === state.selected);
        c.restore();
        if (fx.tint && fx.tint.amount > 0) {
            c.save();
            c.globalCompositeOperation = 'soft-light';
            c.globalAlpha *= Math.min(1, fx.tint.amount * 1.6);
            c.fillStyle = fx.tint.color || '#ff9a3c';
            c.fillRect(-hw, -hh, r.w, r.h);
            c.restore();
        }
        if (fx.vignette > 0) {
            const g = c.createRadialGradient(0, 0, Math.min(hw, hh) * 0.45, 0, 0, Math.hypot(hw, hh));
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,' + Math.min(1, fx.vignette) + ')');
            c.fillStyle = g;
            c.fillRect(-hw, -hh, r.w, r.h);
        }
        if (fx.grain > 0) {
            const ox = (Math.floor(t * state.project.fps) * 53) % 160;
            const oy = (ox * 7) % 160;
            c.save();
            c.globalCompositeOperation = 'overlay';
            c.globalAlpha *= Math.min(1, fx.grain * 0.8);
            c.translate(-ox, -oy);
            c.fillStyle = noisePattern(c);
            c.fillRect(-hw + ox, -hh + oy, r.w, r.h);
            c.restore();
        }
        c.restore();        if (fx.border.width > 0) {
            const bw = fx.border.width * H / 720;
            c.lineWidth = bw;
            c.strokeStyle = fx.border.color || '#ffffff';
            c.stroke(roundedPath(-hw + bw / 2, -hh + bw / 2, r.w - bw, r.h - bw, Math.max(0, corner - bw / 2)));
        }
        c.restore();
    }

    function drawOffline(c, clip, W, H) {
        const media = T.getMedia(state.project, clip.mediaId);
        const r = T.placeRect(media && media.width || W, media && media.height || H, W, H, clip.fit, clip.scale, clip.x, clip.y);
        c.fillStyle = '#2a2213';
        c.fillRect(r.x, r.y, r.w, r.h);
        c.fillStyle = '#f2b84b';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const size = Math.max(14, Math.round(Math.min(r.w, r.h) / 14));
        c.font = '600 ' + size + 'px ' + FONTS.sans.css;
        c.fillText('Media offline', r.x + r.w / 2, r.y + r.h / 2 - size * 0.7);
        c.font = size * 0.7 + 'px ' + FONTS.sans.css;
        c.fillText(media ? media.name : '', r.x + r.w / 2, r.y + r.h / 2 + size * 0.6);
    }

    /**
     * The width a line really covers: the larger of its advance width and
     * its ink, since Arabic marks and swashes can reach past the advance.
     */
    function lineWidth(c, text) {
        const m = c.measureText(text);
        const ink = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0);
        return Math.max(m.width, ink);
    }

    /** Word-wraps each paragraph to `maxWidth` using the context's current font. */
    function wrapLines(c, text, maxWidth) {
        const out = [];
        String(text).split('\n').forEach(function (para) {
            const words = para.split(/(\s+)/);
            let line = '';
            words.forEach(function (w) {
                const next = line + w;
                if (line.trim() && lineWidth(c, next) > maxWidth) {
                    out.push(line.trimEnd());
                    line = w.trimStart();
                } else {
                    line = next;
                }
            });
            out.push(line);
        });
        return out;
    }

    /**
     * Wraps a title to the frame, and if a single word is still too wide,
     * makes the whole title smaller until it fits — a title never runs off
     * the edge.
     */
    function layoutText(c, clip, text, size, W) {
        const maxW = W * 0.9;
        let s = size;
        for (let tries = 0; tries < 4; tries += 1) {
            c.font = fontCss(clip, s);
            const lines = wrapLines(c, text, maxW);
            const widths = lines.map((l) => lineWidth(c, l));
            const widest = Math.max.apply(null, widths);
            if (widest <= maxW * 1.001 || s < 8) return { size: s, lines: lines, widths: widths };
            s = Math.max(8, s * maxW / widest * 0.98);
        }
        c.font = fontCss(clip, s);
        const lines = wrapLines(c, text, maxW);
        return { size: s, lines: lines, widths: lines.map((l) => lineWidth(c, l)) };
    }

    /**
     * Draws a title. Every line is drawn centred on its own middle — the one
     * alignment every browser treats the same for right-to-left text — and
     * typewriter and word-by-word reveals are a clip that grows from the
     * reading start (the right for Arabic), so nothing depends on how a
     * browser aligns partial right-to-left strings.
     */
    function drawText(c, clip, t, W, H) {
        const text = String(clip.text || '');
        if (!text.trim()) return;
        const anim = T.textAnimAt(clip, t);
        c.globalAlpha *= anim.alpha;
        ensureFont(fontCss(clip, 40));
        const rtl = T.isArabic(text);
        c.direction = rtl ? 'rtl' : 'ltr';
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        // Sizes are authored against a 720-line frame and scale with it.
        const lay = layoutText(c, clip, text, clip.fontSize * (H / 720), W);
        const size = lay.size;
        const lines = lay.lines;
        const widths = lay.widths;
        const lineH = size * (rtl ? 1.6 : 1.22);
        const blockW = Math.max.apply(null, widths);
        const blockH = lines.length * lineH;
        const cx = (clip.x + anim.dx) * W;
        const cy = (clip.y + anim.dy) * H;
        const top = cy - blockH / 2;

        if (anim.scale !== 1 || anim.rotate || (anim.scaleX !== undefined && anim.scaleX !== 1)) {
            c.translate(cx, cy);
            if (anim.rotate) c.rotate(anim.rotate);
            c.scale(anim.scale * (anim.scaleX === undefined ? 1 : anim.scaleX), anim.scale);
            c.translate(-cx, -cy);
        }
        if (anim.blur > 0.2) c.filter = 'blur(' + (anim.blur * H / 720).toFixed(1) + 'px)';
        if (clip.box) {
            const padX = size * 0.4;
            const padY = size * 0.2;
            c.fillStyle = clip.boxColor || '#000';
            c.beginPath();
            const bx = cx - blockW / 2 - padX;
            const by = top - padY;
            if (c.roundRect) c.roundRect(bx, by, blockW + padX * 2, blockH + padY * 2, size * 0.15);
            else c.rect(bx, by, blockW + padX * 2, blockH + padY * 2);
            c.fill();
        }
        if (clip.shadow) {
            c.shadowColor = 'rgba(0,0,0,.65)';
            c.shadowBlur = size * 0.12;
            c.shadowOffsetY = size * 0.04;
        }
        // A coloured glow (neon looks) in place of the dark shadow.
        if (clip.glow) {
            c.shadowColor = clip.glow;
            c.shadowBlur = size * 0.42;
            c.shadowOffsetY = 0;
        }
        c.fillStyle = clip.color || '#fff';
        const outline = clip.outline && clip.outline.width > 0 ? clip.outline : null;
        if (outline) {
            c.lineJoin = 'round';
            c.lineWidth = outline.width * 2 * H / 720;
            c.strokeStyle = outline.color || '#000000';
        }
        // Karaoke timing is deterministic, so seeking and export agree.
        const lyricWords = clip.lyricStyle === 'karaoke' ? text.trim().split(/\s+/).length : 0;
        const syncedTimes = Array.isArray(clip.lyricWordTimes) && clip.lyricSourceText === text ? clip.lyricWordTimes : null;
        let lyricBudget = lyricWords ? (syncedTimes ? syncedTimes.filter(at => at <= t-clip.start).length : Math.min(lyricWords, Math.floor(Math.max(0,t-clip.start) / clip.duration * lyricWords) + 1)) : 0;
        // An outline is stroked first; the fill covers its inner half.
        const paint = function (line, x, y) {
            if (outline) c.strokeText(line, x, y);
            c.fillText(line, x, y);
            if (lyricWords) {
                const words = line.trim().split(/\s+/);
                const count = Math.max(0, Math.min(words.length, lyricBudget));
                lyricBudget -= words.length;
                if (count) {
                    const width = lineWidth(c,line), shown = count === words.length ? width : lineWidth(c,words.slice(0,count).join(' '));
                    c.save(); c.beginPath();
                    c.rect(rtl ? x+width/2-shown : x-width/2, y-lineH/2, shown+1, lineH);
                    c.clip(); c.fillStyle=clip.lyricHighlight || '#f2d27a'; c.fillText(line,x,y); c.restore();
                }
            }
        };

        // How much of the text the reveal animation shows, in characters, words or width.
        let budget = Infinity;
        let units = 0;
        if (anim.unit === 'chars') units = lines.join('').length;
        else if (anim.unit === 'words') units = lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0);
        else if (anim.unit === 'width') units = widths.reduce((a, b) => a + b, 0);
        if (anim.unit === 'width') budget = units * anim.reveal;
        else if (units) budget = Math.ceil(units * anim.reveal);
        // Where the writing has got to, for the hand.
        let tip = null;
        lines.forEach(function (line, i) {
            const w = widths[i];
            const left = clip.align === 'left' ? cx - blockW / 2 : clip.align === 'right' ? cx + blockW / 2 - w : cx - w / 2;
            const mid = left + w / 2;
            const y = top + lineH * (i + 0.5);
            if (budget === Infinity) {
                paint(line, mid, y);
                return;
            }
            const lineEnd = { x: rtl ? left : left + w, y: y };
            if (anim.unit === 'width') {
                if (budget <= 0) return;
                if (clip.handStyle === 'realistic' && window.ReelInk) {
                    const shown = Math.min(1, budget / Math.max(1,w));
                    const traced = window.ReelInk.drawLine(c, {
                        line: line, font: c.font, width: w, size: size, lineHeight: lineH,
                        rtl: rtl, x: mid, y: y, reveal: shown, color: clip.color || '#fff',
                        outline: outline ? {width:outline.width*H/720,color:outline.color} : null
                    });
                    if (traced) tip = traced;
                    budget -= w;
                    return;
                }
                if (budget >= w) { paint(line, mid, y); budget -= w; tip = lineEnd; return; }
                revealPart(budget);
                budget = 0;
                return;
            }
            // The part revealed so far, as a prefix of the line in reading order.
            let prefix = line;
            if (anim.unit === 'chars') {
                prefix = line.slice(0, Math.max(0, budget));
                budget -= line.length;
            } else {
                let out = '';
                line.split(/(\s+)/).forEach(function (part) {
                    if (!part.trim()) { if (budget > 0) out += part; return; }                    if (budget > 0) out += part;
                    budget -= 1;
                });
                prefix = out.trimEnd();
            }
            if (!prefix) return;
            if (prefix.length >= line.length) { paint(line, mid, y); tip = lineEnd; return; }
            // Show that much of the full line, measured from its reading start.
            revealPart(Math.min(w, lineWidth(c, prefix)));

            function revealPart(shown) {
                const pad = size * 0.6;
                c.save();
                c.beginPath();
                if (rtl) c.rect(left + w - shown - 1, y - lineH, shown + pad + 1, lineH * 2);
                else c.rect(left - pad, y - lineH, shown + pad + 1, lineH * 2);
                c.clip();
                paint(line, mid, y);
                c.restore();
                tip = { x: rtl ? left + w - shown : left + shown, y: y };
            }
        });
        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;

        const hand = T.handOf(clip);
        if (hand && tip && anim.exit < 1) {
            const local = Math.max(0, t - clip.start);
            if (hand.tool === 'finger') {
                const px = Math.min(H * 0.55, Math.max(H * 0.12, size * 2.6)) * hand.size;
                // A tap as each letter or word appears, then the finger lifts.
                const frac = (units * anim.reveal) % 1;
                const press = anim.reveal >= 1 ? 0 : Math.max(0, 1 - frac * 2.5);
                drawHand(c, hand, tip.x, tip.y + lineH * 0.5, px, anim.exit, W, H, { press: press });
            } else {
                // The pen moves up and down through the letters as it writes.
                const writing = anim.reveal < 1;
                const bob = writing && !tip.traced ? Math.sin(local * 23) * size * 0.22 : 0;
                // `px` is the pencil's length: about two and a half letters tall.
                const px = Math.min(H * 0.45, Math.max(H * 0.1, size * 2.6)) * hand.size;
                drawHand(c, hand, tip.x, tip.y + (tip.traced ? 0 : size * 0.1) + bob, px, anim.exit, W, H,
                    { angle: writing ? Math.sin(local * 9) * 0.03 : 0, ink: clip.color });
            }
        }
    }

    /**
     * Draws the hand with its point at (x, y). As it leaves (`exit` 0 → 1)
     * it slides off to the bottom right and fades.
     */
    function drawHand(c, hand, x, y, px, exit, W, H, o) {
        if (!window.ReelHands || exit >= 1) return;
        const e = exit * exit;
        c.save();
        c.shadowColor = 'transparent';
        c.globalAlpha *= 1 - exit;
        window.ReelHands.draw(c, {
            x: x + e * W * 0.45, y: y + e * H * 0.55, size: px,
            tool: hand.tool, style: hand.style, skin: hand.skin, ink: hand.pen || (o && o.ink),
            press: o && o.press, angle: (o && o.angle) || 0
        });
        c.restore();
    }

    /** Paints drawing strokes, smoothed through their points. */
    function paintStrokes(c, strokes, W, H) {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        strokes.forEach(function (s) {
            const pts = s.points || [];
            if (pts.length < 2) return;
            const lw = Math.max(0.5, (s.width || 6) * H / 720);
            c.save();
            c.globalAlpha *= s.alpha === undefined ? 1 : s.alpha;
            const n = pts.length;
            if (n === 2 || (n === 4 && pts[0] === pts[2] && pts[1] === pts[3])) {
                c.beginPath();
                c.arc(pts[0] * W, pts[1] * H, lw / 2, 0, Math.PI * 2);
                c.fillStyle = s.color || '#ffffff';
                c.fill();
                c.restore();
                return;
            }
            c.strokeStyle = s.color || '#ffffff';
            c.lineWidth = lw;
            c.beginPath();
            c.moveTo(pts[0] * W, pts[1] * H);
            if (s.straight || n <= 4) {
                for (let i = 2; i < n; i += 2) c.lineTo(pts[i] * W, pts[i + 1] * H);
            } else {
                for (let i = 2; i < n - 2; i += 2) {
                    const mx = (pts[i] + pts[i + 2]) / 2;
                    const my = (pts[i + 1] + pts[i + 3]) / 2;
                    c.quadraticCurveTo(pts[i] * W, pts[i + 1] * H, mx * W, my * H);
                }
                c.lineTo(pts[n - 2] * W, pts[n - 1] * H);
            }
            c.stroke();
            c.restore();
        });
    }

    /** Where a point of a drawing lands on the frame, after the clip's position and scale. */
    function drawingToFrame(clip, x, y, W, H) {
        const sc = clip.scale || 1;
        return { x: clip.x * W + (x * W - W / 2) * sc, y: clip.y * H + (y * H - H / 2) * sc };
    }

    /** How big the drawing hand is at 100%, as a share of the frame's height. */
    const DRAW_HAND = 0.5;

    /** A drawing clip, drawn on stroke by stroke, with the hand at the pen's point. */
    function drawDrawing(c, clip, t, W, H, source) {
        if (drawMode && drawMode.clipId === clip.id && source === liveSource) return;
        const anim = T.drawAnimAt(clip, t);
        c.globalAlpha *= anim.alpha;
        const sc = clip.scale || 1;
        const r = T.revealStrokes(clip.strokes || [], anim.reveal, W / H);
        c.save();
        c.translate(clip.x * W, clip.y * H);
        c.scale(sc, sc);
        c.translate(-W / 2, -H / 2);
        paintStrokes(c, r.strokes, W, H);
        c.restore();
        const hand = T.handOf(clip);
        if (hand && r.tip && anim.exit < 1) {
            const at = drawingToFrame(clip, r.tip.x, r.tip.y, W, H);
            const local = Math.max(0, t - clip.start);
            const inking = r.strokes[r.strokes.length - 1];
            drawHand(c, hand, at.x, at.y, H * DRAW_HAND * hand.size, anim.exit, W, H,
                { angle: anim.reveal < 1 ? Math.sin(local * 7) * 0.04 : 0, ink: inking && inking.color });
        }
    }

    // Frame-space bounds shared by preview selection and direct manipulation.
    function previewBounds(clip) {
        const p=state.project,W=p.width,H=p.height,t=state.time;
        if(clip.type==='text'){
            ctx.save();const lay=layoutText(ctx,clip,String(clip.text||''),clip.fontSize*H/720,W);ctx.restore();
            const a=T.textAnimAt(clip,t),w=Math.max(12,...lay.widths)*a.scale,h=lay.lines.length*lay.size*(T.isArabic(clip.text)?1.6:1.22)*a.scale;
            return {x:(clip.x+a.dx)*W-w/2,y:(clip.y+a.dy)*H-h/2,w,h};
        }
        if(clip.sticker){const s=Math.min(W,H)*.17*(clip.scale||1)*1.25;return {x:clip.x*W-s/2,y:clip.y*H-s/2,w:s,h:s};}
        if(clip.type==='draw'){
            const points=(clip.strokes||[]).flatMap(s=>s.points||[]);if(!points.length)return null;
            const xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1),sc=clip.scale||1;
            const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
            return {x:(clip.x+(x-.5)*sc)*W,y:(clip.y+(y-.5)*sc)*H,w:Math.max(12,w*sc*W),h:Math.max(12,h*sc*H)};
        }
        const media=T.getMedia(p,clip.mediaId);if(!media||media.type==='audio'||clip.audioOnly)return null;
        const fx=T.fxOf(clip),cr=T.cropRect(media.width||W,media.height||H,fx.crop),m=T.motionAt(clip,t);
        const r=T.placeRect(cr.sw,cr.sh,W,H,clip.fit,(clip.scale||1)*m.scale,(clip.x??.5)+m.dx,(clip.y??.5)+m.dy);
        const a=(fx.rotate||0)*Math.PI/180,w=Math.abs(r.w*Math.cos(a))+Math.abs(r.h*Math.sin(a)),h=Math.abs(r.w*Math.sin(a))+Math.abs(r.h*Math.cos(a));
        return {x:r.x+r.w/2-w/2,y:r.y+r.h/2-h/2,w,h};
    }

    function fitCanvas() {
        const stage = $('stage');
        const box = stage.getBoundingClientRect();
        const pad = drawMode ? 12 : 24;
        // While drawing, the picture sits below the drawing toolbar, not under it.
        const bar = drawMode && drawMode.bar ? drawMode.bar.offsetHeight + 12 : 0;
        stage.style.paddingTop = bar ? bar + 'px' : '';
        const availW = Math.max(40, box.width - pad);
        const availH = Math.max(40, box.height - pad - bar);
        const ratio = canvas.width / canvas.height;
        let w = availW;
        let h = w / ratio;
        if (h > availH) { h = availH; w = h * ratio; }
        canvas.style.width = Math.floor(w) + 'px';
        canvas.style.height = Math.floor(h) + 'px';
        if (drawMode) sizeDrawLayer();
    }

    /* --------------------------------------------------------------- playback */

    let rafId = 0;
    let anchorTime = 0;
    let anchorWall = 0;
    let stallSince = null;

    function play() {
        if (state.playing) return;
        if (drawMode) {
            // Playing while the drawing board is open finishes the drawing
            // and plays it from its start, hand and all.
            const id = closeDrawMode(true);
            const clip = id && T.getClip(state.project, id);
            if (clip) seek(clip.start);
        }
        const d = duration();
        if (d <= 0) { toast('Add something to the timeline first.'); return; }
        wakeAudio();
        if (state.time >= d - 1e-3) state.time = 0;
        state.playing = true;
        anchorTime = state.time;
        anchorWall = performance.now();
        stallSince = null;
        updatePlayButton();
        rafId = requestAnimationFrame(tick);
    }

    function pause() {
        if (!state.playing) return;
        state.playing = false;
        cancelAnimationFrame(rafId);
        pool.forEach(function (e) { if (!e.el.paused) e.el.pause(); });
        updatePlayButton();
        updatePlayhead(false);
        requestDraw();
    }
    function togglePlay() {
        if (state.playing) pause(); else play();
    }

    function tick(now) {
        if (!state.playing) return;
        const d = duration();
        let t = anchorTime + (now - anchorWall) / 1000;
        if (t >= d) {
            state.time = d;
            const exporting = state.exporting;
            pause();
            if (exporting && exporting.kind === 'realtime') finishExport();
            return;
        }
        const stalled = syncMedia(t, true);
        if (stalled) {
            if (stallSince === null) stallSince = now;
            if (now - stallSince < MAX_STALL_MS) {
                // Hold the clock where it was until the clip catches up.
                anchorTime = state.time;
                anchorWall = now;
                t = state.time;
            }
        } else {
            stallSince = null;
        }
        if (state.exporting) holdRecorder(stalled && now - stallSince < MAX_STALL_MS);
        state.time = t;
        drawFrame(t);
        updatePlayhead(true);
        if (state.exporting) exportProgress(t / d);
        rafId = requestAnimationFrame(tick);
    }

    function seek(t) {
        state.time = Math.max(0, t);
        if (state.playing) {
            anchorTime = state.time;
            anchorWall = performance.now();
        }
        updatePlayhead(false);
        updateButtons();
        requestDraw();
    }

    function step(frames) {
        pause();
        const fps = state.project.fps;
        seek(T.toFrame(state.time, fps) + frames / fps);
    }

    function updatePlayButton() {
        const b = $('play');
        b.innerHTML = state.playing ? ICONS.pause : ICONS.play;
        b.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    }

    /* ------------------------------------------------------------------ media */

    function mediaType(file) {
        const t = file.type || '';
        if (t.startsWith('video/')) return 'video';
        if (t.startsWith('audio/')) return 'audio';
        if (t.startsWith('image/')) return 'image';
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
        return null;
    }

    /**
     * MediaRecorder output and some streamed files report an Infinity
     * duration until the browser has looked at the end; seeking far past it
     * makes it look.
     */
    async function realDuration(node) {
        if (isFinite(node.duration) && node.duration > 0) return node.duration;
        await new Promise(function (resolve) {
            const timer = setTimeout(done, 8000);
            function check() { if (isFinite(node.duration)) done(); }
            function done() {
                clearTimeout(timer);
                node.removeEventListener('durationchange', check);
                node.removeEventListener('seeked', done);
                resolve();
            }
            node.addEventListener('durationchange', check);
            node.addEventListener('seeked', done);
            node.currentTime = 1e7;
        });
        if (isFinite(node.duration) && node.duration > 0) return node.duration;
        const b = node.buffered;
        return b.length ? b.end(b.length - 1) : 0;
    }

    function thumbnailOf(source, sw, sh) {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 90;
        const x = c.getContext('2d');
        x.fillStyle = '#000';
        x.fillRect(0, 0, 160, 90);
        const r = T.placeRect(sw, sh, 160, 90, 'cover');
        x.drawImage(source, r.x, r.y, r.w, r.h);
        return c.toDataURL('image/jpeg', 0.7);
    }

    async function probe(file, url, type) {
        if (type === 'image') {
            const img = new Image();
            img.src = url;
            await waitFor(img, 'load', 15000);
            const w = img.naturalWidth || 1280;
            const h = img.naturalHeight || 720;
            return { type: 'image', width: w, height: h, thumbnail: thumbnailOf(img, w, h) };
        }
        const node = document.createElement(type === 'audio' ? 'audio' : 'video');
        node.preload = 'metadata';
        node.muted = true;
        node.playsInline = true;
        node.src = url;
        try {
            await waitFor(node, 'loadedmetadata', 15000);
            const d = await realDuration(node);
            if (!(d > 0)) throw new Error('it has no playable length');
            // A "video" with no picture (an audio-only .webm, say) is audio.
            if (type === 'audio' || !node.videoWidth) return { type: 'audio', duration: d };
            node.currentTime = Math.min(1, d * 0.2);
            let thumbnail = null;
            try {
                await waitFor(node, 'seeked', 5000);
                thumbnail = thumbnailOf(node, node.videoWidth, node.videoHeight);
            } catch (err) { /* keep going without one */ }
            return { type: 'video', duration: d, width: node.videoWidth, height: node.videoHeight, thumbnail: thumbnail };
        } finally {
            node.removeAttribute('src');
            node.load();
        }
    }

    /** Peak levels at 100 per second, for waveforms and for ducking under speech. */
    async function computePeaks(mediaId, file) {
        if (file.size > 200 * 1024 * 1024 || !window.OfflineAudioContext || !window.ReelAudio) return;
        try {
            const data = await file.arrayBuffer();
            const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
            const chans = [];
            for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) chans.push(buffer.getChannelData(ch));
            const f = files.get(mediaId);
            if (!f || f.file !== file) return;
            f.peaks = window.ReelAudio.peaks(chans, buffer.sampleRate, 100);
            f.peakRate = 100;
            duckDirty = true;
            scheduleTimeline();
        } catch (err) {
            // No decodable audio; the clip just goes without a waveform.
        }
    }

    /** Opens a file for a media id: object URL, thumbnail, levels. */
    async function attachFile(id, file, info) {
        const url = URL.createObjectURL(file);
        let meta = info;
        if (!meta) {
            const media = T.getMedia(state.project, id);
            try { meta = await probe(file, url, media ? media.type : mediaType(file)); } catch (err) { meta = {}; }
        }
        const old = files.get(id);
        if (old) URL.revokeObjectURL(old.url);
        files.set(id, { file: file, url: url, thumbnail: meta.thumbnail || null, peaks: null, peakRate: 0 });
        if (meta.type !== 'image') computePeaks(id, file);
        return meta;
    }

    /**
     * Opens files and adds them to the media bin. A file matching a saved
     * item that is offline brings that item back instead of adding a copy.
     * Returns the ids of the items, in order.
     */
    async function importFiles(list, options) {
        const o = options || {};
        const ids = [];
        let added = false;
        const incoming = Array.from(list || []);
        for (const file of incoming) {
            const type = mediaType(file);
            if (!type) { toast(file.name + ' is not a video, audio or image file.'); continue; }
            const url = URL.createObjectURL(file);
            let info;
            try {
                info = await probe(file, url, type);
            } catch (err) {
                URL.revokeObjectURL(url);
                toast('Could not open ' + file.name + ': ' + err.message + '.');
                continue;
            }
            URL.revokeObjectURL(url);
            let target = null;            if (relinkTarget && T.getMedia(state.project, relinkTarget)) {
                target = T.getMedia(state.project, relinkTarget);
                relinkTarget = null;
            } else if (!o.fresh) {
                const offline = { media: state.project.media.filter((m) => !files.has(m.id)) };
                target = T.matchMedia(offline, file);
            }
            const meta = {
                name: file.name, type: info.type, mime: file.type, size: file.size,
                lastModified: file.lastModified, duration: info.duration, width: info.width, height: info.height
            };
            if (o.origin) meta.origin = o.origin;
            let id;
            if (target) {
                id = target.id;
                // Relinking is not an edit: patch the metadata in place.
                Object.assign(target, meta);
                state.history.states.forEach(function (s) {
                    const m = s.media.find((x) => x.id === id);
                    if (m) Object.assign(m, meta);
                });
            } else {
                id = T.newId('m');
                state.project = T.addMedia(state.project, Object.assign({ id: id }, meta));
                added = true;
            }
            await attachFile(id, file, info);
            if (window.ReelStore) window.ReelStore.keep(id, file);
            ids.push(id);
        }
        relinkTarget = null;
        if (!o.noCommit) {
            if (added) commit();
            else afterChange();
        }
        updateRestoreBanner();
        return ids;
    }

    /** Puts a media item at the end of its main track and selects it. */
    function addToTimeline(mediaId) {
        const before = new Set(state.project.clips.map((c) => c.id));
        const wasEmpty = !state.project.clips.length;
        let next = T.appendMedia(state.project, mediaId);
        const added = next.clips.find((c) => !before.has(c.id));
        if (added) next = animateNewPicture(next, added.id);
        if (!apply(next)) {
            toast('There is no track for that kind of media.');
            return null;
        }
        if (added) selectOnly(added.id);
        if (wasEmpty) zoomToFit();
        return added ? added.id : null;
    }

    /**
     * A photo added to the timeline starts animated: it fades in and slowly
     * zooms (the Ken Burns effect). Both can be changed or turned off in the
     * inspector, under Animation and Motion.
     */
    function animateNewPicture(project, clipId) {
        const clip = T.getClip(project, clipId);
        if (!clip || T.clipKind(project, clip) !== 'image' || clip.freeze) return project;
        if (clip.enter || clip.motion) return project;
        return T.updateClip(project, clipId, { enter: 'fade', enterDuration: 0.6, motion: { type: 'zoom-in', amount: 0.12 } });
    }

    /** Adds a media item at `time` on `trackId`, or its kind's main track. */
    function placeMedia(mediaId, trackId, time) {
        const media = T.getMedia(state.project, mediaId);
        if (!media) return null;
        const kind = T.trackKindFor(media.type);
        let track = T.getTrack(state.project, trackId);
        if (!track || track.kind !== kind) track = T.lowestTrack(state.project, kind);
        if (!track) return null;
        const clip = T.clipFromMedia(media, track.id, time);
        const next = T.addClip(state.project, clip);
        if (next === state.project) return null;
        state.project = animateNewPicture(next, clip.id);
        return clip.id;
    }

    function removeMedia(mediaId) {
        const media = T.getMedia(state.project, mediaId);
        if (!media) return;
        const used = state.project.clips.filter((c) => c.mediaId === mediaId);
        if (used.length && !window.confirm('Remove “' + media.name + '” and its ' + used.length +
            ' clip' + (used.length === 1 ? '' : 's') + ' from the timeline?')) return;
        let p = T.deleteClips(state.project, used.map((c) => c.id), false);
        p = T.clone(p);
        p.media = p.media.filter((m) => m.id !== mediaId);
        apply(p);
    }

    /* ----------------------------------------------------------------- render */

    function renderAll() {
        renderTabs();
        renderMedia();
        renderTimeline();
        renderInspector();
        updateButtons();
        updatePlayhead(false);
        syncHeaderFields();
        $('stage-hint').hidden = state.project.clips.length > 0;
        requestDraw();
    }

    function syncHeaderFields() {
        const p = state.project;
        if (document.activeElement !== $('project-name')) $('project-name').value = p.name;
        const res = p.width + 'x' + p.height;
        const sel = $('resolution');
        if (![].some.call(sel.options, (o) => o.value === res)) {
            sel.append(el('option', { value: res, text: p.width + '×' + p.height }));
        }
        sel.value = res;
        $('fps').value = String(p.fps);
    }

    function updateButtons() {
        const clip = selectedClip();
        const underPlayhead = T.activeClips(state.project, state.time).length > 0;
        $('undo').disabled = !state.history.canUndo();
        $('redo').disabled = !state.history.canRedo();
        $('tool-split').disabled = !underPlayhead;
        $('tool-delete').disabled = !state.selection.length && !state.marker;
        $('tool-duplicate').disabled = !clip;
    }

    function renderMedia() {
        const list = $('media-list');
        const p = state.project;
        list.textContent = '';
        $('media-empty').hidden = p.media.length > 0;
        p.media.forEach(function (m) {
            const f = files.get(m.id);
            const thumb = el('div', { className: 'media-thumb' });
            if (f && f.thumbnail) thumb.style.backgroundImage = 'url("' + f.thumbnail + '")';
            else thumb.innerHTML = f ? (m.type === 'audio' ? ICONS.music : '') : ICONS.warn;
            const info = !f ? 'Offline — import it again'
                : [m.duration ? fmt(m.duration) : null, m.width ? m.width + '×' + m.height : null,
                    m.type === 'audio' ? 'audio' : null].filter(Boolean).join(' · ');
            const item = el('div', {
                className: 'media-item' + (f ? '' : ' missing'),
                draggable: f ? 'true' : 'false',
                'data-id': m.id,
                title: m.name + (f ? '\nDouble-click or drag onto the timeline' : ''),
                ondblclick: function () { if (f) addToTimeline(m.id); },
                ondragstart: function (e) {
                    e.dataTransfer.setData('application/x-reel-media', m.id);
                    e.dataTransfer.effectAllowed = 'copy';
                }
            }, [
                thumb,
                el('div', { className: 'media-meta' }, [
                    el('div', { className: 'media-name', text: m.name }),
                    el('div', { className: 'media-info', text: info })
                ]),
                el('div', { className: 'media-actions' }, [
                    f
                        ? el('button', { className: 'icon ghost add', title: 'Add to timeline', 'aria-label': 'Add ' + m.name + ' to timeline', html: ICONS.plus, onclick: function () { addToTimeline(m.id); } })
                        : el('button', { className: 'ghost', text: 'Relink', onclick: function () { relinkTarget = m.id; $('import-input').click(); } }),
                    el('button', { className: 'icon ghost', title: 'Remove from project', 'aria-label': 'Remove ' + m.name, html: ICONS.close, onclick: function () { removeMedia(m.id); } })
                ])
            ]);
            list.append(item);
        });
    }

    function updateRestoreBanner() {
        const banner = $('restore-banner');
        const offline = state.project.media.filter((m) => !files.has(m.id));
        if (!offline.length) { banner.hidden = true; return; }
        banner.hidden = false;
        banner.textContent = '';
        banner.append(
            el('div', { text: offline.length + ' file' + (offline.length === 1 ? ' is' : 's are') +
                ' offline. Import ' + (offline.length === 1 ? 'it' : 'them') + ' again and ' +
                (offline.length === 1 ? 'it is' : 'they are') + ' matched by name.' }),
            el('button', { text: 'Import files', onclick: function () { $('import-input').click(); } })
        );
    }

    /* ----------------------------------------------------------- the timeline */

    let timelineQueued = false;
    function scheduleTimeline() {
        if (timelineQueued) return;
        timelineQueued = true;
        requestAnimationFrame(function () { timelineQueued = false; renderTimeline(); });
    }

    function contentWidth() {
        const view = Math.max(200, tl.clientWidth - headWidth());
        return Math.max(view, (duration() + Math.max(10, view / state.pps / 2)) * state.pps);
    }

    function renderTimeline() {
        const p = state.project;
        const pps = state.pps;
        const width = contentWidth();
        const scrollLeft = tl.scrollLeft;
        const scrollTop = tl.scrollTop;
        const inner = el('div', { className: 'tl-inner', style: { width: headWidth() + width + 'px' } });

        const ruler = el('div', { className: 'tl-ruler', style: { width: width + 'px' } });
        const major = T.rulerStep(pps, 70);
        const minor = major * pps / 5 >= 8 ? major / 5 : major / 2;
        const count = Math.ceil(width / pps / minor);
        for (let i = 0; i <= count; i += 1) {
            const t = i * minor;
            const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
            const tick = el('div', { className: 'tick' + (isMajor ? ' major' : ''), style: { left: t * pps + 'px' } });
            if (isMajor) tick.append(el('span', { text: rulerLabel(t, major) }));            ruler.append(tick);
        }
        (p.markers || []).forEach(function (m) {
            ruler.append(el('div', {
                className: 'marker' + (m.id === state.marker ? ' selected' : ''),
                'data-id': m.id,
                title: (m.label || 'Marker') + ' — ' + fmt(m.time) + '\nClick to jump, drag to move, double-click to rename',
                style: { left: m.time * pps + 'px' }
            }, [el('span', { text: m.label || '' })]));
        });
        inner.append(el('div', { className: 'tl-rulerrow' }, [
            el('div', { className: 'tl-corner', id: 'tl-corner', text: fmt(state.time) }),
            ruler
        ]));

        p.tracks.forEach(function (track) {
            const lane = el('div', { className: 'tl-lane', style: { width: width + 'px' } });
            T.trackClips(p, track.id).forEach(function (clip) { lane.append(clipElement(clip)); });
            const dim = (track.kind === 'audio' && track.muted) || (track.kind !== 'audio' && track.hidden);
            inner.append(el('div', {
                className: 'tl-row' + (dim ? ' dim' : ''),
                'data-track': track.id,
                'data-kind': track.kind
            }, [trackHead(track), lane]));
        });

        (p.markers || []).forEach(function (m) {
            inner.append(el('div', { className: 'tl-markerline', style: { left: headWidth() + m.time * pps + 'px' } }));
        });
        inner.append(el('div', { className: 'tl-playhead', id: 'tl-playhead' }));
        inner.append(el('div', { className: 'tl-snapline', id: 'tl-snapline', hidden: true }));
        tl.replaceChildren(inner);
        tl.scrollLeft = scrollLeft;
        tl.scrollTop = scrollTop;
        updatePlayhead(false);
    }

    function rulerLabel(t, stepSize) {
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        const secs = stepSize < 1 ? s.toFixed(1).padStart(4, '0') : String(Math.round(s)).padStart(2, '0');
        return m + ':' + secs;
    }

    function trackHead(track) {
        const buttons = [];
        if (track.kind !== 'audio') {
            buttons.push(el('button', {
                className: 'ghost' + (track.hidden ? ' on' : ''),
                title: track.hidden ? 'Show track' : 'Hide track',
                'aria-label': (track.hidden ? 'Show ' : 'Hide ') + track.name,
                'aria-pressed': track.hidden ? 'true' : 'false',
                html: track.hidden ? ICONS.eyeOff : ICONS.eye,
                onclick: function () { apply(T.updateTrack(state.project, track.id, { hidden: !track.hidden })); }
            }));
        }
        if (track.kind !== 'text') {
            buttons.push(el('button', {
                className: 'ghost' + (track.muted ? ' on' : ''),
                title: track.muted ? 'Unmute track' : 'Mute track',
                'aria-label': (track.muted ? 'Unmute ' : 'Mute ') + track.name,
                'aria-pressed': track.muted ? 'true' : 'false',
                html: track.muted ? ICONS.mute : ICONS.sound,
                onclick: function () { apply(T.updateTrack(state.project, track.id, { muted: !track.muted })); }
            }));
        }
        if (track.kind === 'audio') {
            buttons.push(el('button', {
                className: 'ghost' + (track.duck ? ' on' : ''),
                title: track.duck ? 'Ducking on: this track goes quieter while someone speaks' : 'Duck this track under speech (for background sound, such as a nasheed)',
                'aria-label': (track.duck ? 'Stop ducking ' : 'Duck ') + track.name,
                'aria-pressed': track.duck ? 'true' : 'false',
                html: ICONS.duck,
                onclick: function () { apply(T.updateTrack(state.project, track.id, { duck: !track.duck })); }
            }));
        }
        if (T.removeTrack(state.project, track.id) !== state.project) {
            buttons.push(el('button', {
                className: 'ghost', title: 'Remove this empty track', 'aria-label': 'Remove ' + track.name, html: ICONS.close,
                onclick: function () { apply(T.removeTrack(state.project, track.id)); }
            }));
        }
        const kindLabel = { video: 'Video', audio: 'Audio', text: 'Titles' }[track.kind];
        return el('div', { className: 'tl-head' }, [
            el('div', { className: 'name', title: track.name }, [track.id, el('small', { text: kindLabel })])
        ].concat(buttons));
    }

    function clipLabel(clip, media) {
        if (clip.type === 'text') return (clip.text || '').split('\n')[0] || 'Title';
        if (clip.type === 'draw') return '✎ Drawing';
        if (!media) return 'Missing media';
        let label = media.name;
        if (clip.freeze) label = '❄ Freeze · ' + label;
        if (clip.audioOnly) label += ' (sound)';
        if (T.speedOf(clip) !== 1) label = T.speedOf(clip) + '× · ' + label;
        return label;
    }

    function clipElement(clip) {
        const p = state.project;
        const kind = T.clipKind(p, clip);
        const media = T.isGenerated(clip) ? null : T.getMedia(p, clip.mediaId);
        const f = media ? files.get(media.id) : null;
        const pps = state.pps;
        const width = Math.max(2, clip.duration * pps);
        const node = el('div', {
            className: 'clip k-' + kind + (isSelected(clip.id) ? ' selected' : '') +
                (clip.id === state.selected ? ' primary' : '') + (media && !f ? ' missing' : '') +
                (clip.freeze ? ' freeze' : ''),
            'data-id': clip.id,
            title: clipLabel(clip, media) + '\n' + fmt(clip.start) + ' → ' + fmt(T.clipEnd(clip)),
            style: { left: clip.start * pps + 'px', width: width + 'px' }
        });
        if (f && f.thumbnail && kind !== 'audio') {
            node.append(el('div', { className: 'clip-thumbs', style: { backgroundImage: 'url("' + f.thumbnail + '")' } }));
        }
        if (f && f.peaks && kind === 'audio') node.append(waveform(clip, f, width));
        node.append(el('span', { className: 'clip-label', text: clipLabel(clip, media) }));
        if (clip.fadeIn > 0) node.append(el('div', { className: 'clip-fade in', style: { width: clip.fadeIn * pps + 'px' } }));
        if (clip.fadeOut > 0) node.append(el('div', { className: 'clip-fade out', style: { width: clip.fadeOut * pps + 'px' } }));
        const w = T.transitionWindow(p, clip);
        if (w) {
            node.append(el('div', {
                className: 'clip-tr', title: (TRANSITION_LABELS[w.type] || w.type) + ' · ' + w.duration.toFixed(1) + ' s',
                style: { width: Math.max(10, w.duration / 2 * pps) + 'px' }
            }));
        }
        const badges = [];
        if (clip.motion && clip.motion.type && clip.motion.type !== 'none') badges.push('⤢');
        if (!T.isGenerated(clip) && T.hasFx(clip)) badges.push('fx');
        if (T.handOf(clip)) badges.push('✍');
        if (badges.length) node.append(el('span', { className: 'clip-badge', text: badges.join(' '), title: 'Has pan & zoom, effects or a hand' }));
        (clip.keys || []).forEach(function (k) {
            node.append(el('span', { className: 'clip-key', title: 'Keyframe at ' + fmt(clip.start + k.t), style: { left: k.t * pps + 'px' } }));
        });
        node.append(el('div', { className: 'handle l', 'data-edge': 'start' }));
        node.append(el('div', { className: 'handle r', 'data-edge': 'end' }));
        return node;
    }

    function waveform(clip, f, widthPx) {
        const c = el('canvas', { className: 'clip-wave' });
        const w = Math.max(1, Math.min(4096, Math.ceil(widthPx)));
        const h = 36;
        c.width = w;
        c.height = h;
        const x = c.getContext('2d');
        x.fillStyle = 'rgba(255,255,255,.75)';
        const perPx = clip.duration * T.speedOf(clip) / w;
        const gain = Math.min(2, clip.volume === undefined ? 1 : clip.volume);
        for (let i = 0; i < w; i += 1) {
            const from = Math.floor(((clip.in || 0) + i * perPx) * f.peakRate);
            const to = Math.max(from + 1, Math.floor(((clip.in || 0) + (i + 1) * perPx) * f.peakRate));
            let m = 0;
            for (let k = from; k < to && k < f.peaks.length; k += 1) if (f.peaks[k] > m) m = f.peaks[k];
            const bar = Math.max(1, Math.min(h, m * gain * h));
            x.fillRect(i, (h - bar) / 2, 1, bar);
        }
        return c;
    }

    function updatePlayhead(follow) {
        const x = headWidth() + state.time * state.pps;
        const ph = $('tl-playhead');
        if (ph) ph.style.left = x + 'px';
        const corner = $('tl-corner');
        if (corner) corner.textContent = fmt(state.time);
        $('timecode').textContent = fmt(state.time);
        $('duration').textContent = fmt(duration());
        if (follow) {
            const left = tl.scrollLeft + headWidth();
            const right = tl.scrollLeft + tl.clientWidth;
            if (x > right - 40 || x < left) tl.scrollLeft = x - headWidth() - 40;
        }
    }

    /* ----------------------------------------------------- timeline gestures */

    let drag = null;
    let lastClipPress = null;
    const touches = new Map();
    let pinch = null;

    function timeAt(clientX) {
        const r = tl.getBoundingClientRect();
        return Math.max(0, (clientX - r.left + tl.scrollLeft - headWidth()) / state.pps);
    }

    function rowAt(clientY) {
        const rows = tl.querySelectorAll('.tl-row');
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i].getBoundingClientRect();
            if (clientY >= r.top && clientY < r.bottom) return rows[i];
        }
        return null;
    }

    function showSnap(t) {
        const line = $('tl-snapline');
        if (!line) return;
        if (t === null) { line.hidden = true; return; }
        line.hidden = false;        line.style.left = headWidth() + t * state.pps + 'px';
    }

    function selectMarker(id) {
        state.marker = id;
        if (id) { state.selection = []; state.selected = null; }
        selectionChanged();
    }

    function startPinch() {
        const pts = Array.from(touches.values());
        const mid = (pts[0].x + pts[1].x) / 2;
        pinch = {
            d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
            pps0: state.pps,
            t0: timeAt(mid)
        };
    }

    tl.addEventListener('pointerdown', function (e) {
        if (state.exporting) return;
        if (e.pointerType === 'touch') {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.size === 2) {
                drag = null;
                startPinch();
                return;
            }
        }
        if (e.button !== 0) return;
        if (e.target.closest('.tl-head, .tl-corner')) return;
        const markerNode = e.target.closest('.marker');
        const clipNode = e.target.closest('.clip');
        const handle = e.target.closest('.handle');
        const onRuler = e.target.closest('.tl-ruler');
        const onLane = e.target.closest('.tl-lane');
        if (markerNode) {
            selectMarker(markerNode.dataset.id);
            drag = { mode: 'marker', id: markerNode.dataset.id, base: state.project, x: e.clientX, moved: false };
        } else if (clipNode) {
            const clip = T.getClip(state.project, clipNode.dataset.id);
            if (!clip) return;
            // A second press on the same clip opens it. Selecting re-renders
            // the timeline, so the browser's own dblclick can miss.
            const now = performance.now();
            const again = lastClipPress && lastClipPress.id === clip.id && now - lastClipPress.at < 450 && !handle;
            lastClipPress = { id: clip.id, at: now };
            if (again && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                lastClipPress = null;
                e.preventDefault();
                openClip(clip);
                return;
            }
            const additive = e.shiftKey || e.ctrlKey || e.metaKey;
            if (additive) toggleSelect(clip.id);
            else if (!isSelected(clip.id)) selectOnly(clip.id);
            else { state.selected = clip.id; selectionChanged(); }
            if (additive && !isSelected(clip.id)) return;
            drag = {
                mode: handle ? 'trim' : 'move',
                edge: handle ? handle.dataset.edge : null,
                id: clip.id,
                group: state.selection.length > 1 && !handle ? state.selection.slice() : null,
                base: state.project,
                x: e.clientX,
                y: e.clientY,
                grab: timeAt(e.clientX) - clip.start,
                moved: false
            };
        } else if (onRuler) {
            drag = { mode: 'scrub' };
            seek(timeAt(e.clientX));
        } else if (onLane) {
            if (e.pointerType === 'touch') {
                // On a touch screen one finger pans the timeline; a tap seeks.
                drag = { mode: 'pan', x: e.clientX, y: e.clientY, sl: tl.scrollLeft, st: tl.scrollTop, moved: false };
            } else {
                selectOnly(null);
                if (state.marker) selectMarker(null);
                drag = { mode: 'scrub' };
                seek(timeAt(e.clientX));
            }
        } else {
            return;
        }
        tl.setPointerCapture(e.pointerId);
        e.preventDefault();
        // preventDefault keeps focus where it was; move it here so a field in
        // the inspector commits and keyboard shortcuts reach the timeline.
        tl.focus({ preventScroll: true });
    });

    tl.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch && touches.size >= 2) {
                const pts = Array.from(touches.values());
                const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                setZoom(pinch.pps0 * d / pinch.d0, pinch.t0, (pts[0].x + pts[1].x) / 2);
                return;
            }
        }
        if (!drag) return;
        if (drag.mode === 'scrub') { seek(timeAt(e.clientX)); return; }
        if (drag.mode === 'pan') {
            if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
            tl.scrollLeft = drag.sl - (e.clientX - drag.x);
            tl.scrollTop = drag.st - (e.clientY - drag.y);
            return;
        }
        if (!drag.moved && Math.abs(e.clientX - drag.x) < 3 && Math.abs(e.clientY - (drag.y || e.clientY)) < 3) return;
        drag.moved = true;
        const threshold = state.snap ? SNAP_PX / state.pps : 0;

        if (drag.mode === 'marker') {
            let t = timeAt(e.clientX);
            if (state.snap) t = T.snapTime(Object.assign({}, drag.base, { markers: [] }), t, threshold, null, [state.time]);
            state.project = T.updateMarker(drag.base, drag.id, { time: t });
            renderTimeline();
            return;
        }

        const clip = T.getClip(drag.base, drag.id);
        if (drag.mode === 'move') {
            let start = timeAt(e.clientX) - drag.grab;
            let snapped = null;
            const exclude = drag.group || drag.id;
            if (state.snap) {
                const s = T.snapTime(drag.base, start, threshold, exclude, [state.time]);
                const end = T.snapTime(drag.base, start + clip.duration, threshold, exclude, [state.time]);
                const ds = Math.abs(s - start);
                const de = Math.abs(end - (start + clip.duration));
                if (s !== start && (end === start + clip.duration || ds <= de)) { start = s; snapped = s; }
                else if (end !== start + clip.duration) { start = end - clip.duration; snapped = end; }
            }
            if (drag.group) {
                const next = T.moveClips(drag.base, drag.group, start - clip.start);
                if (next !== drag.base || Math.abs(start - clip.start) < 1e-6) state.project = next;
            } else {
                const row = rowAt(e.clientY);
                let track = clip.track;
                if (row && row.dataset.kind === T.getTrack(drag.base, clip.track).kind) track = row.dataset.track;
                state.project = T.moveClip(drag.base, drag.id, start, track);
            }
            renderTimeline();
            showSnap(snapped);
        } else {
            let t = timeAt(e.clientX);
            let snapped = null;
            if (state.snap) {
                const s = T.snapTime(drag.base, t, threshold, drag.id, [state.time]);
                if (s !== t) { t = s; snapped = s; }
            }
            state.project = T.trimClip(drag.base, drag.id, drag.edge, t);
            renderTimeline();
            showSnap(snapped);
        }
        (drag.group || [drag.id]).forEach(function (id) {
            const n = tl.querySelector('.clip[data-id="' + id + '"]');
            if (n) n.classList.add('dragging');
        });
        requestDraw();
    });

    function endDrag(e) {
        if (e && e.pointerType === 'touch') {
            touches.delete(e.pointerId);
            if (pinch && touches.size < 2) { pinch = null; drag = null; return; }
        }
        if (!drag) return;
        const d = drag;
        drag = null;
        showSnap(null);
        if (d.mode === 'pan' && !d.moved) {
            selectOnly(null);
            seek(timeAt(d.x));
        } else if (d.mode === 'marker' && !d.moved) {
            const m = (state.project.markers || []).find((x) => x.id === d.id);
            if (m) seek(m.time);
        } else if ((d.mode === 'move' || d.mode === 'trim' || d.mode === 'marker') && d.moved && state.project !== d.base) {
            commit();
        } else if (d.mode !== 'scrub' && d.mode !== 'pan') {
            scheduleTimeline();
        }
    }
    tl.addEventListener('pointerup', endDrag);
    tl.addEventListener('pointercancel', endDrag);

    tl.addEventListener('dblclick', function (e) {
        const markerNode = e.target.closest('.marker');
        if (markerNode) { renameMarker(markerNode.dataset.id); return; }
        const clipNode = e.target.closest('.clip');
        if (!clipNode) return;
        const clip = T.getClip(state.project, clipNode.dataset.id);
        if (clip) openClip(clip);
    });

    /** Double-clicking a clip: a title's text is ready to type into; a drawing opens on the board. */
    function openClip(clip) {
        if (clip.type === 'text') {            showDetails();
            const box = $('inspector').querySelector('textarea');
            if (box) { box.focus(); box.select(); }
        } else if (clip.type === 'draw') {
            openDrawMode(clip.id);
        }
    }

    tl.addEventListener('wheel', function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setZoom(state.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), timeAt(e.clientX), e.clientX);
    }, { passive: false });

    // Media dragged from the bin, or files dragged from the desktop, onto a track.
    tl.addEventListener('dragover', function (e) {
        const types = Array.from(e.dataTransfer.types || []);
        if (!types.includes('application/x-reel-media') && !types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        const row = rowAt(e.clientY);
        tl.querySelectorAll('.tl-row').forEach(function (r) { r.classList.toggle('drop-target', r === row); });
    });
    tl.addEventListener('dragleave', function (e) {
        if (!tl.contains(e.relatedTarget)) tl.querySelectorAll('.drop-target').forEach((r) => r.classList.remove('drop-target'));
    });
    tl.addEventListener('drop', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideDropOverlay();
        tl.querySelectorAll('.drop-target').forEach((r) => r.classList.remove('drop-target'));
        const row = rowAt(e.clientY);
        const trackId = row ? row.dataset.track : null;
        let time = timeAt(e.clientX);
        if (state.snap) time = T.snapTime(state.project, time, SNAP_PX / state.pps, null, [state.time]);
        const mediaId = e.dataTransfer.getData('application/x-reel-media');
        let ids = mediaId ? [mediaId] : [];
        if (!mediaId && e.dataTransfer.files.length) ids = await importFiles(e.dataTransfer.files);
        let last = null;
        ids.forEach(function (id) {
            const placed = placeMedia(id, trackId, time);
            if (placed) {
                last = placed;
                time = T.clipEnd(T.getClip(state.project, placed));
            }
        });
        if (last) {
            state.selection = [last];
            state.selected = last;
            commit();
        }
    });

    /* ------------------------------------------------------------------- zoom */

    function sliderToPps(v) {
        return MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 100);
    }

    function ppsToSlider(pps) {
        return 100 * Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
    }

    /** Zooms, keeping `aroundTime` under `clientX` (default: the playhead). */
    function setZoom(pps, aroundTime, clientX) {
        const t = aroundTime === undefined ? state.time : aroundTime;
        const r = tl.getBoundingClientRect();
        const offset = clientX === undefined
            ? headWidth() + t * state.pps - tl.scrollLeft
            : clientX - r.left;
        state.pps = T.clamp(pps, MIN_PPS, MAX_PPS);
        $('zoom').value = String(ppsToSlider(state.pps));
        renderTimeline();
        tl.scrollLeft = Math.max(0, headWidth() + t * state.pps - offset);
        storage(function (s) { s.setItem('reel.zoom', String(state.pps)); });
    }

    function zoomToFit() {
        const view = tl.clientWidth - headWidth() - 40;
        setZoom(view / Math.max(duration(), 5), 0, tl.getBoundingClientRect().left + headWidth());
        tl.scrollLeft = 0;
    }

    /* ---------------------------------------------------- dialogs and menus */

    let dialogStack = [];

    /**
     * A modal dialog. `actions` are buttons; a `run` returning false (or a
     * promise of false) keeps the dialog open. Returns a handle with close(),
     * the body element and a status line for progress.
     */
    function openDialog(opts) {
        const status = el('p', { className: 'dialog-status', role: 'status' });
        const actionsRow = el('div', { className: 'actions' });
        const body = el('div', { className: 'dialog-body' }, [].concat(opts.body || []));
        const box = el('div', { className: 'dialog' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title }, [
            el('h2', { text: opts.title }),
            opts.intro ? el('p', { text: opts.intro }) : null,
            body,
            status,
            actionsRow
        ]);
        const modal = el('div', { className: 'modal generic' }, [box]);
        const handle = {
            root: box,
            body: body,
            status: function (text) { status.textContent = text || ''; },
            close: function () {
                modal.remove();
                dialogStack = dialogStack.filter((d) => d !== handle);
                if (opts.onClose) opts.onClose();
            },
            busy: function (on) { actionsRow.querySelectorAll('button').forEach((b) => { if (!b.dataset.always) b.disabled = on; }); }
        };
        (opts.actions || [{ label: 'Close' }]).forEach(function (a) {
            const b = el('button', { className: a.primary ? 'primary' : '', text: a.label, 'data-always': a.always ? '1' : null });
            b.addEventListener('click', async function () {
                if (!a.run) { handle.close(); return; }
                const keep = await a.run(handle);
                if (keep !== false) handle.close();
            });
            actionsRow.append(b);
        });
        document.body.append(modal);
        dialogStack.push(handle);
        const first = box.querySelector('input, select, textarea, button.primary');
        if (first) setTimeout(() => first.focus(), 0);
        return handle;
    }

    /** A labelled row for dialogs. */
    function dialogField(label, input, hint) {
        const id = 'd-' + Math.random().toString(36).slice(2, 8);
        input.id = id;
        return el('div', { className: 'field wide' }, [el('label', { for: id, text: label }), input, hint ? el('small', { className: 'hint', text: hint }) : null]);
    }

    /*
     * The menu bar: File, Edit, View, Create, Tools and Help. Modules add to
     * Create and Tools with ReelApp.addTool({ section, label, run }): section
     * 'Create' lands in the Create menu (grouped below), 'Project' in File,
     * anything else in Tools under its section.
     */
    const CREATE_GROUPS = [
        ['AI', /AI video/],
        ['Add', /^Title|written by hand|Drawing \(D\)|gradient card/],
        ['Islamic videos', /Qur|Hadith|Nasheed|Occasion|Ramadan/],
        ['Trending', /Trending/],
        ['Ready-made designs', /template|Background images|shapes|Drawing images|stickers/i],
        ['Sound and recording', /Record|Read aloud|Sound library|Sync|pauses/i],
        ['Share and brand', /Brand|Short/]
    ];

    function isNarrow() {
        return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
    }

    function fileItems() {
        return [
            { section: 'Project', label: 'New project', run: newProject },
            { section: 'Project', label: 'New tab', run: newTab },
            { section: 'Project', label: 'Open a project file…', run: function () { $('open-input').click(); } },
            { section: 'Project', label: 'Save as a file (Ctrl+S)', run: saveProject }
        ].concat(tools.filter((t) => t.section === 'Project')).concat([
            { section: 'Media', label: 'Import video, audio or pictures…', run: function () { $('import').click(); } },
            { section: 'Media', label: 'Save this frame as a picture', run: snapshot },
            { section: 'Finish', label: 'Export video…', run: function () { $('export').click(); } }
        ]);
    }

    function editItems() {
        const none = !state.selection.length;
        return [
            { section: 'History', label: 'Undo (Ctrl+Z)', run: undo, disabled: !state.history.canUndo() },
            { section: 'History', label: 'Redo (Ctrl+Shift+Z)', run: redo, disabled: !state.history.canRedo() },
            { section: 'Clips', label: 'Cut (Ctrl+X)', run: cutSelected, disabled: none },
            { section: 'Clips', label: 'Copy (Ctrl+C)', run: copySelected, disabled: none },
            { section: 'Clips', label: 'Paste at the playhead (Ctrl+V)', run: paste },
            { section: 'Clips', label: 'Duplicate (Ctrl+D)', run: duplicateSelected, disabled: none },
            { section: 'Clips', label: 'Split at the playhead (S)', run: splitSelected },
            { section: 'Clips', label: 'Delete (Del)', run: function () { deleteSelected(false); }, disabled: none && !state.marker },
            { section: 'Clips', label: 'Delete and close the gap (Shift+Del)', run: function () { deleteSelected(true); }, disabled: none },
            { section: 'Clips', label: 'Select all (Ctrl+A)', run: selectAll },
            { section: 'Timeline', label: 'Add a marker at the playhead (M)', run: addMarkerHere },
            { section: 'Timeline', label: 'Transition on every cut…', run: transitionEveryCut },
            { section: 'Timeline', label: 'Copy chapters for YouTube', run: copyChapters }
        ];
    }

    function viewItems() {
        const L = window.ReelLayout;
        const items = [];
        if (L) {
            const tick = (on) => (on ? '✓ ' : '\u2003 ');
            items.push(
                { section: 'Preview', label: L.expanded() ? 'Restore the workspace (Esc)' : 'Expand the preview', run: L.toggleExpand },
                { section: 'Preview', label: L.panelsHidden() ? 'Show the side panels' : 'Hide the side panels', run: L.togglePanels }
            );
            [['Small', 45], ['Medium', 64], ['Large', 85]].forEach(function (o) {
                items.push({ section: 'Preview size', label: tick(L.space() === o[1]) + o[0], run: function () { L.setSpace(o[1]); } });
            });
        }
        const res = $('resolution');
        Array.from(res.options).forEach(function (opt) {
            items.push({ section: 'Frame size', label: (res.value === opt.value ? '✓ ' : '\u2003 ') + opt.textContent, run: function () {
                res.value = opt.value;
                res.dispatchEvent(new Event('change'));
            } });
        });
        items.push(
            { section: 'Timeline', label: 'Fit the whole project', run: zoomToFit },
            { section: 'Timeline', label: (state.snap ? '✓ ' : '\u2003 ') + 'Snap to edges and the playhead', run: function () { $('snap').click(); } }
        );
        const I = window.ReelI18n;
        if (I) I.LANGS.forEach(function (l) {
            items.push({ section: 'Language', label: (I.lang() === l[0] ? '✓ ' : '\u2003 ') + l[1], run: function () { I.set(l[0]); } });
        });
        return items;
    }

    function createItems() {
        const made = tools.filter((t) => t.section === 'Create');
        const items = [];
        const used = new Set();
        CREATE_GROUPS.forEach(function (g) {
            if (g[0] === 'Add') items.push({ section: 'Add', label: 'Title (T)', run: function () { addTitle(); } });
            made.forEach(function (t) {
                if (used.has(t) || !g[1].test(t.label)) return;
                used.add(t);
                items.push(Object.assign({}, t, { section: g[0] }));
            });
        });
        made.filter((t) => !used.has(t)).forEach((t) => items.push(Object.assign({}, t, { section: 'More' })));
        return items;
    }

    function helpItems() {
        return [
            { section: 'Help', label: 'User guide', run: openGuide },
            { section: 'Help', label: 'Keyboard shortcuts', run: function () { window.open('help.html#keys', '_blank', 'noopener'); } },
            { section: 'Help', label: 'About', run: showAbout }
        ];
    }

    /** What each drop-down menu holds. */
    function menuItems(which) {
        if (which === 'file') return fileItems();
        if (which === 'edit') return editItems();
        if (which === 'view') return viewItems();
        if (which === 'create') return createItems();
        if (which === 'help') return helpItems();
        const list = tools.filter((t) => t.section !== 'Create' && t.section !== 'Project');
        if (!isNarrow()) return list;
        // On a phone File, Edit, View and Help have no buttons of their own, so they live here.
        const as = (section) => (t) => Object.assign({}, t, { section: section });
        return fileItems().map(as('File')).concat(editItems().map(as('Edit')), viewItems().map(as('View')), list, helpItems());
    }

    const MENUS = ['file', 'edit', 'view', 'create', 'tools', 'help'];

    function openMenu(which) {
        closeMenus();
        const menu = $(which + '-menu');
        const button = $(which);
        menu.textContent = '';
        let last = null;
        menuItems(which).forEach(function (it) {
            if (it.section !== last) {
                menu.append(el('div', { className: 'menu-section', text: it.section }));
                last = it.section;
            }
            menu.append(el('button', {
                role: 'menuitem', className: 'menu-item', text: it.label, disabled: !!it.disabled,
                onclick: function () { closeMenus(); it.run(); }
            }));
        });
        const r = button.getBoundingClientRect();
        menu.style.top = Math.round(r.bottom + 6) + 'px';
        menu.style.left = '8px';
        menu.hidden = false;
        document.body.classList.add('menu-open');
        // Keep it on screen, measured now that it has a size.
        menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))) + 'px';
        menu.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 16) + 'px';
        button.setAttribute('aria-expanded', 'true');
        const first = menu.querySelector('.menu-item');
        if (first) first.focus();
    }

    function closeMenus() {
        document.body.classList.remove('menu-open');
        MENUS.forEach(function (which) {
            const menu = $(which + '-menu');
            if (!menu) return;
            menu.hidden = true;
            if ($(which)) $(which).setAttribute('aria-expanded', 'false');
        });
    }

    function openMenuName() {
        return MENUS.find((which) => $(which + '-menu') && !$(which + '-menu').hidden) || null;    }

    function openGuide() {
        window.open('help.html', '_blank', 'noopener');
    }

    /** The release this page is, from the version stamped on its script links. */
    const VERSION = (function () {
        const tag = document.querySelector('script[src*="editor.js"]');
        const v = tag ? (tag.getAttribute('src').split('v=')[1] || '') : '';
        if (/^\d{12}$/.test(v)) return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8) + ' ' + v.slice(8, 10) + ':' + v.slice(10) + ' UTC';
        return v && v !== 'dev' ? v : 'development copy';
    }());

    /** Help ▸ About — the same details as the audio editor's About. */
    function showAbout() {
        const p = (text, children) => el('p', { text: text }, children);
        openDialog({
            title: 'Video Editor — NoorEditor',
            body: [
                el('div', { className: 'about' }, [
                    el('p', null, ['Built by ', el('strong', { text: 'Feysel Reshid' }), '.']),
                    el('p', null, ['Version ', el('span', { id: 'about-version', text: VERSION })]),
                    p('Everything happens on your device. Your videos are never uploaded.'),
                    el('p', null, ['Questions, or something to report? ', el('a', { href: 'mailto:fesbackups@gmail.com', text: 'fesbackups@gmail.com' })]),
                    el('p', { className: 'hint' }, ['Qur’an text, translations and recitations from ', el('a', { href: 'https://quran.com', target: '_blank', rel: 'noopener', text: 'Quran.com' }),
                        '. Export uses ', el('a', { href: 'vendor/mediabunny.LICENSE', target: '_blank', rel: 'noopener', text: 'mediabunny' }),
                        ' (MPL-2.0); captions and voice clean-up use Whisper and RNNoise, downloaded when first used.'])
                ])
            ],
            actions: [{ label: 'Close', primary: true }]
        });
    }

    /** Once, on a phone: this works best on a computer (never blocks). */
    const MOBILE_NOTICE_KEY = 've-mobile-notice-v1';
    function maybeShowMobileNotice() {
        if (storage((s) => s.getItem(MOBILE_NOTICE_KEY)) === 'yes') return;
        if (!(window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches)) return;
        openDialog({
            title: 'This works best on a computer',
            body: [
                el('p', { text: 'This is a full video editor with a lot of tools, and it was built for a mouse, a keyboard and a bigger screen. For the easiest experience, open this page on a computer instead.' }),
                el('p', { text: 'You can still use it here — trimming, titles, Qur’an verse videos and export all work on a phone — but some panels are smaller and a few tools are easier to miss.' })
            ],
            actions: [{ label: 'Continue on This Phone', primary: true }],
            onClose: function () { storage((s) => s.setItem(MOBILE_NOTICE_KEY, 'yes')); }
        });
    }

    /** A plain or gradient picture the size of the frame, for intros and backgrounds. */
    async function makeCard(W, H, style, c1, c2) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const x = c.getContext('2d');
        if (style === 'solid') {
            x.fillStyle = c1;
        } else if (style === 'radial') {
            const g = x.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
            g.addColorStop(0, c2);
            g.addColorStop(1, c1);
            x.fillStyle = g;
        } else {
            const g = x.createLinearGradient(0, 0, W * 0.4, H);
            g.addColorStop(0, c1);
            g.addColorStop(1, c2);
            x.fillStyle = g;
        }
        x.fillRect(0, 0, W, H);
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
        const label = style === 'solid' ? c1 : c1 + '-' + c2;
        return new File([blob], 'Card ' + label.replace(/#/g, '') + ' ' + W + 'x' + H + '.png', { type: 'image/png', lastModified: Date.now() });
    }

    function colourCardDialog() {
        const style = el('select', null, [['linear', 'Gradient'], ['radial', 'Soft glow'], ['solid', 'Solid colour']].map((o) => el('option', { value: o[0], text: o[1] })));
        const c1 = el('input', { type: 'color', value: '#0f3d33' });
        const c2 = el('input', { type: 'color', value: '#c99a3a' });
        const len = el('input', { type: 'number', min: 0.5, max: 600, step: 0.5, value: 5 });
        openDialog({
            title: 'Colour or gradient card',
            intro: 'A plain or gradient picture the size of your frame — for an intro, a pause, or behind a title. It goes on the main video track at the playhead.',
            body: [dialogField('Style', style), dialogField('Colour', c1), dialogField('Second colour', c2), dialogField('Length (s)', len)],
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Add card', primary: true,
                    run: async function () {
                        const p = state.project;
                        const file = await makeCard(p.width, p.height, style.value, c1.value, c2.value);
                        const ids = await importFiles([file], { fresh: true, origin: 'card', noCommit: true });
                        const media = ids[0] && T.getMedia(state.project, ids[0]);
                        const track = T.lowestTrack(state.project, 'video');
                        if (!media || !track) return;
                        const clip = Object.assign(T.clipFromMedia(media, track.id, state.time), { duration: Math.max(0.5, Number(len.value) || 5), fit: 'cover' });
                        const next = T.addClip(state.project, clip);
                        if (next !== state.project) {
                            state.project = next;
                            state.selection = [clip.id];
                            state.selected = clip.id;
                        }
                        commit();
                    }
                }
            ]
        });
    }
    tools.push({ section: 'Create', label: 'Colour or gradient card…', run: colourCardDialog });
    tools.push({ section: 'Create', label: '✍ Title written by hand (W)', run: addHandwrittenTitle });
    tools.push({ section: 'Create', label: '✎ Drawing (D)', run: function () { openDrawMode(); } });

    /* -------------------------------------------------------------- inspector */

    function group(title, children) {
        return el('div', { className: 'group' }, [el('div', { className: 'group-title', text: title })].concat(children));
    }

    /**
     * A labelled control. `live` runs on every input so the preview follows
     * the pointer; the edit becomes one undo step when the control changes.
     */
    function control(label, input, output) {
        const id = 'f-' + Math.random().toString(36).slice(2, 8);
        input.id = id;
        return el('div', { className: 'field' + (output ? '' : ' wide') }, [el('label', { for: id, text: label }), input, output || null]);
    }

    function liveEdit(id, patch) {
        state.project = T.updateClip(state.project, id, patch);
        scheduleTimeline();
        requestDraw();
    }

    function slider(clip, label, get, set, opts) {
        const o = Object.assign({ min: 0, max: 100, step: 1, show: (v) => String(v) }, opts);
        const value = get(clip);
        const out = el('output', { text: o.show(value) });
        const input = el('input', { type: 'range', min: o.min, max: o.max, step: o.step, value: value });
        input.addEventListener('input', function () {
            const v = Number(input.value);
            out.textContent = o.show(v);
            liveEdit(clip.id, set(v));
        });
        input.addEventListener('change', commitQuiet);
        return control(label, input, out);
    }

    /** A dropdown that commits a whole new project from its value. */
    function chooser(label, value, options, onPick) {
        const input = el('select', null, options.map((o) => el('option', { value: o[0], text: o[1] })));
        input.value = value;
        input.addEventListener('change', function () { apply(onPick(input.value)); });
        return control(label, input);
    }

    function select_(clip, label, key, options) {
        return chooser(label, clip[key], options, function (v) {
            const patch = {};
            patch[key] = v;
            return T.updateClip(state.project, clip.id, patch);
        });
    }

    function checkbox(clip, label, key) {
        const input = el('input', { type: 'checkbox' });
        input.checked = !!clip[key];
        input.addEventListener('change', function () {
            const patch = {};
            patch[key] = input.checked;
            apply(T.updateClip(state.project, clip.id, patch));
        });
        return el('label', { className: 'check' }, [input, label]);
    }

    function colour(clip, label, key) {
        const input = el('input', { type: 'color', value: clip[key] || '#ffffff' });
        input.addEventListener('input', function () {
            const patch = {};
            patch[key] = input.value;
            liveEdit(clip.id, patch);
        });
        input.addEventListener('change', commitQuiet);
        return control(label, input);
    }

    function timeField(label, value, onSet) {
        const input = el('input', { type: 'number', min: 0, step: 0.01, value: value.toFixed(2) });
        input.addEventListener('change', function () {
            const v = Number(input.value);
            if (!isFinite(v)) return;
            if (!apply(onSet(v))) input.value = value.toFixed(2);
        });
        return control(label, input, el('output', { text: 's' }));
    }

    function button(label, run, opts) {
        const o = opts || {};
        return el('button', { className: o.primary ? 'primary' : 'ghost', text: label, title: o.title, disabled: o.disabled, onclick: run });
    }
    const pct = (v) => Math.round(v) + '%';
    const secs = (v) => Number(v).toFixed(1) + 's';

    /** A clip's effects as they are now (not as they were when the inspector was drawn). */
    function fxNow(id) {
        return T.fxOf(T.getClip(state.project, id));
    }

    /** A slider over an effect: `get` reads the effects, `set` returns an effects patch. */
    function fxSlider(clip, label, get, set, opts) {
        return slider(clip, label, (c) => get(T.fxOf(c)), (v) => ({ fx: set(v) }), opts);
    }

    function fxCheck(clip, label, key) {
        const input = el('input', { type: 'checkbox' });
        input.checked = !!T.fxOf(clip)[key];
        input.addEventListener('change', function () {
            const patch = {};
            patch[key] = input.checked;
            apply(T.updateClip(state.project, clip.id, { fx: patch }));
        });
        return el('label', { className: 'check' }, [input, label]);
    }

    function fxColour(clip, label, get, set) {
        const input = el('input', { type: 'color', value: get() });
        input.addEventListener('input', function () { liveEdit(clip.id, { fx: set(input.value) }); });
        input.addEventListener('change', commitQuiet);
        return control(label, input);
    }

    /** The playhead as seconds into a clip, kept inside it. */
    function localTime(clip) {
        return T.clamp(state.time - clip.start, 0, clip.duration);
    }

    /**
     * A Layout slider (as a percentage). On a clip with keyframes it shows and
     * changes the keyframe at the playhead instead of the clip's own value.
     */
    function layoutSlider(clip, label, prop, opts) {
        const keyed = clip.keys && clip.keys.length;
        const now = () => {
            const c = T.getClip(state.project, clip.id) || clip;
            const kf = T.keyframeAt(c, state.time);
            const v = kf ? kf[prop] : (c[prop] === undefined ? (prop === 'x' || prop === 'y' ? 0.5 : 1) : c[prop]);
            return Math.round(v * 100);
        };
        if (!keyed) return slider(clip, label, now, (v) => { const o = {}; o[prop] = v / 100; return o; }, opts);
        const o = Object.assign({ min: 0, max: 100, step: 1, show: (v) => String(v) }, opts);
        const out = el('output', { text: o.show(now()) });
        const input = el('input', { type: 'range', min: o.min, max: o.max, step: o.step, value: now() });
        input.addEventListener('input', function () {
            const v = Number(input.value);
            out.textContent = o.show(v);
            const patch = {};
            patch[prop] = v / 100;
            state.project = T.setKeyframe(state.project, clip.id, localTime(clip), patch);
            scheduleTimeline();
            requestDraw();
        });
        input.addEventListener('change', function () { commitQuiet(); renderInspector(); });
        return control(label, input, out);
    }

    /** Ready-made keyframe animations: [label, keyframes from the clip's current look]. */
    const KEY_RECIPES = [
        ['Move left → right', (b, d) => [{ t: 0, x: 0.2 }, { t: d, x: 0.8 }]],
        ['Move right → left', (b, d) => [{ t: 0, x: 0.8 }, { t: d, x: 0.2 }]],
        ['Float up', (b, d) => [{ t: 0, y: Math.min(0.9, b.y + 0.15), opacity: 0 }, { t: Math.min(1, d / 2), opacity: b.opacity }, { t: d, y: b.y }]],
        ['Grow', (b, d) => [{ t: 0, scale: b.scale * 0.6 }, { t: d, scale: b.scale * 1.15 }]],
        ['Spin', (b, d) => [{ t: 0, rotate: 0 }, { t: d, rotate: 360 }]],
        ['Swing', (b, d) => [{ t: 0, rotate: -12 }, { t: d / 4, rotate: 12 }, { t: d / 2, rotate: -12 }, { t: 3 * d / 4, rotate: 12 }, { t: d, rotate: 0 }]],
        ['Fly across', (b, d) => [{ t: 0, x: -0.2, rotate: -10 }, { t: d, x: 1.2, rotate: 10 }]]
    ];

    /** Keyframes: animate position, size, turn and opacity between moments you choose. */
    function keyframeGroup(clip) {
        const keys = clip.keys || [];
        const items = [];
        if (!keys.length) {
            items.push(el('p', { className: 'hint', text: 'Animate anything: move the playhead, set Position, Scale, Turn or Opacity, and add a keyframe. Add another at a later moment with different values — the clip moves smoothly between them.' }));
        }
        items.push(el('div', { className: 'row-buttons' }, [
            button('◆ Add keyframe here', function () {
                apply(T.setKeyframe(state.project, clip.id, localTime(clip), {}));
            }, { title: 'Keep the clip’s position, size, turn and opacity at the playhead' }),
            keys.length ? button('Clear keyframes', function () { apply(T.updateClip(state.project, clip.id, { keys: null })); }) : null
        ]));
        // Turning is keyframed only: a turn always goes into the keyframe at the playhead.
        const kfNow = T.keyframeAt(clip, state.time);
        const turnOut = el('output', { text: Math.round(kfNow ? kfNow.rotate : 0) + '°' });
        const turn = el('input', { type: 'range', min: -360, max: 360, step: 1, value: Math.round(kfNow ? kfNow.rotate : 0) });
        turn.addEventListener('input', function () {
            turnOut.textContent = turn.value + '°';
            state.project = T.setKeyframe(state.project, clip.id, localTime(clip), { rotate: Number(turn.value) });
            scheduleTimeline();
            requestDraw();
        });
        turn.addEventListener('change', function () { commitQuiet(); renderInspector(); });
        items.push(control('Turn', turn, turnOut));
        if (keys.length) {
            items.push(el('div', { className: 'key-list' }, keys.map(function (k, i) {
                return el('span', { className: 'key-chip' }, [
                    el('button', { className: 'ghost', text: '◆ ' + fmt(clip.start + k.t), title: 'Go to this keyframe', onclick: function () { seek(clip.start + k.t + 1e-4); renderInspector(); } }),
                    el('button', { className: 'ghost', text: '×', 'aria-label': 'Delete keyframe at ' + fmt(clip.start + k.t), onclick: function () { apply(T.removeKeyframe(state.project, clip.id, i)); } })
                ]);
            })));
        }
        items.push(chooser('Quick animation', 'none', [['none', 'Choose…']].concat(KEY_RECIPES.map((r, i) => [String(i), r[0]])), function (v) {
            if (v === 'none') return state.project;
            const c = T.getClip(state.project, clip.id);
            const base = { x: c.x === undefined ? 0.5 : c.x, y: c.y === undefined ? 0.5 : c.y, scale: c.scale || 1, opacity: c.opacity === undefined ? 1 : c.opacity };
            let p = T.updateClip(state.project, clip.id, { keys: null });
            KEY_RECIPES[Number(v)][1](base, c.duration).forEach(function (k) {
                const vals = Object.assign({}, k);
                delete vals.t;
                p = T.setKeyframe(p, clip.id, k.t, vals);
            });
            return p;
        }));
        return group('Keyframes', items);
    }

    /** How a clip leaves: its exit movement and how long it takes. */
    function exitControls(clip) {
        const on = EXIT_LABELS[clip.exit] && clip.exit !== 'none';
        return [
            chooser('Exit', on ? clip.exit : 'none', Object.keys(EXIT_LABELS).map((k) => [k, EXIT_LABELS[k]]),
                (v) => T.updateClip(state.project, clip.id, { exit: v === 'none' ? null : v })),
            on ? slider(clip, 'Exit time', (c) => c.exitDuration || 0.6, (v) => ({ exitDuration: v }), { min: 0.1, max: 3, step: 0.1, show: secs }) : null
        ];
    }

    /** Which hand a title or drawing shows while it appears, its skin colour and size. */
    function handControls(clip, tools) {
        const H = window.ReelHands;
        if (!H) return [];
        const hand = tools.indexOf(clip.hand) !== -1 ? clip.hand : 'none';
        const realistic = clip.handStyle === 'realistic';
        const out = [chooser('Hand', hand, [['none', 'No hand']].concat(tools.map((k) => [k, H.TOOLS[k]])),
            (v) => T.updateClip(state.project, clip.id, { hand: v, handStyle: v === 'pencil' && realistic ? 'sketch' : clip.handStyle }))];
        if (hand === 'none') return out;
        const styles = hand === 'finger'
            ? [['realistic', 'Real hand · typing finger'], ['emoji', 'Illustrated typing hand']]
            : Object.keys(H.STYLES).map((k) => [k, H.STYLES[k]]);
        const chosenStyle = hand === 'finger' ? (clip.handStyle === 'realistic' ? 'realistic' : 'emoji') : (H.STYLES[clip.handStyle] ? clip.handStyle : 'emoji');
        out.push(chooser('Hand style', chosenStyle, styles,
            (v) => T.updateClip(state.project, clip.id, { handStyle: v, hand: v === 'realistic' && hand !== 'finger' ? 'pen' : hand })));
        if (!realistic) out.push(chooser('Skin', H.SKINS[clip.handSkin] ? clip.handSkin : 'yellow', Object.keys(H.SKINS).map((k) => [k, H.SKINS[k].label]),
            (v) => T.updateClip(state.project, clip.id, { handSkin: v })));
        out.push(slider(clip, 'Hand size', (c) => Math.round((c.handSize || 1) * 100), (v) => ({ handSize: v / 100 }), { min: 20, max: 400, step: 5, show: pct }));
        out.push(el('div', { className: 'row-buttons' }, [
            button('Small', () => apply(T.updateClip(state.project, clip.id, { handSize: .6 }))),
            button('Reset size', () => apply(T.updateClip(state.project, clip.id, { handSize: 1 }))),
            button('Large', () => apply(T.updateClip(state.project, clip.id, { handSize: 1.8 })))
        ]));
        if (clip.anim === 'handwrite') out.push(slider(clip, 'Write time', c => c.writeDuration || c.duration * .75,
            v => ({ writeDuration: v }), { min: .5, max: Math.max(.5,clip.duration*.9), step: .1, show: secs }));
        out.push(el('p', { className: 'hint', text: 'Hand size changes only the hand, not the text. Preview and exported video use the same size.' }));
        if (hand !== 'finger' && !realistic) {
            const toolName = hand === 'pencil' ? 'Pencil' : 'Pen';
            const own = /^#[0-9a-f]{6}$/i.test(clip.penColor || '');
            const sameAs = clip.type === 'draw' ? 'Same as the drawing' : 'Same as the text';
            out.push(chooser(toolName + ' colour', own ? 'own' : 'ink', [['ink', sameAs], ['own', 'Choose a colour']], function (v) {
                const ink = clip.type === 'draw' ? ((clip.strokes || [])[0] || {}).color : clip.color;
                return T.updateClip(state.project, clip.id, { penColor: v === 'own' ? (ink && !H.pale(ink) ? ink : '#1b1b1d') : null });
            }));
            if (own) {
                const input = el('input', { type: 'color', value: clip.penColor });
                input.addEventListener('input', function () { liveEdit(clip.id, { penColor: input.value }); });
                input.addEventListener('change', commitQuiet);
                out.push(control('Colour of the ' + toolName.toLowerCase(), input));
            }
        }
        return out;
    }

    const HIDE_DEFAULT = { shape: 'oval', mode: 'blur', x: 0.5, y: 0.35, w: 0.3, h: 0.4, strength: 0.6, color: '#000000' };

    function fontSelect(clip) {
        const latin = [];
        const arabic = [];
        Object.keys(FONTS).forEach(function (k) { (FONTS[k].arabic ? arabic : latin).push([k, FONTS[k].label]); });
        const input = el('select', null, [
            el('optgroup', { label: 'Latin' }, latin.map((o) => el('option', { value: o[0], text: o[1] }))),
            el('optgroup', { label: 'Arabic' }, arabic.map((o) => el('option', { value: o[0], text: o[1] })))
        ]);
        input.value = clip.font;
        input.addEventListener('change', function () { apply(T.updateClip(state.project, clip.id, { font: input.value })); });
        return control('Font', input);
    }

    function renderInspector() {
        const box = $('inspector');
        box.textContent = '';
        if (state.selection.length > 1) { renderMultiInspector(box); return; }
        const clip = selectedClip();
        if (!clip) {
            if (state.marker) renderMarkerInspector(box);
            else renderProjectInspector(box);
            return;
        }
        const p = state.project;
        const kind = T.clipKind(p, clip);
        const media = T.isGenerated(clip) ? null : T.getMedia(p, clip.mediaId);
        const kindLabel = clip.type === 'draw' ? 'Drawing' : clip.freeze ? 'Freeze' : clip.audioOnly ? 'Sound' : { video: 'Video', image: 'Image', audio: 'Audio', text: 'Title' }[kind];
        const timed = T.isTimed(p, clip);
        const underPlayhead = state.time > clip.start && state.time < T.clipEnd(clip);

        box.append(el('div', { className: 'insp-title' }, [
            el('span', { className: 'chip', text: kindLabel }),
            el('span', { text: media ? media.name : kindLabel, title: media ? media.name : '' })
        ]));

        const timing = [
            timeField('Start', clip.start, (v) => T.moveClip(state.project, clip.id, v)),
            timeField('Length', clip.duration, (v) => T.trimClip(state.project, clip.id, 'end', clip.start + v))
        ];
        if (timed) {
            timing.push(chooser('Speed', String(T.speedOf(clip)), SPEEDS.map((s) => [String(s), s + '×' + (s === 1 ? ' (normal)' : '')]),
                (v) => T.setSpeed(state.project, clip.id, Number(v))));
            timing.push(control('From', el('input', { type: 'text', value: fmt(clip.in) + ' in source', readonly: true, tabindex: '-1' })));
        }
        box.append(group('Timing', timing));

        const actions = [];
        if ((kind === 'video' || kind === 'image') && window.ReelEffects) actions.push(button('Remove / replace background', function () { window.ReelEffects.openBackground(); }));
        if (kind === 'video' && !clip.freeze && !clip.audioOnly) {
            actions.push(button('Freeze frame', freezeSelected, { disabled: !underPlayhead, title: 'Hold the frame under the playhead for 2 s (F)' }));
            actions.push(button('Detach audio', detachSelected, { title: 'Move the sound to its own clip on an audio track' }));
        }
        if (timed && window.ReelMix && window.ReelMix.canCleanVoice()) {
            actions.push(button('Clean up voice', function () { window.ReelMix.cleanVoiceDialog(clip.id); }, { title: 'AI noise removal on this clip’s sound' }));
        }
        if (timed && audioEditorAvailable) {
            actions.push(button('Edit in audio editor', function () { sendToAudioEditor(clip.id); }, { title: 'Open this clip’s sound in the audio editor' }));
        }
        if (actions.length) box.append(group('Tools', [el('div', { className: 'row-buttons' }, actions)]));

        if (clip.type === 'text') {
            if (T.REVEAL_ANIMS.includes(clip.anim)) box.append(group('Writing hand', handControls(clip, ['pen','pencil','finger'])));
            if (clip.lyricStyle) box.append(group('Lyrics', [
                select_(clip, 'Style', 'lyricStyle', [['karaoke','Word highlight'],['plain','Plain captions']]),
                colour(clip, 'Highlight', 'lyricHighlight')
            ]));
            const area = el('textarea', { rows: 3, spellcheck: 'true', dir: 'auto' });
            area.value = clip.text;
            area.addEventListener('input', function () { liveEdit(clip.id, { text: area.value }); });
            area.addEventListener('change', commitQuiet);
            box.append(group('Text', [
                el('div', { className: 'row-buttons' }, Object.keys(T.TITLE_STYLES).map(function (k) {
                    return button(T.TITLE_STYLES[k].label, function () { apply(T.updateClip(state.project, clip.id, T.TITLE_STYLES[k].patch)); });
                })),
                window.ReelTrends ? el('div', { className: 'row-buttons' }, [button('✦ Text designs…', function () { window.ReelTrends.openDesigns(clip.id); })]) : null,
                control('Text', area),
                // Right under the text, where it is easy to find on a phone too.
                el('div', { className: 'row-buttons' }, [
                    button('✍ Write by hand', function () { apply(T.updateClip(state.project, clip.id, { anim: 'handwrite', hand: 'pen', handStyle: 'realistic' })); writingSound(clip.id, 'chalk'); },
                        { title: 'The title is written out by a hand holding a pen' }),
                    button('⌨ Type with real hand', function () { apply(T.updateClip(state.project, clip.id, { anim: 'typewriter', hand: 'finger', handStyle: 'realistic', handSkin: 'medium' })); writingSound(clip.id, 'typing'); },
                        { title: 'The title is typed letter by letter by a real tapping finger' })
                ]),
                fontSelect(clip),
                slider(clip, 'Size', (c) => c.fontSize, (v) => ({ fontSize: v }), { min: 12, max: 240, show: (v) => v + 'px' }),
                colour(clip, 'Colour', 'color'),
                select_(clip, 'Align', 'align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]),
                el('div', { className: 'row-buttons' }, [checkbox(clip, 'Bold', 'bold'), checkbox(clip, 'Italic', 'italic'), checkbox(clip, 'Shadow', 'shadow')]),
                el('div', { className: 'row-buttons' }, [checkbox(clip, 'Background box', 'box')]),
                clip.box ? colour(clip, 'Box colour', 'boxColor') : null,
                slider(clip, 'Outline', (c) => (c.outline && c.outline.width) || 0,
                    (v) => ({ outline: { width: v, color: (T.getClip(state.project, clip.id).outline || {}).color || '#000000' } }), { max: 12, show: (v) => v + 'px' }),
                (function () {
                    const input = el('input', { type: 'color', value: (clip.outline && clip.outline.color) || '#000000' });
                    input.addEventListener('input', function () {
                        const width = (T.getClip(state.project, clip.id).outline || {}).width || 0;
                        liveEdit(clip.id, { outline: { width: width, color: input.value } });
                    });
                    input.addEventListener('change', commitQuiet);
                    return control('Outline colour', input);
                }()),
                (function () {
                    const on = el('input', { type: 'checkbox' });
                    on.checked = !!clip.glow;
                    const pick = el('input', { type: 'color', value: clip.glow || '#ff3fd2' });
                    on.addEventListener('change', function () { apply(T.updateClip(state.project, clip.id, { glow: on.checked ? pick.value : null })); });
                    pick.addEventListener('input', function () { if (on.checked) liveEdit(clip.id, { glow: pick.value }); });
                    pick.addEventListener('change', commitQuiet);
                    return control('Glow', el('div', { className: 'row-buttons' }, [el('label', { className: 'check' }, [on, 'Neon glow']), pick]));
                }())
            ]));
            box.append(group('Animation', [
                select_(clip, 'Entrance', 'anim', Object.keys(ANIM_LABELS).map((k) => [k, ANIM_LABELS[k]])),
                window.ReelSounds && window.ReelSounds.addWritingSound ? control('Writing sound', el('div', { className: 'row-buttons' }, [
                    button('Chalk', function () { writingSound(clip.id, 'chalk'); }, { title: 'Chalk on a board, one stroke as each letter appears' }),
                    button('Pencil', function () { writingSound(clip.id, 'pencil'); }, { title: 'Pencil on paper, one stroke as each letter appears' }),
                    button('Keys', function () { writingSound(clip.id, 'typing'); }, { title: 'Keyboard typing, one key as each letter appears' })
                ])) : null,
                clip.anim && T.MOVES.indexOf(clip.anim) !== -1
                    ? slider(clip, 'Duration', (c) => c.animDuration || 0.6, (v) => ({ animDuration: v }), { min: 0.1, max: 3, step: 0.1, show: secs })
                    : null
            ].concat(exitControls(clip))));
        } else if (clip.sticker) {
            box.append(group('Animated sticker', [button('Edit sticker / arrow', function () { window.ReelEffects.openStickers(); })]));
        } else if (clip.type === 'draw') {
            const n = (clip.strokes || []).length;
            box.append(group('Drawing', [
                el('div', { className: 'row-buttons' }, [button('✎ Edit drawing', function () { openDrawMode(clip.id); }, { title: 'Draw more, rub out or change it (double-click the clip)' })]),
                el('p', { className: 'hint', text: n + (n === 1 ? ' stroke' : ' strokes') + '. Move and size it under Layout.' })
            ]));
            box.append(group('Animation', [
                chooser('Entrance', DRAW_ANIM_LABELS[clip.anim] ? clip.anim : 'draw', Object.keys(DRAW_ANIM_LABELS).map((k) => [k, DRAW_ANIM_LABELS[k]]),
                    (v) => T.updateClip(state.project, clip.id, { anim: v })),
                clip.anim === 'draw'
                    ? slider(clip, 'Drawing time', (c) => c.animDuration || 3, (v) => ({ animDuration: v }), { min: 0.5, max: 30, step: 0.5, show: secs })
                    : null
            ].concat(clip.anim === 'draw' ? handControls(clip, ['pen', 'pencil']) : [], exitControls(clip))));
        }
        if (kind !== 'audio') {
            const layout = [];
            if (kind !== 'text') {
                layout.push(select_(clip, 'Fit', 'fit', [['contain', 'Fit inside (letterbox)'], ['cover', 'Fill frame (crop)']]));
                if (clip.fit !== 'cover') layout.push(select_(clip, 'Bars', 'bgFill', [['none', 'Plain background'], ['blur', 'Blurred copy (for Reels)']]));
            }
            if (clip.type !== 'text') {
                layout.push(layoutSlider(clip, 'Scale', 'scale', { min: 10, max: 300, show: pct }));
            }
            layout.push(layoutSlider(clip, 'Position X', 'x', { show: pct }));
            layout.push(layoutSlider(clip, 'Position Y', 'y', { show: pct }));
            layout.push(layoutSlider(clip, 'Opacity', 'opacity', { show: pct }));
            if (clip.keys && clip.keys.length) layout.push(el('p', { className: 'hint', text: 'This clip has keyframes: these sliders change the keyframe at the playhead (adding one if needed).' }));
            layout.push(el('div', { className: 'row-buttons' }, [
                ['Full', { scale: 1, x: 0.5, y: 0.5 }],
                ['Corner', clip.type === 'text' ? { x: 0.8, y: 0.12 } : { scale: 0.3, x: 0.82, y: 0.18 }],
                ['Lower third', clip.type === 'text' ? { x: 0.5, y: 0.84 } : { scale: 0.4, x: 0.5, y: 0.78 }]
            ].map(function (preset) {
                return button(preset[0], function () { apply(T.updateClip(state.project, clip.id, preset[1])); });
            })));
            box.append(group('Layout', layout));
            box.append(keyframeGroup(clip));
        }

        if (kind === 'video' || kind === 'image') {
            box.append(group('Animation', [
                chooser('Entrance', ENTER_LABELS[clip.enter] ? clip.enter : 'none', Object.keys(ENTER_LABELS).map((k) => [k, ENTER_LABELS[k]]),
                    (v) => T.updateClip(state.project, clip.id, { enter: v === 'none' ? null : v })),
                ENTER_LABELS[clip.enter] && clip.enter !== 'none'
                    ? slider(clip, 'Duration', (c) => c.enterDuration || 0.6, (v) => ({ enterDuration: v }), { min: 0.1, max: 3, step: 0.1, show: secs })
                    : null
            ].concat(exitControls(clip))));
            const motion = clip.motion || { type: 'none', amount: 0.15 };
            box.append(group('Motion', [
                chooser('Pan & zoom', motion.type || 'none', Object.keys(MOTION_LABELS).map((k) => [k, MOTION_LABELS[k]]),
                    (v) => T.updateClip(state.project, clip.id, { motion: v === 'none' ? null : { type: v, amount: motion.amount || 0.15 } })),
                motion.type && motion.type !== 'none'
                    ? slider(clip, 'Amount', (c) => Math.round(((c.motion && c.motion.amount) || 0.15) * 100),
                        (v) => ({ motion: { type: clip.motion.type, amount: v / 100 } }), { min: 5, max: 50, show: pct })
                    : null
            ]));
            const fx = T.fxOf(clip);
            box.append(group('Look', [
                chooser('Look', fx.look || 'none', Object.keys(T.LOOKS).map((k) => [k, T.LOOKS[k].label]), (v) => T.applyLook(state.project, clip.id, v)),
                fxColour(clip, 'Tint', () => (fx.tint && fx.tint.color) || '#ff9a3c',
                    (v) => ({ tint: { color: v, amount: (fxNow(clip.id).tint || {}).amount || 0.3 } })),
                fxSlider(clip, 'Tint amount', (f) => Math.round(((f.tint && f.tint.amount) || 0) * 100),
                    (v) => ({ tint: v ? { color: (fxNow(clip.id).tint || {}).color || '#ff9a3c', amount: v / 100 } : null }), { show: pct }),
                fxSlider(clip, 'Vignette', (f) => Math.round(f.vignette * 100), (v) => ({ vignette: v / 100 }), { show: pct }),
                fxSlider(clip, 'Film grain', (f) => Math.round(f.grain * 100), (v) => ({ grain: v / 100 }), { show: pct })
            ]));
            const turn = (d) => function () { apply(T.updateClip(state.project, clip.id, { fx: { rotate: ((fxNow(clip.id).rotate + d + 540) % 360) - 180 } })); };
            box.append(group('Transform', [
                el('div', { className: 'row-buttons' }, [fxCheck(clip, 'Mirror', 'flipH'), fxCheck(clip, 'Upside down', 'flipV')]),
                fxSlider(clip, 'Rotate', (f) => f.rotate, (v) => ({ rotate: v }), { min: -180, max: 180, show: (v) => v + '°' }),
                el('div', { className: 'row-buttons' }, [button('↺ 90°', turn(-90)), button('↻ 90°', turn(90)),
                    button('Straight', function () { apply(T.updateClip(state.project, clip.id, { fx: { rotate: 0 } })); })]),
                fxSlider(clip, 'Crop left', (f) => Math.round(f.crop.l * 100), (v) => ({ crop: { l: v / 100 } }), { max: 45, show: pct }),
                fxSlider(clip, 'Crop right', (f) => Math.round(f.crop.r * 100), (v) => ({ crop: { r: v / 100 } }), { max: 45, show: pct }),
                fxSlider(clip, 'Crop top', (f) => Math.round(f.crop.t * 100), (v) => ({ crop: { t: v / 100 } }), { max: 45, show: pct }),
                fxSlider(clip, 'Crop bottom', (f) => Math.round(f.crop.b * 100), (v) => ({ crop: { b: v / 100 } }), { max: 45, show: pct })
            ]));
            box.append(group('Frame', [
                fxSlider(clip, 'Corners', (f) => Math.round(f.radius * 100), (v) => ({ radius: v / 100 }), { show: pct }),
                fxSlider(clip, 'Border', (f) => f.border.width, (v) => ({ border: { width: v } }), { max: 30, show: (v) => v + 'px' }),
                fxColour(clip, 'Border colour', () => fx.border.color, (v) => ({ border: { color: v } })),
                fxCheck(clip, 'Drop shadow', 'shadow'),
                el('p', { className: 'hint', text: 'For picture-in-picture: scale the clip down in Layout, then round it, frame it and give it a shadow.' })
            ]));
            const hideOn = el('input', { type: 'checkbox' });
            hideOn.checked = !!fx.hide;
            hideOn.addEventListener('change', function () {
                apply(T.updateClip(state.project, clip.id, { fx: { hide: hideOn.checked ? Object.assign({}, HIDE_DEFAULT) : null } }));
            });
            const hideRows = [el('label', { className: 'check' }, [hideOn, 'Hide an area — a face, a number plate, a logo'])];
            if (fx.hide) {
                const h = fx.hide;
                hideRows.push(
                    chooser('Shape', h.shape, [['oval', 'Oval'], ['rect', 'Rectangle']], (v) => T.updateClip(state.project, clip.id, { fx: { hide: { shape: v } } })),
                    chooser('Cover with', h.mode, [['blur', 'Blur'], ['pixelate', 'Pixelate'], ['solid', 'Solid colour']], (v) => T.updateClip(state.project, clip.id, { fx: { hide: { mode: v } } })),
                    h.mode === 'solid'
                        ? fxColour(clip, 'Colour', () => h.color || '#000000', (v) => ({ hide: { color: v } }))
                        : fxSlider(clip, 'Strength', (f) => Math.round(f.hide.strength * 100), (v) => ({ hide: { strength: v / 100 } }), { min: 10, show: pct }),
                    fxSlider(clip, 'Across', (f) => Math.round(f.hide.x * 100), (v) => ({ hide: { x: v / 100 } }), { show: pct }),
                    fxSlider(clip, 'Down', (f) => Math.round(f.hide.y * 100), (v) => ({ hide: { y: v / 100 } }), { show: pct }),
                    fxSlider(clip, 'Width', (f) => Math.round(f.hide.w * 100), (v) => ({ hide: { w: v / 100 } }), { min: 2, show: pct }),
                    fxSlider(clip, 'Height', (f) => Math.round(f.hide.h * 100), (v) => ({ hide: { h: v / 100 } }), { min: 2, show: pct }),
                    el('p', { className: 'hint', text: 'The dashed outline shows the area while the clip is selected; it is not in the exported video. The area moves with the picture.' })
                );
            }
            box.append(group('Hide an area', hideRows));
            box.append(group('Colour', [
                slider(clip, 'Brightness', (c) => c.filters.brightness, (v) => ({ filters: { brightness: v } }), { max: 200, show: pct }),
                slider(clip, 'Contrast', (c) => c.filters.contrast, (v) => ({ filters: { contrast: v } }), { max: 200, show: pct }),
                slider(clip, 'Saturation', (c) => c.filters.saturate, (v) => ({ filters: { saturate: v } }), { max: 200, show: pct }),
                slider(clip, 'Greyscale', (c) => c.filters.grayscale, (v) => ({ filters: { grayscale: v } }), { show: pct }),
                slider(clip, 'Sepia', (c) => c.filters.sepia || 0, (v) => ({ filters: { sepia: v } }), { show: pct }),
                slider(clip, 'Hue', (c) => c.filters.hue || 0, (v) => ({ filters: { hue: v } }), { min: -180, max: 180, show: (v) => v + '°' }),
                slider(clip, 'Blur', (c) => c.filters.blur || 0, (v) => ({ filters: { blur: v } }), { max: 20, step: 0.5, show: (v) => v + 'px' }),
                el('div', { className: 'row-buttons' }, [button('Reset colour', function () {
                    apply(T.updateClip(state.project, clip.id, { filters: T.clone(T.DEFAULT_FILTERS) }));
                })])
            ]));
        }

        if (timed) {
            const track = T.getTrack(p, clip.track);
            const sound = [
                slider(clip, 'Volume', (c) => Math.round(c.volume * 100), (v) => ({ volume: v / 100 }), { max: 200, show: pct }),
                checkbox(clip, 'Mute this clip', 'muted')
            ];
            const levels = files.get(clip.mediaId);
            if (levels && levels.peaks) {
                sound.push(el('div', { className: 'row-buttons' }, [button('Normalise loudness', function () {
                    const peak = T.clipPeak(T.getClip(state.project, clip.id), levels.peaks, levels.peakRate);
                    const vol = T.normalisedVolume(peak);
                    apply(T.updateClip(state.project, clip.id, { volume: vol }));
                    toast('Volume set to ' + Math.round(vol * 100) + '% — the loudest moment now peaks just under full scale.');
                }, { title: 'Set the volume so the loudest moment of this clip is just under full scale' })]));
            }
            if (track && track.kind === 'audio') {
                const duck = el('input', { type: 'checkbox' });
                duck.checked = !!track.duck;
                duck.addEventListener('change', function () { apply(T.updateTrack(state.project, track.id, { duck: duck.checked })); });
                sound.push(el('label', { className: 'check', title: 'For background sound, such as a nasheed: the whole track goes quieter while anything else is speaking' }, [duck, 'Duck ' + track.id + ' under speech']));
            }
            box.append(group('Sound', sound));
        }

        box.append(transitionGroup(clip));

        const maxFade = Math.max(0.1, Math.min(10, clip.duration));
        box.append(group('Fades', [
            slider(clip, 'Fade in', (c) => c.fadeIn || 0, (v) => ({ fadeIn: Math.min(v, clip.duration) }), { max: maxFade, step: 0.1, show: secs }),
            slider(clip, 'Fade out', (c) => c.fadeOut || 0, (v) => ({ fadeOut: Math.min(v, clip.duration) }), { max: maxFade, step: 0.1, show: secs })
        ]));

        box.append(el('div', { className: 'row-buttons' }, [
            el('button', { text: 'Split at playhead', onclick: splitSelected }),
            el('button', { text: 'Duplicate', onclick: duplicateSelected }),
            el('button', { text: 'Delete', onclick: function () { deleteSelected(false); } })
        ]));
    }

    function transitionGroup(clip) {
        const prev = T.previousAdjacent(state.project, clip);
        const tr = clip.transition || { type: 'none', duration: 1 };
        const rows = [];
        if (!prev) {
            rows.push(el('p', { className: 'hint', text: 'Put a clip right before this one on the same track (snap them together) to add a transition between them.' }));
        } else {
            rows.push(chooser('Type', tr.type || 'none', Object.keys(TRANSITION_LABELS).map((k) => [k, TRANSITION_LABELS[k]]),
                (v) => T.setTransition(state.project, clip.id, v, tr.duration || 1)));
            if (tr.type && tr.type !== 'none') {
                rows.push(slider(clip, 'Duration', (c) => (c.transition && c.transition.duration) || 1,
                    (v) => ({ transition: { type: clip.transition.type, duration: v } }), { min: 0.2, max: 3, step: 0.1, show: secs }));
            }
        }
        return group('Transition in', rows);
    }

    function renderMultiInspector(box) {
        const clips = selectedClips();
        const visual = clips.filter((c) => { const k = T.clipKind(state.project, c); return k === 'video' || k === 'image'; });
        const texts = clips.filter((c) => c.type === 'text');
        const withPrev = clips.filter((c) => T.previousAdjacent(state.project, c));
        box.append(el('div', { className: 'insp-title' }, [el('span', { className: 'chip', text: 'Selection' }), el('span', { text: clips.length + ' clips' })]));
        const rows = [
            el('div', { className: 'row-buttons' }, [
                button('Copy', copySelected),
                button('Delete', function () { deleteSelected(false); }),
                button('Delete & close gaps', function () { deleteSelected(true); })
            ])
        ];
        if (withPrev.length) {
            rows.push(chooser('Transition', 'keep', [['keep', 'Set transition…']].concat(Object.keys(TRANSITION_LABELS).map((k) => [k, TRANSITION_LABELS[k]])),
                function (v) {
                    if (v === 'keep') return state.project;
                    let p = state.project;
                    withPrev.forEach(function (c) { p = T.setTransition(p, c.id, v, 1); });
                    return p;
                }));
        }
        if (visual.length) {
            rows.push(chooser('Look', 'keep', [['keep', 'Set look…']].concat(Object.keys(T.LOOKS).map((k) => [k, T.LOOKS[k].label])),
                function (v) {
                    if (v === 'keep') return state.project;
                    let p = state.project;
                    visual.forEach(function (c) { p = T.applyLook(p, c.id, v); });
                    return p;
                }));
            rows.push(chooser('Pan & zoom', 'keep', [['keep', 'Set motion…']].concat(Object.keys(MOTION_LABELS).map((k) => [k, MOTION_LABELS[k]])),
                (v) => v === 'keep' ? state.project : T.updateClips(state.project, visual.map((c) => c.id), { motion: v === 'none' ? null : { type: v, amount: 0.15 } })));
        }
        if (texts.length) {
            rows.push(chooser('Title entrance', 'keep', [['keep', 'Set animation…']].concat(Object.keys(ANIM_LABELS).map((k) => [k, ANIM_LABELS[k]])),
                (v) => v === 'keep' ? state.project : T.updateClips(state.project, texts.map((c) => c.id), { anim: v })));
        }
        rows.push(el('p', { className: 'hint', text: 'Drag any of them to move them together. Shift- or Ctrl-click adds or removes a clip.' }));
        box.append(group('Together', rows));
    }

    function renderMarkerInspector(box) {
        const m = (state.project.markers || []).find((x) => x.id === state.marker);
        if (!m) { renderProjectInspector(box); return; }
        const label = el('input', { type: 'text', value: m.label || '' });
        label.addEventListener('change', function () { apply(T.updateMarker(state.project, m.id, { label: label.value.trim() })); });
        box.append(
            el('div', { className: 'insp-title' }, [el('span', { className: 'chip', text: 'Marker' }), el('span', { text: m.label || fmt(m.time) })]),            group('Marker', [
                control('Label', label),
                timeField('Time', m.time, (v) => T.updateMarker(state.project, m.id, { time: v })),
                el('div', { className: 'row-buttons' }, [
                    button('Go to', function () { seek(m.time); }),
                    button('Delete', function () { state.marker = null; apply(T.removeMarker(state.project, m.id)); })
                ])
            ])
        );
    }

    function renderProjectInspector(box) {
        const p = state.project;
        const bg = el('input', { type: 'color', value: p.background || '#000000' });
        bg.addEventListener('input', function () {
            state.project = T.clone(state.project);
            state.project.background = bg.value;
            requestDraw();
        });
        bg.addEventListener('change', commitQuiet);
        const amount = Math.round((p.duckAmount === undefined ? 0.25 : p.duckAmount) * 100);
        const duckOut = el('output', { text: amount + '%' });
        const duck = el('input', { type: 'range', min: 5, max: 80, step: 5, value: amount });
        duck.addEventListener('input', function () {
            state.project = T.clone(state.project);
            state.project.duckAmount = Number(duck.value) / 100;
            duckOut.textContent = duck.value + '%';
            duckDirty = true;
        });
        duck.addEventListener('change', commitQuiet);

        const markers = (p.markers || []).map(function (m) {
            return el('div', { className: 'marker-row' }, [
                el('button', { className: 'ghost', text: fmt(m.time), onclick: function () { seek(m.time); } }),
                el('span', { text: m.label || 'Marker' }),
                el('button', { className: 'icon ghost', html: ICONS.close, 'aria-label': 'Delete marker ' + (m.label || ''), onclick: function () { apply(T.removeMarker(state.project, m.id)); } })
            ]);
        });

        const shortcuts = [
            ['Space', 'Play / pause'], ['S', 'Split at playhead'], ['Del', 'Delete'],
            ['Shift+Del', 'Delete and close gap'], ['Ctrl+C / X / V', 'Copy, cut, paste'], ['Ctrl+D', 'Duplicate'],
            ['Ctrl+A', 'Select all'], ['Shift+click', 'Add to selection'], ['T', 'Add title'], ['W', 'Title written by hand'], ['D', 'Draw'], ['M', 'Add marker'],
            ['F', 'Freeze frame'], ['← →', 'Step a frame'], ['Shift+← →', 'Step a second'], ['Alt+← →', 'Nudge clip'],
            ['Home / End', 'Start / end'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['+ / −', 'Zoom'],
            ['Ctrl+wheel', 'Zoom at pointer'], ['Pinch', 'Zoom (touch)']
        ];
        box.append(
            el('div', { className: 'insp-title' }, [el('span', { className: 'chip', text: 'Project' }), el('span', { text: p.name })]),
            group('Project', [
                control('Background', bg),
                el('div', { className: 'check', text: p.width + '×' + p.height + ' · ' + p.fps + ' fps · ' + fmt(duration()) }),
                el('div', { className: 'check', text: p.clips.length + ' clip' + (p.clips.length === 1 ? '' : 's') + ' on ' + p.tracks.length + ' tracks' })
            ]),
            group('Watermark', [
                (function () {
                    const box = el('input', { type: 'checkbox' });
                    box.checked = watermarkOn();
                    box.addEventListener('change', function () { setWatermark(box.checked); });
                    return el('label', { className: 'check' }, [box, 'Show the ' + WATERMARK + ' watermark']);
                }()),
                el('p', { className: 'hint', text: 'It appears in the top-right corner of the preview and of exported videos.' })
            ]),
            group('Ducking', [
                control('Duck to', duck, duckOut),
                el('p', { className: 'hint', text: 'Turn ducking on for a background-sound track (a nasheed, say) with its ▁▃▅ button: it drops to this level while anything else is speaking.' })
            ]),
            group('Markers', markers.length ? markers.concat([el('div', { className: 'row-buttons' }, [button('Copy chapters for YouTube', copyChapters)])])
                : [el('p', { className: 'hint', text: 'Press M to drop a marker at the playhead. Markers snap clips, and become YouTube chapters.' })]),
            window.ReelStore ? storageGroup() : null,
            group('Shortcuts', [el('div', { className: 'shortcuts' }, shortcuts.reduce(function (acc, s) {
                acc.push(el('kbd', { text: s[0] }), el('span', { text: s[1] }));
                return acc;
            }, []))])
        );
    }

    function storageGroup() {
        const line = el('p', { className: 'hint', text: 'Imported files are kept in this browser, so the project reopens with them.' });
        window.ReelStore.usage().then(function (u) {
            if (u) line.textContent = 'Imported files are kept in this browser (' + formatBytes(u.used) + ' used), so the project reopens with them.';
        }).catch(function () {});
        return group('Storage', [line, el('div', { className: 'row-buttons' }, [button('Forget stored files', async function () {
            if (!window.confirm('Remove the copies of your media kept in this browser? The project stays; its files will show as offline next time.')) return;
            await window.ReelStore.clear();
            toast('Stored files removed.');
            renderInspector();
        })])]);
    }

    /* ---------------------------------------------------------------- editing */

    function splitSelected() {
        const ids = state.selection.filter((id) => T.activeClips(state.project, state.time).some((c) => c.id === id));
        if (!apply(T.splitAt(state.project, state.time, ids.length ? ids : null))) toast('Move the playhead over a clip to split it.');
    }

    function deleteSelected(ripple) {
        if (state.marker && !state.selection.length) {
            const id = state.marker;
            state.marker = null;
            apply(T.removeMarker(state.project, id));
            return;
        }
        if (!state.selection.length) return;
        const ids = state.selection.slice();
        selectOnly(null);
        apply(T.deleteClips(state.project, ids, ripple));
    }

    function duplicateSelected() {
        const clip = selectedClip();
        if (!clip) return;
        const r = T.duplicateClip(state.project, clip.id);
        state.selection = [r.id];
        state.selected = r.id;
        apply(r.project);
    }

    function copySelected() {
        const board = T.copyClips(state.project, state.selection);
        if (!board) return false;
        state.clipboard = board;
        toast(board.clips.length === 1 ? 'Copied 1 clip.' : 'Copied ' + board.clips.length + ' clips.');
        return true;
    }

    function cutSelected() {
        if (copySelected()) deleteSelected(false);
    }

    function paste() {
        if (!state.clipboard) { toast('Nothing copied yet.'); return; }
        const r = T.pasteClips(state.project, state.clipboard, state.time);
        if (!r.ids.length) { toast('No room to paste there.'); return; }
        state.selection = r.ids;
        state.selected = r.ids[r.ids.length - 1];
        apply(r.project);
    }

    function selectAll() {
        selectMany(state.project.clips.map((c) => c.id));
    }

    function freezeSelected() {
        const clip = selectedClip();
        const target = clip && T.clipKind(state.project, clip) === 'video' && !clip.freeze && !clip.audioOnly ? clip
            : T.activeClips(state.project, state.time).find((c) => T.clipKind(state.project, c) === 'video' && !c.freeze && !c.audioOnly);
        if (!target) { toast('Put the playhead over a video clip to freeze a frame.'); return; }
        const r = T.freezeFrame(state.project, target.id, state.time, 2);
        if (!r.id) { toast('Put the playhead over the video clip to freeze a frame.'); return; }
        state.selection = [r.id];
        state.selected = r.id;
        apply(r.project);
        toast('Froze the frame for 2 seconds. Drag its right edge to hold it longer.');
    }

    function detachSelected() {
        const clip = selectedClip();
        if (!clip) return;
        const r = T.detachAudio(state.project, clip.id);
        if (!r.id) return;
        state.selection = [r.id];
        state.selected = r.id;
        apply(r.project);
    }

    /**
     * On a narrow screen the details panel is hidden until asked for; this
     * opens it, so a new title's text box and options are in view.
     */
    function showDetails() {
        if (!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;
        $('workspace').classList.remove('show-bin');
        $('workspace').classList.add('show-inspector');
        syncMobilePanels();
    }

    function syncMobilePanels() {
        const bin = $('workspace').classList.contains('show-bin');
        const details = $('workspace').classList.contains('show-inspector');
        $('toggle-bin').setAttribute('aria-pressed', String(bin));
        $('toggle-bin').setAttribute('aria-label', bin ? 'Close media' : 'Show media');
        $('toggle-inspector').setAttribute('aria-pressed', String(details));
        $('toggle-inspector').setAttribute('aria-label', details ? 'Close details' : 'Show details');
    }

    /** A title that a hand holding a pen writes out. */
    /** Puts a chalk, pencil or keyboard sound under a title, in time with its letters. */
    function writingSound(id, kind) {
        if (!window.ReelSounds || !window.ReelSounds.addWritingSound) return;
        window.ReelSounds.addWritingSound(id, kind).catch(function (err) { toast(err.message); });
    }

    function addHandwrittenTitle() {
        addTitle({ anim: 'handwrite', hand: 'pen', handStyle: 'realistic', font: 'hand', bold: false, writeDuration: 3.5 });
        toast('Type your words, then press Play to watch the hand write them.');
    }

    /** Adds a title at the playhead; `patch` sets its look, such as writing it by hand. */
    function addTitle(patch) {
        const track = T.lowestTrack(state.project, 'text');
        if (!track) return;
        const clip = Object.assign(T.textClip(track.id, state.time), patch && patch.anim ? patch : null);
        const next = T.addClip(state.project, clip);
        if (next === state.project) return;
        state.selection = [clip.id];
        state.selected = clip.id;
        apply(next);
        showDetails();
        const box = $('inspector').querySelector('textarea');
        if (box) {
            box.focus();
            box.select();
            box.scrollIntoView({ block: 'nearest' });
        }
    }

    /* ---------------------------------------------------------------- drawing */
    const DRAW_TOOLS = [
        ['pen', 'Pen', '<path d="M4 20l4-1 11-11-3-3L5 16z"/>'],
        ['highlighter', 'Highlighter', '<path d="M9 14l-4 6h6l2-3M9 14l7-10 4 3-7 10z"/>'],
        ['line', 'Line', '<path d="M5 19L19 5"/>'],
        ['arrow', 'Arrow', '<path d="M5 19L19 5M10 5h9v9"/>'],
        ['rect', 'Box', '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
        ['oval', 'Circle', '<ellipse cx="12" cy="12" rx="8" ry="6"/>'],
        ['eraser', 'Eraser', '<path d="M8 20h12M5 15l8-9 6 6-6 7H9z"/>']
    ];
    const DRAW_SIZES = [['3', 'Fine'], ['6', 'Medium'], ['12', 'Thick'], ['22', 'Bold']];
    const DRAW_SWATCHES = ['#ffffff', '#111111', '#f2b84b', '#e5484d', '#3e9bff', '#30a46c'];

    /**
     * Opens the drawing board over the preview: draw with the pen or
     * highlighter, drag out lines, arrows, boxes and circles, or rub strokes
     * out. Done puts the drawing on a titles track at the playhead (or saves
     * the clip being edited), as one undoable step.
     */
    function openDrawMode(clipId) {
        if (clipId && T.getClip(state.project, clipId)?.sticker && window.ReelEffects) { selectOnly(clipId); window.ReelEffects.openStickers(); return; }
        if (drawMode) return;
        pause();
        const editing = clipId ? T.getClip(state.project, clipId) : null;
        drawMode = {
            // The project before drawing, for Cancel; the drawing joins the
            // timeline (without an undo step) from its first stroke.
            base: state.project,
            at: Math.round(state.time * 1000) / 1000,
            created: false,
            clipId: editing ? editing.id : null,
            frame: editing ? { x: editing.x, y: editing.y, scale: editing.scale || 1 } : { x: 0.5, y: 0.5, scale: 1 },
            strokes: editing ? T.clone(editing.strokes || []) : [],
            undo: [],
            tool: 'pen',
            color: '#ffffff',
            width: 6,
            hand: editing ? editing.hand : 'pen',
            handStyle: editing ? editing.handStyle : 'realistic',
            handSkin: editing ? editing.handSkin : 'medium',
            handSize: editing ? (editing.handSize || 1) : 1,
            current: null,
            from: null,
            cursor: null
        };
        const last = editing && editing.strokes && editing.strokes[editing.strokes.length - 1];
        if (last) { drawMode.color = last.color; drawMode.width = last.alpha < 1 ? last.width / 3 : last.width; }

        const layer = el('canvas', { id: 'draw-layer', className: 'draw-layer', 'aria-label': 'Drawing board' });
        layer.width = state.project.width;
        layer.height = state.project.height;
        const tools = el('div', { className: 'draw-tools', role: 'group', 'aria-label': 'Drawing tool' }, DRAW_TOOLS.map(function (t) {
            const b = el('button', {
                className: 'ghost draw-tool', title: t[1], 'aria-label': t[1], 'aria-pressed': String(t[0] === drawMode.tool),
                'data-tool': t[0], html: '<svg viewBox="0 0 24 24">' + t[2] + '</svg>'
            });
            b.addEventListener('click', function () { setDrawTool(t[0]); });
            return b;
        }));
        const colourIn = el('input', { type: 'color', value: drawMode.color, 'aria-label': 'Pen colour', title: 'Pen colour' });
        colourIn.addEventListener('input', function () { drawMode.color = colourIn.value; });
        const swatches = el('div', { className: 'draw-swatches' }, DRAW_SWATCHES.map(function (hex) {
            const b = el('button', { className: 'swatch', title: hex, 'aria-label': 'Colour ' + hex, style: { background: hex } });
            b.addEventListener('click', function () { drawMode.color = hex; colourIn.value = hex; });
            return b;
        }));
        const sizeIn = el('select', { 'aria-label': 'Thickness', title: 'Thickness' }, DRAW_SIZES.map((o) => el('option', { value: o[0], text: o[1] })));
        sizeIn.value = DRAW_SIZES.some((o) => Number(o[0]) === drawMode.width) ? String(drawMode.width) : '6';
        drawMode.width = Number(sizeIn.value);
        sizeIn.addEventListener('change', function () { drawMode.width = Number(sizeIn.value); });
        const handIn = el('select', { 'aria-label': 'Drawing hand', title: 'Hand shown while drawing' }, [
            ['real', 'Real hand'], ['emoji', 'Emoji hand'], ['sketch', 'Sketch hand'], ['pencil', 'Pencil hand'], ['none', 'No hand']
        ].map((o) => el('option', { value: o[0], text: o[1] })));
        handIn.value = drawMode.hand === 'none' ? 'none' : drawMode.handStyle === 'realistic' ? 'real' : drawMode.hand === 'pencil' ? 'pencil' : drawMode.handStyle === 'sketch' ? 'sketch' : 'emoji';
        handIn.addEventListener('change', function () {
            const v = handIn.value;
            drawMode.hand = v === 'none' ? 'none' : v === 'pencil' ? 'pencil' : 'pen';
            drawMode.handStyle = v === 'real' ? 'realistic' : v === 'sketch' || v === 'pencil' ? 'sketch' : 'emoji';
            paintDrawLayer();
            syncDrawClip();
        });
        const HAND_SIZES = [['0.7', 'Small hand'], ['1', 'Medium hand'], ['1.4', 'Large hand'], ['1.9', 'Huge hand']];
        const handSizeIn = el('select', { 'aria-label': 'Hand size', title: 'How big the hand is' }, HAND_SIZES.map((o) => el('option', { value: o[0], text: o[1] })));
        handSizeIn.value = HAND_SIZES.reduce((best, o) => Math.abs(o[0] - drawMode.handSize) < Math.abs(best - drawMode.handSize) ? o[0] : best, '1');
        handSizeIn.addEventListener('change', function () {
            drawMode.handSize = Number(handSizeIn.value);
            paintDrawLayer();
            syncDrawClip();
        });
        const undoBtn = el('button', { className: 'ghost', text: 'Undo', title: 'Undo the last stroke (Ctrl+Z)', onclick: undoStroke });
        const clearBtn = el('button', { className: 'ghost', text: 'Clear', onclick: function () { if (drawMode.strokes.length) { drawMode.undo.push(drawMode.strokes); drawMode.strokes = []; paintDrawLayer(); } } });
        const cancelBtn = el('button', { className: 'ghost', text: 'Cancel', onclick: function () { closeDrawMode(false); } });
        const doneBtn = el('button', { className: 'primary', text: 'Done', onclick: function () { closeDrawMode(true); } });
        const bar = el('div', { id: 'draw-bar', className: 'draw-bar', role: 'toolbar', 'aria-label': 'Drawing' }, [
            tools, el('span', { className: 'draw-sep' }), colourIn, swatches, sizeIn, handIn, handSizeIn,
            el('span', { className: 'draw-sep' }), undoBtn, clearBtn, el('span', { className: 'spacer' }), cancelBtn, doneBtn
        ]);
        $('stage').append(layer, bar);
        $('stage').classList.add('drawing');
        // Make room for the drawing: see body.drawing-focus in the page's styles.
        document.body.classList.add('drawing-focus');
        drawMode.layer = layer;
        drawMode.bar = bar;
        fitCanvas();
        window.dispatchEvent(new Event('resize'));
        paintDrawLayer();
        requestDraw();

        layer.addEventListener('pointerdown', drawDown);
        layer.addEventListener('pointermove', drawMove);
        layer.addEventListener('pointerup', drawUp);
        layer.addEventListener('pointercancel', drawUp);
        toast(editing ? 'Editing the drawing. Press Done when finished.' : 'Draw on the picture, then press Done.');
    }

    function setDrawTool(tool) {
        drawMode.tool = tool;
        drawMode.bar.querySelectorAll('.draw-tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
        drawMode.layer.classList.toggle('erasing', tool === 'eraser');
    }

    function sizeDrawLayer() {
        drawMode.layer.style.width = canvas.style.width;
        drawMode.layer.style.height = canvas.style.height;
    }

    /** A pointer position as a point of the drawing (which may be moved and scaled). */
    function drawPoint(e) {
        const r = drawMode.layer.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        const f = drawMode.frame;
        return { x: (fx - f.x) / f.scale + 0.5, y: (fy - f.y) / f.scale + 0.5 };
    }

    function newStroke() {
        const hl = drawMode.tool === 'highlighter';
        return { color: drawMode.color, width: hl ? drawMode.width * 3 : drawMode.width, alpha: hl ? 0.4 : 1, points: [] };
    }

    function drawDown(e) {
        if (e.button > 0) return;
        e.preventDefault();
        drawMode.layer.setPointerCapture(e.pointerId);
        const pt = drawPoint(e);
        drawMode.from = pt;
        drawMode.cursor = pt;
        if (drawMode.tool === 'eraser') { drawMode.undo.push(drawMode.strokes); eraseAt(pt); return; }
        drawMode.current = Object.assign(newStroke(), { points: [pt.x, pt.y] });
        if (['line', 'arrow', 'rect', 'oval'].indexOf(drawMode.tool) !== -1) drawMode.current.shape = drawMode.tool;
        paintDrawLayer();
    }

    function drawMove(e) {
        if (!drawMode.from) return;
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        const list = events.length ? events : [e];
        if (drawMode.tool === 'eraser') { list.forEach((ev) => eraseAt(drawPoint(ev))); return; }
        const cur = drawMode.current;
        if (cur.shape) {
            cur.to = drawPoint(e);
        } else {
            list.forEach(function (ev) { const pt = drawPoint(ev); cur.points.push(pt.x, pt.y); });
        }
        drawMode.cursor = drawPoint(e);
        paintDrawLayer();
    }

    function drawUp() {
        if (!drawMode.from) return;
        const cur = drawMode.current;
        drawMode.from = null;
        drawMode.current = null;
        drawMode.cursor = null;
        if (!cur) { paintDrawLayer(); return; }
        drawMode.undo.push(drawMode.strokes);
        drawMode.strokes = drawMode.strokes.concat(finishStroke(cur));
        paintDrawLayer();
        syncDrawClip();
    }

    /** The strokes a stroke in progress becomes: a thinned freehand line, or a shape's lines. */
    function finishStroke(cur) {
        const base = { color: cur.color, width: cur.width, alpha: cur.alpha };
        if (cur.shape) {
            const to = cur.to || { x: cur.points[0], y: cur.points[1] };
            return T.shapeStrokes(cur.shape, cur.points[0], cur.points[1], to.x, to.y, state.project.width / state.project.height)
                .map((pts) => Object.assign({}, base, { points: pts, straight: true }));
        }
        return [Object.assign({}, base, { points: T.simplifyPoints(cur.points) })];
    }

    function eraseAt(pt) {
        const a = state.project.width / state.project.height;
        const reach = 0.025;
        // Distance from the pointer to a segment, on a frame `a` times as wide as high.
        const toSegment = function (x0, y0, x1, y1) {
            const dx = (x1 - x0) * a;
            const dy = y1 - y0;
            const px = (pt.x - x0) * a;
            const py = pt.y - y0;
            const len = dx * dx + dy * dy;
            const u = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
            return Math.hypot(px - u * dx, py - u * dy);
        };
        const keep = drawMode.strokes.filter(function (s) {
            const p = s.points;
            const near = reach + s.width / 1440;
            if (p.length === 2) return toSegment(p[0], p[1], p[0], p[1]) >= near;
            for (let i = 2; i < p.length; i += 2) if (toSegment(p[i - 2], p[i - 1], p[i], p[i + 1]) < near) return false;
            return true;
        });
        if (keep.length !== drawMode.strokes.length) { drawMode.strokes = keep; paintDrawLayer(); syncDrawClip(); }
    }

    function undoStroke() {
        if (!drawMode.undo.length) return;
        drawMode.strokes = drawMode.undo.pop();
        paintDrawLayer();
        syncDrawClip();
    }

    /** The hand settings chosen on the drawing board, as clip properties. */
    function drawHandPatch(m) {
        return { hand: m.hand, handStyle: m.handStyle, handSkin: m.handSkin, handSize: m.handSize };
    }

    /**
     * Keeps the timeline in step with the board: a new drawing appears as a
     * clip from its first stroke and grows with every stroke after. None of
     * this is an undo step — Done makes it one, and Cancel puts it all back.
     */
    function syncDrawClip() {
        const m = drawMode;
        if (!m) return;
        if (m.clipId && T.getClip(state.project, m.clipId)) {
            if (m.created && !m.strokes.length) {
                state.project = T.deleteClips(state.project, [m.clipId], false);
                m.clipId = null;
                m.created = false;
                state.selection = [];
                state.selected = null;
                renderAll();
                return;
            }
            if (!m.strokes.length) return;
            state.project = T.updateClip(state.project, m.clipId, Object.assign({ strokes: m.strokes }, drawHandPatch(m)));
            scheduleTimeline();
            return;
        }
        if (!m.strokes.length) return;
        const placed = placeDrawing(state.project, m.at, m.strokes, drawHandPatch(m));
        if (!placed) return;
        state.project = placed.project;
        m.clipId = placed.id;
        m.created = true;
        state.selection = [placed.id];
        state.selected = placed.id;
        renderAll();
    }

    function paintDrawLayer() {
        const c = drawMode.layer.getContext('2d');
        const W = drawMode.layer.width;
        const H = drawMode.layer.height;
        const f = drawMode.frame;
        c.clearRect(0, 0, W, H);
        c.save();
        c.translate(f.x * W, f.y * H);
        c.scale(f.scale, f.scale);
        c.translate(-W / 2, -H / 2);
        paintStrokes(c, drawMode.strokes, W, H);
        if (drawMode.current) paintStrokes(c, finishStroke(drawMode.current), W, H);
        c.restore();
        if (drawMode.cursor && drawMode.hand !== 'none' && drawMode.tool !== 'eraser') {
            const pt = drawMode.cursor;
            const at = { x: (f.x + (pt.x - .5) * f.scale) * W, y: (f.y + (pt.y - .5) * f.scale) * H };
            drawHand(c, { tool: drawMode.hand, style: drawMode.handStyle, skin: drawMode.handSkin, size: drawMode.handSize },
                at.x, at.y, H * DRAW_HAND * drawMode.handSize, 0, W, H, { ink: drawMode.color });
        }
    }

    /** Closes the drawing board, keeping the drawing (one undo step) or putting everything back. Returns the drawing's clip id. */
    function closeDrawMode(save) {
        if (!drawMode) return null;
        syncDrawClip();
        const m = drawMode;
        drawMode = null;
        m.layer.remove();
        m.bar.remove();
        $('stage').classList.remove('drawing');
        document.body.classList.remove('drawing-focus');
        fitCanvas();
        window.dispatchEvent(new Event('resize'));
        let id = null;
        if (!save) {
            if (state.project !== m.base) { state.project = m.base; afterChange(); }
        } else if (m.clipId && T.getClip(state.project, m.clipId)) {
            id = m.clipId;
            if (!m.strokes.length) toast('The drawing is empty — delete the clip if you no longer want it.');
            else if (state.project !== m.base) {
                state.selection = [id];
                state.selected = id;
                commit();
                showDetails();
            }
        }
        requestDraw();
        return id;
    }

    /**
     * A project with a new drawing at `at` on a titles track with room for
     * it, adding a track if none has; null if it cannot be placed.
     */
    function placeDrawing(project, at, strokes, hand) {
        let p = project;
        const clip = T.drawClip(null, at, strokes);
        Object.assign(clip, hand || {});
        let track = p.tracks.filter((t) => t.kind === 'text').find(function (t) {
            const at = T.findFreeStart(p, t.id, clip.start, clip.duration, null);
            return at !== null && Math.abs(at - clip.start) < 1e-6;
        });
        if (!track) {
            const id = T.nextTrackId(p, 'text');
            p = T.addTrack(p, 'text');
            track = T.getTrack(p, id);
        }
        clip.track = track.id;
        const next = T.addClip(p, clip);
        if (next === p) return null;
        return { project: next, id: clip.id };
    }

    function addMarkerHere() {
        const n = (state.project.markers || []).length + 1;
        const r = T.addMarker(state.project, T.toFrame(state.time, state.project.fps), 'Chapter ' + n);
        state.marker = r.id;
        state.selection = [];
        state.selected = null;
        apply(r.project);
    }

    function renameMarker(id) {
        const m = (state.project.markers || []).find((x) => x.id === id);
        if (!m) return;
        const label = window.prompt('Marker name', m.label || '');
        if (label === null) return;
        apply(T.updateMarker(state.project, id, { label: label.trim() }));
    }

    async function copyChapters() {
        const text = T.chaptersText(state.project);
        try {
            await navigator.clipboard.writeText(text);
            toast('Chapters copied — paste them into the video description.');
        } catch (err) {
            download(new Blob([text + '\n'], { type: 'text/plain' }), safeName(state.project.name) + ' chapters.txt');
        }
    }

    function transitionEveryCut() {
        const type = el('select', null, Object.keys(TRANSITION_LABELS).filter((k) => k !== 'none').map((k) => el('option', { value: k, text: TRANSITION_LABELS[k] })));
        const len = el('input', { type: 'number', min: 0.2, max: 3, step: 0.1, value: 1 });
        openDialog({
            title: 'Transition on every cut',
            intro: 'Adds the same transition wherever two clips touch on a track. Clips with a gap between them are left as they are.',
            body: [dialogField('Type', type), dialogField('Length (s)', len)],
            actions: [
                { label: 'Cancel' },
                { label: 'Remove all', run: function () { apply(T.transitionAllCuts(state.project, 'none')); } },
                { label: 'Apply', primary: true, run: function () { apply(T.transitionAllCuts(state.project, type.value, Number(len.value) || 1)); } }
            ]
        });
    }

    function nudge(delta) {
        if (!state.selection.length) return false;
        if (state.selection.length > 1) { apply(T.moveClips(state.project, state.selection, delta)); return true; }
        const clip = selectedClip();
        apply(T.moveClip(state.project, clip.id, clip.start + delta));
        return true;
    }

    /* ------------------------------------------------------ audio-editor link */

    let audioEditorAvailable = false;

    /** The site's audio editor sits beside this one; offer it only if it is really there. */
    function checkAudioEditor() {
        if (!/^https?:$/.test(location.protocol) || !window.ReelStore) return;
        fetch(new URL('../audio-editor/', location.href), { method: 'HEAD' }).then(function (r) {
            audioEditorAvailable = r.ok;
            if (audioEditorAvailable) renderInspector();
        }).catch(function () {});
    }

    async function sendToAudioEditor(clipId) {
        const clip = T.getClip(state.project, clipId);
        const f = clip && files.get(clip.mediaId);
        if (!f) { toast('That file is offline — import it again first.'); return; }
        await window.ReelStore.putHandoff('to-audio-editor', f.file, f.file.name);
        window.open(new URL('../audio-editor/?from=video-editor', location.href).href, '_blank');
        toast('Opened in the audio editor. Use File ▸ Send to Video Editor there to bring the result back.');
    }

    async function takeHandoff() {
        const params = new URLSearchParams(location.search);
        if (params.get('from') !== 'audio-editor' || !window.ReelStore) return;
        history.replaceState(null, '', location.pathname);
        const item = await window.ReelStore.takeHandoff('to-video-editor');
        if (!item) return;
        const ids = await importFiles([item], { fresh: true, origin: 'audio-editor' });
        if (ids[0]) {
            addToTimeline(ids[0]);
            toast('Added “' + item.name + '” from the audio editor.');
        }
    }

    /* ------------------------------------------------------------------- tabs */

    // Several projects can be open at once, one per tab. The active tab's
    // project, undo history, playhead and selection live in `state`; the
    // others wait in `tabs` until switched to. All are saved in the browser.
    let tabs = [{ id: T.newId('tab'), project: null, history: null, time: 0, selection: [], selected: null }];
    let activeTab = 0;

    function restoreTabs() {
        const raw = storage((s) => s.getItem(TABS_KEY));
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            const items = (data.items || []).map(function (it) {
                try { return { id: it.id || T.newId('tab'), project: T.deserialize(it.project), history: null, time: 0, selection: [], selected: null }; }
                catch (err) { return null; }
            }).filter(Boolean).slice(0, MAX_TABS);
            if (items.length < 2) return;
            tabs = items;
            activeTab = T.clamp(Number(data.active) || 0, 0, items.length - 1);
            state.project = tabs[activeTab].project;
            state.history = new T.History(state.project);
        } catch (err) { /* a broken save: keep the single project */ }
    }

    /** Media ids used by the tabs that are not active and by the project library, so their stored files are kept. */
    function otherTabsMedia() {
        const ids = [];
        tabs.forEach(function (t, i) { if (i !== activeTab && t.project) t.project.media.forEach((m) => ids.push(m.id)); });
        return window.ReelLibrary ? ids.concat(window.ReelLibrary.mediaIds()) : ids;
    }

    /** Switches to the tab holding the library project `id`, if one does. */
    function focusLibraryProject(id) {
        const i = tabs.findIndex((t, k) => (k === activeTab ? state.project : t.project).libraryId === id);
        if (i === -1) return false;
        switchTab(i);
        return true;
    }

    function stashTab() {
        Object.assign(tabs[activeTab], {
            project: state.project, history: state.history, time: state.time,
            selection: state.selection.slice(), selected: state.selected
        });
    }

    function switchTab(i) {
        if (i === activeTab || !tabs[i]) return;
        if (drawMode) closeDrawMode(true);
        pause();
        stashTab();
        const t = tabs[i];
        activeTab = i;
        state.project = t.project;
        state.history = t.history || new T.History(t.project);
        state.time = t.time || 0;
        state.selection = (t.selection || []).slice();
        state.selected = t.selected || null;
        state.marker = null;
        afterChange();
        fitCanvas();
        updateRestoreBanner();
        reattachStored(false);
    }

    function newTab() {
        if (tabs.length >= MAX_TABS) { toast('Up to ' + MAX_TABS + ' projects can be open at once. Close one first.'); return; }
        stashTab();
        const p = T.createProject({ width: state.project.width, height: state.project.height, fps: state.project.fps });
        p.name = 'Project ' + (tabs.length + 1);
        tabs.push({ id: T.newId('tab'), project: p, history: new T.History(p), time: 0, selection: [], selected: null });
        switchTab(tabs.length - 1);
        toast('New project in a new tab. Your other project is still open in its tab.');
    }

    /** Opens `project` in a new tab (it may share media with the others) and switches to it. */
    function openProjectInTab(project) {
        if (tabs.length >= MAX_TABS) { toast('Up to ' + MAX_TABS + ' projects can be open at once. Close one first.'); return false; }
        stashTab();
        tabs.push({ id: T.newId('tab'), project: project, history: new T.History(project), time: 0, selection: [], selected: null });
        switchTab(tabs.length - 1);
        return true;
    }

    function closeTab(i) {
        if (tabs.length < 2) return;
        const p = i === activeTab ? state.project : tabs[i].project;
        if (p.clips.length && !window.confirm('Close “' + p.name + '”? It will be removed from this browser — Save it first to keep a copy.')) return;
        if (i === activeTab) {
            const next = i === tabs.length - 1 ? i - 1 : i + 1;
            switchTab(next);
        }
        tabs.splice(i, 1);
        if (activeTab > i) activeTab -= 1;
        afterChange();
        if (window.ReelStore) window.ReelStore.keepOnly(state.project.media.map((m) => m.id).concat(otherTabsMedia()));
    }

    function renderTabs() {
        const box = $('project-tabs');
        if (!box) return;
        box.textContent = '';
        tabs.forEach(function (t, i) {
            const p = i === activeTab ? state.project : t.project;
            const name = (p && p.name) || 'Untitled project';
            const tab = el('div', { className: 'project-tab' + (i === activeTab ? ' active' : '') }, [
                el('button', {
                    className: 'tab-name', role: 'tab', 'aria-selected': String(i === activeTab), title: name, text: name,
                    onclick: function () { switchTab(i); }
                }),
                tabs.length > 1 ? el('button', {
                    className: 'tab-close', 'aria-label': 'Close ' + name, title: 'Close this project', text: '×',
                    onclick: function () { closeTab(i); }
                }) : null
            ]);
            box.append(tab);
        });
        box.append(el('button', {
            className: 'tab-add', 'aria-label': 'Open another project in a new tab', title: 'Edit another video at the same time (new tab)',
            text: '+', onclick: newTab
        }));
    }

    /* ---------------------------------------------------------------- project */

    function newProject() {
        if (state.project.clips.length && !window.confirm('Start a new project? The current timeline will be cleared.')) return;
        pause();
        const keep = { width: state.project.width, height: state.project.height, fps: state.project.fps };
        state.project = T.createProject(keep);
        state.history = new T.History(state.project);
        selectOnly(null);
        state.time = 0;
        afterChange();
        updateRestoreBanner();
        if (window.ReelStore) window.ReelStore.keepOnly(otherTabsMedia());
    }

    function saveProject() {
        const blob = new Blob([T.serialize(state.project)], { type: 'application/json' });
        download(blob, safeName(state.project.name) + '.reel.json');
        toast('Saved. Media files are not inside it — keep them alongside the project.');
    }

    /** Loads a project, reconnecting its media from this visit or from browser storage. */
    async function loadProject(p) {
        pause();
        const onHand = Array.from(files.entries());
        const reattached = new Map();
        p.media.forEach(function (m) {
            const hit = onHand.find((pair) => pair[1].file.name === m.name && pair[1].file.size === m.size);
            if (hit) reattached.set(m.id, hit[1]);
        });
        files.clear();
        reattached.forEach(function (f, id) { files.set(id, f); });
        state.project = p;
        state.history = new T.History(p);
        selectOnly(null);
        state.time = 0;
        afterChange();
        await reattachStored(true);
        updateRestoreBanner();
        zoomToFit();
    }

    async function openProjectFile(file) {
        try {
            await loadProject(T.deserialize(await file.text()));
            const offline = state.project.media.filter((m) => !files.has(m.id)).length;
            toast(offline ? 'Opened. Import its ' + offline + ' media file' + (offline === 1 ? '' : 's') + ' to bring them online.' : 'Opened.');
        } catch (err) {
            toast(err.message);
        }
    }

    function restore() {
        restoreTabs();
        if (tabs.length > 1) return;
        const saved = storage((s) => s.getItem(STORAGE_KEY));
        if (!saved) return;
        try {
            const p = T.deserialize(saved);
            if (!p.clips.length && !p.media.length) return;
            state.project = p;
            state.history = new T.History(p);
        } catch (err) {
            // A corrupt or foreign save is ignored; start fresh.
        }
    }

    /**
     * Brings back files kept in the browser for the current project's media:
     * by id, or also by name and size for a project opened from a file.
     */
    async function reattachStored(byName) {
        if (!window.ReelStore) return;
        const missing = state.project.media.filter((m) => !files.has(m.id));
        if (!missing.length) return;
        let found = 0;
        try {
            const got = await window.ReelStore.find(missing, byName);
            for (const pair of got) {
                const media = T.getMedia(state.project, pair[0]);                if (!media || files.has(media.id)) continue;
                await attachFile(media.id, pair[1]);
                found += 1;
            }
        } catch (err) { /* storage unavailable; files stay offline */ }
        if (found) afterChange();
        updateRestoreBanner();
    }

    async function snapshot() {
        pause();
        if (window.ReelEffects) { try { await window.ReelEffects.ready(state.project); } catch (e) { toast('Background removal could not load. Reconnect or remove the effect first.'); return; } }
        drawFrame(state.time);
        canvas.toBlob(function (blob) {
            if (blob) download(blob, safeName(state.project.name) + ' ' + fmt(state.time).replace(/[:.]/g, '-') + '.png');
        }, 'image/png');
    }

    /* ----------------------------------------------------------------- export */

    const REALTIME_FORMATS = [
        { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4', label: 'MP4 · H.264' },
        { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM · VP9' },
        { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM · VP8' },
        { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
        { mime: 'video/webm', ext: 'webm', label: 'WebM' }
    ];

    function realtimeFormats() {
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return [];
        const ok = REALTIME_FORMATS.filter(function (f) {
            try { return MediaRecorder.isTypeSupported(f.mime); } catch (err) { return false; }
        });
        // Generic entries only when no codec-specific one of that container works.
        return ok.filter((f) => f.mime.includes('codecs') || !ok.some((g) => g.ext === f.ext && g.mime.includes('codecs')));
    }

    let exportChoices = [];

    $('export-watermark').addEventListener('change', function () { setWatermark($('export-watermark').checked); });
    $('export-watermark').nextSibling.textContent = ' Add the ' + WATERMARK + ' watermark';
    refreshPlan();

    /*
     * Where the video will be posted. Each choice checks the frame shape and
     * length against what that site accepts, picks MP4 at a good quality, and
     * after export offers to post it there: on a phone through the share sheet
     * (straight into the app), on a computer by opening the site's upload page.
     */
    const TARGETS = [
        { id: 'any', label: 'Anywhere' },
        { id: 'youtube', label: 'YouTube', shapes: ['16:9'], size: [1920, 1080], upload: 'https://www.youtube.com/upload',
            how: 'YouTube Studio opens: press Select files and choose the downloaded video.' },
        { id: 'shorts', label: 'YouTube Shorts', shapes: ['9:16', '1:1'], size: [1080, 1920], max: 180, tag: '#Shorts', upload: 'https://www.youtube.com/upload',
            how: 'YouTube Studio opens: choose the downloaded video. A tall or square video of 3 minutes or less becomes a Short.' },
        { id: 'tiktok', label: 'TikTok', shapes: ['9:16'], size: [1080, 1920], max: 600, upload: 'https://www.tiktok.com/upload',
            how: 'TikTok opens: choose the downloaded video on the upload page.' },
        { id: 'instagram', label: 'Instagram Reels', shapes: ['9:16'], size: [1080, 1920], max: 180, upload: 'https://www.instagram.com/',
            how: 'Instagram opens: press ＋ Create and choose the downloaded video.' },
        { id: 'facebook', label: 'Facebook', shapes: ['16:9', '9:16', '1:1', '4:5'], size: [1080, 1920], upload: 'https://www.facebook.com/',
            how: 'Facebook opens: press Reel (or Photo/video) and choose the downloaded video.' }
    ];
    const SHAPES = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
    const TARGET_KEY = 'reel.exportTarget';
    let exportTarget = TARGETS.find((t) => t.id === storage((s) => s.getItem(TARGET_KEY))) || TARGETS[0];

    /** 3:05 — minutes and seconds, for lengths people read. */
    function clock(t) {
        const r = Math.round(t);
        return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
    }

    function shapeOf(w, h) {
        return Object.keys(SHAPES).find((k) => Math.abs(w / h - SHAPES[k]) < 0.02) || (w + '×' + h);
    }

    function renderTargets() {
        const box = $('export-targets');
        box.textContent = '';
        TARGETS.forEach(function (t) {
            box.append(el('button', {
                type: 'button', role: 'radio', text: t.label, 'aria-checked': String(t === exportTarget),
                onclick: function () {
                    exportTarget = t;
                    storage((s) => s.setItem(TARGET_KEY, t.id));
                    renderTargets();
                    suitTarget();
                }
            }));
        });
        checkTarget();
    }

    /** MP4 and the high quality suit every one of these sites. */
    function suitTarget() {
        if (exportTarget.id === 'any') return;
        const i = exportChoices.findIndex((f) => f.ext === 'mp4');
        if (i >= 0) $('export-format').value = String(i);
        $('export-quality').value = '12000000';
        updateExportNote();
    }

    /** Says whether the frame and length suit the chosen site, with a one-tap fix. */
    function checkTarget() {
        const box = $('export-fit');
        const t = exportTarget;
        box.textContent = '';
        box.className = 'export-fit';
        if (t.id === 'any') { box.hidden = true; return; }
        const p = state.project;
        const shape = shapeOf(p.width, p.height);
        const len = duration();
        const notes = [];
        const fixes = [];
        if (t.shapes.indexOf(shape) < 0) {
            const want = t.shapes[0];
            notes.push(t.label + ' needs a ' + (SHAPES[want] < 1 ? 'tall ' : 'wide ') + want + ' frame; this video is ' + shape + '.');
            fixes.push(el('button', {
                type: 'button', className: 'primary', text: 'Change the frame to ' + want,
                onclick: function () {
                    const size = SHAPES[want] < 1 ? [1080, 1920] : SHAPES[want] === 1 ? [1080, 1080] : [1920, 1080];
                    const resize = window.ReelEffects && window.ReelEffects.resizeProject;
                    apply(resize ? resize(state.project, size[0], size[1], 'blur') : Object.assign(T.clone(state.project), { width: size[0], height: size[1] }));
                    openExport(); // the formats this browser can make depend on the frame size
                    toast('Changed to ' + want + '. Check the preview — Undo puts it back.');
                }
            }));
            if (SHAPES[want] < 1 && window.ReelShort) {
                fixes.push(el('button', { type: 'button', text: 'Make a Short (follows faces)…', onclick: function () { closeExport(); window.ReelShort.openShort(); } }));
            }
        }
        if (t.max && len > t.max + 0.05) {
            notes.push(t.label + ' takes videos up to ' + clock(t.max) + '; this one is ' + clock(len) + '. Trim it first, or choose another site.');
        }
        if (!notes.length) notes.push('Ready for ' + t.label + ': ' + shape + ', ' + clock(len) + ' long' + (exportChoices.some((f) => f.ext === 'mp4') ? ', saved as MP4.' : '.'));
        box.classList.add(fixes.length || notes.length > 1 || (t.max && len > t.max + 0.05) ? 'warn' : 'ok');
        notes.forEach((n) => box.append(el('span', { text: n })));
        if (fixes.length) box.append(el('div', { className: 'fit-actions' }, fixes));
        box.hidden = false;
    }

    async function openExport() {
        if (!state.project.clips.length) { toast('Add something to the timeline first.'); return; }
        pause();
        const sel = $('export-format');
        sel.textContent = '';
        sel.append(el('option', { text: 'Checking what this browser can make…', value: '' }));
        $('export-start').disabled = true;
        $('export-setup').hidden = false;
        $('export-progress').hidden = true;
        $('export-result').hidden = true;
        $('export-start').hidden = false;
        $('export-cancel').textContent = 'Cancel';
        $('export-watermark').checked = watermarkOn();
        $('export-dialog').hidden = false;
        const p = state.project;
        $('export-summary').textContent = p.width + '×' + p.height + ' · ' + p.fps + ' fps · ' + fmt(duration()) + ' long';

        let fast = [];
        if (window.ReelFastExport) {
            try { fast = await window.ReelFastExport.formats(p); } catch (err) { fast = []; }
        }
        const rt = realtimeFormats();
        exportChoices = fast.map((f) => Object.assign({ kind: 'fast' }, f))
            .concat(rt.map((f) => Object.assign({ kind: 'realtime' }, f)));
        sel.textContent = '';
        if (fast.length) {
            sel.append(el('optgroup', { label: 'Fast — works in the background' }, fast.map((f, i) => el('option', { value: String(i), text: f.label }))));
        }
        if (rt.length) {
            sel.append(el('optgroup', { label: 'Real time — plays the project through once' }, rt.map((f, i) => el('option', { value: String(fast.length + i), text: f.label }))));
        }
        if (!exportChoices.length) {
            $('export-summary').textContent = 'This browser cannot make video files. Try a recent Chrome, Edge, Firefox or Safari.';
        }
        $('export-start').disabled = !exportChoices.length;
        updateExportNote();
        renderTargets();
        suitTarget();
        sel.focus();
    }

    function updateExportNote() {
        const choice = exportChoices[Number($('export-format').value) || 0];
        $('export-note').textContent = !choice ? ''
            : choice.kind === 'fast'
                ? 'Renders every frame exactly, and keeps going if you switch to another tab.'
                : 'Plays the project through once in real time. Keep this tab in front until it finishes.';
    }

    function closeExport() {
        if (state.exporting) cancelExport();
        $('export-dialog').hidden = true;
        const result = $('export-result');
        const link = result.querySelector('a');
        if (link) URL.revokeObjectURL(link.href);
        result.textContent = '';
    }

    /** Waits until every clip at `t` can play, so the first frames are not black. */
    async function warmUp(t) {
        syncMedia(t, false);
        const waits = T.mediaAt(state.project, t)
            .filter((m) => files.has(m.clip.mediaId))
            .map(function (m) {
                const e = elementFor(m.clip);
                if (!e || (e.el.readyState >= 3 && !e.el.seeking)) return null;
                return waitFor(e.el, e.el.seeking ? 'seeked' : 'canplay', 5000).catch(() => {});
            })
            .concat(T.renderLayers(state.project, t).filter((l) => l.kind === 'image').map(function (l) {
                const img = imageFor(l.clip.mediaId);
                return img && !img.complete ? waitFor(img, 'load', 5000).catch(() => {}) : null;
            }))
            .filter(Boolean);
        await Promise.all(waits);
    }

    async function startExport() {
        const choice = exportChoices[Number($('export-format').value) || 0];
        if (!choice) return;
        $('export-setup').hidden = true;
        $('export-progress').hidden = false;
        $('export-start').hidden = true;
        $('export-status').textContent = 'Preparing…';
        $('export-bar').value = 0;
        pause();
        await fontsReady();
        if (window.ReelEffects) {
            try { await window.ReelEffects.ready(state.project); }
            catch (e) { $('export-status').textContent = 'Background removal could not load. Reconnect or remove the effect before exporting.'; $('export-start').hidden = false; return; }
        }
        if (state.project.clips.some(c => T.handOf(c) && c.handStyle === 'realistic') && window.ReelHands) {
            const ready = await window.ReelHands.ready();
            if (!ready) {
                $('export-status').textContent = 'The realistic hand could not load. Reconnect and reload the editor, or choose Sketch in Hand style.';
                $('export-start').hidden = false;
                return;
            }
        }
        if (choice.kind === 'fast') return startFastExport(choice);
        return startRealtimeExport(choice);
    }

    async function startFastExport(choice) {
        const job = { kind: 'fast', cancelled: false, started: performance.now() };
        state.exporting = job;
        try {
            const blob = await window.ReelFastExport.run({
                format: choice,
                bitrate: Number($('export-quality').value),
                isCancelled: () => job.cancelled,
                onStatus: (text) => { if (!job.cancelled) $('export-status').textContent = text; },
                onProgress: (fraction, label) => { if (!job.cancelled) exportProgress(fraction, label); }
            });
            if (job.cancelled) return;
            state.exporting = null;
            deliverExport(blob, choice.ext);
        } catch (err) {
            state.exporting = null;
            if (job.cancelled) return;
            console.error(err);
            $('export-status').textContent = 'Export failed: ' + err.message + '. Try a real-time format instead.';
            $('export-cancel').textContent = 'Close';
        }
        requestDraw();
    }

    async function startRealtimeExport(format) {
        const a = wakeAudio();
        if (a && a.ctx.state === 'suspended') { try { await a.ctx.resume(); } catch (err) { /* export silently */ } }
        const job = { kind: 'realtime', format: format, chunks: [], cancelled: false, recorder: null, started: performance.now() };
        state.exporting = job;
        selectOnly(null);
        seek(0);
        await warmUp(0);
        if (job.cancelled) return;
        drawFrame(0);

        const stream = canvas.captureStream(state.project.fps);
        if (a && a.dest) a.dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
        let recorder;
        try {
            recorder = new MediaRecorder(stream, {
                mimeType: format.mime,
                videoBitsPerSecond: Number($('export-quality').value),
                audioBitsPerSecond: 192000
            });
        } catch (err) {
            state.exporting = null;
            $('export-status').textContent = 'Could not start the recorder: ' + err.message;
            return;
        }
        job.recorder = recorder;
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) job.chunks.push(e.data); };
        recorder.onstop = function () { if (!job.cancelled) finishRealtime(job); };
        recorder.start(1000);
        $('export-status').textContent = 'Recording…';
        play();
    }

    /** Pauses the recording while the timeline waits on a stalled clip. */
    function holdRecorder(hold) {
        const r = state.exporting && state.exporting.recorder;
        if (!r) return;
        if (hold && r.state === 'recording') r.pause();        else if (!hold && r.state === 'paused') r.resume();
    }

    function exportProgress(fraction, label) {
        const job = state.exporting;
        if (!job) return;
        $('export-bar').value = fraction;
        const elapsed = (performance.now() - job.started) / 1000;
        const left = fraction > 0.03 ? Math.max(0, elapsed / fraction - elapsed) : null;
        $('export-status').textContent = (label || (job.kind === 'fast' ? 'Rendering…' : 'Recording…')) + ' ' + Math.round(fraction * 100) + '%' +
            (left !== null ? ' · about ' + Math.ceil(left) + 's left' : '');
    }

    function finishExport() {
        const job = state.exporting;
        if (!job || !job.recorder) return;
        $('export-bar').value = 1;
        $('export-status').textContent = 'Finishing…';
        // Give the last frames a moment to reach the recorder.
        setTimeout(function () {
            if (job.recorder.state !== 'inactive') job.recorder.stop();
        }, 200);
    }

    async function finishRealtime(job) {
        const type = job.format.mime.split(';')[0];
        let blob = new Blob(job.chunks, { type: type });
        if (job.format.ext === 'webm' && window.ReelWebm) {
            try {
                const patched = window.ReelWebm.setDuration(new Uint8Array(await blob.arrayBuffer()), duration() * 1000);
                if (patched) blob = new Blob([patched], { type: type });
            } catch (err) { /* keep the unpatched file */ }
        }
        state.exporting = null;
        deliverExport(blob, job.format.ext);
    }

    function deliverExport(blob, ext) {
        const name = safeName(state.project.name) + '.' + ext;
        const url = URL.createObjectURL(blob);
        const result = $('export-result');
        result.textContent = '';
        result.append(
            el('p', { text: 'Done — ' + formatBytes(blob.size) + '. Your download should start; if not, use the link.' }),
            el('a', { href: url, download: name, id: 'export-download', text: 'Download ' + name }),
            shareRow(blob, name)
        );
        $('export-progress').hidden = true;
        result.hidden = false;
        $('export-cancel').textContent = 'Close';
        result.querySelector('a').click();
        renderAll();
    }

    /**
     * Ways to share a finished video. Where the browser can share files (most
     * phones, and Chrome or Edge on a computer) the video itself goes to
     * WhatsApp, Telegram, email or any other app; otherwise WhatsApp or
     * Telegram opens with a message, and the downloaded file is attached there.
     */
    function shareRow(blob, name) {
        const file = new File([blob], name, { type: blob.type || 'video/mp4' });
        const canShareFile = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
        const text = state.project.name + ' — made with ' + CONFIG.siteUrl.replace(/^https?:\/\//, '');
        const share = async function () {
            try {
                await navigator.share({ files: [file], title: state.project.name, text: text });
            } catch (err) {
                if (err && err.name !== 'AbortError') toast('Sharing did not work here. Use the downloaded file instead.');
            }
        };
        const open = function (url, app) {
            window.open(url, '_blank', 'noopener');
            toast('Attach the downloaded video in ' + app + ' to send it.');
        };
        const buttons = [];
        if (canShareFile) buttons.push(el('button', { type: 'button', className: 'primary', text: 'Share video…', onclick: share }));
        buttons.push(el('button', {
            type: 'button', text: 'WhatsApp', title: 'Send the video on WhatsApp',
            onclick: canShareFile ? share : function () { open('https://wa.me/?text=' + encodeURIComponent(text), 'WhatsApp'); }
        }));
        buttons.push(el('button', {
            type: 'button', text: 'Telegram', title: 'Send the video on Telegram',
            onclick: canShareFile ? share : function () { open('https://t.me/share/url?url=' + encodeURIComponent(CONFIG.siteUrl) + '&text=' + encodeURIComponent(text), 'Telegram'); }
        }));
        return el('div', {}, [
            el('div', { className: 'share-row' }, [el('span', { className: 'hint', text: 'Share:' })].concat(buttons)),
            postRow(file, canShareFile)
        ]);
    }

    /**
     * Post on YouTube, Shorts, TikTok, Instagram or Facebook. These sites only
     * take uploads from their own apps and pages, so: on a phone the video goes
     * through the share sheet straight into the app; on a computer the site's
     * upload page opens for the file that was just downloaded. Either way a
     * caption is copied, ready to paste.
     */
    /** The project's name, or else the first title in the video, for the caption. */
    function captionTitle() {
        const name = (state.project.name || '').trim();
        if (name && !/^Untitled/i.test(name)) return name;
        const title = state.project.clips.filter((c) => c.type === 'text' && (c.text || '').trim()).sort((x, y) => x.start - y.start)[0];
        return title ? title.text.trim().split('\n')[0].slice(0, 90) : 'My video';
    }

        function postRow(file, canShareFile) {
        const site = CONFIG.siteUrl.replace(/^https?:\/\//, '');
        const post = async function (t) {
            const caption = captionTitle() + (t.tag ? ' ' + t.tag : '') + '\n\nMade with ' + site;
            let copied = false;
            try { await navigator.clipboard.writeText(caption); copied = true; } catch (err) { /* not allowed here */ }
            if (canShareFile) {
                toast('Choose ' + t.label.replace(' Reels', '').replace(' Shorts', '') + ' in the list.' + (copied ? ' The caption is copied — paste it there.' : ''), 5000);
                try { await navigator.share({ files: [file], title: state.project.name, text: caption }); }
                catch (err) { if (err && err.name !== 'AbortError') toast('Sharing did not work here. Open ' + t.label + ' and choose the downloaded video.'); }
                return;
            }
            window.open(t.upload, '_blank', 'noopener');
            toast(t.how + (copied ? ' The caption is copied — paste it there.' : ''), 7000);
        };
        const sites = TARGETS.filter((t) => t.upload);
        sites.sort((x, y) => (y === exportTarget) - (x === exportTarget)); // the chosen site first
        const buttons = sites.map(function (t) {
            return el('button', {
                type: 'button', className: 'post' + (t === exportTarget ? ' primary' : ''), text: t.label,
                title: 'Post this video on ' + t.label, onclick: function () { post(t); }
            });
        });
        return el('div', { className: 'share-row post-row' }, [el('span', { className: 'hint', text: 'Post on:' })].concat(buttons));
    }

    function cancelExport() {
        const job = state.exporting;
        if (!job) return;
        job.cancelled = true;
        state.exporting = null;
        pause();
        if (job.recorder && job.recorder.state !== 'inactive') job.recorder.stop();
        toast('Export cancelled.');
        renderAll();
    }

    /* --------------------------------------------------------------- controls */

    $('play').addEventListener('click', togglePlay);
    $('to-start').addEventListener('click', function () { seek(0); });
    $('to-end').addEventListener('click', function () { pause(); seek(duration()); });
    $('prev-frame').addEventListener('click', function () { step(-1); });
    $('next-frame').addEventListener('click', function () { step(1); });
    $('snapshot').addEventListener('click', snapshot);
    $('undo').addEventListener('click', undo);
    $('redo').addEventListener('click', redo);
    $('tool-split').addEventListener('click', splitSelected);
    $('tool-delete').addEventListener('click', function (e) { deleteSelected(e.shiftKey); });
    $('tool-duplicate').addEventListener('click', duplicateSelected);
    $('add-text').addEventListener('click', function () { addTitle(); });
    $('add-handwrite').addEventListener('click', addHandwrittenTitle);
    $('add-draw').addEventListener('click', function () { openDrawMode(); });
    $('add-marker').addEventListener('click', addMarkerHere);
    $('add-video-track').addEventListener('click', function () { apply(T.addTrack(state.project, 'video')); });
    $('add-audio-track').addEventListener('click', function () { apply(T.addTrack(state.project, 'audio')); });
    $('add-text-track').addEventListener('click', function () { apply(T.addTrack(state.project, 'text')); });
    $('snap').addEventListener('click', function () {
        state.snap = !state.snap;
        $('snap').setAttribute('aria-pressed', String(state.snap));
    });
    $('zoom').addEventListener('input', function () { setZoom(sliderToPps(Number($('zoom').value))); });
    $('zoom-in').addEventListener('click', function () { setZoom(state.pps * 1.5); });
    $('zoom-out').addEventListener('click', function () { setZoom(state.pps / 1.5); });
    $('zoom-fit').addEventListener('click', zoomToFit);

    $('import').addEventListener('click', function () { wakeAudio(); relinkTarget = null; $('import-input').click(); });
    $('import-input').addEventListener('change', async function (e) {
        const ids = await importFiles(e.target.files);
        e.target.value = '';
        if (ids.length) toast(ids.length === 1 ? 'Imported. Double-click it or drag it onto the timeline.' : 'Imported ' + ids.length + ' files.');
    });

    $('new-project').addEventListener('click', newProject);
    $('save-project').addEventListener('click', saveProject);
    $('open-project').addEventListener('click', function () { $('open-input').click(); });
    $('open-input').addEventListener('change', function (e) {
        if (e.target.files[0]) openProjectFile(e.target.files[0]);
        e.target.value = '';
    });
    MENUS.forEach(function (which) {
        if (!$(which)) return;
        $(which).addEventListener('mouseenter', function () {
            // Like a desktop menu bar: once one menu is open, pointing at another opens it.
            const open = openMenuName();
            if (open && open !== which) openMenu(which);
        });
        $(which).addEventListener('click', function (e) {
            e.stopPropagation();
            if (openMenuName() === which) closeMenus(); else openMenu(which);
        });
    });
    document.addEventListener('click', function (e) {
        if (openMenuName() && !e.target.closest('.menu')) closeMenus();
    });

    $('project-name').addEventListener('change', function () {
        const name = $('project-name').value.trim() || 'Untitled project';
        state.project = T.clone(state.project);
        state.project.name = name;
        commit();
    });
    $('resolution').addEventListener('change', function () {
        const parts = $('resolution').value.split('x').map(Number);
        state.project = T.clone(state.project);
        state.project.width = parts[0];
        state.project.height = parts[1];
        commit();
    });
    $('fps').addEventListener('change', function () {
        state.project = T.clone(state.project);
        state.project.fps = Number($('fps').value);
        commit();
    });

    $('export').addEventListener('click', function () { wakeAudio(); openExport(); });
    $('export-format').addEventListener('change', updateExportNote);
    $('export-start').addEventListener('click', startExport);
    $('export-cancel').addEventListener('click', closeExport);

    $('toggle-bin').addEventListener('click', function () {
        const open = !$('workspace').classList.contains('show-bin');
        $('workspace').classList.remove('show-bin', 'show-inspector');
        if (open) $('workspace').classList.add('show-bin');
        syncMobilePanels();
    });
    $('toggle-inspector').addEventListener('click', function () {
        const open = !$('workspace').classList.contains('show-inspector');
        $('workspace').classList.remove('show-bin', 'show-inspector');
        if (open) $('workspace').classList.add('show-inspector');
        syncMobilePanels();
    });
    $('mobile-close-bin').addEventListener('click', function () { $('workspace').classList.remove('show-bin'); syncMobilePanels(); });
    $('mobile-close-inspector').addEventListener('click', function () { $('workspace').classList.remove('show-inspector'); syncMobilePanels(); });
    // Done: finish what is being typed (a text box saves when it loses focus), close the sheet, show the preview.
    function mobileDone(cls, saved) {
        const el = document.activeElement;
        if (el && el !== document.body && el.closest('.bin, .inspector')) el.blur();
        $('workspace').classList.remove(cls);
        syncMobilePanels();
        persist();
        if (saved) toast('Saved');
    }
    $('mobile-done-inspector').addEventListener('click', function () { mobileDone('show-inspector', true); });
    $('mobile-done-bin').addEventListener('click', function () { mobileDone('show-bin', false); });
    syncMobilePanels();

    // Timeline height: drag the bar between the workspace and the timeline.
    (function () {
        const bar = $('resizer');
        const saved = Number(storage((s) => s.getItem(LAYOUT_KEY)));
        if (saved > 0) document.body.style.setProperty('--timeline-h', saved + 'px');
        bar.addEventListener('pointerdown', function (e) {
            bar.setPointerCapture(e.pointerId);
            bar.classList.add('active');
            function move(ev) {
                const h = T.clamp(window.innerHeight - ev.clientY - 3, 140, window.innerHeight - 220);
                document.body.style.setProperty('--timeline-h', h + 'px');
                fitCanvas();
            }
            function up(ev) {
                bar.classList.remove('active');
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
                const h = window.innerHeight - ev.clientY - 3;
                storage((s) => s.setItem(LAYOUT_KEY, String(Math.round(T.clamp(h, 140, window.innerHeight - 220)))));
                renderTimeline();
            }
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
        });
    }());

    // Files dropped anywhere else go to the media bin.
    let dragDepth = 0;
    function hideDropOverlay() { dragDepth = 0; $('drop-overlay').hidden = true; }
    window.addEventListener('dragenter', function (e) {
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        dragDepth += 1;
        $('drop-overlay').hidden = false;
    });
    window.addEventListener('dragleave', function () {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) $('drop-overlay').hidden = true;
    });
    window.addEventListener('dragover', function (e) {
        if (Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', function (e) {
        e.preventDefault();
        hideDropOverlay();
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    document.addEventListener('keydown', function (e) {
        const gate = $('consentGate');
        if (gate && gate.open) return;
        if (drawMode) {
            const inField = e.target.closest && e.target.closest('input, select');
            if (e.key === 'Escape') { e.preventDefault(); closeDrawMode(false); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
                e.preventDefault();
                undoStroke();
            } else if (e.key === ' ' && !inField && !(e.target.closest && e.target.closest('button'))) {
                e.preventDefault();
                play();
            }
            return;
        }
        if (dialogStack.length) {
            if (e.key === 'Escape') dialogStack[dialogStack.length - 1].close();
            return;
        }
        if (!$('export-dialog').hidden) {
            if (e.key === 'Escape') closeExport();
            return;
        }
        const openName = openMenuName();
        if (openName) {
            if (e.key === 'Escape') { closeMenus(); $(openName).focus(); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const items = Array.from($(openName + '-menu').querySelectorAll('.menu-item:not([disabled])'));
                const i = items.indexOf(document.activeElement);
                const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
                if (next) next.focus();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const shown = MENUS.filter((m) => $(m) && $(m).offsetParent);
                const i = shown.indexOf(openName);
                openMenu(shown[(i + (e.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length]);
            }
            return;
        }
        const target = e.target;
        if (target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) {
            if (e.key === 'Escape') target.blur();
            return;
        }
        if (target.closest && target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        let handled = true;
        if (mod && key === 'z' && !e.shiftKey) undo();
        else if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) redo();
        else if (mod && key === 'd') duplicateSelected();
        else if (mod && key === 's') saveProject();
        else if (mod && key === 'c') copySelected();
        else if (mod && key === 'x') cutSelected();
        else if (mod && key === 'v') paste();
        else if (mod && key === 'a') selectAll();
        else if (mod) handled = false;
        else if (e.key === ' ') togglePlay();
        else if (key === 's') splitSelected();
        else if (key === 't') addTitle();
        else if (key === 'w') addHandwrittenTitle();
        else if (key === 'd') openDrawMode();
        else if (key === 'm') addMarkerHere();
        else if (key === 'f') freezeSelected();
        else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(e.shiftKey);
        else if (e.key === 'ArrowLeft') { if (!(e.altKey && nudge(-1 / state.project.fps))) e.shiftKey ? (pause(), seek(state.time - 1)) : step(-1); }
        else if (e.key === 'ArrowRight') { if (!(e.altKey && nudge(1 / state.project.fps))) e.shiftKey ? (pause(), seek(state.time + 1)) : step(1); }
        else if (e.key === 'Home') seek(0);
        else if (e.key === 'End') { pause(); seek(duration()); }
        else if (e.key === '=' || e.key === '+') setZoom(state.pps * 1.5);
        else if (e.key === '-' || e.key === '_') setZoom(state.pps / 1.5);
        else if (e.key === 'Escape') { selectOnly(null); selectMarker(null); }
        else handled = false;
        if (handled) e.preventDefault();
    });

    window.addEventListener('resize', function () { fitCanvas(); scheduleTimeline(); });
    if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe($('stage'));

    window.addEventListener('beforeunload', function (e) {
        if (state.exporting) { e.preventDefault(); e.returnValue = ''; }
    });

    /* ------------------------------------------------------ module interface */

    /**
     * What the optional modules use. Everything that changes the project goes
     * through `apply`/`commit`, so their edits are undoable like any other.
     */
    window.ReelApp = {
        config: CONFIG,
        refreshPlan: refreshPlan,
        T: T,
        state: state,
        files: files,
        FONTS: FONTS,
        el: el,
        $: $,
        toast: toast,
        fmt: fmt,
        download: download,
        safeName: safeName,
        formatBytes: formatBytes,
        duration: duration,
        commit: commit,
        apply: apply,
        afterChange: afterChange,
        renderAll: renderAll,
        requestDraw: requestDraw,
        drawFrame: drawFrame,
        previewBounds: previewBounds,
        applyTransition: applyTransition,
        pause: pause,
        play: play,
        seek: seek,
        importFiles: importFiles,
        placeMedia: placeMedia,
        addToTimeline: addToTimeline,
        selectOnly: selectOnly,
        selectMany: selectMany,
        zoomToFit: zoomToFit,
        openDialog: openDialog,
        dialogField: dialogField,
        fontsReady: fontsReady,
        duckFn: duckFn,
        waitFor: waitFor,
        imageFor: imageFor,
        makeCard: makeCard,
        openProjectInTab: openProjectInTab,
        focusLibraryProject: focusLibraryProject,
        addTitleTrack: function (p, name) { const id = T.nextTrackId(p, 'text'); return { project: T.addTrack(p, 'text', name), id: id }; },
        showAbout: showAbout,
        /** Adds a command to the Tools menu: { section, label, run }. */
        addTool: function (tool) { tools.push(tool); },
        /** Runs the first added tool whose label matches `re`; false when there is none. */
        runTool: function (re) { const t = tools.find((x) => re.test(x.label)); if (!t) return false; t.run(); return true; }
    };

    /* ------------------------------------------------------------------ start */

    restore();
    const zoom = Number(storage((s) => s.getItem('reel.zoom')));
    if (zoom >= MIN_PPS && zoom <= MAX_PPS) state.pps = zoom;
    $('zoom').value = String(ppsToSlider(state.pps));
    updatePlayButton();
    renderAll();
    updateRestoreBanner();
    fitCanvas();

    // Modules load after this file; once they have, bring back stored files
    // and anything handed over by the audio editor.
    async function afterModules() {
        await reattachStored(false);
        if (window.ReelStore) window.ReelStore.keepOnly(state.project.media.map((m) => m.id).concat(otherTabsMedia()));
        await takeHandoff();
        checkAudioEditor();
        renderInspector();
        const gate = $('consentGate');
        if (gate && gate.open) gate.addEventListener('close', maybeShowMobileNotice, { once: true });
        else maybeShowMobileNotice();
        document.documentElement.dataset.ready = 'true';
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', afterModules);
    else setTimeout(afterModules, 0);

    // A small handle for the end-to-end tests and the console.
    window.Reel = {
        get project() { return state.project; },
        get time() { return state.time; },
        get playing() { return state.playing; },
        get selected() { return state.selected; },
        get selection() { return state.selection.slice(); },
        get exporting() { return !!state.exporting; },
        seek: seek,
        play: play,
        pause: pause,
        select: function (id) { selectOnly(id); },
        drawFrame: function () { drawFrame(state.time); }
    };
}());
