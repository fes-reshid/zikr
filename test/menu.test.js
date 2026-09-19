/*
 * The shared header menu (the "three lines"): no site brand any more, and
 * the menu itself carries Settings, About, Why-read-daily, and links to the
 * rest of the site — plus the Hijri date correction and location fields
 * that live inside Settings.
 *
 *   npm run test:menu
 */
const path = require('path');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP menu test: playwright-core is not installed (npm install).');
    process.exit(0);
}

const TRACKER_URL = process.env.TRACKER_URL ||
    'file://' + path.resolve(__dirname, '..', 'dist', 'quran-tracker', 'index.html');
const READER_URL = process.env.READER_URL ||
    'file://' + path.resolve(__dirname, '..', 'dist', 'quran-tracker', 'reader', 'index.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

// 2026-09-19 is Rabiʿ II 8 by the tabular Umm al-Qurā calendar.
const CLOCK = '2026-09-19T10:00:00-07:00';

async function openPage(browser, url, opts) {
    const options = opts || {};
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
    await context.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
    // Nothing here needs live scripture data; keep it fast and offline.
    await context.route('https://api.quran.com/**', (r) =>
        r.fulfill({ status: 500, body: 'blocked for this test' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.clock.install({ time: new Date(CLOCK) });
    await page.goto(url + (options.query || ''));
    return { context, page, errors };
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

    // --- No site brand, on either page --------------------------------
    for (const [label, url] of [['tracker', TRACKER_URL], ['reader', READER_URL]]) {
        const { context, page, errors } = await openPage(browser, url);
        await page.waitForSelector('#menuBtn', { timeout: 5000 });
        check(label + ': no "Diin Islaam" brand in the header',
            (await page.$('.brand')) === null);
        check(label + ': the menu button is there instead',
            await page.isVisible('#menuBtn'));
        check(label + ': the menu starts closed', await page.isHidden('#appMenu'));
        check(label + ': no footer either', (await page.$('footer')) === null);
        check(label + ': no uncaught page errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- Opening the menu, its contents, and closing it -----------------
    {
        const { context, page } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#menuBtn', { timeout: 5000 });

        await page.click('#menuBtn');
        await page.waitForTimeout(150);
        check('the menu opens', await page.isVisible('#appMenu'));
        check('aria-expanded reflects it',
            (await page.getAttribute('#menuBtn', 'aria-expanded')) === 'true');

        check('it offers Settings',
            /Settings/i.test(await page.textContent('#menu-settings-btn')));
        check('Reminders',
            /Reminders/i.test(await page.textContent('#menu-reminders-btn')));
        check('About this app',
            /about this app/i.test(await page.textContent('#menu-about-btn')));
        check('and why to read daily',
            /every day/i.test(await page.textContent('#menu-benefits-btn')));

        const links = await page.$$eval('#appMenu a', (els) =>
            els.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
        check('and links to the rest of the site',
            links.some((l) => /hadeeth\.html/.test(l.href)) &&
            links.some((l) => /arabic\.html/.test(l.href)) &&
            links.some((l) => /kids\.html/.test(l.href)) &&
            links.some((l) => /apps\.html/.test(l.href)),
            JSON.stringify(links));

        // Clicking outside closes it.
        await page.click('body', { position: { x: 5, y: 400 } });
        await page.waitForTimeout(150);
        check('clicking outside the menu closes it', await page.isHidden('#appMenu'));

        await page.click('#menuBtn');
        await page.waitForTimeout(150);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        check('Escape closes it too', await page.isHidden('#appMenu'));
        await context.close();
    }

    // --- About / Benefits overlays --------------------------------------
    {
        const { context, page, errors } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#menuBtn', { timeout: 5000 });

        await page.click('#menuBtn');
        await page.click('#menu-about-btn');
        await page.waitForTimeout(150);
        check('About opens', await page.isVisible('#about-overlay'));
        check('and closes the dropdown menu underneath it', await page.isHidden('#appMenu'));
        check('naming the cycle it tracks',
            /juz/i.test(await page.textContent('#about-overlay')) &&
            /Rab/i.test(await page.textContent('#about-overlay')));
        check('and that no email is required',
            /no email/i.test(await page.textContent('#about-overlay')));
        await page.click('#close-about-btn');
        await page.waitForTimeout(150);
        check('and the close button closes it', await page.isHidden('#about-overlay'));

        await page.click('#menuBtn');
        await page.click('#menu-benefits-btn');
        await page.waitForTimeout(150);
        check('the benefits overlay opens', await page.isVisible('#benefits-overlay'));
        const benefitsText = await page.textContent('#benefits-overlay');
        check('it cites real, attributed hadith, not made-up text',
            /Tirmidh/i.test(benefitsText) && /Bukh/i.test(benefitsText) &&
            /Muslim/i.test(benefitsText), benefitsText);
        await page.click('#benefits-overlay', { position: { x: 5, y: 5 } });
        await page.waitForTimeout(150);
        check('clicking the overlay backdrop closes it too',
            await page.isHidden('#benefits-overlay'));
        check('no uncaught page errors', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- Settings from the header menu, on the tracker -------------------
    {
        const { context, page } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#menuBtn', { timeout: 5000 });
        await page.click('#menuBtn');
        await page.click('#menu-settings-btn');
        await page.waitForTimeout(150);
        check('Settings opens the existing settings sheet directly',
            await page.isVisible('#settings-modal'));
        await context.close();
    }

    // --- Reminders from the header menu, not signed in ---------------------
    // (Signed-in behaviour — landing on the account sheet's reminder block
    // — is covered in account.test.js, which already has the fake account
    // module this needs.)
    {
        const { context, page } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#menuBtn', { timeout: 5000 });
        await page.click('#menuBtn');
        await page.click('#menu-reminders-btn');
        await page.waitForTimeout(150);
        check('Reminders asks to sign in first when there is no account yet',
            await page.isVisible('#signin-modal'));
        await context.close();
    }

    // --- Settings from the header menu, on the reader ---------------------
    // Needs a real HTTP server: unlike file://, only http(s) serving resolves
    // a bare directory ("../") to its index.html on its own, which is what
    // the redirect relies on and what the site actually does in production.
    {
        const http = require('http');
        const fs = require('fs');
        const DIST = path.resolve(__dirname, '..', 'dist');
        const PORT = Number(process.env.MENU_PORT || 8848);
        const BASE = 'http://localhost:' + PORT;
        const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

        const server = http.createServer((req, res) => {
            const url = new URL(req.url, BASE);
            if (url.pathname.endsWith('/kids-quest-cloud.js')) {
                res.writeHead(200, { 'content-type': TYPES['.js'] });
                return res.end('/* stubbed by the test */');
            }
            let file = path.join(DIST, decodeURIComponent(url.pathname));
            if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
            if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); return res.end('not found');
            }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
            fs.createReadStream(file).pipe(res);
        });
        await new Promise((resolve) => server.listen(PORT, resolve));

        const { context, page } = await openPage(browser, BASE + '/quran-tracker/reader/');
        await page.waitForSelector('#menuBtn', { timeout: 5000 });
        await page.click('#menuBtn');
        await Promise.all([
            page.waitForURL(/\/quran-tracker\/\?settings=1$/, { timeout: 5000 }),
            page.click('#menu-settings-btn')
        ]);
        await page.waitForSelector('#settings-modal:not(.is-hidden)', { timeout: 5000 });
        check('Settings from the reader lands on the tracker, opened',
            await page.isVisible('#settings-modal'));
        check('and the ?settings=1 flag is cleaned off the URL',
            !/settings=1/.test(page.url()), page.url());
        await context.close();
        server.close();
    }

    // --- Hijri date correction ---------------------------------------------
    {
        const { context, page } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#local-setup:not(.is-hidden)', { timeout: 5000 });
        await page.fill('#user-name', 'Ahmad');
        await page.click('#setup-form button[type=submit]');
        await page.waitForTimeout(200);

        const before = (await page.textContent('#hijri-badge-top')).trim();
        check('the badge starts on the tabular calendar', before.includes('II 8'), before);

        await page.click('#menuBtn');
        await page.click('#menu-settings-btn');
        await page.waitForTimeout(150);
        check('the preview matches the badge before any adjustment',
            (await page.textContent('#hijri-preview')).includes('II 8'),
            await page.textContent('#hijri-preview'));

        await page.selectOption('#hijri-offset', '-1');
        await page.waitForTimeout(150);
        check('the preview updates to the corrected day',
            (await page.textContent('#hijri-preview')).includes('II 7'),
            await page.textContent('#hijri-preview'));
        check('and the dashboard badge updates live, without closing Settings',
            (await page.textContent('#hijri-badge-top')).includes('II 7'),
            await page.textContent('#hijri-badge-top'));
        check('the juz due shifts with it',
            (await page.textContent('#target-juz-title')).trim() === 'Juz 7',
            await page.textContent('#target-juz-title'));
        check('and the cycle day label agrees',
            (await page.textContent('#cycle-progress-label')).includes('Day 7'),
            await page.textContent('#cycle-progress-label'));

        await page.reload();
        await page.waitForTimeout(300);
        check('the correction survives a reload',
            (await page.textContent('#hijri-badge-top')).includes('II 7'),
            await page.textContent('#hijri-badge-top'));
        await context.close();
    }

    // --- The correction also relocates a *fresh* cycle start, not just the label
    {
        const { context, page } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#local-setup:not(.is-hidden)', { timeout: 5000 });
        await page.evaluate(() => localStorage.setItem('quran_hijri_offset', '-1'));
        await page.reload();
        await page.waitForSelector('#local-setup:not(.is-hidden)', { timeout: 5000 });

        const prefill = await page.inputValue('#start-date');
        check('a fresh cycle start is picked one real day later than the tabular one',
            prefill === '2026-09-13', prefill);

        await page.fill('#user-name', 'Ahmad');
        await page.click('#setup-form button[type=submit]');
        await page.waitForTimeout(200);
        check('so the whole dashboard is self-consistent with the correction',
            (await page.textContent('#hijri-badge-top')).includes('II 7') &&
            (await page.textContent('#target-juz-title')).trim() === 'Juz 7',
            (await page.textContent('#hijri-badge-top')) + ' / ' +
                (await page.textContent('#target-juz-title')));
        await context.close();
    }

    // --- Location -----------------------------------------------------------
    {
        const { context, page } = await openPage(browser, TRACKER_URL);
        await page.waitForSelector('#local-setup:not(.is-hidden)', { timeout: 5000 });
        await page.fill('#user-name', 'Ahmad');
        await page.click('#setup-form button[type=submit]');
        await page.waitForTimeout(200);

        await page.click('#menuBtn');
        await page.click('#menu-settings-btn');
        await page.waitForTimeout(150);
        check('location starts on automatic detection',
            (await page.inputValue('#location-select')) === '');
        check('and says what was detected',
            /detected automatically as/i.test(await page.textContent('#location-detected-hint')));

        await page.selectOption('#location-select', 'Africa/Addis_Ababa');
        await page.waitForTimeout(150);
        const stored = await page.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('quran_location_tz')); }
            catch (e) { return null; }
        });
        check('picking one is remembered', stored === 'Africa/Addis_Ababa', stored);
        await context.close();
    }

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('menu test harness error:', err);
    process.exit(2);
});
