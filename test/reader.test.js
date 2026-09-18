/*
 * End-to-end test of the reader page in headless Chromium.
 *
 * Quran.com is stubbed — including the recitation list, so the by-name reciter
 * matching is exercised — and each verse's audio is served as a short silent
 * WAV, so playback genuinely runs and `ended` really fires. That is what makes
 * the auto-advance and the auto-tick testable rather than assumed.
 *
 *   npm run test:reader
 */
const path = require('path');

let chromium;
try {
    chromium = require('playwright-core').chromium;
} catch (err) {
    console.log('SKIP reader test: playwright-core is not installed (npm install).');
    process.exit(0);
}

const READER_URL = process.env.READER_URL ||
    'file://' + path.resolve(__dirname, '..', 'dist', 'quran-tracker', 'reader', 'index.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + detail : ''));
}

// 2026-09-18 is Rabiʿ II 7, 1448 AH, so Juz 7 is the one due.
const TODAY = '2026-09-18';
const CYCLE_START = '2026-09-12';
const TODAYS_JUZ = 7;
const VERSE_COUNT = 5;

/** A valid, short, silent WAV — enough for `ended` to fire quickly. */
function silentWav(seconds, sampleRate) {
    const samples = Math.floor(seconds * sampleRate);
    const dataSize = samples * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);            // PCM
    buf.writeUInt16LE(1, 22);            // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataSize, 40);
    return buf;
}
const WAV = silentWav(0.2, 8000);

// Decoys included on purpose: the page must pick by name, not by position.
const RECITATIONS = [
    { id: 1, reciter_name: 'AbdulBaset AbdulSamad', style: 'Mujawwad', translated_name: { name: 'AbdulBaset AbdulSamad' } },
    { id: 3, reciter_name: 'Abdur-Rahman as-Sudais', style: null, translated_name: { name: 'Abdur-Rahman as-Sudais' } },
    { id: 7, reciter_name: 'Mishari Rashid al-`Afasy', style: null, translated_name: { name: 'Mishari Rashid al-`Afasy' } },
    { id: 9, reciter_name: 'Mohamed Siddiq al-Minshawi', style: 'Murattal', translated_name: { name: 'Mohamed Siddiq al-Minshawi' } },
    { id: 112, reciter_name: 'AbdurRashid Sufi', style: null, translated_name: { name: 'AbdurRashid Sufi' } }
];

const TRANSLATIONS = [
    { id: 131, name: 'Dr. Mustafa Khattab', author_name: 'Dr. Mustafa Khattab' },
    { id: 20, name: 'Saheeh International', author_name: 'Saheeh International' },
    { id: 85, name: 'Abdul Haleem', author_name: 'Abdul Haleem' }
];

function stubVerses(juz) {
    const verses = [];
    for (let i = 1; i <= VERSE_COUNT; i++) {
        verses.push({
            verse_key: juz + ':' + i,
            text_uthmani: 'نَصٌّ عَرَبِيٌّ ' + i,
            translations: [{ text: 'Translation of verse ' + i + '<sup foot_note="3">1</sup>' }]
        });
    }
    return { verses, pagination: { current_page: 1, next_page: null, total_pages: 1 } };
}

function stubAudio(juz) {
    const audio_files = [];
    for (let i = 1; i <= VERSE_COUNT; i++) {
        // Relative, exactly as the API returns them — the page must absolutise.
        audio_files.push({ verse_key: juz + ':' + i, url: 'Alafasy/mp3/00' + juz + '00' + i + '.mp3' });
    }
    return { audio_files, pagination: { current_page: 1, next_page: null, total_pages: 1 } };
}

/**
 * Fresh context per scenario. `opts.recitations` / `opts.audioStatus` let a
 * scenario break one endpoint without affecting the others.
 */
async function openReader(browser, opts) {
    const options = opts || {};
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
    const calls = { audio: [], api: [] };

    await context.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));

    await context.route('https://verses.quran.com/**', (r) => {
        calls.audio.push(r.request().url());
        r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV });
    });

    await context.route('https://api.quran.com/**', (r) => {
        const url = r.request().url();
        calls.api.push(url);
        const json = (body) => r.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(body)
        });

        if (url.includes('/resources/recitations')) {
            return json({ recitations: options.recitations || RECITATIONS });
        }
        if (url.includes('/resources/translations')) {
            return json({ translations: options.translations || TRANSLATIONS });
        }
        const juzMatch = url.match(/by_juz\/(\d+)/);
        const juz = juzMatch ? Number(juzMatch[1]) : 1;
        if (url.includes('/recitations/')) {
            if (options.audioStatus && options.audioStatus !== 200) {
                return r.fulfill({ status: options.audioStatus, body: 'error' });
            }
            return json(stubAudio(juz));
        }
        return json(stubVerses(juz));
    });

    if (options.profile !== null) {
        const profile = JSON.stringify(options.profile ||
            { name: 'Ahmad', startDate: CYCLE_START });
        await context.addInitScript((p) => {
            try {
                localStorage.setItem('quran_user_profile', p);
                localStorage.removeItem('quran_reading_log');
                localStorage.removeItem('quran_audio_place');
            } catch (e) { /* ignore */ }
        }, profile);
    }

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.clock.install({ time: new Date(TODAY + 'T10:00:00-07:00') });
    await page.goto(READER_URL + (options.query || ''));
    await page.waitForSelector('.verse', { timeout: 10000 });
    return { context, page, calls, errors };
}

function readLog(page) {
    return page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('quran_reading_log') || '{}'); }
        catch (e) { return {}; }
    });
}

(async () => {
    const browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        // Let the page's own autoplay attempt succeed, so "plays on its own"
        // is what is actually under test.
        args: ['--autoplay-policy=no-user-gesture-required']
    });

    // --- Reciters, translation, verses ------------------------------------
    {
        const { context, page, calls, errors } = await openReader(browser, { query: '?juz=7' });

        const groups = await page.$$eval('#reciter-selector optgroup', (els) =>
            els.map((g) => ({
                label: g.label,
                options: [...g.querySelectorAll('option')]
                    .map((o) => ({ value: o.value, label: o.textContent.trim() }))
            })));
        const all = groups.flatMap((g) => g.options);

        check('every reciter Quran.com offers is selectable', all.length === RECITATIONS.length,
            all.length + ' of ' + RECITATIONS.length);
        check('the two named reciters are grouped first',
            groups[0] && groups[0].label === 'Suggested' && groups[0].options.length === 2,
            groups[0] && groups[0].label + ': ' + groups[0].options.length);
        check('Mishari Rashid is matched by name, not by a guessed id',
            groups[0].options.some((o) => /Afasy/i.test(o.label) && o.value === '7'),
            JSON.stringify(groups[0].options[0]));
        check('Abdurrashid Ali Sufi is in the list, matched by name',
            groups[0].options.some((o) => /Sufi/i.test(o.label) && o.value === '112'),
            JSON.stringify(groups[0].options[1]));
        check('the rest are offered under their own heading',
            groups[1] && groups[1].label === 'All reciters' && groups[1].options.length === 3,
            groups[1] && groups[1].label + ': ' + groups[1].options.length);
        check('a suggested reciter is not repeated in the full list',
            !groups[1].options.some((o) => o.value === '7' || o.value === '112'));
        check('the full list is alphabetical',
            groups[1].options.map((o) => o.label).join(' | '),
            groups[1].options.map((o) => o.label).join(' | '));
        check('no notice when both named reciters were found',
            await page.$eval('#notice', (el) => el.classList.contains('is-hidden')));

        check('Saheeh International is picked over the other translations',
            calls.api.some((u) => u.includes('translations=20')),
            calls.api.filter((u) => u.includes('by_juz')).slice(-1)[0]);
        check('the translation is named on the page',
            (await page.textContent('#page-sub')).includes('Saheeh International'));

        const cards = await page.$$('.verse');
        check('every verse renders', cards.length === VERSE_COUNT, cards.length);
        check('Arabic renders',
            (await page.textContent('.verse .verse-ar')).includes('نَصٌّ عَرَبِيٌّ'));
        const translation = await page.textContent('.verse .verse-tr');
        check('the translation renders with footnote markers stripped',
            translation.trim() === 'Translation of verse 1', JSON.stringify(translation.trim()));
        check('?juz= is honoured', (await page.inputValue('#juz-selector')) === '7');
        check('the title names the juz', (await page.textContent('#page-title')) === 'Juz 7');
        check('no uncaught page errors while loading', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- Audio URLs and playback -----------------------------------------
    {
        const { context, page, calls, errors } = await openReader(browser, { query: '?juz=7' });

        await page.waitForFunction(() => {
            const a = document.getElementById('audio');
            return a && a.currentSrc;
        }, { timeout: 8000 });

        check('relative audio paths are resolved against verses.quran.com',
            calls.audio[0] && calls.audio[0].startsWith('https://verses.quran.com/Alafasy/mp3/'),
            calls.audio[0]);
        check('playback starts on its own',
            await page.evaluate(() => !document.getElementById('audio').paused));
        check('the playing verse is highlighted',
            (await page.$$('.verse.playing')).length === 1);
        check('the player names the current verse',
            /Verse 7:\d+\s+·\s+\d+ of 5/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        // Let the whole juz play through.
        await page.waitForFunction(
            () => document.getElementById('notice') &&
                  !document.getElementById('notice').classList.contains('is-hidden') &&
                  /marked as read/i.test(document.getElementById('notice').textContent),
            { timeout: 25000 }
        ).catch(() => {});

        check('it advanced through every verse without being touched',
            calls.audio.length === VERSE_COUNT, calls.audio.length + ' of ' + VERSE_COUNT);

        const log = await readLog(page);
        check("finishing the juz ticks today off", log[TODAY] === true, JSON.stringify(log));
        check('and says so', /marked as read/i.test(await page.textContent('#notice')),
            (await page.textContent('#notice')).trim());
        check('no uncaught page errors during playback', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- A juz that is not today's must not tick anything off -------------
    {
        const { context, page } = await openReader(browser, { query: '?juz=12' });
        await page.waitForFunction(
            () => /finished/i.test(document.getElementById('notice').textContent || ''),
            { timeout: 25000 }
        ).catch(() => {});
        const log = await readLog(page);
        check('finishing a different juz does not tick today off',
            log[TODAY] === undefined, JSON.stringify(log));
        const text = await page.textContent('#notice');
        check('and explains why', text.includes('Today') && text.includes(String(TODAYS_JUZ)),
            text.trim());
        await context.close();
    }

    // --- Manual controls --------------------------------------------------
    {
        const { context, page, calls } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        check('autoplay=0 leaves it paused',
            await page.evaluate(() => document.getElementById('audio').paused));
        check('previous is disabled on the first verse',
            await page.isDisabled('#prev-btn'));

        await page.click('#next-btn');
        await page.waitForTimeout(250);
        check('next moves to the second verse',
            /Verse 7:2/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        // Tapping a verse plays from there.
        const cards = await page.$$('.verse');
        await cards[3].click();
        await page.waitForTimeout(250);
        check('tapping a verse plays from that verse',
            /Verse 7:4/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));
        check('and highlights it', await page.$eval('.verse.playing',
            (el) => el.dataset.verseKey) === '7:4');

        // Toggling reciter must refetch the audio from the other reciter.
        calls.api.length = 0;
        await page.selectOption('#reciter-selector', '112');
        await page.waitForFunction(
            () => document.querySelectorAll('.verse').length > 0, { timeout: 8000 });
        await page.waitForTimeout(400);
        check('switching reciter refetches that reciter\'s audio',
            calls.api.some((u) => u.includes('/recitations/112/by_juz/7')),
            calls.api.filter((u) => u.includes('/recitations/')).join(' | '));
        check('and the selector holds the new reciter',
            (await page.inputValue('#reciter-selector')) === '112');
        await context.close();
    }

    // --- Degrading -------------------------------------------------------
    {
        const { context, page } = await openReader(browser, {
            query: '?juz=7',
            recitations: RECITATIONS.filter((r) => !/sufi/i.test(r.reciter_name))
        });
        const count = await page.$$eval('#reciter-selector option', (els) => els.length);
        const suggested = await page.$$eval('#reciter-selector optgroup', (els) =>
            els.filter((g) => g.label === 'Suggested')
               .flatMap((g) => [...g.querySelectorAll('option')].map((o) => o.textContent.trim())));
        check('the others stay selectable when a named reciter is absent',
            count === RECITATIONS.length - 1, count);
        check('and only the one that was found is suggested',
            suggested.length === 1 && /Afasy/i.test(suggested[0]), JSON.stringify(suggested));
        check('and the page says which one Quran.com lacks',
            /Sufi/i.test(await page.textContent('#notice')),
            (await page.textContent('#notice')).trim());
        await context.close();
    }
    {
        const { context, page } = await openReader(browser, { query: '?juz=7', audioStatus: 500 });
        await page.waitForFunction(
            () => !document.getElementById('notice').classList.contains('is-hidden'),
            { timeout: 8000 }
        ).catch(() => {});
        check('audio failing still leaves the juz readable',
            (await page.$$('.verse')).length === VERSE_COUNT);
        check('and says the recitation could not load',
            /recitation/i.test(await page.textContent('#notice')),
            (await page.textContent('#notice')).trim());
        check('with playback controls disabled', await page.isDisabled('#play-btn'));
        await context.close();
    }

    // --- No tracker profile yet ------------------------------------------
    {
        const { context, page } = await openReader(browser, { query: '?juz=3', profile: null });
        check('it still opens without a tracker profile',
            (await page.$$('.verse')).length === VERSE_COUNT);
        await context.close();
    }

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('reader test harness error:', err);
    process.exit(2);
});
