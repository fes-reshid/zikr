/*
 * Reel: the project's sound, rendered offline.
 *
 * The preview plays sound through media elements in real time; export and
 * speech recognition need the whole mix at once, faster than real time. This
 * rebuilds it in an OfflineAudioContext from the same model: each clip's
 * source is decoded, time-stretched to its speed without changing pitch
 * (ReelAudio.timeStretch — the preview's media elements also keep pitch),
 * and scheduled with a gain curve from TimelineCore.clipGainAt, the same
 * numbers the preview uses for volume, fades, transitions and ducking.
 *
 * It also runs "Clean up voice": RNNoise, the small speech-trained noise
 * remover the audio editor uses, on one clip's sound.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const A = window.ReelAudio;
    const RATE = 48000;
    const GAIN_STEP = 0.02;

    /**
     * The samples of a media file between two source times, as
     * { channels: Float32Array[], sampleRate }. Uses the streaming decoder
     * when the fast exporter's library is loaded (it decodes only what is
     * needed), otherwise the browser's whole-file decoder, cached per call.
     */
    async function decodeRange(mediaId, from, to, cache) {
        const f = app.files.get(mediaId);
        if (!f) return null;
        const M = window.ReelFastExport && window.ReelFastExport.lib;
        if (M) {
            try {
                const input = new M.Input({ source: new M.BlobSource(f.file), formats: M.ALL_FORMATS });
                const track = await input.getPrimaryAudioTrack();
                if (!track) { input.dispose && input.dispose(); return null; }
                const sink = new M.AudioBufferSink(track);
                let rate = 0;
                let chans = 0;
                const parts = [];
                for await (const wrapped of sink.buffers(Math.max(0, from - 0.05), to + 0.05)) {
                    const b = wrapped.buffer;
                    rate = b.sampleRate;
                    chans = Math.max(chans, b.numberOfChannels);
                    parts.push({ t: wrapped.timestamp, buffer: b });
                }
                if (input.dispose) input.dispose();
                if (!parts.length) return null;
                const n = Math.max(1, Math.round((to - from) * rate));
                const channels = [];
                for (let c = 0; c < chans; c += 1) channels.push(new Float32Array(n));
                parts.forEach(function (part) {
                    const offset = Math.round((part.t - from) * rate);
                    for (let c = 0; c < chans; c += 1) {
                        const src = part.buffer.getChannelData(Math.min(c, part.buffer.numberOfChannels - 1));
                        for (let i = 0; i < src.length; i += 1) {
                            const j = offset + i;
                            if (j >= 0 && j < n) channels[c][j] = src[i];
                        }
                    }
                });
                return { channels: channels, sampleRate: rate };
            } catch (err) {
                // Fall through to the browser's decoder.
            }
        }
        let whole = cache && cache.get(mediaId);
        if (!whole) {
            whole = f.file.arrayBuffer()
                .then((data) => new OfflineAudioContext(1, 1, RATE).decodeAudioData(data))
                .catch(() => null);
            if (cache) cache.set(mediaId, whole);
        }
        const buffer = await whole;
        if (!buffer) return null;
        const a = Math.max(0, Math.floor(from * buffer.sampleRate));
        const b = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate));
        if (b <= a) return null;
        const channels = [];
        for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c).slice(a, b));
        return { channels: channels, sampleRate: buffer.sampleRate };
    }

    function toBuffer(ctx, seg) {
        const buf = ctx.createBuffer(seg.channels.length, seg.channels[0].length, seg.sampleRate);
        seg.channels.forEach(function (c, i) { buf.copyToChannel(c, i); });
        return buf;
    }

    /**
     * Renders the project's sound between `from` and `to` (default: all of
     * it) to a stereo AudioBuffer. Resolves to null if nothing is audible.
     */
    async function render(project, options) {
        const o = Object.assign({ from: 0, to: T.projectDuration(project), sampleRate: RATE, channels: 2 }, options);
        const span = o.to - o.from;
        if (!(span > 0)) return null;
        const ctx = new OfflineAudioContext(o.channels, Math.max(1, Math.ceil(span * o.sampleRate)), o.sampleRate);
        const duck = project.tracks.some((t) => t.kind === 'audio' && t.duck) ? app.duckFn() : null;
        const cache = new Map();
        const clips = project.clips.filter(function (c) {
            if (!T.isTimed(project, c) || c.muted || !app.files.has(c.mediaId)) return false;
            const track = T.getTrack(project, c.track);
            return track && !track.muted;
        });
        let scheduled = 0;
        for (let k = 0; k < clips.length; k += 1) {
            if (o.isCancelled && o.isCancelled()) return null;
            const c = clips[k];
            const win = T.soundWindow(project, c);
            let ws = Math.max(win.start, o.from);
            const we = Math.min(win.end, o.to);
            if (we <= ws) continue;
            const speed = T.speedOf(c);
            let srcFrom = T.sourceTime(c, ws);
            if (srcFrom < 0) { ws += -srcFrom / speed; srcFrom = 0; }
            const srcTo = T.sourceTime(c, we);
            if (srcTo <= srcFrom) continue;
            const seg = await decodeRange(c.mediaId, srcFrom, srcTo, cache);
            if (!seg || !seg.channels.length) continue;
            if (Math.abs(speed - 1) > 1e-3) {
                seg.channels = seg.channels.map((ch) => A.timeStretch(ch, speed, seg.sampleRate));
            }
            const node = ctx.createBufferSource();
            node.buffer = toBuffer(ctx, seg);
            const gain = ctx.createGain();
            // The gain follows the model exactly, sampled finely enough for fades.
            const at0 = ws - o.from;
            gain.gain.setValueAtTime(T.clipGainAt(project, c, ws, duck, win), at0);
            for (let t = ws + GAIN_STEP; t < we; t += GAIN_STEP) {
                gain.gain.linearRampToValueAtTime(T.clipGainAt(project, c, t, duck, win), t - o.from);
            }
            node.connect(gain);
            gain.connect(ctx.destination);
            node.start(at0);
            scheduled += 1;
            if (o.onProgress) o.onProgress((k + 1) / clips.length * 0.7);
        }
        if (!scheduled) return null;
        const out = await ctx.startRendering();
        if (o.onProgress) o.onProgress(1);
        return out;
    }

    /** The mix as 16 kHz mono, for speech recognition. */
    async function renderMono16k(project, options) {
        const buf = await render(project, Object.assign({ sampleRate: 16000, channels: 1 }, options));
        return buf ? buf.getChannelData(0).slice() : null;
    }

    /* --------------------------------------------------------------- voice */

    const RNN_SOURCES = [
        'https://cdn.jsdelivr.net/npm/@shiguredo/rnnoise-wasm@2025.1.5/dist/rnnoise.js',
        'https://unpkg.com/@shiguredo/rnnoise-wasm@2025.1.5/dist/rnnoise.js'
    ];
    // RNNoise's output lags its input by two 10 ms frames.
    const RNN_DELAY = 960;
    let rnnP = null;

    function loadRnnoise() {
        if (window.__reelTestDenoiser) return Promise.resolve(window.__reelTestDenoiser);
        return rnnP || (rnnP = (async function () {
            let err;
            for (const u of RNN_SOURCES) {
                try { const m = await import(u); return await m.Rnnoise.load(); } catch (e) { err = e; }
            }
            rnnP = null;
            throw err || new Error('Could not load the noise remover');
        }()));
    }

    /** RNNoise over 48 kHz channels; `amount` 0–1 mixes it with the original. */
    async function denoise(channels, amount, onProgress) {
        const rn = await loadRnnoise();
        const N = rn.frameSize;
        const total = channels.length * channels[0].length;
        let done = 0;
        const out = [];
        for (const ch of channels) {
            const st = rn.createDenoiseState();
            const o = new Float32Array(ch.length);
            const frame = new Float32Array(N);
            try {
                for (let i = 0; i < ch.length + RNN_DELAY; i += N) {
                    for (let j = 0; j < N; j += 1) { const v = ch[i + j]; frame[j] = v === undefined ? 0 : v * 32768; }
                    st.processFrame(frame);
                    for (let j = 0; j < N; j += 1) {
                        const k = i + j - RNN_DELAY;
                        if (k >= 0 && k < ch.length) o[k] = ch[k] * (1 - amount) + (frame[j] / 32768) * amount;
                    }
                    if ((i / N) % 400 === 0) {
                        done = Math.min(total, done + 400 * N);
                        if (onProgress) onProgress(done / total);
                        await new Promise((r) => setTimeout(r, 0));
                    }
                }
            } finally {
                st.destroy();
            }
            out.push(o);
        }
        return out;
    }

    /**
     * Cleans one clip's sound and swaps it in: an audio clip is pointed at the
     * cleaned file; a video's sound is detached first, so the picture stays.
     */
    async function cleanVoice(clipId, amount, onProgress) {
        const p = app.state.project;
        const clip = T.getClip(p, clipId);
        if (!clip) throw new Error('That clip is gone.');
        const media = T.getMedia(p, clip.mediaId);
        const len = T.sourceLength(p, clip);
        const from = clip.in || 0;
        const to = Math.min(isFinite(len) ? len : Infinity, from + clip.duration * T.speedOf(clip));
        const seg = await decodeRange(clip.mediaId, from, to, new Map());
        if (!seg) throw new Error('No sound could be read from this clip.');
        const at48 = seg.sampleRate === RATE ? seg.channels : seg.channels.map((c) => A.resample(c, seg.sampleRate, RATE));
        const cleaned = await denoise(at48, amount, onProgress);
        const wav = A.encodeWav(cleaned, RATE);
        const base = (media ? media.name.replace(/\.[^.]+$/, '') : 'Clip');
        const file = new File([wav], base + ' (clean voice).wav', { type: 'audio/wav', lastModified: Date.now() });
        const ids = await app.importFiles([file], { fresh: true, origin: 'clean-voice', noCommit: true });
        if (!ids[0]) throw new Error('The cleaned sound could not be added.');
        let next = app.state.project;
        let target = clipId;
        if (T.clipKind(next, T.getClip(next, clipId)) === 'video') {
            const r = T.detachAudio(next, clipId);
            next = r.project;
            target = r.id;
        }
        next = T.updateClip(next, target, { mediaId: ids[0], in: 0 });
        app.apply(next);
        app.selectOnly(target);
    }

    function cleanVoiceDialog(clipId) {
        const amount = app.el('input', { type: 'range', min: 10, max: 100, step: 5, value: 100 });
        const out = app.el('output', { text: '100%' });
        amount.addEventListener('input', function () { out.textContent = amount.value + '%'; });
        app.openDialog({
            title: 'Clean up voice',
            intro: 'A small neural network trained on speech removes background noise — fans, traffic, room echo — and keeps the voice. The cleaned sound is added as a new file; the original is not changed. The noise remover (about 5 MB) downloads the first time.',
            body: [app.el('div', { className: 'field' }, [app.el('label', { text: 'Amount' }), amount, out]),
                app.el('p', { className: 'hint', text: 'On Qur’an recitation with long notes, try a lower amount if the voice sounds thin.' })],
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Clean up', primary: true,
                    run: async function (d) {
                        d.busy(true);
                        d.status('Loading the noise remover…');
                        try {
                            await cleanVoice(clipId, Number(amount.value) / 100, (f) => d.status('Removing noise… ' + Math.round(f * 100) + '%'));
                            app.toast('Voice cleaned. The original stays in the media bin.');
                        } catch (err) {
                            d.busy(false);
                            d.status(/import|fetch|load/i.test(err.message) ? 'Could not download the noise remover — check the internet connection.' : 'Failed: ' + err.message);
                            return false;
                        }
                    }
                }
            ]
        });
    }

    window.ReelMix = {
        render: render,
        renderMono16k: renderMono16k,
        decodeRange: decodeRange,
        cleanVoice: cleanVoice,
        cleanVoiceDialog: cleanVoiceDialog,
        canCleanVoice: function () { return !!window.OfflineAudioContext; }
    };
}());
