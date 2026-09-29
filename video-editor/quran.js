/*
 * Reel: Qur'ān verse videos.
 *
 * Pick a surah, a range of ayat, a reciter and a translation; this fetches
 * the Uthmani text and translation from the Quran.com API (the same API the
 * site's reader uses), downloads each ayah's recitation, and lays it all out
 * on the timeline in one undoable step:
 *
 *   - each ayah's recitation as its own audio clip, back to back;
 *   - the Arabic on its own titles track, each ayah exactly as long as its
 *     recitation (long ayat are split into pages, timed by length);
 *   - the translation on a second titles track, timed the same way;
 *   - an optional surah title card and Bismillah;
 *   - a background: a generated gradient, or an image or video of your own.
 *
 * Because every ayah is a separate recitation file, the captions line up
 * with the recitation exactly — no guessing where one ayah ends.
 *
 * If the browser cannot download the recitation, it can time the verses
 * across a recitation file of your own (by the length of each ayah), or make
 * the captions alone.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;

    const API = 'https://api.quran.com/api/v4';
    const AUDIO_HOST = 'https://verses.quran.com/';
    const EVERYAYAH = 'https://everyayah.com/data/';
    const PAGE = 50;

    const AYAT = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77,
        227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96,
        29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19,
        26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];
    const NAMES = ['Al-Fatihah', 'Al-Baqarah', "Ali 'Imran", 'An-Nisa', "Al-Ma'idah", "Al-An'am", "Al-A'raf", 'Al-Anfal', 'At-Tawbah',
        'Yunus', 'Hud', 'Yusuf', "Ar-Ra'd", 'Ibrahim', 'Al-Hijr', 'An-Nahl', 'Al-Isra', 'Al-Kahf', 'Maryam', 'Taha', 'Al-Anbya',
        'Al-Hajj', "Al-Mu'minun", 'An-Nur', 'Al-Furqan', "Ash-Shu'ara", 'An-Naml', 'Al-Qasas', "Al-'Ankabut", 'Ar-Rum', 'Luqman',
        'As-Sajdah', 'Al-Ahzab', 'Saba', 'Fatir', 'Ya-Sin', 'As-Saffat', 'Sad', 'Az-Zumar', 'Ghafir', 'Fussilat', 'Ash-Shuraa',
        'Az-Zukhruf', 'Ad-Dukhan', 'Al-Jathiyah', 'Al-Ahqaf', 'Muhammad', 'Al-Fath', 'Al-Hujurat', 'Qaf', 'Adh-Dhariyat', 'At-Tur',
        'An-Najm', 'Al-Qamar', 'Ar-Rahman', "Al-Waqi'ah", 'Al-Hadid', 'Al-Mujadila', 'Al-Hashr', 'Al-Mumtahanah', 'As-Saf',
        "Al-Jumu'ah", 'Al-Munafiqun', 'At-Taghabun', 'At-Talaq', 'At-Tahrim', 'Al-Mulk', 'Al-Qalam', 'Al-Haqqah', "Al-Ma'arij",
        'Nuh', 'Al-Jinn', 'Al-Muzzammil', 'Al-Muddaththir', 'Al-Qiyamah', 'Al-Insan', 'Al-Mursalat', 'An-Naba', "An-Nazi'at",
        "'Abasa", 'At-Takwir', 'Al-Infitar', 'Al-Mutaffifin', 'Al-Inshiqaq', 'Al-Buruj', 'At-Tariq', "Al-A'la", 'Al-Ghashiyah',
        'Al-Fajr', 'Al-Balad', 'Ash-Shams', 'Al-Layl', 'Ad-Duhaa', 'Ash-Sharh', 'At-Tin', "Al-'Alaq", 'Al-Qadr', 'Al-Bayyinah',
        'Az-Zalzalah', "Al-'Adiyat", "Al-Qari'ah", 'At-Takathur', "Al-'Asr", 'Al-Humazah', 'Al-Fil', 'Quraysh', "Al-Ma'un",
        'Al-Kawthar', 'Al-Kafirun', 'An-Nasr', 'Al-Masad', 'Al-Ikhlas', 'Al-Falaq', 'An-Nas'];
    const BISMILLAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

    /** Reciters to list first, matched by name against Quran.com's own list. */
    const SUGGESTED = [
        { patterns: [/afasy/i], everyayah: 'Alafasy_128kbps' },
        { patterns: [/abdul ?basit|abdulbaset/i, /murattal/i], everyayah: 'Abdul_Basit_Murattal_192kbps' },
        { patterns: [/husary/i], everyayah: 'Husary_128kbps' },
        { patterns: [/minshawi/i, /murattal/i], everyayah: 'Minshawy_Murattal_128kbps' },
        { patterns: [/sudais/i], everyayah: 'Abdurrahmaan_As-Sudais_192kbps' },
        { patterns: [/shuraym|shuraim/i], everyayah: 'Saood_ash-Shuraym_128kbps' },
        { patterns: [/shatri|shaatree/i], everyayah: 'Abu_Bakr_Ash-Shaatree_128kbps' },
        { patterns: [/rifai/i], everyayah: 'Hani_Rifai_192kbps' }
    ];

    const LANGUAGES = [
        { code: 'english', label: 'English', patterns: [/saheeh|sahih/i] },
        { code: 'oromo', label: 'Afaan Oromoo' },
        { code: 'amharic', label: 'Amharic' },
        { code: 'somali', label: 'Somali' },
        { code: 'swahili', label: 'Swahili' },
        { code: 'french', label: 'French', patterns: [/hamidullah/i] },
        { code: 'urdu', label: 'Urdu' },
        { code: 'indonesian', label: 'Indonesian' }
    ];

    const BACKGROUNDS = {
        emerald: { label: 'Emerald', stops: ['#0f3d33', '#1f5c4a', '#0b2620'] },
        night: { label: 'Night sky', stops: ['#0b1026', '#1d2a55', '#05070f'] },
        sand: { label: 'Sand', stops: ['#8a6a3d', '#c9a86a', '#5a4526'] },
        dusk: { label: 'Dusk', stops: ['#3b1d4a', '#b0515f', '#1c0f26'] },
        black: { label: 'Plain black', stops: ['#000000', '#000000', '#000000'] }
    };

    /* ------------------------------------------------------------------ API */

    async function getJson(url) {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('Quran.com answered ' + r.status);
        return r.json();
    }

    async function allPages(makeUrl, key) {
        const out = [];
        let page = 1;
        for (let guard = 0; guard < 40 && page; guard += 1) {
            const data = await getJson(makeUrl(page));
            (data[key] || []).forEach((x) => out.push(x));
            page = data.pagination && data.pagination.next_page;
        }
        return out;
    }

    const cache = {};

    function chapters() {
        return cache.chapters || (cache.chapters = getJson(API + '/chapters?language=en')
            .then((d) => d.chapters || [])
            .catch(function (err) { delete cache.chapters; throw err; }));
    }

    function reciters() {
        return cache.reciters || (cache.reciters = getJson(API + '/resources/recitations?language=en').then(function (d) {
            const all = (d.recitations || []).map(function (r) {
                const name = r.reciter_name || (r.translated_name && r.translated_name.name) || 'Reciter ' + r.id;
                return { id: r.id, name: name, label: name + (r.style ? ' (' + r.style + ')' : ''), style: r.style || '' };
            });
            const suggested = [];
            SUGGESTED.forEach(function (s) {
                const hit = all.find((r) => suggested.indexOf(r) === -1 && s.patterns.every((re) => re.test(r.label)));
                if (hit) { hit.everyayah = s.everyayah; suggested.push(hit); }
            });
            const rest = all.filter((r) => suggested.indexOf(r) === -1).sort((a, b) => a.label.localeCompare(b.label));
            return { suggested: suggested, rest: rest };
        }).catch(function (err) { delete cache.reciters; throw err; }));
    }

    function translations() {
        return cache.translations || (cache.translations = getJson(API + '/resources/translations').then(function (d) {
            const byLang = {};
            (d.translations || []).forEach(function (t) {
                const lang = (t.language_name || '').toLowerCase();
                (byLang[lang] = byLang[lang] || []).push(t);
            });
            const out = [];
            LANGUAGES.forEach(function (l) {
                const list = byLang[l.code] || [];
                const hit = (l.patterns && list.find((t) => l.patterns.some((re) => re.test(t.name) || re.test(t.author_name || '')))) || list[0];
                if (hit) out.push({ id: hit.id, label: l.label + ' — ' + (hit.author_name || hit.name) });
            });
            return out;
        }).catch(function (err) { delete cache.translations; throw err; }));
    }

    /** Translations come as HTML with footnotes; keep the text only. */
    function plainText(html) {
        const withoutNotes = String(html || '').replace(/<sup[^>]*>.*?<\/sup>/gi, '');
        const doc = new DOMParser().parseFromString('<body>' + withoutNotes, 'text/html');
        return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }

    async function loadVerses(chapter, from, to, translationId) {
        const q = '?words=false&fields=text_uthmani&per_page=' + PAGE + (translationId ? '&translations=' + translationId : '');
        const verses = await allPages((page) => API + '/verses/by_chapter/' + chapter + q + '&page=' + page, 'verses');
        return verses
            .filter((v) => v.verse_number >= from && v.verse_number <= to)
            .map((v) => ({
                n: v.verse_number,
                key: v.verse_key,
                arabic: v.text_uthmani || '',
                translation: v.translations && v.translations[0] ? plainText(v.translations[0].text) : ''
            }));
    }

    async function loadAudioUrls(recitationId, chapter) {
        const files = await allPages((page) => API + '/recitations/' + recitationId + '/by_chapter/' + chapter + '?per_page=' + PAGE + '&page=' + page, 'audio_files');
        const byKey = {};
        files.forEach(function (f) {
            if (!f || !f.verse_key || !f.url) return;
            byKey[f.verse_key] = /^https?:\/\//.test(f.url) ? f.url : (/^\/\//.test(f.url) ? 'https:' + f.url : AUDIO_HOST + String(f.url).replace(/^\/+/, ''));
        });
        return byKey;
    }

    function pad3(n) { return String(n).padStart(3, '0'); }

    /** Downloads one ayah's recitation, trying Quran.com, then EveryAyah for the well-known reciters. */
    async function fetchAyah(url, backup) {
        const tries = [url, backup].filter(Boolean);
        let lastErr = null;
        for (const u of tries) {
            try {
                const r = await fetch(u, { mode: 'cors' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return await r.blob();
            } catch (err) { lastErr = err; }
        }
        throw lastErr || new Error('No recitation address');
    }

    /* ---------------------------------------------------------- layout */

    /** Splits text into pieces of at most about `max` characters, at word breaks, evenly. */
    function chunk(text, max) {
        const words = String(text).split(/\s+/).filter(Boolean);
        const len = text.length;
        if (len <= max || words.length < 2) return [text];
        const pieces = Math.ceil(len / max);
        const target = len / pieces;
        const out = [];
        let cur = '';
        words.forEach(function (w) {
            if (cur && (cur.length + w.length + 1 > target * 1.15) && out.length < pieces - 1) {
                out.push(cur);
                cur = w;
            } else {
                cur = cur ? cur + ' ' + w : w;
            }
        });
        if (cur) out.push(cur);
        return out;
    }

    /** Title sizes are stored against a 720-line frame; choose one that fits this frame. */
    function sizeFor(project, chars, base, min) {
        const px = Math.min(project.width, project.height) * base * Math.max(min, Math.min(1, Math.sqrt(60 / Math.max(1, chars))));
        return Math.round(px * 720 / project.height);
    }

    /** A gradient background image at the frame size, as a PNG file. */
    async function gradientFile(project, key) {
        const bg = BACKGROUNDS[key] || BACKGROUNDS.emerald;
        const c = document.createElement('canvas');
        c.width = project.width;
        c.height = project.height;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, c.width * 0.4, c.height);
        g.addColorStop(0, bg.stops[0]);
        g.addColorStop(0.55, bg.stops[1]);
        g.addColorStop(1, bg.stops[2]);
        x.fillStyle = g;
        x.fillRect(0, 0, c.width, c.height);
        if (key !== 'black') {
            // A soft light and a faint geometric star, so the zoom has something to move.
            const r = x.createRadialGradient(c.width * 0.5, c.height * 0.35, 0, c.width * 0.5, c.height * 0.35, Math.max(c.width, c.height) * 0.6);
            r.addColorStop(0, 'rgba(255,255,255,0.16)');
            r.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = r;
            x.fillRect(0, 0, c.width, c.height);
            x.strokeStyle = 'rgba(255,255,255,0.06)';
            x.lineWidth = Math.max(2, c.width / 400);
            const cx = c.width / 2;
            const cy = c.height / 2;
            const R = Math.min(c.width, c.height) * 0.42;
            for (let k = 0; k < 2; k += 1) {
                x.beginPath();
                for (let i = 0; i <= 4; i += 1) {
                    const a = Math.PI / 4 * k + Math.PI / 2 * i;
                    const px = cx + R * Math.cos(a);
                    const py = cy + R * Math.sin(a);
                    if (i) x.lineTo(px, py); else x.moveTo(px, py);
                }
                x.stroke();
            }
        }
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
        return new File([blob], 'Background – ' + bg.label + ' ' + project.width + 'x' + project.height + '.png', { type: 'image/png', lastModified: Date.now() });
    }

    /** Puts a new video track at the bottom of the video tracks (under everything). */
    function bottomVideoTrack(project) {
        const id = T.nextTrackId(project, 'video');
        const p = T.addTrack(project, 'video', 'Background');
        const tracks = p.tracks.slice();
        const i = tracks.findIndex((t) => t.id === id);
        const track = tracks.splice(i, 1)[0];
        const firstAudio = tracks.findIndex((t) => t.kind === 'audio');
        tracks.splice(firstAudio === -1 ? tracks.length : firstAudio, 0, track);
        return { project: Object.assign({}, p, { tracks: tracks }), id: id };
    }

    function freeTrack(project, kind, start, end, name) {
        const tracks = project.tracks.filter((t) => t.kind === kind);
        const free = tracks.find((t) => T.isFree(project, t.id, start, end - start, null));
        if (free) return { project: project, id: free.id };
        const id = T.nextTrackId(project, kind);
        return { project: T.addTrack(project, kind, name), id: id };
    }

    function textClipAt(track, start, duration, text, style) {
        const c = T.textClip(track, start, text);
        return Object.assign(c, {
            duration: duration,
            fadeIn: Math.min(0.25, duration / 4),
            fadeOut: Math.min(0.25, duration / 4),
            shadow: true,
            bold: false,
            anim: style.anim || 'none',
            animDuration: 0.5
        }, style.clip);
    }

    /**
     * Lays pieces of text across [start, start + duration), each as long as
     * its share of the characters.
     */
    function addPieces(p, track, start, duration, pieces, style) {
        const total = pieces.reduce((n, s) => n + s.length, 0) || 1;
        let t = start;
        pieces.forEach(function (piece, i) {
            const d = i === pieces.length - 1 ? start + duration - t : duration * piece.length / total;
            p.clips.push(textClipAt(track, t, Math.max(0.2, d), piece, style(piece)));
            t += d;
        });
    }

    /* ---------------------------------------------------------- dialog */

    function option(value, text) { return el('option', { value: String(value), text: text }); }

    function openVerseDialog() {
        const surah = el('select', null, NAMES.map((n, i) => option(i + 1, (i + 1) + '. ' + n + ' (' + AYAT[i] + ')')));
        const from = el('input', { type: 'number', min: 1, value: 1 });
        const to = el('input', { type: 'number', min: 1, value: 7 });
        const reciter = el('select', null, [option('', 'Loading reciters…')]);
        const translation = el('select', null, [option('', 'Arabic only'), option('loading', 'Loading translations…')]);
        const frame = el('select', null, [
            option('keep', 'Keep this project’s frame'), option('1080x1920', 'Vertical 9:16 (Reels, Shorts, TikTok)'),
            option('1920x1080', 'Landscape 16:9 (YouTube)'), option('1080x1080', 'Square 1:1')
        ]);
        const background = el('select');
        const font = el('select', null, Object.keys(app.FONTS).filter((k) => app.FONTS[k].arabic).map((k) => option(k, app.FONTS[k].label)));
        const anim = el('select', null, [option('fade', 'Fade in'), option('words', 'Word by word'), option('rise', 'Rise up'), option('none', 'None')]);
        const numbers = el('input', { type: 'checkbox', checked: true });
        const title = el('input', { type: 'checkbox', checked: true });
        const bism = el('input', { type: 'checkbox', checked: true });
        const where = el('select', null, [option('end', 'After what is already there'), option('playhead', 'At the playhead')]);

        surah.value = '1';
        font.value = 'amiri';
        if (app.state.project.width === 1280 && app.state.project.height === 720 && !app.state.project.clips.length) frame.value = '1080x1920';

        function syncRange() {
            const max = AYAT[Number(surah.value) - 1];
            from.max = to.max = String(max);
            from.value = String(Math.min(Math.max(1, Number(from.value) || 1), max));
            to.value = String(Math.min(Math.max(Number(from.value), Number(to.value) || max), max));
            const s = Number(surah.value);
            bism.disabled = s === 1 || s === 9;
        }
        surah.addEventListener('change', function () { to.value = String(Math.min(AYAT[Number(surah.value) - 1], 10)); from.value = '1'; syncRange(); });
        from.addEventListener('change', syncRange);
        to.addEventListener('change', syncRange);
        syncRange();

        function fillBackgrounds() {
            background.textContent = '';
            Object.keys(BACKGROUNDS).forEach((k) => background.append(option('grad:' + k, 'Gradient — ' + BACKGROUNDS[k].label)));
            const visuals = app.state.project.media.filter((m) => (m.type === 'image' || m.type === 'video') && app.files.has(m.id));
            if (visuals.length) background.append(el('optgroup', { label: 'From your media' }, visuals.map((m) => option('media:' + m.id, m.name))));
            background.append(option('none', 'None — keep what is on the timeline'));
        }
        fillBackgrounds();

        function fillOwnRecitations(groupFor) {
            const audios = app.state.project.media.filter((m) => (m.type === 'audio' || m.type === 'video') && app.files.has(m.id));
            if (audios.length) reciter.append(el('optgroup', { label: 'Your own recitation (timed by ayah length)' }, audios.map((m) => option('own:' + m.id, m.name))));
            reciter.append(el('optgroup', { label: groupFor }, [option('none', 'No recitation — captions only')]));
        }

        reciters().then(function (list) {
            reciter.textContent = '';
            if (list.suggested.length) reciter.append(el('optgroup', { label: 'Suggested' }, list.suggested.map((r) => option('rec:' + r.id, r.label))));
            reciter.append(el('optgroup', { label: 'All reciters' }, list.rest.map((r) => option('rec:' + r.id, r.label))));
            fillOwnRecitations('Other');
        }).catch(function () {
            reciter.textContent = '';
            reciter.append(option('', 'Could not reach Quran.com'));
            fillOwnRecitations('Other');
        });
        translations().then(function (list) {
            translation.textContent = '';
            translation.append(option('', 'Arabic only'));
            list.forEach((t) => translation.append(option(t.id, t.label)));
            const eng = list.find((t) => /^English/.test(t.label));
            if (eng) translation.value = String(eng.id);
        }).catch(function () {
            translation.textContent = '';
            translation.append(option('', 'Arabic only (translations unavailable)'));
        });
        chapters().then(function (list) {
            // Keep the offline names; add the English meaning where Quran.com gives one.
            list.forEach(function (c) {
                const o = surah.querySelector('option[value="' + c.id + '"]');
                if (o && c.translated_name) o.textContent = c.id + '. ' + NAMES[c.id - 1] + ' — ' + c.translated_name.name + ' (' + c.verses_count + ')';
            });
        }).catch(function () {});

        const field = app.dialogField;
        const check = (input, text) => el('label', { className: 'check' }, [input, text]);
        app.openDialog({
            title: 'Qur’ān verse video',
            wide: true,
            intro: 'Recitation, Arabic and translation for a range of ayat, laid out on the timeline and timed to the recitation ayah by ayah. Text and audio come from Quran.com.',
            body: [
                el('div', { className: 'dialog-grid' }, [
                    field('Surah', surah),
                    el('div', { className: 'field-pair' }, [field('From ayah', from), field('To ayah', to)]),
                    field('Recitation', reciter),
                    field('Translation', translation),
                    field('Frame', frame),
                    field('Background', background),
                    field('Arabic font', font),
                    field('Captions appear', anim),
                    field('Place it', where)
                ]),
                el('div', { className: 'row-buttons' }, [check(numbers, 'Ayah numbers ﴿١﴾'), check(title, 'Surah title card'), check(bism, 'Bismillah card')])
            ],
            actions: [
                { label: 'Cancel', always: true },
                {
                    label: 'Make video', primary: true,
                    run: async function (d) {
                        d.busy(true);
                        try {
                            await build({
                                chapter: Number(surah.value), from: Number(from.value), to: Number(to.value),
                                reciter: reciter.value, translationId: translation.value && translation.value !== 'loading' ? Number(translation.value) : null,
                                frame: frame.value, background: background.value, font: font.value, anim: anim.value,
                                numbers: numbers.checked, title: title.checked, bismillah: bism.checked && !bism.disabled,
                                where: where.value
                            }, d.status);
                        } catch (err) {
                            console.error(err);
                            d.busy(false);
                            d.status(err.userMessage || ('Could not make it: ' + err.message));
                            return false;
                        }
                    }
                }
            ]
        });
    }

    /* ---------------------------------------------------------- build */

    async function build(o, status) {
        status('Fetching the text…');
        let verses;
        try {
            verses = await loadVerses(o.chapter, o.from, o.to, o.translationId);
        } catch (err) {
            const e = new Error(err.message);
            e.userMessage = 'Could not reach Quran.com for the text — check the internet connection and try again.';
            throw e;
        }
        if (!verses.length) throw new Error('No ayat found in that range.');
        let chapterInfo = null;
        try { chapterInfo = (await chapters()).find((c) => c.id === o.chapter) || null; } catch (err) { /* titles use the offline name */ }

        // Recitation: one file per ayah.
        let recitation = null;
        if (o.reciter.startsWith('rec:')) {
            const id = Number(o.reciter.slice(4));
            status('Finding the recitation…');
            const urls = await loadAudioUrls(id, o.chapter);
            let backupFolder = null;
            try {
                const list = await reciters();
                const r = list.suggested.concat(list.rest).find((x) => x.id === id);
                backupFolder = r && r.everyayah;
                recitation = { name: r ? r.name : 'Reciter' };
            } catch (err) { recitation = { name: 'Reciter' }; }
            const blobs = new Array(verses.length);
            let done = 0;
            let failed = null;
            const queue = verses.map((v, i) => i);
            async function worker() {
                while (queue.length && !failed) {
                    const i = queue.shift();
                    const v = verses[i];
                    const backup = backupFolder ? EVERYAYAH + backupFolder + '/' + pad3(o.chapter) + pad3(v.n) + '.mp3' : null;
                    try {
                        blobs[i] = await fetchAyah(urls[v.key], backup);
                    } catch (err) { failed = err; return; }
                    done += 1;
                    status('Downloading the recitation… ' + done + ' of ' + verses.length);
                }
            }
            await Promise.all([worker(), worker(), worker()]);
            if (failed) {
                const e = new Error(failed.message);
                e.userMessage = 'The browser could not download the recitation (' + failed.message + '). You can choose “No recitation — captions only”, or import a recitation file and pick it under “Your own recitation”.';
                throw e;
            }
            const safe = (recitation.name || 'Reciter').replace(/[^\w\- ]+/g, '').trim();
            recitation.files = blobs.map((b, i) => new File([b], safe + ' ' + pad3(o.chapter) + '-' + pad3(verses[i].n) + '.mp3', { type: b.type || 'audio/mpeg', lastModified: Date.now() }));
        }

        let p = T.clone(app.state.project);
        if (o.frame !== 'keep') {
            const wh = o.frame.split('x').map(Number);
            p.width = wh[0];
            p.height = wh[1];
        }

        // Import the recitation files (and a generated background) without a separate undo step.
        status('Adding the recitation…');
        app.state.project = p;
        let ayahMedia = null;
        if (recitation && recitation.files) {
            ayahMedia = await app.importFiles(recitation.files, { fresh: true, origin: 'quran', noCommit: true });
            if (ayahMedia.length !== verses.length) throw new Error('Some recitation files could not be opened.');
        }
        let bgMedia = null;
        if (o.background.startsWith('grad:')) {
            const ids = await app.importFiles([await gradientFile(app.state.project, o.background.slice(5))], { fresh: true, origin: 'quran', noCommit: true });
            bgMedia = ids[0] || null;
        } else if (o.background.startsWith('media:')) {
            bgMedia = o.background.slice(6);
        }
        p = T.clone(app.state.project);

        // How long each ayah lasts.
        let own = null;
        let durations;
        if (ayahMedia) {
            durations = ayahMedia.map((id) => T.getMedia(p, id).duration);
        } else if (o.reciter.startsWith('own:')) {
            own = T.getMedia(p, o.reciter.slice(4));
            const weights = verses.map((v) => v.arabic.length + 8);
            const sum = weights.reduce((a, b) => a + b, 0);
            durations = weights.map((w) => own.duration * w / sum);
        } else {
            durations = verses.map((v) => Math.max(4, v.arabic.length * 0.09));
        }

        const W = p.width;
        const H = p.height;
        const vertical = H > W;
        const hasTranslation = verses.some((v) => v.translation);
        const titleLen = o.title ? 3.5 : 0;
        const bismLen = o.bismillah && o.from === 1 ? 4 : 0;
        const body = durations.reduce((a, b) => a + b, 0);
        const start = o.where === 'playhead' ? app.state.time : T.projectDuration(p);
        const versesAt = start + titleLen + bismLen;
        const end = versesAt + body;

        let r = freeTrack(p, 'text', start, end, 'Qur’ān — Arabic');
        p = r.project;
        const arTrack = r.id;
        let trTrack = null;
        // A second titles track holds the translation, and the title card's subtitle.
        if (hasTranslation || titleLen) {
            r = freeTrack(p, 'text', start, end, hasTranslation ? 'Translation' : 'Titles');
            if (r.id === arTrack) {
                const id = T.nextTrackId(r.project, 'text');
                r = { project: T.addTrack(r.project, 'text', 'Translation'), id: id };
            }
            p = r.project;
            trTrack = r.id;
        }
        let auTrack = null;
        if (ayahMedia || own) {
            r = freeTrack(p, 'audio', versesAt, end, 'Recitation');
            p = r.project;
            auTrack = r.id;
        }

        const arabicY = hasTranslation ? (vertical ? 0.4 : 0.38) : 0.5;
        const translationY = vertical ? 0.68 : 0.74;
        const arabicStyle = function (piece) {
            return {
                anim: o.anim,
                clip: { font: o.font, fontSize: sizeFor(p, piece.length, vertical ? 0.1 : 0.08, 0.45), y: arabicY, color: '#ffffff' }
            };
        };
        const translationStyle = function (piece) {
            return {
                anim: o.anim === 'words' ? 'fade' : o.anim,
                clip: {
                    font: 'sans', fontSize: sizeFor(p, piece.length / 2, vertical ? 0.05 : 0.04, 0.62), y: translationY,
                    color: '#f3ead3', bold: false
                }
            };
        };
        const name = NAMES[o.chapter - 1];

        if (titleLen) {
            const arName = chapterInfo && chapterInfo.name_arabic ? 'سورة ' + chapterInfo.name_arabic : 'سورة';
            p.clips.push(textClipAt(arTrack, start, titleLen, arName, {
                anim: 'rise', clip: { font: o.font, fontSize: sizeFor(p, 8, 0.13, 0.5), y: 0.44, color: '#f2d27a' }
            }));
            const en = 'Sūrah ' + name + (chapterInfo && chapterInfo.translated_name ? ' · ' + chapterInfo.translated_name.name : '') +
                '\nĀyāt ' + o.from + (o.to !== o.from ? '–' + o.to : '');
            p.clips.push(textClipAt(trTrack, start, titleLen, en, {
                anim: 'fade', clip: { font: 'cormorant', fontSize: sizeFor(p, 20, 0.045, 0.6), y: 0.6, color: '#ffffff', bold: true }
            }));
        }
        if (bismLen) {
            p.clips.push(textClipAt(arTrack, start + titleLen, bismLen, BISMILLAH, {
                anim: 'fade', clip: { font: o.font, fontSize: sizeFor(p, 30, 0.085, 0.5), y: 0.5, color: '#ffffff' }
            }));
        }

        let t = versesAt;
        verses.forEach(function (v, i) {
            const d = durations[i];
            if (ayahMedia) {
                const media = T.getMedia(p, ayahMedia[i]);
                const clip = T.clipFromMedia(media, auTrack, t);
                clip.duration = d;
                p.clips.push(clip);
            }
            const arabic = v.arabic + (o.numbers ? ' ﴿' + T.arabicDigits(v.n) + '﴾' : '');
            addPieces(p, arTrack, t, d, chunk(arabic, vertical ? 120 : 170), arabicStyle);
            if (hasTranslation && v.translation) {
                const tr = v.translation + (o.numbers ? ' (' + v.n + ')' : '');
                addPieces(p, trTrack, t, d, chunk(tr, vertical ? 160 : 220), translationStyle);
            }
            t += d;
        });
        if (own) {
            const clip = T.clipFromMedia(own, auTrack, versesAt);
            clip.duration = Math.min(own.duration, body);
            p.clips.push(clip);
        }

        if (bgMedia) {
            const media = T.getMedia(p, bgMedia);
            let track = T.lowestTrack(p, 'video');
            if (!track || !T.isFree(p, track.id, start, end - start, null)) {
                const b = bottomVideoTrack(p);
                p = b.project;
                track = T.getTrack(p, b.id);
            }
            if (media.type === 'image') {
                const clip = T.clipFromMedia(media, track.id, start);
                clip.duration = end - start;
                clip.fit = 'cover';
                clip.motion = { type: 'zoom-in', amount: 0.08 };
                p.clips.push(clip);
            } else {
                // A video background repeats to cover the whole recitation, silently.
                let at = start;
                let first = true;
                while (at < end - 0.05) {
                    const clip = T.clipFromMedia(media, track.id, at);
                    clip.duration = Math.min(media.duration, end - at);
                    clip.fit = 'cover';
                    clip.muted = true;
                    if (!first) clip.transition = { type: 'crossfade', duration: 1 };
                    p.clips.push(clip);
                    at += clip.duration;
                    first = false;
                }
            }
        }

        if (p.name === 'Untitled project') {
            p.name = 'Surah ' + name + ' ' + o.from + (o.to !== o.from ? '-' + o.to : '');
        }
        app.state.project = p;
        app.commit();
        app.zoomToFit();
        app.seek(start);
        app.toast('Made ' + verses.length + ' ayah' + (verses.length === 1 ? '' : 's') + ' — press Space to play. Everything can be edited like any other clip.', 5000);
    }

    app.addTool({ section: 'Create', label: 'Qur’ān verse video…', run: openVerseDialog });
    const button = document.getElementById('quran-video');
    if (button) button.addEventListener('click', openVerseDialog);

    window.ReelQuran = { open: openVerseDialog, chunk: chunk, plainText: plainText };
}());
