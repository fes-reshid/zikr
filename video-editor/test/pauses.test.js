/*
 * Unit tests for finding pauses in speech, cutting at them, jump cuts and
 * timing a written text to speech (captions for Afaan Oromoo).
 *
 *   node --test video-editor/test/pauses.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline.js');

/** Peaks at 100 per second: speech (0.6) with silence (0.01) in the given spans. */
function speech(seconds, silences) {
    const rate = 100;
    const peaks = new Float32Array(seconds * rate);
    for (let i = 0; i < peaks.length; i += 1) {
        const t = i / rate;
        const quiet = silences.some((s) => t >= s[0] && t < s[1]);
        peaks[i] = quiet ? 0.01 : 0.5 + 0.2 * Math.abs(Math.sin(i));
    }
    return { peaks, rate };
}

function withAudio(duration) {
    let p = T.createProject();
    p = T.addMedia(p, { id: 'm1', name: 'talk.mp3', type: 'audio', duration: duration });
    const track = p.tracks.find((t) => t.kind === 'audio').id;
    p = T.addClip(p, T.clipFromMedia(T.getMedia(p, 'm1'), track, 0));
    return p;
}

test('findPauses finds the quiet stretches and ignores short gaps', () => {
    const { peaks, rate } = speech(10, [[2, 3], [5, 5.1], [7, 8.5]]);
    const pauses = T.findPauses(peaks, rate, { minPause: 0.3 });
    assert.equal(pauses.length, 2, JSON.stringify(pauses));
    assert.ok(Math.abs(pauses[0].start - 2) < 0.1 && Math.abs(pauses[0].end - 3) < 0.1);
    assert.ok(Math.abs(pauses[1].start - 7) < 0.1 && Math.abs(pauses[1].end - 8.5) < 0.1);
    assert.deepEqual(T.findPauses(null, 100), []);
    assert.equal(T.findPauses(peaks, rate, { from: 4, to: 10 }).length, 1, 'only within the range');
    // A noisy room: the background is louder, the pauses are still found.
    const noisy = Float32Array.from(peaks, (v) => v + 0.15);
    assert.equal(T.findPauses(noisy, rate).length, 2);
});

test('speechSegments and pauseCuts', () => {
    const pauses = [{ start: 2, end: 3 }, { start: 3.6, end: 4 }, { start: 7, end: 8 }];
    assert.deepEqual(T.speechSegments(pauses, 0, 10), [{ start: 0, end: 2 }, { start: 3, end: 3.6 }, { start: 4, end: 7 }, { start: 8, end: 10 }]);
    assert.deepEqual(T.pauseCuts(pauses, 0, 10, 1.5), [2.5, 7.5], 'a piece shorter than the minimum joins the next');
    assert.deepEqual(T.pauseCuts(pauses, 0, 10, 0.5), [2.5, 3.8, 7.5]);
});

test('clipPauses maps source pauses to the timeline, with trims and speed', () => {
    const { peaks, rate } = speech(20, [[6, 7], [12, 13]]);
    const clip = { start: 10, in: 4, duration: 6, speed: 2 };
    const p = T.clipPauses(clip, peaks, rate);
    assert.equal(p.length, 2);
    assert.ok(Math.abs(p[0].start - 11) < 0.1 && Math.abs(p[0].end - 11.5) < 0.1, JSON.stringify(p));
    assert.ok(Math.abs(p[1].start - 14) < 0.1);
});

test('cutAt splits a clip at each time, keeping the source in step', () => {
    let p = withAudio(10);
    const id = p.clips[0].id;
    const r = T.cutAt(p, id, [6, 2.5, 0.01]);
    assert.equal(r.ids.length, 3);
    const pieces = r.ids.map((x) => T.getClip(r.project, x));
    assert.deepEqual(pieces.map((c) => [c.start, c.duration, c.in]), [[0, 2.5, 0], [2.5, 3.5, 2.5], [6, 4, 6]]);
});

test('removeTime closes a gap with a jump cut and moves later clips', () => {
    let p = withAudio(10);
    p = T.addClip(p, Object.assign(T.textClip('T1', 1, 'Across'), { duration: 6 }));
    const t2 = T.nextTrackId(p, 'text');
    p = T.addTrack(p, 'text', 'More');
    p = T.addClip(p, Object.assign(T.textClip(t2, 3.2, 'Inside'), { duration: 0.5 }));
    assert.equal(p.clips.length, 3);
    p = T.addClip(p, Object.assign(T.textClip('T1', 8, 'After'), { duration: 1 }));
    p = T.addMarker(p, 9, 'End').project;
    const q = T.removeTime(p, 3, 4);
    const audio = q.clips.filter((c) => c.type === 'media').sort((a, b) => a.start - b.start);
    assert.deepEqual(audio.map((c) => [c.start, c.duration, c.in]), [[0, 3, 0], [3, 6, 4]]);
    const titles = q.clips.filter((c) => c.type === 'text');
    assert.equal(titles.find((c) => c.text === 'Across').duration, 5);
    assert.ok(!titles.some((c) => c.text === 'Inside'), 'a title wholly inside goes');
    assert.equal(titles.find((c) => c.text === 'After').start, 7);
    assert.equal(q.markers[0].time, 8);
    assert.equal(T.projectDuration(q), 9);
});

test('removePauses takes the pauses out, keeping a little quiet each side', () => {
    const p = withAudio(10);
    const q = T.removePauses(p, [{ start: 2, end: 3 }, { start: 6, end: 6.2 }, { start: 8, end: 9 }], 0.1);
    assert.ok(Math.abs(T.projectDuration(q) - 8.4) < 1e-6, String(T.projectDuration(q)));
    assert.equal(q.clips.length, 3, 'two jump cuts; the short pause stays');
    assert.equal(T.removePauses(p, []), p);
});

test('alignWords shares a text over the speech by word length', () => {
    const segs = [{ start: 0, end: 2 }, { start: 3, end: 5 }];
    const words = T.alignWords('Akkam jirtu? Nagaa dha, galatoomaa.', segs);
    assert.equal(words.length, 5);
    words.forEach(function (w, i) {
        assert.ok(w.end > w.start);
        assert.ok(segs.some((s) => w.start >= s.start - 1e-9 && w.end <= s.end + 1e-9), 'inside a segment');
        if (i) assert.ok(w.start >= words[i - 1].end - 1e-9, 'in order');
    });
    assert.equal(words[0].start, 0);
    assert.equal(words[words.length - 1].end, 5);
    const cues = T.wordsToCaptions(words, { maxChars: 42 });
    assert.equal(cues[0].text, 'Akkam jirtu?');
    assert.deepEqual(T.alignWords('', segs), []);
    assert.deepEqual(T.alignWords('hello', []), []);
    // Ge'ez script (Amharic) counts letters too.
    assert.equal(T.alignWords('ሰላም ነው', [{ start: 1, end: 2 }]).length, 2);
});

test('alignLines starts each line on a pause, so a line is not split across phrases', () => {
    const segs = [{ start: 0, end: 2.4 }, { start: 3.1, end: 4.9 }, { start: 5.6, end: 8.2 }, { start: 8.9, end: 10.9 }];
    const lines = ['Assalaamu alaykum, akkam jirtu?', 'Har’a waa’ee obsaa', 'Rabbiin obsitoota wajjin jira.', 'Galatoomaa.'];
    const words = T.alignLines(lines, segs);
    const firstOf = (i) => words.find((w) => w.line === i);
    assert.deepEqual([0, 1, 2, 3].map((i) => firstOf(i).start), [0, 3.1, 5.6, 8.9]);
    assert.ok(words.filter((w) => w.line === 0).every((w) => w.end <= 2.4 + 1e-9), 'line 1 stays in the first phrase');
    // Fewer phrases than lines: shared out by length, still in order.
    const few = T.alignLines(lines, [{ start: 0, end: 10 }]);
    assert.equal(few.length, words.length);
    assert.deepEqual(Array.from(new Set(few.map((w) => w.line))), [0, 1, 2, 3]);
    assert.deepEqual(T.alignLines([], segs), []);
});
