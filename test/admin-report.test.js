/*
 * The admin reading report, from the browser's side.
 *
 * kids-quest-cloud.js and the reminder API are both stubbed, so this covers
 * what the panel does with them: who it shows itself to, how it joins names to
 * ticks, and that the workbook it downloads is a real one — the bytes are
 * pulled back out of the Blob and parsed by an actual spreadsheet reader.
 *
 *   npm run test:admin
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium, XLSX;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP admin report test: playwright-core is not installed (npm install).');
    process.exit(0);
}
try { XLSX = require('xlsx'); } catch (err) { XLSX = null; }

const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.ADMIN_PORT || 8848);
const BASE = 'http://localhost:' + PORT;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

const TODAY = '2026-09-18';
const DAYS = ['2026-09-16', '2026-09-17', '2026-09-18'];

// uid -> the days that account marked read
const READINGS = {
    'uid-amina': ['2026-09-16', '2026-09-17', '2026-09-18'],
    'uid-omar': ['2026-09-18'],
    'uid-zaynab': []
};

let apiCalls = [];

/* A stand-in for kids-admin.html: just the mount point and the script. */
const HARNESS = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin</title>
<style>.card{border:1px solid #ccc;padding:16px;} .btn{padding:6px 12px;} .empty{color:#999;}</style>
</head><body>
<h1>Kids Quest — Students</h1>
<div id="quran-tracker-report" data-api="/quran-tracker/api/"></div>
<script src="/quran-tracker/admin-report.js"></script>
</body></html>`;

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, BASE);
            if (url.pathname === '/admin') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                return res.end(HARNESS);
            }
            if (url.pathname === '/quran-tracker/api/admin/report') {
                apiCalls.push({ auth: req.headers.authorization, query: url.search });
                if (!/^Bearer .+/.test(req.headers.authorization || '')) {
                    res.writeHead(401); return res.end('{}');
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({
                    from: DAYS[0], to: DAYS[DAYS.length - 1], days: DAYS, readings: READINGS
                }));
            }
            const file = path.join(DIST, decodeURIComponent(url.pathname));
            if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
            fs.createReadStream(file).pipe(res);
        }).listen(PORT, () => resolve(server));
    });
}

const FAKE_CLOUD = (role) => {
    window.KidsCloud = {
        onAdminAuth: function (cb) {
            cb(role ? { email: 'teacher@diinislaam.com', role: role } : null);
        },
        getIdToken: function () { return Promise.resolve('admin-id-token'); },
        adminListStudents: function () {
            return Promise.resolve([
                { uid: 'uid-amina', username: 'amina123', displayName: 'amina123',
                  fullName: 'Amina Bekele' },
                { uid: 'uid-omar', username: 'omar7', displayName: 'omar7', fullName: '' },
                { uid: 'uid-zaynab', username: 'zaynab', displayName: 'zaynab',
                  fullName: 'Zaynab & Co <test>' },
                { uid: 'uid-gone', username: 'left', displayName: 'left', disabled: true }
            ]);
        }
    };
    window.dispatchEvent(new Event('kidscloud-ready'));
};

const CAPTURE_DOWNLOADS = () => {
    window.__downloads = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
        blob.arrayBuffer().then(function (buffer) {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            window.__downloads.push({ type: blob.type, b64: btoa(binary) });
        });
        return original ? original.call(URL, blob) : 'blob:stub';
    };
};

async function openAdmin(browser, role) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(CAPTURE_DOWNLOADS);
    await page.addInitScript(FAKE_CLOUD, role);
    await page.clock.install({ time: new Date(TODAY + 'T10:00:00Z') });
    await page.goto(BASE + '/admin');
    await page.waitForTimeout(800);
    return { context, page, errors };
}

(async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

    // --- Who sees it ------------------------------------------------------
    {
        const { context, page } = await openAdmin(browser, null);
        check('a signed-out visitor sees no report', await page.isHidden('#qt-card'));
        await context.close();
    }
    {
        apiCalls = [];
        const { context, page } = await openAdmin(browser, null);
        await page.waitForTimeout(400);
        check('and it is never even requested', apiCalls.length === 0, apiCalls.length);
        await context.close();
    }

    // --- The table --------------------------------------------------------
    {
        apiCalls = [];
        const { context, page, errors } = await openAdmin(browser, 'admin');
        await page.waitForSelector('#qt-report-table', { timeout: 8000 });
        check('an admin sees the report', await page.isVisible('#qt-card'));
        check('fetched with the admin token',
            apiCalls.length === 1 && apiCalls[0].auth === 'Bearer admin-id-token',
            apiCalls[0] && apiCalls[0].auth);
        check('for the last seven days by default',
            apiCalls[0].query.includes('from=2026-09-12&to=2026-09-18'), apiCalls[0].query);

        const headers = await page.$$eval('#qt-report-table thead th',
            (els) => els.map((e) => e.textContent.trim()));
        check('there is a column per day plus a total',
            headers.length === DAYS.length + 2, JSON.stringify(headers));
        check('and today is marked as such', /today/i.test(headers[headers.length - 2]),
            headers[headers.length - 2]);

        const rows = await page.$$eval('#qt-report-table tbody tr', (els) =>
            els.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
        check('every registered student is a row, read or not', rows.length === 3, rows.length);
        check('a student who left is not listed',
            !JSON.stringify(rows).includes('left'), JSON.stringify(rows));

        check('someone who read every day is all ticks',
            rows[0][0].startsWith('Amina Bekele') &&
            rows[0].slice(1, 4).join('') === '✅✅✅', JSON.stringify(rows[0]));
        check('someone who read once has one tick and two crosses',
            rows[1].slice(1, 4).join('') === '❌❌✅', JSON.stringify(rows[1]));
        check('someone who never read is all crosses',
            rows[2].slice(1, 4).join('') === '❌❌❌', JSON.stringify(rows[2]));
        check('and each row totals its ticks',
            rows[0][4] === '3 / 3' && rows[1][4] === '1 / 3' && rows[2][4] === '0 / 3',
            [rows[0][4], rows[1][4], rows[2][4]].join(' '));

        const summaryText = await page.textContent('#qt-summary');
        check('the summary counts who read today',
            /3 registered/.test(summaryText) && /2 read today/.test(summaryText), summaryText);

        check('the full name is shown with the username beneath',
            (await page.textContent('#qt-report-table tbody tr:first-child .qt-name'))
                .includes('amina123'));
        check('a name with markup in it is escaped, not rendered',
            (await page.$('#qt-report-table tbody tr td.qt-name test')) === null &&
            JSON.stringify(rows).includes('<test>'));
        check('no uncaught errors', errors.length === 0, errors.join(' | '));

        // --- The download -------------------------------------------------
        await page.click('#qt-download');
        await page.waitForFunction(() => window.__downloads.length > 0, null, { timeout: 5000 });
        const download = await page.evaluate(() => window.__downloads[0]);
        check('the download is an xlsx, not a csv',
            download.type.includes('spreadsheetml.sheet'), download.type);

        if (XLSX) {
            const workbook = XLSX.read(Buffer.from(download.b64, 'base64'), { type: 'buffer' });
            const grid = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],
                { header: 1 });
            check('a real spreadsheet reader opens it', grid.length === 4, grid.length);
            check('with a header naming each day',
                grid[0][0] === 'Student' && grid[0].slice(2, 5).join(',') === DAYS.join(','),
                JSON.stringify(grid[0]));
            check('the ticks survive the round trip',
                grid[1].slice(2, 5).join('') === '✅✅✅' &&
                grid[3].slice(2, 5).join('') === '❌❌❌',
                JSON.stringify(grid[1]));
            check('and the totals are numbers, not text',
                typeof grid[1][5] === 'number' && grid[1][5] === 3, typeof grid[1][5]);
        } else {
            console.log('note: xlsx reader not installed, skipped parsing the workbook');
        }
        await context.close();
    }

    // --- Changing the range ----------------------------------------------
    {
        apiCalls = [];
        const { context, page } = await openAdmin(browser, 'super');
        await page.waitForSelector('#qt-report-table', { timeout: 8000 });
        check('a super admin sees it too', await page.isVisible('#qt-card'));
        apiCalls = [];
        await page.fill('#qt-from', '2026-09-18');
        await page.waitForTimeout(600);
        check('changing the range refetches',
            apiCalls.length === 1 && apiCalls[0].query.includes('from=2026-09-18'),
            apiCalls[0] && apiCalls[0].query);
        await context.close();
    }

    await browser.close();
    server.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('admin report test harness error:', err);
    process.exit(2);
});
