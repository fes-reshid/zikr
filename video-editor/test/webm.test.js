/*
 * Unit tests for the WebM duration patch, on hand-built EBML. The end-to-end
 * test checks it again on a file MediaRecorder actually wrote.
 *
 *   node --test video-editor/test/webm.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../webm.js');

const bytes = (...parts) => Uint8Array.from(parts.flat());

/** EBML header, unknown-size Segment, Info (scale 1 ms + MuxingApp), a Cluster. */
function streamedWebm(extraBeforeInfo) {
    const header = [0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x42, 0x86, 0x81, 0x01];
    const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    const infoBody = [
        0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40,          // TimecodeScale 1,000,000
        0x4D, 0x80, 0x84, 0x74, 0x65, 0x73, 0x74           // MuxingApp "test"
    ];
    const info = [0x15, 0x49, 0xA9, 0x66, 0x80 | infoBody.length].concat(infoBody);
    const cluster = [0x1F, 0x43, 0xB6, 0x75, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xE7, 0x81, 0x00];
    return bytes(header, segment, extraBeforeInfo || [], info, cluster);
}

test('adds a duration to a streamed WebM and leaves the rest intact', () => {
    const src = streamedWebm();
    assert.equal(W.getDuration(src), null);
    const out = W.setDuration(src, 5315.5);
    assert.ok(out);
    assert.equal(W.getDuration(out), 5315.5);
    assert.equal(out.length, src.length + 11 + 7, 'Duration element, and Info size widened to 8 bytes');
    // The cluster after Info is byte-for-byte the same.
    assert.deepEqual(Array.from(out.slice(-15)), Array.from(src.slice(-15)));
    assert.equal(W.getDuration(src), null, 'the input is not modified');
});

test('rewrites an existing duration in place', () => {
    const once = W.setDuration(streamedWebm(), 1000);
    const twice = W.setDuration(once, 2500);
    assert.equal(twice.length, once.length);
    assert.equal(W.getDuration(twice), 2500);
});

test('respects a non-default timecode scale', () => {
    const src = streamedWebm();
    // Change TimecodeScale to 500,000 ns (0x07A120): durations are stored in half-ms units.
    src.set([0x07, 0xA1, 0x20], 30); // header 9 + segment 12 + Info id/size 5 + TimecodeScale id/size 4
    const out = W.setDuration(src, 1234);
    assert.equal(W.getDuration(out), 1234);
});

test('refuses files it cannot safely patch', () => {
    assert.equal(W.setDuration(bytes([0, 0, 0, 0, 0]), 10), null, 'not EBML');
    assert.equal(W.setDuration(new Uint8Array(0), 10), null, 'empty');
    // A SeekHead before Info holds offsets that inserting bytes would break.
    const seekHead = [0x11, 0x4D, 0x9B, 0x74, 0x80];
    assert.equal(W.setDuration(streamedWebm(seekHead), 10), null);
});
