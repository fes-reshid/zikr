/* Every D1 query the Worker makes, in one place. */
import { now, sha256Hex } from './util.js';

export async function findUserByEmail(db, email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function findUserById(db, id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function createUser(db, email) {
    const id = crypto.randomUUID();
    await db.prepare(
        'INSERT INTO users (id, email, timezone, created_at) VALUES (?, ?, ?, ?)'
    ).bind(id, email, 'UTC', now()).run();
    return findUserById(db, id);
}

export async function updateProfile(db, userId, fields) {
    const columns = [];
    const values = [];
    for (const [column, value] of Object.entries(fields)) {
        columns.push(column + ' = ?');
        values.push(value);
    }
    if (!columns.length) return;
    values.push(userId);
    await db.prepare('UPDATE users SET ' + columns.join(', ') + ' WHERE id = ?')
        .bind(...values).run();
}

export async function createLoginToken(db, email, token, ttlSeconds) {
    await db.prepare(
        'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)'
    ).bind(await sha256Hex(token), email, now() + ttlSeconds).run();
}

/** Single-use: the row is marked the moment it is accepted. */
export async function consumeLoginToken(db, token) {
    const hash = await sha256Hex(token);
    const row = await db.prepare(
        'SELECT * FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'
    ).bind(hash, now()).first();
    if (!row) return null;
    await db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?')
        .bind(now(), hash).run();
    return row;
}

export async function countRecentTokens(db, email, sinceSeconds) {
    const row = await db.prepare(
        'SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND expires_at > ?'
    ).bind(email, now() + sinceSeconds).first();
    return row ? row.n : 0;
}

export async function createSession(db, userId, token, ttlSeconds) {
    await db.prepare(
        'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(await sha256Hex(token), userId, now() + ttlSeconds, now()).run();
}

export async function findSessionUser(db, token) {
    if (!token) return null;
    const row = await db.prepare(
        'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id ' +
        'WHERE s.token_hash = ? AND s.expires_at > ?'
    ).bind(await sha256Hex(token), now()).first();
    return row || null;
}

export async function deleteSession(db, token) {
    if (!token) return;
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await sha256Hex(token)).run();
}

export async function listReadings(db, userId) {
    const { results } = await db.prepare(
        'SELECT day FROM readings WHERE user_id = ? ORDER BY day DESC LIMIT 400'
    ).bind(userId).all();
    return (results || []).map((row) => row.day);
}

export async function setReading(db, userId, day, juz) {
    await db.prepare(
        'INSERT INTO readings (user_id, day, juz, read_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(user_id, day) DO UPDATE SET juz = excluded.juz'
    ).bind(userId, day, juz ?? null, now()).run();
}

export async function clearReading(db, userId, day) {
    await db.prepare('DELETE FROM readings WHERE user_id = ? AND day = ?')
        .bind(userId, day).run();
}

export async function hasReading(db, userId, day) {
    const row = await db.prepare(
        'SELECT 1 AS found FROM readings WHERE user_id = ? AND day = ?'
    ).bind(userId, day).first();
    return !!row;
}

export async function savePushSubscription(db, userId, endpoint) {
    await db.prepare(
        'INSERT INTO push_subscriptions (id, user_id, endpoint, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id'
    ).bind(await sha256Hex(endpoint), userId, endpoint, now()).run();
}

export async function deletePushSubscription(db, endpoint) {
    await db.prepare('DELETE FROM push_subscriptions WHERE id = ?')
        .bind(await sha256Hex(endpoint)).run();
}

export async function listPushSubscriptions(db, userId) {
    const { results } = await db.prepare(
        'SELECT endpoint FROM push_subscriptions WHERE user_id = ?'
    ).bind(userId).all();
    return (results || []).map((row) => row.endpoint);
}

export async function listRemindableUsers(db) {
    const { results } = await db.prepare(
        'SELECT * FROM users WHERE email_opt_in = 1 OR push_opt_in = 1'
    ).all();
    return results || [];
}

/** Returns false when a reminder for that day was already recorded. */
export async function claimReminder(db, userId, day, channels) {
    try {
        const result = await db.prepare(
            'INSERT INTO reminders_sent (user_id, day, sent_at, channels) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(user_id, day) DO NOTHING'
        ).bind(userId, day, now(), channels).run();
        return (result.meta && result.meta.changes) > 0;
    } catch (err) {
        return false;
    }
}

export async function purgeExpired(db) {
    await db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now()).run();
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
}
