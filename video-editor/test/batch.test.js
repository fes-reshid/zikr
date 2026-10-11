/*
 * Unit tests for keyframes, excerpts (for Shorts), opening a gap (for
 * intros), and the generated sound library.
 *
 *   node --test video-editor/test/batch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');
const Sounds = require('../sounds.js');

function withTitle(start, duration) {
    let p = T.createProject();
    p = T.addClip(p, Object.assign(T.textClip('T1', start || 0, 'Hello'), { duration: duration || 4 }));
    return p;
}

test('keyframes ease between values and hold at the ends', () => {
    let p = withTitle(2, 4);
    const id = p.clips[0].id;
    p = T.setKeyframe(p, id, 0, { x: 0.2, rotate: 0 });
    p = T.setKeyframe(p, id, 2, { x: 0.8, rotate: 90, opacity: 0.5 });
    const c = T.getClip(p, id);
    assert.equal(c.keys.length, 2);
    assert.deepEqual(T.keyframeAt(c, 2), { x: 0.2, y: 0.5, scale: 1, rotate: 0, opacity: 1 });
    const mid = T.keyframeAt(c, 3);
    assert.ok(Math.abs(mid.x - 0.5) < 1e-9 && Math.abs(mid.rotate - 45) < 1e-9);
    assert.equal(T.keyframeAt(c, 5.5).x, 0.8, 'held after the last');
    assert.equal(T.keyframeAt(c, 0).x, 0.2, 'held before the first');
    assert.equal(T.keyframeAt(T.textClip('T1', 0, 'x'), 1), null, 'no keyframes, no change');
});

test('setting a keyframe twice at one moment changes it', () => {
    let p = withTitle(0, 4);
    const id = p.clips[0].id;
    p = T.setKeyframe(p, id, 1, { x: 0.3 });
    p = T.setKeyframe(p, id, 1.001, { y: 0.7 });
    const keys = T.getClip(p, id).keys;
    assert.equal(keys.length, 1);
    assert.deepEqual([keys[0].x, keys[0].y], [0.3, 0.7]);
    p = T.removeKeyframe(p, id, 0);
    assert.equal(T.getClip(p, id).keys, undefined);
});

test('moving a keyframed clip moves its whole path; trimming keeps keyframes in time', () => {
    let p = withTitle(0, 4);
    const id = p.clips[0].id;
    p = T.setKeyframe(p, id, 0, { x: 0.2 });
    p = T.setKeyframe(p, id, 3, { x: 0.6 });
    p = T.updateClip(p, id, { x: 0.6 });
    assert.deepEqual(T.getClip(p, id).keys.map((k) => k.x), [0.3, 0.7]);
    p = T.trimClip(p, id, 'start', 1);
    assert.deepEqual(T.getClip(p, id).keys.map((k) => k.t), [-1, 2]);
});

test('splitting a keyframed clip keeps the movement smooth', () => {
    let p = withTitle(0, 4);
    const id = p.clips[0].id;
    p = T.setKeyframe(p, id, 0, { x: 0 });
    p = T.setKeyframe(p, id, 4, { x: 1 });
    p = T.splitClip(p, id, 2);
    const [a, b] = p.clips;
    assert.ok(Math.abs(T.keyframeAt(a, 1.999).x - T.keyframeAt(b, 2.001).x) < 0.01);
    assert.equal(b.keys[0].t, 0);
});

test('an excerpt is trimmed to its range and starts at zero', () => {
    let p = T.createProject();
    p.media.push({ id: 'm', type: 'video', duration: 100, width: 1920, height: 1080, name: 'talk.mp4' });
    p = T.addClip(p, Object.assign(T.clipFromMedia(p.media[0], 'V1', 0), { duration: 100 }));
    p = T.addClip(p, Object.assign(T.textClip('T1', 30, 'Point'), { duration: 20 }));
    p = T.addClip(p, Object.assign(T.textClip('T1', 80, 'Later'), { duration: 5 }));
    p = T.addMarker(p, 45, 'Middle').project;
    const e = T.excerpt(p, 40, 70);
    assert.equal(T.projectDuration(e), 30);
    const video = e.clips.find((c) => c.type === 'media');
    assert.deepEqual([video.start, video.duration, video.in], [0, 30, 40]);
    const titles = e.clips.filter((c) => c.type === 'text');
    assert.equal(titles.length, 1, 'only what overlaps the range');
    assert.deepEqual([titles[0].start, titles[0].duration], [0, 10]);
    assert.deepEqual(e.markers.map((m) => m.time), [5]);
});

test('a gap moves everything after it later', () => {
    let p = withTitle(0, 2);
    p = T.addMarker(p, 1, 'M').project;
    p = T.insertTime(p, 0, 3);
    assert.equal(p.clips[0].start, 3);
    assert.equal(p.markers[0].time, 4);
});

test('every library sound is made, sensible and the same each time', () => {
    Object.keys(Sounds.NATURE).concat(Object.keys(Sounds.EFFECTS)).forEach(function (kind) {
        const a = Sounds.synth(kind, 2);
        assert.ok(a.length > Sounds.RATE * 0.05, kind + ' has length');
        let peak = 0;
        for (const v of a) { assert.ok(Number.isFinite(v), kind + ' is finite'); peak = Math.max(peak, Math.abs(v)); }
        assert.ok(peak > 0.3 && peak <= 1, kind + ' is audible and does not clip: ' + peak);
        const b = Sounds.synth(kind, 2);
        assert.equal(a[1000], b[1000], kind + ' is deterministic');
    });
    assert.equal(Sounds.synth('rain', 10).length, 10 * Sounds.RATE, 'nature sounds take the length asked for');
});

test('animal, water, air and chalk sounds are made on the device, finite and at a safe level', function () {
    const kinds = Object.keys(Sounds.ANIMALS).concat(Object.keys(Sounds.WATER), Object.keys(Sounds.CHALK), ['fountain', 'bubbling']);
    assert.ok(Object.keys(Sounds.ANIMALS).length >= 30, 'thirty animals, from doves to a lion');
    ['lion', 'elephant', 'wolf', 'camel', 'cat', 'sheep'].forEach((k) => assert.ok(Sounds.ANIMALS[k], k));
    kinds.forEach(function (k) {
        const d = Sounds.synth(k, 4);
        let peak = 0;
        for (let i = 0; i < d.length; i += 1) { assert.ok(Number.isFinite(d[i]), k + ' has finite samples'); peak = Math.max(peak, Math.abs(d[i])); }
        assert.ok(peak > 0.3 && peak <= 0.95, k + ' peak ' + peak);
    });
});

test('a writing sound strikes a key or a chalk stroke at each letter, and is quiet in between', function () {
    const times = [0.2, 0.7, 1.2];
    const level = (d, from, to) => { let m = 0; for (let i = Math.floor(from * Sounds.RATE); i < Math.floor(to * Sounds.RATE); i += 1) m = Math.max(m, Math.abs(d[i])); return m; };
    ['typing', 'chalk', 'pencil'].forEach(function (kind) {
        const d = Sounds.writingSound(kind, 1.6, times);
        assert.equal(d.length, Math.floor(1.6 * Sounds.RATE));
        times.forEach((t) => assert.ok(level(d, t, t + 0.03) > 0.2, kind + ' sounds at ' + t));
        assert.ok(level(d, 0, 0.18) < 0.01, kind + ' is silent before the first letter');
        if (kind === 'typing') assert.ok(level(d, 0.35, 0.65) < 0.01, 'and between key presses');
    });
});
