/*
 * Integration test for the reminder API, against a real `wrangler dev` with a
 * local D1.
 *
 * The suite mints its own Firebase-shaped ID tokens and serves the matching
 * public key from a stub, so the Worker's real verification path runs — and
 * the rejection cases (wrong project, expired, unsigned, tampered) are tested
 * against the same code that guards production. Push goes to the same stub, so
 * the VAPID signature it actually sends can be verified.
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
const PROJECT = 'diinislaam-8fdeb';

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

const b64url = (input) => Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- A stand-in for Google's signing keys, and for the push service --------
let jwks = { keys: [] };
const pushes = [];
const admins = new Set(['teacher@diinislaam.com']);

function startStub() {
    return new Promise((resolve) => {
        const server = createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                if (req.url.startsWith('/jwks')) {
                    res.writeHead(200, {
                        'content-type': 'application/json', 'cache-control': 'max-age=3600'
                    });
                    return res.end(JSON.stringify(jwks));
                }
                if (req.url.startsWith('/push')) {
                    pushes.push({ url: req.url, headers: req.headers });
                    res.writeHead(201); return res.end();
                }
                if (req.url.startsWith('/firestore/')) {
                    // Only the roster's own documents exist.
                    const email = decodeURIComponent(req.url.split('/').pop());
                    if (!/^Bearer .+/.test(req.headers.authorization || '')) {
                        res.writeHead(401); return res.end();
                    }
                    if (admins.has(email)) {
                        res.writeHead(200, { 'content-type': 'application/json' });
                        return res.end(JSON.stringify({ fields: { role: { stringValue: 'admin' } } }));
                    }
                    res.writeHead(404); return res.end();
                }
                res.writeHead(404); res.end();
            });
        });
        server.listen(STUB_PORT, () => resolve(server));
    });
}

// --- Token minting --------------------------------------------------------
let signingKey = null;
const KID = 'test-key-1';

async function setUpKeys() {
    const pair = await webcrypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']);
    signingKey = pair.privateKey;
    const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
    jwks = { keys: [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] };
}

async function mintToken(overrides = {}, opts = {}) {
    const seconds = Math.floor(Date.now() / 1000);
    const header = { alg: opts.alg || 'RS256', kid: opts.kid === null ? undefined : (opts.kid || KID), typ: 'JWT' };
    const claims = {
        sub: 'uid-feysel', aud: PROJECT,
        iss: 'https://securetoken.google.com/' + PROJECT,
        iat: seconds - 60, exp: seconds + 3600, ...overrides
    };
    const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
    const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey,
        Buffer.from(unsigned));
    return unsigned + '.' + b64url(Buffer.from(signature));
}

let token = null;
async function call(method, route, body, opts = {}) {
    const headers = {};
    const bearer = opts.token === null ? null : (opts.token || token);
    if (bearer) headers.authorization = 'Bearer ' + bearer;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + route, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch (e) { payload = text; }
    return { status: res.status, body: payload };
}

(async () => {
    rmSync(path.join(DIR, '.wrangler', 'state'), { recursive: true, force: true });
    execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'quran-tracker',
        '--local', '--file=schema.sql', '--config', 'wrangler.test.toml', '-y'],
        { cwd: DIR, stdio: 'ignore' });

    await setUpKeys();

    const vapid = await webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const vapidPublicRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', vapid.publicKey));
    const vapidJwk = await webcrypto.subtle.exportKey('jwk', vapid.privateKey);
    const vapidPublic = b64url(vapidPublicRaw);

    writeFileSync(path.join(DIR, '.dev.vars'), [
        `VAPID_PUBLIC_KEY=${vapidPublic}`,
        `VAPID_PRIVATE_JWK=${JSON.stringify({ kty: vapidJwk.kty, crv: vapidJwk.crv,
            d: vapidJwk.d, x: vapidJwk.x, y: vapidJwk.y })}`
    ].join('\n') + '\n');

    try {
        await fetch(BASE + '/push/key', { signal: AbortSignal.timeout(1500) });
        console.error('Port ' + PORT + ' is already serving. Stop that worker first.');
        process.exit(2);
    } catch (e) { /* nothing listening, good */ }

    const stub = await startStub();
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
            try { worker.kill('SIGKILL'); } catch (e2) { /* gone */ }
        }
        try { stub.close(); } catch (e) { /* closed */ }
    };
    process.on('exit', stop);
    process.on('SIGINT', () => { stop(); process.exit(130); });
    process.on('uncaughtException', (err) => { console.error(err); stop(); process.exit(2); });

    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
        await sleep(1000);
        try { up = (await fetch(BASE + '/push/key')).ok; } catch (e) { /* starting */ }
    }
    if (!up) { console.error('worker did not start:\n' + log.join('')); stop(); process.exit(2); }

    // --- What the API refuses --------------------------------------------
    let res = await call('GET', '/me', undefined, { token: null });
    check('no token means no access', res.status === 401, res.status);

    res = await call('GET', '/me', undefined, { token: 'not.a.token' });
    check('a malformed token is refused', res.status === 401, res.status);

    res = await call('GET', '/me', undefined,
        { token: await mintToken({ aud: 'someone-elses-project' }) });
    check("another project's token is refused", res.status === 401, res.status);

    res = await call('GET', '/me', undefined,
        { token: await mintToken({ iss: 'https://evil.example/' + PROJECT }) });
    check('a wrong issuer is refused', res.status === 401, res.status);

    res = await call('GET', '/me', undefined,
        { token: await mintToken({ exp: Math.floor(Date.now() / 1000) - 10 }) });
    check('an expired token is refused', res.status === 401, res.status);

    const tampered = (await mintToken()).split('.');
    tampered[1] = b64url(JSON.stringify({ sub: 'someone-else', aud: PROJECT,
        iss: 'https://securetoken.google.com/' + PROJECT,
        exp: Math.floor(Date.now() / 1000) + 3600 }));
    res = await call('GET', '/me', undefined, { token: tampered.join('.') });
    check('a tampered payload is refused', res.status === 401, res.status);

    res = await call('GET', '/me', undefined,
        { token: await mintToken({}, { kid: 'unknown-kid' }) });
    check('an unknown signing key is refused', res.status === 401, res.status);

    // --- A real session ---------------------------------------------------
    token = await mintToken();
    res = await call('GET', '/me');
    check('a valid Firebase token is accepted', res.status === 200, res.status);
    check('and starts with nothing recorded',
        res.body.settings.startDate === null && res.body.days.length === 0,
        JSON.stringify(res.body.settings));

    res = await call('PUT', '/settings', {
        startDate: '2026-09-12', timezone: 'Africa/Addis_Ababa',
        remindHour: 20, pushReminders: true
    });
    check('reminder settings save',
        res.body.settings.startDate === '2026-09-12' &&
        res.body.settings.timezone === 'Africa/Addis_Ababa',
        JSON.stringify(res.body.settings));

    res = await call('PUT', '/settings', { timezone: 'Mars/Olympus', remindHour: 99 });
    check('a bogus timezone or hour is ignored',
        res.body.settings.timezone === 'Africa/Addis_Ababa' && res.body.settings.remindHour === 20);

    res = await call('GET', '/me');
    check('the juz due today is computed from the cycle',
        typeof res.body.juzToday === 'number' && res.body.juzToday >= 1 && res.body.juzToday <= 30,
        res.body.juzToday);

    // --- The reading log --------------------------------------------------
    res = await call('POST', '/sync', { days: ['2026-09-16', '2026-09-17', 'rubbish'] });
    check('days from the device merge up', res.body.merged === 2 && res.body.days.length === 2,
        JSON.stringify(res.body.days));
    res = await call('POST', '/readings', { day: '2026-09-15', read: true });
    check('a day can be marked', res.body.days.includes('2026-09-15'));
    res = await call('POST', '/readings', { day: '2026-09-15', read: false });
    check('and unmarked', !res.body.days.includes('2026-09-15'));
    res = await call('POST', '/readings', { day: 'not-a-day', read: true });
    check('a malformed day is refused', res.status === 400);

    // --- One account cannot touch another --------------------------------
    const otherToken = await mintToken({ sub: 'uid-someone-else' });
    res = await call('GET', '/me', undefined, { token: otherToken });
    check('a different account sees its own empty log',
        res.body.days.length === 0, JSON.stringify(res.body.days));

    // --- Push -------------------------------------------------------------
    res = await call('GET', '/push/key', undefined, { token: null });
    check('the push key is readable without signing in', res.body.key === vapidPublic);

    const endpoint = `http://localhost:${STUB_PORT}/push/abc123`;
    res = await call('POST', '/push/subscribe', { endpoint });
    check('a push subscription is stored', res.body.ok === true);
    res = await call('POST', '/push/subscribe', { endpoint: 'ftp://nope' });
    check('a non-https endpoint is refused', res.status === 400);

    // --- The nightly nudge ------------------------------------------------
    const hourNow = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Addis_Ababa', hour: '2-digit', hour12: false
    }).format(new Date())) % 24;
    await call('PUT', '/settings', { remindHour: hourNow });

    const today = (await call('GET', '/me')).body.today;
    await call('POST', '/readings', { day: today, read: true });
    pushes.length = 0;
    await fetch(`http://localhost:${PORT}/__scheduled?cron=0+*+*+*+*`);
    await sleep(1200);
    check('someone who has read today is not nudged', pushes.length === 0, pushes.length);

    await call('POST', '/readings', { day: today, read: false });
    pushes.length = 0;
    await fetch(`http://localhost:${PORT}/__scheduled?cron=0+*+*+*+*`);
    await sleep(1500);
    check('a missed day sends a push', pushes.length === 1, pushes.length);

    const authHeader = pushes[0].headers.authorization || '';
    const jwt = (authHeader.match(/t=([^,]+)/) || [])[1];
    const sentKey = (authHeader.match(/k=([^,\s]+)/) || [])[1];
    check('the push is VAPID-signed', !!jwt && sentKey === vapidPublic, sentKey);

    const [h, p, sig] = jwt.split('.');
    const vapidClaims = JSON.parse(Buffer.from(p, 'base64url').toString());
    check('aimed at the push service', vapidClaims.aud === `http://localhost:${STUB_PORT}`);
    const verifyKey = await webcrypto.subtle.importKey('raw', vapidPublicRaw,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    check('and its signature verifies', await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, verifyKey,
        Buffer.from(sig, 'base64url'), Buffer.from(h + '.' + p)));

    pushes.length = 0;
    await fetch(`http://localhost:${PORT}/__scheduled?cron=0+*+*+*+*`);
    await sleep(1200);
    check('the same day is never nudged twice', pushes.length === 0, pushes.length);

    // --- The admin report -------------------------------------------------
    // Put two people's readings in, from two different accounts.
    token = await mintToken({ sub: 'uid-amina' });
    await call('PUT', '/settings', { startDate: '2026-09-12', timezone: 'UTC' });
    await call('POST', '/sync', { days: ['2026-09-17', '2026-09-18'] });
    token = await mintToken({ sub: 'uid-omar' });
    await call('PUT', '/settings', { startDate: '2026-09-12', timezone: 'UTC' });
    await call('POST', '/sync', { days: ['2026-09-18'] });

    token = await mintToken({ sub: 'uid-amina', email: 'amina@example.com' });
    res = await call('GET', '/admin/report?from=2026-09-17&to=2026-09-18');
    check('an ordinary account cannot read the report', res.status === 403, res.status);

    token = await mintToken({ sub: 'uid-nobody' });
    res = await call('GET', '/admin/report?from=2026-09-17&to=2026-09-18');
    check('nor can one with no email claim', res.status === 403, res.status);

    token = await mintToken({ sub: 'uid-teacher', email: 'teacher@diinislaam.com' });
    res = await call('GET', '/admin/report?from=2026-09-17&to=2026-09-18');
    check('an admin on the Firestore roster can', res.status === 200, res.status);
    check('the report covers each day in the range',
        JSON.stringify(res.body.days) === JSON.stringify(['2026-09-17', '2026-09-18']),
        JSON.stringify(res.body.days));
    check('and says who read on which day',
        res.body.readings['uid-amina'].length === 2 &&
        res.body.readings['uid-omar'].length === 1 &&
        res.body.readings['uid-omar'][0] === '2026-09-18',
        JSON.stringify(res.body.readings));
    check('but carries no names or addresses, only ids',
        !/@|username|displayName/.test(JSON.stringify(res.body)),
        Object.keys(res.body.readings).join(','));

    res = await call('GET', '/admin/report?from=2020-01-01&to=2026-12-31');
    check('a huge range is capped rather than served whole',
        res.body.days.length === 92, res.body.days.length);

    res = await call('GET', '/admin/report');
    check('with no range it reports today', res.body.days.length === 1, res.body.days.length);

    // --- Forgetting -------------------------------------------------------
    token = await mintToken({ sub: 'uid-amina' });
    res = await call('DELETE', '/me');
    check('an account can erase what is held here', res.body.ok === true);
    res = await call('GET', '/me');
    check('and nothing of it is left',
        res.body.days.length === 0 && res.body.settings.startDate === null,
        JSON.stringify(res.body));

    stop();
    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('api test harness error:', err);
    process.exit(2);
});
