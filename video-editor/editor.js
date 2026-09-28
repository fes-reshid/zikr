/*
 * Reel: the editor UI, preview engine and exporter.
 *
 * The timeline itself is data, edited only through TimelineCore (timeline.js),
 * so every change here is "compute the next project, then commit it". This
 * file owns what that data cannot hold: the imported files, the <video> and
 * <audio> elements that play them, the Web Audio graph, and the DOM.
 *
 * Nothing leaves the device. Files are opened as object URLs, the preview is
 * composited on a canvas, and export records that canvas with MediaRecorder.
 */
(function () {
    'use strict';

    const T = window.TimelineCore;
    const $ = (id) => document.getElementById(id);

    const STORAGE_KEY = 'reel.project';
    const LAYOUT_KEY = 'reel.timelineHeight';
    const MIN_PPS = 5;
    const MAX_PPS = 500;
    /** Media elements further than this from where they should be get re-seeked. */
    const DRIFT = 0.3;
    /** Stop waiting on a stalled element after this long rather than hanging. */
    const MAX_STALL_MS = 4000;
    const SNAP_PX = 8;

    const FONTS = {
        sans: 'system-ui, "Helvetica Neue", Arial, sans-serif',
        serif: 'Georgia, "Times New Roman", serif',
        display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
        mono: 'ui-monospace, Menlo, Consolas, monospace',
        hand: '"Comic Sans MS", "Marker Felt", "Segoe Print", cursive'
    };

    const ICONS = {
        play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path d="M7 4v16M17 4v16" stroke-width="3"/></svg>',
        eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
        eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>',
        sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 010 7M19 5.5a9 9 0 010 13"/></svg>',
        mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
        close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
        music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
        warn: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>'
    };

    /* ------------------------------------------------------------------ state */

    const state = {
        project: T.createProject(),
        history: null,
        selected: null,
        time: 0,
        playing: false,
        pps: 40,
        snap: true,
        exporting: null
    };
    state.history = new T.History(state.project);

    /** mediaId → { file, url, thumbnail, peaks, peakRate } for files on hand. */
    const files = new Map();
    /** clipId → { el, url, source, gain } — one media element per clip. */
    const pool = new Map();
    /** mediaId → HTMLImageElement */
    const images = new Map();

    let audio = null;
    let relinkTarget = null;

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
            if (c !== null && c !== undefined) node.append(c);
        });
        return node;
    }

    let toastTimer = null;
    function toast(message) {
        const t = $('toast');
        t.textContent = message;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
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

    function headWidth() {
        return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-w')) || 132;
    }

    /* ---------------------------------------------------------------- history */

    let saveTimer = null;
    function persist() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            storage(function (s) { s.setItem(STORAGE_KEY, T.serialize(state.project)); });
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
        if (state.selected && !T.getClip(state.project, state.selected)) state.selected = null;
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
     * master → speakers and → a stream the exporter records. Made on the first
     * user gesture, since browsers start an AudioContext suspended otherwise.
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

    function isTimed(clip) {
        const k = T.clipKind(state.project, clip);
        return k === 'video' || k === 'audio';
    }

    /**
     * Brings every media element in line with timeline time `t`. Paused, that
     * means seeking each active clip to its frame. Playing, it means starting
     * the ones that should be heard or seen, pausing the rest, correcting any
     * that drift, and seeking upcoming clips ahead of time so cuts land clean.
     *
     * Returns true while a clip that should be playing is still loading or
     * seeking, so the clock can wait for it instead of running ahead.
     */
    function syncMedia(t, playing) {
        const p = state.project;
        const active = T.activeClips(p, t).filter((c) => c.type !== 'text' && isTimed(c) && files.has(c.mediaId));
        const activeIds = new Set(active.map((c) => c.id));
        const gains = new Map(T.audibleClips(p, t).map((a) => [a.clip.id, a.gain]));
        const halfFrame = 0.5 / p.fps;

        pool.forEach(function (entry, id) {
            if (!activeIds.has(id) && !entry.el.paused) entry.el.pause();
        });

        const entries = active.map((c) => [c, elementFor(c)]).filter((pair) => pair[1]);
        let stalled = false;
        entries.forEach(function (pair) {
            const e = pair[1];
            setGain(e, gains.has(pair[0].id) ? gains.get(pair[0].id) : 0);
            if (playing && !e.el.error && (e.el.seeking || e.el.readyState < 3)) stalled = true;
        });

        entries.forEach(function (pair) {
            const c = pair[0];
            const e = pair[1];
            const target = T.sourceTime(c, t);
            const off = Math.abs(e.el.currentTime - target);
            if (!playing || stalled) {
                if (!e.el.paused && (!playing || e.el.readyState >= 3)) e.el.pause();
                if (!e.el.seeking && off > (playing ? 0.1 : halfFrame)) e.el.currentTime = target;
                return;
            }
            if (e.el.paused) {
                if (off > 0.1) e.el.currentTime = target;
                const started = e.el.play();
                if (started && started.catch) started.catch(function () {});
            } else if (off > DRIFT) {
                e.el.currentTime = target;
            }
        });

        if (playing) {
            p.clips.forEach(function (c) {
                if (c.type === 'text' || activeIds.has(c.id) || !isTimed(c) || !files.has(c.mediaId)) return;
                if (c.start <= t || c.start - t > 1.5) return;
                const e = elementFor(c);
                if (e && e.el.paused && !e.el.seeking && Math.abs(e.el.currentTime - c.in) > 0.05) e.el.currentTime = c.in;
            });
        }
        return stalled;
    }

    /* ---------------------------------------------------------------- preview */

    let drawQueued = false;
    function requestDraw() {
        if (drawQueued || state.playing) return;
        drawQueued = true;
        requestAnimationFrame(function () {
            drawQueued = false;
            if (state.playing) return;
            syncMedia(state.time, false);
            drawFrame(state.time);
        });
    }

    function drawFrame(t) {
        const p = state.project;
        const W = p.width;
        const H = p.height;
        if (canvas.width !== W || canvas.height !== H) {
            canvas.width = W;
            canvas.height = H;
            fitCanvas();
        }
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
        ctx.fillStyle = p.background || '#000';
        ctx.fillRect(0, 0, W, H);
        T.renderLayers(p, t).forEach(function (layer) {
            if (layer.alpha <= 0) return;
            ctx.globalAlpha = layer.alpha;
            if (layer.kind === 'text') drawText(layer.clip, W, H);
            else drawVisual(layer.clip, layer.kind, W, H);
        });
        ctx.restore();
    }

    function drawVisual(clip, kind, W, H) {
        if (!files.has(clip.mediaId)) { drawOffline(clip, W, H); return; }
        let src = null;
        let sw = 0;
        let sh = 0;
        if (kind === 'image') {
            const img = imageFor(clip.mediaId);
            if (img && img.complete && img.naturalWidth) { src = img; sw = img.naturalWidth; sh = img.naturalHeight; }
        } else {
            const e = elementFor(clip);
            if (e && e.el.readyState >= 2 && e.el.videoWidth) { src = e.el; sw = e.el.videoWidth; sh = e.el.videoHeight; }
        }
        if (!src) return;
        const r = T.placeRect(sw, sh, W, H, clip.fit, clip.scale, clip.x, clip.y);
        ctx.filter = T.filterString(clip.filters);
        ctx.drawImage(src, r.x, r.y, r.w, r.h);
        ctx.filter = 'none';
    }

    function drawOffline(clip, W, H) {
        const media = T.getMedia(state.project, clip.mediaId);
        const r = T.placeRect(media && media.width || W, media && media.height || H, W, H, clip.fit, clip.scale, clip.x, clip.y);
        ctx.fillStyle = '#2a2213';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#f2b84b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const size = Math.max(14, Math.round(Math.min(r.w, r.h) / 14));
        ctx.font = '600 ' + size + 'px ' + FONTS.sans;
        ctx.fillText('Media offline', r.x + r.w / 2, r.y + r.h / 2 - size * 0.7);
        ctx.font = size * 0.7 + 'px ' + FONTS.sans;
        ctx.fillText(media ? media.name : '', r.x + r.w / 2, r.y + r.h / 2 + size * 0.6);
    }

    /** Word-wraps each paragraph to `maxWidth` using the current font. */
    function wrapLines(text, maxWidth) {
        const out = [];
        String(text).split('\n').forEach(function (para) {
            const words = para.split(/(\s+)/);
            let line = '';
            words.forEach(function (w) {
                const next = line + w;
                if (line.trim() && ctx.measureText(next).width > maxWidth) {
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

    function drawText(clip, W, H) {
        if (!String(clip.text || '').trim()) return;
        // Sizes are authored against a 720-line frame and scale with it.
        const size = clip.fontSize * (H / 720);
        ctx.font = (clip.italic ? 'italic ' : '') + (clip.bold ? '700 ' : '400 ') + size + 'px ' + (FONTS[clip.font] || FONTS.sans);
        ctx.textBaseline = 'middle';
        const lines = wrapLines(clip.text, W * 0.9);
        const lineH = size * 1.2;
        const widths = lines.map((l) => ctx.measureText(l).width);
        const blockW = Math.max.apply(null, widths);
        const blockH = lines.length * lineH;
        const cx = clip.x * W;
        const top = clip.y * H - blockH / 2;

        if (clip.box) {
            const padX = size * 0.4;
            const padY = size * 0.2;
            ctx.fillStyle = clip.boxColor || '#000';
            ctx.beginPath();
            const bx = cx - blockW / 2 - padX;
            const by = top - padY;
            if (ctx.roundRect) ctx.roundRect(bx, by, blockW + padX * 2, blockH + padY * 2, size * 0.15);
            else ctx.rect(bx, by, blockW + padX * 2, blockH + padY * 2);
            ctx.fill();
        }
        if (clip.shadow) {
            ctx.shadowColor = 'rgba(0,0,0,.65)';
            ctx.shadowBlur = size * 0.12;
            ctx.shadowOffsetY = size * 0.04;
        }
        ctx.fillStyle = clip.color || '#fff';
        ctx.textAlign = clip.align || 'center';
        const x = clip.align === 'left' ? cx - blockW / 2 : clip.align === 'right' ? cx + blockW / 2 : cx;
        lines.forEach(function (line, i) {
            ctx.fillText(line, x, top + lineH * (i + 0.5));
        });
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
    }

    function fitCanvas() {
        const stage = $('stage');
        const box = stage.getBoundingClientRect();
        const pad = 24;
        const availW = Math.max(40, box.width - pad);
        const availH = Math.max(40, box.height - pad);
        const ratio = canvas.width / canvas.height;
        let w = availW;
        let h = w / ratio;
        if (h > availH) { h = availH; w = h * ratio; }
        canvas.style.width = Math.floor(w) + 'px';
        canvas.style.height = Math.floor(h) + 'px';
    }

    /* --------------------------------------------------------------- playback */

    let rafId = 0;
    let anchorTime = 0;
    let anchorWall = 0;
    let stallSince = null;

    function play() {
        if (state.playing) return;
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
            if (exporting) finishExport();
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

    /** Peak levels at 100 per second, for drawing waveforms on audio clips. */
    async function computePeaks(mediaId, file) {
        if (file.size > 200 * 1024 * 1024 || !window.OfflineAudioContext) return;
        try {
            const data = await file.arrayBuffer();
            const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
            const rate = 100;
            const count = Math.ceil(buffer.duration * rate);
            const peaks = new Float32Array(count);
            const per = buffer.sampleRate / rate;
            const stride = Math.max(1, Math.floor(per / 64));
            for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
                const samples = buffer.getChannelData(ch);
                for (let i = 0; i < count; i += 1) {
                    const end = Math.min(samples.length, Math.floor((i + 1) * per));
                    let m = peaks[i];
                    for (let s = Math.floor(i * per); s < end; s += stride) {
                        const v = Math.abs(samples[s]);
                        if (v > m) m = v;
                    }
                    peaks[i] = m;
                }
            }
            const f = files.get(mediaId);
            if (!f || f.file !== file) return;
            f.peaks = peaks;
            f.peakRate = rate;
            scheduleTimeline();
        } catch (err) {
            // No decodable audio; the clip just goes without a waveform.
        }
    }

    /**
     * Opens files and adds them to the media bin. A file matching a saved
     * item that is offline brings that item back instead of adding a copy.
     * Returns the ids of the items, in order.
     */
    async function importFiles(list) {
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
            let target = null;
            if (relinkTarget && T.getMedia(state.project, relinkTarget)) {
                target = T.getMedia(state.project, relinkTarget);
                relinkTarget = null;
            } else {
                const offline = { media: state.project.media.filter((m) => !files.has(m.id)) };
                target = T.matchMedia(offline, file);
            }
            const meta = {
                name: file.name, type: info.type, mime: file.type, size: file.size,
                lastModified: file.lastModified, duration: info.duration, width: info.width, height: info.height
            };
            let id;
            if (target) {
                id = target.id;
                const old = files.get(id);
                if (old) URL.revokeObjectURL(old.url);
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
            files.set(id, { file: file, url: url, thumbnail: info.thumbnail || null, peaks: null, peakRate: 0 });
            if (info.type === 'audio') computePeaks(id, file);
            ids.push(id);
        }
        relinkTarget = null;
        if (added) commit();
        else afterChange();
        updateRestoreBanner();
        return ids;
    }

    /** Puts a media item at the end of its main track and selects it. */
    function addToTimeline(mediaId) {
        const before = new Set(state.project.clips.map((c) => c.id));
        const wasEmpty = !state.project.clips.length;
        if (!apply(T.appendMedia(state.project, mediaId))) {
            toast('There is no track for that kind of media.');
            return;
        }
        const clip = state.project.clips.find((c) => !before.has(c.id));
        if (clip) select(clip.id);
        if (wasEmpty) zoomToFit();
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
        state.project = next;
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
        $('tool-delete').disabled = !clip;
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
                ' offline. Browsers do not keep files between visits — import ' +
                (offline.length === 1 ? 'it' : 'them') + ' again and ' +
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
            if (isMajor) tick.append(el('span', { text: rulerLabel(t, major) }));
            ruler.append(tick);
        }
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

    function clipElement(clip) {
        const p = state.project;
        const kind = T.clipKind(p, clip);
        const media = clip.type === 'text' ? null : T.getMedia(p, clip.mediaId);
        const f = media ? files.get(media.id) : null;
        const pps = state.pps;
        const width = Math.max(2, clip.duration * pps);
        const node = el('div', {
            className: 'clip k-' + kind + (clip.id === state.selected ? ' selected' : '') +
                (media && !f ? ' missing' : ''),
            'data-id': clip.id,
            title: (media ? media.name : clip.text) + '\n' + fmt(clip.start) + ' → ' + fmt(T.clipEnd(clip)),
            style: { left: clip.start * pps + 'px', width: width + 'px' }
        });
        if (f && f.thumbnail && kind !== 'audio') {
            node.append(el('div', { className: 'clip-thumbs', style: { backgroundImage: 'url("' + f.thumbnail + '")' } }));
        }
        if (f && f.peaks && kind === 'audio') node.append(waveform(clip, f, width));
        const label = clip.type === 'text' ? (clip.text || '').split('\n')[0] || 'Title' : media ? media.name : 'Missing media';
        node.append(el('span', { className: 'clip-label', text: label }));
        if (clip.fadeIn > 0) node.append(el('div', { className: 'clip-fade in', style: { width: clip.fadeIn * pps + 'px' } }));
        if (clip.fadeOut > 0) node.append(el('div', { className: 'clip-fade out', style: { width: clip.fadeOut * pps + 'px' } }));
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
        const perPx = clip.duration / w;
        const gain = Math.min(2, clip.volume === undefined ? 1 : clip.volume);
        for (let i = 0; i < w; i += 1) {
            const from = Math.floor((clip.in + i * perPx) * f.peakRate);
            const to = Math.max(from + 1, Math.floor((clip.in + (i + 1) * perPx) * f.peakRate));
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
        line.hidden = false;
        line.style.left = headWidth() + t * state.pps + 'px';
    }

    function select(id) {
        if (state.selected === id) return;
        state.selected = id;
        tl.querySelectorAll('.clip').forEach(function (n) { n.classList.toggle('selected', n.dataset.id === id); });
        renderInspector();
        updateButtons();
    }

    tl.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || state.exporting) return;
        if (e.target.closest('.tl-head, .tl-corner')) return;
        const clipNode = e.target.closest('.clip');
        const handle = e.target.closest('.handle');
        const onRuler = e.target.closest('.tl-ruler');
        const onLane = e.target.closest('.tl-lane');
        if (clipNode) {
            const clip = T.getClip(state.project, clipNode.dataset.id);
            if (!clip) return;
            select(clip.id);
            drag = {
                mode: handle ? 'trim' : 'move',
                edge: handle ? handle.dataset.edge : null,
                id: clip.id,
                base: state.project,
                x: e.clientX,
                y: e.clientY,
                grab: timeAt(e.clientX) - clip.start,
                moved: false
            };
        } else if (onRuler || onLane) {
            if (onLane) select(null);
            drag = { mode: 'scrub' };
            seek(timeAt(e.clientX));
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
        if (!drag) return;
        if (drag.mode === 'scrub') { seek(timeAt(e.clientX)); return; }
        if (!drag.moved && Math.abs(e.clientX - drag.x) < 3 && Math.abs(e.clientY - drag.y) < 3) return;
        drag.moved = true;
        const clip = T.getClip(drag.base, drag.id);
        const threshold = state.snap ? SNAP_PX / state.pps : 0;

        if (drag.mode === 'move') {
            let start = timeAt(e.clientX) - drag.grab;
            let snapped = null;
            if (state.snap) {
                const s = T.snapTime(drag.base, start, threshold, drag.id, [state.time]);
                const end = T.snapTime(drag.base, start + clip.duration, threshold, drag.id, [state.time]);
                const ds = Math.abs(s - start);
                const de = Math.abs(end - (start + clip.duration));
                if (s !== start && (end === start + clip.duration || ds <= de)) { start = s; snapped = s; }
                else if (end !== start + clip.duration) { start = end - clip.duration; snapped = end; }
            }
            const row = rowAt(e.clientY);
            let track = clip.track;
            if (row && row.dataset.kind === T.getTrack(drag.base, clip.track).kind) track = row.dataset.track;
            state.project = T.moveClip(drag.base, drag.id, start, track);
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
        const n = tl.querySelector('.clip[data-id="' + drag.id + '"]');
        if (n) n.classList.add('dragging');
        requestDraw();
    });

    function endDrag() {
        if (!drag) return;
        const d = drag;
        drag = null;
        showSnap(null);
        if ((d.mode === 'move' || d.mode === 'trim') && d.moved && state.project !== d.base) commit();
        else if (d.mode !== 'scrub') scheduleTimeline();
    }
    tl.addEventListener('pointerup', endDrag);
    tl.addEventListener('pointercancel', endDrag);

    tl.addEventListener('dblclick', function (e) {
        const clipNode = e.target.closest('.clip');
        if (!clipNode) return;
        const clip = T.getClip(state.project, clipNode.dataset.id);
        if (clip && clip.type === 'text') {
            const box = $('inspector').querySelector('textarea');
            if (box) { box.focus(); box.select(); }
        }
    });

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

    function select_(clip, label, key, options) {
        const input = el('select', null, options.map((o) => el('option', { value: o[0], text: o[1] })));
        input.value = clip[key];
        input.addEventListener('change', function () {
            const patch = {};
            patch[key] = input.value;
            state.project = T.updateClip(state.project, clip.id, patch);
            commit();
        });
        return control(label, input);
    }

    function checkbox(clip, label, key) {
        const input = el('input', { type: 'checkbox' });
        input.checked = !!clip[key];
        input.addEventListener('change', function () {
            const patch = {};
            patch[key] = input.checked;
            state.project = T.updateClip(state.project, clip.id, patch);
            commit();
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

    const pct = (v) => Math.round(v) + '%';
    const secs = (v) => Number(v).toFixed(1) + 's';

    function renderInspector() {
        const box = $('inspector');
        box.textContent = '';
        const clip = selectedClip();
        if (!clip) { renderProjectInspector(box); return; }
        const p = state.project;
        const kind = T.clipKind(p, clip);
        const media = clip.type === 'text' ? null : T.getMedia(p, clip.mediaId);
        const kindLabel = { video: 'Video', image: 'Image', audio: 'Audio', text: 'Title' }[kind];

        box.append(el('div', { className: 'insp-title' }, [
            el('span', { className: 'chip', text: kindLabel }),
            el('span', { text: media ? media.name : 'Title', title: media ? media.name : '' })
        ]));

        const timing = [
            timeField('Start', clip.start, (v) => T.moveClip(state.project, clip.id, v)),
            timeField('Length', clip.duration, (v) => T.trimClip(state.project, clip.id, 'end', clip.start + v))
        ];
        if (kind === 'video' || kind === 'audio') {
            timing.push(control('From', el('input', { type: 'text', value: fmt(clip.in) + ' in source', readonly: true, tabindex: '-1' })));
        }
        box.append(group('Timing', timing));

        if (kind === 'text') {
            const area = el('textarea', { rows: 3, spellcheck: 'true' });
            area.value = clip.text;
            area.addEventListener('input', function () { liveEdit(clip.id, { text: area.value }); });
            area.addEventListener('change', commitQuiet);
            box.append(group('Text', [
                control('Text', area),
                select_(clip, 'Font', 'font', [['sans', 'Sans'], ['serif', 'Serif'], ['display', 'Display'], ['mono', 'Mono'], ['hand', 'Handwritten']]),
                slider(clip, 'Size', (c) => c.fontSize, (v) => ({ fontSize: v }), { min: 12, max: 240, show: (v) => v + 'px' }),
                colour(clip, 'Colour', 'color'),
                select_(clip, 'Align', 'align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]),
                el('div', { className: 'row-buttons' }, [checkbox(clip, 'Bold', 'bold'), checkbox(clip, 'Italic', 'italic'), checkbox(clip, 'Shadow', 'shadow')]),
                el('div', { className: 'row-buttons' }, [checkbox(clip, 'Background box', 'box')]),
                clip.box ? colour(clip, 'Box colour', 'boxColor') : null
            ]));
        }

        if (kind !== 'audio') {
            const layout = [];
            if (kind !== 'text') {
                layout.push(select_(clip, 'Fit', 'fit', [['contain', 'Fit inside (letterbox)'], ['cover', 'Fill frame (crop)']]));
                layout.push(slider(clip, 'Scale', (c) => Math.round((c.scale || 1) * 100), (v) => ({ scale: v / 100 }), { min: 10, max: 300, show: pct }));
            }
            layout.push(slider(clip, 'Position X', (c) => Math.round(c.x * 100), (v) => ({ x: v / 100 }), { show: pct }));
            layout.push(slider(clip, 'Position Y', (c) => Math.round(c.y * 100), (v) => ({ y: v / 100 }), { show: pct }));
            layout.push(slider(clip, 'Opacity', (c) => Math.round((c.opacity === undefined ? 1 : c.opacity) * 100), (v) => ({ opacity: v / 100 }), { show: pct }));
            const presets = el('div', { className: 'row-buttons' }, [
                ['Full', { scale: 1, x: 0.5, y: 0.5 }],
                ['Corner', kind === 'text' ? { x: 0.8, y: 0.12 } : { scale: 0.3, x: 0.82, y: 0.18 }],
                ['Lower third', kind === 'text' ? { x: 0.5, y: 0.84 } : { scale: 0.4, x: 0.5, y: 0.78 }]
            ].map(function (preset) {
                return el('button', { className: 'ghost', text: preset[0], onclick: function () { apply(T.updateClip(state.project, clip.id, preset[1])); } });
            }));
            layout.push(presets);
            box.append(group('Layout', layout));
        }

        if (kind === 'video' || kind === 'image') {
            box.append(group('Colour', [
                slider(clip, 'Brightness', (c) => c.filters.brightness, (v) => ({ filters: { brightness: v } }), { max: 200, show: pct }),
                slider(clip, 'Contrast', (c) => c.filters.contrast, (v) => ({ filters: { contrast: v } }), { max: 200, show: pct }),
                slider(clip, 'Saturation', (c) => c.filters.saturate, (v) => ({ filters: { saturate: v } }), { max: 200, show: pct }),
                slider(clip, 'Greyscale', (c) => c.filters.grayscale, (v) => ({ filters: { grayscale: v } }), { show: pct }),
                slider(clip, 'Blur', (c) => c.filters.blur || 0, (v) => ({ filters: { blur: v } }), { max: 20, step: 0.5, show: (v) => v + 'px' }),
                el('div', { className: 'row-buttons' }, [el('button', {
                    className: 'ghost', text: 'Reset colour',
                    onclick: function () { apply(T.updateClip(state.project, clip.id, { filters: T.clone(T.DEFAULT_FILTERS) })); }
                })])
            ]));
        }

        if (kind === 'video' || kind === 'audio') {
            box.append(group('Sound', [
                slider(clip, 'Volume', (c) => Math.round(c.volume * 100), (v) => ({ volume: v / 100 }), { max: 200, show: pct }),
                checkbox(clip, 'Mute this clip', 'muted')
            ]));
        }

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

    function renderProjectInspector(box) {
        const p = state.project;
        const bg = el('input', { type: 'color', value: p.background || '#000000' });
        bg.addEventListener('input', function () {
            state.project = T.clone(state.project);
            state.project.background = bg.value;
            requestDraw();
        });
        bg.addEventListener('change', commitQuiet);
        const shortcuts = [
            ['Space', 'Play / pause'], ['S', 'Split at playhead'], ['Del', 'Delete clip'],
            ['Shift+Del', 'Delete and close gap'], ['Ctrl+D', 'Duplicate'], ['T', 'Add title'],
            ['← →', 'Step a frame'], ['Shift+← →', 'Step a second'], ['Home / End', 'Start / end'],
            ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['+ / −', 'Zoom'], ['Ctrl+wheel', 'Zoom at pointer']
        ];
        box.append(
            el('div', { className: 'insp-title' }, [el('span', { className: 'chip', text: 'Project' }), el('span', { text: p.name })]),
            group('Project', [
                control('Background', bg),
                el('div', { className: 'check', text: p.width + '×' + p.height + ' · ' + p.fps + ' fps · ' + fmt(duration()) }),
                el('div', { className: 'check', text: p.clips.length + ' clip' + (p.clips.length === 1 ? '' : 's') + ' on ' + p.tracks.length + ' tracks' })
            ]),
            group('Shortcuts', [el('div', { className: 'shortcuts' }, shortcuts.reduce(function (acc, s) {
                acc.push(el('kbd', { text: s[0] }), el('span', { text: s[1] }));
                return acc;
            }, []))])
        );
    }

    /* ---------------------------------------------------------------- editing */

    function splitSelected() {
        const clip = selectedClip();
        const ids = clip && T.activeClips(state.project, state.time).some((c) => c.id === clip.id) ? [clip.id] : null;
        if (!apply(T.splitAt(state.project, state.time, ids))) toast('Move the playhead over a clip to split it.');
    }

    function deleteSelected(ripple) {
        const clip = selectedClip();
        if (!clip) return;
        state.selected = null;
        apply(T.deleteClips(state.project, [clip.id], ripple));
    }

    function duplicateSelected() {
        const clip = selectedClip();
        if (!clip) return;
        const r = T.duplicateClip(state.project, clip.id);
        state.selected = r.id;
        apply(r.project);
    }

    function addTitle() {
        const track = T.lowestTrack(state.project, 'text');
        if (!track) return;
        const clip = T.textClip(track.id, state.time);
        const next = T.addClip(state.project, clip);
        if (next === state.project) return;
        state.selected = clip.id;
        apply(next);
        const box = $('inspector').querySelector('textarea');
        if (box) { box.focus(); box.select(); }
    }

    function nudge(delta) {
        const clip = selectedClip();
        if (!clip) return false;
        apply(T.moveClip(state.project, clip.id, clip.start + delta));
        return true;
    }

    /* ---------------------------------------------------------------- project */

    function newProject() {
        if (state.project.clips.length && !window.confirm('Start a new project? The current timeline will be cleared.')) return;
        pause();
        const keep = { width: state.project.width, height: state.project.height, fps: state.project.fps };
        state.project = T.createProject(keep);
        state.history = new T.History(state.project);
        state.selected = null;
        state.time = 0;
        afterChange();
        updateRestoreBanner();
    }

    function saveProject() {
        const blob = new Blob([T.serialize(state.project)], { type: 'application/json' });
        download(blob, safeName(state.project.name) + '.reel.json');
        toast('Saved. Media files are not included — keep them alongside the project.');
    }

    /** Loads a project, reconnecting any of its media already imported this visit. */
    function loadProject(p) {
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
        state.selected = null;
        state.time = 0;
        afterChange();
        updateRestoreBanner();
        zoomToFit();
    }

    async function openProjectFile(file) {
        try {
            loadProject(T.deserialize(await file.text()));
            const offline = state.project.media.filter((m) => !files.has(m.id)).length;
            toast(offline ? 'Opened. Import its ' + offline + ' media file' + (offline === 1 ? '' : 's') + ' to bring them online.' : 'Opened.');
        } catch (err) {
            toast(err.message);
        }
    }

    function restore() {
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

    function snapshot() {
        pause();
        drawFrame(state.time);
        canvas.toBlob(function (blob) {
            if (blob) download(blob, safeName(state.project.name) + ' ' + fmt(state.time).replace(/[:.]/g, '-') + '.png');
        }, 'image/png');
    }

    /* ----------------------------------------------------------------- export */

    const FORMATS = [
        { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4', label: 'MP4 · H.264' },
        { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM · VP9' },
        { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM · VP8' },
        { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
        { mime: 'video/webm', ext: 'webm', label: 'WebM' }
    ];

    function supportedFormats() {
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return [];
        const ok = FORMATS.filter(function (f) {
            try { return MediaRecorder.isTypeSupported(f.mime); } catch (err) { return false; }
        });
        // Generic entries only when no codec-specific one of that container works.
        return ok.filter((f) => f.mime.includes('codecs') || !ok.some((g) => g.ext === f.ext && g.mime.includes('codecs')));
    }

    function openExport() {
        if (!state.project.clips.length) { toast('Add something to the timeline first.'); return; }
        pause();
        const formats = supportedFormats();
        const sel = $('export-format');
        sel.textContent = '';
        formats.forEach(function (f, i) { sel.append(el('option', { value: String(i), text: f.label })); });
        const p = state.project;
        $('export-summary').textContent = formats.length
            ? p.width + '×' + p.height + ' · ' + p.fps + ' fps · ' + fmt(duration()) + ' long'
            : 'This browser cannot record video. Try a recent Chrome, Edge, Firefox or Safari.';
        $('export-start').disabled = !formats.length;
        $('export-setup').hidden = false;
        $('export-progress').hidden = true;
        $('export-result').hidden = true;
        $('export-start').hidden = false;
        $('export-cancel').textContent = 'Cancel';
        $('export-dialog').hidden = false;
        sel.focus();
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
        const waits = T.activeClips(state.project, t)
            .filter((c) => c.type !== 'text' && files.has(c.mediaId))
            .map(function (c) {
                if (!isTimed(c)) {
                    const img = imageFor(c.mediaId);
                    return img && !img.complete ? waitFor(img, 'load', 5000).catch(() => {}) : null;
                }
                const e = elementFor(c);
                if (!e || (e.el.readyState >= 3 && !e.el.seeking)) return null;
                return waitFor(e.el, e.el.seeking ? 'seeked' : 'canplay', 5000).catch(() => {});
            })
            .filter(Boolean);
        await Promise.all(waits);
    }

    async function startExport() {
        const formats = supportedFormats();
        const format = formats[Number($('export-format').value) || 0];
        if (!format) return;
        const a = wakeAudio();
        if (a && a.ctx.state === 'suspended') { try { await a.ctx.resume(); } catch (err) { /* export silently */ } }

        $('export-setup').hidden = true;
        $('export-progress').hidden = false;
        $('export-start').hidden = true;
        $('export-status').textContent = 'Preparing…';
        $('export-bar').value = 0;

        const job = { format: format, chunks: [], cancelled: false, recorder: null, started: performance.now() };
        state.exporting = job;
        pause();
        state.selected = null;
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
        recorder.onstop = function () { if (!job.cancelled) deliverExport(job); };
        recorder.start(1000);
        $('export-status').textContent = 'Recording…';
        play();
    }

    /** Pauses the recording while the timeline waits on a stalled clip. */
    function holdRecorder(hold) {
        const r = state.exporting && state.exporting.recorder;
        if (!r) return;
        if (hold && r.state === 'recording') r.pause();
        else if (!hold && r.state === 'paused') r.resume();
    }

    function exportProgress(fraction) {
        const job = state.exporting;
        $('export-bar').value = fraction;
        const elapsed = (performance.now() - job.started) / 1000;
        const left = fraction > 0.02 ? Math.max(0, elapsed / fraction - elapsed) : null;
        $('export-status').textContent = 'Recording… ' + Math.round(fraction * 100) + '%' +
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

    async function deliverExport(job) {
        const type = job.format.mime.split(';')[0];
        let blob = new Blob(job.chunks, { type: type });
        if (job.format.ext === 'webm' && window.ReelWebm) {
            try {
                const patched = window.ReelWebm.setDuration(new Uint8Array(await blob.arrayBuffer()), duration() * 1000);
                if (patched) blob = new Blob([patched], { type: type });
            } catch (err) { /* keep the unpatched file */ }
        }
        state.exporting = null;
        const name = safeName(state.project.name) + '.' + job.format.ext;
        const url = URL.createObjectURL(blob);
        const result = $('export-result');
        result.textContent = '';
        result.append(
            el('p', { text: 'Done — ' + formatBytes(blob.size) + '. Your download should start; if not, use the link.' }),
            el('a', { href: url, download: name, id: 'export-download', text: 'Download ' + name })
        );
        $('export-progress').hidden = true;
        result.hidden = false;
        $('export-cancel').textContent = 'Close';
        result.querySelector('a').click();
        renderAll();
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
    $('add-text').addEventListener('click', addTitle);
    $('add-video-track').addEventListener('click', function () { apply(T.addTrack(state.project, 'video')); });
    $('add-audio-track').addEventListener('click', function () { apply(T.addTrack(state.project, 'audio')); });
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
    $('export-start').addEventListener('click', startExport);
    $('export-cancel').addEventListener('click', closeExport);

    $('toggle-bin').addEventListener('click', function () { $('workspace').classList.toggle('show-bin'); });
    $('toggle-inspector').addEventListener('click', function () { $('workspace').classList.toggle('show-inspector'); });

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
        if (!$('export-dialog').hidden) {
            if (e.key === 'Escape') closeExport();
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
        else if (mod) handled = false;
        else if (e.key === ' ') togglePlay();
        else if (key === 's') splitSelected();
        else if (key === 't') addTitle();
        else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(e.shiftKey);
        else if (e.key === 'ArrowLeft') { if (!(e.altKey && nudge(-1 / state.project.fps))) e.shiftKey ? (pause(), seek(state.time - 1)) : step(-1); }
        else if (e.key === 'ArrowRight') { if (!(e.altKey && nudge(1 / state.project.fps))) e.shiftKey ? (pause(), seek(state.time + 1)) : step(1); }
        else if (e.key === 'Home') seek(0);
        else if (e.key === 'End') { pause(); seek(duration()); }
        else if (e.key === '=' || e.key === '+') setZoom(state.pps * 1.5);
        else if (e.key === '-' || e.key === '_') setZoom(state.pps / 1.5);
        else if (e.key === 'Escape') select(null);
        else handled = false;
        if (handled) e.preventDefault();
    });

    window.addEventListener('resize', function () { fitCanvas(); scheduleTimeline(); });
    if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe($('stage'));

    window.addEventListener('beforeunload', function (e) {
        if (state.exporting) { e.preventDefault(); e.returnValue = ''; }
    });

    /* ------------------------------------------------------------------ start */

    restore();
    const zoom = Number(storage((s) => s.getItem('reel.zoom')));
    if (zoom >= MIN_PPS && zoom <= MAX_PPS) state.pps = zoom;
    $('zoom').value = String(ppsToSlider(state.pps));
    updatePlayButton();
    renderAll();
    updateRestoreBanner();
    fitCanvas();

    // A small handle for the end-to-end tests and the console.
    window.Reel = {
        get project() { return state.project; },
        get time() { return state.time; },
        get playing() { return state.playing; },
        get selected() { return state.selected; },
        get exporting() { return !!state.exporting; },
        seek: seek,
        play: play,
        pause: pause,
        select: function (id) { select(id); },
        drawFrame: function () { drawFrame(state.time); }
    };
}());
