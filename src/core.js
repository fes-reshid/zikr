/*
 * Pure date / tracking logic for the Quran daily tracker.
 *
 * Kept free of DOM access so it can be loaded as a classic script in the
 * browser (window.QuranCore) and required directly from the Node tests.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.QuranCore = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var JUZ_IN_CYCLE = 30;
    var RABI_AL_THANI = 4; // 4th month of the Hijri year
    var HIJRI_LOCALE = 'en-US-u-ca-islamic-umalqura';

    /** Local-midnight copy of a date, so day maths never straddles a DST shift. */
    function startOfDay(date) {
        var d = new Date(date.getTime());
        d.setHours(0, 0, 0, 0);
        return d;
    }

    /** YYYY-MM-DD in the *local* timezone (never the UTC date). */
    function formatDateKey(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    /**
     * Parse YYYY-MM-DD as local midnight. `new Date('2026-09-18')` is parsed as
     * UTC, which lands on the previous day for anyone west of Greenwich.
     */
    function parseDateKey(key) {
        var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '').trim());
        if (!parts) return null;
        var date = new Date(
            Number(parts[1]),
            Number(parts[2]) - 1,
            Number(parts[3])
        );
        return isNaN(date.getTime()) ? null : startOfDay(date);
    }

    function toDate(value) {
        if (value instanceof Date) return startOfDay(value);
        return parseDateKey(value);
    }

    /** Whole days from `start` to `target`. Negative when target precedes start. */
    function daysBetween(start, target) {
        var a = toDate(start);
        var b = toDate(target);
        if (!a || !b) return null;
        return Math.round((b.getTime() - a.getTime()) / 86400000);
    }

    /**
     * Position in the 30-day cycle (1..30). Dates before the start date wrap
     * backwards rather than clamping, so recent history stays truthful.
     */
    function cycleDay(startDate, targetDate) {
        var diff = daysBetween(startDate, targetDate);
        if (diff === null) return null;
        return ((diff % JUZ_IN_CYCLE) + JUZ_IN_CYCLE) % JUZ_IN_CYCLE + 1;
    }

    /** Juz due on a given date. Juz 1 falls on the cycle start (Rabiʿ II 1). */
    function juzForDate(startDate, targetDate) {
        return cycleDay(startDate, targetDate);
    }

    /**
     * Consecutive days read, counting back from today. Today being unread does
     * not break the streak until the day is over.
     */
    function calculateStreak(log, today) {
        var readingLog = log || {};
        var cursor = toDate(today || new Date());
        if (!cursor) return 0;

        var todayKey = formatDateKey(cursor);
        if (!readingLog[todayKey]) {
            cursor.setDate(cursor.getDate() - 1);
        }

        var streak = 0;
        // Bounded so a corrupt log can never spin forever.
        for (var i = 0; i < 366 * 10; i++) {
            if (!readingLog[formatDateKey(cursor)]) break;
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
    }

    /** Hijri (Umm al-Qura) breakdown of a Gregorian date, or null if unsupported. */
    function hijriParts(date) {
        try {
            var formatter = new Intl.DateTimeFormat(HIJRI_LOCALE, {
                day: 'numeric',
                month: 'numeric',
                year: 'numeric'
            });
            var nameFormatter = new Intl.DateTimeFormat(HIJRI_LOCALE, {
                month: 'long'
            });
            var result = { day: null, month: null, year: null, monthName: null };
            formatter.formatToParts(date).forEach(function (part) {
                if (part.type === 'day') result.day = parseInt(part.value, 10);
                if (part.type === 'month') result.month = parseInt(part.value, 10);
                if (part.type === 'year') result.year = parseInt(part.value, 10);
            });
            nameFormatter.formatToParts(date).forEach(function (part) {
                if (part.type === 'month') result.monthName = part.value;
            });
            if (!result.day || !result.month || !result.year) return null;
            return result;
        } catch (err) {
            return null;
        }
    }

    /** e.g. "Rabiʻ II 7, 1448 AH" — empty string when Intl lacks the calendar. */
    function formatHijri(date) {
        var parts = hijriParts(date);
        if (!parts) return '';
        return parts.monthName + ' ' + parts.day + ', ' + parts.year + ' AH';
    }

    /**
     * Gregorian date key for the most recent Rabiʿ II 1 on or before `from`,
     * which is the anchor the tracker counts Juz 1 from. Returns null when the
     * runtime has no Islamic calendar to search.
     */
    function findCycleStart(from) {
        var cursor = startOfDay(from ? new Date(from) : new Date());
        var parts = hijriParts(cursor);
        if (!parts) return null;

        // Inside Rabiʿ II already: step straight back to day 1.
        if (parts.month === RABI_AL_THANI) {
            cursor.setDate(cursor.getDate() - (parts.day - 1));
            return formatDateKey(cursor);
        }

        // Otherwise walk back to the last day-1 of Rabiʿ II (< 1 Hijri year).
        for (var i = 0; i < 400; i++) {
            cursor.setDate(cursor.getDate() - 1);
            var step = hijriParts(cursor);
            if (!step) return null;
            if (step.month === RABI_AL_THANI && step.day === 1) {
                return formatDateKey(cursor);
            }
        }
        return null;
    }

    return {
        JUZ_IN_CYCLE: JUZ_IN_CYCLE,
        startOfDay: startOfDay,
        formatDateKey: formatDateKey,
        parseDateKey: parseDateKey,
        daysBetween: daysBetween,
        cycleDay: cycleDay,
        juzForDate: juzForDate,
        calculateStreak: calculateStreak,
        hijriParts: hijriParts,
        formatHijri: formatHijri,
        findCycleStart: findCycleStart
    };
});
