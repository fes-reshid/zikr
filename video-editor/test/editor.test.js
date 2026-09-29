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
 * captions and subtitles, and working offline.
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
        return { audio_files: VERSES.map((v, i) => ({ verse_key: '1:' + (i + 1), url: 'Alafasy/mp3/00100' + (i + 1) + '.mp3' })), pagination: { next_page: null } };
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
    await page.click('#export-cancel');
    return { options: options, choice: choice, file: file, seconds: seconds };
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
        args: ['--autoplay-policy=no-user-gesture-required']
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
        const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#save-project')]);
        const savedJson = JSON.parse(fs.readFileSync(await saved.path(), 'utf8'));
        check('Save downloads a project file with markers', savedJson.format === 'reel-project' && savedJson.markers.length === 1);

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
            check('fast export ran', true, fast.choice.text + ', ' + bytes.length + ' bytes in ' + fast.seconds.toFixed(1) + 's for ' + expected.toFixed(1) + 's of video');
            fs.unlinkSync(fast.file);
        }
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
        await page.click('#quran-video');
        const dlg = page.locator('.modal.generic');
        await dlg.getByRole('combobox', { name: 'Recitation' }).locator('option[value="rec:7"]').waitFor({ state: 'attached' });
        await dlg.getByRole('spinbutton', { name: 'To ayah' }).fill('3');
        await dlg.getByRole('spinbutton', { name: 'To ayah' }).dispatchEvent('change');
        const recitationPick = await dlg.getByRole('combobox', { name: 'Recitation' }).inputValue();
        const translationPick = await dlg.getByRole('combobox', { name: 'Translation' }).evaluate((s) => s.options[s.selectedIndex].textContent);
        check('the verse dialog suggests the reciter and Saheeh by name', recitationPick === 'rec:7' && /Saheeh/.test(translationPick), recitationPick + ' / ' + translationPick);
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
