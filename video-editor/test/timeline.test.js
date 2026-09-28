/*
 * Unit tests for Reel's timeline model.
 *
 *   node --test video-editor/test/timeline.test.js
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

function clipsOn(p, track) {
    return T.trackClips(p, track).map((c) => [c.start, c.duration]);
}

test('media is appended end to end on the track it belongs on', () => {
    let p = project();
    p = T.appendMedia(p, 'mv');
    p = T.appendMedia(p, 'mi');
    p = T.appendMedia(p, 'ma');
    assert.deepEqual(clipsOn(p, 'V1'), [[0, 10], [10, T.DEFAULT_STILL]]);
    assert.deepEqual(clipsOn(p, 'A1'), [[0, 30]]);
    assert.equal(T.projectDuration(p), 30);
});

test('a clip cannot go on a track of the wrong kind', () => {
    let p = project();
    p = T.appendMedia(p, 'ma', 'V1');
    assert.equal(p.clips.length, 0);
    p = T.addClip(p, T.textClip('A1', 0));
    assert.equal(p.clips.length, 0);
    p = T.appendMedia(p, 'mv');
    const id = p.clips[0].id;
    assert.equal(T.moveClip(p, id, 0, 'A1').clips[0].track, 'V1');
    assert.equal(T.moveClip(p, id, 0, 'V2').clips[0].track, 'V2');
});

test('dropping onto another clip slides to the nearest gap instead of overlapping', () => {
    let p = project();
    p = T.appendMedia(p, 'mv');                       // [0, 10)
    p = T.addClip(p, T.clipFromMedia(IMAGE, 'V1', 3)); // wanted 3, nearest free start is 10
    assert.deepEqual(clipsOn(p, 'V1'), [[0, 10], [10, 5]]);

    const img = p.clips[1].id;
    p = T.moveClip(p, img, 20);
    assert.deepEqual(clipsOn(p, 'V1'), [[0, 10], [20, 5]]);
    // Dragged onto the first clip near its start: it goes before (-5 is not
    // allowed), so it lands right after instead.
    p = T.moveClip(p, img, 1);
    assert.deepEqual(clipsOn(p, 'V1'), [[0, 10], [10, 5]]);
});

test('a move never goes before zero', () => {
    let p = T.appendMedia(project(), 'mi');
    p = T.moveClip(p, p.clips[0].id, -4);
    assert.equal(p.clips[0].start, 0);
});

test('trimming the start moves the in-point with it', () => {
    let p = T.appendMedia(project(), 'mv');
    const id = p.clips[0].id;
    p = T.trimClip(p, id, 'start', 2.5);
    const c = T.getClip(p, id);
    assert.deepEqual([c.start, c.duration, c.in], [2.5, 7.5, 2.5]);
    // It cannot be dragged back past the start of the source file.
    p = T.trimClip(p, id, 'start', -3);
    assert.deepEqual([T.getClip(p, id).start, T.getClip(p, id).in], [0, 0]);
});

test('trimming the end stops at the end of the source and at the next clip', () => {
    let p = T.appendMedia(project(), 'mv');
    const id = p.clips[0].id;
    p = T.trimClip(p, id, 'end', 6);
    assert.equal(T.getClip(p, id).duration, 6);
    p = T.trimClip(p, id, 'end', 99);
    assert.equal(T.getClip(p, id).duration, 10, 'source is 10 s long');

    p = T.trimClip(p, id, 'end', 4);
    p = T.addClip(p, T.clipFromMedia(IMAGE, 'V1', 7));
    p = T.trimClip(p, id, 'end', 9);
    assert.equal(T.getClip(p, id).duration, 7, 'stops at the image at 7 s');
});

test('stills stretch as far as there is room', () => {
    let p = T.appendMedia(project(), 'mi');
    const id = p.clips[0].id;
    p = T.trimClip(p, id, 'end', 42);
    assert.equal(T.getClip(p, id).duration, 42);
});

test('a trim never goes below the minimum length', () => {
    let p = T.appendMedia(project(), 'mv');
    const id = p.clips[0].id;
    p = T.trimClip(p, id, 'end', 0);
    assert.equal(T.getClip(p, id).duration, T.MIN_DURATION);
    p = T.appendMedia(project(), 'mv');
    p = T.trimClip(p, p.clips[0].id, 'start', 50);
    assert.equal(p.clips[0].duration, T.MIN_DURATION);
});

test('splitting keeps both halves playing the same source frames', () => {
    let p = T.appendMedia(project(), 'mv');
    const id = p.clips[0].id;
    p = T.updateClip(p, id, { fadeIn: 1, fadeOut: 2 });
    p = T.trimClip(p, id, 'start', 1); // in = 1
    p = T.splitClip(p, id, 4);
    assert.equal(p.clips.length, 2);
    const [left, right] = T.trackClips(p, 'V1');
    assert.deepEqual([left.start, left.duration, left.in], [1, 3, 1]);
    assert.deepEqual([right.start, right.duration, right.in], [4, 6, 4]);
    assert.deepEqual([left.fadeIn, left.fadeOut, right.fadeIn, right.fadeOut], [1, 0, 0, 2]);
    assert.notEqual(left.id, right.id);
    // Same source time on both sides of the cut.
    assert.equal(T.sourceTime(left, 3.99).toFixed(2), '3.99');
    assert.equal(T.sourceTime(right, 4), 4);
});

test('a split too close to an edge does nothing', () => {
    const p = T.appendMedia(project(), 'mv');
    assert.equal(T.splitClip(p, p.clips[0].id, 0.05), p);
    assert.equal(T.splitClip(p, p.clips[0].id, 9.95), p);
    assert.equal(T.splitClip(p, p.clips[0].id, 12), p);
});

test('splitAt cuts every clip under the playhead, or only the chosen ones', () => {
    let p = project();
    p = T.appendMedia(p, 'mv');
    p = T.appendMedia(p, 'ma');
    assert.equal(T.splitAt(p, 5).clips.length, 4);
    assert.equal(T.splitAt(p, 5, [p.clips[1].id]).clips.length, 3);
    assert.equal(T.splitAt(p, 20).clips.length, 3, 'only the audio is under 20 s');
});

test('ripple delete closes the gap on that track only', () => {
    let p = project();
    p = T.appendMedia(p, 'mv');   // V1 [0,10)
    p = T.appendMedia(p, 'mi');   // V1 [10,15)
    p = T.appendMedia(p, 'mi');   // V1 [15,20)
    p = T.appendMedia(p, 'ma');   // A1 [0,30)
    const first = T.trackClips(p, 'V1')[0].id;

    const plain = T.deleteClips(p, [first], false);
    assert.deepEqual(clipsOn(plain, 'V1'), [[10, 5], [15, 5]]);

    const rippled = T.deleteClips(p, [first], true);
    assert.deepEqual(clipsOn(rippled, 'V1'), [[0, 5], [5, 5]]);
    assert.deepEqual(clipsOn(rippled, 'A1'), [[0, 30]]);
});

test('duplicate lands right after the original', () => {
    let p = T.appendMedia(project(), 'mi');
    const r = T.duplicateClip(p, p.clips[0].id);
    assert.deepEqual(clipsOn(r.project, 'V1'), [[0, 5], [5, 5]]);
    assert.ok(r.id && r.id !== p.clips[0].id);
});

test('fades ramp in and out', () => {
    const c = { start: 10, duration: 10, fadeIn: 2, fadeOut: 4 };
    assert.equal(T.fadeAt(c, 10), 0);
    assert.equal(T.fadeAt(c, 11), 0.5);
    assert.equal(T.fadeAt(c, 14), 1);
    assert.equal(T.fadeAt(c, 18), 0.5);
    assert.equal(T.fadeAt({ start: 0, duration: 5 }, 2), 1);
});

test('layers draw the lower video track first and titles last', () => {
    let p = project();
    p = T.appendMedia(p, 'mv');            // V1
    p = T.appendMedia(p, 'mi', 'V2');      // V2
    p = T.addClip(p, T.textClip('T1', 0)); // T1
    p = T.appendMedia(p, 'ma');            // audio is not a layer
    assert.deepEqual(T.renderLayers(p, 1).map((l) => l.clip.track), ['V1', 'V2', 'T1']);
    assert.deepEqual(T.renderLayers(p, 7).map((l) => l.clip.track), ['V1'], 'only V1 runs past 5 s');

    const hidden = T.updateTrack(p, 'V2', { hidden: true });
    assert.deepEqual(T.renderLayers(hidden, 1).map((l) => l.clip.track), ['V1', 'T1']);
});

test('muted tracks and clips are silent', () => {
    let p = project();
    p = T.appendMedia(p, 'mv');
    p = T.appendMedia(p, 'ma');
    p = T.updateClip(p, T.trackClips(p, 'A1')[0].id, { volume: 0.5 });
    assert.deepEqual(T.audibleClips(p, 1).map((a) => a.gain).sort(), [0.5, 1]);
    assert.equal(T.audibleClips(T.updateTrack(p, 'A1', { muted: true }), 1).length, 1);
    assert.equal(T.audibleClips(T.updateClip(p, T.trackClips(p, 'V1')[0].id, { muted: true }), 1).length, 1);
});

test('placeRect letterboxes, crops and positions', () => {
    // 16:9 into a square frame.
    assert.deepEqual(T.placeRect(1600, 900, 1000, 1000, 'contain'), { x: 0, y: 218.75, w: 1000, h: 562.5 });
    const cover = T.placeRect(1600, 900, 1000, 1000, 'cover');
    assert.equal(cover.h, 1000);
    assert.ok(cover.w > 1000);
    // Quarter-size picture-in-picture in the top-right corner.
    assert.deepEqual(T.placeRect(1280, 720, 1280, 720, 'contain', 0.25, 0.85, 0.15),
        { x: 928, y: 18, w: 320, h: 180 });
});

test('filterString is "none" until something is changed', () => {
    assert.equal(T.filterString(T.DEFAULT_FILTERS), 'none');
    assert.equal(T.filterString({ brightness: 120, grayscale: 100 }), 'brightness(120%) grayscale(100%)');
});

test('snapTime pulls to nearby edges and the playhead', () => {
    let p = T.appendMedia(project(), 'mv');
    assert.equal(T.snapTime(p, 9.9, 0.2), 10);
    assert.equal(T.snapTime(p, 9.5, 0.2), 9.5);
    assert.equal(T.snapTime(p, 3.1, 0.2, null, [3]), 3);
    assert.equal(T.snapTime(p, 9.9, 0.2, p.clips[0].id), 9.9, 'ignores the clip being dragged');
});

test('times format as minutes, seconds and frames and parse back', () => {
    assert.equal(T.formatTime(0, 30), '00:00.00');
    assert.equal(T.formatTime(75.5, 30), '01:15.15');
    assert.equal(T.formatTime(3725, 25), '1:02:05.00');
    assert.equal(T.parseTime('01:15.15', 30), 75.5);
    assert.equal(T.parseTime('1:15.5'), 75.5);
    assert.equal(T.parseTime('12'), 12);
    assert.equal(T.parseTime('abc'), null);
});

test('rulerStep keeps labels apart', () => {
    assert.equal(T.rulerStep(100, 80), 1);
    assert.equal(T.rulerStep(10, 80), 10);
    assert.equal(T.rulerStep(1000, 80), 0.1);
});

test('history undoes and redoes, and a new edit drops the redo branch', () => {
    let p = project();
    const h = new T.History(p);
    assert.equal(h.canUndo(), false);
    p = T.appendMedia(p, 'mv'); h.push(p);
    p = T.appendMedia(p, 'mi'); h.push(p);
    assert.equal(h.push(p), false, 'an unchanged state is not a step');

    assert.equal(h.undo().clips.length, 1);
    assert.equal(h.undo().clips.length, 0);
    assert.equal(h.undo(), null);
    assert.equal(h.redo().clips.length, 1);

    h.push(T.appendMedia(h.current(), 'ma'));
    assert.equal(h.canRedo(), false);
    assert.equal(h.current().clips.length, 2);
});

test('history snapshots are independent of later edits', () => {
    const p = T.appendMedia(project(), 'mv');
    const h = new T.History(p);
    p.clips[0].start = 99;
    assert.equal(h.current().clips[0].start, 0);
});

test('a project survives a save and load, without the file contents', () => {
    let p = project();
    p.media[0].url = 'blob:whatever';
    p.media[0].thumbnail = 'data:image/png;base64,AAAA';
    p = T.appendMedia(p, 'mv');
    p = T.addClip(p, T.textClip('T1', 1, 'Hello'));
    const json = T.serialize(p);
    assert.ok(!json.includes('blob:'), 'object URLs are not saved');
    assert.ok(!json.includes('base64'), 'thumbnails are not saved');
    const back = T.deserialize(json);
    assert.equal(back.clips.length, 2);
    assert.equal(back.clips.find((c) => c.type === 'text').text, 'Hello');
    assert.deepEqual(back.tracks, p.tracks);
});

test('loading rejects things that are not projects and drops dangling clips', () => {
    assert.throws(() => T.deserialize('{nope'), /not valid JSON/);
    assert.throws(() => T.deserialize('{"format":"other"}'), /not a Reel project/);
    assert.throws(() => T.deserialize({ format: T.FORMAT, version: 99, tracks: [], clips: [], media: [] }), /newer/);
    const p = T.appendMedia(project(), 'mv');
    const data = JSON.parse(T.serialize(p));
    data.clips.push({ id: 'x', type: 'media', mediaId: 'gone', track: 'V1', start: 20, duration: 1 });
    data.clips.push({ id: 'y', type: 'text', track: 'nowhere', start: 0, duration: 1 });
    assert.equal(T.deserialize(data).clips.length, 1);
});

test('re-imported files are matched to saved media by name and size', () => {
    const p = project();
    assert.equal(T.matchMedia(p, { name: 'clip.webm', size: 1000 }).id, 'mv');
    assert.equal(T.matchMedia(p, { name: 'clip.webm', size: 5 }).id, 'mv', 'falls back to the name');
    assert.equal(T.matchMedia(p, { name: 'other.webm', size: 1000 }), null);
});

test('tracks are added beside their kind and removed only when empty', () => {
    let p = project();
    p = T.addTrack(p, 'video');
    assert.deepEqual(p.tracks.map((t) => t.id), ['T1', 'V3', 'V2', 'V1', 'A1']);
    p = T.addTrack(p, 'audio');
    assert.deepEqual(p.tracks.map((t) => t.id), ['T1', 'V3', 'V2', 'V1', 'A2', 'A1']);
    p = T.appendMedia(p, 'mi', 'V3');
    assert.equal(T.removeTrack(p, 'V3'), p, 'has a clip');
    p = T.removeTrack(p, 'A2');
    assert.equal(T.removeTrack(p, 'A1'), p, 'last audio track');
    assert.deepEqual(p.tracks.map((t) => t.id), ['T1', 'V3', 'V2', 'V1', 'A1']);
});

test('no operation mutates the project it was given', () => {
    const p = T.appendMedia(project(), 'mv');
    const before = JSON.stringify(p);
    const id = p.clips[0].id;
    T.moveClip(p, id, 3);
    T.trimClip(p, id, 'end', 5);
    T.splitClip(p, id, 5);
    T.deleteClips(p, [id], true);
    T.updateClip(p, id, { volume: 0 });
    T.duplicateClip(p, id);
    assert.equal(JSON.stringify(p), before);
});
