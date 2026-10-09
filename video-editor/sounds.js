/*
 * Reel: a music-free sound library.
 *
 * Nature sounds (rain, wind, waves, a stream, birds, crickets, a fire, a
 * fountain), short sound effects (whoosh, pop, click, typing, page turn…),
 * animal calls (doves, a lion, an elephant, a wolf, a camel, a cat…), water and air, and
 * chalk and pencil writing — also timed to a title's letters — all made on
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
        birds: 'Birds in the morning', crickets: 'Crickets at night', fire: 'Crackling fire',
        fountain: 'Fountain', bubbling: 'Bubbling water'
    };
    const EFFECTS = {
        whoosh: ['Whoosh', 0.9], riser: ['Riser', 2.2], pop: ['Pop', 0.25], click: ['Click', 0.1], ding: ['Ding', 1.4],
        success: ['Success', 1.2], typing: ['Typing', 2], page: ['Page turn', 0.8], heartbeat: ['Heartbeat', 3],
        shutter: ['Camera shutter', 0.4], drop: ['Water drop', 0.5], boom: ['Boom', 1.6], tick: ['Tick-tock', 4]
    };
    /** Animal calls, made from a buzzing voice shaped by mouth-like filters. */
    const ANIMALS = {
        dove: ['Doves cooing', 2.6], rooster: ['Rooster', 2.4], sheep: ['Sheep', 1.3], cow: ['Cow', 2.3], cat: ['Cat', 1.1],
        dog: ['Dog barking', 1.0], duck: ['Duck', 1.1], owl: ['Owl', 2.2], frog: ['Frogs', 2.0], horse: ['Horse', 1.6],
        bees: ['Bees buzzing', 4], seagull: ['Seagulls', 1.8],
        lion: ['Lion roaring', 3], tiger: ['Tiger growling', 2.4], elephant: ['Elephant trumpeting', 1.8], wolf: ['Wolf howling', 3.2],
        goat: ['Goat', 1.1], donkey: ['Donkey', 2.4], camel: ['Camel', 2.2], monkey: ['Monkeys', 2.2], bear: ['Bear growling', 2],
        crow: ['Crow', 1.3], hens: ['Hens clucking', 2.6], chicks: ['Chicks peeping', 2.2], eagle: ['Eagle', 1.5], parrot: ['Parrot', 1.2],
        turkey: ['Turkey', 1.8], snake: ['Snake hissing', 2.2], mouse: ['Mouse squeaking', 1.4], dolphin: ['Dolphin', 2.2], whale: ['Whale song', 4],
        mosquito: ['Mosquito', 2.5]
    };
    const WATER = {
        pour: ['Pouring water', 3], bubbles: ['Bubbles', 2.5], splash: ['Splash', 1.3], drips: ['Dripping tap', 4],
        gust: ['Gust of air', 2.2], blow: ['Blowing air', 1.6]
    };
    /** Chalk and writing; chalk, pencil and typing can also follow a title as it appears. */
    const CHALK = {
        chalk: ['Chalk writing on a board', 3], chalktap: ['Chalk tap', 0.4], eraser: ['Board eraser', 1.6], pencil: ['Pencil writing', 3]
    };
    const WRITING = { chalk: 'Chalk on a board', pencil: 'Pencil on paper', typing: 'Keyboard typing' };
    function info(kind) { return EFFECTS[kind] || ANIMALS[kind] || WATER[kind] || CHALK[kind] || null; }
    function label(kind) { return NATURE[kind] || (info(kind) || [kind])[0]; }

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
        const len = NATURE[kind] ? Math.max(1, seconds || 30) : (info(kind) || [0, 1])[1];
        const out = new Float32Array(Math.floor(len * RATE));
        const r = rng(kind.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
        const noise = () => r() * 2 - 1;
        const f1 = svf();
        const f2 = svf();
        const n = out.length;
        /*
         * A voice: a buzzing pulse at `pitch(u)` Hz (u = 0…1 through the call),
         * shaped by formant filters [[Hz, damping, gain]…] like a mouth, with
         * an amount of breath noise and an envelope.
         */
        const voice = function (at, dur, o) {
            const fs = o.formants(0).map(() => svf());
            let ph = 0;
            burst(out, at, dur, function (s, u) {
                const vib = o.vib ? 1 + o.vib[1] * Math.sin(2 * Math.PI * o.vib[0] * s) : 1;
                ph += o.pitch(u) * vib / RATE;
                ph -= Math.floor(ph);
                // A pure tone for very high calls (a buzz there would fold back as harsh noise).
                const src = (o.sine ? Math.sin(2 * Math.PI * ph) : 2 * ph - 1) * (1 - (o.noise || 0)) + noise() * (o.noise || 0);
                const form = o.formants(u);
                let y = 0;
                for (let k = 0; k < form.length; k += 1) y += fs[k](src, form[k][0], form[k][1]).band * form[k][2];
                return y * o.amp(u, s);
            });
        };
        const lerp = (a, b, u) => a + (b - a) * u;
        const rise = (u, a, r) => Math.min(1, u / a, (1 - u) / r);
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
        /* ----------------------------------------------------------- animals */
        case 'dove':
            [[0.05, 0.32, 0.6], [0.5, 0.62, 1], [1.25, 0.34, 0.65], [1.75, 0.5, 0.8]].forEach(function (c) {
                voice(c[0], c[1], { pitch: (u) => 255 + 45 * Math.sin(Math.PI * u), formants: () => [[380, 0.2, 1], [820, 0.3, 0.22]], noise: 0.06,
                    amp: (u) => c[2] * Math.pow(Math.sin(Math.PI * u), 1.4) });
            });
            return finish(out, 0.6);
        case 'rooster':
            [[0.05, 0.22, 520, 570], [0.32, 0.2, 640, 700], [0.58, 0.24, 610, 650], [0.9, 1.35, 840, 520]].forEach(function (c, i) {
                voice(c[0], c[1], { pitch: (u) => lerp(c[2], c[3], i === 3 ? Math.pow(u, 0.6) : u), vib: [28, 0.025], noise: 0.28,
                    formants: (u) => i === 3 ? [[lerp(750, 420, u), 0.18, 1], [lerp(1250, 850, u), 0.22, 0.6], [2700, 0.3, 0.25]] : [[750, 0.18, 1], [1300, 0.22, 0.6], [2700, 0.3, 0.25]],
                    amp: (u) => rise(u, 0.08, i === 3 ? 0.35 : 0.2) });
            });
            return finish(out, 0.75);
        case 'sheep':
            voice(0.05, 1.05, { pitch: (u) => lerp(310, 255, u), vib: [7, 0.07], noise: 0.12,
                formants: () => [[760, 0.15, 1], [1250, 0.16, 0.6], [2600, 0.22, 0.28]],
                amp: (u, t) => rise(u, 0.12, 0.3) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 15 * t)) });
            return finish(out, 0.7);
        case 'cow':
            voice(0.1, 2.0, { pitch: (u) => lerp(150, 112, u), vib: [4, 0.012], noise: 0.08,
                formants: (u) => { const m = Math.min(1, u * 2.2); return [[lerp(330, 640, m), 0.16, 1], [lerp(680, 1020, m), 0.2, 0.45], [2400, 0.3, 0.12]]; },
                amp: (u) => rise(u, 0.15, 0.3) });
            return finish(out, 0.75);
        case 'cat':
            voice(0.05, 0.95, { pitch: (u) => 470 + 300 * Math.sin(Math.PI * Math.min(1, u * 1.15)), vib: [6, 0.015], noise: 0.06,
                formants: (u) => { const a = Math.sin(Math.PI * u); return [[lerp(350, 850, a), 0.15, 1], [lerp(2200, 1350, a) - 400 * Math.max(0, u - 0.7), 0.18, 0.55], [3000, 0.25, 0.2]]; },
                amp: (u) => rise(u, 0.1, 0.35) });
            return finish(out, 0.7);
        case 'dog':
            [0.05, 0.42].forEach(function (at) {
                voice(at, 0.17, { pitch: (u) => lerp(430, 270, u), noise: 0.38, formants: () => [[560, 0.22, 1], [1450, 0.28, 0.6], [2600, 0.35, 0.3]],
                    amp: (u) => Math.min(1, u / 0.06) * Math.exp(-u * 3.2) });
                burst(out, at, 0.08, (t, u) => f1(noise(), 160, 0.6).low * (1 - u) * 1.4);
            });
            return finish(out, 0.8);
        case 'duck':
            [0.05, 0.36, 0.7].forEach(function (at, i) {
                voice(at, 0.2, { pitch: (u) => lerp(240 - i * 10, 195, u), noise: 0.16, formants: () => [[950, 0.1, 1], [2250, 0.12, 0.85], [3300, 0.18, 0.4]],
                    amp: (u) => Math.min(1, u / 0.05) * Math.exp(-u * 2.2) });
            });
            return finish(out, 0.75);
        case 'owl':
            [[0.05, 0.42, 1], [0.95, 0.18, 0.7], [1.22, 0.62, 0.9]].forEach(function (c) {
                voice(c[0], c[1], { pitch: (u) => lerp(375, 345, u), noise: 0.03, formants: () => [[340, 0.2, 1], [720, 0.3, 0.18]],
                    amp: (u) => c[2] * Math.pow(Math.sin(Math.PI * u), 1.5) });
            });
            return finish(out, 0.6);
        case 'frog':
            [0.08, 1.05].forEach(function (at) {
                voice(at, 0.6, { pitch: () => 118, noise: 0.22, formants: () => [[520, 0.2, 1], [1500, 0.28, 0.45]],
                    amp: (u, t) => Math.sin(Math.PI * u) * (Math.sin(2 * Math.PI * 17 * t) > 0 ? 1 : 0.08) });
            });
            return finish(out, 0.7);
        case 'horse':
            voice(0.05, 1.45, { pitch: (u) => lerp(980, 500, Math.pow(u, 0.7)), vib: [13, 0.07], noise: 0.32,
                formants: (u) => [[lerp(850, 600, u), 0.2, 1], [lerp(1700, 1200, u), 0.24, 0.6], [2900, 0.3, 0.3]], amp: (u) => rise(u, 0.06, 0.4) });
            return finish(out, 0.75);
        case 'bees':
            [192, 205, 221, 238].forEach(function (f0, k) {
                voice(0, len, { pitch: () => f0, vib: [3 + k, 0.03], noise: 0.05, formants: () => [[420, 0.3, 1], [1100, 0.35, 0.6], [2600, 0.45, 0.3]],
                    amp: (u, t) => rise(u, 0.12, 0.12) * (0.55 + 0.45 * Math.sin(2 * Math.PI * (0.23 + k * 0.07) * t + k)) });
            });
            return finish(out, 0.55);
        case 'seagull':
            [0.05, 0.62, 1.15].forEach(function (at, i) {
                voice(at, 0.46 - i * 0.04, { pitch: (u) => lerp(1550, 820, Math.pow(u, 0.8)), vib: [9, 0.04], noise: 0.14,
                    formants: () => [[1800, 0.18, 1], [3100, 0.25, 0.5]], amp: (u) => rise(u, 0.08, 0.3) });
            });
            return finish(out, 0.7);

        case 'lion':
            voice(0.05, 2.1, { pitch: (u) => u < 0.35 ? lerp(95, 165, u / 0.35) : lerp(165, 70, (u - 0.35) / 0.65), vib: [22, 0.03], noise: 0.55,
                formants: (u) => [[lerp(420, 560, Math.sin(Math.PI * u)), 0.25, 1], [900, 0.3, 0.6], [2000, 0.4, 0.25]], amp: (u) => rise(u, 0.15, 0.5) });
            burst(out, 0.05, 2.1, (t, u) => f1(noise(), 110, 0.5).low * rise(u, 0.15, 0.5) * 1.4);
            [2.25, 2.6].forEach((at) => voice(at, 0.28, { pitch: () => 85, noise: 0.6, formants: () => [[380, 0.3, 1], [800, 0.35, 0.5]], amp: (u) => Math.min(1, u / 0.1) * Math.exp(-u * 3) * 0.7 }));
            return finish(out, 0.85);
        case 'tiger':
            voice(0.05, 2.25, { pitch: (u) => u < 0.75 ? 72 : lerp(72, 130, (u - 0.75) / 0.25), noise: 0.5, formants: () => [[400, 0.3, 1], [820, 0.35, 0.5], [1900, 0.45, 0.2]],
                amp: (u, t) => rise(u, 0.2, 0.15) * (0.55 + 0.45 * Math.abs(Math.sin(2 * Math.PI * 12 * t))) * (0.6 + 0.4 * u) });
            return finish(out, 0.85);
        case 'elephant':
            voice(0.05, 1.6, { pitch: (u) => lerp(380, 520, Math.sin(Math.PI * Math.min(1, u * 1.3))), vib: [6, 0.05], noise: 0.18,
                formants: () => [[700, 0.12, 1], [1500, 0.14, 0.8], [2800, 0.18, 0.6]], amp: (u) => Math.min(1, u / 0.04) * Math.min(1, (1 - u) / 0.35) });
            return finish(out, 0.85);
        case 'wolf':
            voice(0.05, 3.05, { pitch: (u) => u < 0.4 ? lerp(340, 610, Math.pow(u / 0.4, 0.7)) : u < 0.75 ? lerp(610, 540, (u - 0.4) / 0.35) : lerp(540, 380, (u - 0.75) / 0.25),
                vib: [5, 0.015], noise: 0.05, formants: (u) => [[lerp(380, 520, Math.sin(Math.PI * u)), 0.2, 1], [900, 0.3, 0.3]], amp: (u) => rise(u, 0.12, 0.3) });
            return finish(out, 0.7);
        case 'goat':
            voice(0.05, 0.9, { pitch: (u) => lerp(430, 370, u), vib: [9, 0.08], noise: 0.14, formants: () => [[800, 0.15, 1], [1400, 0.16, 0.6], [2700, 0.22, 0.3]],
                amp: (u, t) => rise(u, 0.08, 0.3) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 22 * t)) });
            return finish(out, 0.7);
        case 'donkey':
            [0.05, 1.2].forEach(function (at) {
                voice(at, 0.38, { pitch: (u) => lerp(820, 950, u), noise: 0.45, formants: () => [[900, 0.2, 1], [2400, 0.25, 0.6]], amp: (u) => rise(u, 0.1, 0.2) });
                voice(at + 0.42, 0.55, { pitch: (u) => lerp(260, 220, u), vib: [11, 0.04], noise: 0.35, formants: () => [[650, 0.18, 1], [1100, 0.2, 0.6], [2500, 0.3, 0.3]], amp: (u) => rise(u, 0.06, 0.3) });
            });
            return finish(out, 0.8);
        case 'camel':
            voice(0.05, 2.0, { pitch: (u, t) => 88 + 18 * Math.sin(2 * Math.PI * 3 * u * 2), noise: 0.38, formants: (u) => [[lerp(300, 450, Math.sin(Math.PI * u)), 0.25, 1], [700, 0.3, 0.5]],
                amp: (u, t) => rise(u, 0.15, 0.25) * (0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 7 * t + Math.sin(t * 13)))) });
            return finish(out, 0.8);
        case 'monkey':
            [[0.05, 0.22, 480, 'oo'], [0.32, 0.22, 560, 'oo'], [0.62, 0.3, 760, 'aa'], [1.0, 0.32, 820, 'aa'], [1.45, 0.12, 900, 'aa'], [1.62, 0.12, 950, 'aa'], [1.8, 0.14, 900, 'aa']].forEach(function (c) {
                voice(c[0], c[1], { pitch: (u) => c[2] * (1 + 0.2 * Math.sin(Math.PI * u)), noise: 0.15,
                    formants: () => c[3] === 'oo' ? [[380, 0.2, 1], [850, 0.3, 0.3]] : [[850, 0.18, 1], [1300, 0.2, 0.6], [2700, 0.3, 0.25]], amp: (u) => Math.sin(Math.PI * u) });
            });
            return finish(out, 0.75);
        case 'bear':
            voice(0.05, 1.85, { pitch: (u) => lerp(62, 78, Math.sin(Math.PI * u)), noise: 0.6, formants: () => [[300, 0.3, 1], [620, 0.35, 0.5], [1500, 0.45, 0.2]],
                amp: (u, t) => rise(u, 0.25, 0.3) * (0.6 + 0.4 * Math.abs(Math.sin(2 * Math.PI * 9 * t))) });
            return finish(out, 0.85);
        case 'crow':
            [0.05, 0.45, 0.85].forEach(function (at) {
                voice(at, 0.3, { pitch: (u) => lerp(660, 540, u), noise: 0.45, formants: () => [[1100, 0.2, 1], [1800, 0.25, 0.6], [3000, 0.3, 0.25]], amp: (u) => rise(u, 0.08, 0.4) });
            });
            return finish(out, 0.8);
        case 'hens': {
            let t = 0.05;
            for (let k = 0; k < 7; k += 1) {
                voice(t, 0.09, { pitch: () => 340 + r() * 60, noise: 0.25, formants: () => [[700, 0.2, 1], [1500, 0.25, 0.5]], amp: (u) => Math.sin(Math.PI * u) * (0.6 + 0.3 * r()) });
                t += 0.16 + r() * 0.12;
            }
            voice(t + 0.05, 0.45, { pitch: (u) => lerp(560, 720, Math.sin(Math.PI * u)), noise: 0.25, formants: () => [[850, 0.18, 1], [1600, 0.22, 0.6], [2800, 0.3, 0.25]], amp: (u) => rise(u, 0.1, 0.3) });
            return finish(out, 0.75);
        }
        case 'chicks':
            for (let t = 0.05; t < len - 0.15; t += 0.08 + r() * 0.2) {
                const f0 = 2900 + r() * 700;
                voice(t, 0.08 + r() * 0.05, { sine: true, pitch: (u) => f0 * (1 + 0.15 * u), noise: 0.02, formants: () => [[f0 * 1.05, 0.3, 1]], amp: (u) => Math.sin(Math.PI * u) * (0.5 + 0.5 * r()) });
            }
            return finish(out, 0.6);
        case 'eagle':
            voice(0.05, 0.35, { pitch: (u) => lerp(2300, 2100, u), noise: 0.2, formants: () => [[2500, 0.2, 1], [3800, 0.3, 0.4]], amp: (u) => rise(u, 0.1, 0.3) });
            voice(0.45, 0.95, { pitch: (u) => lerp(2200, 1650, u), vib: [26, 0.06], noise: 0.2, formants: () => [[2400, 0.2, 1], [3700, 0.3, 0.4]], amp: (u) => rise(u, 0.06, 0.45) });
            return finish(out, 0.7);
        case 'parrot':
            [0.05, 0.6].forEach(function (at, i) {
                voice(at, 0.4, { pitch: (u) => i ? lerp(1300, 750, u) : 900 + 400 * Math.sin(Math.PI * u), noise: 0.5, formants: () => [[1400, 0.15, 1], [2600, 0.2, 0.6]], amp: (u) => rise(u, 0.05, 0.3) });
            });
            return finish(out, 0.8);
        case 'turkey':
            [0.05, 0.95].forEach(function (at) {
                voice(at, 0.7, { pitch: (u) => lerp(520, 460, u), noise: 0.2, formants: (u) => [[lerp(600, 900, (Math.sin(2 * Math.PI * 9 * u) + 1) / 2), 0.2, 1], [1600, 0.25, 0.5]],
                    amp: (u, t) => rise(u, 0.05, 0.2) * (Math.sin(2 * Math.PI * 24 * t) > -0.2 ? 1 : 0.15) });
            });
            return finish(out, 0.75);
        case 'snake':
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                out[i] = f1(noise(), 5800, 0.5).band * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.8);
            }
            return finish(out, 0.6);
        case 'mouse':
            [0.05, 0.16, 0.27, 0.75, 0.86].forEach(function (at) {
                voice(at, 0.07, { sine: true, pitch: (u) => lerp(4100, 4600, Math.sin(Math.PI * u)), noise: 0.03, formants: () => [[4300, 0.3, 1]], amp: (u) => Math.sin(Math.PI * u) });
            });
            return finish(out, 0.6);
        case 'dolphin': {
            for (let t = 0.05, gap = 0.06; t < 0.9; t += gap, gap = Math.max(0.012, gap * 0.88)) burst(out, t, 0.004, (s, u) => noise() * (1 - u)); // clicks speeding up
            voice(1.0, 0.9, { sine: true, pitch: (u) => 4200 + 2400 * Math.sin(Math.PI * u * 1.5), noise: 0.02, formants: (u) => [[4200 + 2400 * Math.sin(Math.PI * u * 1.5), 0.25, 1]], amp: (u) => rise(u, 0.1, 0.25) });
            return finish(out, 0.6);
        }
        case 'whale':
            [[0, 1], [0.25, 0.35], [0.5, 0.15]].forEach(function (e) { // the sea echoes it
                voice(0.1 + e[0], 3.4, { pitch: (u) => u < 0.4 ? lerp(140, 300, u / 0.4) : lerp(300, 110, (u - 0.4) / 0.6), vib: [2, 0.02], noise: 0.04,
                    formants: () => [[350, 0.25, 1], [700, 0.35, 0.25]], amp: (u) => e[1] * rise(u, 0.2, 0.35) });
            });
            return finish(out, 0.65);
        case 'mosquito':
            voice(0, len, { pitch: (u, t) => 560 * (1 + 0.04 * Math.sin(2 * Math.PI * 0.7 * u * len)), noise: 0.02, formants: () => [[1100, 0.3, 1], [2200, 0.35, 0.6], [3300, 0.4, 0.3]],
                amp: (u) => rise(u, 0.1, 0.15) * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * u), 2)) });
            return finish(out, 0.5);

        /* ------------------------------------------------------ water and air */
        case 'fountain':
        case 'bubbling': {
            const fountain = kind === 'fountain';
            for (let i = 0; i < n; i += 1) out[i] = f1(noise(), fountain ? 3200 : 900, 0.6).band * (fountain ? 0.3 : 0.08);
            for (let t = 0; t < len; t += (fountain ? 0.01 : 0.04) + r() * (fountain ? 0.03 : 0.12)) {
                const f0 = (fountain ? 900 : 300) + r() * (fountain ? 1800 : 700);
                const amp = 0.08 + r() * (fountain ? 0.18 : 0.35);
                let ph = 0;
                burst(out, t, 0.02 + r() * 0.04, (s, u) => { ph += 2 * Math.PI * f0 * (1 + u * 1.2) / RATE; return Math.sin(ph) * amp * Math.sin(Math.PI * u); });
            }
            return finish(out, 0.55);
        }
        case 'pour':
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                out[i] = f1(noise(), 700 + 1500 * u, 0.35).band * rise(u, 0.05, 0.08) * 0.8;
            }
            for (let t = 0.05; t < len - 0.1; t += 0.015 + r() * 0.04) {
                const f0 = 350 + 900 * (t / len) + r() * 300;
                let ph = 0;
                burst(out, t, 0.025, (s, u) => { ph += 2 * Math.PI * f0 * (1 + u) / RATE; return Math.sin(ph) * 0.25 * Math.sin(Math.PI * u); });
            }
            return finish(out, 0.7);
        case 'bubbles':
            for (let t = 0.03; t < len - 0.1; t += 0.05 + r() * 0.16) {
                const f0 = 380 + r() * 900;
                const d = 0.03 + r() * 0.05;
                let ph = 0;
                burst(out, t, d, (s, u) => { ph += 2 * Math.PI * f0 * (1 + 1.6 * u * u) / RATE; return Math.sin(ph) * Math.sin(Math.PI * u) * (0.4 + r() * 0.1); });
            }
            return finish(out, 0.7);
        case 'splash':
            burst(out, 0.02, 0.6, (s, u) => f1(noise(), 2400, 0.5).band * Math.min(1, u / 0.02) * Math.exp(-u * 5) * 1.2);
            burst(out, 0.02, 0.25, (s, u) => f2(noise(), 220, 0.6).low * Math.exp(-u * 6) * 1.5);
            for (let t = 0.25; t < 1.2; t += 0.02 + r() * 0.08) {
                const f0 = 600 + r() * 1600;
                let ph = 0;
                burst(out, t, 0.03, (s, u) => { ph += 2 * Math.PI * f0 * (1 + u) / RATE; return Math.sin(ph) * 0.2 * (1.3 - t) * Math.sin(Math.PI * u); });
            }
            return finish(out, 0.8);
        case 'drips':
            for (let t = 0.1, k = 0; t < len - 0.3; t += 0.62 + r() * 0.12, k += 1) {
                for (const [delay, gain] of [[0, 1], [0.07, 0.25], [0.15, 0.1]]) { // a little room echo
                    let ph = 0;
                    const f0 = 900 + (k % 3) * 80;
                    burst(out, t + delay, 0.12, (s, u) => { ph += 2 * Math.PI * (380 + f0 * (1 - u) * (1 - u)) / RATE; return Math.sin(ph) * gain * Math.sin(Math.PI * Math.min(1, u * 4)) * Math.exp(-u * 5); });
                }
            }
            return finish(out, 0.7);
        case 'gust':
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                const swell = Math.pow(Math.sin(Math.PI * u), 1.6);
                out[i] = f1(noise(), 220 + 1100 * swell, 0.3).band * swell;
            }
            return finish(out, 0.75);
        case 'blow':
            for (let i = 0; i < n; i += 1) {
                const u = i / n;
                out[i] = (f1(noise(), 900, 0.6).band * 0.7 + f2(noise(), 2600, 0.7).band * 0.3) * rise(u, 0.15, 0.4);
            }
            return finish(out, 0.65);

        /* ------------------------------------------------------- chalk etc. */
        case 'chalk':
        case 'pencil': {
            for (let t = 0.05; t < len - 0.1; t += 0.03 + r() * 0.1) {
                const d = 0.08 + r() * 0.22;
                stroke(out, t, Math.min(d, len - t - 0.02), kind, r, noise);
                t += d;
            }
            return finish(out, kind === 'chalk' ? 0.75 : 0.55);
        }
        case 'chalktap':
            [0.02, 0.17].forEach((at) => burst(out, at, 0.04, (s, u) => (f1(noise(), 1800, 0.5).band * 0.8 + tone(950, s) * 0.3) * Math.exp(-u * 9)));
            return finish(out, 0.8);
        case 'eraser':
            for (let k = 0; k < 4; k += 1) {
                const fl = svf();
                burst(out, 0.05 + k * 0.38, 0.34, (s, u) => fl(noise(), 500 + 700 * Math.sin(Math.PI * u), 0.5).band * Math.sin(Math.PI * u) * (0.8 + 0.2 * r()));
            }
            return finish(out, 0.65);
        default:
            return out;
        }
    }

    /** One stroke of chalk (scratchy, sometimes squeaking) or pencil (softer, higher) added into `out`. */
    function stroke(out, at, dur, kind, r, noise) {
        const chalk = kind === 'chalk';
        const band = svf();
        const tap = svf();
        const squeak = chalk && r() < 0.18 ? 2400 + r() * 900 : 0;
        let grain = 1;
        let ph = 0;
        burst(out, at, dur, function (s, u) {
            if (Math.floor(s * 900) !== Math.floor((s - 1 / RATE) * 900)) grain = 0.35 + r() * 0.65; // rough surface
            const env = Math.min(1, u / 0.12, (1 - u) / 0.2);
            let y = band(noise(), chalk ? 3200 : 5200, chalk ? 0.45 : 0.6).band * grain * env;
            if (squeak) { ph += 2 * Math.PI * squeak * (1 + 0.01 * Math.sin(s * 70)) / RATE; y += Math.sin(ph) * 0.12 * env; }
            if (u < 0.08) y += tap(noise(), 1300, 0.6).band * (1 - u / 0.08) * (chalk ? 1.2 : 0.5);
            return y;
        });
    }

    /**
     * A writing sound timed to a title: one chalk or pencil stroke, or one key
     * press, at each moment in `times` (seconds), `seconds` long overall.
     */
    function writingSound(kind, seconds, times) {
        const len = Math.max(0.3, seconds || 2);
        const out = new Float32Array(Math.floor(len * RATE));
        const r = rng(97 + times.length);
        const noise = () => r() * 2 - 1;
        times.forEach(function (t, i) {
            if (t >= len - 0.02) return;
            const gap = (times[i + 1] !== undefined ? times[i + 1] : t + 0.25) - t;
            if (kind === 'typing') {
                const f = 1700 + r() * 1500;
                burst(out, t, 0.028, (s, u) => (noise() * 0.7 + tone(f, s) * 0.3) * Math.exp(-u * 8));
            } else {
                stroke(out, t, Math.max(0.035, Math.min(0.2, gap * 0.85)), kind, r, noise);
            }
        });
        return finish(out, kind === 'pencil' ? 0.55 : 0.75);
    }

    /* ------------------------------------------------------------- the dialog */

    if (typeof window === 'undefined' || !window.ReelApp) return { synth, writingSound, NATURE, EFFECTS, ANIMALS, WATER, CHALK, WRITING, RATE };
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

    /** Imports samples as a WAV and puts them on a free audio track at `at` (adding a track if none is free). */
    async function placeSound(data, name, at, look) {
        const wav = window.ReelAudio.encodeWav([data], RATE);
        const ids = await app.importFiles([new File([wav], name, { type: 'audio/wav', lastModified: Date.now() })], { noCommit: true, fresh: true });
        if (!ids.length) throw new Error('The sound could not be added.');
        let p = app.state.project;
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
        const clip = Object.assign(T.clipFromMedia(media, track.id, at), look);
        app.apply(T.addClip(p, clip));
        return clip;
    }

    /** Makes a library sound and puts it at the playhead. */
    async function addSound(kind, seconds) {
        const data = synth(kind, seconds);
        const name = label(kind) + (NATURE[kind] ? ' (' + Math.round(data.length / RATE) + ' s)' : '') + '.wav';
        const at = Math.round(app.state.time * 1000) / 1000;
        const clip = await placeSound(data, name, at, { volume: NATURE[kind] ? 0.5 : 0.9, fadeIn: NATURE[kind] ? 1 : 0, fadeOut: NATURE[kind] ? 1.5 : 0 });
        app.selectOnly(clip.id);
        app.toast(label(kind) + ' added at the playhead.');
    }

    /**
     * Adds a chalk, pencil or keyboard sound under a typed, word-by-word or
     * handwritten title: one stroke or key press as each letter appears.
     */
    async function addWritingSound(clipId, kind) {
        const clip = T.getClip(app.state.project, clipId);
        if (!clip || clip.type !== 'text') return;
        const reveal = ['typewriter', 'words', 'handwrite'].indexOf(clip.anim) !== -1;
        const c = reveal ? clip : Object.assign({}, clip, { anim: 'typewriter' });
        const times = T.revealTimes(c);
        if (!times.length) { app.toast('Type some words in the title first.'); return; }
        const span = T.revealSpan(c);
        const data = writingSound(kind, span + 0.3, times);
        const words = String(clip.text).trim().split(/\s+/).slice(0, 4).join(' ');
        // One writing sound per title: a new one replaces the last.
        let p = app.state.project;
        const old = p.clips.filter((c) => c.writingFor === clipId).map((c) => c.id);
        if (old.length) { app.state.project = T.deleteClips(p, old, false); }
        const placed = await placeSound(data, WRITING[kind] + ' — ' + words + '.wav', clip.start, { volume: 0.8, writingFor: clipId });
        app.selectOnly(clipId);
        app.toast(WRITING[kind] + ' added under the title, in time with its letters' + (reveal ? '. Change its volume or remove it under Writing sound.' : ' — set the entrance to Typewriter, Word by word or Handwriting to see it written.'));
        return placed;
    }

    function openSounds() {
        app.pause();
        const length = el('select', { 'aria-label': 'Length of nature sounds' }, [['15', '15 seconds'], ['30', '30 seconds'], ['60', '1 minute'], ['120', '2 minutes']]
            .map((o) => el('option', { value: o[0], text: o[1] })));
        length.value = '30';
        let dialog = null;
        const row = function (kind, label) {
            return el('div', { className: 'sound-row', 'data-name': (label + ' ' + kind + ' ' + (window.ReelI18n ? window.ReelI18n.tr(label) : '')).toLowerCase() }, [
                el('span', { text: label }),
                el('button', { type: 'button', className: 'ghost', text: '▶ Listen', 'aria-label': 'Listen to ' + label, onclick: function () { preview(kind, Number(length.value)); } }),
                el('button', {
                    type: 'button', text: 'Add', 'aria-label': 'Add ' + label, onclick: async function () {
                        try { await addSound(kind, Number(length.value)); dialog.close(); } catch (err) { dialog.status(err.message); }
                    }
                })
            ]);
        };
        const section = (cat, title, rows, extra) => el('div', { className: 'sound-section', 'data-cat': cat }, [el('h3', { text: title })].concat(extra || [], [el('div', { className: 'sound-grid' }, rows)]));
        const sections = [
            section('nature', 'Nature & calm', Object.keys(NATURE).filter((k) => k !== 'fountain' && k !== 'bubbling').map((k) => row(k, NATURE[k])), [app.dialogField('Length', length)]),
            section('effects', 'Sound effects', Object.keys(EFFECTS).map((k) => row(k, EFFECTS[k][0]))),
            section('animals', 'Animals', Object.keys(ANIMALS).map((k) => row(k, ANIMALS[k][0]))),
            section('water', 'Water & air', ['fountain', 'bubbling'].map((k) => row(k, NATURE[k])).concat(Object.keys(WATER).map((k) => row(k, WATER[k][0])))),
            section('chalk', 'Chalk & writing', Object.keys(CHALK).map((k) => row(k, CHALK[k][0])),
                [el('p', { className: 'hint', text: 'To hear chalk or keys in time with a title as it is written or typed, select the title and use Writing sound in its details.' })])
        ];
        const search = el('input', { type: 'search', placeholder: 'Search sounds — lion, rain, chalk…', 'aria-label': 'Search sounds' });
        let cat = 'all';
        const show = function () {
            const q = search.value.trim().toLowerCase();
            sections.forEach(function (sec) {
                let any = false;
                sec.querySelectorAll('.sound-row').forEach(function (r) {
                    const hit = !q || r.dataset.name.indexOf(q) !== -1;
                    r.hidden = !hit;
                    any = any || hit;
                });
                sec.hidden = !(any && (cat === 'all' || sec.dataset.cat === cat || q));
            });
        };
        const chips = el('div', { className: 'sound-chips', role: 'group', 'aria-label': 'Kinds of sound' });
        [['all', 'All'], ['nature', 'Nature'], ['effects', 'Effects'], ['animals', 'Animals'], ['water', 'Water & air'], ['chalk', 'Chalk & writing']].forEach(function (c, k) {
            chips.append(el('button', { type: 'button', text: c[1], 'aria-pressed': String(!k), onclick: function (e) {
                cat = c[0];
                chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
                show();
            } }));
        });
        search.addEventListener('input', show);
        dialog = app.openDialog({
            title: 'Sound library',
            wide: true,
            intro: 'Nature sounds, sound effects, animals, water and chalk — no music and no instruments, made on your device and free to use in any video.',
            body: [search, chips].concat(sections, [
                el('p', { className: 'hint', text: 'For a nasheed, record your own voice with Record voice, or import one you are allowed to use.' })
            ]),
            onClose: function () { if (playing) { try { playing.stop(); } catch (err) { /* done */ } } }
        });
    }

    const bar = document.querySelector('.studio-bar');
    if (bar) bar.append(el('button', { type: 'button', id: 'studio-sounds', text: 'Sounds', onclick: openSounds }));
    app.addTool({ section: 'Create', label: 'Sound library (no music)…', run: openSounds });

    return { synth, writingSound, NATURE, EFFECTS, ANIMALS, WATER, CHALK, WRITING, RATE, openSounds, addSound, addWritingSound };
}));
