/* Sign-in by emailed link, and the session cookie it produces. */
import { randomToken, json } from './util.js';
import * as db from './db.js';

export const COOKIE = 'qt_session';
const SESSION_TTL = 90 * 24 * 60 * 60;  // 90 days
const LOGIN_TTL = 15 * 60;              // the emailed link
const MAX_PENDING_LINKS = 5;            // per address, while unexpired

function cookiePath(env) {
    return env.APP_PATH || '/quran-tracker/';
}

export function readCookie(request, name) {
    const header = request.headers.get('cookie') || '';
    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
}

export function sessionCookie(env, token, maxAge) {
    // Lax so the cookie is sent when the emailed link is followed; HttpOnly so
    // page scripts can never read it.
    return [
        COOKIE + '=' + encodeURIComponent(token),
        'Path=' + cookiePath(env),
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Max-Age=' + maxAge
    ].join('; ');
}

export function currentUser(request, env) {
    return db.findSessionUser(env.DB, readCookie(request, COOKIE));
}

/**
 * Always answers the same way, whether or not the address has an account, so
 * the endpoint cannot be used to find out who is registered.
 */
export async function requestLogin(env, email, appUrl) {
    const pending = await db.countRecentTokens(env.DB, email, 0);
    if (pending >= MAX_PENDING_LINKS) {
        return { throttled: true };
    }
    const token = randomToken();
    await db.createLoginToken(env.DB, email, token, LOGIN_TTL);
    return {
        token,
        link: appUrl + 'api/auth?token=' + encodeURIComponent(token)
    };
}

export async function completeLogin(env, token) {
    const row = await db.consumeLoginToken(env.DB, token);
    if (!row) return null;

    let user = await db.findUserByEmail(env.DB, row.email);
    if (!user) user = await db.createUser(env.DB, row.email);

    const session = randomToken();
    await db.createSession(env.DB, user.id, session, SESSION_TTL);
    return { user, session, maxAge: SESSION_TTL };
}

export function requireUser(user) {
    if (user) return null;
    return json({ error: 'not signed in' }, { status: 401 });
}
