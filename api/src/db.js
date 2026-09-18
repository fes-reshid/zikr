/* Every D1 query the Worker makes, in one place. Keyed on the Firebase uid. */
import { now, sha256Hex } from './util.js';

export async function getSettings(db, uid) {
    return db.prepare('SELECT * FROM reminder_settings WHERE uid = ?').bind(uid).first();
}

export async function saveSettings(db, uid, fields) {
    const existing = await getSettings(db, uid);
    if (!existing) {
        await db.prepare(
            'INSERT INTO reminder_settings (uid, timezone, updated_at) VALUES (?, ?, ?)'
        ).bind(uid, 'UTC', now()).run();
    }
    const columns = [];
    const values = [];
    for (const [column, value] of Object.entries(fields)) {
        columns.push(column + ' = ?');
        values.push(value);
    }
    columns.push('updated_at = ?');
    values.push(now(), uid);
    await db.prepare('UPDATE reminder_settings SET ' + columns.join(', ') + ' WHERE uid = ?')
        .bind(...values).run();
    return getSettings(db, uid);
}

export async function listReadings(db, uid) {
    const { results } = await db.prepare(
        'SELECT day FROM readings WHERE uid = ? ORDER BY day DESC LIMIT 400'
    ).bind(uid).all();
    return (results || []).map((row) => row.day);
}

export async function setReading(db, uid, day) {
    await db.prepare(
        'INSERT INTO readings (uid, day, read_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(uid, day) DO NOTHING'
    ).bind(uid, day, now()).run();
}

export async function clearReading(db, uid, day) {
    await db.prepare('DELETE FROM readings WHERE uid = ? AND day = ?').bind(uid, day).run();
}

export async function hasReading(db, uid, day) {
    const row = await db.prepare('SELECT 1 AS found FROM readings WHERE uid = ? AND day = ?')
        .bind(uid, day).first();
    return !!row;
}

export async function savePushSubscription(db, uid, endpoint) {
    await db.prepare(
        'INSERT INTO push_subscriptions (id, uid, endpoint, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET uid = excluded.uid'
    ).bind(await sha256Hex(endpoint), uid, endpoint, now()).run();
}

export async function deletePushSubscription(db, endpoint) {
    await db.prepare('DELETE FROM push_subscriptions WHERE id = ?')
        .bind(await sha256Hex(endpoint)).run();
}

export async function listPushSubscriptions(db, uid) {
    const { results } = await db.prepare(
        'SELECT endpoint FROM push_subscriptions WHERE uid = ?'
    ).bind(uid).all();
    return (results || []).map((row) => row.endpoint);
}

/** Only people who could actually be nudged: opted in, and with a cycle set. */
export async function listRemindable(db) {
    const { results } = await db.prepare(
        'SELECT * FROM reminder_settings WHERE push_opt_in = 1 AND start_date IS NOT NULL'
    ).all();
    return results || [];
}

/** Returns false when a reminder for that day was already recorded. */
export async function claimReminder(db, uid, day) {
    try {
        const result = await db.prepare(
            'INSERT INTO reminders_sent (uid, day, sent_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT(uid, day) DO NOTHING'
        ).bind(uid, day, now()).run();
        return (result.meta && result.meta.changes) > 0;
    } catch (err) {
        return false;
    }
}

export async function forgetUser(db, uid) {
    await db.batch([
        db.prepare('DELETE FROM readings WHERE uid = ?').bind(uid),
        db.prepare('DELETE FROM push_subscriptions WHERE uid = ?').bind(uid),
        db.prepare('DELETE FROM reminders_sent WHERE uid = ?').bind(uid),
        db.prepare('DELETE FROM reminder_settings WHERE uid = ?').bind(uid)
    ]);
}

export async function purgeOldReminders(db) {
    // Nothing here is needed for longer than the streak window.
    await db.prepare("DELETE FROM reminders_sent WHERE sent_at < ?")
        .bind(now() - 90 * 24 * 3600).run();
}
