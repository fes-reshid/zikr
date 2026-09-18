/*
 * The optional sign-in, from the page's side.
 *
 * The site's shared accounts module (kids-quest-cloud.js) and the reminder API
 * are both stubbed, so this covers the browser half: the header button, the
 * sheets, and — most importantly — that a missing auth module or a missing API
 * never stops the tracker working. The Worker's half is api/test/api.test.js.
 *
 *   npm run test:account
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP account test: playwright-core is not installed (npm install).');
    process.exit(0);
}

const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.ACCOUNT_PORT || 8846);
const BASE = 'http://localhost:' + PORT;
const APP = BASE + '/quran-tracker/';

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png'
};

let store = null;        // the stubbed account's server-side record
let apiUp = true;
const calls = [];

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, BASE);

            // The shared module is injected directly by the test; serve an
            // empty file so the page's script tag does not 404 noisily.
            if (url.pathname.endsWith('/kids-quest-cloud.js')) {
                res.writeHead(200, { 'content-type': TYPES['.js'] });
                return res.end('/* stubbed by the test */');
            }

            if (url.pathname.startsWith('/quran-tracker/api/')) {
                const route = url.pathname.replace('/quran-tracker/api/', '');
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => {
                    let parsed = null;
                    try { parsed = JSON.parse(body); } catch (e) { /* none */ }
                    const auth = req.headers.authorization || '';
                    calls.push({ method: req.method, route, body: parsed, auth });

                    const reply = (code, payload) => {
                        res.writeHead(code, { 'content-type': 'application/json' });
                        res.end(JSON.stringify(payload));
                    };

                    if (route === 'push/key') return reply(200, { key: 'BFakeKey' });
                    if (!apiUp) return reply(503, { error: 'down' });
                    if (!/^Bearer .+/.test(auth)) return reply(401, { error: 'not signed in' });

                    if (route === 'me') {
                        return reply(200, { settings: store.settings, days: store.days,
                                            today: '2026-09-18', juzToday: 7 });
                    }
                    if (route === 'settings') {
                        Object.assign(store.settings, parsed || {});
                        return reply(200, { ok: true, settings: store.settings });
                    }
                    if (route === 'sync') {
                        const days = new Set([...store.days, ...((parsed && parsed.days) || [])]);
                        store.days = [...days].sort().reverse();
                        return reply(200, { ok: true, merged: (parsed.days || []).length,
                                            days: store.days });
                    }
                    if (route === 'readings') {
                        const set = new Set(store.days);
                        if (parsed.read === false) set.delete(parsed.day); else set.add(parsed.day);
                        store.days = [...set].sort().reverse();
                        return reply(200, { ok: true, days: store.days });
                    }
                    return reply(200, { ok: true });
                });
                return;
            }

            let file = path.join(DIST, decodeURIComponent(url.pathname));
            if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
            if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); return res.end('not found');
            }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
            fs.createReadStream(file).pipe(res);
        }).listen(PORT, () => resolve(server));
    });
}

/* A stand-in for kids-quest-cloud.js with the same public shape. */
const FAKE_CLOUD = (signedInUsername) => {
    const user = signedInUsername
        ? { uid: 'uid-' + signedInUsername, username: signedInUsername,
            displayName: signedInUsername, fullName: '', progress: {} }
        : null;
    window.KidsCloud = {
        _user: user,
        _cb: null,
        studentLogin: function (username, password) {
            if (password !== 'correct-horse') {
                var err = new Error('bad'); err.code = 'auth/invalid-credential';
                return Promise.reject(err);
            }
            this._user = { uid: 'uid-' + username, username: username, displayName: username };
            if (this._cb) this._cb(this._user);
            return Promise.resolve(this._user);
        },
        studentSignUp: function (username, contactEmail, password) {
            window.__signUpArgs = { username: username, contactEmail: contactEmail,
                                    password: password };
            if (username === 'taken') {
                var err = new Error('taken'); err.code = 'auth/email-already-in-use';
                return Promise.reject(err);
            }
            this._user = { uid: 'uid-' + username, username: username, displayName: username };
            if (this._cb) this._cb(this._user);
            return Promise.resolve(this._user);
        },
        onStudentAuth: function (cb) { this._cb = cb; cb(this._user); },
        studentLogout: function () {
            this._user = null;
            if (this._cb) this._cb(null);
            return Promise.resolve();
        },
        getIdToken: function () {
            return Promise.resolve(this._user ? 'id-token-' + this._user.uid : null);
        }
    };
    window.dispatchEvent(new Event('kidscloud-ready'));
};

const SEED = () => {
    try {
        localStorage.setItem('quran_user_profile',
            JSON.stringify({ name: 'Feysel', startDate: '2026-09-12' }));
        localStorage.setItem('quran_reading_log',
            JSON.stringify({ '2026-09-17': true, '2026-09-16': true }));
        localStorage.removeItem('quran_synced_with');
    } catch (e) { /* ignore */ }
};

async function open(browser, opts = {}) {
    const context = await browser.newContext({ timezoneId: 'Africa/Addis_Ababa' });
    await context.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(SEED);
    if (opts.cloud !== false) await page.addInitScript(FAKE_CLOUD, opts.signedInAs || null);
    await page.clock.install({ time: new Date('2026-09-18T10:00:00+03:00') });
    await page.goto(APP + (opts.query || ''));
    await page.waitForTimeout(900);
    return { context, page, errors };
}

const freshStore = () => ({
    settings: { startDate: '2026-09-12', timezone: 'Africa/Addis_Ababa',
                remindHour: 20, pushReminders: false },
    days: ['2026-09-15']
});

(async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

    // --- Signed out -------------------------------------------------------
    {
        store = freshStore(); apiUp = true; calls.length = 0;
        const { context, page, errors } = await open(browser);
        check('the header offers a sign in',
            (await page.isVisible('#account-btn')) &&
            (await page.textContent('#account-btn')).trim() === 'Sign in');
        check('the tracker works without signing in',
            (await page.textContent('#target-juz-title')).trim() === 'Juz 7');
        check('and the local streak is intact',
            (await page.textContent('#streak-count')) === '2');

        await page.click('#account-btn');
        await page.waitForTimeout(250);
        check('the sign-in sheet asks for a username, not an email',
            (await page.isVisible('#signin-username')) &&
            (await page.$('#signin-email')) === null);
        check('it says it is the same account as the quest games',
            /same username and password as the quest games/i.test(
                await page.textContent('#signin-lede')));
        check('and that no email is asked for',
            /no email/i.test(await page.textContent('#signin-lede')));

        // A wrong password is reported, not swallowed.
        await page.fill('#signin-username', 'amina123');
        await page.fill('#signin-password', 'wrong-password');
        await page.click('#signin-submit');
        await page.waitForTimeout(400);
        check('a wrong password says so',
            /do not match/i.test(await page.textContent('#signin-message')),
            (await page.textContent('#signin-message')).trim());
        check('and the sheet stays open', await page.isVisible('#signin-modal'));

        calls.length = 0;
        await page.fill('#signin-password', 'correct-horse');
        await page.click('#signin-submit');
        await page.waitForTimeout(700);
        check('the right password signs in', await page.isHidden('#signin-modal'));
        check('and the header shows the username',
            (await page.textContent('#account-btn')).trim() === 'amina123',
            await page.textContent('#account-btn'));
        check('the API is called with the Firebase token, not a password',
            calls.some((c) => c.auth === 'Bearer id-token-uid-amina123') &&
            !calls.some((c) => JSON.stringify(c.body || {}).includes('correct-horse')),
            calls[0] && calls[0].auth);

        const sync = calls.filter((c) => c.route === 'sync');
        check('days already on the device merge up on first sign-in',
            sync.length === 1 && sync[0].body.days.includes('2026-09-17'),
            JSON.stringify(sync[0] && sync[0].body.days));
        await page.waitForTimeout(400);
        const pills = await page.$$eval('#history-list .pill', (e) => e.map((x) => x.textContent.trim()));
        check('and the merged log is what the page draws',
            pills.filter((p) => p === 'Completed').length === 3, JSON.stringify(pills));
        check('no uncaught errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- Creating an account ---------------------------------------------
    {
        store = freshStore(); apiUp = true;
        const { context, page } = await open(browser);
        await page.click('#account-btn');
        await page.waitForTimeout(200);
        await page.click('#signin-toggle');
        await page.waitForTimeout(200);
        check('there is a way to create an account',
            (await page.textContent('#signin-title')).trim() === 'Create an account');
        check('which also asks for no email',
            /No email is asked for/i.test(await page.textContent('#signin-lede')) &&
            (await page.$('#signin-email')) === null);

        await page.fill('#signin-username', 'newkid');
        await page.fill('#signin-password', 'correct-horse');
        await page.click('#signin-submit');
        await page.waitForTimeout(700);
        const args = await page.evaluate(() => window.__signUpArgs);
        check('sign-up passes an empty contact address',
            args && args.username === 'newkid' && args.contactEmail === '',
            JSON.stringify(args));
        check('and the account is used straight away',
            (await page.textContent('#account-btn')).trim() === 'newkid');
        await context.close();
    }

    // --- The account sheet ------------------------------------------------
    {
        store = freshStore(); apiUp = true; calls.length = 0;
        const { context, page } = await open(browser, { signedInAs: 'amina123' });
        await page.click('#account-btn');
        await page.waitForTimeout(400);
        check('the account sheet shows the username',
            (await page.textContent('#account-name')).trim() === 'amina123');
        check('there is no email reminder option',
            (await page.$('#opt-email')) === null);
        check('the reminder settings are shown', await page.isVisible('#reminder-block'));
        check('with the chosen hour and timezone',
            (await page.inputValue('#remind-hour')) === '20' &&
            /Africa\/Addis Ababa/.test(await page.textContent('#remind-zone')));

        calls.length = 0;
        await page.selectOption('#remind-hour', '6');
        await page.waitForTimeout(400);
        const saved = calls.filter((c) => c.route === 'settings');
        check('changing the hour saves it with the timezone',
            saved.length === 1 && saved[0].body.remindHour === 6 &&
            saved[0].body.timezone === 'Africa/Addis_Ababa',
            JSON.stringify(saved[0] && saved[0].body));

        check('deleting reminder data is described as not touching the account',
            /not affected|untouched/i.test(await page.textContent('#forget-btn')));

        await page.click('#signout-btn');
        await page.waitForTimeout(400);
        check('signing out returns the header to Sign in',
            (await page.textContent('#account-btn')).trim() === 'Sign in');
        await context.close();
    }

    // --- Signed in, but the reminder API is not deployed -------------------
    {
        store = freshStore(); apiUp = false;
        const { context, page, errors } = await open(browser, { signedInAs: 'amina123' });
        check('signing in still works with no reminder API',
            (await page.textContent('#account-btn')).trim() === 'amina123');
        await page.click('#account-btn');
        await page.waitForTimeout(400);
        check('the reminder settings are hidden', await page.isHidden('#reminder-block'));
        check('and the sheet explains why', await page.isVisible('#api-warning'));
        check('no uncaught errors with the API down', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- No shared auth module at all -------------------------------------
    {
        store = freshStore(); apiUp = true;
        const { context, page, errors } = await open(browser, { cloud: false });
        check('with no accounts module, no sign-in button appears',
            await page.isHidden('#account-btn'));
        check('and the tracker is unaffected',
            (await page.textContent('#target-juz-title')).trim() === 'Juz 7' &&
            (await page.textContent('#streak-count')) === '2');
        await page.click('#toggle-read-btn');
        await page.waitForTimeout(300);
        check('days can still be marked',
            (await page.textContent('#btn-label')).trim() === 'Completed');
        check('no uncaught errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    await browser.close();
    server.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('account test harness error:', err);
    process.exit(2);
});
