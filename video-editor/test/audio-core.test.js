/*
 * Unit tests for Reel's audio helpers.
 *
 *   node --test video-editor/test/audio-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../audio-core.js');

function tone(freq, seconds, sr) {
    const n = Math.round(seconds * sr);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i += 1) x[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / sr);
    return x;
}

test('time-stretch changes the length but keeps the pitch', () => {
    const sr = 16000;
    const x = tone(200, 2, sr);                   // period 80 samples
    [1.5, 0.75, 2].forEach(function (speed) {
        const y = A.timeStretch(x, speed, sr);
        assert.equal(y.length, Math.floor(x.length / speed), 'length at ' + speed + '×');
        const mid = y.subarray(Math.floor(y.length / 3), Math.floor(y.length / 3) + 2000);
        assert.equal(A.dominantPeriod(mid, 40, 160), 80, 'still 200 Hz at ' + speed + '×');
        // Level is kept too: no big dips at the frame joins.
        let peak = 0;
        for (let i = 0; i < mid.length; i += 1) peak = Math.max(peak, Math.abs(mid[i]));
        assert.ok(peak > 0.4 && peak < 0.6, 'level ' + peak.toFixed(2));
    });
});

test('at 1× time-stretch is a copy', () => {
    const x = tone(440, 0.1, 8000);
    const y = A.timeStretch(x, 1, 8000);
    assert.deepEqual(Array.from(y), Array.from(x));
    assert.notEqual(y, x);
});

test('resample and mixDown', () => {
    const x = tone(100, 1, 48000);
    assert.equal(A.resample(x, 48000, 16000).length, 16000);
    const m = A.mixDown([Float32Array.of(1, 0), Float32Array.of(0, 1)]);
    assert.deepEqual(Array.from(m), [0.5, 0.5]);
});

test('peaks follow the level', () => {
    const sr = 1000;
    const x = new Float32Array(sr);
    x.fill(0.8, 500);                               // loud second half
    const p = A.peaks([x], sr, 10);
    assert.equal(p.length, 10);
    assert.ok(p[2] < 0.01 && Math.abs(p[7] - 0.8) < 1e-6);
});

test('WAV header and samples', () => {
    const wav = A.encodeWav([Float32Array.of(0, 1, -1)], 8000);
    const v = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
    assert.equal(v.getUint32(24, true), 8000);
    assert.equal(wav.length, 44 + 6);
    assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32768]);
});
