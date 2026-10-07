/*
 * Reel: a music-free sound library.
 *
 * Nature sounds (rain, wind, waves, a stream, birds, crickets, a fire) and
 * short sound effects (whoosh, pop, click, typing, page turn…), all made on
 * this device from noise and simple tones — no music, no instruments, no
 * downloads. Each is turned into a WAV file and put on an audio track at the
 * playhead. `synth` is plain JavaScript, so it is tested under Node too.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelSounds = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const RATE = 44100;
    const NATURE = {
        rain: 'Rain', wind: 'Gentle wind', waves: 'Ocean waves', stream: 'Flowing stream',
        birds: 'Birds in the morning', crickets: 'Crickets at night', fire: 'Crackling fire'
    };
    const EFFECTS = {
        whoosh: ['Whoosh', 0.9], riser: ['Riser', 2.2], pop: ['Pop', 0.25], click: ['Click', 0.1], ding: ['Ding', 1.4],
        success: ['Success', 1.2], typing: ['Typing', 2], page: ['Page turn', 0.8], heartbeat: ['Heartbeat', 3],
        shutter: ['Camera shutter', 0.4], drop: ['Water drop', 0.5], boom: ['Boom', 1.6], tick: ['Tick-tock', 4]
    };

    /** A small, seeded random generator, so a sound is the same every time. */
    function rng(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** A state-variable filter: call with a sample, cutoff (Hz) and resonance; returns low, band and high. */
    function svf() {
        let low = 0;
        let band = 0;
        return function (x, cutoff, q) {
            const f = 2 * Math.sin(Math.PI * Math.min(cutoff, RATE / 6) / RATE);
            low += f * band;
            const high = x - low - (q || 0.7) * band;
            band += f * high;
            return { low: low, band: band, high: high };
        };
    }

    /** A short decaying burst of noise or tone added into `out` at `at` seconds. */
    function burst(out, at, length, fn) {
        const i0 = Math.floor(at * RATE);
        const n = Math.floor(length * RATE);
        for (let i = 0; i < n && i0 + i < out.length; i += 1) out[i0 + i] += fn(i / RATE, i / n);
    }

    function tone(freq, t) {
        return Math.sin(2 * Math.PI * freq * t);
    }

    /** Scales a sound so its loudest point is at `peak`, and softens its very start and end. */
    function finish(out, peak) {
        let max = 0;
        for (let i = 0; i < out.length; i += 1) if (Math.abs(out[i]) > max) max = Math.abs(out[i]);
        const k = max > 0 ? peak / max : 0;
        // Long sounds ease in over 10 ms; short effects keep their attack.
        const edge = Math.min(Math.floor((out.length > 3 * RATE ? 0.01 : 0.001) * RATE), Math.floor(out.length / 4));
        for (let i = 0; i < out.length; i += 1) {
            let g = k;
            if (i < edge) g *= i / edge;
            if (i > out.length - edge) g *= (out.length - i) / edge;
            out[i] *= g;
        }
        return out;
    }

    /**
     * The samples of a sound: mono floats at 44.1 kHz. Nature sounds take a
     * length in seconds; effects have their own.
     */
    function synth(kind, seconds) {
        const len = NATURE[kind] ? Math.max(1, seconds || 30) : (EFFECTS[kind] || [0, 1])[1];
        const out = new Float32Array(Math.floor(len * RATE));
        const r = rng(kind.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
        const noise = () => r() * 2 - 1;
        const f1 = svf();
        const f2 = svf();
        const n = out.length;
        switch (kind) {
        case 'rain': {
            for (let i = 0; i < n; i += 1) out[i] = f1(noise(), 2600, 0.9).low * 0.35 + f2(noise(), 7000, 0.6).band * 0.15;
            for (let t = 0; t < len; t += r() * 0.03) {
                const amp = 0.2 + r() * 0.5;
                const f = 1500 + r() * 4000;
                burst(out, t, 0.012, (s, u) => noise() * amp * Math.exp(-u * 6) + tone(f, s) * amp * 0.2 * (1 - u));
            }
            return finish(out, 0.6);
        }
        case 'wind': {
            for (let i = 0; i < n; i += 1) {
                const t = i / RATE;
                const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.11 * t) * Math.sin(2 * Math.PI * 0.037 * t + 1);
                out[i] = f1(noise(), 250 + 650 * lfo, 0.25).band * (0.35 + 0.65 * lfo);
            }
            return finish(out, 0.55);
        }
        case 'waves': {
            for (let i = 0; i < n; i += 1) {
                const t = i / RATE;
                const swell = Math.pow(Math.sin(Math.PI * ((t / 7.5) % 1)), 2);
                out[i] = f1(noise(), 400 + 1600 * swell, 0.8).low * (0.15 + 0.85 * swell);
            }
            return finish(out, 0.6);
        }
        case 'stream': {
            for (let i = 0; i < n; i += 1) out[i] = f1(noise(), 2200, 0.5).band * (0.6 + 0.4 * Math.sin(i / RATE * 9));
            for (let t = 0; t < len; t += 0.02 + r() * 0.08) {
                const f0 = 400 + r() * 900;
                const amp = 0.15 + r() * 0.25;
                burst(out, t, 0.04 + r() * 0.05, (s, u) => tone(f0 * (1 + u * 0.8), s) * amp * Math.sin(Math.PI * u));
            }
            return finish(out, 0.55);
        }
        case 'birds': {
            for (let i = 0; i < n; i += 1) out[i] = f1(noise(), 900, 0.5).band * 0.03;
            for (let t = 0.3; t < len; t += 0.6 + r() * 2.2) {
                const notes = 2 + Math.floor(r() * 4);
                const base = 2500 + r() * 2000;
                for (let k = 0; k < notes; k += 1) {
                    const at = t + k * (0.09 + r() * 0.05);
                    const d = 0.05 + r() * 0.08;
                    const up = r() > 0.5 ? 1 : -1;
                    let ph = 0;
                    burst(out, at, d, (s, u) => {
                        ph += 2 * Math.PI * base * (1 + up * 0.35 * u) / RATE;
                        return Math.sin(ph) * Math.sin(Math.PI * u) * 0.6;
                    });
                }
            }
            return finish(out, 0.5);
        }
        case 'crickets': {
            for (let t = 0.1; t < len; t += 0.55 + r() * 0.25) {
                const f = 4300 + r() * 400;
                burst(out, t, 0.18, (s, u) => tone(f, s) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 32 * s)) * Math.sin(Math.PI * u) * 0.5);
            }
            for (let i = 0; i < n; i += 1) out[i] += f1(noise(), 300, 0.5).band * 0.02;
            return finish(out, 0.45);
        }
        case 'fire': {
            for (let i = 0; i < n; i += 1) out[i] = f1(noise(), 180, 0.7).low * 0.6;
            for (let t = 0; t < len; t += r() * 0.12) {
                const amp = 0.2 + r() * 0.8;
                burst(out, t, 0.006 + r() * 0.01, (s, u) => noise() * amp * (1 - u));
            }
            return finish(out, 0.6);
        }
        case 'whoosh':
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                const env = Math.sin(Math.PI * u);
                out[i] = f1(noise(), 300 + 2700 * Math.sin(Math.PI * u), 0.4).band * env * env;
            }
            return finish(out, 0.8);
        case 'riser':
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                out[i] = f1(noise(), 200 + 5000 * u * u, 0.5).band * u * 0.7 + tone(150 + 650 * u * u, i / RATE) * u * 0.3;
            }
            return finish(out, 0.8);
        case 'pop': {
            let ph = 0;
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                ph += 2 * Math.PI * (650 - 480 * Math.min(1, u * 3)) / RATE;
                out[i] = Math.sin(ph) * Math.exp(-u * 9);
            }
            return finish(out, 0.85);
        }
        case 'click':
            burst(out, 0, 0.005, (s, u) => noise() * (1 - u));
            burst(out, 0, 0.03, (s, u) => tone(2200, s) * Math.exp(-u * 12) * 0.5);
            return finish(out, 0.8);
        case 'ding':
            for (let i = 0; i < n; i += 1) {
                const t = i / RATE;
                out[i] = (tone(1320, t) + 0.4 * tone(2640, t) + 0.2 * tone(3960, t)) * Math.exp(-t * 3);
            }
            return finish(out, 0.7);
        case 'success':
            burst(out, 0, 0.6, (s) => (tone(880, s) + 0.3 * tone(1760, s)) * Math.exp(-s * 6));
            burst(out, 0.18, 1, (s) => (tone(1320, s) + 0.3 * tone(2640, s)) * Math.exp(-s * 4));
            return finish(out, 0.7);
        case 'typing':
            for (let t = 0.05; t < len - 0.05; t += 0.06 + r() * 0.14) {
                const f = 1800 + r() * 1500;
                burst(out, t, 0.025, (s, u) => (noise() * 0.7 + tone(f, s) * 0.3) * Math.exp(-u * 8));
            }
            return finish(out, 0.75);
        case 'page':
            for (const at of [0, 0.32]) {
                const fl = svf();
                burst(out, at, 0.38, (s, u) => fl(noise(), 1800 + 2500 * u, 0.6).band * Math.sin(Math.PI * u));
            }
            return finish(out, 0.7);
        case 'heartbeat':
            for (let beat = 0; beat < 3; beat += 1) {
                for (const [off, amp] of [[0, 1], [0.24, 0.7]]) {
                    burst(out, 0.1 + beat * 0.95 + off, 0.2, (s, u) => tone(55 + 20 * (1 - u), s) * amp * Math.exp(-u * 6));
                }
            }
            return finish(out, 0.9);
        case 'shutter':
            for (const at of [0, 0.09]) burst(out, at, 0.04, (s, u) => (noise() * 0.6 + tone(3000, s) * 0.4) * Math.exp(-u * 7));
            return finish(out, 0.8);
        case 'drop': {
            let ph = 0;
            burst(out, 0.02, 0.2, (s, u) => {
                ph += 2 * Math.PI * (400 + 900 * (1 - u) * (1 - u)) / RATE;
                return Math.sin(ph) * Math.sin(Math.PI * Math.min(1, u * 4)) * Math.exp(-u * 4);
            });
            return finish(out, 0.75);
        }
        case 'boom':
            for (let i = 0; i < n; i += 1) {
                const t = i / RATE;
                out[i] = tone(52 - 12 * Math.min(1, t), t) * Math.exp(-t * 2.5) + f1(noise(), 220, 0.6).low * Math.exp(-t * 5) * 0.8;
            }
            return finish(out, 0.95);
        case 'tick':
            for (let k = 0; k * 0.5 < len - 0.1; k += 1) {
                const f = k % 2 ? 1500 : 2100;
                burst(out, 0.05 + k * 0.5, 0.03, (s, u) => (tone(f, s) * 0.6 + noise() * 0.4) * Math.exp(-u * 9));
            }
            return finish(out, 0.7);
        default:
            return out;
        }
    }

    /* ------------------------------------------------------------- the dialog */

    if (typeof window === 'undefined' || !window.ReelApp) return { synth, NATURE, EFFECTS, RATE };
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    let ctx = null;
    let playing = null;

    function preview(kind, seconds) {
        try {
            if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (playing) { try { playing.stop(); } catch (err) { /* already stopped */ } }
            const data = synth(kind, Math.min(seconds || 6, 6));
            const buf = ctx.createBuffer(1, data.length, RATE);
            buf.copyToChannel(data, 0);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start();
            playing = src;
        } catch (err) { app.toast('This browser could not play the preview.'); }
    }

    /** Makes the sound, imports it and puts it on an audio track at the playhead (adding a track if none is free). */
    async function addSound(kind, seconds) {
        const label = NATURE[kind] || EFFECTS[kind][0];
        const data = synth(kind, seconds);
        const wav = window.ReelAudio.encodeWav([data], RATE);
        const name = label + (NATURE[kind] ? ' (' + Math.round(data.length / RATE) + ' s)' : '') + '.wav';
        const ids = await app.importFiles([new File([wav], name, { type: 'audio/wav', lastModified: Date.now() })], { noCommit: true, fresh: true });
        if (!ids.length) throw new Error('The sound could not be added.');
        let p = app.state.project;
        const at = Math.round(app.state.time * 1000) / 1000;
        const media = T.getMedia(p, ids[0]);
        const len = media.duration || data.length / RATE;
        let track = p.tracks.filter((t) => t.kind === 'audio').find(function (t) {
            const s = T.findFreeStart(p, t.id, at, len, null);
            return s !== null && Math.abs(s - at) < 1e-6;
        });
        if (!track) {
            const id = T.nextTrackId(p, 'audio');
            p = T.addTrack(p, 'audio', 'Sounds');
            track = T.getTrack(p, id);
        }
        const clip = Object.assign(T.clipFromMedia(media, track.id, at), { volume: NATURE[kind] ? 0.5 : 0.9, fadeIn: NATURE[kind] ? 1 : 0, fadeOut: NATURE[kind] ? 1.5 : 0 });
        app.apply(T.addClip(p, clip));
        app.selectOnly(clip.id);
        app.toast(label + ' added at the playhead.');
    }

    function openSounds() {
        app.pause();
        const length = el('select', { 'aria-label': 'Length of nature sounds' }, [['15', '15 seconds'], ['30', '30 seconds'], ['60', '1 minute'], ['120', '2 minutes']]
            .map((o) => el('option', { value: o[0], text: o[1] })));
        length.value = '30';
        let dialog = null;
        const row = function (kind, label) {
            return el('div', { className: 'sound-row' }, [
                el('span', { text: label }),
                el('button', { type: 'button', className: 'ghost', text: '▶ Listen', 'aria-label': 'Listen to ' + label, onclick: function () { preview(kind, Number(length.value)); } }),
                el('button', {
                    type: 'button', text: 'Add', 'aria-label': 'Add ' + label, onclick: async function () {
                        try { await addSound(kind, Number(length.value)); dialog.close(); } catch (err) { dialog.status(err.message); }
                    }
                })
            ]);
        };
        dialog = app.openDialog({
            title: 'Sound library',
            wide: true,
            intro: 'Nature sounds and sound effects with no music and no instruments — made on your device, free to use in any video.',
            body: [
                el('h3', { text: 'Nature & calm' }), app.dialogField('Length', length),
                el('div', { className: 'sound-grid' }, Object.keys(NATURE).map((k) => row(k, NATURE[k]))),
                el('h3', { text: 'Sound effects' }),
                el('div', { className: 'sound-grid' }, Object.keys(EFFECTS).map((k) => row(k, EFFECTS[k][0]))),
                el('p', { className: 'hint', text: 'For a nasheed, record your own voice with Record voice, or import one you are allowed to use.' })
            ],
            onClose: function () { if (playing) { try { playing.stop(); } catch (err) { /* done */ } } }
        });
    }

    const bar = document.querySelector('.studio-bar');
    if (bar) bar.append(el('button', { type: 'button', id: 'studio-sounds', text: 'Sounds', onclick: openSounds }));
    app.addTool({ section: 'Create', label: 'Sound library (no music)…', run: openSounds });

    return { synth, NATURE, EFFECTS, RATE, openSounds, addSound };
}));
