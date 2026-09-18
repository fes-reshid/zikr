/*
 * The Qur'ān Daily Tracker API.
 *
 * Mounted at diinislaam.com/quran-tracker/api/ — the same origin as the pages,
 * so the session cookie needs no CORS and no third-party cookie. Signing in is
 * entirely optional: the pages work from localStorage alone, and an account
 * only adds carrying the log between devices and being reminded.
 */
import { json, isEmail, isDayKey, isTimeZone, localParts } from './util.js';
import * as db from './db.js';
import { COOKIE, currentUser, requestLogin, completeLogin, sessionCookie, readCookie, requireUser } from './auth.js';
import { sendLoginEmail } from './email.js';
import { juzForDay } from './juz.js';
import { runReminders } from './reminders.js';

function appUrl(env) {
    return env.APP_URL || 'https://diinislaam.com/quran-tracker/';
}

/*
 * Browsers only ever hand out https endpoints, and the Worker will POST to
 * whatever it is given, so anything else is refused — that keeps a signed-in
 * account from aiming it at an internal host. ALLOW_INSECURE_PUSH exists only
 * so the test suite can point it at a local stub; it is not set in production.
 */
function isPushEndpoint(endpoint, env) {
    if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
    if (/^https:\/\//.test(endpoint)) return true;
    return env.ALLOW_INSECURE_PUSH === '1' && /^http:\/\/localhost(:\d+)?\//.test(endpoint);
}

function publicUser(user) {
    return {
        email: user.email,
        name: user.name || null,
        startDate: user.start_date || null,
        timezone: user.timezone,
        remindHour: user.remind_hour,
        emailReminders: !!user.email_opt_in,
        pushReminders: !!user.push_opt_in
    };
}

async function readBody(request) {
    try {
        return await request.json();
    } catch (err) {
        return null;
    }
}

const routes = {
    /* Ask for a sign-in link. */
    'POST /login': async (request, env) => {
        const body = await readBody(request);
        const email = (body && typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
        if (!isEmail(email)) return json({ error: 'a valid email address is required' }, { status: 400 });

        const result = await requestLogin(env, email, appUrl(env));
        if (result.link) {
            await sendLoginEmail(env, { to: email, link: result.link });
        }
        // Same answer either way, so this cannot reveal who has an account.
        return json({ ok: true, message: 'If that address can receive mail, a sign-in link is on its way.' });
    },

    /* Follow the emailed link. */
    'GET /auth': async (request, env) => {
        const token = new URL(request.url).searchParams.get('token');
        const result = token ? await completeLogin(env, token) : null;
        const target = appUrl(env) + (result ? '?signedin=1' : '?signin=expired');

        const headers = { Location: target, 'cache-control': 'no-store' };
        if (result) headers['Set-Cookie'] = sessionCookie(env, result.session, result.maxAge);
        return new Response(null, { status: 302, headers });
    },

    'POST /logout': async (request, env) => {
        await db.deleteSession(env.DB, readCookie(request, COOKIE));
        return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(env, '', 0) } });
    },

    /* Who is signed in, and everything their account holds. */
    'GET /me': async (request, env) => {
        const user = await currentUser(request, env);
        if (!user) return json({ signedIn: false });
        const days = await db.listReadings(env.DB, user.id);
        const today = localParts(new Date(), user.timezone).day;
        return json({
            signedIn: true,
            user: publicUser(user),
            days,
            today,
            juzToday: user.start_date ? juzForDay(user.start_date, today) : null
        });
    },

    'PUT /profile': async (request, env) => {
        const user = await currentUser(request, env);
        const denied = requireUser(user);
        if (denied) return denied;

        const body = await readBody(request) || {};
        const fields = {};

        if (typeof body.name === 'string') fields.name = body.name.trim().slice(0, 40) || null;
        if (body.startDate === null || isDayKey(body.startDate)) fields.start_date = body.startDate;
        if (isTimeZone(body.timezone)) fields.timezone = body.timezone;
        if (Number.isInteger(body.remindHour) && body.remindHour >= 0 && body.remindHour <= 23) {
            fields.remind_hour = body.remindHour;
        }
        if (typeof body.emailReminders === 'boolean') fields.email_opt_in = body.emailReminders ? 1 : 0;
        if (typeof body.pushReminders === 'boolean') fields.push_opt_in = body.pushReminders ? 1 : 0;

        await db.updateProfile(env.DB, user.id, fields);
        return json({ ok: true, user: publicUser(await db.findUserById(env.DB, user.id)) });
    },

    /* Mark or unmark one day. */
    'POST /readings': async (request, env) => {
        const user = await currentUser(request, env);
        const denied = requireUser(user);
        if (denied) return denied;

        const body = await readBody(request) || {};
        if (!isDayKey(body.day)) return json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });

        if (body.read === false) await db.clearReading(env.DB, user.id, body.day);
        else await db.setReading(env.DB, user.id, body.day, Number.isInteger(body.juz) ? body.juz : null);

        return json({ ok: true, days: await db.listReadings(env.DB, user.id) });
    },

    /*
     * Merge days kept on the device into the account. Used once, at first
     * sign-in, so a streak built before signing in is not lost. It only ever
     * adds days — signing in cannot wipe what is already on the account.
     */
    'POST /sync': async (request, env) => {
        const user = await currentUser(request, env);
        const denied = requireUser(user);
        if (denied) return denied;

        const body = await readBody(request) || {};
        const days = Array.isArray(body.days) ? body.days.filter(isDayKey).slice(0, 400) : [];
        for (const day of days) {
            await db.setReading(env.DB, user.id, day, null);
        }
        return json({ ok: true, merged: days.length, days: await db.listReadings(env.DB, user.id) });
    },

    'GET /push/key': async (request, env) =>
        json({ key: env.VAPID_PUBLIC_KEY || null }),

    'POST /push/subscribe': async (request, env) => {
        const user = await currentUser(request, env);
        const denied = requireUser(user);
        if (denied) return denied;

        const body = await readBody(request) || {};
        if (!isPushEndpoint(body.endpoint, env)) {
            return json({ error: 'endpoint required' }, { status: 400 });
        }
        await db.savePushSubscription(env.DB, user.id, body.endpoint);
        return json({ ok: true });
    },

    'POST /push/unsubscribe': async (request, env) => {
        const body = await readBody(request) || {};
        if (typeof body.endpoint === 'string') await db.deletePushSubscription(env.DB, body.endpoint);
        return json({ ok: true });
    },

    /* Leaving takes the data with it; the cascade clears everything else. */
    'DELETE /account': async (request, env) => {
        const user = await currentUser(request, env);
        const denied = requireUser(user);
        if (denied) return denied;
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
        return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(env, '', 0) } });
    }
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const base = (env.APP_PATH || '/quran-tracker/') + 'api';
        const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) || '/' : url.pathname;
        const handler = routes[request.method + ' ' + path];

        if (!handler) return json({ error: 'not found' }, { status: 404 });

        try {
            return await handler(request, env);
        } catch (err) {
            console.error(request.method + ' ' + path, err);
            return json({ error: 'server error' }, { status: 500 });
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)).then((summary) => {
            console.log('reminders', JSON.stringify(summary));
        }));
    }
};
