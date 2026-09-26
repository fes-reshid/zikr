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
const http = require('http');
const fs = require('fs');

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

// Decoys included on purpose here too: three English translations, so the
// by-name pick (Saheeh International) has to win over just taking the first
// English entry, plus one entry each for the other offered languages.
const TRANSLATIONS = [
    { id: 131, name: 'Dr. Mustafa Khattab', author_name: 'Dr. Mustafa Khattab', language_name: 'english' },
    { id: 20, name: 'Saheeh International', author_name: 'Saheeh International', language_name: 'english' },
    { id: 85, name: 'Abdul Haleem', author_name: 'Abdul Haleem', language_name: 'english' },
    { id: 140, name: 'Oromo Translation', author_name: 'Ghali Aba Hulgaaʾ', language_name: 'oromo' },
    { id: 141, name: 'Amharic Translation', author_name: 'Sadiq and Sani', language_name: 'amharic' },
    { id: 142, name: 'Somali Translation', author_name: 'Mahmud Muhammad Abduh', language_name: 'somali' }
];

// withTranslation mirrors the real API: it only sends a `translations`
// array back when the request actually asked for one. page_number/
// juz_number/hizb_number are sent unconditionally, same as the real API
// (loadVerses() always asks for them) — split across two synthetic pages
// (verses 1-3 on the first, 4-5 on the second) so Hifz-mode page grouping
// has something real to group.
function stubVerses(juz, withTranslation) {
    const verses = [];
    for (let i = 1; i <= VERSE_COUNT; i++) {
        const verse = {
            verse_key: juz + ':' + i, text_uthmani: 'نَصٌّ عَرَبِيٌّ ' + i,
            page_number: i <= 3 ? 100 : 101, juz_number: juz, hizb_number: 13
        };
        if (withTranslation) {
            verse.translations = [{ text: 'Translation of verse ' + i + '<sup foot_note="3">1</sup>' }];
        }
        verses.push(verse);
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
        return json(stubVerses(juz, url.includes('translations=')));
    });

    if (options.profile !== null) {
        const profile = JSON.stringify(options.profile ||
            { name: 'Ahmad', startDate: CYCLE_START });
        const place = options.place ? JSON.stringify(options.place) : null;
        await context.addInitScript((args) => {
            try {
                localStorage.setItem('quran_user_profile', args.profile);
                localStorage.removeItem('quran_reading_log');
                if (args.place) localStorage.setItem('quran_audio_place', args.place);
                else localStorage.removeItem('quran_audio_place');
            } catch (e) { /* ignore */ }
        }, { profile, place });
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

        check('Saheeh International is picked over the other English translations',
            calls.api.some((u) => u.includes('translations=20')),
            calls.api.filter((u) => u.includes('by_juz')).slice(-1)[0]);
        check('the translation is named on the page',
            (await page.textContent('#page-sub')).includes('Saheeh International'));

        const translationOptions = await page.$$eval('#translation-selector option',
            (els) => els.map((o) => ({ value: o.value, label: o.textContent.trim() })));
        check('English, Oromo, Amharic and Somali are all offered',
            ['English', 'Oromo', 'Amharic', 'Somali'].every((lang) =>
                translationOptions.some((o) => o.label === lang)),
            JSON.stringify(translationOptions));
        check('an Arabic-only option is offered too',
            translationOptions.some((o) => o.value === '0' && /arabic only/i.test(o.label)),
            JSON.stringify(translationOptions));
        check('a translated reading is the default, not Arabic-only',
            await page.inputValue('#translation-selector') === '20');

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

    // --- Resuming a saved place --------------------------------------------
    {
        const { context, page } = await openReader(browser, {
            query: '?juz=7&autoplay=0',
            place: { juz: 7, index: 3, verseKey: '7:4' }
        });
        check('playback resumes at the saved verse, not the first',
            /Verse 7:4/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));
        check('and it says so',
            /continuing from where you left off/i.test(await page.textContent('#notice')) &&
            (await page.textContent('#notice')).includes('7:4'),
            (await page.textContent('#notice')).trim());
        await context.close();
    }
    {
        // A saved place for a different juz must not affect this one.
        const { context, page } = await openReader(browser, {
            query: '?juz=7&autoplay=0',
            place: { juz: 12, index: 3, verseKey: '20:5' }
        });
        check('a saved place for another juz is ignored',
            /Verse 7:1\s/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));
        check('no resume notice for an unrelated juz',
            await page.$eval('#notice', (el) => el.classList.contains('is-hidden')));
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

    // --- Switching translation ---------------------------------------------
    // Unlike the reciter, the translation has no bearing on the recitation
    // audio, so switching it must re-fetch only the verse text and must not
    // touch — let alone restart — whatever is already loaded. Paused on
    // purpose: with playback running, natural advance-to-the-next-verse
    // during the test's own waits would add audio calls of its own and mask
    // the thing actually under test.
    {
        const { context, page, calls } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        await page.waitForFunction(() => {
            const a = document.getElementById('audio');
            return a && a.currentSrc;
        }, { timeout: 8000 });

        const audioCallsBefore = calls.audio.length;
        const srcBefore = await page.evaluate(() => document.getElementById('audio').currentSrc);
        calls.api.length = 0;
        await page.selectOption('#translation-selector', '142'); // Somali
        await page.waitForFunction(
            () => document.querySelectorAll('.verse').length > 0, { timeout: 8000 });
        await page.waitForTimeout(300);

        check('switching translation refetches verses with the new translation id',
            calls.api.some((u) => u.includes('by_juz/7') && u.includes('translations=142')),
            calls.api.join(' | '));
        check('it does not request any new audio',
            calls.audio.length === audioCallsBefore, calls.audio.length + ' vs ' + audioCallsBefore);
        check('and does not touch what is already loaded',
            await page.evaluate(() => document.getElementById('audio').currentSrc) === srcBefore);
        check('the current verse is still highlighted after the rebuild',
            (await page.$$('.verse.playing')).length === 1);
        check('the page names the chosen translator',
            (await page.textContent('#page-sub')).includes('Mahmud Muhammad Abduh'),
            await page.textContent('#page-sub'));

        await page.reload();
        await page.waitForSelector('.verse', { timeout: 10000 });
        await page.waitForTimeout(300);
        check('the chosen language is remembered across a reload',
            await page.inputValue('#translation-selector') === '142');
        await context.close();
    }

    // --- Arabic only --------------------------------------------------------
    {
        const { context, page, calls } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        await page.waitForFunction(() => document.querySelectorAll('.verse').length > 0);
        check('a translation renders by default',
            (await page.$('.verse .verse-tr')) !== null);

        calls.api.length = 0;
        await page.selectOption('#translation-selector', '0');
        await page.waitForFunction(
            () => document.querySelectorAll('.verse').length > 0, { timeout: 8000 });
        await page.waitForTimeout(300);

        check('choosing Arabic only refetches verses with no translation requested',
            calls.api.some((u) => u.includes('by_juz/7') && !u.includes('translations=')),
            calls.api.join(' | '));
        check('no translation paragraph is rendered',
            (await page.$('.verse .verse-tr')) === null);
        check('the Arabic text is still there',
            (await page.textContent('.verse .verse-ar')).includes('نَصٌّ عَرَبِيٌّ'));
        check('the translator name is dropped from the sub-heading',
            !/·.+·/.test((await page.textContent('#page-sub'))),
            await page.textContent('#page-sub'));

        await page.reload();
        await page.waitForSelector('.verse', { timeout: 10000 });
        await page.waitForTimeout(300);
        check('Arabic-only is remembered across a reload too',
            await page.inputValue('#translation-selector') === '0');
        check('and no translation still renders after the reload',
            (await page.$('.verse .verse-tr')) === null);
        await context.close();
    }

    // --- Hifz mode (Mushaf page layout) -------------------------------
    {
        const { context, page, errors } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        check('the toggle starts off', !(await page.isChecked('#hifz-toggle')));
        check('the normal card view is what shows by default',
            (await page.$$('.verse')).length === VERSE_COUNT);

        await page.click('#hifz-toggle');
        await page.waitForTimeout(200);

        check('turning Hifz mode on itself opens the repeat menu, for the current verse',
            (await page.isVisible('#repeat-overlay')) &&
            /Verse 7:1/.test(await page.textContent('#repeat-verse-label')),
            await page.textContent('#repeat-verse-label'));
        await page.click('#close-repeat-btn');

        const pages = await page.$$('.mushaf-page');
        check('verses split into their real Mushaf pages (two, per the stub)',
            pages.length === 2, pages.length);
        check('no more card view underneath', (await page.$$('.verse')).length === 0);

        const firstPageText = await pages[0].textContent();
        check("the first page names its juz and hizb",
            /Juz.?\s*7/.test(firstPageText) && /Hizb\s*13/.test(firstPageText), firstPageText);
        check('and names the surah it is on',
            /Al-A.raf/.test(firstPageText), firstPageText);
        check('with the Basmala, since this stub’s verse 1 opens a surah',
            firstPageText.includes('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'), firstPageText);
        check('and the real page number at the foot',
            (await pages[0].$eval('.mushaf-foot', (el) => el.textContent.trim())) === '100');

        const secondPageText = await pages[1].textContent();
        check('the second page, merely continuing the same surah, still names it',
            /Al-A.raf/.test(secondPageText), secondPageText);
        check('but does not repeat the Basmala — this is the bug that was fixed',
            !secondPageText.includes('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'), secondPageText);
        check('the second page is numbered separately',
            (await pages[1].$eval('.mushaf-foot', (el) => el.textContent.trim())) === '101');

        const marker = await page.$eval('[data-verse-key="7:1"] .ayah-marker', (el) => el.textContent);
        check('ayah markers use Arabic-Indic numerals', marker === '١', marker);

        await page.click('[data-verse-key="7:3"]');
        await page.waitForTimeout(150);
        check('tapping a verse in Hifz mode opens the repeat overlay, not a direct play',
            await page.isVisible('#repeat-overlay'));
        check('naming the tapped verse',
            /Verse 7:3/.test(await page.textContent('#repeat-verse-label')),
            await page.textContent('#repeat-verse-label'));

        await page.click('#start-repeat-btn');
        await page.evaluate(() => document.getElementById('audio').pause());
        await page.waitForTimeout(150);
        check('starting a repeat begins playing that verse',
            /Verse 7:3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));
        check('and highlights it',
            await page.$eval('[data-verse-key="7:3"]', (el) => el.classList.contains('playing')));
        check('with a way to stop it', await page.isVisible('#stop-repeat-btn'));

        await page.click('#hifz-toggle');
        await page.waitForTimeout(200);
        check('toggling off returns to the card view',
            (await page.$$('.verse')).length === VERSE_COUNT);
        check('carrying the highlight over',
            await page.$eval('[data-verse-key="7:3"]', (el) => el.classList.contains('playing')));
        check('turning it off does not pop the repeat menu — only turning it on does',
            await page.isHidden('#repeat-overlay'));
        check('and it stops the repeat that was running — repetition belongs to Hifz mode',
            await page.isHidden('#stop-repeat-btn'));
        check('now-playing drops back to plain playlist wording, no more "repeat"',
            !/repeat/i.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.click('#hifz-toggle');
        await page.waitForTimeout(200);
        check('turning it back on opens the menu again, for whatever verse is now current',
            (await page.isVisible('#repeat-overlay')) &&
            /Verse 7:3/.test(await page.textContent('#repeat-verse-label')),
            await page.textContent('#repeat-verse-label'));
        await page.click('#close-repeat-btn');

        await page.reload();
        await page.waitForTimeout(300);
        await page.waitForSelector('.mushaf-page', { timeout: 10000 });
        check('the choice is remembered across a reload',
            await page.isChecked('#hifz-toggle'));
        check('but restoring it on load does not pop the menu — only an actual click does',
            await page.isHidden('#repeat-overlay'));
        check('no uncaught page errors in Hifz mode', errors.length === 0, errors.join(' | '));
        await context.close();
    }

    // --- Hifz mode: the repeat overlay's actual repeat behaviour -----------
    // 7:1-7:3 share page 100, 7:4-7:5 are on page 101 (see stubVerses above).
    {
        const { context, page } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        await page.click('#hifz-toggle');
        await page.waitForTimeout(200);
        // Turning Hifz mode on itself pops the repeat menu now (tested
        // above); close it so the specific-verse taps below start fresh.
        await page.click('#close-repeat-btn');

        // A range repeat cycles the chosen span, in order, for the chosen
        // number of passes, then stops on its own.
        await page.click('[data-verse-key="7:1"]');
        await page.waitForTimeout(150);
        await page.click('input[name="repeat-scope"][value="range"]');
        check('choosing "a range of verses" reveals the from/to pickers',
            await page.isVisible('#repeat-range-field'));
        check('and the "repeat each verse" field, once there is more than one verse to it',
            await page.isVisible('#verse-repeat-field'));
        check('the outer field is relabeled for a range',
            (await page.textContent('#outer-repeat-label')) === 'Repeat the whole range');

        await page.selectOption('#repeat-range-start', '7:1');
        await page.selectOption('#repeat-range-end', '7:3');
        // Each verse once per pass — the combined "repeat each verse AND
        // repeat the whole span" case has its own dedicated test below.
        await page.click('.verse-repeat-btn[data-count="1"]');
        await page.click('.repeat-count-btn[data-count="3"]:not(.verse-repeat-btn)');
        await page.click('#start-repeat-btn');

        check('the range repeat starts on the range’s first verse, pass 1 of 3',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /pass 1 of 3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:2/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('it auto-advances through the range in order — second verse',
            /Verse 7:2/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:3/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('— and the third',
            /Verse 7:3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:1/.test(document.getElementById('now-playing').textContent) &&
                  /pass 2 of 3/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('after the range ends it wraps back to the start for pass 2 of 3',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /pass 2 of 3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => document.getElementById('stop-repeat-btn').classList.contains('is-hidden'),
            { timeout: 12000 }).catch(() => {});
        check('after the third full pass it stops on its own — no more stop button',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));
        check('leaving the last verse of the range highlighted',
            await page.$eval('[data-verse-key="7:3"]', (el) => el.classList.contains('playing')));

        // The combined case this field exists for: repeat each verse on the
        // page 3 times AND repeat the whole page 3 times, together.
        await page.click('[data-verse-key="7:1"]');
        await page.waitForTimeout(150);
        await page.click('input[name="repeat-scope"][value="page"]');
        check('the outer field is relabeled for a page',
            (await page.textContent('#outer-repeat-label')) === 'Repeat the whole page');
        check('"repeat each verse" defaults to 3×, so both are meant to be set together',
            await page.$eval('.verse-repeat-btn[data-count="3"]',
                (el) => el.classList.contains('active')));
        await page.click('.repeat-count-btn[data-count="3"]:not(.verse-repeat-btn)');
        await page.click('#start-repeat-btn');

        check('it starts on the page’s first verse — rep 1 of 3, pass 1 of 3',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /rep 1 of 3/.test(await page.textContent('#now-playing')) &&
            /pass 1 of 3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:1/.test(document.getElementById('now-playing').textContent) &&
                  /rep 3 of 3/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('the same verse repeats 3 times running before it moves on',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /rep 3 of 3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:2/.test(document.getElementById('now-playing').textContent) &&
                  /rep 1 of 3/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('only then does it move on, restarting the 3 reps on the next verse',
            /Verse 7:2/.test(await page.textContent('#now-playing')) &&
            /rep 1 of 3/.test(await page.textContent('#now-playing')) &&
            /pass 1 of 3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:1/.test(document.getElementById('now-playing').textContent) &&
                  /pass 2 of 3/.test(document.getElementById('now-playing').textContent),
            { timeout: 10000 }).catch(() => {});
        check('once every verse on the page has had its 3 reps, the whole page repeats — pass 2 of 3',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /rep 1 of 3/.test(await page.textContent('#now-playing')) &&
            /pass 2 of 3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => document.getElementById('stop-repeat-btn').classList.contains('is-hidden'),
            { timeout: 20000 }).catch(() => {});
        check('and after the third full pass — 3 verses × 3 reps × 3 passes — it stops on its own',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));
        check('leaving the last verse of the last pass highlighted',
            await page.$eval('[data-verse-key="7:3"]', (el) => el.classList.contains('playing')));

        // A page repeat with an unlimited count must keep going past one
        // full lap on its own, and only Stop actually ends it.
        await page.click('[data-verse-key="7:2"]');
        await page.waitForTimeout(150);
        await page.click('input[name="repeat-scope"][value="page"]');
        await page.click('.verse-repeat-btn[data-count="1"]');
        await page.click('.repeat-count-btn[data-count="0"]');
        await page.click('#start-repeat-btn');

        check('a page repeat starts from the page’s first verse, in reading order — not the tapped one',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /pass 1 of/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:3/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('the whole page is in the loop, not just the tapped verse — it reaches the last one',
            /Verse 7:3/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:1/.test(document.getElementById('now-playing').textContent) &&
                  /pass 2 of/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('after the last verse on the page it wraps back to the first for the next pass',
            /Verse 7:1/.test(await page.textContent('#now-playing')) &&
            /pass 2 of/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => /Verse 7:2/.test(document.getElementById('now-playing').textContent) &&
                  /pass 2 of/.test(document.getElementById('now-playing').textContent),
            { timeout: 8000 }).catch(() => {});
        check('an unlimited count keeps it going past a full lap on its own',
            /pass 2 of/.test(await page.textContent('#now-playing')) &&
            /∞/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.click('#stop-repeat-btn');
        check('Stop actually ends it',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));
        const stoppedAt = await page.textContent('#now-playing');
        await page.waitForTimeout(600);
        check('and it stays stopped — no further auto-advance after Stop',
            (await page.textContent('#now-playing')) === stoppedAt);

        // A typed custom count is honoured over whichever preset button
        // still looks active (openRepeatOverlay resets the preset to 10×,
        // but never touches a value the listener hasn't typed into yet).
        await page.click('[data-verse-key="7:5"]');
        await page.waitForTimeout(150);
        check('scope defaults back to "this verse only" for a fresh tap',
            await page.isChecked('input[name="repeat-scope"][value="verse"]'));
        await page.fill('#repeat-count-custom', '2');
        await page.click('#start-repeat-btn');

        check('a custom count is honoured over the still-active 10× preset',
            /repeat 1 of 2/.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        await page.waitForFunction(
            () => document.getElementById('stop-repeat-btn').classList.contains('is-hidden'),
            { timeout: 5000 }).catch(() => {});
        check('and it stops after exactly that many repeats of the single verse',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));

        // Manual Prev/Next always overrides whatever repeat is running.
        await page.click('[data-verse-key="7:1"]');
        await page.waitForTimeout(150);
        await page.click('.repeat-count-btn[data-count="0"]');
        await page.click('#start-repeat-btn');
        await page.waitForTimeout(300);
        check('a repeat is running', await page.isVisible('#stop-repeat-btn'));

        await page.click('#next-btn');
        check('Next stops an active repeat immediately',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));
        check('and moves on as a normal single play — no more "repeat" wording',
            !/repeat/i.test(await page.textContent('#now-playing')),
            await page.textContent('#now-playing'));

        // Tapping a different verse mid-repeat supersedes it too, via
        // openRepeatOverlay's own stopRepeat() call.
        await page.click('[data-verse-key="7:2"]');
        await page.waitForTimeout(150);
        await page.click('.repeat-count-btn[data-count="0"]');
        await page.click('#start-repeat-btn');
        await page.waitForTimeout(300);
        check('another repeat is now running', await page.isVisible('#stop-repeat-btn'));

        await page.click('[data-verse-key="7:4"]');
        await page.waitForTimeout(150);
        check('tapping a different verse mid-repeat stops the running one',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));
        check('and opens that verse’s own overlay instead',
            await page.isVisible('#repeat-overlay') &&
            /Verse 7:4/.test(await page.textContent('#repeat-verse-label')),
            await page.textContent('#repeat-verse-label'));
        await page.click('#close-repeat-btn');

        // Switching juz invalidates any running repeat (loadJuz's own
        // stopRepeat() — a new juz's playlist makes the old indices stale).
        await page.click('[data-verse-key="7:1"]');
        await page.waitForTimeout(150);
        await page.click('.repeat-count-btn[data-count="0"]');
        await page.click('#start-repeat-btn');
        await page.waitForTimeout(300);
        check('a repeat is running before the juz change', await page.isVisible('#stop-repeat-btn'));

        await page.selectOption('#juz-selector', '12');
        await page.waitForTimeout(600);
        check('changing the juz stops the repeat',
            await page.$eval('#stop-repeat-btn', (el) => el.classList.contains('is-hidden')));

        await context.close();
    }

    // --- Resuming after an interruption (a call, another app's audio) ------
    // A longer clip than the per-verse stub (0.2s) is swapped in first, so
    // this tests the pause/resume mechanism itself without racing the
    // stub's own short natural duration.
    {
        const { context, page, errors } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        const longWav = silentWav(3, 8000).toString('base64');

        await page.evaluate((base64) => {
            document.getElementById('audio').src = 'data:audio/wav;base64,' + base64;
        }, longWav);
        await page.evaluate(() => document.getElementById('audio').play());
        await page.waitForTimeout(150);
        check('playback is underway',
            await page.evaluate(() => !document.getElementById('audio').paused));
        check('and genuinely still mid-clip, not already finished',
            await page.evaluate(() => !document.getElementById('audio').ended));

        // Exactly what a phone call or another app taking the speaker looks
        // like from here: the audio pauses without this page's involvement.
        await page.evaluate(() => document.getElementById('audio').pause());
        await page.waitForTimeout(100);
        check('an unrequested pause does not resume on its own yet',
            await page.evaluate(() => document.getElementById('audio').paused));

        // The interruption ends and the tab is back in the foreground.
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(200);
        check('playback resumes on its own once the tab is foregrounded again',
            await page.evaluate(() => !document.getElementById('audio').paused));

        // A pause the listener actually asked for must never auto-resume.
        await page.click('#play-btn'); // their own pause, mid-playback
        await page.waitForTimeout(150);
        check('a manual pause is not treated as an interruption',
            await page.evaluate(() => document.getElementById('audio').paused));

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(200);
        check('so it does not resume just because the tab regained focus',
            await page.evaluate(() => document.getElementById('audio').paused));

        check('no uncaught page errors handling the interruption', errors.length === 0, errors.join(' | '));
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

    // --- Manual "Mark as read" button, no account signed in ---------------
    {
        const { context, page } = await openReader(browser, { query: '?juz=7&autoplay=0' });
        check('the strip starts unmarked',
            (await page.textContent('#mark-read-label')).trim() === 'Mark as read');
        await page.click('#mark-read-btn');
        await page.waitForTimeout(150);
        check('clicking marks today read locally', (await readLog(page))[TODAY] === true);
        check('the button flips to Completed',
            (await page.textContent('#mark-read-label')).trim() === 'Completed');
        check('the strip label says which juz was marked',
            (await page.textContent('#reading-status-label')).includes('7'),
            await page.textContent('#reading-status-label'));

        check('and the button locks — a completed day is a record, not a toggle',
            await page.evaluate(() => document.getElementById('mark-read-btn').disabled));
        await context.close();
    }

    // --- Signed in: the account is authoritative, and every write syncs ---
    // (Previously the reader never told a signed-in account about a
    // completion at all — neither the manual button nor auto-finish — so a
    // read marked here could be silently lost the next time the tracker
    // pulled the account's days. This exercises the fix end to end.)
    {
        const DIST = path.resolve(__dirname, '..', 'dist');
        const PORT = Number(process.env.READER_ACCOUNT_PORT || 8847);
        const BASE = 'http://localhost:' + PORT;
        const store = { settings: { startDate: CYCLE_START, timezone: 'America/Los_Angeles',
                                     remindHour: 20, pushReminders: false }, days: [] };
        const apiCalls = [];

        const server = http.createServer((req, res) => {
            const url = new URL(req.url, BASE);
            if (url.pathname.endsWith('/kids-quest-cloud.js')) {
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
                return res.end('/* stubbed by the test */');
            }
            if (url.pathname.startsWith('/quran-tracker/api/')) {
                const route = url.pathname.replace('/quran-tracker/api/', '');
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', () => {
                    let parsed = null;
                    try { parsed = JSON.parse(body); } catch (e) { /* none */ }
                    apiCalls.push({ method: req.method, route, body: parsed });
                    const reply = (code, payload) => {
                        res.writeHead(code, { 'content-type': 'application/json' });
                        res.end(JSON.stringify(payload));
                    };
                    if (route === 'me') return reply(200, { settings: store.settings, days: store.days });
                    if (route === 'readings') {
                        const set = new Set(store.days);
                        if (parsed.read === false) set.delete(parsed.day); else set.add(parsed.day);
                        store.days = [...set].sort().reverse();
                        return reply(200, { ok: true, days: store.days });
                    }
                    if (route === 'settings') {
                        Object.assign(store.settings, parsed || {});
                        return reply(200, { ok: true, settings: store.settings });
                    }
                    return reply(200, { ok: true, days: store.days });
                });
                return;
            }
            let file = path.join(DIST, decodeURIComponent(url.pathname));
            if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
            if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); return res.end('not found');
            }
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
            res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
            fs.createReadStream(file).pipe(res);
        });
        await new Promise((resolve) => server.listen(PORT, resolve));

        const FAKE_CLOUD = () => {
            var user = { uid: 'uid-amina123', username: 'amina123', displayName: 'amina123', fullName: '' };
            window.KidsCloud = {
                onStudentAuth: function (cb) { cb(user); },
                getIdToken: function () { return Promise.resolve('id-token-amina123'); }
            };
            window.dispatchEvent(new Event('kidscloud-ready'));
        };

        async function openSignedInReader(query) {
            const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
            await context.route('https://fonts.googleapis.com/**', (r) =>
                r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
            await context.route('https://fonts.gstatic.com/**', (r) =>
                r.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
            await context.route('https://verses.quran.com/**', (r) =>
                r.fulfill({ status: 200, contentType: 'audio/wav', body: WAV }));
            await context.route('https://api.quran.com/**', (r) => {
                const url = r.request().url();
                const json = (body) => r.fulfill({
                    status: 200, contentType: 'application/json', body: JSON.stringify(body)
                });
                if (url.includes('/resources/recitations')) return json({ recitations: RECITATIONS });
                if (url.includes('/resources/translations')) return json({ translations: TRANSLATIONS });
                const juzMatch = url.match(/by_juz\/(\d+)/);
                const juz = juzMatch ? Number(juzMatch[1]) : 1;
                if (url.includes('/recitations/')) return json(stubAudio(juz));
                return json(stubVerses(juz, url.includes('translations=')));
            });
            await context.addInitScript(FAKE_CLOUD);
            // No local profile: the account is the only source of today's juz.
            await context.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            await page.clock.install({ time: new Date(TODAY + 'T10:00:00-07:00') });
            await page.goto(BASE + '/quran-tracker/reader/' + query);
            await page.waitForSelector('.verse', { timeout: 10000 });
            await page.waitForFunction(
                () => /Juz \d/.test((document.getElementById('reading-status-label') || {}).textContent || ''),
                { timeout: 8000 }
            ).catch(() => {});
            return { context, page, errors };
        }

        {
            const { context, page, errors } = await openSignedInReader('?juz=7&autoplay=0');
            check('signed-in reader shows the account in the header',
                (await page.textContent('#account-btn')).trim() === 'amina123');
            check("today's due juz is drawn from the account, not a local profile",
                (await page.textContent('#reading-status-label')).includes('7'),
                await page.textContent('#reading-status-label'));

            apiCalls.length = 0;
            await page.click('#mark-read-btn');
            await page.waitForTimeout(300);
            check('manual mark-as-read updates the local log',
                (await readLog(page))[TODAY] === true);
            check('manual mark-as-read syncs to the account',
                apiCalls.some((c) => c.route === 'readings' && c.body &&
                    c.body.day === TODAY && c.body.read === true),
                JSON.stringify(apiCalls));

            check('and the button locks — a completed day is a record, not a toggle',
                await page.evaluate(() => document.getElementById('mark-read-btn').disabled));

            check('no uncaught page errors while signed in', errors.length === 0, errors.join(' | '));
            await context.close();
        }

        {
            apiCalls.length = 0;
            const { context, page, errors } = await openSignedInReader('?juz=7');
            await page.waitForFunction(
                () => /marked as read/i.test((document.getElementById('notice') || {}).textContent || ''),
                { timeout: 25000 }
            ).catch(() => {});
            check('finishing the juz while signed in still ticks the local log',
                (await readLog(page))[TODAY] === true);
            check('and now also syncs the auto-completion to the account (previously lost)',
                apiCalls.some((c) => c.route === 'readings' && c.body &&
                    c.body.day === TODAY && c.body.read === true),
                JSON.stringify(apiCalls));
            check('no uncaught page errors on auto-finish while signed in',
                errors.length === 0, errors.join(' | '));
            await context.close();
        }

        server.close();
    }

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error('reader test harness error:', err);
    process.exit(2);
});
