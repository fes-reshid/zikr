/*
 * Checks the installable/offline behaviour of the built pages.
 *
 * Service workers need a real origin, so this serves dist/ over HTTP rather
 * than using file://. It also checks the worker's scope does not reach the
 * rest of the site, which matters because these pages are published into a
 * repo that serves a whole domain.
 *
 *   npm run test:pwa
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP pwa test: playwright-core is not installed (npm install).');
    process.exit(0);
}

const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PWA_PORT || 8842);
const BASE = 'http://localhost:' + PORT;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png'
};

function serve() {
    return http.createServer((req, res) => {
        let pathname = decodeURIComponent(new URL(req.url, BASE).pathname);

        // Stand in for the rest of the site, outside the worker's scope.
        if (pathname === '/elsewhere.html') {
            res.writeHead(200, { 'Content-Type': TYPES['.html'] });
            return res.end('<!DOCTYPE html><title>Elsewhere</title><p>Another page of the site.</p>');
        }

        let file = path.join(DIST, pathname);
        if (pathname.endsWith('/')) file = path.join(file, 'index.html');
        if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); return res.end('not found');
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    }).listen(PORT);
}

(async () => {
    const server = serve();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    const context = await browser.newContext();

    // Keep third parties out of it; none of them should be cached anyway.
    await context.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
    await context.route('https://api.quran.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{"recitations":[],"translations":[],"verses":[],"audio_files":[]}' }));

    const page = await context.newPage();

    // --- Manifest ---------------------------------------------------------
    await page.goto(BASE + '/quran-tracker/');
    const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
    check('the tracker links a manifest', manifestHref === './manifest.webmanifest', manifestHref);

    const manifest = await page.evaluate(async (href) => {
        const res = await fetch(href);
        return res.ok ? res.json() : null;
    }, manifestHref);
    check('the manifest parses', !!manifest);
    check('it installs standalone', manifest.display === 'standalone', manifest.display);
    check('it is scoped to the tracker', manifest.scope === './' && manifest.start_url === './',
        manifest.scope + ' | ' + manifest.start_url);
    check('it ships a maskable icon',
        manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
    check('it ships a 192 and a 512 icon',
        manifest.icons.some((i) => i.sizes === '192x192') &&
        manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));

    const iconStatuses = await page.evaluate(async (icons) => {
        const out = {};
        for (const icon of icons) out[icon.src] = (await fetch(icon.src)).status;
        return out;
    }, manifest.icons);
    check('every manifest icon resolves',
        Object.values(iconStatuses).every((s) => s === 200), JSON.stringify(iconStatuses));

    const appleIcon = await page.getAttribute('link[rel=apple-touch-icon]', 'href');
    check('an apple-touch-icon is declared', !!appleIcon, appleIcon);
    check('iOS is told it can run standalone',
        (await page.getAttribute('meta[name=apple-mobile-web-app-capable]', 'content')) === 'yes');

    // --- Service worker ---------------------------------------------------
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration()
        .then((r) => !!(r && r.active)), null, { timeout: 15000 });
    const scope = await page.evaluate(() =>
        navigator.serviceWorker.getRegistration().then((r) => r.scope));
    check('the worker is scoped to /quran-tracker/ only',
        scope === BASE + '/quran-tracker/', scope);

    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    check('the page is controlled by the worker after a reload', true);

    const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const cache = await caches.open(names[0]);
        const keys = await cache.keys();
        return { names, urls: keys.map((r) => new URL(r.url).pathname).sort() };
    });
    check('the cache is named for this build', /^quran-tracker-[a-f0-9]{12}$/.test(cached.names[0]),
        cached.names.join(', '));
    check('both pages are cached',
        cached.urls.includes('/quran-tracker/index.html') &&
        cached.urls.includes('/quran-tracker/reader/index.html'),
        cached.urls.join(' '));

    // --- Offline ----------------------------------------------------------
    await context.setOffline(true);

    await page.goto(BASE + '/quran-tracker/');
    check('the tracker opens with no network',
        (await page.textContent('h1')).includes("Qur'ān Daily Tracker"));

    await page.goto(BASE + '/quran-tracker/reader/?juz=9');
    check('the reader opens with no network too',
        (await page.getAttribute('link[rel=manifest]', 'href')) === '../manifest.webmanifest');
    check('and a juz in the query still resolves from cache',
        (await page.inputValue('#juz-selector')) === '9',
        await page.inputValue('#juz-selector'));

    // The rest of the site must not be swallowed by this worker.
    const elsewhere = await page.evaluate(async (url) => {
        try { const r = await fetch(url); return r.status; } catch (e) { return 'network error'; }
    }, BASE + '/elsewhere.html');
    check('pages outside the scope are left to the network',
        elsewhere === 'network error', String(elsewhere));

    await context.setOffline(false);
    await page.goto(BASE + '/elsewhere.html');
    check('and they still load normally when online',
        (await page.textContent('p')).includes('Another page'));

    // --- iOS install hint -------------------------------------------------
    // Safari never fires beforeinstallprompt, so the page must say how to
    // install rather than offer a button that cannot work.
    const iosContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
    });
    await iosContext.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const iosPage = await iosContext.newPage();
    await iosPage.addInitScript(() => {
        try {
            localStorage.setItem('quran_user_profile',
                JSON.stringify({ name: 'Ahmad', startDate: '2026-09-12' }));
        } catch (e) { /* ignore */ }
    });
    await iosPage.goto(BASE + '/quran-tracker/');
    await iosPage.waitForTimeout(600);

    check('iPhone visitors are shown how to install',
        await iosPage.isVisible('#install-row'));
    check('with Safari\'s actual steps, not a button',
        (await iosPage.isVisible('#ios-install-hint')) &&
        !(await iosPage.isVisible('#install-btn')));
    check('naming Share and Add to Home Screen',
        /Share/.test(await iosPage.textContent('#ios-install-hint')) &&
        /Home Screen/.test(await iosPage.textContent('#ios-install-hint')));
    await iosPage.screenshot({ path: process.env.SHOT_DIR
        ? process.env.SHOT_DIR + '/10-install.png' : '/tmp/10-install.png', fullPage: true });
    await iosContext.close();

    // A desktop browser with no install support should not be nagged.
    const plain = await browser.newContext();
    await plain.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const plainPage = await plain.newPage();
    await plainPage.goto(BASE + '/quran-tracker/');
    await plainPage.waitForTimeout(500);
    check('desktop is not nagged to install', await plainPage.isHidden('#install-row'));
    await plain.close();

    await browser.close();
    server.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('pwa test harness error:', err);
    process.exit(2);
});
