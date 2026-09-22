/*
 * End-to-end test of index.html in headless Chromium.
 *
 * The Quran.com API is stubbed, so this runs offline and asserts on the
 * requests the reader makes rather than on live scripture data.
 *
 * Requires playwright-core plus a Chromium build:
 *   npm install && npx playwright install chromium
 *   npm run test:e2e
 */
const path = require('path');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP browser test: playwright-core is not installed (npm install).');
    process.exit(0);
}

// Defaults to the source page on disk; point APP_URL at a served build to
// exercise the deployed artifact instead.
const APP_URL = process.env.APP_URL ||
    'file://' + path.resolve(__dirname, '..', 'dist', 'quran-tracker', 'index.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });

    // The page carries its own CSS, so only the webfonts need stubbing.
    await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));

    // The tracker itself never calls the API; fail loudly if that changes.
    await context.route('https://api.quran.com/**', (route) => {
        unexpectedApiCalls.push(route.request().url());
        route.fulfill({ status: 500, body: 'the tracker should not call the API' });
    });
    const unexpectedApiCalls = [];

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Fixed clock: 2026-09-18 is Rabiʿ II 7, 1448 AH.
    await page.clock.install({ time: new Date('2026-09-18T10:00:00-07:00') });
    await page.goto(APP_URL);

    // This repo does not ship kids-quest-cloud.js (that lives beside it on
    // the real site), so the accounts script 404s and the page falls back to
    // the local-only form — quickly, since a failed script fires its own
    // `error` event rather than waiting out the module's full timeout. Wait
    // for that fallback explicitly instead of guessing how long it takes.
    await page.waitForSelector('#local-setup:not(.is-hidden)', { timeout: 5000 });

    // --- First run --------------------------------------------------------
    check('setup view is shown on first run', await page.isVisible('#setup-view'));
    check('the local-only form is reached with no extra click ' +
        '(no accounts module on this build)', await page.isVisible('#local-setup'));
    check('dashboard is hidden on first run', await page.isHidden('#dashboard-view'));
    const prefill = await page.inputValue('#start-date');
    check('start date pre-fills to Rabiʿ II 1', prefill === '2026-09-12', prefill);
    check('start date hint names the Hijri date',
        /1448 AH/.test(await page.textContent('#start-date-hint')));

    await page.fill('#user-name', 'Ahmad');
    await page.click('#setup-form button[type=submit]');
    await page.waitForTimeout(200);

    // --- Dashboard --------------------------------------------------------
    check('dashboard replaces setup after submit',
        (await page.isVisible('#dashboard-view')) && (await page.isHidden('#setup-view')));
    const juz = (await page.textContent('#target-juz-title')).trim();
    check("today's target is Juz 7 west of UTC", juz === 'Juz 7', juz);
    const badge = (await page.textContent('#hijri-badge-top')).trim();
    check('Hijri badge is computed, not hardcoded', /II 7, 1448 AH/.test(badge), badge);
    check('cycle position is shown',
        (await page.textContent('#cycle-progress-label')).trim() === 'Day 7 of 30 in this cycle');
    check('the name typed in setup was saved to the profile',
        (await page.evaluate(() =>
            JSON.parse(localStorage.getItem('quran_user_profile') || '{}').name)) === 'Ahmad');

    // --- Resuming a paused reading ------------------------------------------
    // The reader saves { juz, index, verseKey } as it plays; the tracker turns
    // that into a "continue where you left off" nudge for today's unfinished
    // juz, cleared the moment today is marked read. This has to run before
    // today is ever marked below — marking read now locks, so it is the only
    // point in this run where today is still unread.
    check('no resume card with nothing paused', await page.isHidden('#resume-card'));

    await page.evaluate(() => {
        localStorage.setItem('quran_audio_place',
            JSON.stringify({ juz: 7, index: 3, verseKey: '7:12' }));
    });
    await page.reload();
    await page.waitForTimeout(300);
    check('a mid-juz pause on today\'s due juz shows the resume card',
        await page.isVisible('#resume-card'));
    const resumeText = await page.textContent('#resume-desc');
    check('it names the exact verse that was paused on',
        resumeText.includes('7:12') && resumeText.includes('Juz 7'), resumeText);
    check('and encourages continuing', /almost there|continue/i.test(resumeText), resumeText);
    check('it reminds of the reward for reading the Qur’ān',
        /reward/i.test(await page.textContent('#resume-reward')));
    const resumeHref = await page.getAttribute('#resume-btn', 'href');
    check('the button resumes on the paused juz', resumeHref === 'reader/?juz=7', resumeHref);

    await page.evaluate(() => {
        localStorage.setItem('quran_audio_place',
            JSON.stringify({ juz: 12, index: 3, verseKey: '20:5' }));
    });
    await page.reload();
    await page.waitForTimeout(300);
    check('a paused place on a different juz is not offered as today\'s resume',
        await page.isHidden('#resume-card'));

    // Put back the pause on today's own juz, so marking it read below can be
    // shown to clear the nudge.
    await page.evaluate(() => {
        localStorage.setItem('quran_audio_place',
            JSON.stringify({ juz: 7, index: 3, verseKey: '7:12' }));
    });
    await page.reload();
    await page.waitForTimeout(300);
    check('the resume card is back for today\'s own juz', await page.isVisible('#resume-card'));

    // --- Marking days read, once and for good -------------------------------
    check('streak starts at zero', (await page.textContent('#streak-count')) === '0');
    await page.click('#toggle-read-btn');
    await page.waitForTimeout(150);
    check('marking today sets a 1 day streak', (await page.textContent('#streak-count')) === '1');
    check('the button flips to Completed',
        (await page.textContent('#btn-label')).trim() === 'Completed');
    check('and locks — a completed day is a record, not a toggle',
        await page.evaluate(() => document.getElementById('toggle-read-btn').disabled));
    check('the reminder card turns positive',
        (await page.getAttribute('#feedback-card', 'class')).includes('note-done'));
    check('marking today read clears the resume nudge', await page.isHidden('#resume-card'));

    const rows = await page.$$('#history-list [data-date-key]');
    check('history lists 7 days', rows.length === 7, rows.length);
    const historyJuz = await page.$$eval('#history-list [data-date-key]', (els) =>
        els.map((el) => el.querySelector('p.day-juz').textContent).join(','));
    check('history counts the Juz back correctly',
        historyJuz === 'Juz 7,Juz 6,Juz 5,Juz 4,Juz 3,Juz 2,Juz 1', historyJuz);

    await rows[1].click();
    await page.waitForTimeout(150);
    check('back-filling yesterday extends the streak',
        (await page.textContent('#streak-count')) === '2');

    const backfilledRow = (await page.$$('#history-list [data-date-key]'))[1];
    check('once marked, that day\'s row locks too — nothing left to tap it back off with',
        await backfilledRow.evaluate((el) => el.disabled));
    check('so the streak holds', (await page.textContent('#streak-count')) === '2');

    await page.reload();
    await page.waitForTimeout(300);
    check('profile survives a reload', await page.isVisible('#dashboard-view'));
    check('reading log survives a reload', (await page.textContent('#streak-count')) === '2');

    // --- Reader link ------------------------------------------------------
    // The reader is a separate page now; the tracker only has to point at it
    // with the juz that is due today.
    const quickHref = await page.getAttribute('#quick-read-btn', 'href');
    const openHref = await page.getAttribute('#open-reader-btn', 'href');
    check("'Listen & read' links to today's juz", quickHref === 'reader/?juz=7', quickHref);
    check("'Open the reader' links to today's juz", openHref === 'reader/?juz=7', openHref);

    // --- Settings ---------------------------------------------------------
    await page.click('#settings-btn');
    await page.waitForTimeout(150);
    check('settings open', await page.isVisible('#settings-modal'));
    page.once('dialog', (d) => d.accept());
    await page.click('#clear-history-btn');
    await page.waitForTimeout(200);
    check('clearing history resets the streak', (await page.textContent('#streak-count')) === '0');
    check('clearing history keeps the profile',
        (await page.evaluate(() =>
            JSON.parse(localStorage.getItem('quran_user_profile') || '{}').name)) === 'Ahmad');
    check('clearing history also drops the stale resume position',
        await page.evaluate(() => localStorage.getItem('quran_audio_place')) === null);

    await page.click('#settings-btn');
    await page.waitForTimeout(150);
    page.once('dialog', (d) => d.dismiss());
    await page.click('#reset-all-btn');
    await page.waitForTimeout(200);
    check('declining the reset prompt changes nothing', await page.isHidden('#setup-view'));

    await page.evaluate(() => {
        localStorage.setItem('quran_audio_place',
            JSON.stringify({ juz: 7, index: 2, verseKey: '7:9' }));
    });
    page.once('dialog', (d) => d.accept());
    await page.click('#reset-all-btn');
    await page.waitForTimeout(200);
    check('confirming the reset returns to setup', await page.isVisible('#setup-view'));
    check('and drops the resume position too',
        await page.evaluate(() => localStorage.getItem('quran_audio_place')) === null);

    // --- Midnight rollover ------------------------------------------------
    await page.fill('#user-name', 'Ahmad');
    await page.click('#setup-form button[type=submit]');
    await page.waitForTimeout(200);
    check('Juz before midnight', (await page.textContent('#target-juz-title')).trim() === 'Juz 7');
    await page.clock.setFixedTime(new Date('2026-09-19T00:05:00-07:00'));
    await page.clock.runFor('02:00');
    await page.waitForTimeout(300);
    check('the Juz rolls over at midnight without a reload',
        (await page.textContent('#target-juz-title')).trim() === 'Juz 8',
        (await page.textContent('#target-juz-title')).trim());

    check('the tracker makes no API calls', unexpectedApiCalls.length === 0,
        unexpectedApiCalls.join(' | '));
    check('no uncaught page errors', errors.length === 0, errors.join(' | '));

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('browser test harness error:', err);
    process.exit(2);
});
