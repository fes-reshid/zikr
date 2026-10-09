/*
 * Unit tests for entrance and exit movements: titles, pictures and the rest.
 *
 *   node --test video-editor/test/moves.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');

test('every movement starts hidden or moved and ends exactly in place', () => {
    T.MOVES.forEach(function (type) {
        assert.ok(T.isStill(T.moveAt(type, 1)), type + ' ends in place');
        const start = T.moveAt(type, 0);
        assert.ok(!T.isStill(start), type + ' starts away from its place');
    });
});

test('the original title entrances keep their look', () => {
    assert.equal(T.moveAt('fade', 0.5).alpha, 0.5);
    assert.ok(Math.abs(T.moveAt('rise', 0).dy - 0.05) < 1e-9);
    assert.ok(Math.abs(T.moveAt('slide', 0).dx + 0.08) < 1e-9);
    assert.ok(Math.abs(T.moveAt('pop', 0).scale - 0.6) < 1e-9);
});

test('new movements turn, flip, blur and zoom', () => {
    assert.ok(T.moveAt('spin', 0.1).rotate < -2);
    assert.ok(T.moveAt('flip', 0.1).scaleX < 0.4);
    assert.ok(T.moveAt('blur', 0.1).blur > 10);
    assert.ok(T.moveAt('zoom-in', 0.1).scale < 0.6);
    assert.ok(T.moveAt('zoom-out', 0.1).scale > 1.3);
    assert.ok(T.moveAt('drop', 0.05).dy < -0.1, 'drops from above');
});

test('a picture enters and leaves, and is still in between', () => {
    const clip = { start: 10, duration: 5, enter: 'zoom-in', enterDuration: 1, exit: 'fade', exitDuration: 0.5 };
    assert.ok(T.clipMoveAt(clip, 10.2).scale < 0.8);
    assert.ok(T.isStill(T.clipMoveAt(clip, 12)));
    assert.ok(Math.abs(T.clipMoveAt(clip, 14.75).alpha - 0.5) < 1e-9);
    assert.ok(T.isStill(T.clipMoveAt({ start: 0, duration: 3 }, 1)), 'no movement unless chosen');
});

test('a title’s exit combines with its entrance', () => {
    const title = Object.assign(T.textClip('T1', 0, 'Hi'), { duration: 1, anim: 'fade', animDuration: 1, exit: 'fade', exitDuration: 1 });
    const mid = T.textAnimAt(title, 0.5);
    assert.ok(Math.abs(mid.alpha - 0.25) < 1e-9, 'half in and half out');
    const reveal = Object.assign(T.textClip('T1', 0, 'Hi'), { anim: 'typewriter', exit: 'slide' });
    assert.equal(T.textAnimAt(reveal, 0.5).unit, 'chars', 'reveals still work with an exit');
});
