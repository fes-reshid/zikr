const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

test('formatDateKey uses local calendar fields, not UTC', () => {
    // 23:30 local on the 18th must stay the 18th even where UTC has rolled over.
    assert.equal(core.formatDateKey(new Date(2026, 8, 18, 23, 30)), '2026-09-18');
    assert.equal(core.formatDateKey(new Date(2026, 0, 1)), '2026-01-01');
});

test('parseDateKey round-trips at local midnight', () => {
    const d = core.parseDateKey('2026-09-18');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 18);
    assert.equal(d.getHours(), 0);
    assert.equal(core.formatDateKey(d), '2026-09-18');
});

test('parseDateKey rejects junk', () => {
    assert.equal(core.parseDateKey(''), null);
    assert.equal(core.parseDateKey('18/09/2026'), null);
    assert.equal(core.parseDateKey(null), null);
});

test('daysBetween counts whole days in both directions', () => {
    assert.equal(core.daysBetween('2026-09-12', '2026-09-18'), 6);
    assert.equal(core.daysBetween('2026-09-12', '2026-09-12'), 0);
    assert.equal(core.daysBetween('2026-09-12', '2026-09-10'), -2);
});

test('daysBetween survives a DST transition', () => {
    // US DST ends 2026-11-01; a naive ms/86400000 would give 7.04 days here.
    assert.equal(core.daysBetween('2026-10-29', '2026-11-05'), 7);
});

test('juz follows the 30-day cycle from the start date', () => {
    const start = '2026-09-12'; // Rabiʿ II 1, 1448
    assert.equal(core.juzForDate(start, '2026-09-12'), 1);
    assert.equal(core.juzForDate(start, '2026-09-18'), 7);
    assert.equal(core.juzForDate(start, '2026-10-11'), 30);
    assert.equal(core.juzForDate(start, '2026-10-12'), 1); // cycle repeats
    assert.equal(core.juzForDate(start, '2026-10-13'), 2);
});

test('juz wraps backwards for dates before the start', () => {
    const start = '2026-09-12';
    assert.equal(core.juzForDate(start, '2026-09-11'), 30);
    assert.equal(core.juzForDate(start, '2026-09-10'), 29);
});

test('streak counts consecutive days back from today', () => {
    const log = { '2026-09-18': true, '2026-09-17': true, '2026-09-16': true };
    assert.equal(core.calculateStreak(log, '2026-09-18'), 3);
});

test('an unread today does not break the streak yet', () => {
    const log = { '2026-09-17': true, '2026-09-16': true };
    assert.equal(core.calculateStreak(log, '2026-09-18'), 2);
});

test('a missed yesterday resets the streak', () => {
    const log = { '2026-09-16': true, '2026-09-15': true };
    assert.equal(core.calculateStreak(log, '2026-09-18'), 0);
});

test('streak handles an empty or missing log', () => {
    assert.equal(core.calculateStreak({}, '2026-09-18'), 0);
    assert.equal(core.calculateStreak(null, '2026-09-18'), 0);
});

test('falsy log entries are treated as unread', () => {
    const log = { '2026-09-18': false, '2026-09-17': true };
    assert.equal(core.calculateStreak(log, '2026-09-18'), 1);
});

test('hijri conversion matches the Umm al-Qura calendar', () => {
    const parts = core.hijriParts(new Date(2026, 8, 18));
    assert.equal(parts.day, 7);
    assert.equal(parts.month, 4); // Rabiʿ al-Thani
    assert.equal(parts.year, 1448);
    assert.match(core.formatHijri(new Date(2026, 8, 18)), /1448 AH$/);
});

test('cycle start resolves to Rabi II 1 from inside the month', () => {
    assert.equal(core.findCycleStart(new Date(2026, 8, 18)), '2026-09-12');
    assert.equal(core.findCycleStart(new Date(2026, 8, 12)), '2026-09-12');
});

test('cycle start walks back to the previous Rabi II when the month has passed', () => {
    const start = core.findCycleStart(new Date(2027, 2, 1)); // well after Rabiʿ II
    const parts = core.hijriParts(core.parseDateKey(start));
    assert.equal(parts.month, 4);
    assert.equal(parts.day, 1);
    assert.ok(core.parseDateKey(start) <= new Date(2027, 2, 1));
});

test('an auto-derived start makes today the Hijri day of Rabi II', () => {
    const today = new Date(2026, 8, 18);
    const start = core.findCycleStart(today);
    assert.equal(core.juzForDate(start, today), core.hijriParts(today).day);
});
