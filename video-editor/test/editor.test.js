/*
 * End-to-end test of the video editor in headless Chromium.
 *
 * The editor is served over HTTP at /video-editing/ as on diinislaam.com,
 * next to a stand-in /audio-editor/, and Quran.com is stubbed. The media is
 * made on the spot: a two-second WebM recorded in the page with MediaRecorder
 * (so it has the Infinity duration real recordings have), a PNG and a WAV.
 *
 * Everything goes through the real UI: import, layering, split, undo, trim,
 * drag, transitions, speed, freeze frames, detached sound, markers, copy and
 * paste, pan-and-zoom, blurred fill, animated and Arabic titles, ducking,
 * both exporters (whose files are checked), reopening with stored media, the
 * audio-editor hand-over both ways, voice clean-up, a Qur'an verse video,
 * captions and subtitles, effects, drawing and the writing hand, and
 * working offline.
 *
 *   npm run test:video-editor
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP video editor test: playwright-core is not installed (npm install).');
    process.exit(0);
}
const ReelWebm = require('../webm.js');

const ROOT = path.resolve(__dirname, '..');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

/* ------------------------------------------------------------------ media */

function toneWav(seconds, sampleRate, freq, amp) {
    const samples = Math.floor(seconds * sampleRate);
    const dataSize = samples * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples; i += 1) {
        buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sampleRate) * 32767 * (amp || 0.35)), 44 + i * 2);
    }
    return buf;
}

/** A "voice": bursts of tone (speech) with silences (pauses) between, as a WAV. */
function speechWav(parts, sampleRate) {
    const rate = sampleRate || 16000;
    const pcm = [];
    parts.forEach(function (part, k) {
        const n = Math.floor(part[1] * rate);
        for (let i = 0; i < n; i += 1) pcm.push(part[0] ? Math.sin(2 * Math.PI * (220 + k * 30) * i / rate) * 0.5 : 0);
    });
    const buf = toneWav(pcm.length / rate, rate, 1, 0);
    pcm.forEach((v, i) => buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2));
    return buf;
}

/** Records a 2 s 320×180 WebM in the page: solid red, then solid green, with a tone. */
async function makeVideo(page) {
    const b64 = await page.evaluate(async function () {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        const x = c.getContext('2d');
        const stream = c.captureStream(30);
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const g = ac.createGain();
        g.gain.value = 0.5;
        const dest = ac.createMediaStreamDestination();
        osc.connect(g);
        g.connect(dest);
        osc.start();
        stream.addTrack(dest.stream.getAudioTracks()[0]);
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const done = new Promise((r) => { rec.onstop = r; });
        rec.start(100);
        const t0 = performance.now();
        await new Promise(function (resolve) {
            (function frame() {
                const t = (performance.now() - t0) / 1000;
                x.fillStyle = t < 1 ? '#ff0000' : '#00ff00';
                x.fillRect(0, 0, 320, 180);
                if (t < 2.1) requestAnimationFrame(frame); else resolve();
            }());
        });
        rec.stop();
        await done;
        osc.stop();
        ac.close();
        const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(s);
    });
    return Buffer.from(b64, 'base64');
}

async function makePng(page) {
    const b64 = await page.evaluate(function () {
        const c = document.createElement('canvas');
        c.width = 200;
        c.height = 200;
        const x = c.getContext('2d');
        x.fillStyle = '#0000ff';
        x.fillRect(0, 0, 200, 200);
        return c.toDataURL('image/png').split(',')[1];
    });
    return Buffer.from(b64, 'base64');
}

/* ------------------------------------------------------------ Quran.com */

const VERSES = [
    ['بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'],
    ['ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ', '[All] praise is [due] to Allah, Lord of the worlds -'],
    ['ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'The Entirely Merciful, the Especially Merciful,'],
    ['مَٰلِكِ يَوْمِ ٱلدِّينِ', 'Sovereign of the Day of Recompense.'],
    ['إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', 'It is You we worship and You we ask for help.'],
    ['ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ', 'Guide us to the straight path -'],
    ['صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ', 'The path of those upon whom You have bestowed favor.']
];
const AYAH_SECONDS = [1.0, 1.4, 0.8, 1, 1, 1, 1];

function quranApi(url) {
    const u = new URL(url);
    const p = u.pathname.replace('/api/v4', '');
    if (p === '/chapters') {
        return { chapters: [{ id: 1, name_simple: 'Al-Fatihah', name_arabic: 'الفاتحة', verses_count: 7, translated_name: { name: 'The Opener' } }] };
    }
    if (p === '/resources/recitations') {
        return { recitations: [
            { id: 1, reciter_name: 'AbdulBaset AbdulSamad', style: 'Mujawwad', translated_name: { name: 'AbdulBaset AbdulSamad' } },
            { id: 7, reciter_name: 'Mishari Rashid al-`Afasy', style: null, translated_name: { name: 'Mishari Rashid al-`Afasy' } }
        ] };
    }
    if (p === '/resources/translations') {
        return { translations: [
            { id: 131, name: 'Dr. Mustafa Khattab', author_name: 'Dr. Mustafa Khattab', language_name: 'english' },
            { id: 20, name: 'Saheeh International', author_name: 'Saheeh International', language_name: 'english' },
            { id: 140, name: 'Oromo', author_name: 'Ghali Aba Hulgaa', language_name: 'oromo' }
        ] };
    }
    if (p === '/verses/by_chapter/1') {
        const tid = u.searchParams.get('translations');
        return {
            verses: VERSES.map((v, i) => ({
                verse_key: '1:' + (i + 1), verse_number: i + 1, text_uthmani: v[0],
                translations: tid ? [{ text: v[1] + '<sup foot_note=77>1</sup>' }] : []
            })),
            pagination: { next_page: null }
        };
    }
    if (p === '/recitations/7/by_chapter/1') {
        const withSegments = /segments/.test(u.searchParams.get('fields') || '');
        return {
            audio_files: VERSES.map(function (v, i) {
                const f = { verse_key: '1:' + (i + 1), url: 'Alafasy/mp3/00100' + (i + 1) + '.mp3' };
                if (withSegments) {
                    // Word timings: [word position, start ms, end ms], evenly through the ayah.
                    const words = v[0].split(/\s+/);
                    const each = AYAH_SECONDS[i] * 1000 / words.length;
                    f.segments = words.map((w, k) => [k + 1, Math.round(k * each), Math.round((k + 1) * each)]);
                }
                return f;
            }),
            pagination: { next_page: null }
        };
    }
    return null;
}

/* ------------------------------------------------------------------ server */

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function serve() {
    return new Promise(function (resolve) {
        const server = http.createServer(function (req, res) {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/audio-editor/' || urlPath === '/audio-editor/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<!doctype html><title>Audio editor stand-in</title><p>audio editor</p>');
                return;
            }
            if (!urlPath.startsWith('/video-editing/')) { res.writeHead(404); res.end(); return; }
            let rel = urlPath.slice('/video-editing/'.length) || 'index.html';
            const file = path.join(ROOT, rel);
            if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
            fs.readFile(file, function (err, data) {
                if (err) { res.writeHead(404); res.end(); return; }
                res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

/* ----------------------------------------------------------------- helpers */

const project = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.Reel.project)));
const onTrack = (p, track) => p.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
const approx = (a, b, tol) => Math.abs(a - b) <= (tol || 0.05);
/** Opens a menu in the menu bar (file, edit, view, create, tools, help) and picks an item. */
async function menu(page, which, name) {
    await page.click('#' + which);
    await page.locator('#' + which + '-menu').getByRole('menuitem', { name: name, exact: typeof name === 'string' }).click();
}

async function pixel(page, t, fx, fy) {
    await page.evaluate((time) => window.Reel.seek(time), t);
    await page.waitForTimeout(350);
    return page.evaluate(function (args) {
        window.Reel.drawFrame();
        const c = document.getElementById('preview');
        const d = c.getContext('2d').getImageData(Math.floor(c.width * args[0]), Math.floor(c.height * args[1]), 1, 1).data;
        return [d[0], d[1], d[2]];
    }, [fx, fy]);
}

/** Left and right edge of the bright (text) pixels in the frame at `t`, and the frame width. */
async function inkBox(page, t) {
    await page.evaluate((time) => window.Reel.seek(time), t);
    await page.waitForTimeout(300);
    return page.evaluate(function () {
        window.Reel.drawFrame();
        const c = document.getElementById('preview');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let left = Infinity;
        let right = -1;
        for (let y = 0; y < c.height; y += 2) {
            for (let x = 0; x < c.width; x += 1) {
                const i = (y * c.width + x) * 4;
                if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { if (x < left) left = x; if (x > right) right = x; }
            }
        }
        return { left: left, right: right, width: c.width };
    });
}

async function whitePixels(page, t) {
    await page.evaluate((time) => window.Reel.seek(time), t);
    await page.waitForTimeout(300);
    return page.evaluate(function () {
        window.Reel.drawFrame();
        const c = document.getElementById('preview');
        const d = c.getContext('2d').getImageData(0, c.height * 0.3, c.width, c.height * 0.4).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) n += 1;
        return n;
    });
}

async function clickClip(page, id, modifiers) {
    await page.locator('.clip[data-id="' + id + '"]').click({ position: { x: 6, y: 30 }, modifiers: modifiers });
}

async function exportWith(page, pickOption) {
    await page.click('#export');
    await page.waitForFunction(() => !document.getElementById('export-start').disabled, null, { timeout: 20000 });
    const options = await page.locator('#export-format option').evaluateAll((os) => os.map((o) => ({ value: o.value, text: o.textContent, group: o.parentElement.label || '' })));
    const choice = options.find(pickOption);
    if (!choice) { await page.click('#export-cancel'); return { options: options, file: null }; }
    await page.selectOption('#export-format', choice.value);
    const t0 = Date.now();
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 90000 }),
        page.click('#export-start')
    ]);
    const file = path.join(os.tmpdir(), 'reel-export-' + process.pid + '-' + Date.now() + path.extname(download.suggestedFilename()));
    await download.saveAs(file);
    const seconds = (Date.now() - t0) / 1000;
    const shareButtons = await page.locator('#export-result .share-row button').allTextContents();
    await page.click('#export-cancel');
    return { options: options, choice: choice, file: file, seconds: seconds, shareButtons: shareButtons };
}

async function probeFile(page, bytes) {
    return page.evaluate(async function (b64) {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
        const v = document.createElement('video');
        v.muted = true;
        v.src = URL.createObjectURL(new Blob([arr]));
        await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('decode')); });
        let d = v.duration;
        if (!isFinite(d)) {
            v.currentTime = 1e7;
            await new Promise((r) => { v.onseeked = r; setTimeout(r, 3000); });
            d = v.duration;
        }
        return { w: v.videoWidth, h: v.videoHeight, d: d };
    }, bytes.toString('base64'));
}

/* -------------------------------------------------------------------- run */

(async function main() {
    const server = await serve();
    const base = 'http://127.0.0.1:' + server.address().port;
    const URL_ = base + '/video-editing/?nosw';
    const browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
    });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await context.route(/api\.quran\.com/, function (route) {
        const body = quranApi(route.request().url());
        if (!body) return route.fulfill({ status: 404, body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    });
    await context.route(/verses\.quran\.com/, function (route) {
        const n = Number((route.request().url().match(/00100(\d)\.mp3/) || [])[1] || 1);
        return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' }, body: toneWav(AYAH_SECONDS[n - 1], 16000, 300 + n * 50) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
        // Blocked fonts and the stand-in's missing files are the test's network, not the editor.
        if (msg.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text());
    });

    try {
        await page.goto(URL_);
        await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

        /* ------------------------------------------------ purpose reminder */
        const gate = page.locator('#consentGate');
        check('the purpose reminder opens on the first visit', await gate.evaluate((d) => d.open));
        check('I Agree stays disabled until the box is ticked', await page.locator('#consentAgree').isDisabled());
        await page.keyboard.press('Escape');
        await page.keyboard.press(' ');
        check('Escape does not close it, and shortcuts do not reach the editor behind it',
            await gate.evaluate((d) => d.open) && !(await page.evaluate(() => window.Reel.playing)));
        await page.click('#consentDecline');
        check('not agreeing keeps the editor closed', await gate.evaluate((d) => d.open) && await page.locator('#consentCancelled').isVisible());
        await page.click('#consentReconsider');
        await page.check('#consentCheck');
        await page.click('#consentAgree');
        check('agreeing opens the editor', !(await gate.evaluate((d) => d.open)));
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        check('and it is not asked again in this browser', !(await gate.evaluate((d) => d.open)));

        check('page loads with an empty project and every module', (await project(page)).clips.length === 0 &&
            await page.evaluate(() => ['ReelStore', 'ReelMix', 'ReelFastExport', 'ReelQuran', 'ReelCaptions'].every((k) => !!window[k])));

        const video = await makeVideo(page);
        const png = await makePng(page);
        const wav = toneWav(3, 22050, 440, 0.2);
        const FILES = [
            { name: 'clip.webm', mimeType: 'video/webm', buffer: video },
            { name: 'logo.png', mimeType: 'image/png', buffer: png },
            { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav }
        ];

        /* ---------------------------------------------------------- import */
        await page.setInputFiles('#import-input', FILES);
        await page.waitForFunction(() => document.querySelectorAll('.media-item').length === 3, null, { timeout: 20000 });
        let p = await project(page);
        const vid = p.media.find((m) => m.name === 'clip.webm');
        const img = p.media.find((m) => m.name === 'logo.png');
        const aud = p.media.find((m) => m.name === 'tone.wav');
        check('video is probed, with its real length despite MediaRecorder\'s Infinity', vid && vid.type === 'video' && approx(vid.duration, 2.1, 0.3), vid && vid.duration);
        check('image and audio are probed', img && img.width === 200 && aud && approx(aud.duration, 3));

        await page.dblclick('.media-item[data-id="' + vid.id + '"]');
        await page.hover('.media-item[data-id="' + aud.id + '"]');
        await page.click('.media-item[data-id="' + aud.id + '"] .add');
        await page.dragAndDrop('.media-item[data-id="' + img.id + '"]', '.tl-row[data-track="V2"] .tl-lane', { targetPosition: { x: 5, y: 20 } });
        p = await project(page);
        const overlay = onTrack(p, 'V2')[0];
        check('clips land on the right tracks (double-click, +, drag)', onTrack(p, 'V1').length === 1 && onTrack(p, 'A1').length === 1 && overlay && overlay.mediaId === img.id);

        /* -------------------------------------------------------- layering */
        let px = await pixel(page, 0.5, 0.5, 0.5);
        check('overlay track draws on top (blue image)', px[2] > 200 && px[0] < 60, px.join(','));
        px = await pixel(page, 0.5, 0.1, 0.5);
        check('the video shows beside the overlay (red first second)', px[0] > 200 && px[1] < 60, px.join(','));
        px = await pixel(page, 1.6, 0.1, 0.5);
        check('seeking shows the right frame (green second second)', px[1] > 200 && px[0] < 60, px.join(','));
        await page.click('.tl-row[data-track="V2"] .tl-head button[aria-label^="Hide"]');
        px = await pixel(page, 0.5, 0.5, 0.5);
        check('hiding a track hides it', px[0] > 200, px.join(','));
        await page.keyboard.press('Control+z');
        check('undo brings the track back', !(await project(page)).tracks.find((t) => t.id === 'V2').hidden);

        /* ----------------------------------------------- split, undo, trim */
        const vclip = onTrack(await project(page), 'V1')[0];
        await clickClip(page, vclip.id);
        await page.evaluate(() => window.Reel.seek(1));
        await page.keyboard.press('s');
        let v1 = onTrack(await project(page), 'V1');
        check('S splits the selected clip at the playhead', v1.length === 2 && approx(v1[1].start, 1, 0.001) && approx(v1[1].in, 1, 0.001));
        await page.keyboard.press('Control+z');
        check('undo rejoins it', onTrack(await project(page), 'V1').length === 1);
        await page.keyboard.press('Control+Shift+z');
        v1 = onTrack(await project(page), 'V1');
        check('redo splits it again', v1.length === 2);

        /* ------------------------------------------------------ transition */
        await clickClip(page, v1[1].id);
        await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('crossfade');
        p = await project(page);
        check('a transition is set on the incoming clip', p.clips.find((c) => c.id === v1[1].id).transition.type === 'crossfade');
        check('the timeline shows the transition', await page.locator('.clip[data-id="' + v1[1].id + '"] .clip-tr').count() === 1);
        // Rendering: a dip to black between the video and the image, placed right after it on V1.
        await page.click('.tl-row[data-track="V2"] .tl-head button[aria-label^="Hide"]');
        const cut = await page.evaluate(function (mediaId) {
            const app = window.ReelApp;
            const T = app.T;
            const p = app.state.project;
            const end = T.trackEnd(p, 'V1');
            const clip = Object.assign(T.clipFromMedia(T.getMedia(p, mediaId), 'V1', end), { duration: 2 });
            app.apply(T.addClip(p, clip));
            app.selectOnly(clip.id);
            return end;
        }, img.id);
        await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('dip');
        const atCut = await pixel(page, cut, 0.5, 0.5);
        // A 1 s dip: 0.2 s either side of the cut each picture is at 40%.
        const before_ = await pixel(page, cut - 0.2, 0.5, 0.5);
        const after_ = await pixel(page, cut + 0.2, 0.5, 0.5);
        check('a dip to black fades the video out and the next clip in', atCut[0] + atCut[1] + atCut[2] < 30 &&
            before_[1] > 70 && before_[1] < 140 && after_[2] > 70 && after_[2] < 140,
            before_.join(',') + ' → ' + atCut.join(',') + ' → ' + after_.join(','));
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        check('undo takes it back out', onTrack(await project(page), 'V1').length === 2 && !(await project(page)).tracks.find((t) => t.id === 'V2').hidden);

        const right = (await project(page)).clips.find((c) => c.id === v1[1].id);
        const box = await page.locator('.clip[data-id="' + right.id + '"] .handle.r').boundingBox();
        await page.mouse.move(box.x + 4, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 20, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        const trimmed = (await project(page)).clips.find((c) => c.id === right.id);
        check('dragging a clip edge trims it', trimmed.duration < right.duration - 0.05, right.duration.toFixed(2) + ' -> ' + trimmed.duration.toFixed(2));

        const obox = await page.locator('.clip[data-id="' + overlay.id + '"]').boundingBox();
        await page.mouse.move(obox.x + 30, obox.y + obox.height / 2);
        await page.mouse.down();
        await page.mouse.move(obox.x + 110, obox.y + obox.height / 2, { steps: 5 });
        await page.mouse.up();
        const moved = (await project(page)).clips.find((c) => c.id === overlay.id);
        check('dragging a clip moves it', moved.start > overlay.start + 0.2 && moved.track === 'V2', moved.start.toFixed(2));
        await page.getByRole('slider', { name: 'Scale', exact: true }).fill('50');
        check('inspector edits apply', approx((await project(page)).clips.find((c) => c.id === overlay.id).scale, 0.5, 0.001));

        /* ----------------------------------------------------------- speed */
        const first = onTrack(await project(page), 'V1')[0];
        await clickClip(page, first.id);
        await page.getByRole('combobox', { name: 'Speed' }).selectOption('2');
        let fc = (await project(page)).clips.find((c) => c.id === first.id);
        check('2× speed halves the clip', fc.speed === 2 && approx(fc.duration, 0.5, 0.001), fc.duration);
        check('the timeline labels it', /2×/.test(await page.locator('.clip[data-id="' + first.id + '"] .clip-label').textContent()));
        await page.keyboard.press('Control+z');

        /* ---------------------------------------------------------- freeze */
        await page.evaluate(() => window.Reel.seek(0.5));
        await clickClip(page, first.id);
        await page.evaluate(() => window.Reel.seek(0.5));
        await page.keyboard.press('f');
        p = await project(page);
        const still = p.clips.find((c) => c.freeze);
        check('F freezes the frame for 2 s and pushes the rest along', still && approx(still.start, 0.5, 0.01) && approx(still.duration, 2) &&
            onTrack(p, 'V1').length === 4, still && still.start);
        px = await pixel(page, 2.2, 0.1, 0.5);
        check('the freeze frame holds the red frame', px[0] > 200 && px[1] < 60, px.join(','));
        await page.keyboard.press('Control+z');

        /* ---------------------------------------------------- detach audio */
        await clickClip(page, first.id);
        await page.getByRole('button', { name: 'Detach audio' }).click();
        p = await project(page);
        const sound = p.clips.find((c) => c.audioOnly);
        check('Detach audio makes a sound clip on a new audio track and mutes the video', sound && sound.track === 'A2' &&
            p.clips.find((c) => c.id === first.id).muted === true);
        await page.keyboard.press('Control+z');
        check('undo removes the sound clip and its track', !(await project(page)).tracks.some((t) => t.id === 'A2'));

        /* --------------------------------------------------------- markers */
        await page.evaluate(() => window.Reel.seek(1));
        await page.locator('#timeline').focus();
        await page.keyboard.press('m');
        p = await project(page);
        check('M adds a marker at the playhead', p.markers.length === 1 && approx(p.markers[0].time, 1, 0.04));
        check('markers become chapters', (await page.evaluate(() => window.TimelineCore.chaptersText(window.Reel.project))).includes('00:01 Chapter 1'));
        check('the ruler shows it', await page.locator('.marker').count() === 1);

        /* --------------------------------------------- multi-select, paste */
        v1 = onTrack(await project(page), 'V1');
        await clickClip(page, v1[0].id);
        await clickClip(page, v1[1].id, ['Control']);
        check('Ctrl-click selects several clips', (await page.evaluate(() => window.Reel.selection.length)) === 2);
        await page.keyboard.press('Control+c');
        await page.evaluate(() => window.Reel.seek(8));
        await page.keyboard.press('Control+v');
        p = await project(page);
        const pasted = onTrack(p, 'V1').filter((c) => c.start >= 7.99);
        check('Ctrl+V pastes them at the playhead, spacing kept', pasted.length === 2 && approx(pasted[0].start, 8, 0.01) && approx(pasted[1].start, 9, 0.01));
        await page.keyboard.press('Control+z');

        /* ------------------------------------------- pan & zoom, blur fill */
        await clickClip(page, overlay.id);
        const fresh = (await project(page)).clips.find((c) => c.id === overlay.id);
        check('a photo put on the timeline starts animated: it fades in and slowly zooms', fresh.enter === 'fade' && fresh.motion && fresh.motion.type === 'zoom-in');
        await page.getByRole('combobox', { name: 'Pan & zoom' }).selectOption('none');
        await page.getByRole('combobox', { name: 'Pan & zoom' }).selectOption('zoom-in');
        const ov = (await project(page)).clips.find((c) => c.id === overlay.id);
        // At 50% the square spans x 460–820; zoomed to 1.15× by the end it reaches 433.
        const early = await pixel(page, ov.start + 0.05, 448 / 1280, 0.5);
        const late = await pixel(page, ov.start + ov.duration - 0.05, 448 / 1280, 0.5);
        check('slow zoom-in grows the image over the clip', early[2] < 150 && late[2] > 200, early.join(',') + ' → ' + late.join(','));
        await page.getByRole('combobox', { name: 'Bars' }).selectOption('blur');
        px = await pixel(page, ov.start + 1, 0.03, 0.5);
        check('blurred fill covers the bars with the picture', px[2] > 60 && px[2] > px[0] + 30, px.join(','));
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');

        /* ---------------------------------------------------------- titles */
        await page.evaluate(() => window.Reel.seek(0));
        await page.click('#add-text');
        await page.keyboard.type('Hello Reel');
        await page.keyboard.press('Tab');
        p = await project(page);
        const title = onTrack(p, 'T1')[0];
        check('a title takes typed text', title && title.text === 'Hello Reel');
        check('title text is drawn', await whitePixels(page, 1) > 2000);
        await clickClip(page, title.id);
        await page.getByRole('combobox', { name: 'Entrance' }).selectOption('typewriter');
        const typedEarly = await whitePixels(page, 0.4);
        const typedLate = await whitePixels(page, 4.2);
        check('typewriter reveals the title over time', typedEarly < typedLate / 2, typedEarly + ' → ' + typedLate);

        await page.locator('.inspector-body textarea').fill('بسم الله الرحمن الرحيم');
        await page.locator('.inspector-body textarea').blur();
        await page.getByRole('combobox', { name: 'Font' }).selectOption('amiri');
        const arabic = (await project(page)).clips.find((c) => c.id === title.id);
        check('an Arabic title keeps its text and font', arabic.text === 'بسم الله الرحمن الرحيم' && arabic.font === 'amiri');
        check('and is drawn right to left', await whitePixels(page, 4.5) > 400 && await page.evaluate(() => window.TimelineCore.isArabic(window.Reel.project.clips.find((c) => c.type === 'text').text)));

        // A long ayah, big: it must wrap and stay whole and centred in the frame — also in a
        // browser that reads canvas textAlign 'right' as the reading end (emulated here), the
        // difference that once pushed the start of an ayah off the edge.
        await page.locator('.inspector-body textarea').fill('ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ ﴿٢﴾');
        await page.locator('.inspector-body textarea').blur();
        await page.getByRole('slider', { name: 'Size', exact: true }).fill('150');
        await page.getByRole('combobox', { name: 'Entrance' }).selectOption('none');
        let ink = await inkBox(page, 2);
        check('a big Arabic title wraps inside the frame, centred', ink.left > 0 && ink.right < ink.width - 1 &&
            Math.abs((ink.left + ink.right) / 2 - ink.width / 2) < ink.width * 0.05, JSON.stringify(ink));
        await page.evaluate(function () {
            const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'textAlign');
            window.__restoreAlign = () => Object.defineProperty(CanvasRenderingContext2D.prototype, 'textAlign', d);
            Object.defineProperty(CanvasRenderingContext2D.prototype, 'textAlign', {
                configurable: true,
                get() { return d.get.call(this); },
                set(v) { d.set.call(this, v === 'right' ? 'end' : v === 'left' ? 'start' : v); }
            });
        });
        const quirk = await inkBox(page, 2);
        check('and stays whole where canvas right-alignment behaves differently', quirk.left > 0 && quirk.right < quirk.width - 1 &&
            Math.abs(quirk.left - ink.left) < 4 && Math.abs(quirk.right - ink.right) < 4, JSON.stringify(quirk));
        await page.evaluate(() => window.__restoreAlign());
        await page.getByRole('slider', { name: 'Size', exact: true }).fill('60');
        await page.getByRole('combobox', { name: 'Entrance' }).selectOption('words');
        const clipStart = (await project(page)).clips.find((c) => c.id === title.id).start;
        const partWay = await inkBox(page, clipStart + 1.2);
        const whole = await inkBox(page, clipStart + 4.5);
        check('word by word reveals an ayah from its start, on the right', partWay.right > 0 && Math.abs(partWay.right - whole.right) < 6 &&
            partWay.left > whole.left + 40, JSON.stringify(partWay) + ' of ' + JSON.stringify(whole));
        await clickClip(page, title.id);
        await page.keyboard.press('Delete');
        check('Delete removes it', !(await project(page)).clips.some((c) => c.id === title.id));

        /* -------------------------------------------------------- playback */
        await page.evaluate(() => window.Reel.seek(0));
        await page.click('#play');
        await page.waitForTimeout(900);
        const playing = await page.evaluate(() => ({ t: window.Reel.time, playing: window.Reel.playing }));
        await page.click('#play');
        check('play runs the clock and pause stops it', playing.playing && playing.t > 0.3 && !(await page.evaluate(() => window.Reel.playing)), playing.t.toFixed(2));

        /* --------------------------------------------------------- ducking */
        await page.waitForFunction(() => Array.from(window.ReelApp.files.values()).filter((f) => f.peaks).length >= 2, null, { timeout: 15000 });
        await page.click('.tl-row[data-track="A1"] .tl-head button[aria-label^="Duck"]');
        const duck = await page.evaluate(() => { const f = window.ReelApp.duckFn(); return [f(0.6), f(2.9)]; });
        check('ducking lowers the music while the video speaks', duck[0] < 0.5 && duck[1] > duck[0], duck.map((x) => x.toFixed(2)).join(' → '));

        /* ----------------------------------------------------------- saves */
        const [saved] = await Promise.all([page.waitForEvent('download'), menu(page, 'file', /Save as a file/)]);
        const savedJson = JSON.parse(fs.readFileSync(await saved.path(), 'utf8'));
        check('Save downloads a project file with markers', savedJson.format === 'reel-project' && savedJson.markers.length === 1, savedJson.format + ' ' + JSON.stringify(savedJson.markers));

        /* ---------------------------------------------------------- export */
        p = await project(page);
        const expected = p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        const fast = await exportWith(page, (o) => /Fast/.test(o.group));
        check('fast export is offered', !!fast.file, fast.options.map((o) => o.group + ': ' + o.text).join(' | '));
        if (fast.file) {
            const bytes = fs.readFileSync(fast.file);
            const probe = await probeFile(page, bytes);
            check('fast export makes a playable file at the project size', probe.w === 1280 && probe.h === 720, probe.w + 'x' + probe.h);
            check('with the full length', approx(probe.d, expected, 0.15), probe.d.toFixed(2) + ' vs ' + expected.toFixed(2));
            check('and sound in it', bytes.includes(Buffer.from('A_OPUS')) || bytes.includes(Buffer.from('mp4a')) || bytes.includes(Buffer.from('Opus')));
            check('a finished export offers sharing to WhatsApp and Telegram', fast.shareButtons.includes('WhatsApp') && fast.shareButtons.includes('Telegram'), fast.shareButtons.join(', '));
            check('and posting on YouTube, Shorts, TikTok, Instagram and Facebook', ['YouTube', 'YouTube Shorts', 'TikTok', 'Instagram Reels', 'Facebook'].every((b) => fast.shareButtons.includes(b)), fast.shareButtons.join(', '));
            check('fast export ran', true, fast.choice.text + ', ' + bytes.length + ' bytes in ' + fast.seconds.toFixed(1) + 's for ' + expected.toFixed(1) + 's of video');
            fs.unlinkSync(fast.file);
        }
        await page.click('#export');
        await page.waitForFunction(() => !document.getElementById('export-start').disabled, null, { timeout: 20000 });
        await page.locator('#export-targets button', { hasText: 'YouTube Shorts' }).click();
        const shortsFit = await page.locator('#export-fit').innerText();
        await page.locator('#export-targets button', { hasText: /^YouTube$/ }).click();
        const youtubeFit = await page.locator('#export-fit').innerText();
        const picked = await page.evaluate(() => { const s = document.getElementById('export-format'); return s.options[s.selectedIndex].text + ' ' + document.getElementById('export-quality').value; });
        check('Made for YouTube Shorts warns about a wide frame and offers to change it', /needs a tall 9:16 frame/.test(shortsFit) && /Change the frame to 9:16/.test(shortsFit), shortsFit);
        check('and for YouTube the wide video is ready, as MP4 at high quality where the browser can',
            /^Ready for YouTube: 16:9/.test(youtubeFit) && /12000000$/.test(picked) && (!/MP4/.test(fast.options.map((o) => o.text).join()) || /MP4/.test(picked)), youtubeFit + ' · ' + picked);
        await page.locator('#export-targets button', { hasText: 'Anywhere' }).click();
        check('Anywhere hides the check', await page.locator('#export-fit').isHidden());
        await page.selectOption('#export-quality', '6000000');
        await page.click('#export-cancel');
        const rt = await exportWith(page, (o) => /Real time/.test(o.group));
        if (rt.file) {
            const bytes = fs.readFileSync(rt.file);
            const isWebm = bytes.readUInt32BE(0) === 0x1A45DFA3;
            if (isWebm) check('real-time WebM carries its duration', approx(ReelWebm.getDuration(new Uint8Array(bytes)) / 1000, expected, 0.1));
            const probe = await probeFile(page, bytes);
            check('real-time export still works', probe.w === 1280 && approx(probe.d, expected, 0.6), rt.choice.text + ', ' + probe.d.toFixed(2) + 's');
            fs.unlinkSync(rt.file);
        } else {
            check('real-time export is offered', false);
        }

        /* ---------------------------------------- reopen with stored media */
        await page.waitForTimeout(500);
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        await page.waitForFunction(() => document.querySelectorAll('.media-item').length === 3, null, { timeout: 15000 });
        p = await project(page);
        check('after a reload the project is back', p.clips.length === 4 && p.markers.length === 1, p.clips.length + ' clips');
        check('and its files come back from browser storage — nothing to re-import', await page.locator('.media-item.missing').count() === 0 && await page.locator('#restore-banner').isHidden());
        px = await pixel(page, 0.5, 0.1, 0.5);
        check('stored media draws', px[0] > 200, px.join(','));

        /* ------------------------------------------ audio editor, both ways */
        await page.evaluate(async function (b64) {
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
            await window.ReelStore.putHandoff('to-video-editor', new Blob([arr], { type: 'audio/wav' }), 'From audio editor.wav');
        }, toneWav(1.5, 16000, 500).toString('base64'));
        await page.goto(base + '/video-editing/?nosw&from=audio-editor');
        await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        p = await project(page);
        const handed = p.media.find((m) => m.name === 'From audio editor.wav');
        check('a file sent from the audio editor lands on the timeline', handed && p.clips.some((c) => c.mediaId === handed.id));

        const toneClip = p.clips.find((c) => c.mediaId === aud.id);
        await clickClip(page, toneClip.id);
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            page.getByRole('button', { name: 'Edit in audio editor' }).click()
        ]);
        await popup.waitForLoadState();
        const left = await page.evaluate(async () => { const f = await window.ReelStore.takeHandoff('to-audio-editor'); return f && f.name; });
        check('Edit in audio editor opens it with the clip’s file handed over', /audio-editor\/\?from=video-editor/.test(popup.url()) && left === 'tone.wav', popup.url() + ' / ' + left);
        await popup.close();

        /* ------------------------------------------------------ clean voice */
        await page.evaluate(function () {
            window.__reelTestDenoiser = {
                frameSize: 480,
                createDenoiseState: () => ({ processFrame: (f) => { for (let i = 0; i < f.length; i += 1) f[i] *= 0.5; }, destroy: () => {} })
            };
        });
        await clickClip(page, toneClip.id);
        await page.getByRole('button', { name: 'Clean up voice' }).click();
        await page.locator('.modal.generic').getByRole('button', { name: 'Clean up' }).click();
        await page.waitForFunction(() => window.Reel.project.media.some((m) => /clean voice/.test(m.name)), null, { timeout: 20000 });
        p = await project(page);
        const cleaned = p.media.find((m) => /clean voice/.test(m.name));
        check('Clean up voice swaps in a cleaned copy and keeps the original', cleaned && p.clips.find((c) => c.id === toneClip.id).mediaId === cleaned.id &&
            p.media.some((m) => m.id === aud.id) && approx(cleaned.duration, 3, 0.1));

        /* ------------------------------------------------- Qur'an video */
        const before = await project(page);
        const beforeEnd = before.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        await menu(page, 'create', /Qur’ān verse video/);
        const dlg = page.locator('.modal.generic');
        await dlg.getByRole('combobox', { name: 'Recitation' }).locator('option[value="rec:7"]').waitFor({ state: 'attached' });
        await dlg.getByRole('spinbutton', { name: 'To ayah' }).fill('3');
        await dlg.getByRole('spinbutton', { name: 'To ayah' }).dispatchEvent('change');
        const recitationPick = await dlg.getByRole('combobox', { name: 'Recitation' }).inputValue();
        const translationPick = await dlg.getByRole('combobox', { name: 'Translation' }).evaluate((s) => s.options[s.selectedIndex].textContent);
        check('the verse dialog suggests the reciter and Saheeh by name', recitationPick === 'rec:7' && /Saheeh/.test(translationPick), recitationPick + ' / ' + translationPick);
        const reciterValues = await dlg.getByRole('combobox', { name: 'Recitation' }).locator('option').evaluateAll((os) => os.map((o) => o.value));
        const translationLabels = await dlg.getByRole('combobox', { name: 'Translation' }).locator('option').allTextContents();
        check('more reciters, and every translator in a language', reciterValues.filter((v) => v.startsWith('ea:')).length >= 10 &&
            translationLabels.filter((l) => /^English/.test(l)).length === 2 && translationLabels.some((l) => /^Afaan Oromoo/.test(l)), translationLabels.join(' | '));
        await dlg.getByRole('button', { name: 'Make video' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
        p = await project(page);
        const recit = p.clips.filter((c) => c.mediaId && /001-00\d/.test((p.media.find((m) => m.id === c.mediaId) || {}).name || '')).sort((a, b) => a.start - b.start);
        const texts = p.clips.filter((c) => c.type === 'text' && c.start >= beforeEnd - 1e-6).sort((a, b) => a.start - b.start);
        const arabicClips = texts.filter((c) => /[؀-ۿ]/.test(c.text) && /﴿/.test(c.text));
        const englishClips = texts.filter((c) => /Merciful|praise/.test(c.text));
        check('each ayah’s recitation is placed back to back', recit.length === 3 && approx(recit[0].duration, 1.0, 0.05) && approx(recit[1].duration, 1.4, 0.05) &&
            approx(recit[1].start, recit[0].start + recit[0].duration, 0.01), recit.map((c) => c.start.toFixed(2) + '+' + c.duration.toFixed(2)).join(' '));
        check('the Arabic of each ayah matches its recitation exactly, with its number', arabicClips.length === 3 &&
            arabicClips.every((c, i) => approx(c.start, recit[i].start, 0.01) && approx(c.duration, recit[i].duration, 0.01)) &&
            arabicClips[0].text.includes('﴿١﴾') && arabicClips[0].font === 'amiri');
        check('the translation is timed the same, footnotes stripped', englishClips.length === 3 && !englishClips.some((c) => /<|foot/.test(c.text)) &&
            approx(englishClips[1].start, recit[1].start, 0.01));
        const times = arabicClips.map((c) => c.lyricWordTimes || []);
        const words1 = arabicClips[1].text.trim().split(/\s+/);
        check('each word of the Arabic lights up as it is recited', arabicClips.every((c, i) => c.lyricStyle === 'karaoke' && c.lyricSourceText === c.text &&
            times[i].length === c.text.trim().split(/\s+/).length && times[i].every((v, k) => k === 0 || v >= times[i][k - 1])), JSON.stringify(times[1]));
        check('using Quran.com’s word timings when there are some', approx(times[1][1], 1.4 / (words1.length - 1), 0.02), times[1][1] + ' s');
        check('a title card and Bismillah come first', texts.some((c) => c.text === 'سورة الفاتحة') && texts.some((c) => /Sūrah Al-Fatihah/.test(c.text)));
        const bg = p.clips.find((c) => { const m = p.media.find((x) => x.id === c.mediaId); return m && /^Background/.test(m.name); });
        check('a gradient background covers it all, with a slow zoom', bg && approx(bg.start, beforeEnd, 0.01) && approx(bg.start + bg.duration, recit[2].start + recit[2].duration, 0.01) && bg.motion.type === 'zoom-in');
        check('the whole verse video is one undo step', await page.evaluate(() => { const h = window.ReelApp.state.history; return h.states[h.index - 1] && h.states[h.index - 1].clips.length; }) === before.clips.length);
        const verseFrame = await pixel(page, recit[1].start + 0.5, 0.5, 0.5);
        check('the verse frame is drawn over the gradient', verseFrame[0] + verseFrame[1] + verseFrame[2] > 0, verseFrame.join(','));

        /* ---------------------------------------------------------- captions */
        await page.evaluate(function () {
            window.__reelTestTranscriber = async () => ({
                text: 'Hello world. Second line',
                chunks: [
                    { text: ' Hello', timestamp: [0.2, 0.5] }, { text: ' world.', timestamp: [0.5, 0.9] },
                    { text: ' Second', timestamp: [2.0, 2.4] }, { text: ' line', timestamp: [2.4, 2.8] }
                ]
            });
        });
        await page.click('#tools');
        await page.getByRole('menuitem', { name: /Auto captions/ }).click();
        await page.locator('.modal.generic').getByRole('button', { name: 'Make captions' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
        p = await project(page);
        const capTrack = p.tracks.find((t) => t.name === 'Captions');
        const caps = capTrack ? onTrack(p, capTrack.id) : [];
        check('auto captions become titles on a Captions track', caps.length === 2 && caps[0].text === 'Hello world.' && approx(caps[1].start, 2.0, 0.01) && caps[0].box === true,
            caps.map((c) => c.text).join(' | '));

        await page.click('#tools');
        await page.getByRole('menuitem', { name: /Save a titles track/ }).click();
        await page.locator('.modal.generic').getByRole('combobox', { name: 'Track' }).selectOption(capTrack.id);
        const [srt] = await Promise.all([page.waitForEvent('download'), page.locator('.modal.generic').getByRole('button', { name: 'Save' }).click()]);
        const srtText = fs.readFileSync(await srt.path(), 'utf8');
        check('a titles track saves as SRT', /^1\n00:00:00,200 --> 00:00:00,900\nHello world\./.test(srtText), JSON.stringify(srtText.slice(0, 50)));

        await page.click('#tools');
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Import subtitles/ }).click()]);
        await chooser.setFiles({ name: 'subs.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:05.000 --> 00:00:06.500\nImported line\n') });
        await page.waitForFunction(() => window.Reel.project.tracks.some((t) => t.name === 'Subtitles'));
        p = await project(page);
        const subs = onTrack(p, p.tracks.find((t) => t.name === 'Subtitles').id);
        check('subtitle files import as titles', subs.length === 1 && subs[0].text === 'Imported line' && approx(subs[0].start, 5));

        /* ------------------------------------------------------------ effects */
        const splitPng = Buffer.from(await page.evaluate(function () {
            // Left half red, right half blue, with a black-and-white checkerboard in the top-right quarter.
            const c = document.createElement('canvas');
            c.width = 400;
            c.height = 200;
            const x = c.getContext('2d');
            x.fillStyle = '#ff0000'; x.fillRect(0, 0, 200, 200);
            x.fillStyle = '#0000ff'; x.fillRect(200, 0, 200, 200);
            for (let yy = 0; yy < 100; yy += 2) for (let xx = 200; xx < 400; xx += 2) {
                x.fillStyle = ((xx + yy) / 2) % 2 ? '#ffffff' : '#000000';
                x.fillRect(xx, yy, 2, 2);
            }
            return c.toDataURL('image/png').split(',')[1];
        }), 'base64');
        await page.setInputFiles('#import-input', [{ name: 'split.png', mimeType: 'image/png', buffer: splitPng }]);
        await page.waitForFunction(() => window.Reel.project.media.some((m) => m.name === 'split.png'));
        const fxAt = await page.evaluate(function () {
            const app = window.ReelApp;
            const T = app.T;
            let p = app.state.project;
            const id = T.nextTrackId(p, 'video');
            p = T.addTrack(p, 'video');
            const at = T.projectDuration(p) + 1;
            const clip = Object.assign(T.clipFromMedia(p.media.find((m) => m.name === 'split.png'), id, at), { duration: 3 });
            app.state.project = T.addClip(p, clip);
            app.commit();
            app.selectOnly(clip.id);
            return { at: at + 1, id: clip.id };
        });
        const fxClip = () => page.evaluate((id) => window.TimelineCore.fxOf(window.Reel.project.clips.find((c) => c.id === id)), fxAt.id);
        px = await pixel(page, fxAt.at, 0.25, 0.5);
        check('the test picture shows red on the left', px[0] > 200 && px[2] < 60, px.join(','));
        await page.locator('.inspector-body label.check', { hasText: 'Mirror' }).click();
        px = await pixel(page, fxAt.at, 0.25, 0.75);
        check('Mirror flips it left to right', px[2] > 200 && px[0] < 60 && (await fxClip()).flipH, px.join(','));
        await page.locator('#timeline').focus();
        await page.keyboard.press('Control+z');
        check('undo takes the mirror off', !(await fxClip()).flipH);

        await page.getByRole('slider', { name: 'Crop left', exact: true }).fill('45');
        px = await pixel(page, fxAt.at, 0.5, 0.75);
        check('cropping keeps the chosen part, filling the frame again', px[2] > 200 && Math.abs((await fxClip()).crop.l - 0.45) < 1e-6, px.join(','));
        await page.locator('#timeline').focus();
        await page.keyboard.press('Control+z');
        check('undo puts the crop back', (await fxClip()).crop.l === 0);

        await page.getByRole('combobox', { name: 'Look', exact: true }).selectOption('bw');
        px = await pixel(page, fxAt.at, 0.25, 0.75);
        check('a Black & white look takes the colour out', Math.abs(px[0] - px[1]) < 12 && Math.abs(px[1] - px[2]) < 12 && (await fxClip()).look === 'bw', px.join(','));
        await page.getByRole('combobox', { name: 'Look', exact: true }).selectOption('vintage');
        const vintage = (await fxClip());
        check('a Vintage look adds vignette and grain', vintage.vignette > 0 && vintage.grain > 0);
        await page.getByRole('combobox', { name: 'Look', exact: true }).selectOption('none');

        const spread = () => page.evaluate(function () {
            window.Reel.drawFrame();
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(720, 80, 480, 250).data;
            let sum = 0;
            let sq = 0;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sq += l * l; n += 1; }
            return Math.sqrt(sq / n - (sum / n) * (sum / n));
        });
        await page.evaluate((t) => window.Reel.seek(t), fxAt.at);
        await page.waitForTimeout(300);
        const sharp = await spread();
        await page.locator('.inspector-body label.check', { hasText: 'Hide an area' }).click();
        await page.getByRole('combobox', { name: 'Shape', exact: true }).selectOption('rect');
        await page.getByRole('combobox', { name: 'Cover with', exact: true }).selectOption('pixelate');
        for (const [name, v] of [['Across', '75'], ['Down', '25'], ['Width', '50'], ['Height', '50']]) {
            await page.getByRole('slider', { name: name, exact: true }).fill(v);
        }
        await page.locator('#timeline').focus();
        await page.keyboard.press('Escape'); // deselect, so the dashed guide is not drawn
        await page.waitForTimeout(200);
        const hidden = await spread();
        check('Hide an area pixelates the chosen part of the picture', sharp > 60 && hidden < sharp / 3,
            'contrast ' + sharp.toFixed(0) + ' → ' + hidden.toFixed(0));
        await page.evaluate((id) => window.Reel.select(id), fxAt.id);

        await page.getByRole('slider', { name: 'Corners', exact: true }).fill('60');
        px = await pixel(page, fxAt.at, 3 / 1280, 44 / 720);
        check('rounded corners cut the picture’s corners away', px[0] < 40 && px[1] < 40 && px[2] < 40, px.join(','));
        await page.getByRole('slider', { name: 'Border', exact: true }).fill('12');
        px = await pixel(page, fxAt.at, 0.5, 44 / 720);
        check('a border frames the picture', px[0] > 200 && px[1] > 200 && px[2] > 200, px.join(','));
        check('the clip shows an fx badge', /fx/.test(await page.locator('.clip[data-id="' + fxAt.id + '"] .clip-badge').textContent()));

        // Titles: outline and a ready-made style.
        await page.evaluate((t) => window.Reel.seek(t), fxAt.at - 1);
        await page.click('#add-text');
        await page.keyboard.type('Outline');
        await page.keyboard.press('Tab');
        await page.getByRole('slider', { name: 'Outline', exact: true }).fill('6');
        const outlineColour = page.getByLabel('Outline colour');
        await outlineColour.evaluate((i) => { i.value = '#ff0000'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
        const reds = await page.evaluate(async function (t) {
            window.Reel.seek(t);
            await new Promise((r) => setTimeout(r, 300));
            window.Reel.drawFrame();
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 50 && d[i + 2] < 50) n += 1;
            return n;
        }, fxAt.at);
        check('a title outline is drawn in its colour', reds > 1500, reds + ' red pixels');
        await page.getByRole('button', { name: 'Lower-third bar', exact: true }).click();
        const styled = (await project(page)).clips.find((c) => c.type === 'text' && c.text === 'Outline');
        check('a title style places and boxes the title', styled.y === 0.84 && styled.box === true && styled.anim === 'slide');

        // Colour card.
        await page.evaluate((t) => window.Reel.seek(t), fxAt.at + 5);
        await menu(page, 'create', /Colour or gradient card/);
        await page.locator('.modal.generic').getByRole('combobox', { name: 'Style' }).selectOption('solid');
        await page.locator('.modal.generic').getByLabel('Colour', { exact: true }).evaluate((i) => { i.value = '#00ff00'; });
        await page.locator('.modal.generic').getByRole('button', { name: 'Add card' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        p = await project(page);
        const card = p.clips.find((c) => { const m = p.media.find((x) => x.id === c.mediaId); return m && /^Card/.test(m.name); });
        px = card ? await pixel(page, card.start + 1, 0.5, 0.5) : [0, 0, 0];
        check('a colour card is added at the playhead in its colour', card && px[1] > 200 && px[0] < 60, px.join(','));

        // Normalise loudness.
        const toneNow = p.clips.find((c) => c.id === toneClip.id);
        await page.evaluate((id) => window.Reel.select(id), toneNow.id);
        await page.getByRole('button', { name: 'Normalise loudness' }).click();
        const louder = (await project(page)).clips.find((c) => c.id === toneNow.id);
        check('Normalise loudness raises a quiet clip', louder.volume > toneNow.volume, toneNow.volume + ' → ' + louder.volume);

        // The menu bar.
        check('a clean menu bar on the right: File, Edit, View, Create, Tools, Help', (await page.locator('.menubar button:visible').allTextContents()).map((t) => t.trim()).join('|') === 'File|Edit|View|Create|Tools|Help' &&
            await page.locator('.studio-bar').isHidden() && await page.locator('.workspace-size-bar').isHidden() && !(await page.locator('#quran-video').isVisible()));
        await page.click('#file');
        const fileItems = await page.locator('#file-menu .menu-item').allTextContents();
        check('File has new, open, save, my projects, import and export', ['New project', 'Open a project file…', 'Save as a file (Ctrl+S)', 'My projects…', 'Export video…']
            .every((t) => fileItems.includes(t)), fileItems.join('|'));
        await page.hover('#edit');
        check('pointing at the next menu opens it, like a desktop menu bar', await page.locator('#edit-menu').isVisible() && await page.locator('#file-menu').isHidden());
        await page.keyboard.press('ArrowRight');
        check('arrow keys move between menus', await page.locator('#view-menu').isVisible());
        await page.keyboard.press('Escape');
        const beforeUndo = (await project(page)).clips.length;
        await page.click('#add-text');
        await page.keyboard.press('Escape');
        await menu(page, 'edit', /^Undo/);
        check('Edit ▸ Undo undoes', (await project(page)).clips.length === beforeUndo);
        await menu(page, 'view', 'Hide the side panels');
        check('View ▸ Hide the side panels gives the picture the room', await page.locator('.workspace > .bin').isHidden());
        await menu(page, 'view', 'Show the side panels');
        check('and View ▸ Show the side panels brings them back', await page.locator('.workspace > .bin').isVisible());
        const createSections = await page.locator('#create').click().then(() => page.locator('#create-menu .menu-section').allTextContents());
        await page.keyboard.press('Escape');
        check('Create groups everything you can make', createSections.join('|') === 'Add|Islamic videos|Ready-made designs|Sound and recording|Share and brand', createSections.join('|'));

        // Help ▸ About.
        await page.click('#help');
        check('the Help menu has the guide and About', (await page.locator('#help-menu .menu-item').allTextContents()).join('|') === 'User guide|Keyboard shortcuts|About');
        await page.getByRole('menuitem', { name: 'About' }).click();
        const about = page.locator('.modal.generic');
        const aboutText = await about.innerText();
        check('About shows the name, author, version and contact', /Video Editor — NoorEditor/.test(aboutText) && /Feysel Reshid/.test(aboutText) &&
            /Version/.test(aboutText) && /fesbackups@gmail\.com/.test(aboutText) && /never uploaded/.test(aboutText));
        await about.getByRole('button', { name: 'Close' }).click();
        check('and closes', await page.locator('.modal.generic').count() === 0);

        /* ------------------------------------------------ drawing and hands */
        // Counts pixels near a colour in the whole preview frame at time t.
        const countColour = (t, rgb, tol) => page.evaluate(async function (a) {
            window.Reel.seek(a.t);
            await new Promise((r) => setTimeout(r, 150));
            window.Reel.drawFrame();
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (Math.abs(d[i] - a.rgb[0]) <= a.tol && Math.abs(d[i + 1] - a.rgb[1]) <= a.tol && Math.abs(d[i + 2] - a.rgb[2]) <= a.tol) n += 1;
            }
            return n;
        }, { t: t, rgb: rgb, tol: tol || 12 });
        const SKIN = [0xff, 0xc8, 0x3d]; // the emoji yellow
        // Counts hand-coloured pixels — any skin tone, photo or drawn: warm, with red > green > blue.
        const SKIN_TEST = 'd[i] > 110 && d[i + 1] > 60 && d[i] > d[i + 1] && d[i + 1] > d[i + 2] && d[i] - d[i + 2] > 35';
        const countSkin = (t) => page.evaluate(async function (a) {
            if (a.t !== null) {
                window.Reel.seek(a.t);
                await new Promise((r) => setTimeout(r, 150));
                window.Reel.drawFrame();
            }
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            const test = new Function('d', 'i', 'return ' + a.test);
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (test(d, i)) n += 1;
            return n;
        }, { t: t, test: SKIN_TEST });
        const RED = [0xe5, 0x48, 0x4d];
        const shot = (name) => process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }) : null;
        const drawAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 2;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, drawAt);
        await page.locator('#timeline').focus();
        await page.keyboard.press('d');
        check('D opens the drawing board', await page.locator('#draw-bar').isVisible() && await page.locator('#draw-layer').isVisible());
        await page.keyboard.press('Escape');
        check('Escape closes it without adding anything', await page.locator('#draw-bar').count() === 0 &&
            !(await project(page)).clips.some((c) => c.type === 'draw'));

        const previewBefore = await page.locator('#preview').boundingBox();
        await page.click('#add-draw');
        const board = await page.locator('#draw-layer').boundingBox();
        check('the picture is bigger while drawing', board.width > previewBefore.width * 1.15 && await page.locator('.preview-edit-bar').isHidden(),
            Math.round(previewBefore.width) + ' → ' + Math.round(board.width) + ' px wide');
        const drawBar = await page.locator('#draw-bar').boundingBox();
        check('the drawing toolbar sits above the picture, not over it', drawBar.y + drawBar.height <= board.y + 1,
            Math.round(drawBar.y + drawBar.height) + ' vs ' + Math.round(board.y));
        const at = (fx, fy) => [board.x + board.width * fx, board.y + board.height * fy];
        const stroke = async function (from, to, steps) {
            await page.mouse.move(...at(from[0], from[1]));
            await page.mouse.down();
            for (let i = 1; i <= steps; i += 1) {
                await page.mouse.move(...at(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps));
            }
            await page.mouse.up();
        };
        await page.getByRole('button', { name: 'Colour #e5484d' }).click();
        await page.locator('#draw-bar select[aria-label="Thickness"]').selectOption('22');
        await stroke([0.2, 0.3], [0.6, 0.3], 12);
        const live = (await project(page)).clips.filter((c) => c.type === 'draw');
        check('the drawing is on the timeline from its first stroke', live.length === 1 && Math.abs(live[0].start - drawAt) < 0.01 &&
            await page.locator('.clip[data-id="' + live[0].id + '"]').count() === 1);
        await page.getByRole('button', { name: 'Arrow', exact: true }).click();
        await stroke([0.3, 0.6], [0.6, 0.7], 4);
        await page.keyboard.press('Control+z');
        await page.getByRole('button', { name: 'Box', exact: true }).click();
        await stroke([0.25, 0.5], [0.45, 0.8], 4);
        await shot('draw-board');
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        check('and back to normal afterwards', Math.abs((await page.locator('#preview').boundingBox()).width - previewBefore.width) < 2 &&
            await page.locator('.preview-edit-bar').isVisible() && await page.locator('.inspector').isVisible());
        p = await project(page);
        const drawing = p.clips.find((c) => c.type === 'draw');
        check('Done adds the drawing at the playhead on a titles track', drawing && Math.abs(drawing.start - drawAt) < 0.01 &&
            p.tracks.find((t) => t.id === drawing.track).kind === 'text', drawing && drawing.start);
        check('the pen line and box are kept, and undo took the arrow off', drawing && drawing.strokes.length === 2 &&
            drawing.strokes[0].color === '#e5484d' && drawing.strokes[0].width === 22 && drawing.strokes[1].straight, drawing && drawing.strokes.length);
        check('a drawing is drawn on, with a hand holding a pen', drawing && drawing.anim === 'draw' && ['pen', 'pencil'].includes(drawing.hand));
        const half = await countColour(drawing.start + drawing.animDuration * 0.3, RED, 30);
        const full = await countColour(drawing.start + drawing.animDuration + 1, RED, 30);
        check('it appears stroke by stroke', half > 500 && full > half * 1.5, half + ' → ' + full + ' red pixels');
        const handMid = await countSkin(drawing.start + drawing.animDuration * 0.3);
        await shot('draw-hand');
        const handGone = await countSkin(drawing.start + drawing.animDuration + 1);
        check('the hand draws, then leaves', handMid > 2000 && handGone === 0, handMid + ' → ' + handGone + ' skin pixels');
        check('a drawing with a hand shows ✍ on the timeline', /✍/.test(await page.locator('.clip[data-id="' + drawing.id + '"] .clip-badge').textContent()));
        await page.evaluate((id) => window.Reel.select(id), drawing.id);
        await page.getByRole('combobox', { name: 'Hand', exact: true }).selectOption('none');
        check('the hand can be turned off', await countSkin(drawing.start + drawing.animDuration * 0.3) === 0);
        await page.keyboard.press('Control+z');

        await page.locator('.clip[data-id="' + drawing.id + '"]').dblclick();
        check('double-clicking a drawing opens it for editing', await page.locator('#draw-bar').isVisible());
        await page.getByRole('button', { name: 'Eraser', exact: true }).click();
        await stroke([0.25, 0.65], [0.25, 0.7], 3);
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        check('the eraser rubs out a stroke', (await project(page)).clips.find((c) => c.id === drawing.id).strokes.length === 1);
        await page.keyboard.press('Control+z');
        check('and editing a drawing is one undo step', (await project(page)).clips.find((c) => c.id === drawing.id).strokes.length === 2);

        // Cancel takes a new drawing off the timeline again.
        const playAt = drawing.start + drawing.duration + 2;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, playAt);
        const drawsBefore = (await project(page)).clips.filter((c) => c.type === 'draw').length;
        await page.click('#add-draw');
        await stroke([0.3, 0.4], [0.6, 0.45], 6);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        check('Cancel takes the new drawing off the timeline', (await project(page)).clips.filter((c) => c.type === 'draw').length === drawsBefore);

        // Pressing Play while drawing finishes the drawing and plays it, hand and all.
        await page.click('#add-draw');
        await stroke([0.2, 0.4], [0.7, 0.45], 10);
        await stroke([0.2, 0.6], [0.7, 0.65], 10);
        await page.click('#play');
        await page.waitForTimeout(900);
        const playingHand = await countSkin(null);
        const playedDraw = (await project(page)).clips.filter((c) => c.type === 'draw').find((c) => Math.abs(c.start - playAt) < 0.01);
        await shot('draw-play');
        await page.click('#play');
        check('Play while drawing finishes the drawing, keeps it on the timeline and plays it with the hand',
            await page.locator('#draw-bar').count() === 0 && !!playedDraw && playedDraw.strokes.length === 2 && playingHand > 300, playingHand + ' hand pixels while playing');
        await page.keyboard.press('Control+z');
        check('and that is one undo step', !(await project(page)).clips.some((c) => c.type === 'draw' && Math.abs(c.start - playAt) < 0.01));

        // Titles written or typed by hand.
        const handAt = drawAt + 8;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, handAt);
        await page.click('#add-text');
        await page.keyboard.type('Bismillah');
        await page.keyboard.press('Tab');
        await page.getByRole('button', { name: '✍ Write by hand' }).click();
        p = await project(page);
        const written = p.clips.find((c) => c.type === 'text' && c.text === 'Bismillah');
        check('Write by hand sets handwriting with a pen', written.anim === 'handwrite' && written.hand === 'pen');
        const WHITE = [255, 255, 255];
        const span = Math.max(written.animDuration, written.duration * 0.75);
        const inkHalf = await countColour(handAt + span * 0.45, WHITE, 8);
        const handWriting = await countSkin(handAt + span * 0.45);
        await shot('write-hand');
        const inkFull = await countColour(handAt + span + 0.7, WHITE, 8);
        const handAfter = await countSkin(handAt + span + 0.7);
        check('the title is written out from the start', inkHalf > 200 && inkFull > inkHalf * 1.4, inkHalf + ' → ' + inkFull);
        check('a hand holds the pen while it writes, then leaves', handWriting > 1500 && handAfter === 0, handWriting + ' → ' + handAfter);
        const arabicOk = await page.evaluate(function (id) {
            const app = window.ReelApp;
            app.state.project = app.T.updateClip(app.state.project, id, { text: 'بسم الله' });
            app.commit();
            return true;
        }, written.id);
        const arabicHand = await countSkin(handAt + span * 0.45);
        check('Arabic titles are written by hand too', arabicOk && arabicHand > 1500, arabicHand);
        await page.keyboard.press('Control+z');
        await page.evaluate((id) => window.Reel.select(id), written.id);
        // The pen's own colour, the sketch style, and the size.
        const GREEN = [0x2e, 0x7d, 0x32];
        // The real-hand photo always has a black pen; the drawn styles take any colour.
        await page.getByRole('combobox', { name: 'Hand style', exact: true }).selectOption('emoji');
        const greenBefore = await countColour(handAt + span * 0.45, GREEN, 40);
        await page.getByRole('combobox', { name: 'Pen colour', exact: true }).selectOption('own');
        await page.getByLabel('Colour of the pen').evaluate((i) => { i.value = '#2e7d32'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
        const greenPen = await countColour(handAt + span * 0.45, GREEN, 40);
        check('the pen can be any colour', (await project(page)).clips.find((c) => c.id === written.id).penColor === '#2e7d32' && greenPen > greenBefore + 300,
            greenBefore + ' → ' + greenPen);
        const bigBefore = await countSkin(handAt + span * 0.45);
        await page.getByRole('slider', { name: 'Hand size', exact: true }).fill('200');
        const bigAfter = await countSkin(handAt + span * 0.45);
        check('the hand can be made bigger', bigAfter > bigBefore * 2.5, bigBefore + ' → ' + bigAfter);
        await page.getByRole('combobox', { name: 'Hand style', exact: true }).selectOption('sketch');
        check('and drawn in the sketch style instead', (await project(page)).clips.find((c) => c.id === written.id).handStyle === 'sketch');
        await shot('hand-options');
        await page.getByRole('button', { name: /Type with (real )?hand/ }).click();
        const typed = (await project(page)).clips.find((c) => c.id === written.id);
        const tapping = await countSkin(handAt + span * 0.45);
        await shot('type-hand');
        check('Type with hand types it with a tapping finger', typed.anim === 'typewriter' && typed.hand === 'finger' && tapping > 800, tapping);
        // The illustrated typing hand comes in skin colours.
        await page.getByRole('combobox', { name: 'Hand style', exact: true }).selectOption('emoji');
        await page.getByRole('combobox', { name: 'Skin', exact: true }).selectOption('dark');
        const dark = await countColour(handAt + span * 0.45, [0x7d, 0x4f, 0x30]);
        check('the hand’s skin colour can be changed', dark > 800, dark);

        // The Write button adds a title that is written by hand in one go.
        const writeAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 1;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, writeAt);
        await page.click('#add-handwrite');
        await page.keyboard.type('Written');
        const quick = (await project(page)).clips.find((c) => c.type === 'text' && c.text === 'Written');
        check('the Write button adds a title written by a hand with a pen', !!quick && quick.anim === 'handwrite' && quick.hand === 'pen' &&
            await page.getByRole('combobox', { name: 'Hand', exact: true }).isVisible());

        /* ------------------------------------- hand size, workspace, watermark */
        // The drawing board's hand size.
        const sizeAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 1;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, sizeAt);
        await page.click('#add-draw');
        await page.locator('#draw-bar select[aria-label="Hand size"]').selectOption('1.9');
        const board2 = await page.locator('#draw-layer').boundingBox();
        await page.mouse.move(board2.x + board2.width * 0.3, board2.y + board2.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(board2.x + board2.width * 0.6, board2.y + board2.height * 0.5, { steps: 6 });
        await page.mouse.up();
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        const bigHand = (await project(page)).clips.find((c) => c.type === 'draw' && Math.abs(c.start - sizeAt) < 0.01);
        check('the drawing board can make the hand huge', bigHand && bigHand.handSize === 1.9);
        await page.keyboard.press('Control+z');

        // Dragging the edges and corner of the video area.
        const viewerW = async () => (await page.locator('.viewer').boundingBox()).width;
        const w0 = await viewerW();
        const edge = await page.locator('.col-resizer.right').boundingBox();
        await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
        await page.mouse.down();
        await page.mouse.move(edge.x + edge.width / 2 + 120, edge.y + 200, { steps: 5 });
        await page.mouse.up();
        const w1 = await viewerW();
        check('dragging the right edge of the video area makes it wider', w1 > w0 + 80, Math.round(w0) + ' → ' + Math.round(w1));
        const h0 = (await page.locator('.viewer').boundingBox()).height;
        const grip = await page.locator('.stage-grip').boundingBox();
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + grip.height / 2 - 80, { steps: 5 });
        await page.mouse.up();
        const after = await page.locator('.viewer').boundingBox();
        check('the corner grip makes the video area smaller both ways', after.width < w1 - 80 && after.height < h0 - 60,
            Math.round(w1) + '×' + Math.round(h0) + ' → ' + Math.round(after.width) + '×' + Math.round(after.height));
        await page.evaluate(() => { ['reel.binWidth', 'reel.inspectorWidth', 'reel.timelineHeight'].forEach((k) => localStorage.removeItem(k)); document.body.style.removeProperty('--insp-w'); document.body.style.removeProperty('--timeline-h'); window.dispatchEvent(new Event('resize')); });

        // The nooreditor.web.app watermark.
        const markPixels = () => page.evaluate(function () {
            window.Reel.drawFrame();
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(Math.floor(c.width * 0.7), Math.floor(c.height * 0.9), Math.floor(c.width * 0.3), Math.floor(c.height * 0.1)).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && Math.abs(d[i] - d[i + 2]) < 12) n += 1;
            return n;
        });
        await page.evaluate((t) => window.Reel.seek(t), sizeAt + 30);
        const marked = await markPixels();
        await page.evaluate(() => window.ReelApp.selectOnly(null));
        await page.locator('.inspector-body label.check', { hasText: 'nooreditor.web.app' }).click();
        const unmarked = await markPixels();
        check('the nooreditor.web.app watermark is in the corner, and can be turned off', marked > 150 && unmarked === 0 &&
            (await project(page)).watermark === false, marked + ' → ' + unmarked);
        await page.keyboard.press('Control+z');
        check('it is on again after undo', (await project(page)).watermark !== false);

        /* ---------------------------------------------------------- animations */
        const animAt = sizeAt + 2;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, animAt);
        await page.click('#add-text');
        await page.keyboard.type('Spin');
        await page.locator('#timeline').focus();
        await page.getByRole('combobox', { name: 'Entrance', exact: true }).selectOption('spin');
        await page.getByRole('combobox', { name: 'Exit', exact: true }).selectOption('fade');
        const spun = (await project(page)).clips.find((c) => c.type === 'text' && c.text === 'Spin');
        const spinState = await page.evaluate((id) => {
            const c = window.Reel.project.clips.find((x) => x.id === id);
            const T = window.TimelineCore;
            return [T.textAnimAt(c, c.start + 0.15), T.textAnimAt(c, c.start + c.duration - 0.1), T.textAnimAt(c, c.start + 2)];
        }, spun.id);
        check('new title entrances turn the title in, and exits fade it out', spinState[0].rotate < -0.5 && spinState[1].alpha < 0.3 &&
            spinState[2].alpha === 1 && !spinState[2].rotate, spinState[0].rotate.toFixed(2) + ' / ' + spinState[1].alpha.toFixed(2));
        const entranceList = await page.getByRole('combobox', { name: 'Entrance', exact: true }).locator('option').allTextContents();
        check('titles have many entrances', entranceList.length >= 15 && entranceList.includes('Bounce') && entranceList.includes('Blur in'), entranceList.length);
        // A picture's own entrance.
        const pic = p.media.find((m) => m.type === 'image') || (await project(page)).media.find((m) => m.type === 'image');
        const picClip = await page.evaluate(function (a) {
            const app = window.ReelApp;
            const T = app.T;
            let p = app.state.project;
            const id = T.nextTrackId(p, 'video');
            p = T.addTrack(p, 'video');
            const clip = Object.assign(T.clipFromMedia(T.getMedia(p, a.media), id, a.at), { duration: 3, enter: 'zoom-in', enterDuration: 1 });
            app.state.project = T.addClip(p, clip);
            app.commit();
            return clip.id;
        }, { media: pic.id, at: animAt + 6 });
        const coverage = (t) => page.evaluate(async function (time) {
            window.Reel.seek(time);
            await new Promise((r) => setTimeout(r, 200));
            window.Reel.drawFrame();
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 25 && d[i + 2] > d[i] + 20) n += 1;
            return n;
        }, t);
        const zoomStart = await coverage(animAt + 6.2);
        const zoomEnd = await coverage(animAt + 7.5);
        check('a picture can zoom in as it appears', zoomStart > 0 && zoomEnd > zoomStart * 1.6, zoomStart + ' → ' + zoomEnd + ' blue pixels');
        await page.evaluate((id) => window.Reel.select(id), picClip);
        check('pictures have entrance and exit choices', await page.getByRole('combobox', { name: 'Entrance', exact: true }).isVisible() &&
            await page.getByRole('combobox', { name: 'Exit', exact: true }).isVisible());

        /* ------------------------------------------------------------ templates */
        await menu(page, 'create', 'Templates…');
        const cardCount = await page.locator('.modal.generic .studio-card').count();
        check('there are many templates to start from', cardCount >= 46, cardCount);
        await page.locator('.modal.generic .studio-card', { hasText: 'Quiz time' }).click();
        await page.locator('.modal.generic').getByRole('button', { name: 'Use template' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
        const quiz = (await project(page)).clips.filter((c) => c.type === 'text' && c.anim === 'spin');
        check('a new template adds its scenes with its own animation', quiz.length >= 3, quiz.length);
        await page.keyboard.press('Control+z');

        /* -------------------------------------------------------------- stickers */
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, animAt + 20);
        await menu(page, 'create', /Animated stickers/);
        const stickerBox = page.locator('.modal.generic');
        const kinds = await stickerBox.getByRole('combobox', { name: 'Sticker' }).locator('option').count();
        await stickerBox.getByRole('combobox', { name: 'Sticker' }).selectOption('minaret');
        await stickerBox.getByRole('combobox', { name: 'Animation' }).selectOption('spin');
        await stickerBox.getByRole('button', { name: 'Add sticker' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        const added = (await project(page)).clips.find((c) => c.sticker && c.sticker.kind === 'minaret');
        check('there are many stickers, with new ones and new motions', kinds >= 50 && added && added.sticker.motion === 'spin', kinds + ' stickers');
        await page.keyboard.press('Control+z');

        /* ------------------------------------------------------------------ tabs */
        page.on('dialog', (d) => d.accept());
        const firstClips = (await project(page)).clips.length;
        await page.click('.tab-add');
        check('+ opens a second project in a new tab', await page.locator('.project-tab').count() === 2 && (await project(page)).clips.length === 0);
        await page.click('#add-text');
        await page.keyboard.type('Second video');
        await page.locator('#timeline').focus();
        await page.locator('.project-tab .tab-name').first().click();
        check('switching back shows the first project untouched', (await project(page)).clips.length === firstClips);
        await page.locator('.project-tab .tab-name').nth(1).click();
        check('and the second keeps its own work', (await project(page)).clips.some((c) => c.text === 'Second video'));
        await page.keyboard.press('Control+z');
        check('each tab has its own undo', !(await project(page)).clips.some((c) => c.text === 'Second video'));
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(600);
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        check('both tabs come back after a reload', await page.locator('.project-tab').count() === 2 &&
            (await project(page)).clips.some((c) => c.text === 'Second video'));
        await page.locator('.project-tab .tab-close').nth(1).click();
        check('a tab can be closed, leaving the first project', await page.locator('.project-tab').count() === 1 && (await project(page)).clips.length === firstClips);

        /* ------------------------------------------------------------- keyframes */
        const kfAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 1;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); }, kfAt);
        await page.click('#add-text');
        await page.keyboard.type('Moving');
        await page.locator('#timeline').focus();
        const moving = (await project(page)).clips.find((c) => c.text === 'Moving');
        await page.getByRole('button', { name: '◆ Add keyframe here' }).click();
        await page.evaluate((t) => window.Reel.seek(t), kfAt + 3);
        await page.evaluate((id) => window.Reel.select(id), moving.id);
        await page.getByRole('slider', { name: 'Position X', exact: true }).fill('85');
        await page.getByRole('slider', { name: 'Turn', exact: true }).fill('90');
        const kfClip = (await project(page)).clips.find((c) => c.id === moving.id);
        const kfMid = await page.evaluate((a) => window.TimelineCore.keyframeAt(window.Reel.project.clips.find((c) => c.id === a.id), a.t), { id: moving.id, t: kfAt + 1.5 });
        check('keyframes move and turn a title smoothly between two moments', kfClip.keys.length === 2 && kfClip.keys[1].x === 0.85 &&
            kfClip.keys[1].rotate === 90 && kfMid.x > 0.55 && kfMid.x < 0.8 && kfMid.rotate > 20 && kfMid.rotate < 70, JSON.stringify(kfMid));
        check('the timeline shows the keyframes', await page.locator('.clip[data-id="' + moving.id + '"] .clip-key').count() === 2);
        await page.getByRole('combobox', { name: 'Quick animation', exact: true }).selectOption({ label: 'Spin' });
        const spinKeys = (await project(page)).clips.find((c) => c.id === moving.id).keys;
        check('a quick animation sets keyframes in one go', spinKeys.length === 2 && spinKeys[1].rotate === 360);

        /* ------------------------------------------------------------- brand kit */
        const logoPng = await makePng(page);
        await menu(page, 'create', 'Brand kit…');
        const kitBox = page.locator('.modal.generic');
        await kitBox.getByPlaceholder('Your channel or organisation').fill('Noor Studio');
        await kitBox.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logoPng });
        await kitBox.locator('img[alt="Logo"]').waitFor({ state: 'visible' });
        await kitBox.getByRole('combobox', { name: 'Brand font' }).selectOption('marcellus');
        await kitBox.getByLabel('Add my intro at the start (3 s)').check();
        await kitBox.getByLabel('Add my outro at the end (4 s)').check();
        const beforeKit = await project(page);
        const beforeKitLength = beforeKit.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        await kitBox.getByRole('button', { name: 'Save and apply' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
        p = await project(page);
        const introText = p.clips.find((c) => c.type === 'text' && c.start === 0 && /Noor Studio/.test(c.text));
        const outroText = p.clips.find((c) => c.type === 'text' && /Thank you for watching/.test(c.text));
        check('the brand kit puts the logo in the corner and titles in the brand font', p.brandLogo && /^data:image\/png/.test(p.brandLogo.src) &&
            p.clips.filter((c) => c.type === 'text').every((c) => c.font === 'marcellus' || /[؀-ۿ]/.test(c.text || '')));
        check('and adds an intro (moving everything 3 s later) and an outro', !!introText && !!outroText &&
            approx(outroText.start, beforeKitLength + 3, 0.05), outroText && outroText.start);
        check('the kit is kept for next time', await page.evaluate(() => JSON.parse(localStorage.getItem('reel.brand')).name) === 'Noor Studio');
        await page.keyboard.press('Control+z');
        check('and the whole thing is one undo step', !(await project(page)).brandLogo && (await project(page)).clips.length === beforeKit.clips.length);

        /* ------------------------------------------------------------------ Short */
        const tabsBefore = await page.locator('.project-tab').count();
        await menu(page, 'create', /Make a Short/);
        const shortBox = page.locator('.modal.generic');
        await shortBox.getByRole('textbox', { name: 'From' }).fill('00:00.00');
        await shortBox.getByRole('textbox', { name: 'To' }).fill('00:05.00');
        await shortBox.getByPlaceholder('A big title on top').fill('My first Short');
        await shortBox.getByRole('button', { name: 'Make Short' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        p = await project(page);
        check('Make a Short opens a 9:16 Short of that part in a new tab', await page.locator('.project-tab').count() === tabsBefore + 1 &&
            p.width === 1080 && p.height === 1920 && approx(p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0), 7.5, 0.05) &&
            p.clips.some((c) => c.text === 'My first Short') && p.progressBar && !!p.brandLogo, p.width + 'x' + p.height);
        await page.locator('.project-tab .tab-close').last().click();
        check('closing it goes back to the original video', (await project(page)).width === 1280);

        /* -------------------------------------------------------------- sounds */
        const soundAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 1;
        await page.evaluate((t) => window.Reel.seek(t), soundAt);
        await menu(page, 'create', /Sound library/);
        const soundBox = page.locator('.modal.generic');
        await soundBox.getByRole('combobox', { name: 'Length of nature sounds' }).selectOption('15');
        await soundBox.getByRole('button', { name: 'Add Rain' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
        p = await project(page);
        const rain = p.media.find((m) => /^Rain/.test(m.name));
        const rainClip = rain && p.clips.find((c) => c.mediaId === rain.id);
        check('the sound library adds rain at the playhead on an audio track', rain && approx(rain.duration, 15, 0.1) && rainClip &&
            approx(rainClip.start, soundAt, 0.01) && p.tracks.find((t) => t.id === rainClip.track).kind === 'audio', rain && rain.duration);
        await menu(page, 'create', /Sound library/);
        await page.locator('.modal.generic').getByRole('button', { name: 'Add Whoosh' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
        check('and sound effects next to it on a free track', (await project(page)).media.some((m) => /^Whoosh/.test(m.name)));

        /* ------------------------------------------------------------ recording */
        await menu(page, 'create', /Record screen/);
        const recBox = page.locator('.modal.generic');
        await recBox.getByRole('combobox', { name: 'Record' }).selectOption('camera');
        await recBox.getByRole('button', { name: '● Start recording' }).click();
        await page.waitForSelector('.record-bar', { timeout: 15000 });
        await page.waitForTimeout(1500);
        const mediaBefore = (await project(page)).media.length;
        await page.locator('.record-bar').getByRole('button', { name: '■ Stop' }).click();
        await page.waitForFunction((n) => window.Reel.project.media.length > n, mediaBefore, { timeout: 20000 });
        p = await project(page);
        const rec = p.media.find((m) => /^Recording/.test(m.name));
        check('camera recording is added to the media and the timeline', rec && rec.type === 'video' && p.clips.some((c) => c.mediaId === rec.id), rec && rec.name);

        /* -------------------------------------------------------------- library */
        await page.waitForTimeout(1800);
        await menu(page, 'file', 'My projects…');
        const libBox = page.locator('.modal.generic');
        const cards = await libBox.locator('.library-card').count();
        check('My projects lists your projects with a picture of each', cards >= 1 && await libBox.locator('.library-card.current img').count() === 1, cards);
        await libBox.locator('.library-card.current').getByRole('button', { name: 'Duplicate' }).click();
        check('a project can be duplicated', await libBox.locator('.library-card').count() === cards + 1);
        await libBox.locator('.library-card', { hasText: '(copy)' }).getByRole('button', { name: 'Open in a tab' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        check('and opened in a tab', /\(copy\)/.test((await project(page)).name) && await page.locator('.project-tab').count() === tabsBefore + 1);
        await page.locator('.project-tab .tab-close').last().click();

        /* ------------------------------------------------- sync to the voice */
        await page.setInputFiles('#import-input', [{ name: 'talk.wav', mimeType: 'audio/wav',
            buffer: speechWav([[1, 1.2], [0, 0.6], [1, 1.2], [0, 0.6], [1, 1.2], [0, 0.6], [1, 1.2]]) }]);
        await page.waitForFunction(() => window.Reel.project.media.some((m) => m.name === 'talk.wav'), null, { timeout: 15000 });
        const talkId = await page.evaluate(function () {
            const m = window.Reel.project.media.find((x) => x.name === 'talk.wav');
            window.ReelApp.addToTimeline(m.id);
            const c = window.Reel.project.clips.filter((x) => x.mediaId === m.id).pop();
            window.Reel.select(c.id);
            return c.id;
        });
        const talk = (await project(page)).clips.find((c) => c.id === talkId);
        await menu(page, 'create', /Pictures on the pauses/);
        const syncBox = page.locator('.modal.generic');
        await syncBox.locator('.sync-found', { hasText: /Found 3 pauses/ }).waitFor({ timeout: 15000 }).catch(async () => {
            throw new Error('sync: ' + await page.locator('.toast').allTextContents());
        });
        check('Sync to voice finds the pauses in a voice', true);
        const durBefore = await page.evaluate(() => window.ReelApp.T.projectDuration(window.Reel.project));
        await syncBox.getByRole('spinbutton', { name: 'Shortest scene (seconds)' }).fill('1');
        await syncBox.getByRole('button', { name: 'Apply' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        p = await project(page);
        const sceneTrack = p.tracks.find((t) => t.name === 'Scenes on the pauses');
        const scenes = sceneTrack ? onTrack(p, sceneTrack.id) : [];
        check('pictures go on the pauses, a new scene at each one', scenes.length === 4 && approx(scenes[0].start, talk.start, 0.01) &&
            approx(scenes[1].start, talk.start + 1.5, 0.08) && approx(scenes[3].start + scenes[3].duration, talk.start + talk.duration, 0.02) &&
            scenes[1].transition && scenes[1].transition.type === 'crossfade' && !!scenes[0].motion, scenes.map((c) => c.start.toFixed(2)).join(','));
        await page.keyboard.press('Control+z');
        check('one undo takes the scenes off', !(await project(page)).tracks.some((t) => t.name === 'Scenes on the pauses'));
        await menu(page, 'create', /Pictures on the pauses/);
        await syncBox.locator('.sync-found', { hasText: /Found 3 pauses/ }).waitFor({ timeout: 15000 });
        await syncBox.getByRole('combobox', { name: 'Do this' }).selectOption('cut');
        await syncBox.getByRole('spinbutton', { name: 'Shortest scene (seconds)' }).fill('1');
        await syncBox.getByRole('button', { name: 'Apply' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        p = await project(page);
        check('cut at the pauses splits the clip into pieces', p.clips.filter((c) => c.mediaId === talk.mediaId).length === 4);
        await page.keyboard.press('Control+z');
        await page.evaluate((id) => window.Reel.select(id), talkId);
        await menu(page, 'create', /Pictures on the pauses/);
        await syncBox.locator('.sync-found', { hasText: /Found 3 pauses/ }).waitFor({ timeout: 15000 });
        await syncBox.getByRole('combobox', { name: 'Do this' }).selectOption('remove');
        await syncBox.getByRole('button', { name: 'Apply' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached' });
        const durAfter = await page.evaluate(() => window.ReelApp.T.projectDuration(window.Reel.project));
        check('remove the pauses makes jump cuts and shortens the video', durBefore - durAfter > 0.6 && durBefore - durAfter < 1.4, (durBefore - durAfter).toFixed(2));
        await page.keyboard.press('Control+z');

        /* ------------------------------------- captions for Afaan Oromoo, Amharic */
        await page.evaluate((id) => window.Reel.select(id), talkId);
        await page.click('#tools');
        await page.getByRole('menuitem', { name: /Auto captions/ }).click();
        const capBox = page.locator('.modal.generic');
        await capBox.getByRole('combobox', { name: 'Language' }).selectOption('amharic');
        check('choosing Amharic picks the most accurate speech model', await capBox.getByRole('combobox', { name: 'Model' }).inputValue() === 'onnx-community/whisper-small_timestamped');
        await capBox.getByRole('combobox', { name: 'Language' }).selectOption('oromo');
        check('choosing Afaan Oromoo asks for the words instead', await capBox.getByRole('textbox', { name: 'What is said' }).isVisible() &&
            !(await capBox.getByRole('combobox', { name: 'Model' }).isVisible()));
        await capBox.getByRole('combobox', { name: 'Listen to' }).selectOption('clip');
        await capBox.getByRole('textbox', { name: 'What is said' }).fill('Akkam jirtu?\nNagaa dha.\nGalatoomaa.\nNagaan turaa.');
        await capBox.getByRole('button', { name: 'Make captions' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 15000 });
        p = await project(page);
        const oroTrack = p.tracks.find((t) => t.name === 'Captions' && t.id !== capTrack.id);
        const oro = oroTrack ? onTrack(p, oroTrack.id) : [];
        check('Afaan Oromoo captions are timed to the voice from the pasted words', oro.length === 4 && oro[0].text === 'Akkam jirtu?' &&
            approx(oro[0].start, talk.start, 0.1) && approx(oro[1].start, talk.start + 1.8, 0.15) && approx(oro[3].start, talk.start + 5.4, 0.15),
            oro.map((c) => c.text + '@' + (c.start - talk.start).toFixed(2)).join(' | '));
        await page.keyboard.press('Control+z');
        await page.click('#tools');
        await page.getByRole('menuitem', { name: /Timed captions from your text/ }).click();
        await capBox.getByRole('textbox', { name: 'What is said' }).fill('ሰላም ነው። እንኳን ደህና መጣችሁ።');
        await capBox.getByRole('button', { name: 'Make captions' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 15000 });
        p = await project(page);
        const amTrack = p.tracks.find((t) => t.name === 'Captions' && t.id !== capTrack.id);
        check('timed captions from your text work in any script (Amharic)', amTrack && onTrack(p, amTrack.id).some((c) => /ሰላም/.test(c.text)));
        await page.keyboard.press('Control+z');

        /* ------------------------------------------------- occasion videos */
        await page.evaluate((id) => window.Reel.select(id), talkId);
        await menu(page, 'create', /Occasion video/);
        const occBox = page.locator('.modal.generic');
        await occBox.getByRole('combobox', { name: 'Occasion' }).selectOption('hajj');
        check('each occasion shows its painted scenes and greeting', await occBox.locator('.occasion-preview canvas').count() === 5 &&
            await occBox.getByRole('textbox', { name: 'Greeting' }).inputValue() === 'Labbayk Allahumma labbayk');
        check('and follows the selected voice', /talk\.wav/.test(await occBox.getByRole('combobox', { name: 'Timing' }).evaluate((s) => s.options[s.selectedIndex].textContent)));
        await occBox.getByRole('button', { name: 'Make video' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
        p = await project(page);
        const hajjTrack = p.tracks.find((t) => t.name === 'Hajj scenes');
        const hajj = hajjTrack ? onTrack(p, hajjTrack.id) : [];
        check('an occasion video puts painted scenes on the voice’s pauses', hajj.length >= 2 && approx(hajj[0].start, talk.start, 0.01) &&
            approx(hajj[hajj.length - 1].start + hajj[hajj.length - 1].duration, talk.start + talk.duration, 0.02) &&
            p.media.filter((m) => /^Hajj – /.test(m.name)).length === 5, hajj.map((c) => (c.start - talk.start).toFixed(2)).join(','));
        check('with the greeting in English and Arabic', p.clips.some((c) => c.type === 'text' && c.text === 'Labbayk Allahumma labbayk') &&
            p.clips.some((c) => c.type === 'text' && c.text === 'لبيك اللهم لبيك'));
        const occFrame = await pixel(page, hajj[0].start + 0.5, 0.5, 0.2);
        check('the painted scene is drawn', occFrame[0] + occFrame[1] + occFrame[2] > 30, occFrame.join(','));
        await page.keyboard.press('Control+z');
        check('one undo takes the occasion video off', !(await project(page)).tracks.some((t) => t.name === 'Hajj scenes'));

        /* ------------------------------------------------------- read aloud */
        await page.evaluate(function () {
            window.__speakerCalls = [];
            window.__reelTestSpeaker = async function (parts, models) {
                window.__speakerCalls.push({ parts: parts, models: models });
                return { rate: 16000, model: models[0], parts: parts.map((t) => Float32Array.from({ length: 16000 * (0.5 + t.length / 40) }, (x, i) => Math.sin(i / 8) * 0.3)) };
            };
        });
        const sayAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 1;
        await page.evaluate((t) => window.Reel.seek(t), sayAt);
        await menu(page, 'create', /Read aloud/);
        const sayBox = page.locator('.modal.generic');
        await sayBox.getByRole('combobox', { name: 'Voice' }).selectOption('amh');
        await sayBox.getByRole('textbox', { name: 'Text' }).fill('ሰላም ነው። እንኳን ደህና መጣችሁ።');
        await sayBox.getByRole('button', { name: 'Make voice-over' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 15000 });
        const calls = await page.evaluate(() => window.__speakerCalls);
        check('read aloud gives the voice each sentence, Amharic romanised', calls.length === 1 && calls[0].parts.length === 2 && calls[0].parts[0] === 'selam new.' &&
            calls[0].models[0] === 'Xenova/mms-tts-amh', JSON.stringify(calls[0]));
        p = await project(page);
        const sayMedia = p.media.find((m) => /^Read aloud \(Amharic\)/.test(m.name));
        const sayClip = sayMedia && p.clips.find((c) => c.mediaId === sayMedia.id);
        const sayCaps = p.tracks.find((t) => t.name === 'Voice-over captions');
        const capsOn = sayCaps ? onTrack(p, sayCaps.id) : [];
        check('the voice-over lands at the playhead with a caption per sentence, timed to it', sayClip && approx(sayClip.start, sayAt, 0.01) &&
            capsOn.length === 2 && capsOn[0].text === 'ሰላም ነው።' && approx(capsOn[0].start, sayAt, 0.01) && capsOn[1].start > capsOn[0].start + 0.5,
            capsOn.map((c) => c.text + '@' + (c.start - sayAt).toFixed(2)).join(' | '));
        await page.keyboard.press('Control+z');

        /* ---------------------------------------------- Qur'an backgrounds */
        await menu(page, 'create', /Qur’ān verse video/);
        const qBox = page.locator('.modal.generic');
        await qBox.getByRole('combobox', { name: 'Recitation' }).locator('option[value="rec:7"]').waitFor({ state: 'attached' });
        await qBox.getByRole('combobox', { name: 'Recitation' }).selectOption('rec:7');
        await qBox.getByRole('spinbutton', { name: 'To ayah' }).fill('3');
        await qBox.getByRole('spinbutton', { name: 'To ayah' }).dispatchEvent('change');
        await qBox.getByRole('combobox', { name: 'Background' }).selectOption('scenes:nature');
        await qBox.getByRole('button', { name: 'Make video' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 30000 });
        p = await project(page);
        const bgTrack = p.tracks.filter((t) => t.name === 'Background').pop();
        const bgs = bgTrack ? onTrack(p, bgTrack.id).filter((c) => /Nature/.test((p.media.find((m) => m.id === c.mediaId) || {}).name || '')) : [];
        const ayat = p.clips.filter((c) => /001-00[1-3]/.test((p.media.find((m) => m.id === c.mediaId) || {}).name || '')).sort((a, b) => a.start - b.start).slice(-3);
        check('a Qur’ān video can change its painted background on each āyah', bgs.length === 4 && ayat.length === 3 &&
            ayat.every((a) => bgs.some((b) => approx(b.start, a.start, 0.01))), bgs.map((c) => c.start.toFixed(2)).join(',') + ' / ' + ayat.map((c) => c.start.toFixed(2)).join(','));
        await page.keyboard.press('Control+z');

        /* ------------------------------------------------- auto-reframe */
        const sizeBefore = await page.evaluate(() => [window.Reel.project.width, window.Reel.project.height]);
        await menu(page, 'view', /1080×1920/);
        await page.evaluate(function () {
            let n = 0;
            // The face starts in the middle, then moves to the right.
            window.__reelTestFaceDetector = async function () { n += 1; return n <= 2 ? 0.5 : 0.85; };
        });
        const vidClip = (await project(page)).clips.find((c) => c.mediaId === vid.id);
        await page.evaluate((id) => window.Reel.select(id), vidClip.id);
        await menu(page, 'tools', /Auto-reframe/);
        await page.locator('.modal.generic').getByRole('button', { name: 'Follow the face' }).click();
        await page.waitForSelector('.modal.generic', { state: 'detached', timeout: 20000 });
        const framed = (await project(page)).clips.find((c) => c.id === vidClip.id);
        check('auto-reframe follows the face in a tall frame with keyframes', framed.fit === 'cover' && framed.keys && framed.keys[0].x === 0.5 &&
            framed.keys[framed.keys.length - 1].x < 0.2, JSON.stringify(framed.keys) + ' ' + (await page.locator('#toast').textContent()));
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+z');
        const sizeAfter = await page.evaluate(() => [window.Reel.project.width, window.Reel.project.height]);
        if (sizeAfter.join('x') !== sizeBefore.join('x')) await menu(page, 'view', new RegExp('^\\W*' + sizeBefore.join('×')));
        check('and undo puts the clip and frame back', !(await project(page)).clips.find((c) => c.id === vidClip.id).keys &&
            (await page.evaluate(() => window.Reel.project.width)) === sizeBefore[0]);

        /* ---------------------------------------------------------- on a phone */
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(200);
        const phoneAt = (await project(page)).clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + 1;
        await page.evaluate((t) => { window.Reel.seek(t); window.ReelApp.selectOnly(null); document.getElementById('workspace').classList.remove('show-inspector'); }, phoneAt);
        check('on a phone the details panel starts hidden', !(await page.locator('#inspector').isVisible()));
        const bar = await page.evaluate(() => { const t = document.querySelector('.topbar'); const e = document.getElementById('export').getBoundingClientRect(); return [t.scrollWidth, t.clientWidth, e.right]; });
        check('on a phone the top bar fits, with Export in reach', bar[0] <= bar[1] + 1 && bar[2] <= 390, bar.join(','));
        await page.click('#create');
        const sheet = await page.locator('#create-menu').boundingBox();
        check('on a phone menus open as a sheet from the bottom', Math.abs(sheet.y + sheet.height - 844) < 2 && sheet.width >= 388, JSON.stringify(sheet));
        await page.mouse.click(195, 40);
        await page.waitForTimeout(1200);
        const stageBox = await page.locator('#stage').boundingBox();
        const tlBox = await page.locator('.timeline-panel').boundingBox();
        check('on a phone the preview is only as tall as the picture, the rest is timeline', stageBox.height < 390 * 0.85 && tlBox.height > 844 * 0.35,
            Math.round(stageBox.height) + ' / ' + Math.round(tlBox.height));
        await page.click('#add-text');
        await page.keyboard.type('On a phone');
        const phoneTitle = (await project(page)).clips.find((c) => c.type === 'text' && c.text === 'On a phone');
        check('adding a title on a phone opens its details, ready to type', !!phoneTitle && await page.locator('#inspector textarea').isVisible());
        const writeBtn = page.getByRole('button', { name: '✍ Write by hand' });
        await writeBtn.scrollIntoViewIfNeeded();
        await writeBtn.click();
        check('and Write by hand is right there', (await project(page)).clips.find((c) => c.id === phoneTitle.id).anim === 'handwrite');
        await page.locator('#inspector textarea').first().fill('Done on a phone');
        const doneBox = await page.locator('#mobile-done-inspector').boundingBox();
        await page.click('#mobile-done-inspector');
        check('a big Done button at the foot of the details keeps the typed text and closes them',
            !!doneBox && doneBox.width > 300 && doneBox.y + doneBox.height <= (await page.locator('.timeline-panel').boundingBox()).y + 1 &&
            !(await page.locator('#inspector').isVisible()) && (await project(page)).clips.find((c) => c.id === phoneTitle.id).text === 'Done on a phone', JSON.stringify(doneBox));
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(200);

        /* ------------------------------------------- a host's plan and branding */
        const hosted = await context.newPage();
        await hosted.addInitScript(function () {
            window.REEL_CONFIG = {
                watermark: 'nooreditor.app', siteUrl: 'https://nooreditor.app', features: { readAloud: false },
                canRemoveWatermark: () => window.__pro === true, upgrade: (why) => { window.__upgrade = why; }
            };
        });
        await hosted.goto(base + '/video-editing/');
        await hosted.waitForFunction(() => document.documentElement.dataset.ready === 'true');
        await hosted.evaluate(() => document.querySelectorAll('.modal.generic').forEach((m) => m.remove()));
        await hosted.click('#export');
        const label = await hosted.locator('#export-watermark').evaluate((b) => b.parentNode.textContent.trim());
        await hosted.locator('#export-watermark').click();
        await hosted.waitForTimeout(200);
        check('a host can brand the watermark and keep it on free plans, showing its upgrade offer', label === 'Add the nooreditor.app watermark' &&
            await hosted.locator('#export-watermark').isChecked() && await hosted.evaluate(() => window.__upgrade) === 'watermark', label);
        await hosted.evaluate(() => { window.__pro = true; return window.ReelApp.refreshPlan(); });
        await hosted.locator('#export-watermark').setChecked(false);
        await hosted.waitForTimeout(200);
        check('and on its paid plan the watermark comes off', !(await hosted.locator('#export-watermark').isChecked()) && await hosted.evaluate(() => window.Reel.project.watermark === false));
        await hosted.click('#export-cancel');
        await hosted.click('#create');
        check('a host can switch Read aloud off', await hosted.locator('#create-menu .menu-item', { hasText: 'Read aloud' }).count() === 0 &&
            await hosted.locator('#create-menu .menu-item', { hasText: 'Occasion video' }).count() === 1);
        await hosted.close();

        /* ------------------------------------------------------------ offline */
        const sw = await context.newPage();
        await sw.goto(base + '/video-editing/');
        const cached = await sw.evaluate(async function () {
            const ready = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
            if (!ready) return null;
            for (let i = 0; i < 40; i += 1) {
                const keys = await caches.keys();
                const c = keys.find((k) => k.startsWith('video-editor-'));
                if (c && (await (await caches.open(c)).keys()).length > 10) return c;
                await new Promise((r) => setTimeout(r, 250));
            }
            return null;
        });
        check('the service worker caches the editor', !!cached, cached);
        await context.setOffline(true);
        await sw.reload();
        await sw.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 15000 }).catch(() => null);
        check('and it opens with no network', await sw.evaluate(() => !!window.ReelApp && document.documentElement.dataset.ready === 'true').catch(() => false));
        await context.setOffline(false);
        await sw.close();

        check('no errors in the page', errors.length === 0, errors.join(' | '));
    } catch (err) {
        check('test ran to completion', false, err.stack);
    } finally {
        await browser.close();
        server.close();
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
    process.exit(failed.length ? 1 : 0);
}());
