/*
 * End-to-end test of the video editor in headless Chromium.
 *
 * The media is made on the spot: a two-second WebM recorded in the page with
 * MediaRecorder (so it has the Infinity duration real recordings have), a PNG
 * and a WAV tone. Everything then goes through the real UI — import, place,
 * split, undo, trim, drag, titles, playback, reload and relink — and ends with
 * a real export whose file is checked.
 *
 *   npm run test:video-editor
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP video editor test: playwright-core is not installed (npm install).');
    process.exit(0);
}
const ReelWebm = require('../webm.js');

const URL_ = process.env.EDITOR_URL ||
    'file://' + path.resolve(__dirname, '..', 'index.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ||
    (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

function toneWav(seconds, sampleRate, freq) {
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
        buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sampleRate) * 12000), 44 + i * 2);
    }
    return buf;
}

/** Records a 2 s 320×180 WebM in the page: solid red, then solid green. */
async function makeVideo(page) {
    const b64 = await page.evaluate(async function () {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        const x = c.getContext('2d');
        const stream = c.captureStream(30);
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
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

const project = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.Reel.project)));
const onTrack = (p, track) => p.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
const approx = (a, b, tol) => Math.abs(a - b) <= (tol || 0.05);

async function pixel(page, t, fx, fy) {
    await page.evaluate((time) => window.Reel.seek(time), t);
    await page.waitForTimeout(400);
    return page.evaluate(function (args) {
        window.Reel.drawFrame();
        const c = document.getElementById('preview');
        const d = c.getContext('2d').getImageData(Math.floor(c.width * args[0]), Math.floor(c.height * args[1]), 1, 1).data;
        return [d[0], d[1], d[2]];
    }, [fx, fy]);
}

(async function main() {
    const browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        args: ['--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    try {
        await page.goto(URL_);
        check('page loads with an empty project', (await project(page)).clips.length === 0);

        const video = await makeVideo(page);
        const png = await makePng(page);
        const wav = toneWav(3, 22050, 440);
        const FILES = [
            { name: 'clip.webm', mimeType: 'video/webm', buffer: video },
            { name: 'logo.png', mimeType: 'image/png', buffer: png },
            { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav }
        ];

        await page.setInputFiles('#import-input', FILES);
        await page.waitForFunction(() => document.querySelectorAll('.media-item').length === 3, null, { timeout: 20000 });
        let p = await project(page);
        const vid = p.media.find((m) => m.name === 'clip.webm');
        const img = p.media.find((m) => m.name === 'logo.png');
        const aud = p.media.find((m) => m.name === 'tone.wav');
        check('video is probed, with its real length despite MediaRecorder\'s Infinity', vid && vid.type === 'video' && approx(vid.duration, 2.1, 0.3), vid && vid.duration);
        check('video size is read', vid && vid.width === 320 && vid.height === 180);
        check('image is probed', img && img.type === 'image' && img.width === 200);
        check('audio is probed', aud && aud.type === 'audio' && approx(aud.duration, 3), aud && aud.duration);

        // Double-click puts the video on V1; the + button puts the tone on A1.
        await page.dblclick('.media-item[data-id="' + vid.id + '"]');
        await page.hover('.media-item[data-id="' + aud.id + '"]');
        await page.click('.media-item[data-id="' + aud.id + '"] .add');
        p = await project(page);
        check('double-click adds video to the main video track', onTrack(p, 'V1').length === 1);
        check('audio goes to the audio track', onTrack(p, 'A1').length === 1);

        // Drag the image from the bin onto the overlay track.
        await page.dragAndDrop('.media-item[data-id="' + img.id + '"]', '.tl-row[data-track="V2"] .tl-lane', { targetPosition: { x: 5, y: 20 } });
        p = await project(page);
        const overlay = onTrack(p, 'V2')[0];
        check('media dragged from the bin lands on the track it was dropped on', overlay && overlay.mediaId === img.id, overlay && overlay.start);

        // The image fills the frame over the video; hide V2 to see the video.
        let px = await pixel(page, 0.5, 0.5, 0.5);
        check('overlay track draws on top (blue image)', px[2] > 200 && px[0] < 60, px.join(','));
        await page.click('.tl-row[data-track="V2"] .tl-head button[aria-label^="Hide"]');
        px = await pixel(page, 0.5, 0.5, 0.5);
        check('the video shows under a hidden overlay (red first second)', px[0] > 200 && px[1] < 60, px.join(','));
        px = await pixel(page, 1.6, 0.5, 0.5);
        check('seeking shows the right frame (green second second)', px[1] > 200 && px[0] < 60, px.join(','));
        await page.keyboard.press('Control+z');
        check('undo brings the hidden track back', !(await project(page)).tracks.find((t) => t.id === 'V2').hidden);

        // Select the video clip and split it at 1 s.
        const vclip = onTrack(await project(page), 'V1')[0];
        await page.click('.clip[data-id="' + vclip.id + '"]', { position: { x: 10, y: 30 } });
        await page.evaluate(() => window.Reel.seek(1));
        await page.keyboard.press('s');
        p = await project(page);
        let v1 = onTrack(p, 'V1');
        check('S splits the selected clip at the playhead', v1.length === 2 && approx(v1[1].start, 1, 0.001) && approx(v1[1].in, 1, 0.001),
            v1.map((c) => c.start + '+' + c.duration).join(' '));
        check('only the selected clip is split', onTrack(p, 'A1').length === 1 && onTrack(p, 'V2').length === 1);

        await page.keyboard.press('Control+z');
        check('undo rejoins it', onTrack(await project(page), 'V1').length === 1);
        await page.keyboard.press('Control+Shift+z');
        v1 = onTrack(await project(page), 'V1');
        check('redo splits it again', v1.length === 2);

        // Trim the right half from its right edge.
        const right = v1[1];
        const box = await page.locator('.clip[data-id="' + right.id + '"] .handle.r').boundingBox();
        await page.mouse.move(box.x + 4, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 20, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        const trimmed = (await project(page)).clips.find((c) => c.id === right.id);
        check('dragging a clip edge trims it', trimmed.duration < right.duration - 0.1 && trimmed.start === right.start,
            right.duration.toFixed(2) + ' -> ' + trimmed.duration.toFixed(2));

        // Move the image along its track.
        const obox = await page.locator('.clip[data-id="' + overlay.id + '"]').boundingBox();
        await page.mouse.move(obox.x + 30, obox.y + obox.height / 2);
        await page.mouse.down();
        await page.mouse.move(obox.x + 30 + 80, obox.y + obox.height / 2, { steps: 5 });
        await page.mouse.up();
        const moved = (await project(page)).clips.find((c) => c.id === overlay.id);
        check('dragging a clip moves it', moved.start > overlay.start + 0.2 && moved.track === 'V2', overlay.start.toFixed(2) + ' -> ' + moved.start.toFixed(2));

        // Change a setting in the inspector: one undo step.
        await page.getByRole('slider', { name: 'Scale', exact: true }).fill('50');
        const scaled = (await project(page)).clips.find((c) => c.id === overlay.id);
        check('inspector edits apply to the selected clip', approx(scaled.scale, 0.5, 0.001), scaled.scale);

        // Add a title and type into it.
        await page.evaluate(() => window.Reel.seek(0));
        await page.click('#add-text');
        await page.keyboard.type('Hello Reel');
        await page.keyboard.press('Tab');
        p = await project(page);
        const title = onTrack(p, 'T1')[0];
        check('a title is added at the playhead and takes typed text', title && title.text === 'Hello Reel' && title.start === 0, title && title.text);
        await page.evaluate(() => window.Reel.seek(1));
        await page.waitForTimeout(300);
        const white = await page.evaluate(function () {
            window.Reel.drawFrame();
            const c = document.getElementById('preview');
            const d = c.getContext('2d').getImageData(0, c.height * 0.45, c.width, c.height * 0.1).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) n += 1;
            return n;
        });
        check('title text is drawn in the frame', white > 2000, white + ' white pixels');

        // Delete a clip with the keyboard.
        await page.click('.clip[data-id="' + title.id + '"]', { position: { x: 12, y: 30 } });
        await page.keyboard.press('Delete');
        check('Delete removes the selected clip', !(await project(page)).clips.some((c) => c.id === title.id));

        // Playback moves the clock.
        await page.evaluate(() => window.Reel.seek(0));
        await page.click('#play');
        await page.waitForTimeout(900);
        const playing = await page.evaluate(() => ({ t: window.Reel.time, playing: window.Reel.playing }));
        await page.click('#play');
        check('play runs the clock', playing.playing && playing.t > 0.3, playing.t.toFixed(2));
        check('pause stops it', !(await page.evaluate(() => window.Reel.playing)));

        // Save the project file.
        const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#save-project')]);
        const savedJson = JSON.parse(fs.readFileSync(await saved.path(), 'utf8'));
        check('Save downloads a project file', savedJson.format === 'reel-project' && savedJson.clips.length === (await project(page)).clips.length);

        // Reload: the project comes back, the files are offline until re-imported.
        const before = await project(page);
        await page.waitForTimeout(400); // autosave is debounced
        await page.reload();
        p = await project(page);
        check('the project is restored after a reload', p.clips.length === before.clips.length);
        check('restored media is shown offline', await page.locator('.media-item.missing').count() === 3);
        check('the offline banner says so', await page.locator('#restore-banner').isVisible());
        await page.setInputFiles('#import-input', FILES);
        await page.waitForFunction(() => !document.querySelector('.media-item.missing'), null, { timeout: 20000 });
        p = await project(page);
        check('re-importing relinks instead of duplicating', p.media.length === 3);
        check('undo history is not polluted by relinking', await page.locator('#undo').isDisabled());
        px = await pixel(page, 0.5, 0.5, 0.5);
        check('relinked media draws again', px[2] > 200 || px[0] > 200, px.join(','));

        // Export for real.
        const expected = p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        await page.click('#export');
        const formats = await page.locator('#export-format option').allTextContents();
        check('export offers at least one format', formats.length > 0, formats.join(' | '));
        const t0 = Date.now();
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.click('#export-start')
        ]);
        const file = path.join(os.tmpdir(), 'reel-export-' + process.pid + path.extname(download.suggestedFilename()));
        await download.saveAs(file);
        const bytes = fs.readFileSync(file);
        const isWebm = bytes.readUInt32BE(0) === 0x1A45DFA3;
        const isMp4 = bytes.toString('latin1', 4, 8) === 'ftyp';
        check('export produces a video file', bytes.length > 5000 && (isWebm || isMp4),
            download.suggestedFilename() + ', ' + bytes.length + ' bytes in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
        if (isWebm) {
            const ms = ReelWebm.getDuration(new Uint8Array(bytes));
            check('the exported WebM carries its duration', ms !== null && approx(ms / 1000, expected, 0.05), ms);
        }
        const probed = await page.evaluate(async function (b64) {
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
            const v = document.createElement('video');
            v.muted = true;
            v.src = URL.createObjectURL(new Blob([arr]));
            await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('decode')); });
            return { w: v.videoWidth, h: v.videoHeight, d: v.duration };
        }, bytes.toString('base64'));
        check('the exported file plays back at the project size', probed.w === 1280 && probed.h === 720, probed.w + 'x' + probed.h);
        check('and reports a finite length close to the timeline', isFinite(probed.d) && approx(probed.d, expected, 0.6),
            probed.d + ' vs ' + expected.toFixed(2));
        check('the dialog offers the download link too', await page.locator('#export-download').isVisible());
        fs.unlinkSync(file);

        check('no errors in the page', errors.length === 0, errors.join(' | '));
    } catch (err) {
        check('test ran to completion', false, err.stack);
    } finally {
        await browser.close();
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
    process.exit(failed.length ? 1 : 0);
}());
