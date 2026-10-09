/*
 * Unit tests for occasion scene sets, auto-reframe paths and read-aloud text
 * handling (sentences, Amharic romanisation, joining the spoken parts).
 *
 *   node --test video-editor/test/occasions.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');
const O = require('../occasions.js');
const S = require('../speak.js');

test('every occasion has a greeting and five scenes that exist', () => {
    const keys = Object.keys(O.OCCASIONS);
    ['ramadan', 'eid-fitr', 'eid-adha', 'jumuah', 'hajj', 'qadr', 'nature'].forEach((k) => assert.ok(keys.includes(k), k));
    keys.forEach(function (k) {
        const o = O.OCCASIONS[k];
        assert.ok(o.title && o.arabic && o.end, k);
        assert.equal(o.scenes.length, 5, k);
        o.scenes.forEach((s) => assert.equal(typeof O.SCENES[s], 'function', s));
    });
});

test('scenes paint onto any 2D context without throwing', () => {
    // A stand-in context that accepts every call.
    const g = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {})),
        set: (t, k, v) => { t[k] = v; return true; }
    });
    Object.keys(O.SCENES).forEach((name) => assert.doesNotThrow(() => O.SCENES[name](g, 1280, 720), name));
});

test('reframeKeys follows the face, holding still inside the dead zone', () => {
    // A 16:9 video in a 9:16 frame: the picture is 3.16 frames wide.
    const samples = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2].map((t, i) => ({ t: t, fx: i < 4 ? 0.5 : 0.75 }));
    const keys = T.reframeKeys(samples, 1920, 1080, 1080, 1920);
    assert.equal(keys[0].t, 0);
    assert.equal(keys[0].x, 0.5, 'a face in the middle needs no move');
    const last = keys[keys.length - 1];
    assert.ok(last.x < 0.5, 'a face on the right moves the picture left');
    // The face lands in the middle: 0.5 + (0.5 − 0.75) × width.
    assert.ok(Math.abs(last.x - (0.5 - 0.25 * (1920 * (1920 / 1080) / 1080))) < 1e-3, String(last.x));
    assert.ok(keys.some((k) => k.x === 0.5 && k.t > 0), 'holds until it glides');
    // Never past the edge of the picture.
    const edge = T.reframeKeys([{ t: 0, fx: 0 }, { t: 1, fx: 1 }], 1920, 1080, 1080, 1920);
    const room = (1920 * (1920 / 1080) / 1080 - 1) / 2;
    edge.forEach((k) => assert.ok(Math.abs(k.x - 0.5) <= room + 1e-6));
    // Small wobbles inside the dead zone do not move the camera.
    const still = T.reframeKeys([0.5, 0.52, 0.49, 0.51].map((fx, i) => ({ t: i * 0.4, fx: fx })), 1920, 1080, 1080, 1920);
    assert.equal(still.length, 1);
    assert.deepEqual(T.reframeKeys([{ t: 0, fx: null }], 1920, 1080, 1080, 1920), [], 'no face, no path');
    assert.deepEqual(T.reframeKeys(samples, 1080, 1920, 1080, 1920), [], 'nothing to follow when it already fits');
});

test('applyReframe puts the path on the clip and fills the frame', () => {
    let p = T.createProject({ width: 1080, height: 1920 });
    p = T.addMedia(p, { id: 'v1', name: 'talk.mp4', type: 'video', duration: 5, width: 1920, height: 1080 });
    const track = p.tracks.find((t) => t.kind === 'video').id;
    p = T.addClip(p, T.clipFromMedia(T.getMedia(p, 'v1'), track, 0));
    const id = p.clips[0].id;
    const q = T.applyReframe(p, id, [{ t: 0, x: 0.5 }, { t: 2, x: 0.2 }, { t: 9, x: 0.1 }]);
    const c = T.getClip(q, id);
    assert.equal(c.fit, 'cover');
    assert.deepEqual(c.keys, [{ t: 0, x: 0.5 }, { t: 2, x: 0.2 }], 'keys past the end are dropped');
    assert.ok(Math.abs(T.keyframeAt(c, 1).x - 0.35) < 1e-9, 'eased half way');
    assert.equal(T.applyReframe(p, id, []), p);
});

test('read aloud splits sentences and romanises Amharic', () => {
    assert.deepEqual(S.sentences('Assalamu alaykum. How are you?\nAlhamdulillah!'), ['Assalamu alaykum.', 'How are you?', 'Alhamdulillah!']);
    assert.deepEqual(S.sentences('ሰላም ነው። እንዴት ናችሁ።'), ['ሰላም ነው።', 'እንዴት ናችሁ።']);
    const long = S.sentences('word '.repeat(80), 100);
    assert.ok(long.length > 1 && long.every((x) => x.length <= 101));
    assert.equal(S.romanizeEthiopic('ሰላም'), 'selam');
    assert.equal(S.romanizeEthiopic('ሰላም ነው።'), 'selam new.');
    assert.equal(S.romanizeEthiopic('አማርኛ'), 'amarnya');
    assert.equal(S.prepare('eng', 'Hello'), 'Hello');
    assert.equal(S.prepare('amh', 'ሰላም'), 'selam');
    assert.deepEqual(S.models('orm'), ['Xenova/mms-tts-orm', 'onnx-community/mms-tts-orm']);
    assert.ok(S.VOICES.some((v) => v[0] === 'orm') && S.VOICES.some((v) => v[0] === 'som') && S.VOICES.some((v) => v[0] === 'amh'));
});

test('joinParts lays the sentences end to end with a pause, and says where each is', () => {
    const r = S.joinParts([new Float32Array(100), new Float32Array(50).fill(0.5)], 100, 0.3);
    assert.equal(r.audio.length, 180);
    assert.deepEqual(r.spans, [{ start: 0, end: 1 }, { start: 1.3, end: 1.8 }]);
    assert.equal(r.audio[130], 0.5);
});
