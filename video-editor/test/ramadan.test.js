'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../ramadan.js');

test('there is one reminder for each of the 30 days, each with a theme, text and reference', function () {
    assert.strictEqual(R.REMINDERS.length, 30);
    R.REMINDERS.forEach(function (r, i) {
        assert.strictEqual(r.length, 3, 'day ' + (i + 1));
        assert.ok(r[0].length > 3 && r[1].length > 20, 'day ' + (i + 1) + ' has words');
        assert.match(r[2], /Qur’an \d+:\d|Sahih|Tirmidhi|Abi Dawud/, 'day ' + (i + 1) + ' cites its source');
    });
    assert.strictEqual(new Set(R.REMINDERS.map((r) => r[0])).size, 30, 'every day has its own theme');
});

test('reminder(n) keeps the day between 1 and 30', function () {
    assert.strictEqual(R.reminder(1).ref, 'Qur’an 2:183');
    assert.strictEqual(R.reminder(0).day, 1);
    assert.strictEqual(R.reminder(45).day, 30);
    assert.strictEqual(R.reminder(5).ref, 'Qur’an 2:186');
});

test('a greeting carries their name and yours', function () {
    const g = R.greetingText('eid-fitr', ' Amina ', 'the Hassan family', '');
    assert.strictEqual(g.title, 'Eid Mubarak, Amina!');
    assert.strictEqual(g.end, 'With love, from the Hassan family');
    assert.match(g.sub, /Taqabbal Allahu/);
    const plain = R.greetingText('ramadan', '', '', 'Our own words');
    assert.strictEqual(plain.title, 'Ramadan Mubarak!');
    assert.strictEqual(plain.sub, 'Our own words');
    assert.strictEqual(plain.end, 'Ramadan Mubarak');
});
