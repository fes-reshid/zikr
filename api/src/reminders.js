/*
 * The nightly nudge.
 *
 * Push only. The accounts this shares with the quest games have no real email
 * address — every one maps to a synthetic +tag address on the admin's own
 * inbox — so emailing "the user" would in fact email the admin, once per
 * person per day. A notification reaches the actual person; an email would not.
 *
 * The cron runs hourly rather than once a day because "20:00" has to mean
 * 20:00 where the person is.
 */
import { localParts } from './util.js';
import { juzForDay } from './juz.js';
import * as db from './db.js';
import { sendPush } from './push.js';

export async function runReminders(env, at = new Date()) {
    const people = await db.listRemindable(env.DB);
    const summary = { considered: people.length, due: 0, pushed: 0, dropped: 0, skipped: 0 };

    for (const person of people) {
        const local = localParts(at, person.timezone);
        if (local.hour !== person.remind_hour) continue;
        if (await db.hasReading(env.DB, person.uid, local.day)) { summary.skipped++; continue; }

        summary.due++;

        // Claimed before sending, so an overlapping run cannot nudge twice.
        if (!await db.claimReminder(env.DB, person.uid, local.day)) { summary.skipped++; continue; }

        const endpoints = await db.listPushSubscriptions(env.DB, person.uid);
        for (const endpoint of endpoints) {
            const result = await sendPush(env, endpoint);
            if (result.ok) summary.pushed++;
            // The browser has dropped it; stop trying that endpoint.
            if (result.gone) {
                await db.deletePushSubscription(env.DB, endpoint);
                summary.dropped++;
            }
        }
        // juz is computed for the log only; the page fills the wording in.
        void juzForDay(person.start_date, local.day);
    }

    await db.purgeOldReminders(env.DB);
    return summary;
}
