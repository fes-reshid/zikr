'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../slides.js');
const JSZip = require('../vendor/jszip.min.js');

const clip = (o) => Object.assign({ type: 'text', track: 'T1', start: 0, duration: 4, text: 'Hello', fontSize: 72, x: 0.5, y: 0.5, color: '#ffffff', bold: true, italic: false, align: 'center', font: 'sans' }, o);
const project = (clips) => ({ width: 1920, height: 1080, fps: 30, tracks: [{ id: 'T1', kind: 'text' }, { id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }], clips: clips, media: [] });

test('slide sizes follow the frame, and frames follow the slides', function () {
    assert.deepStrictEqual(S.slideSize(1920, 1080), { cx: 12192000, cy: 6858000 });
    assert.deepStrictEqual(S.slideSize(1080, 1920), { cx: 6858000, cy: 12192000 });
    assert.deepStrictEqual(S.frameFor(12192000, 6858000), [1920, 1080]);
    assert.deepStrictEqual(S.frameFor(9144000, 6858000), [1440, 1080]);
    assert.deepStrictEqual(S.frameFor(6858000, 12192000), [1080, 1920]);
});

test('the video is split where its pictures change, ignoring sound and slivers', function () {
    const p = project([
        { id: 'a', type: 'media', track: 'V1', start: 0, duration: 5 },
        { id: 'b', type: 'media', track: 'V1', start: 5, duration: 3 },
        clip({ id: 't', start: 1, duration: 2 }),
        { id: 's', type: 'media', track: 'A1', start: 0, duration: 30 },
        { id: 'z', type: 'media', track: 'V1', start: 8, duration: 0.2 }
    ]);
    const parts = S.segments(p);
    assert.deepStrictEqual(parts.map((x) => [x.start, x.end]), [[0, 1], [1, 3], [3, 5], [5, 8.2]], 'the sound does not make slides; the 0.2 s sliver joins the slide before');
    const many = project(Array.from({ length: 200 }, (x, i) => ({ id: 'c' + i, type: 'media', track: 'V1', start: i, duration: 1 })));
    assert.ok(S.segments(many).length <= 80, 'at most 80 slides');
    assert.deepStrictEqual(S.segments(project([])), []);
});

test('a title becomes a text box of the same size, colour and place', function () {
    const size = S.slideSize(1920, 1080);
    const s = S.textShape(clip({ text: 'Bismillah', fontSize: 72, x: 0.5, y: 0.25, color: '#f2d27a', box: true, boxColor: '#103d33', shadow: true }), 1920, 1080, size);
    assert.strictEqual(s.pt, 54, '72 px of a 720-line frame is 54 pt on a 7.5 in slide');
    assert.strictEqual(s.color, '#f2d27a');
    assert.strictEqual(s.fill, '#103d33');
    assert.ok(Math.abs((s.x + s.cx / 2) / size.cx - 0.5) < 0.01 && Math.abs((s.y + s.cy / 2) / size.cy - 0.25) < 0.01, 'centred where the title is');
    const ar = S.textShape(clip({ text: 'بسم الله', font: 'amiri' }), 1920, 1080, size);
    assert.ok(ar.rtl && ar.font === 'Amiri');
    const left = S.textShape(clip({ text: 'Hi', align: 'left', x: 0.3, wrap: 0.6 }), 1920, 1080, size);
    assert.ok(left.x > 0.3 * size.cx - left.cx / 2, 'a left-aligned box starts where its words do');
});

test('PowerPoint fonts map to the editor’s fonts', function () {
    assert.strictEqual(S.fontFor('Calibri', 'Hello'), 'sans');
    assert.strictEqual(S.fontFor('Times New Roman', 'Hello'), 'serif');
    assert.strictEqual(S.fontFor('Consolas', 'x'), 'mono');
    assert.strictEqual(S.fontFor('Arial', 'السلام'), 'naskh', 'Arabic text gets an Arabic font');
    assert.strictEqual(S.fontFor('Traditional Arabic', 'السلام'), 'amiri');
});

test('a .pptx is written with slides, background pictures, text boxes and timings', async function () {
    const size = S.slideSize(1920, 1080);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const buf = await S.buildPptx(JSZip, {
        cx: size.cx, cy: size.cy, title: 'Test & <deck>',
        slides: [
            { image: jpeg, texts: [S.textShape(clip({ text: 'One & two <three>' }), 1920, 1080, size)], ms: 4000, fade: false },
            { image: jpeg, texts: [S.textShape(clip({ text: 'Line one\nLine two', outline: { width: 4, color: '#000000' } }), 1920, 1080, size)], ms: 2500, fade: true },
            { color: '#103d33', texts: [], ms: 1000 }
        ]
    }, 'nodebuffer');
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml',
        'ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/media/image1.jpeg', 'ppt/media/image2.jpeg', 'docProps/core.xml'].forEach((n) => assert.ok(names.includes(n), n));
    assert.ok(!names.includes('ppt/media/image3.jpeg'), 'a colour slide needs no picture');
    const pres = await zip.file('ppt/presentation.xml').async('string');
    assert.ok(/<p:sldSz cx="12192000" cy="6858000"\/>/.test(pres));
    assert.strictEqual((pres.match(/<p:sldId /g) || []).length, 3);
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(s1.includes('<a:t>One &amp; two &lt;three&gt;</a:t>'), 'text is escaped');
    assert.ok(s1.includes('advTm="4000"') && s1.includes('r:embed="rId2"'));
    const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
    assert.strictEqual((s2.match(/<a:p>/g) || []).length, 2, 'each line is a paragraph');
    assert.ok(s2.includes('<p:fade/>') && s2.includes('<a:ln w='));
    const s3 = await zip.file('ppt/slides/slide3.xml').async('string');
    assert.ok(s3.includes('<a:srgbClr val="103D33"/>'));
    const types = await zip.file('[Content_Types].xml').async('string');
    assert.strictEqual((types.match(/presentationml\.slide\+xml/g) || []).length, 3);
    const core = await zip.file('docProps/core.xml').async('string');
    assert.ok(core.includes('Test &amp; &lt;deck&gt;'));
});
