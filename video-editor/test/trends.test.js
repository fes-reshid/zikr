'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../trends.js');

test('ten trending templates, each with three lines and a painted background', function () {
    assert.strictEqual(R.TEMPLATES.length, 10);
    assert.strictEqual(new Set(R.TEMPLATES.map((t) => t.id)).size, 10);
    R.TEMPLATES.forEach(function (t) {
        assert.strictEqual(t.lines.length, 3, t.id);
        assert.ok(['ink', 'paper', 'spotlight', 'neon', 'split', 'film', 'sunny', 'pastel'].indexOf(t.bg) !== -1, t.id + ' background');
        assert.ok(t.photos >= 0 && t.photos <= 6, t.id + ' photo slots');
    });
});

test('a text design resets the look it replaces, and gets smaller on tall frames', function () {
    const neon = R.designPatch('neon-pink', false);
    assert.strictEqual(neon.glow, '#ff3fd2');
    const box = R.designPatch('highlight', false);
    assert.strictEqual(box.glow, null, 'no glow left behind');
    assert.strictEqual(box.box, true);
    assert.strictEqual(box.outline.width, 0, 'no outline left behind');
    assert.ok(R.designPatch('hook', true).fontSize < R.designPatch('hook', false).fontSize);
    assert.strictEqual(R.designPatch('unknown', false).fontSize, R.designPatch('caption', false).fontSize, 'unknown designs fall back to the bold caption');
    assert.ok(Object.keys(R.DESIGNS).length >= 12);
});
