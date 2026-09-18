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
    'file://' + path.resolve(__dirname, '..', 'index.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

// The app only relies on Tailwind for `.hidden`; stub just that so visibility
// assertions stay meaningful without reaching the network.
const TAILWIND_STUB =
    "var s=document.createElement('style');" +
    "s.textContent='.hidden{display:none !important}';" +
    'document.head.appendChild(s);';

const PAGE_SIZE = 50;
const TOTAL_PAGES = 2;

function stubVerses(page) {
    const verses = [];
    for (let i = 0; i < PAGE_SIZE; i++) {
        const n = (page - 1) * PAGE_SIZE + i + 1;
        verses.push({
            verse_key: '7:' + n,
            text_uthmani: 'نَصٌّ عَرَبِيٌّ ' + n,
            translations: [{ text: 'Translation number ' + n + '<sup foot_note="9">1</sup>' }]
        });
    }
    return {
        verses,
        pagination: {
            current_page: page,
            next_page: page < TOTAL_PAGES ? page + 1 : null,
            total_pages: TOTAL_PAGES
        }
    };
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });

    await context.route('https://cdn.tailwindcss.com**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: TAILWIND_STUB }));
    await context.route('https://cdnjs.cloudflare.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

    let apiCalls = [];
    let apiStatus = 200;
    await context.route('https://api.quran.com/**', (route) => {
        const url = route.request().url();
        apiCalls.push(url);
        if (apiStatus !== 200) return route.fulfill({ status: apiStatus, body: 'error' });
        const page = Number(new URL(url).searchParams.get('page') || 1);
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(stubVerses(page))
        });
    });

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Fixed clock: 2026-09-18 is Rabiʿ II 7, 1448 AH.
    await page.clock.install({ time: new Date('2026-09-18T10:00:00-07:00') });
    await page.goto(APP_URL);
    await page.waitForTimeout(300);

    // --- First run --------------------------------------------------------
    check('setup view is shown on first run', await page.isVisible('#setup-view'));
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
    check('greeting includes the name',
        (await page.textContent('#greeting-name')).includes('Ahmad'));

    // --- Marking days read ------------------------------------------------
    check('streak starts at zero', (await page.textContent('#streak-count')) === '0');
    await page.click('#toggle-read-btn');
    await page.waitForTimeout(150);
    check('marking today sets a 1 day streak', (await page.textContent('#streak-count')) === '1');
    check('the button flips to Completed',
        (await page.textContent('#btn-label')).trim() === 'Completed');
    check('the reminder card turns positive',
        (await page.getAttribute('#feedback-card', 'class')).includes('emerald'));

    const rows = await page.$$('#history-list [data-date-key]');
    check('history lists 7 days', rows.length === 7, rows.length);
    const historyJuz = await page.$$eval('#history-list [data-date-key]', (els) =>
        els.map((el) => el.querySelector('p.text-emerald-600').textContent).join(','));
    check('history counts the Juz back correctly',
        historyJuz === 'Juz 7,Juz 6,Juz 5,Juz 4,Juz 3,Juz 2,Juz 1', historyJuz);

    await rows[1].click();
    await page.waitForTimeout(150);
    check('back-filling yesterday extends the streak',
        (await page.textContent('#streak-count')) === '2');
    await (await page.$$('#history-list [data-date-key]'))[1].click();
    await page.waitForTimeout(150);
    check('tapping again clears that day', (await page.textContent('#streak-count')) === '1');

    await page.reload();
    await page.waitForTimeout(300);
    check('profile survives a reload', await page.isVisible('#dashboard-view'));
    check('reading log survives a reload', (await page.textContent('#streak-count')) === '1');

    // --- Reader -----------------------------------------------------------
    apiCalls = [];
    await page.click('#open-reader-btn');
    await page.waitForTimeout(600);
    check('reader opens', await page.isVisible('#reader-modal'));
    check("reader defaults to today's Juz", (await page.inputValue('#juz-selector')) === '7');
    check('request asks for the Uthmani script',
        apiCalls[0] && apiCalls[0].includes('fields=text_uthmani'), apiCalls[0]);
    check('reader pages past the 50-verse cap', apiCalls.length === TOTAL_PAGES,
        apiCalls.length + ' requests');
    const cards = await page.$$('#reader-content > div.bg-white');
    check('every verse is rendered', cards.length === PAGE_SIZE * TOTAL_PAGES, cards.length);
    check('Arabic text is rendered',
        (await page.textContent('#reader-content .arabic-text')).includes('نَصٌّ عَرَبِيٌّ'));
    check('subtitle reports the full count',
        (await page.textContent('#reader-subtitle')).includes('100 verses'));
    const translation = await page.$$eval('#reader-content > div.bg-white', (els) =>
        els[0].lastElementChild.textContent);
    check('footnote markup is stripped from translations',
        translation === 'Translation number 1', JSON.stringify(translation));

    apiCalls = [];
    await page.selectOption('#juz-selector', '12');
    await page.waitForTimeout(600);
    check('changing the Juz refetches',
        apiCalls.length === TOTAL_PAGES && apiCalls[0].includes('by_juz/12'), apiCalls[0]);
    check('verse cards show the new Juz',
        (await page.textContent('#reader-content .bg-emerald-50')).includes('Juz 12'));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('Escape closes the reader', await page.isHidden('#reader-modal'));

    await page.click('#quick-read-btn');
    await page.waitForTimeout(600);
    // Dispatch on the overlay itself: the stub has no Tailwind layout, so a
    // coordinate click cannot reliably land outside the panel.
    await page.$eval('#reader-modal', (el) => el.click());
    await page.waitForTimeout(150);
    check('clicking the backdrop closes the reader', await page.isHidden('#reader-modal'));
    await page.click('#quick-read-btn');
    await page.waitForTimeout(600);
    await page.$eval('#reader-panel', (el) => el.click());
    await page.waitForTimeout(150);
    check('clicking inside the panel keeps the reader open',
        await page.isVisible('#reader-modal'));
    await page.click('#close-reader-btn');
    await page.waitForTimeout(150);

    // --- Reader failure path ---------------------------------------------
    const errorsBeforeFailure = errors.length;
    apiStatus = 500;
    await page.click('#quick-read-btn');
    await page.waitForTimeout(500);
    const errorText = await page.textContent('#reader-content');
    check('an API failure offers a retry',
        /Could not reach|offline/.test(errorText) && errorText.includes('Try again'));
    apiStatus = 200;
    apiCalls = [];
    await page.click('#reader-content button');
    await page.waitForFunction(
        (n) => document.querySelectorAll('#reader-content > div.bg-white').length === n,
        PAGE_SIZE * TOTAL_PAGES,
        { timeout: 5000 }
    ).catch(() => {});
    check('retry recovers after the API comes back',
        (await page.$$('#reader-content > div.bg-white')).length === PAGE_SIZE * TOTAL_PAGES,
        (await page.$$('#reader-content > div.bg-white')).length);
    await page.click('#close-reader-btn');
    await page.waitForTimeout(150);
    check('a failed load throws nothing uncaught', errors.length === errorsBeforeFailure,
        errors.slice(errorsBeforeFailure).join(' | '));

    // --- Settings ---------------------------------------------------------
    await page.click('#settings-btn');
    await page.waitForTimeout(150);
    check('settings open', await page.isVisible('#settings-modal'));
    page.once('dialog', (d) => d.accept());
    await page.click('#clear-history-btn');
    await page.waitForTimeout(200);
    check('clearing history resets the streak', (await page.textContent('#streak-count')) === '0');
    check('clearing history keeps the profile',
        (await page.textContent('#greeting-name')).includes('Ahmad'));

    await page.click('#settings-btn');
    await page.waitForTimeout(150);
    page.once('dialog', (d) => d.dismiss());
    await page.click('#reset-all-btn');
    await page.waitForTimeout(200);
    check('declining the reset prompt changes nothing', await page.isHidden('#setup-view'));

    page.once('dialog', (d) => d.accept());
    await page.click('#reset-all-btn');
    await page.waitForTimeout(200);
    check('confirming the reset returns to setup', await page.isVisible('#setup-view'));

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

    check('no uncaught page errors', errors.length === 0, errors.join(' | '));

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('browser test harness error:', err);
    process.exit(2);
});
