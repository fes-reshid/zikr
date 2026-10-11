/*
 * Reel's audio helpers: pure functions on Float32Array channels, no DOM and
 * no Web Audio, so they run in the browser (window.ReelAudio) and under
 * `node --test`.
 *
 * - timeStretch: plays audio faster or slower without changing its pitch
 *   (WSOLA), so a clip at 1.5× sounds the same in the exported file as it
 *   did in the preview, where the browser preserves pitch.
 * - peaks: loudness at a fixed rate, for waveforms and ducking.
 * - resample, encodeWav: for speech recognition and handing audio over.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelAudio = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Changes the length of `input` by 1/`speed` while keeping its pitch.
     *
     * Waveform-similarity overlap-add: the output is built from overlapping
     * Hann-windowed frames. Each next frame is read around where the speed
     * says it should come from, shifted within ±`seek` samples to where it
     * best lines up with the natural continuation of the previous frame, so
     * the joins stay in phase instead of warbling.
     */
    function timeStretch(input, speed, sampleRate) {
        if (!(speed > 0) || Math.abs(speed - 1) < 1e-3) return input.slice();
        const sr = sampleRate || 48000;
        const frame = Math.max(64, Math.round(sr * 0.04));   // 40 ms
        const hop = frame >> 1;                                // 50% overlap
        const seek = Math.round(sr * 0.012);                   // ±12 ms search
        const outLen = Math.max(1, Math.floor(input.length / speed));
        const out = new Float32Array(outLen + frame);
        const norm = new Float32Array(outLen + frame);
        const win = new Float32Array(frame);
        for (let i = 0; i < frame; i += 1) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / frame);

        let prevRead = 0;
        for (let outPos = 0; outPos < outLen; outPos += hop) {
            const ideal = Math.round(outPos * speed);
            let best = ideal;
            if (outPos > 0) {
                // What would naturally follow the previous frame in the source.
                const natural = prevRead + hop;
                let bestScore = -Infinity;
                const lo = Math.max(0, ideal - seek);
                const hi = Math.min(input.length - frame, ideal + seek);
                for (let cand = lo; cand <= hi; cand += 2) {
                    let score = 0;
                    for (let k = 0; k < hop; k += 4) {
                        const a = input[natural + k];
                        const b = input[cand + k];
                        if (a === undefined || b === undefined) break;
                        score += a * b;
                    }
                    if (score > bestScore) { bestScore = score; best = cand; }
                }
            }
            best = Math.max(0, Math.min(best, Math.max(0, input.length - 1)));
            for (let i = 0; i < frame; i += 1) {
                const v = input[best + i];
                if (v === undefined) break;
                out[outPos + i] += v * win[i];
                norm[outPos + i] += win[i];
            }
            prevRead = best;
        }
        const result = new Float32Array(outLen);
        for (let i = 0; i < outLen; i += 1) result[i] = norm[i] > 1e-3 ? out[i] / norm[i] : out[i];
        return result;
    }

    /** Linear resampling; good enough for speech recognition and previews. */
    function resample(input, fromRate, toRate) {
        if (fromRate === toRate) return input.slice();
        const ratio = fromRate / toRate;
        const n = Math.floor(input.length / ratio);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i += 1) {
            const x = i * ratio;
            const j = Math.floor(x);
            const a = input[j] || 0;
            const b = input[j + 1] === undefined ? a : input[j + 1];
            out[i] = a + (b - a) * (x - j);
        }
        return out;
    }

    /** Averages channels into one. */
    function mixDown(channels) {
        if (channels.length === 1) return channels[0].slice();
        const n = channels[0].length;
        const out = new Float32Array(n);
        channels.forEach(function (c) { for (let i = 0; i < n; i += 1) out[i] += c[i] / channels.length; });
        return out;
    }

    /** Peak level per 1/`rate` s across all channels, 0–1. */
    function peaks(channels, sampleRate, rate) {
        const r = rate || 100;
        const n = channels[0].length;
        const count = Math.ceil(n / sampleRate * r);
        const out = new Float32Array(count);
        const per = sampleRate / r;
        const stride = Math.max(1, Math.floor(per / 64));
        channels.forEach(function (samples) {
            for (let i = 0; i < count; i += 1) {
                const end = Math.min(n, Math.floor((i + 1) * per));
                let m = out[i];
                for (let s = Math.floor(i * per); s < end; s += stride) {
                    const v = Math.abs(samples[s]);
                    if (v > m) m = v;
                }
                out[i] = m;
            }
        });
        return out;
    }

    /** 16-bit PCM WAV bytes from channels of floats. */
    function encodeWav(channels, sampleRate) {
        const ch = channels.length;
        const n = channels[0].length;
        const dataSize = n * ch * 2;
        const buf = new ArrayBuffer(44 + dataSize);
        const v = new DataView(buf);
        const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
        str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
        v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true);
        v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, dataSize, true);
        let o = 44;
        for (let i = 0; i < n; i += 1) {
            for (let c = 0; c < ch; c += 1) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
                o += 2;
            }
        }
        return new Uint8Array(buf);
    }

    /** The dominant period of a signal in samples (autocorrelation), for tests and tuning. */
    function dominantPeriod(x, minLag, maxLag) {
        let best = minLag;
        let bestScore = -Infinity;
        for (let lag = minLag; lag <= maxLag; lag += 1) {
            let s = 0;
            for (let i = 0; i + lag < x.length; i += 1) s += x[i] * x[i + lag];
            if (s > bestScore) { bestScore = s; best = lag; }
        }
        return best;
    }

    return { timeStretch, resample, mixDown, peaks, encodeWav, dominantPeriod };
}));
