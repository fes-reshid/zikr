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
let failReadingsCount = 0; // how many more POST /readings calls should fail
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
                        if (failReadingsCount > 0) {
                            failReadingsCount--;
                            return reply(503, { error: 'down' });
                        }
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

/*
 * A stand-in for kids-quest-cloud.js with the same public shape, including
 * the fullName-as-displayName behavior studentSignUp gained: a full name, if
 * given, becomes the display name; otherwise it stays the username, matching
 * the real module exactly.
 */
const FAKE_CLOUD = (opts) => {
    opts = opts || {};
    var signedInUsername = opts.signedInAs || null;
    var signedInFullName = opts.fullName || '';
    const user = signedInUsername
        ? { uid: 'uid-' + signedInUsername, username: signedInUsername,
            displayName: signedInFullName || signedInUsername,
            fullName: signedInFullName, progress: {} }
        : null;
    window.KidsCloud = {
        _user: user,
        _cb: null,
        studentLogin: function (username, password) {
            if (password !== 'correct-horse') {
                var err = new Error('bad'); err.code = 'auth/invalid-credential';
                return Promise.reject(err);
            }
            this._user = { uid: 'uid-' + username, username: username, displayName: username,
                           fullName: '' };
            if (this._cb) this._cb(this._user);
            return Promise.resolve(this._user);
        },
        studentSignUp: function (username, contactEmail, password, fullName) {
            var cleanFullName = String(fullName || '').trim();
            window.__signUpArgs = { username: username, contactEmail: contactEmail,
                                    password: password, fullName: cleanFullName };
            if (username === 'taken') {
                var err = new Error('taken'); err.code = 'auth/email-already-in-use';
                return Promise.reject(err);
            }
            this._user = { uid: 'uid-' + username, username: username,
                           displayName: cleanFullName || username, fullName: cleanFullName };
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
    if (opts.seed !== false) await page.addInitScript(SEED);
    if (opts.cloud !== false) {
        await page.addInitScript(FAKE_CLOUD, { signedInAs: opts.signedInAs, fullName: opts.fullName });
    }
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

    // --- Creating an account, from the header (an already-set-up local
    //     user adding an account later) ------------------------------------
    {
        store = freshStore(); apiUp = true;
        const { context, page } = await open(browser);
        await page.click('#account-btn');
        await page.waitForTimeout(200);
        check('creating an account does not ask for a full name until asked to',
            await page.isHidden('#signin-fullname-field'));
        await page.click('#signin-toggle');
        await page.waitForTimeout(200);
        check('there is a way to create an account',
            (await page.textContent('#signin-title')).trim() === 'Create an account');
        check('which asks for a full name',
            await page.isVisible('#signin-fullname-field'));
        check('and no email at all',
            /No email is asked for/i.test(await page.textContent('#signin-lede')) &&
            (await page.$('#signin-email')) === null);

        await page.fill('#signin-fullname', 'Khadija Nur');
        await page.fill('#signin-username', 'newkid');
        await page.fill('#signin-password', 'correct-horse');
        await page.click('#signin-submit');
        await page.waitForTimeout(700);
        const args = await page.evaluate(() => window.__signUpArgs);
        check('sign-up passes an empty contact address',
            args && args.username === 'newkid' && args.contactEmail === '',
            JSON.stringify(args));
        check('and the full name that was entered',
            args && args.fullName === 'Khadija Nur', JSON.stringify(args));
        check('the account is used straight away, with no extra step',
            (await page.isHidden('#signin-modal')) &&
            (await page.isHidden('#setup-view')) &&
            (await page.isVisible('#dashboard-view')));
        check('and the full name is what the header shows',
            (await page.textContent('#account-btn')).trim() === 'Khadija Nur',
            await page.textContent('#account-btn'));
        await context.close();
    }

    // --- The first page a brand-new visitor sees ---------------------------
    // No seed this time: nothing on the device yet, nobody signed in.
    {
        store = freshStore(); apiUp = true;
        const { context, page, errors } = await open(browser, { seed: false });

        check('the welcome screen — not a name-only form — is the first thing shown',
            (await page.isVisible('#welcome-auth')) && (await page.isHidden('#local-setup')));
        check('asking for a username and password, not a name',
            (await page.isVisible('#welcome-username')) &&
            (await page.isVisible('#welcome-password')) &&
            (await page.isHidden('#welcome-fullname-field')));

        // Wrong password: reported, not swallowed, and the screen stays put.
        await page.fill('#welcome-username', 'amina123');
        await page.fill('#welcome-password', 'wrong-password');
        await page.click('#welcome-submit');
        await page.waitForTimeout(400);
        check('a wrong password on the welcome screen says so',
            /do not match/i.test(await page.textContent('#welcome-message')),
            (await page.textContent('#welcome-message')).trim());
        check('and stays on the welcome screen', await page.isVisible('#welcome-auth'));

        // Switch to create an account.
        await page.click('#welcome-toggle');
        await page.waitForTimeout(200);
        check('clicking through offers full name, username and password',
            (await page.isVisible('#welcome-fullname-field')) &&
            (await page.textContent('#welcome-title')).trim() === 'Create an account');

        await page.fill('#welcome-fullname', 'Ahmad Yusuf');
        await page.fill('#welcome-username', 'ahmad99');
        await page.fill('#welcome-password', 'correct-horse');
        await page.click('#welcome-submit');
        await page.waitForTimeout(700);

        const args = await page.evaluate(() => window.__signUpArgs);
        check('the full name reaches sign-up', args && args.fullName === 'Ahmad Yusuf',
            JSON.stringify(args));
        check('signing up saves the session and logs in immediately — ' +
            'no modal, no second click', await page.isHidden('#setup-view') &&
            await page.isVisible('#dashboard-view'));
        check('the full name is what the greeting shows',
            (await page.textContent('#greeting-name')).includes('Ahmad Yusuf'),
            await page.textContent('#greeting-name'));
        check('and what the header shows',
            (await page.textContent('#account-btn')).trim() === 'Ahmad Yusuf');
        check('no uncaught errors on the welcome screen', errors.length === 0,
            errors.join(' | '));
        await context.close();
    }

    // --- Continuing without an account, from the welcome screen -----------
    // No form to fill in any more: it picks a cycle start on its own, the
    // same way a signed-in account with none yet gets one, and opens the
    // reader directly rather than stopping on a name-entry page first.
    {
        store = freshStore(); apiUp = true;
        const { context, page } = await open(browser, { seed: false });
        await page.waitForSelector('#welcome-auth:not(.is-hidden)', { timeout: 5000 });

        await Promise.all([
            page.waitForURL(/\/reader\//, { timeout: 5000 }),
            page.click('#welcome-skip')
        ]);
        check('"Continue without an account" opens the reader directly',
            /\/reader\/\?juz=\d+/.test(page.url()), page.url());

        const profile = await page.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('quran_user_profile') || 'null'); }
            catch (e) { return null; }
        });
        check('a cycle start was picked automatically, with no name asked for',
            !!(profile && profile.startDate), JSON.stringify(profile));
        await context.close();
    }

    // --- The bug the screenshots showed: signed in, but stuck on setup ----
    // A visitor already signed in, on an account that has never set a cycle
    // start (a brand-new account, or one only ever used on another device).
    // The old page kept such a person on the local name-only form forever,
    // even though the header already showed them signed in.
    {
        store = { settings: { startDate: null, timezone: 'UTC', remindHour: 20, pushReminders: true },
                  days: [] };
        apiUp = true;
        calls.length = 0;
        const { context, page, errors } = await open(browser,
            { seed: false, signedInAs: 'fes', fullName: 'Fes Reshid' });

        check('an already-signed-in visitor lands straight on the dashboard',
            (await page.isVisible('#dashboard-view')) && (await page.isHidden('#setup-view')));
        check('the header shows them signed in immediately',
            (await page.textContent('#account-btn')).trim() === 'Fes Reshid');
        check('a juz is shown despite the account never having set one',
            /^Juz \d+$/.test((await page.textContent('#target-juz-title')).trim()),
            await page.textContent('#target-juz-title'));

        const saved = calls.filter((c) => c.route === 'settings')
            .map((c) => c.body).filter((b) => b && b.startDate);
        check('a cycle start was picked and saved on their behalf',
            saved.length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(saved[0].startDate),
            JSON.stringify(saved));
        check('no uncaught errors resolving the stuck-setup bug', errors.length === 0,
            errors.join(' | '));
        await context.close();
    }

    // --- The account sheet, reached from the header menu's Reminders -------
    {
        store = freshStore(); apiUp = true; calls.length = 0;
        const { context, page } = await open(browser, { signedInAs: 'amina123' });
        await page.click('#menuBtn');
        await page.click('#menu-reminders-btn');
        await page.waitForTimeout(400);
        check('"Reminders" in the header menu opens the account sheet, signed in',
            await page.isVisible('#account-modal'));
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

        // The bug the user reported: after signing out on a shared device,
        // the dashboard kept showing the previous person's name and streak,
        // with only the header's "Sign in" hinting no one was authenticated.
        check('signing out leaves the dashboard, not showing it to the next person',
            await page.isHidden('#dashboard-view'));
        check('and lands back on the sign-in screen',
            await page.isVisible('#welcome-auth'));
        const leftoverKeys = await page.evaluate(() => [
            localStorage.getItem('quran_user_profile'),
            localStorage.getItem('quran_reading_log'),
            localStorage.getItem('quran_audio_place')
        ]);
        check('no name, reading log or resume position is left on the device',
            leftoverKeys.every((v) => v === null), JSON.stringify(leftoverKeys));
        await context.close();
    }

    // --- Signed in, but the reminder API is not deployed -------------------
    {
        store = freshStore(); apiUp = false; calls.length = 0;
        const { context, page, errors } = await open(browser,
            { seed: false, signedInAs: 'fes', fullName: 'Fes Reshid' });
        check('signing in still works with no reminder API',
            (await page.textContent('#account-btn')).trim() === 'Fes Reshid');

        // The bug this covers: signed in, but stuck looking signed out —
        // the header showed the name while the page underneath stayed on
        // the sign-in form forever, because syncing the dashboard used to
        // wait on the reminder API to answer at all, and it never does here.
        check('signing in still reaches the dashboard, not stuck on sign-in',
            (await page.isVisible('#dashboard-view')) && (await page.isHidden('#setup-view')));
        check('with a greeting under their own name',
            (await page.textContent('#greeting-name')).includes('Fes Reshid'));
        check('and a juz to read despite the API being down',
            /^Juz \d+$/.test((await page.textContent('#target-juz-title')).trim()),
            await page.textContent('#target-juz-title'));

        // Marking a day works locally even though nothing can reach the API.
        await page.click('#toggle-read-btn');
        await page.waitForTimeout(200);
        check('and today can still be marked read, offline from the API',
            (await page.textContent('#btn-label')).trim() === 'Completed');

        await page.click('#account-btn');
        await page.waitForTimeout(400);
        check('the reminder settings are hidden', await page.isHidden('#reminder-block'));
        check('and the sheet explains why', await page.isVisible('#api-warning'));
        check('no uncaught errors with the API down', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- A mark-as-read whose write to the server fails must not be lost --
    // This is the bug behind "I marked it read and it's not saving": the
    // click always updates the local log first, but the sync to the server
    // used to be pure fire-and-forget — if that one POST failed, the next
    // refresh() trusted the server's (still missing that day) list and wiped
    // the local mark. It must now be retried, and reflected, until confirmed.
    {
        store = freshStore(); apiUp = true; failReadingsCount = 1; calls.length = 0;
        const { context, page, errors } = await open(browser,
            { seed: false, signedInAs: 'hania', fullName: 'Hania Feysel' });

        await page.click('#toggle-read-btn');
        await page.waitForTimeout(250);
        check('marking today read shows locally even though the write to the server just failed',
            (await page.textContent('#btn-label')).trim() === 'Completed');
        check('and the server genuinely does not have it yet — the failure was real, not faked',
            !store.days.includes('2026-09-18'), JSON.stringify(store.days));

        // A later visit — same device, a fresh load — retries it.
        await page.reload();
        await page.waitForTimeout(900);
        check('the mark survives a reload instead of reverting to unread',
            (await page.textContent('#btn-label')).trim() === 'Completed');
        check('because the retried write actually reached the server this time',
            store.days.includes('2026-09-18'), JSON.stringify(store.days));
        check('no uncaught errors recovering a failed write', errors.length === 0, errors.join(' | '));
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
