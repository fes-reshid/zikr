'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../ai.js');
const S = require('../sounds.js');
const R = require('../trends.js');
const O = require('../occasions.js');

const texts = (c) => c.slots.map((s) => s.text);

test('a described topic gets written words, a fitting verse with its reference, painted scenes and a nature sound', function () {
    const c = A.plan({ prompt: 'A 20-second Reel about patience with rain sounds' });
    assert.strictEqual(c.topic, 'patience');
    assert.strictEqual(c.shape, 'tall');
    assert.strictEqual(c.seconds, 20);
    assert.strictEqual(c.ambient, 'rain');
    assert.strictEqual(texts(c)[0], 'Be patient');
    const verse = c.slots.find((s) => s.role === 'verse');
    assert.strictEqual(verse.ref, 'Qur’an 94:6');
    assert.strictEqual(verse.arabic, A.VERSES['94:6'][0]);
    assert.ok(c.scenes.length >= 3 && c.scenes.every((n) => O.SCENES[n]), 'only scenes the editor can paint');
    const L = A.layout(c, []);
    assert.ok(Math.abs(L.total - 20) < 0.01);
    assert.strictEqual(L.visuals.length, c.slots.length, 'one painted scene per line');
    assert.ok(L.slots.every((s, i) => !i || s.at >= L.slots[i - 1].at + L.slots[i - 1].len - 1e-6), 'lines follow each other');
});

test('the person’s own words are used as written, quoted or as a plain message', function () {
    assert.deepStrictEqual(texts(A.plan({ prompt: 'make a video saying "Welcome to our channel" and "Subscribe"' })), ['Welcome to our channel', 'Subscribe']);
    const shop = A.plan({ prompt: 'Our shop opens on Friday. 20% off everything this week!' });
    assert.deepStrictEqual(texts(shop), ['Our shop opens on Friday.', '20% off everything this week!']);
    assert.strictEqual(shop.mood, 'bright', 'and the topic still picks the look');
});

test('names, shapes and lengths are read from the request', function () {
    const b = A.plan({ prompt: 'Happy birthday Ahmed from the family' });
    assert.strictEqual(b.topic, 'birthday', '“from the family” is who it is from, not the topic');
    assert.strictEqual(texts(b)[0], 'Happy Birthday, Ahmed!');
    const e = A.plan({ prompt: 'Eid Mubarak video from Amina' });
    assert.strictEqual(e.slots[e.slots.length - 1].sub, 'From Amina');
    assert.strictEqual(A.plan({ prompt: 'Seek knowledge for YouTube' }).shape, 'wide');
    assert.strictEqual(A.plan({ prompt: 'jumuah reminder, square' }).shape, 'square');
    assert.strictEqual(A.plan({ prompt: 'ramadan youtube shorts' }).shape, 'tall');
    assert.strictEqual(A.detectSeconds('a one minute video'), 60);
    assert.strictEqual(A.detectSeconds('45 sec reel'), 45);
    assert.strictEqual(A.detectSeconds('ريلز 30 ثانية'), 30);
});

test('animals it names become scenes with their own sound, at the moment each appears', function () {
    const c = A.plan({ prompt: 'Animal sounds for kids: lion, elephant and camel' });
    assert.strictEqual(c.mood, 'kids');
    const animals = c.slots.filter((s) => s.animal).map((s) => s.animal);
    assert.deepStrictEqual(animals, ['lion', 'elephant', 'camel']);
    const L = A.layout(c, []);
    animals.forEach(function (a) {
        const i = c.slots.findIndex((s) => s.animal === a);
        const snd = L.sounds.find((s) => s.kind === a);
        assert.ok(snd && snd.at >= L.slots[i].at && snd.at < L.slots[i].at + L.slots[i].len, a + ' is heard during its scene');
    });
    Object.keys(A.ANIMALS).forEach((a) => assert.ok(S.ANIMALS[a], a + ' is in the sound library'));
});

test('Arabic requests get Arabic words', function () {
    const c = A.plan({ prompt: 'ريلز 20 ثانية عن الصبر مع صوت المطر' });
    assert.strictEqual(c.lang, 'ar');
    assert.strictEqual(c.topic, 'patience');
    assert.strictEqual(c.ambient, 'rain');
    assert.strictEqual(texts(c)[0], 'اصبر');
    assert.ok(c.slots.find((s) => s.role === 'verse').ref.startsWith('القرآن'));
});

test('your own pictures, videos and sound shape the video', function () {
    const media = [{ type: 'image' }, { type: 'video', duration: 6 }, { type: 'image' }, { type: 'audio', duration: 18 }];
    const c = A.plan({ prompt: 'make a video with my photos and my sound', media: media });
    assert.strictEqual(c.seconds, 18, 'as long as your sound');
    assert.strictEqual(c.music, 0);
    assert.strictEqual(c.scenes, null);
    assert.strictEqual(c.ambient, null, 'no nature sound over your own sound unless asked');
    assert.notStrictEqual(texts(c)[0].toLowerCase(), 'my photos and my sound');
    const L = A.layout(c, media);
    assert.ok(Math.abs(L.total - 18) < 0.01);
    const covered = L.visuals.reduce((a, v) => a + v.len, 0);
    assert.ok(Math.abs(covered - 18) < 0.05, 'your pictures fill the whole video');
    assert.ok(L.visuals.every((v) => v.kind === 'media' && media[v.index].type !== 'audio'));
    const vid = L.visuals.filter((v) => v.index === 1);
    assert.ok(vid.every((v) => v.in + v.len <= 6 + 1e-6), 'a video is never asked for more than it has');
    assert.ok(L.slots[L.slots.length - 1].at + L.slots[L.slots.length - 1].len <= 18 + 1e-6);
});

test('a voice-over times the words to the voice', function () {
    const c = A.plan({ prompt: 'patience', voice: true });
    assert.strictEqual(c.voice, true);
    let at = 0;
    const spans = c.slots.map(function (s) { const len = 1 + s.speak.length / 20; const sp = { start: at, end: at + len }; at += len + 0.45; return sp; });
    const L = A.layout(c, [], spans, 0.4);
    c.slots.forEach(function (s, i) { if (i) assert.ok(Math.abs(L.slots[i].at - (0.4 + spans[i].start - 0.15)) < 1e-6, 'line ' + i + ' appears as it is spoken'); });
    assert.ok(L.total >= 0.4 + spans[spans.length - 1].end, 'the video lasts until the voice ends');
});

test('follow-ups change the last request; a new idea starts again', function () {
    const first = { prompt: 'patience', media: [] };
    let r = A.refine(first, 'make it longer', 20);
    assert.strictEqual(r.fresh, false);
    assert.strictEqual(r.req.seconds, 30);
    r = A.refine(first, 'add rain and a lion', 20);
    assert.strictEqual(r.req.ambient, 'rain');
    assert.deepStrictEqual(r.req.animals, ['lion']);
    r = A.refine(first, 'gold text, square', 20);
    assert.strictEqual(r.req.design, 'gold');
    assert.strictEqual(r.req.shape, 'square');
    r = A.refine(first, 'another version', 20);
    assert.strictEqual(r.req.seed, 1);
    r = A.refine(first, 'in Arabic', 20);
    assert.strictEqual(r.req.lang, 'ar');
    r = A.refine(first, 'add line: Keep smiling', 20);
    assert.deepStrictEqual(r.req.extra, ['Keep smiling']);
    assert.ok(A.plan(r.req).slots.some((s) => s.text === 'Keep smiling'));
    r = A.refine(Object.assign({}, first, { seconds: 30 }), 'Animal sounds for kids: lion, elephant and camel', 30);
    assert.strictEqual(r.fresh, true);
    assert.strictEqual(r.req.seconds, undefined, 'a new idea forgets the old length');
    assert.strictEqual(A.refine(first, 'أطول', 20).req.seconds, 30);
});

test('another version changes the look but keeps the words', function () {
    const a = A.plan({ prompt: 'Ramadan reminder', seed: 0 });
    const b = A.plan({ prompt: 'Ramadan reminder', seed: 1 });
    const c = A.plan({ prompt: 'Ramadan reminder', seed: 2 });
    assert.deepStrictEqual(texts(a), texts(b));
    assert.ok(a.scenes[0] !== b.scenes[0] || a.design.title !== b.design.title || b.scenes[0] !== c.scenes[0] || b.design.title !== c.design.title);
});

test('everything it may choose is something the editor has', function () {
    A.TOPICS.forEach(function (t) {
        (t.scenes || []).forEach((n) => assert.ok(O.SCENES[n], t.id + ' scene ' + n));
        if (t.paint) assert.ok(A.CATALOG.PAINTS.includes(t.paint), t.id + ' paint');
        if (t.ambient) assert.ok(S.NATURE[t.ambient], t.id + ' ambient');
        if (t.end) assert.ok(S.EFFECTS[t.end], t.id + ' end sound');
        if (t.verse) assert.ok(A.VERSES[t.verse], t.id + ' verse');
        if (t.hadith) assert.ok(A.HADITH[t.hadith], t.id + ' hadith');
        if (t.writing) assert.ok(S.WRITING[t.writing], t.id + ' writing');
        assert.strictEqual(t.lines.length, t.arLines.length, t.id + ' has the same lines in Arabic');
    });
    Object.values(A.MOODS).forEach(function (m) {
        m.titles.concat([m.body]).forEach((d) => assert.ok(R.DESIGNS[d], 'design ' + d));
        if (m.cut) assert.ok(S.EFFECTS[m.cut], 'cut sound ' + m.cut);
    });
    A.CATALOG.NATURE.forEach((n) => assert.ok(S.NATURE[n], n));
    A.CATALOG.EFFECTS.forEach((n) => assert.ok(S.EFFECTS[n], n));
    A.CATALOG.DESIGNS.forEach((n) => assert.ok(R.DESIGNS[n], n));
    A.CATALOG.PAINTS.forEach((n) => assert.ok(['ink', 'paper', 'spotlight', 'neon', 'film', 'sunny', 'pastel'].includes(n), n));
});

test('a connected model’s plan is kept to what the editor has', function () {
    const base = A.plan({ prompt: 'patience' });
    const c = A.sanitize({ slots: [{ role: 'title', text: 'Hello' }, { role: 'animal', animal: 'dragon', text: 'Roar' }, { role: 'verse', arabic: 'نص', meaning: 'Text', ref: 'Ref' }],
        mood: 'neon', scenes: ['moon-base', 'kaaba'], ambient: 'thunder', animals: ['lion', 'unicorn'], stickers: ['heart', 'bomb'], shape: 'round', seconds: 9999, design: { title: 'neon-pink', body: '<script>' } }, base);
    assert.deepStrictEqual(c.slots.map((s) => s.role), ['title', 'line', 'verse']);
    assert.strictEqual(c.mood, 'neon');
    assert.deepStrictEqual(c.scenes, ['kaaba']);
    assert.strictEqual(c.ambient, base.ambient, 'an unknown sound is ignored');
    assert.deepStrictEqual(c.animals, ['lion']);
    assert.deepStrictEqual(c.stickers, ['heart']);
    assert.strictEqual(c.shape, base.shape);
    assert.strictEqual(c.seconds, base.seconds);
    assert.strictEqual(c.design.title, 'neon-pink');
    assert.strictEqual(c.design.body, base.design.body);
    assert.deepStrictEqual(A.sanitize(null, base), base);
});

test('it can say what it can do, in English and Arabic', function () {
    assert.ok(A.abilities('en').length >= 6);
    assert.ok(A.abilities('ar').every((l) => /[؀-ۿ]/.test(l)));
    assert.ok(A.EXAMPLES.every((e) => e.length === 2));
});
