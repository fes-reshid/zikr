/*
 * Unit tests for drawings and the writing hand: drawing clips, drawing on
 * stroke by stroke, shapes, and which clips show a hand.
 *
 *   node --test video-editor/test/draw.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');
const Hands = require('../hands.js');

const line = (pts) => ({ color: '#fff', width: 6, points: pts });

test('a drawing lives on a titles track and needs no media', () => {
    let p = T.createProject();
    const clip = T.drawClip('T1', 2, [line([0.1, 0.1, 0.5, 0.1])]);
    assert.equal(T.clipKind(p, clip), 'text');
    assert.equal(T.isGenerated(clip), true);
    assert.equal(T.isTimed(p, clip), false);
    p = T.addClip(p, clip);
    assert.equal(p.clips.length, 1);
    assert.deepEqual([p.clips[0].anim, p.clips[0].hand], ['draw', 'pencil']);
    // It survives saving and opening, and splitting keeps both halves.
    const back = T.deserialize(T.serialize(p));
    assert.equal(back.clips[0].strokes.length, 1);
    assert.equal(T.splitClip(p, clip.id, 4).clips.length, 2);
});

test('a drawing is drawn at an even speed, stroke after stroke', () => {
    const strokes = [line([0, 0, 0.5, 0]), line([0, 0.5, 0.5, 0.5])];
    const half = T.revealStrokes(strokes, 0.5, 1);
    assert.equal(half.strokes.length, 1);
    assert.deepEqual(half.tip, { x: 0.5, y: 0 });
    const quarter = T.revealStrokes(strokes, 0.25, 1);
    assert.ok(Math.abs(quarter.tip.x - 0.25) < 1e-9);
    assert.deepEqual(quarter.strokes[0].points, [0, 0, 0.25, 0]);
    const threeQ = T.revealStrokes(strokes, 0.75, 1);
    assert.equal(threeQ.strokes.length, 2);
    assert.ok(Math.abs(threeQ.tip.x - 0.25) < 1e-9 && threeQ.tip.y === 0.5);
    const all = T.revealStrokes(strokes, 1, 1);
    assert.equal(all.done, true);
    assert.equal(all.strokes, strokes);
});

test('the frame’s shape sets how long a stroke is', () => {
    // On a wide frame a horizontal line is longer than a vertical one of the same share.
    const [across, down] = T.strokeLengths([line([0, 0, 0.5, 0]), line([0, 0, 0, 0.5])], 16 / 9);
    assert.ok(across > down * 1.7);
});

test('drawing time and the hand leaving', () => {
    const clip = Object.assign(T.drawClip('T1', 10, []), { duration: 6, animDuration: 3 });
    assert.equal(T.drawAnimAt(clip, 11.5).reveal, 0.5);
    assert.equal(T.drawAnimAt(clip, 13).exit, 0);
    assert.ok(T.drawAnimAt(clip, 13.3).exit > 0);
    assert.equal(T.drawAnimAt(clip, 14).exit, 1);
    // It never takes longer than the clip.
    assert.equal(T.drawAnimAt(Object.assign({}, clip, { animDuration: 30 }), 15.7).reveal, 1);
    assert.equal(T.drawAnimAt(Object.assign({}, clip, { anim: 'none' }), 10).reveal, 1);
});

test('only revealing entrances show a hand', () => {
    const title = T.textClip('T1', 0, 'Bismillah');
    assert.equal(T.handOf(title), null, 'titles have no hand by default');
    assert.equal(T.handOf(Object.assign({}, title, { hand: 'pen', anim: 'fade' })), null);
    assert.deepEqual(T.handOf(Object.assign({}, title, { hand: 'pen', anim: 'handwrite' })),
        { tool: 'pen', style: 'emoji', skin: 'yellow', size: 1, pen: null }, 'like the ✍️ emoji by default');
    const own = T.handOf(Object.assign({}, title, { hand: 'pencil', anim: 'handwrite', handStyle: 'sketch', penColor: '#c62828', handSkin: 'dark', handSize: 1.5 }));
    assert.deepEqual(own, { tool: 'pencil', style: 'sketch', skin: 'dark', size: 1.5, pen: '#c62828' });
    assert.equal(T.handOf(Object.assign({}, title, { hand: 'pen', anim: 'handwrite', penColor: 'red' })).pen, null, 'only real colours');
    assert.equal(T.handOf(Object.assign({}, title, { hand: 'finger', anim: 'typewriter', handSkin: 'dark' })).skin, 'dark');
    const drawing = T.drawClip('T1', 0, []);
    assert.equal(T.handOf(drawing).tool, 'pencil');
    assert.equal(T.handOf(Object.assign({}, drawing, { anim: 'fade' })), null);
    assert.equal(T.handOf(Object.assign({}, drawing, { hand: 'none' })), null);
});

test('handwriting reveals a title across most of its length', () => {
    const title = Object.assign(T.textClip('T1', 0, 'Bismillah'), { anim: 'handwrite', duration: 4 });
    const a = T.textAnimAt(title, 1.5);
    assert.equal(a.unit, 'width');
    assert.equal(a.reveal, 0.5);
    assert.equal(a.exit, 0);
    assert.equal(T.textAnimAt(title, 3.7).exit, 1);
});

test('shapes become strokes', () => {
    const [box] = T.shapeStrokes('rect', 0.1, 0.2, 0.3, 0.4);
    assert.equal(box.length, 10);
    assert.deepEqual(box.slice(0, 2), box.slice(-2), 'a box closes');
    const arrow = T.shapeStrokes('arrow', 0.1, 0.5, 0.6, 0.5, 1);
    assert.equal(arrow.length, 3, 'a line and two sides of the head');
    arrow.slice(1).forEach((w) => assert.ok(w[2] < 0.6, 'the head points back along the line'));
    const [oval] = T.shapeStrokes('oval', 0, 0, 1, 1);
    assert.deepEqual(oval.slice(0, 2), [0.5, 0], 'an oval starts at the top');
});

test('freehand points are thinned and rounded', () => {
    const raw = [0.1, 0.1, 0.10001, 0.10001, 0.1004, 0.1, 0.2, 0.2, 0.3000004, 0.3];
    assert.deepEqual(T.simplifyPoints(raw), [0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
});

test('the hand module knows its tools, styles and skins', () => {
    assert.deepEqual(Object.keys(Hands.TOOLS), T.HAND_TOOLS);
    assert.deepEqual(Object.keys(Hands.STYLES), ['emoji', 'sketch']);
    assert.ok(Hands.SKINS.yellow, 'the emoji yellow');
    assert.ok(Object.keys(Hands.SKINS).length >= 5);
    assert.ok(Hands.SKINS.outline, 'a black-and-white line-art hand');
});

test('the pencil takes the ink colour unless it is too pale to see', () => {
    assert.equal(Hands.pale('#ffffff'), true);
    assert.equal(Hands.pale('#f3ead3'), true);
    assert.equal(Hands.pale('#e5484d'), false);
    assert.equal(Hands.pale('#111111'), false);
    assert.equal(Hands.pale(undefined), true);
});
