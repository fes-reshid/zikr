/*
 * Makes the screenshots in the video editor's help page (video-editor/help-img/)
 * by driving the real editor in a headless browser with made-up photos and a
 * voice. Qur'an.com is answered with a small stand-in so it works offline.
 *
 *   node tools/help-screenshots.js            (needs playwright-core and Chromium)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright-core');

const SRC = path.join(__dirname, '..', 'video-editor');
const OUT = path.join(SRC, 'help-img');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg' };

function serve() {
    return new Promise(function (resolve) {
        const server = http.createServer(function (req, res) {
            const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
            const file = path.join(SRC, rel);
            if (!file.startsWith(SRC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function wav(pcm, rate) {
    const buf = Buffer.alloc(44 + pcm.length * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40);
    pcm.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
    return buf;
}

/** A voice-like sound: phrases of wobbling tone with pauses between. */
function voice(phrases, gap, rate) {
    const pcm = [];
    phrases.forEach(function (len, k) {
        const n = Math.floor(len * rate);
        for (let i = 0; i < n; i += 1) {
            const t = i / rate;
            const syll = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * t * 3.2));
            const env = Math.min(1, t / 0.05, (len - t) / 0.08);
            pcm.push(env * syll * 0.45 * (Math.sin(2 * Math.PI * (180 + 25 * Math.sin(t * 2 + k)) * t) + 0.3 * Math.sin(2 * Math.PI * 360 * t)));
        }
        if (k < phrases.length - 1) for (let i = 0; i < gap * rate; i += 1) pcm.push((Math.random() - 0.5) * 0.004);
    });
    return wav(pcm, rate);
}

function quranApi(url) {
    const u = new URL(url);
    const p = u.pathname.replace('/api/v4', '');
    const verses = [['بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'],
        ['ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ', '[All] praise is [due] to Allah, Lord of the worlds.'],
        ['ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'The Entirely Merciful, the Especially Merciful.']];
    if (p === '/chapters') return { chapters: [{ id: 1, name_simple: 'Al-Fatihah', name_arabic: 'الفاتحة', verses_count: 7, translated_name: { name: 'The Opener' } }] };
    if (p === '/resources/recitations') return { recitations: [{ id: 7, reciter_name: 'Mishari Rashid al-`Afasy', style: null, translated_name: { name: 'Mishari Rashid al-`Afasy' } }] };
    if (p === '/resources/translations') {
        return { translations: [{ id: 20, name: 'Saheeh International', author_name: 'Saheeh International', language_name: 'english' },
            { id: 140, name: 'Oromo', author_name: 'Ghali Aba Hulgaa', language_name: 'oromo' }] };
    }
    if (p === '/verses/by_chapter/1') {
        return { verses: verses.map((v, i) => ({ verse_key: '1:' + (i + 1), verse_number: i + 1, text_uthmani: v[0], translations: [{ text: v[1] }] })), pagination: { next_page: null } };
    }
    if (p === '/recitations/7/by_chapter/1') {
        return {
            audio_files: verses.map(function (v, i) {
                const words = v[0].split(/\s+/);
                return { verse_key: '1:' + (i + 1), url: 'Alafasy/mp3/00100' + (i + 1) + '.mp3', segments: words.map((w, k) => [k + 1, k * 700, (k + 1) * 700]) };
            }),
            pagination: { next_page: null }
        };
    }
    return null;
}

/** Paints a few photo-like pictures in the page and returns them as PNG files. */
async function makePhotos(page) {
    const list = await page.evaluate(function () {
        function scene(kind) {
            const c = document.createElement('canvas');
            c.width = 1280;
            c.height = 720;
            const g = c.getContext('2d');
            const sky = g.createLinearGradient(0, 0, 0, 720);
            const skies = { dawn: ['#1d2b64', '#f8a978'], desert: ['#f6d365', '#fda085'], night: ['#0b1026', '#2b3a67'], green: ['#89f7fe', '#66a6ff'] };
            sky.addColorStop(0, skies[kind][0]);
            sky.addColorStop(1, skies[kind][1]);
            g.fillStyle = sky;
            g.fillRect(0, 0, 1280, 720);
            if (kind === 'night') {
                g.fillStyle = '#fff';
                for (let i = 0; i < 160; i += 1) g.fillRect((i * 397) % 1280, (i * 211) % 420, 2, 2);
                g.fillStyle = '#f5f0c8';
                g.beginPath(); g.arc(980, 150, 60, 0, Math.PI * 2); g.fill();
                g.fillStyle = '#2b3a67';
                g.beginPath(); g.arc(1005, 135, 55, 0, Math.PI * 2); g.fill();
            } else {
                g.fillStyle = 'rgba(255,240,200,.9)';
                g.beginPath(); g.arc(kind === 'desert' ? 300 : 900, kind === 'dawn' ? 470 : 200, 70, 0, Math.PI * 2); g.fill();
            }
            if (kind === 'desert') {
                g.fillStyle = '#d98b4f';
                g.beginPath(); g.moveTo(0, 560); g.quadraticCurveTo(400, 420, 800, 560); g.quadraticCurveTo(1050, 640, 1280, 520); g.lineTo(1280, 720); g.lineTo(0, 720); g.fill();
                g.fillStyle = '#b86b35';
                g.beginPath(); g.moveTo(0, 650); g.quadraticCurveTo(600, 540, 1280, 660); g.lineTo(1280, 720); g.lineTo(0, 720); g.fill();
            } else if (kind === 'green') {
                g.fillStyle = '#3c8d5a';
                g.beginPath(); g.moveTo(0, 500); g.quadraticCurveTo(320, 380, 640, 480); g.quadraticCurveTo(960, 580, 1280, 450); g.lineTo(1280, 720); g.lineTo(0, 720); g.fill();
                g.fillStyle = '#2a6b42';
                g.beginPath(); g.moveTo(0, 620); g.quadraticCurveTo(640, 520, 1280, 640); g.lineTo(1280, 720); g.lineTo(0, 720); g.fill();
            } else {
                // A mosque on the skyline.
                g.fillStyle = kind === 'night' ? '#05070f' : '#26213b';
                g.fillRect(0, 560, 1280, 160);
                g.fillRect(470, 420, 340, 160);
                g.beginPath(); g.arc(640, 420, 120, Math.PI, 0); g.fill();
                g.fillRect(636, 270, 8, 40);
                [400, 870].forEach(function (x) { g.fillRect(x, 300, 22, 280); g.beginPath(); g.moveTo(x - 4, 300); g.lineTo(x + 11, 250); g.lineTo(x + 26, 300); g.fill(); });
            }
            return c.toDataURL('image/png').split(',')[1];
        }
        return ['dawn', 'desert', 'night', 'green'].map((k) => [k, scene(k)]);
    });
    return list.map((x) => ({ name: x[0] + '.png', mimeType: 'image/png', buffer: Buffer.from(x[1], 'base64') }));
}

(async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const server = await serve();
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await context.route(/api\.quran\.com/, function (route) {
        const body = quranApi(route.request().url());
        return route.fulfill(body ? { status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) } : { status: 404, body: '{}' });
    });
    await context.route(/verses\.quran\.com|everyayah/, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' }, body: voice([2.1], 0, 16000) }));
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    const shot = async function (name, target, opts) {
        const file = path.join(OUT, name + '.jpg');
        const o = Object.assign({ path: file, type: 'jpeg', quality: 80 }, opts);
        await page.evaluate(() => window.ReelApp.zoomToFit());
        await page.waitForTimeout(150);
        if (target) await target.screenshot(o); else await page.screenshot(o);
        console.log('saved', name, Math.round(fs.statSync(file).size / 1024) + ' KB');
    };
    const dialog = () => page.locator('.modal.generic .dialog');
    const closeDialog = async () => { await page.keyboard.press('Escape'); await page.waitForSelector('.modal.generic', { state: 'detached' }).catch(() => null); };
    const seek = (t) => page.evaluate((x) => { window.Reel.seek(x); }, t);
    const settle = () => page.waitForTimeout(500);
    const menu = async (which, name) => {
        await page.click('#' + which);
        await page.locator('#' + which + '-menu').getByRole('menuitem', { name: name, exact: typeof name === 'string' }).click();
    };

    await page.goto(base + '/index.html');
    await page.check('#consentCheck');
    await page.click('#consentAgree');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.addStyleTag({ content: '.toast, #toast, [class*="toast"] { display: none !important; }' });

    /* 1. Your first video */
    const photos = await makePhotos(page);
    const talk = { name: 'Talk.wav', mimeType: 'audio/wav', buffer: voice([2.4, 1.8, 2.6, 2.0, 2.2, 1.6], 0.7, 22050) };
    await page.setInputFiles('#import-input', photos.concat([talk]));
    await page.waitForFunction(() => document.querySelectorAll('.media-item').length === 5, null, { timeout: 20000 });
    await page.evaluate(function () {
        const p = window.Reel.project;
        ['dawn.png', 'desert.png'].forEach((n) => window.ReelApp.addToTimeline(p.media.find((m) => m.name === n).id));
    });
    await settle();
    await shot('first-photos');
    await page.click('#create');
    await settle();
    await shot('menus-create', null, { clip: { x: 640, y: 0, width: 800, height: 880 } });
    await page.keyboard.press('Escape');
    await page.evaluate(function () {
        const p = window.Reel.project;
        window.ReelApp.addToTimeline(p.media.find((m) => m.name === 'Talk.wav').id);
    });
    await seek(1.2);
    await page.click('#add-text');
    await page.keyboard.type('Assalamu alaykum');
    await seek(2.2);
    await settle();
    await shot('first-title');
    await page.click('#export');
    await page.waitForSelector('#export-dialog:not([hidden]) .dialog');
    await settle();
    await shot('first-export', page.locator('#export-dialog .dialog'));
    await page.locator('#export-targets button', { hasText: 'YouTube Shorts' }).click();
    await settle();
    await shot('export-made-for', page.locator('#export-dialog .dialog'));
    await page.locator('#export-targets button', { hasText: 'Anywhere' }).click();
    await page.click('#export-cancel');

    /* Reference pictures: the whole screen, the timeline, the side panel's sections and each tool's window. */
    const panel = page.locator('.panel.inspector');
    const clipOf = (name) => page.evaluate((n) => { const p = window.Reel.project; const m = p.media.find((x) => x.name === n); const c = m && p.clips.find((x) => x.mediaId === m.id); return c ? c.id : null; }, name);
    const showGroup = async (title) => {
        const g = page.locator('#inspector .group-title', { hasText: new RegExp('^' + title + '$') }).first();
        await g.scrollIntoViewIfNeeded();
        await page.evaluate((t) => {
            const el = Array.from(document.querySelectorAll('#inspector .group-title')).find((x) => x.textContent === t);
            if (el) el.parentNode.scrollIntoView({ block: 'start' });
        }, title);
        await page.waitForTimeout(250);
    };
    await page.evaluate(() => window.Reel.select(null));
    await seek(2.2);
    await settle();
    await shot('screen-map');
    const dawn = await clipOf('dawn.png');
    await page.evaluate((id) => window.Reel.select(id), dawn);
    await seek(1.6);
    await page.click('#tool-split');
    await settle();
    await shot('edit-timeline', page.locator('.timeline-panel'));
    await page.keyboard.press('Control+z');
    const titleId = await page.evaluate(() => (window.Reel.project.clips.find((c) => c.type === 'text') || {}).id);
    await page.evaluate((id) => window.Reel.select(id), titleId);
    await settle();
    await shot('title-inspector', panel);
    await page.evaluate((id) => window.Reel.select(id), dawn);
    await settle();
    await showGroup('Keyframes');
    await shot('keyframes', panel);
    await showGroup('Look');
    await shot('effects', panel);
    await page.evaluate((id) => window.Reel.select(id), await clipOf('Talk.wav'));
    await settle();
    await showGroup('Sound');
    await shot('sound-inspector', panel);
    await page.evaluate(() => window.Reel.select(null));
    const dialogShot = async (which, item, name, wait, prepare) => {
        await menu(which, item);
        await page.waitForTimeout(wait || 700);
        if (prepare) { await prepare(); await page.waitForTimeout(500); }
        await page.evaluate(() => document.querySelectorAll('.modal.generic, .modal.generic *').forEach((e) => { e.scrollTop = 0; }));
        await shot(name, dialog());
        await closeDialog();
    };
    await dialogShot('tools', /Transition gallery/, 'transitions', 1200);
    await dialogShot('create', /Hadith video/, 'hadith');
    await dialogShot('create', /Nasheed lyrics/, 'lyrics');
    await dialogShot('create', /Animated stickers/, 'stickers', 1200, () => page.evaluate(() => {
        // Show a crescent and star rather than the first sticker, an arrow.
        const sel = Array.from(document.querySelectorAll('.modal.generic select')).find((x) => Array.from(x.options).some((o) => /crescent/i.test(o.text)));
        if (!sel) return;
        sel.value = Array.from(sel.options).find((o) => /crescent/i.test(o.text)).value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    await dialogShot('create', /Sound library/, 'sounds');
    await dialogShot('create', /Record screen/, 'record');
    await dialogShot('tools', /Resize for social media/, 'resize', 900);
    await dialogShot('file', 'My projects…', 'projects');

    /* 2. Pictures on the pauses */
    await page.evaluate(function () {
        // Start again with only the voice on the timeline.
        const T = window.ReelApp.T;
        const p = T.clone(window.Reel.project);
        p.clips = p.clips.filter((c) => c.mediaId && T.getMedia(p, c.mediaId).type === 'audio');
        p.clips.forEach((c) => { c.start = 0; });
        window.ReelApp.apply(p);
        window.ReelApp.zoomToFit();
        window.Reel.select(p.clips[0].id);
    });
    await menu('create', /Pictures on the pauses/);
    await dialog().locator('.sync-found', { hasText: /Found/ }).waitFor();
    await dialog().getByRole('spinbutton', { name: 'Shortest scene (seconds)' }).fill('2');
    await dialog().getByRole('spinbutton', { name: 'Shortest scene (seconds)' }).dispatchEvent('input');
    await settle();
    await shot('pauses-dialog', dialog());
    await dialog().getByRole('button', { name: 'Apply' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached' });
    await seek(5);
    await settle();
    await shot('pauses-result');

    /* 3. Captions in Afaan Oromoo, Amharic and Somali */
    await menu('tools', /Auto captions/);
    await dialog().getByRole('combobox', { name: 'Language' }).selectOption('oromo');
    await dialog().getByRole('textbox', { name: 'What is said' }).fill('Assalaamu alaykum, akkam jirtu?\nHar’a waa’ee obsaa haa dubbannu.\nRabbiin obsitoota wajjin jira.\nObsi furtuu gammachuu ti.\nGalatoomaa.\nNagaan turaa.');
    await settle();
    await shot('captions-oromo', dialog());
    await dialog().getByRole('button', { name: 'Make captions' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
    await page.evaluate(() => window.Reel.select(null));
    await seek(3.6);
    await settle();
    await shot('captions-result', page.locator('.viewer'));
    await menu('tools', /Auto captions/);
    await dialog().getByRole('combobox', { name: 'Language' }).selectOption('amharic');
    await settle();
    await shot('captions-amharic', dialog());
    await closeDialog();

    /* 4. Write by hand */
    await page.evaluate(function () {
        const T = window.ReelApp.T;
        const p = T.clone(window.Reel.project);
        p.clips = p.clips.filter((c) => c.type !== 'text');
        window.ReelApp.apply(p);
    });
    await seek(0.2);
    await page.click('#add-handwrite');
    await page.keyboard.type('Be patient');
    await seek(1.7);
    await settle();
    await shot('handwrite');

    /* 5. Draw */
    await seek(8);
    await page.click('#add-draw');
    await page.waitForSelector('#draw-layer');
    const box = await page.locator('#draw-layer').boundingBox();
    const pts = [];
    for (let i = 0; i <= 40; i += 1) { const a = i / 40 * Math.PI * 1.7 + 0.6; pts.push([0.5 + Math.cos(a) * 0.18, 0.45 + Math.sin(a) * 0.28]); }
    await page.mouse.move(box.x + box.width * pts[0][0], box.y + box.height * pts[0][1]);
    await page.mouse.down();
    for (const pt of pts) await page.mouse.move(box.x + box.width * pt[0], box.y + box.height * pt[1], { steps: 2 });
    await page.mouse.up();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.2);
    await page.mouse.down();
    for (let i = 0; i <= 10; i += 1) await page.mouse.move(box.x + box.width * (0.62 + i * 0.01), box.y + box.height * (0.2 + i * 0.02), { steps: 2 });
    await page.mouse.up();
    await settle();
    await shot('drawing');
    await page.keyboard.press('Escape');
    await page.locator('#draw-bar').getByRole('button', { name: /Done/ }).click().catch(() => null);
    await settle();

    /* 6. Qur'an verse video with each word highlighted */
    await menu('create', /Qur’ān verse video/);
    await dialog().getByRole('combobox', { name: 'Recitation' }).locator('option[value="rec:7"]').waitFor({ state: 'attached' });
    await dialog().getByRole('combobox', { name: 'Recitation' }).selectOption('rec:7');
    await dialog().getByRole('spinbutton', { name: 'To ayah' }).fill('3');
    await dialog().getByRole('spinbutton', { name: 'To ayah' }).dispatchEvent('change');
    const hl = dialog().getByRole('checkbox', { name: /Highlight each word/ });
    if (await hl.count()) await hl.check();
    await settle();
    await shot('quran-dialog', dialog());
    await dialog().getByRole('button', { name: 'Make video' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
    const qStart = await page.evaluate(function () {
        const p = window.Reel.project;
        const c = p.clips.filter((x) => x.type === 'text' && x.lyricStyle === 'karaoke').sort((a, b) => a.start - b.start)[0];
        return c ? c.start + 1.6 : 0;
    });
    await seek(qStart);
    await page.evaluate(() => window.Reel.select(null));
    await settle();
    await shot('quran-frame', page.locator('.viewer'));

    /* 7. Templates, brand kit and Shorts */
    await menu('create', 'Templates…');
    await settle();
    await page.waitForTimeout(800);
    await page.evaluate(function () {
        document.activeElement.blur();
        document.querySelectorAll('.modal.generic, .modal.generic *').forEach((e) => { e.scrollTop = 0; });
    });
    await shot('templates', dialog());
    await closeDialog();
    await menu('create', 'Brand kit…');
    await settle();
    await shot('brand-kit', dialog());
    await closeDialog();
    await seek(0);
    await menu('create', /Make a Short/);
    await settle();
    await dialog().getByRole('textbox', { name: 'Title' }).fill('Be patient — Allah is with the patient');
    await shot('short-dialog', dialog());
    await dialog().getByRole('button', { name: 'Make Short' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached' });
    await seek(2);
    await settle();
    await shot('short-result');

    /* 8. An occasion video */
    await menu('file', 'New tab');
    await menu('view', /1280×720/);
    await page.setInputFiles('#import-input', [talk]);
    await page.waitForFunction(() => window.Reel.project.media.some((m) => m.name === 'Talk.wav'), null, { timeout: 20000 });
    await page.evaluate(function () {
        const m = window.Reel.project.media.find((x) => x.name === 'Talk.wav');
        window.ReelApp.addToTimeline(m.id);
        window.Reel.select(window.Reel.project.clips[0].id);
    });
    await menu('create', /Occasion video/);
    await dialog().getByRole('combobox', { name: 'Occasion' }).selectOption('ramadan');
    await settle();
    await shot('occasion-dialog', dialog());
    await dialog().getByRole('button', { name: 'Make video' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
    await page.evaluate(() => window.Reel.select(null));
    await seek(1.6);
    await settle();
    await shot('occasion-result');

    /* 10. A Qur'an video with a new background each ayah */
    await menu('file', 'New tab');
    await menu('create', /Qur’ān verse video/);
    await dialog().getByRole('combobox', { name: 'Recitation' }).locator('option[value="rec:7"]').waitFor({ state: 'attached' });
    await dialog().getByRole('combobox', { name: 'Recitation' }).selectOption('rec:7');
    await dialog().getByRole('spinbutton', { name: 'To ayah' }).fill('3');
    await dialog().getByRole('spinbutton', { name: 'To ayah' }).dispatchEvent('change');
    await dialog().getByRole('combobox', { name: 'Background' }).selectOption('scenes:jumuah');
    await settle();
    await shot('quran-scenes-dialog', dialog());
    await dialog().getByRole('button', { name: 'Make video' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
    await page.evaluate(() => window.Reel.select(null));
    await seek(await page.evaluate(() => {
        const p = window.Reel.project;
        const c = p.clips.filter((x) => x.type === 'text' && x.lyricStyle === 'karaoke').sort((a, b) => a.start - b.start)[1];
        return c.start + 1;
    }));
    await settle();
    await shot('quran-scenes-result');

    /* 11. Auto-reframe */
    await menu('file', 'New tab');
    await menu('view', /1280×720/);
    const talker = await page.evaluate(async function () {
        // A wide clip of a speaker who walks from the left to the right of the picture.
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 360;
        const g = c.getContext('2d');
        const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const began = performance.now();
        rec.start();
        await new Promise(function (resolve) {
            (function frame() {
                const u = Math.min(1, (performance.now() - began) / 3000);
                const sky = g.createLinearGradient(0, 0, 0, 360);
                sky.addColorStop(0, '#2c3e50');
                sky.addColorStop(1, '#4b6584');
                g.fillStyle = sky;
                g.fillRect(0, 0, 640, 360);
                g.fillStyle = '#3d6b4a';
                g.fillRect(0, 270, 640, 90);
                g.fillStyle = '#8fa3b8';
                g.fillRect(40, 60, 150, 110);
                g.fillStyle = '#3b5b7a';
                g.fillRect(48, 68, 134, 94);
                const x = 120 + u * 400;
                g.fillStyle = '#1f2a44';
                g.beginPath();
                g.ellipse(x, 300, 70, 110, 0, Math.PI, 0);
                g.fill();
                g.fillStyle = '#c68e62';
                g.beginPath();
                g.ellipse(x, 150, 38, 48, 0, 0, Math.PI * 2);
                g.fill();
                g.fillStyle = '#1a1a1a';
                g.beginPath();
                g.ellipse(x, 118, 40, 22, 0, Math.PI, 0);
                g.fill();
                if (u < 1) requestAnimationFrame(frame); else resolve();
            }());
        });
        rec.stop();
        await new Promise((r) => { rec.onstop = r; });
        const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
        let bin = '';
        new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
        return btoa(bin);
    });
    await page.setInputFiles('#import-input', [{ name: 'Speaker.webm', mimeType: 'video/webm', buffer: Buffer.from(talker, 'base64') }]);
    await page.waitForFunction(() => window.Reel.project.media.some((m) => m.name === 'Speaker.webm'), null, { timeout: 20000 });
    await page.evaluate(function () {
        const m = window.Reel.project.media.find((x) => x.name === 'Speaker.webm');
        window.ReelApp.addToTimeline(m.id);
    });
    await menu('view', /1080×1920/);
    await page.evaluate(function () {
        // The real offline face finder (skin colour), so the result does not depend on a download.
        window.__reelTestFaceDetector = window.ReelReframe.skinCentre;
        const c = window.Reel.project.clips[0];
        window.Reel.select(c.id);
    });
    await menu('tools', /Auto-reframe/);
    await settle();
    await shot('reframe-dialog', dialog());
    await dialog().getByRole('button', { name: 'Follow the face' }).click();
    await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
    await seek(2.4);
    await settle();
    await shot('reframe-result');

    /* 12. On a phone */
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await phone.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const mobile = await phone.newPage();
    await mobile.goto(base + '/index.html');
    if (await mobile.locator('#consentCheck').isVisible()) { await mobile.check('#consentCheck'); await mobile.click('#consentAgree'); }
    await mobile.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await mobile.addStyleTag({ content: '.toast, #toast { display: none !important; }' });
    await mobile.evaluate(() => document.querySelectorAll('.modal.generic').forEach((m) => m.remove()));
    await mobile.evaluate(async () => { await window.ReelOccasions.makeOccasion({ occasion: 'eid-fitr', title: 'Eid Mubarak', arabic: 'عيد مبارك', sub: 'Taqabbal Allahu minna wa minkum', end: 'Eid Mubarak' }); window.Reel.select(null); window.Reel.seek(1.6); });
    await mobile.waitForTimeout(1500);
    const mshot = async (name) => { await mobile.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 80 }); console.log('saved', name); };
    await mshot('phone-layout');
    await mobile.click('#create');
    await mobile.waitForTimeout(400);
    await mshot('phone-menu');
    await phone.close();

    await browser.close();
    server.close();
}()).catch(function (err) { console.error(err); process.exit(1); });
