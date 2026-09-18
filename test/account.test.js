/*
 * The optional sign-in, from the page's side.
 *
 * The API is stubbed by a local server, so this covers the browser half: the
 * header button, the sheets, and that a missing or broken API never stops the
 * tracker working. The Worker's own half is tested in api/test/api.test.js.
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

// Stub account, driven by the scenario under test.
let account = null;
const calls = [];

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, BASE);
            const reply = (code, body) => {
                res.writeHead(code, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };

            if (url.pathname.startsWith('/quran-tracker/api/')) {
                const route = url.pathname.replace('/quran-tracker/api/', '');
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => {
                    let parsed = null;
                    try { parsed = JSON.parse(body); } catch (e) { /* no body */ }
                    calls.push({ method: req.method, route, body: parsed });

                    if (route === 'me') {
                        return account
                            ? reply(200, { signedIn: true, user: account.user, days: account.days,
                                           today: '2026-09-18', juzToday: 7 })
                            : reply(200, { signedIn: false });
                    }
                    if (route === 'login') {
                        return reply(200, { ok: true,
                            message: 'If that address can receive mail, a sign-in link is on its way.' });
                    }
                    if (route === 'logout') { account = null; return reply(200, { ok: true }); }
                    if (route === 'profile') {
                        Object.assign(account.user, parsed || {});
                        return reply(200, { ok: true, user: account.user });
                    }
                    if (route === 'sync') {
                        const days = new Set([...(account.days || []), ...((parsed && parsed.days) || [])]);
                        account.days = [...days].sort().reverse();
                        return reply(200, { ok: true, merged: (parsed.days || []).length, days: account.days });
                    }
                    if (route === 'readings') {
                        const set = new Set(account.days);
                        if (parsed.read === false) set.delete(parsed.day); else set.add(parsed.day);
                        account.days = [...set].sort().reverse();
                        return reply(200, { ok: true, days: account.days });
                    }
                    if (route === 'push/key') return reply(200, { key: 'BFakeKeyForTesting' });
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

async function openTracker(browser, opts = {}) {
    const context = await browser.newContext({ timezoneId: 'Africa/Addis_Ababa' });
    await context.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    if (opts.seed) await page.addInitScript(opts.seed);
    await page.clock.install({ time: new Date('2026-09-18T10:00:00+03:00') });
    await page.goto(APP + (opts.query || ''));
    await page.waitForTimeout(900);
    return { context, page, errors };
}

const SEED_PROFILE = () => {
    try {
        localStorage.setItem('quran_user_profile',
            JSON.stringify({ name: 'Feysel', startDate: '2026-09-12' }));
        localStorage.setItem('quran_reading_log',
            JSON.stringify({ '2026-09-17': true, '2026-09-16': true }));
        localStorage.removeItem('quran_synced_with');
    } catch (e) { /* ignore */ }
};

(async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

    // --- Signed out -------------------------------------------------------
    {
        account = null;
        const { context, page, errors } = await openTracker(browser, { seed: SEED_PROFILE });
        check('the header offers a sign in once the API answers',
            (await page.isVisible('#account-btn')) &&
            (await page.textContent('#account-btn')).trim() === 'Sign in');
        check('the tracker works without signing in',
            (await page.textContent('#target-juz-title')).trim() === 'Juz 7');
        check('and the local streak is intact',
            (await page.textContent('#streak-count')) === '2',
            await page.textContent('#streak-count'));

        await page.click('#account-btn');
        await page.waitForTimeout(250);
        check('the sign-in sheet opens', await page.isVisible('#signin-modal'));
        check('it says signing in is optional',
            /optional/i.test(await page.textContent('#signin-modal')));
        check('and that no password is involved',
            /no password/i.test(await page.textContent('#signin-modal')));

        await page.fill('#signin-email', 'reader@example.com');
        await page.click('#signin-submit');
        await page.waitForTimeout(400);
        const login = calls.filter((c) => c.route === 'login');
        check('submitting asks the API for a link',
            login.length === 1 && login[0].body.email === 'reader@example.com',
            JSON.stringify(login[0] && login[0].body));
        check('and the page says to check your email',
            /sign-in link is on its way/i.test(await page.textContent('#signin-message')));
        check('no uncaught errors while signed out', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- Signed in --------------------------------------------------------
    {
        calls.length = 0;
        account = {
            user: { email: 'reader@example.com', name: 'Feysel', startDate: '2026-09-12',
                    timezone: 'Africa/Addis_Ababa', remindHour: 20,
                    emailReminders: true, pushReminders: false },
            days: ['2026-09-15']
        };
        const { context, page, errors } = await openTracker(browser, { seed: SEED_PROFILE });

        check('the header shows the name once signed in',
            (await page.textContent('#account-btn')).trim() === 'Feysel',
            await page.textContent('#account-btn'));
        check('and is styled as signed in',
            (await page.getAttribute('#account-btn', 'class')).includes('signed-in'));

        const sync = calls.filter((c) => c.route === 'sync');
        check('days already on the device are merged up on first sign-in',
            sync.length === 1 && sync[0].body.days.includes('2026-09-17'),
            JSON.stringify(sync[0] && sync[0].body.days));
        check('and the merge keeps what the account already had',
            account.days.includes('2026-09-15') && account.days.includes('2026-09-16'),
            JSON.stringify(account.days));

        await page.waitForTimeout(400);
        const pills = await page.$$eval('#history-list .pill', (els) =>
            els.map((e) => e.textContent.trim()));
        check('the merged log is what the page draws',
            pills.filter((p) => p === 'Completed').length === 3, JSON.stringify(pills));

        // Marking a day reaches the account.
        calls.length = 0;
        await page.click('#toggle-read-btn');
        await page.waitForTimeout(400);
        const readings = calls.filter((c) => c.route === 'readings');
        check('marking today is sent to the account',
            readings.length === 1 && readings[0].body.day === '2026-09-18' &&
            readings[0].body.read === true && readings[0].body.juz === 7,
            JSON.stringify(readings[0] && readings[0].body));

        // --- Account sheet ---
        await page.click('#account-btn');
        await page.waitForTimeout(300);
        check('the account sheet opens', await page.isVisible('#account-modal'));
        check('showing which account it is',
            (await page.textContent('#account-email')).trim() === 'reader@example.com');
        check('with the email reminder on', await page.isChecked('#opt-email'));
        check('the chosen hour', (await page.inputValue('#remind-hour')) === '20');
        check('and the timezone it will use',
            /Africa\/Addis Ababa/.test(await page.textContent('#remind-zone')),
            await page.textContent('#remind-zone'));

        calls.length = 0;
        await page.uncheck('#opt-email');
        await page.waitForTimeout(400);
        const profile = calls.filter((c) => c.route === 'profile');
        check('turning the email reminder off saves',
            profile.length === 1 && profile[0].body.emailReminders === false,
            JSON.stringify(profile[0] && profile[0].body));

        calls.length = 0;
        await page.selectOption('#remind-hour', '6');
        await page.waitForTimeout(400);
        const hour = calls.filter((c) => c.route === 'profile');
        check('changing the hour saves it with the timezone',
            hour.length === 1 && hour[0].body.remindHour === 6 &&
            hour[0].body.timezone === 'Africa/Addis_Ababa',
            JSON.stringify(hour[0] && hour[0].body));

        await page.click('#signout-btn');
        await page.waitForTimeout(400);
        check('signing out returns the header to Sign in',
            (await page.textContent('#account-btn')).trim() === 'Sign in');
        check('no uncaught errors while signed in', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- The API being down must not matter -------------------------------
    {
        account = null;
        const context = await browser.newContext({ timezoneId: 'Africa/Addis_Ababa' });
        await context.route('https://fonts.googleapis.com/**', (r) =>
            r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await context.route('**/quran-tracker/api/**', (r) => r.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.addInitScript(SEED_PROFILE);
        await page.clock.install({ time: new Date('2026-09-18T10:00:00+03:00') });
        await page.goto(APP);
        await page.waitForTimeout(900);

        check('with no API deployed, no sign-in button is shown at all',
            await page.isHidden('#account-btn'));
        check('with the API unreachable the tracker still works',
            (await page.textContent('#target-juz-title')).trim() === 'Juz 7');
        check('the local streak is untouched',
            (await page.textContent('#streak-count')) === '2');
        await page.click('#toggle-read-btn');
        await page.waitForTimeout(300);
        check('and days can still be marked',
            (await page.textContent('#btn-label')).trim() === 'Completed');
        check('no uncaught errors with the API down', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- The reader's header ---------------------------------------------
    {
        account = {
            user: { email: 'reader@example.com', name: 'Feysel Ahmed', startDate: '2026-09-12',
                    timezone: 'Africa/Addis_Ababa', remindHour: 20,
                    emailReminders: true, pushReminders: false },
            days: []
        };
        const context = await browser.newContext();
        await context.route('https://fonts.googleapis.com/**', (r) =>
            r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await context.route('https://api.quran.com/**', (r) =>
            r.fulfill({ status: 200, contentType: 'application/json',
                body: '{"recitations":[],"translations":[],"verses":[],"audio_files":[]}' }));
        const page = await context.newPage();
        await page.goto(APP + 'reader/?juz=7');
        await page.waitForTimeout(900);
        check('the reader header shows the first name only',
            (await page.textContent('#account-btn')).trim() === 'Feysel',
            await page.textContent('#account-btn'));
        await page.click('#account-btn');
        await page.waitForTimeout(600);
        check('and its button goes to the account on the tracker',
            page.url().endsWith('/quran-tracker/?account=1'), page.url());
        await page.waitForTimeout(700);
        check('which opens the account sheet there', await page.isVisible('#account-modal'));
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
