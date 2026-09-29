/*
 * Unit tests for the timeline's editing features beyond cut-and-trim:
 * speed, freeze frames, detached audio, transitions, motion, title
 * animations, ducking, markers, multi-clip editing and subtitles.
 *
 *   node --test video-editor/test/timeline-features.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');

const VIDEO = { id: 'mv', name: 'clip.webm', type: 'video', duration: 10, width: 1920, height: 1080, size: 1000 };
const AUDIO = { id: 'ma', name: 'music.mp3', type: 'audio', duration: 30, size: 2000 };
const IMAGE = { id: 'mi', name: 'logo.png', type: 'image', width: 400, height: 400, size: 300 };

function project() {
    const p = T.createProject();
    p.media.push(VIDEO, AUDIO, IMAGE);
    return p;
}
const clipsOn = (p, track) => T.trackClips(p, track).map((c) => [c.start, c.duration]);
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6);

/* ------------------------------------------------------------------ speed */

test('doubling the speed halves the length and plays the same source', () => {
    let p = T.appendMedia(project(), 'mv');
    const id = p.clips[0].id;
    p = T.setSpeed(p, id, 2);
    const c = T.getClip(p, id);
    assert.equal(c.duration, 5);
    assert.equal(T.sourceTime(c, 2.5), 5);
    assert.equal(T.sourceTime(c, 4.999).toFixed(2), '10.00');
});

test('slowing down stops at the next clip', () => {
    let p = T.appendMedia(project(), 'mv');   // [0,10)
    p = T.appendMedia(p, 'mi');                // [10,15)
    const id = T.trackClips(p, 'V1')[0].id;
    p = T.setSpeed(p, id, 0.5);
    assert.equal(T.getClip(p, id).duration, 10, 'would be 20 s, capped by the image at 10 s');
    assert.equal(T.setSpeed(p, T.trackClips(p, 'V1')[1].id, 2), p, 'stills have no speed');
});

test('speed is clamped to the supported range', () => {
    let p = T.appendMedia(project(), 'mv');
    p = T.setSpeed(p, p.clips[0].id, 99);
    assert.equal(p.clips[0].speed, T.MAX_SPEED);
});

test('trims and splits respect the speed', () => {
    let p = T.appendMedia(project(), 'mv');
    const id = p.clips[0].id;
    p = T.setSpeed(p, id, 2);                  // [0,5) over source 0–10
    p = T.trimClip(p, id, 'start', 1);         // drops 2 s of source
    assert.deepEqual([T.getClip(p, id).start, T.getClip(p, id).in], [1, 2]);
    p = T.trimClip(p, id, 'end', 99);
    assert.equal(T.clipEnd(T.getClip(p, id)), 5, 'source runs out at 5 s on the timeline');
    p = T.splitClip(p, id, 3);
    const right = T.trackClips(p, 'V1')[1];
    assert.equal(right.in, 6);
    assert.equal(right.speed, 2);
});

/* ----------------------------------------------------------------- freeze */

test('a freeze frame holds the frame under the playhead and pushes the rest along', () => {
    let p = T.appendMedia(project(), 'mv');    // [0,10)
    p = T.appendMedia(p, 'mi');                // [10,15)
    const vid = T.trackClips(p, 'V1')[0].id;
    const r = T.freezeFrame(p, vid, 4, 2);
    const clips = T.trackClips(r.project, 'V1');
    assert.deepEqual(clips.map((c) => [c.start, c.duration]), [[0, 4], [4, 2], [6, 6], [12, 5]]);
    const still = T.getClip(r.project, r.id);
    assert.equal(still.freeze, true);
    assert.equal(still.in, 4);
    assert.equal(T.sourceTime(still, 5.5), 4, 'the frame does not move');
    assert.equal(T.isTimed(r.project, still), false);
    assert.equal(T.audibleClips(r.project, 5).length, 0, 'a freeze frame is silent');
    assert.equal(T.trimClip(r.project, r.id, 'end', 50) === r.project, false, 'and can be stretched');
});

test('a freeze at the very end of a clip goes after it without overlapping', () => {
    const p = T.appendMedia(project(), 'mv');
    const r = T.freezeFrame(p, p.clips[0].id, 9.97, 1);
    assert.deepEqual(clipsOn(r.project, 'V1'), [[0, 10], [10, 1]]);
});

/* ---------------------------------------------------------- detach audio */

test('detaching audio adds a sound-only clip and mutes the video', () => {
    let p = T.appendMedia(project(), 'mv');
    const vid = p.clips[0].id;
    const r = T.detachAudio(p, vid);
    const sound = T.getClip(r.project, r.id);
    assert.equal(sound.track, 'A1');
    assert.equal(T.clipKind(r.project, sound), 'audio');
    assert.equal(T.getClip(r.project, vid).muted, true);
    assert.deepEqual(T.audibleClips(r.project, 1).map((a) => a.clip.id), [r.id]);
    assert.deepEqual(T.renderLayers(r.project, 1).map((l) => l.clip.id), [vid], 'the sound clip draws nothing');
});

test('detaching when the audio track is busy adds another audio track', () => {
    let p = T.appendMedia(project(), 'mv');
    p = T.appendMedia(p, 'ma');                // A1 busy 0–30
    const r = T.detachAudio(p, T.trackClips(p, 'V1')[0].id);
    assert.equal(T.getClip(r.project, r.id).track, 'A2');
});

/* ------------------------------------------------------------ transitions */

function twoClips() {
    let p = T.appendMedia(project(), 'mv');    // [0,10)
    p = T.appendMedia(p, 'mi');                // [10,15)
    return p;
}

test('a transition needs a clip right before it and is centred on the cut', () => {
    let p = twoClips();
    const [a, b] = T.trackClips(p, 'V1');
    p = T.setTransition(p, b.id, 'crossfade', 2);
    const w = T.transitionWindow(p, T.getClip(p, b.id));
    assert.deepEqual([w.from.id, w.start, w.end], [a.id, 9, 11]);
    assert.equal(T.transitionWindow(T.setTransition(p, a.id, 'crossfade', 2), T.getClip(p, a.id)), null);
    // Moving the image away breaks the transition without deleting it.
    const apart = T.moveClip(p, b.id, 12);
    assert.equal(T.transitionWindow(apart, T.getClip(apart, b.id)), null);
});

test('during a crossfade both clips are drawn and heard, weighted by progress', () => {
    let p = twoClips();
    const [a, b] = T.trackClips(p, 'V1');
    p = T.setTransition(p, b.id, 'crossfade', 2);
    const layers = T.renderLayers(p, 9.5);      // 25% through
    assert.deepEqual(layers.map((l) => [l.clip.id, l.alpha]), [[a.id, 0.75], [b.id, 0.25]]);
    assert.equal(layers[0].transition.role, 'from');
    // The outgoing video keeps playing past its end into the window.
    const media = T.mediaAt(p, 10.5);
    assert.ok(media.some((m) => m.clip.id === a.id && m.sourceTime <= 10 && !m.inside));
    const sound = T.audibleClips(p, 10.5);
    assert.equal(sound.length, 1, 'the image has no sound; only the video fades out');
    assert.ok(near(sound[0].gain, 0.25));
    assert.deepEqual(T.renderLayers(p, 8).map((l) => l.clip.id), [a.id], 'outside the window, one clip');
});

test('clipGainAt agrees with audibleClips everywhere, transitions and ducking included', () => {
    let p = T.appendMedia(project(), 'mv');      // V1 [0,10)
    p = T.appendMedia(p, 'mv');                  // V1 [10,20)
    p = T.appendMedia(p, 'ma');                  // A1 music [0,30)
    p = T.updateTrack(p, 'A1', { duck: true });
    const [a, b] = T.trackClips(p, 'V1');
    p = T.setTransition(p, b.id, 'crossfade', 2);
    p = T.updateClip(p, a.id, { fadeIn: 1, volume: 0.8 });
    const env = T.duckEnvelope(p, () => 0.5);
    const duck = (t) => T.envelopeAt(env, t);
    for (let t = 0; t < 31; t += 0.37) {
        const listed = new Map(T.audibleClips(p, t, duck).map((x) => [x.clip.id, x.gain]));
        p.clips.forEach(function (c) {
            const direct = T.clipGainAt(p, c, t, duck);
            assert.ok(near(direct, listed.get(c.id) || 0, 1e-9), c.id + ' at ' + t.toFixed(2) + ': ' + direct + ' vs ' + listed.get(c.id));
        });
    }
    assert.deepEqual(T.soundWindow(p, T.getClip(p, a.id)), Object.assign(T.soundWindow(p, T.getClip(p, a.id)), { start: 0, end: 11 }));
});

test('a dip goes to black at the cut', () => {
    assert.deepEqual(T.transitionMix('dip', 0.5), { from: 0, to: 0 });
    assert.deepEqual(T.transitionMix('dip', 0.25), { from: 0.5, to: 0 });
    const slide = T.transitionMix('slide', 0.3);
    assert.deepEqual([slide.from, slide.to, slide.soundTo], [1, 1, 0.3]);
});

test('transitionAllCuts puts one on every cut between touching clips', () => {
    let p = twoClips();
    p = T.appendMedia(p, 'mi');                 // [15,20)
    p = T.transitionAllCuts(p, 'dip', 1);
    assert.equal(p.clips.filter((c) => c.transition).length, 2);
});

test('splitting does not copy a transition onto the second half', () => {
    let p = twoClips();
    const b = T.trackClips(p, 'V1')[1];
    p = T.setTransition(p, b.id, 'crossfade', 1);
    p = T.splitClip(p, b.id, 12);
    assert.equal(T.trackClips(p, 'V1')[2].transition, null);
});

/* --------------------------------------------------------- motion, titles */

test('Ken Burns motion eases between its end points', () => {
    const c = { start: 0, duration: 10, motion: { type: 'zoom-in', amount: 0.2 } };
    assert.equal(T.motionAt(c, 0).scale, 1);
    assert.ok(near(T.motionAt(c, 10).scale, 1.2));
    assert.ok(near(T.motionAt(c, 5).scale, 1.1));
    const pan = { start: 0, duration: 4, motion: { type: 'pan-left', amount: 0.2 } };
    assert.ok(near(T.motionAt(pan, 0).dx, 0.1));
    assert.ok(near(T.motionAt(pan, 4).dx, -0.1));
    assert.deepEqual(T.motionAt({ start: 0, duration: 1 }, 0.5), { scale: 1, dx: 0, dy: 0 });
});

test('title animations', () => {
    const base = { start: 0, duration: 4, animDuration: 0.5 };
    assert.equal(T.textAnimAt(Object.assign({}, base, { anim: 'fade' }), 0.25).alpha, 0.5);
    assert.ok(T.textAnimAt(Object.assign({}, base, { anim: 'rise' }), 0).dy > 0);
    assert.equal(T.textAnimAt(Object.assign({}, base, { anim: 'rise' }), 1).dy, 0);
    const words = T.textAnimAt(Object.assign({}, base, { anim: 'words' }), 1.5);
    assert.equal(words.unit, 'words');
    assert.equal(words.reveal, 0.5, '3 s span (75% of 4 s), halfway at 1.5 s');
    assert.equal(T.textAnimAt(Object.assign({}, base, { anim: 'typewriter' }), 10).reveal, 1);
    assert.ok(near(T.textAnimAt(Object.assign({}, base, { anim: 'pop' }), 0.5).scale, 1));
});

/* ---------------------------------------------------------------- ducking */

test('ducked music drops while the voice speaks and recovers after', () => {
    let p = project();
    p = T.appendMedia(p, 'ma');                  // music on A1, 0–30
    p = T.updateTrack(p, 'A1', { duck: true });
    p = T.appendMedia(p, 'mv');                  // video with voice, 0–10
    const env = T.duckEnvelope(p, () => 0.5, 0.05);
    assert.ok(T.envelopeAt(env, 5) < 0.3, 'ducked while the video talks');
    assert.ok(T.envelopeAt(env, 20) > 0.95, 'back up afterwards');
    assert.ok(T.envelopeAt(env, 10.1) < T.envelopeAt(env, 12), 'released gradually');
    const music = T.audibleClips(p, 5, (t) => T.envelopeAt(env, t)).find((a) => a.clip.mediaId === 'ma');
    assert.ok(music.gain < 0.3);
});

test('quiet voice does not duck, and without a ducked track nothing changes', () => {
    let p = project();
    p = T.appendMedia(p, 'ma');
    p = T.updateTrack(p, 'A1', { duck: true });
    p = T.appendMedia(p, 'mv');
    assert.ok(T.envelopeAt(T.duckEnvelope(p, () => 0.001), 5) > 0.99);
    const flat = T.duckEnvelope(T.updateTrack(p, 'A1', { duck: false }), () => 1);
    assert.ok(Array.from(flat.gains).every((g) => g === 1));
});

/* ---------------------------------------------------------------- markers */

test('markers are kept in order, snap, and become chapters', () => {
    let p = project();
    let r = T.addMarker(p, 65, 'Second');
    r = T.addMarker(r.project, 3, 'First');
    p = r.project;
    assert.deepEqual(p.markers.map((m) => m.label), ['First', 'Second']);
    assert.equal(T.snapTime(p, 64.9, 0.2), 65);
    assert.equal(T.chaptersText(p), '00:00 Start\n00:03 First\n01:05 Second');
    p = T.updateMarker(p, p.markers[0].id, { time: 0.2, label: 'Intro' });
    assert.equal(T.chaptersText(p), '00:00 Intro\n01:05 Second');
    assert.equal(T.removeMarker(p, p.markers[0].id).markers.length, 1);
});

/* ------------------------------------------------------------- multi-clip */

test('several clips move together, or not at all', () => {
    let p = project();
    p = T.appendMedia(p, 'mi');                   // V1 [0,5)
    p = T.appendMedia(p, 'ma');                   // A1 [0,30)
    p = T.appendMedia(p, 'mi', 'V2');             // V2 [0,5)
    const ids = [T.trackClips(p, 'V1')[0].id, T.trackClips(p, 'V2')[0].id];
    const moved = T.moveClips(p, ids, 3);
    assert.deepEqual([clipsOn(moved, 'V1'), clipsOn(moved, 'V2')], [[[3, 5]], [[3, 5]]]);
    assert.deepEqual(clipsOn(T.moveClips(moved, ids, -10), 'V1'), [[0, 5]], 'clamped at zero');
    p = T.appendMedia(moved, 'mi');               // V1 [8,13)
    assert.equal(T.moveClips(p, ids, 2), p, 'would overlap on V1');
});

test('copy and paste keeps spacing and lands at the playhead', () => {
    let p = project();
    p = T.appendMedia(p, 'mi');                   // V1 [0,5)
    p = T.addClip(p, T.textClip('T1', 1, 'Hi'));  // T1 [1,6)
    const board = T.copyClips(p, p.clips.map((c) => c.id));
    const r = T.pasteClips(p, board, 20);
    assert.equal(r.ids.length, 2);
    assert.deepEqual(clipsOn(r.project, 'V1'), [[0, 5], [20, 5]]);
    assert.deepEqual(clipsOn(r.project, 'T1'), [[1, 5], [21, 5]]);
    // Pasting onto a busy spot slides to a gap instead of overlapping.
    const again = T.pasteClips(r.project, board, 20);
    assert.deepEqual(clipsOn(again.project, 'V1'), [[0, 5], [20, 5], [25, 5]]);
});

/* -------------------------------------------------------------- subtitles */

test('words group into caption lines at pauses, punctuation and length', () => {
    const words = [
        { text: 'In', start: 0, end: 0.2 }, { text: 'the', start: 0.2, end: 0.4 },
        { text: 'name', start: 0.4, end: 0.8 }, { text: 'of', start: 0.8, end: 0.9 },
        { text: 'Allah.', start: 0.9, end: 1.4 }, { text: 'Next', start: 1.5, end: 1.8 },
        { text: 'after', start: 3, end: 3.3 }, { text: 'pause', start: 3.3, end: 3.6 }
    ];
    const cues = T.wordsToCaptions(words);
    assert.deepEqual(cues.map((c) => c.text), ['In the name of Allah.', 'Next', 'after pause']);
    assert.deepEqual([cues[0].start, cues[0].end], [0, 1.4]);
});

test('SRT and VTT round-trip', () => {
    const cues = [{ start: 1.5, end: 3.25, text: 'Hello' }, { start: 3725.001, end: 3726, text: 'بسم الله' }];
    const srt = T.toSRT(cues);
    assert.ok(srt.startsWith('1\n00:00:01,500 --> 00:00:03,250\nHello\n'));
    assert.ok(srt.includes('01:02:05,001 --> 01:02:06,000'));
    assert.deepEqual(T.parseSubtitles(srt), cues);
    assert.deepEqual(T.parseSubtitles(T.toVTT(cues)), cues);
    assert.deepEqual(T.parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\n<b>hi</b>'), [{ start: 1, end: 2, text: 'hi' }]);
});

test('titles on a track export as cues', () => {
    let p = project();
    p = T.addClip(p, T.textClip('T1', 10, 'Two'));
    p = T.addClip(p, T.textClip('T1', 0, 'One'));
    const cues = T.trackCues(p, 'T1');
    assert.deepEqual(cues.map((c) => c.text), ['One', 'Two']);
});

/* ------------------------------------------------------------------ Arabic */

test('Arabic text is detected and ayah numbers use Arabic digits', () => {
    assert.equal(T.isArabic('بِسْمِ ٱللَّهِ'), true);
    assert.equal(T.isArabic('In the name of Allah'), false);
    assert.equal(T.arabicDigits(286), '٢٨٦');
});

test('projects saved before markers existed still load', () => {
    const p = project();
    delete p.markers;
    const back = T.deserialize(JSON.stringify(Object.assign(p, { format: T.FORMAT, version: 1 })));
    assert.deepEqual(back.markers, []);
});
