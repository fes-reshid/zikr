/*
 * The nightly nudge.
 *
 * The cron runs hourly rather than once a day because "20:00" has to mean
 * 20:00 where the person is. Each run picks out the people whose local clock
 * has just reached their chosen hour.
 */
import { localParts } from './util.js';
import { juzForDay } from './juz.js';
import * as db from './db.js';
import { sendPush } from './push.js';
import { sendReminderEmail } from './email.js';

export async function runReminders(env, at = new Date()) {
    const appUrl = env.APP_URL || 'https://diinislaam.com/quran-tracker/';
    const users = await db.listRemindableUsers(env.DB);
    const summary = { considered: users.length, due: 0, pushed: 0, emailed: 0, skipped: 0 };

    for (const user of users) {
        const local = localParts(at, user.timezone);
        if (local.hour !== user.remind_hour) continue;
        if (!user.start_date) { summary.skipped++; continue; }
        if (await db.hasReading(env.DB, user.id, local.day)) { summary.skipped++; continue; }

        summary.due++;

        // Claimed before sending, so an overlapping run cannot nudge twice.
        const channels = [user.push_opt_in ? 'push' : null, user.email_opt_in ? 'email' : null]
            .filter(Boolean).join(',');
        if (!channels) { summary.skipped++; continue; }
        if (!await db.claimReminder(env.DB, user.id, local.day, channels)) {
            summary.skipped++;
            continue;
        }

        const juz = juzForDay(user.start_date, local.day);

        if (user.push_opt_in) {
            for (const endpoint of await db.listPushSubscriptions(env.DB, user.id)) {
                const result = await sendPush(env, endpoint);
                if (result.ok) summary.pushed++;
                // The browser has dropped it; stop trying that endpoint.
                if (result.gone) await db.deletePushSubscription(env.DB, endpoint);
            }
        }

        if (user.email_opt_in) {
            const result = await sendReminderEmail(env, {
                to: user.email,
                name: user.name,
                juz,
                readerUrl: appUrl + 'reader/?juz=' + juz
            });
            if (result.ok) summary.emailed++;
        }
    }

    await db.purgeExpired(env.DB);
    return summary;
}
