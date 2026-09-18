/*
 * The Qur'ān Daily Tracker reminder API.
 *
 * Mounted at diinislaam.com/quran-tracker/api/. It exists for one reason: a
 * notification has to be sent while nobody has the page open, and that needs
 * something running on a schedule.
 *
 * It is deliberately ignorant. Accounts belong to Firebase, shared with the
 * quest games, so this Worker never sees a password, issues no session of its
 * own, and stores no email, username or name — only the opaque Firebase uid,
 * which day was read, and where to send a push.
 *
 * The reading log people see is synced through Firestore by the page, next to
 * the other apps' progress. What is mirrored here is only what the scheduled
 * job must be able to read with no browser present.
 */
import { json, isDayKey, isTimeZone, localParts } from './util.js';
import * as db from './db.js';
import { verifyClaims, bearerToken } from './firebase.js';
import { isAdmin } from './admins.js';
import { juzForDay } from './juz.js';
import { runReminders } from './reminders.js';

function isPushEndpoint(endpoint, env) {
    if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
    if (/^https:\/\//.test(endpoint)) return true;
    // Test-only, so the suite can point push at a local stub.
    return env.ALLOW_INSECURE_PUSH === '1' && /^http:\/\/localhost(:\d+)?\//.test(endpoint);
}

function publicSettings(row) {
    return {
        startDate: (row && row.start_date) || null,
        timezone: (row && row.timezone) || 'UTC',
        remindHour: row ? row.remind_hour : 20,
        pushReminders: row ? !!row.push_opt_in : true
    };
}

async function readBody(request) {
    try { return await request.json(); } catch (err) { return null; }
}

const routes = {
    /* What the scheduled job knows about the signed-in person. */
    'GET /me': async (request, env, uid) => {
        const settings = await db.getSettings(env.DB, uid);
        const today = localParts(new Date(), settings && settings.timezone).day;
        return json({
            settings: publicSettings(settings),
            days: await db.listReadings(env.DB, uid),
            today: today,
            juzToday: settings && settings.start_date
                ? juzForDay(settings.start_date, today) : null
        });
    },

    'PUT /settings': async (request, env, uid) => {
        const body = await readBody(request) || {};
        const fields = {};

        if (body.startDate === null || isDayKey(body.startDate)) fields.start_date = body.startDate;
        if (isTimeZone(body.timezone)) fields.timezone = body.timezone;
        if (Number.isInteger(body.remindHour) && body.remindHour >= 0 && body.remindHour <= 23) {
            fields.remind_hour = body.remindHour;
        }
        if (typeof body.pushReminders === 'boolean') fields.push_opt_in = body.pushReminders ? 1 : 0;

        const saved = await db.saveSettings(env.DB, uid, fields);
        return json({ ok: true, settings: publicSettings(saved) });
    },

    'POST /readings': async (request, env, uid) => {
        const body = await readBody(request) || {};
        if (!isDayKey(body.day)) return json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });

        if (body.read === false) await db.clearReading(env.DB, uid, body.day);
        else await db.setReading(env.DB, uid, body.day);

        return json({ ok: true, days: await db.listReadings(env.DB, uid) });
    },

    /* Days already on the device, merged up. Only ever adds. */
    'POST /sync': async (request, env, uid) => {
        const body = await readBody(request) || {};
        const days = Array.isArray(body.days) ? body.days.filter(isDayKey).slice(0, 400) : [];
        for (const day of days) await db.setReading(env.DB, uid, day);
        return json({ ok: true, merged: days.length, days: await db.listReadings(env.DB, uid) });
    },

    'POST /push/subscribe': async (request, env, uid) => {
        const body = await readBody(request) || {};
        if (!isPushEndpoint(body.endpoint, env)) {
            return json({ error: 'endpoint required' }, { status: 400 });
        }
        await db.savePushSubscription(env.DB, uid, body.endpoint);
        return json({ ok: true });
    },

    'POST /push/unsubscribe': async (request, env, uid) => {
        const body = await readBody(request) || {};
        if (typeof body.endpoint === 'string') await db.deletePushSubscription(env.DB, body.endpoint);
        return json({ ok: true });
    },

    /*
     * Every day read across everyone, for the admin report. Only user ids are
     * returned: the names belong to Firestore, and the admin page joins them
     * there, so no name ever needs to be stored on this side.
     */
    'GET /admin/report': async (request, env, uid, claims, token) => {
        if (!await isAdmin(env, claims, token)) {
            return json({ error: 'not an admin' }, { status: 403 });
        }

        const params = new URL(request.url).searchParams;
        const to = isDayKey(params.get('to')) ? params.get('to')
            : localParts(new Date(), 'UTC').day;
        let from = isDayKey(params.get('from')) ? params.get('from') : to;
        if (from > to) from = to;

        // Bounded, so one request cannot ask for the entire history.
        const days = [];
        const cursor = new Date(from + 'T00:00:00Z');
        const end = new Date(to + 'T00:00:00Z');
        while (cursor <= end && days.length < 92) {
            days.push(cursor.toISOString().slice(0, 10));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        const last = days[days.length - 1] || to;

        const { results } = await env.DB.prepare(
            'SELECT uid, day FROM readings WHERE day >= ? AND day <= ?'
        ).bind(from, last).all();

        const readings = {};
        (results || []).forEach((row) => {
            (readings[row.uid] = readings[row.uid] || []).push(row.day);
        });

        return json({ from: days[0] || to, to: last, days, readings });
    },

    /* Everything this Worker holds about them, gone. */
    'DELETE /me': async (request, env, uid) => {
        await db.forgetUser(env.DB, uid);
        return json({ ok: true });
    }
};

// The only route that needs no account.
const openRoutes = {
    'GET /push/key': async (request, env) => json({ key: env.VAPID_PUBLIC_KEY || null })
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const base = (env.APP_PATH || '/quran-tracker/') + 'api';
        const path = url.pathname.startsWith(base)
            ? url.pathname.slice(base.length) || '/'
            : url.pathname;
        const key = request.method + ' ' + path;

        if (openRoutes[key]) {
            try {
                return await openRoutes[key](request, env);
            } catch (err) {
                console.error(key, err);
                return json({ error: 'server error' }, { status: 500 });
            }
        }

        const handler = routes[key];
        if (!handler) return json({ error: 'not found' }, { status: 404 });

        // FIREBASE_JWKS_URL is unset in production, so Google's own endpoint
        // is used; the test suite points it at a stub to mint its own tokens.
        const token = bearerToken(request);
        const claims = await verifyClaims(token, env.FIREBASE_PROJECT_ID,
            { jwksUrl: env.FIREBASE_JWKS_URL });
        if (!claims) return json({ error: 'not signed in' }, { status: 401 });

        try {
            return await handler(request, env, claims.sub, claims, token);
        } catch (err) {
            console.error(key, err);
            return json({ error: 'server error' }, { status: 500 });
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)).then((summary) => {
            console.log('reminders', JSON.stringify(summary));
        }));
    }
};
