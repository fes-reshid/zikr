/*
 * Reel: fast, frame-exact export with WebCodecs.
 *
 * The real-time exporter records the preview as it plays, so it takes as long
 * as the video and needs the tab in front. This one renders frame by frame
 * instead: each source video is decoded with mediabunny (vendored in
 * vendor/), exactly the frame each clip needs at each moment; the frame is
 * composited with the same drawFrame as the preview; and it is encoded with
 * the browser's WebCodecs encoder into MP4 or WebM. Sound comes from
 * ReelMix.render. Nothing waits on a clock, so it runs as fast as the
 * machine can decode and encode, and keeps going in a background tab.
 *
 * mediabunny is loaded only when the export dialog opens.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const script = document.currentScript;
    const version = script ? new URL(script.src).searchParams.get('v') : '';
    const LIB = 'vendor/mediabunny.min.mjs' + (version ? '?v=' + version : '');

    let libP = null;

    function supported() {
        return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' &&
            /^https?:$/.test(location.protocol);
    }

    function load() {
        if (!libP) {
            libP = import(new URL(LIB, script ? script.src : location.href).href).then(function (m) {
                api.lib = m;
                return m;
            });
            libP.catch(function () { libP = null; });
        }
        return libP;
    }

    /** Yields to the page without the 1-second timer throttling background tabs get. */
    function breathe() {
        return new Promise(function (resolve) {
            const ch = new MessageChannel();
            ch.port1.onmessage = function () { resolve(); };
            ch.port2.postMessage(0);
        });
    }

    /** What this browser can encode, best first. */
    async function formats(project) {
        if (!supported()) return [];
        let M;
        try { M = await load(); } catch (err) { return []; }
        const size = { width: project.width, height: project.height, bitrate: 6e6 };
        const firstAudio = async function (list) {
            for (const c of list) { try { if (await M.canEncodeAudio(c)) return c; } catch (err) { /* next */ } }
            return null;
        };
        const out = [];
        try {
            if (await M.canEncodeVideo('avc', size)) {
                out.push({ id: 'mp4-avc', label: 'MP4 · H.264', ext: 'mp4', container: 'mp4', video: 'avc', audio: await firstAudio(['aac', 'opus']) });
            }
        } catch (err) { /* not available */ }
        try {
            if (await M.canEncodeVideo('vp9', size)) {
                out.push({ id: 'webm-vp9', label: 'WebM · VP9', ext: 'webm', container: 'webm', video: 'vp9', audio: await firstAudio(['opus']) });
            } else if (await M.canEncodeVideo('vp8', size)) {
                out.push({ id: 'webm-vp8', label: 'WebM · VP8', ext: 'webm', container: 'webm', video: 'vp8', audio: await firstAudio(['opus']) });
            }
        } catch (err) { /* not available */ }
        return out;
    }

    /** A clip's source time at `t`, kept inside its file. */
    function sourceAt(project, clip, t) {
        const len = T.sourceLength(project, clip);
        const raw = T.sourceTime(clip, t);
        return Math.max(0, isFinite(len) ? Math.min(raw, Math.max(0, len - 0.001)) : raw);
    }

    async function run(o) {
        const M = await load();
        const p = T.clone(app.state.project);
        const fps = p.fps;
        const total = T.projectDuration(p);
        const count = Math.max(1, Math.round(total * fps));
        const cancelled = () => o.isCancelled && o.isCancelled();

        // 1. Sound, rendered offline.
        let mix = null;
        if (o.format.audio && window.ReelMix) {
            o.onStatus('Mixing the sound…');
            mix = await window.ReelMix.render(p, {
                sampleRate: 48000,
                isCancelled: cancelled,
                onProgress: (f) => o.onProgress(f * 0.1, 'Mixing sound…')
            });
        }
        if (cancelled()) throw new Error('cancelled');

        // 2. Which source frame every visible video clip needs, frame by frame.
        const plan = new Map();
        const perFrame = new Array(count);
        const imagesUsed = new Set();
        for (let i = 0; i < count; i += 1) {
            const t = i / fps;
            const ids = [];
            T.renderLayers(p, t).forEach(function (layer) {
                if (!app.files.has(layer.clip.mediaId)) return;
                if (layer.kind === 'image') { imagesUsed.add(layer.clip.mediaId); return; }
                if (layer.kind !== 'video') return;
                ids.push(layer.clip.id);
                if (!plan.has(layer.clip.id)) plan.set(layer.clip.id, []);
                plan.get(layer.clip.id).push(sourceAt(p, layer.clip, t));
            });
            perFrame[i] = ids;
        }
        await Promise.all(Array.from(imagesUsed).map(function (id) {
            const img = app.imageFor(id);
            return img && !img.complete ? app.waitFor(img, 'load', 10000).catch(() => null) : null;
        }));

        // 3. One decoder per clip, each walking forward through its timestamps.
        o.onStatus('Opening the video files…');
        const inputs = new Map();
        const iterators = new Map();
        for (const pair of plan) {
            const clip = T.getClip(p, pair[0]);
            let entry = inputs.get(clip.mediaId);
            if (!entry) {
                const input = new M.Input({ source: new M.BlobSource(app.files.get(clip.mediaId).file), formats: M.ALL_FORMATS });
                entry = { input: input, track: await input.getPrimaryVideoTrack() };
                inputs.set(clip.mediaId, entry);
            }
            if (!entry.track) continue;
            const sink = new M.CanvasSink(entry.track, { poolSize: 3 });
            iterators.set(pair[0], sink.canvasesAtTimestamps(pair[1])[Symbol.asyncIterator]());
        }

        // 4. Encode.
        const canvas = document.createElement('canvas');
        canvas.width = p.width;
        canvas.height = p.height;
        const c2d = canvas.getContext('2d');
        const output = new M.Output({
            format: o.format.container === 'mp4' ? new M.Mp4OutputFormat({ fastStart: 'in-memory' }) : new M.WebMOutputFormat(),
            target: new M.BufferTarget()
        });
        const video = new M.CanvasSource(canvas, { codec: o.format.video, bitrate: o.bitrate, keyFrameInterval: 2 });
        output.addVideoTrack(video, { frameRate: fps });
        let sound = null;
        if (mix && o.format.audio) {
            sound = new M.AudioBufferSource({ codec: o.format.audio, bitrate: 192000 });
            output.addAudioTrack(sound);
        }
        await output.start();
        if (sound) {
            await sound.add(mix);
            sound.close();
        }

        const current = new Map();
        const source = function (clip, kind) {
            if (kind === 'image') {
                const img = app.imageFor(clip.mediaId);
                return img && img.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
            }
            const w = current.get(clip.id);
            return w ? { src: w.canvas, w: w.canvas.width, h: w.canvas.height } : null;
        };
        const preview = app.$('preview');
        const previewCtx = preview.getContext('2d');
        const started = performance.now();
        o.onStatus('Rendering…');

        try {
            for (let i = 0; i < count; i += 1) {
                if (cancelled()) throw new Error('cancelled');
                for (const id of perFrame[i]) {
                    const it = iterators.get(id);
                    if (!it) continue;
                    const r = await it.next();
                    if (!r.done && r.value) current.set(id, r.value);
                }
                const t = i / fps;
                app.drawFrame(t, { ctx: c2d, source: source });
                await video.add(t, 1 / fps);
                if (i % 6 === 0 || i === count - 1) {
                    if (preview.width === canvas.width && preview.height === canvas.height) previewCtx.drawImage(canvas, 0, 0);
                    const secs = (performance.now() - started) / 1000;
                    const speed = secs > 0.5 ? ' · ' + (t / secs).toFixed(1) + '× real time' : '';
                    o.onProgress(0.1 + 0.88 * (i + 1) / count, 'Rendering' + speed);
                    await breathe();
                }
            }
            video.close();
            o.onStatus('Finishing the file…');
            await output.finalize();
        } catch (err) {
            try { await output.cancel(); } catch (e) { /* already closed */ }
            throw err;
        } finally {
            iterators.forEach(function (it) { if (it.return) it.return().catch(() => null); });
            inputs.forEach(function (entry) { if (entry.input.dispose) entry.input.dispose(); });
        }
        const mime = o.format.container === 'mp4' ? 'video/mp4' : 'video/webm';
        return new Blob([output.target.buffer], { type: mime });
    }

    const api = { supported: supported, load: load, formats: formats, run: run, lib: null };
    window.ReelFastExport = api;
}());
