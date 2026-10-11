/*
 * Unit tests for clip effects: looks, crop, the effects merge, title styles
 * and loudness normalising.
 *
 *   node --test video-editor/test/effects.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');

const IMAGE = { id: 'mi', name: 'logo.png', type: 'image', width: 400, height: 400, size: 300 };

function withImage() {
    const p = T.createProject();
    p.media.push(IMAGE);
    return T.appendMedia(p, 'mi');
}

test('a clip without effects gets every default', () => {
    const fx = T.fxOf({});
    assert.deepEqual(fx, T.DEFAULT_FX);
    assert.notEqual(fx.crop, T.DEFAULT_FX.crop, 'a copy, not the shared default');
    assert.equal(T.hasFx({}), false);
});

test('effects patches merge one level deep and null clears', () => {
    let p = withImage();
    const id = p.clips[0].id;
    p = T.updateClip(p, id, { fx: { crop: { l: 0.2 } } });
    p = T.updateClip(p, id, { fx: { crop: { r: 0.1 }, hide: { shape: 'oval', x: 0.5, y: 0.5, w: 0.2, h: 0.2 } } });
    let fx = T.fxOf(T.getClip(p, id));
    assert.deepEqual(fx.crop, { l: 0.2, r: 0.1, t: 0, b: 0 });
    assert.equal(fx.hide.shape, 'oval');
    p = T.updateClip(p, id, { fx: { hide: { mode: 'pixelate' } } });
    fx = T.fxOf(T.getClip(p, id));
    assert.deepEqual([fx.hide.shape, fx.hide.mode], ['oval', 'pixelate'], 'hide keeps its other settings');
    p = T.updateClip(p, id, { fx: { hide: null } });
    assert.equal(T.fxOf(T.getClip(p, id)).hide, null);
    assert.equal(T.hasFx(T.getClip(p, id)), true, 'the crop is still there');
});

test('a look sets colour and atmosphere but keeps transform and frame', () => {
    let p = withImage();
    const id = p.clips[0].id;
    p = T.updateClip(p, id, { fx: { flipH: true, radius: 0.3 }, filters: { blur: 4 } });
    p = T.applyLook(p, id, 'vintage');
    let c = T.getClip(p, id);
    assert.equal(c.filters.sepia, 45);
    assert.equal(c.filters.blur, 0, 'colour settings come from the look');
    assert.deepEqual([c.fx.look, c.fx.vignette, c.fx.flipH, c.fx.radius], ['vintage', 0.45, true, 0.3]);
    p = T.applyLook(p, id, 'none');
    c = T.getClip(p, id);
    assert.deepEqual([c.fx.vignette, c.fx.grain, c.fx.tint], [0, 0, null]);
    assert.equal(T.filterString(c.filters), 'none');
    assert.equal(c.fx.flipH, true);
});

test('every look is a valid set of settings', () => {
    Object.keys(T.LOOKS).forEach(function (name) {
        let p = T.applyLook(withImage(), withImage().clips[0].id, name);
        assert.ok(p, name);
        const f = T.LOOKS[name].filters;
        Object.keys(f).forEach((k) => assert.ok(k in T.DEFAULT_FILTERS, name + ': ' + k));
    });
});

test('sepia and hue appear in the canvas filter', () => {
    assert.equal(T.filterString({ sepia: 30, hue: 20 }), 'sepia(30%) hue-rotate(20deg)');
});

test('crop keeps the middle and never collapses the picture', () => {
    assert.deepEqual(T.cropRect(200, 100, { l: 0.25, r: 0.25, t: 0.1, b: 0.1 }), { sx: 50, sy: 10, sw: 100, sh: 80 });
    const tiny = T.cropRect(100, 100, { l: 0.9, r: 0.9 });
    assert.ok(tiny.sw >= 5);
});

test('title styles only set title properties', () => {
    const clip = T.textClip('T1', 0, 'x');
    Object.keys(T.TITLE_STYLES).forEach(function (k) {
        Object.keys(T.TITLE_STYLES[k].patch).forEach((key) => assert.ok(key in clip, k + ': ' + key));
    });
});

test('normalising brings the peak to about −1 dB, within limits', () => {
    assert.equal(T.normalisedVolume(0.5), 1.78);
    assert.equal(T.normalisedVolume(0.1), 2, 'no more than 200%');
    assert.equal(T.normalisedVolume(0), 1);
    const peaks = Float32Array.from([0.1, 0.2, 0.9, 0.3, 0.1]);
    assert.ok(Math.abs(T.clipPeak({ in: 0, duration: 0.02, speed: 1 }, peaks, 100) - 0.2) < 1e-6, 'only the span the clip uses');
    assert.ok(Math.abs(T.clipPeak({ in: 0, duration: 0.05 }, peaks, 100) - 0.9) < 1e-6);
});
