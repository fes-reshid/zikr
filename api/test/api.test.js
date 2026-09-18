/*
 * Integration test for the API, against a real `wrangler dev` with a local D1.
 *
 * Email and push are pointed at a stub server rather than mocked away, so the
 * real send paths run: the test reads the sign-in link out of the email it
 * actually composed, and verifies the VAPID signature on the push it actually
 * sent, using the public key.
 *
 *   npm test   (in api/)
 */
import { spawn, execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8790;
const STUB_PORT = 8791;
const BASE = `http://localhost:${PORT}/quran-tracker/api`;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Stub for Resend and for the push service -----------------------------
const sent = { emails: [], pushes: [] };
function startStub() {
    return new Promise((resolve) => {
        const server = createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                if (req.url.startsWith('/email')) {
                    sent.emails.push({ auth: req.headers.authorization, body: JSON.parse(body || '{}') });
                    res.writeHead(200, { 'content-type': 'application/json' });
                    return res.end('{"id":"stub"}');
                }
                if (req.url.startsWith('/push')) {
                    sent.pushes.push({ url: req.url, headers: req.headers });
                    res.writeHead(201);
                    return res.end();
                }
                if (req.url.startsWith('/gone')) { res.writeHead(410); return res.end(); }
                res.writeHead(404); res.end();
            });
        });
        server.listen(STUB_PORT, () => resolve(server));
    });
}

// --- Request helper with a one-cookie jar ---------------------------------
let cookie = null;
async function call(method, route, body, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (cookie && !opts.noCookie) headers.cookie = cookie;
    const res = await fetch(BASE + route, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie && !opts.keepCookie) {
        const value = setCookie.split(';')[0];
        cookie = value.endsWith('=') ? null : value;
    }
    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch (e) { payload = text; }
    return { status: res.status, headers: res.headers, body: payload, setCookie };
}

(async () => {
    // Fresh database every run.
    rmSync(path.join(DIR, '.wrangler', 'state'), { recursive: true, force: true });
    execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'quran-tracker',
        '--local', '--file=schema.sql', '--config', 'wrangler.test.toml', '-y'],
        { cwd: DIR, stdio: 'ignore' });

    // A throwaway VAPID pair, so the signature can be verified below.
    const pair = await webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
    const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
    const vapidPublic = b64url(publicRaw);

    writeFileSync(path.join(DIR, '.dev.vars'), [
        'RESEND_API_KEY=test-key',
        `EMAIL_ENDPOINT=http://localhost:${STUB_PORT}/email`,
        `VAPID_PUBLIC_KEY=${vapidPublic}`,
        `VAPID_PRIVATE_JWK=${JSON.stringify({
            kty: privateJwk.kty, crv: privateJwk.crv,
            d: privateJwk.d, x: privateJwk.x, y: privateJwk.y })}`
    ].join('\n') + '\n');

    // A worker left over from an earlier run would answer on this port with its
    // own VAPID keys, and the suite would quietly be testing the wrong process.
    try {
        await fetch(BASE + '/push/key', { signal: AbortSignal.timeout(1500) });
        console.error('Port ' + PORT + ' is already serving. Stop that worker first.');
        process.exit(2);
    } catch (e) { /* nothing listening, which is what we want */ }

    const stub = await startStub();
    // Detached so the whole group can be signalled: wrangler spawns workerd
    // children that a signal to the wrapper alone does not reach, and a
    // survivor holds the port and poisons the next run.
    const worker = spawn('npx', ['--no-install', 'wrangler', 'dev', '--local',
        '--port', String(PORT), '--config', 'wrangler.test.toml', '--test-scheduled'],
        { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const log = [];
    worker.stdout.on('data', (d) => log.push(String(d)));
    worker.stderr.on('data', (d) => log.push(String(d)));

    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        try { process.kill(-worker.pid, 'SIGKILL'); } catch (e) {
            try { worker.kill('SIGKILL'); } catch (e2) { /* already gone */ }
        }
        try { stub.close(); } catch (e) { /* already closed */ }
    };
    process.on('exit', stop);
    process.on('SIGINT', () => { stop(); process.exit(130); });
    process.on('uncaughtException', (err) => { console.error(err); stop(); process.exit(2); });

    // Wait for it to come up.
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
        await sleep(1000);
        try {
            const res = await fetch(BASE + '/push/key');
            up = res.ok;
        } catch (e) { /* not listening yet */ }
    }
    if (!up) {
        console.error('worker did not start:\n' + log.join(''));
        stop();
        process.exit(2);
    }

    // --- Signing in -------------------------------------------------------
    let res = await call('POST', '/login', { email: 'Reader@Example.com ' });
    check('a sign-in link can be requested', res.status === 200 && res.body.ok);
    await sleep(400);
    check('and an email was actually sent', sent.emails.length === 1, sent.emails.length);
    check('with the API key in the header',
        sent.emails[0].auth === 'Bearer test-key', sent.emails[0].auth);
    check('addressed to the normalised address',
        sent.emails[0].body.to[0] === 'reader@example.com', sent.emails[0].body.to[0]);
    check('the email carries a one-time link',
        /api\/auth\?token=/.test(sent.emails[0].body.text));

    const link = sent.emails[0].body.text.match(/(http\S+token=[^\s]+)/)[1];
    const token = new URL(link).searchParams.get('token');

    res = await call('POST', '/login', { email: 'not-an-email' });
    check('a malformed address is refused', res.status === 400, res.status);

    res = await call('GET', '/auth?token=' + encodeURIComponent(token));
    check('following the link signs you in', res.status === 302, res.status);
    check('and sets an HttpOnly, Secure, Lax cookie',
        /HttpOnly/.test(res.setCookie) && /Secure/.test(res.setCookie) &&
        /SameSite=Lax/.test(res.setCookie), res.setCookie);
    check('and sends you back to the app',
        res.headers.get('location').endsWith('/quran-tracker/?signedin=1'),
        res.headers.get('location'));

    res = await call('GET', '/auth?token=' + encodeURIComponent(token), undefined, { keepCookie: true });
    check('the link cannot be used twice',
        res.headers.get('location').includes('signin=expired'), res.headers.get('location'));

    // --- The account ------------------------------------------------------
    res = await call('GET', '/me');
    check('the session identifies the account',
        res.body.signedIn === true && res.body.user.email === 'reader@example.com',
        JSON.stringify(res.body.user));
    check('a new account starts with no reminders possible',
        res.body.user.startDate === null && res.body.juzToday === null);

    res = await call('PUT', '/profile', {
        name: 'Feysel', startDate: '2026-09-12', timezone: 'Africa/Addis_Ababa',
        remindHour: 20, emailReminders: true, pushReminders: true
    });
    check('the profile saves', res.status === 200 && res.body.user.name === 'Feysel',
        JSON.stringify(res.body.user));

    res = await call('GET', '/me');
    check('the name comes back for the header', res.body.user.name === 'Feysel');
    check('and the juz due today is computed server-side',
        typeof res.body.juzToday === 'number' && res.body.juzToday >= 1 && res.body.juzToday <= 30,
        res.body.juzToday);

    res = await call('PUT', '/profile', { timezone: 'Mars/Olympus', remindHour: 99 });
    check('a bogus timezone or hour is ignored, not stored',
        res.body.user.timezone === 'Africa/Addis_Ababa' && res.body.user.remindHour === 20,
        res.body.user.timezone + ' ' + res.body.user.remindHour);

    // --- Readings ---------------------------------------------------------
    res = await call('POST', '/sync', { days: ['2026-09-16', '2026-09-17', 'rubbish', '2026-09-18'] });
    check('days kept on the device merge into the account',
        res.body.merged === 3 && res.body.days.length === 3, JSON.stringify(res.body.days));

    res = await call('POST', '/readings', { day: '2026-09-15', read: true, juz: 4 });
    check('a day can be marked', res.body.days.includes('2026-09-15'));
    res = await call('POST', '/readings', { day: '2026-09-15', read: false });
    check('and unmarked', !res.body.days.includes('2026-09-15'));
    res = await call('POST', '/readings', { day: 'not-a-day', read: true });
    check('a malformed day is refused', res.status === 400);

    // --- Signed out -------------------------------------------------------
    const saved = cookie;
    cookie = null;
    res = await call('GET', '/me');
    check('signed out, /me says so', res.body.signedIn === false);
    res = await call('PUT', '/profile', { name: 'Someone else' });
    check('and the account cannot be changed', res.status === 401, res.status);
    cookie = saved;

    // --- Push -------------------------------------------------------------
    res = await call('GET', '/push/key');
    check('the page can fetch the VAPID public key', res.body.key === vapidPublic);

    const endpoint = `http://localhost:${STUB_PORT}/push/abc123`;
    res = await call('POST', '/push/subscribe', { endpoint });
    check('a push subscription is stored', res.body.ok === true);
    res = await call('POST', '/push/subscribe', { endpoint: 'ftp://nope' });
    check('a non-https endpoint is refused', res.status === 400);

    // --- The nightly reminder --------------------------------------------
    // Line the remind hour up with the user's local hour right now.
    const hourNow = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Addis_Ababa', hour: '2-digit', hour12: false
    }).format(new Date())) % 24;
    await call('PUT', '/profile', { remindHour: hourNow });

    // Today is already marked from the sync above, so nothing should be sent.
    sent.emails.length = 0; sent.pushes.length = 0;
    await fetch(`http://localhost:${PORT}/__scheduled?cron=0+*+*+*+*`);
    await sleep(1200);
    check('someone who has read today is not nudged',
        sent.pushes.length === 0 && sent.emails.length === 0,
        sent.pushes.length + ' push, ' + sent.emails.length + ' email');

    // Clear today, then it should fire.
    const todayRes = await call('GET', '/me');
    const today = todayRes.body.today;
    await call('POST', '/readings', { day: today, read: false });

    sent.emails.length = 0; sent.pushes.length = 0;
    await fetch(`http://localhost:${PORT}/__scheduled?cron=0+*+*+*+*`);
    await sleep(1500);
    check('a missed day sends a push', sent.pushes.length === 1, sent.pushes.length);
    check('and an email', sent.emails.length === 1, sent.emails.length);
    check('the email names the juz and says to listen',
        /Juz \d+/.test(sent.emails[0].body.subject) &&
        /at least listen/i.test(sent.emails[0].body.text),
        sent.emails[0].body.subject);
    check('and links to the reader for that juz',
        /reader\/\?juz=\d+/.test(sent.emails[0].body.text));

    // --- The VAPID signature actually verifies ---------------------------
    const authHeader = sent.pushes[0].headers.authorization || '';
    const jwt = (authHeader.match(/t=([^,]+)/) || [])[1];
    const sentKey = (authHeader.match(/k=([^,\s]+)/) || [])[1];
    check('the push is VAPID-signed', !!jwt && sentKey === vapidPublic, sentKey);

    const [h, p, sig] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    check('the token is aimed at the push service',
        claims.aud === `http://localhost:${STUB_PORT}`, claims.aud);
    check('and expires within 24 hours',
        claims.exp > Math.floor(Date.now() / 1000) &&
        claims.exp < Math.floor(Date.now() / 1000) + 86400);

    const verifyKey = await webcrypto.subtle.importKey('raw', publicRaw,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, verifyKey,
        Buffer.from(sig, 'base64url'), Buffer.from(h + '.' + p));
    check('the signature verifies against the public key', valid);

    // --- Never twice in a day --------------------------------------------
    sent.emails.length = 0; sent.pushes.length = 0;
    await fetch(`http://localhost:${PORT}/__scheduled?cron=0+*+*+*+*`);
    await sleep(1200);
    check('the same day is never nudged twice',
        sent.pushes.length === 0 && sent.emails.length === 0,
        sent.pushes.length + ' push, ' + sent.emails.length + ' email');

    // --- Signing out ------------------------------------------------------
    res = await call('POST', '/logout');
    check('signing out clears the cookie', res.status === 200);
    res = await call('GET', '/me');
    check('and the session is gone', res.body.signedIn === false);

    stop();
    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('api test harness error:', err);
    process.exit(2);
});
