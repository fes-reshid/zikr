/*
 * The juz due on a given day.
 *
 * This is the one piece of the page's logic the server also needs, so a
 * reminder can name the juz. Both dates are plain YYYY-MM-DD, so they are
 * compared in UTC and no timezone enters into it. A test checks this agrees
 * with src/core.js in the parent repo, which is where the page's copy lives.
 */
export const JUZ_IN_CYCLE = 30;

function toUtcDays(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
}

export function juzForDay(startDay, day) {
    const start = toUtcDays(startDay);
    const target = toUtcDays(day);
    if (start === null || target === null) return null;
    const diff = Math.round(target - start);
    return ((diff % JUZ_IN_CYCLE) + JUZ_IN_CYCLE) % JUZ_IN_CYCLE + 1;
}
