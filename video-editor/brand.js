/*
 * Reel: brand kit.
 *
 * Save your logo, colours, font and intro/outro words once, in this browser,
 * then use them on any video: your logo in a corner of every frame, titles
 * in your font and colours, and a branded intro and outro — in one undoable
 * step. Templates and the Short maker can use the kit too.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const KEY = 'reel.brand';
    const DEFAULTS = {
        name: '', logo: '', primary: '#0f5c4c', secondary: '#e6c77d', text: '#ffffff', font: 'sans',
        logoPos: 'tr', logoSize: 0.14, logoOpacity: 0.9, intro: '', outro: 'Thank you for watching'
    };
    const CORNERS = [['tr', 'Top right'], ['tl', 'Top left'], ['br', 'Bottom right'], ['bl', 'Bottom left']];

    function get() {
        try {
            const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
            return saved ? Object.assign({}, DEFAULTS, saved) : null;
        } catch (err) { return null; }
    }

    function save(kit) {
        try { localStorage.setItem(KEY, JSON.stringify(kit)); return true; } catch (err) {
            app.toast('The brand kit could not be saved — try a smaller logo.');
            return false;
        }
    }

    /** A logo image shrunk to at most 512 pixels and turned into a PNG data URL, to keep the kit small. */
    function logoToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = function () {
                const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
                const cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round(img.naturalWidth * k));
                cv.height = Math.max(1, Math.round(img.naturalHeight * k));
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                URL.revokeObjectURL(url);
                resolve(cv.toDataURL('image/png'));
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That logo could not be opened.')); };
            img.src = url;
        });
    }

    async function dataUrlFile(dataUrl, name) {
        const blob = await (await fetch(dataUrl)).blob();
        return new File([blob], name, { type: blob.type || 'image/png', lastModified: Date.now() });
    }

    /** The logo overlay a project carries, from the kit. */
    function logoOverlay(kit) {
        return kit.logo ? { src: kit.logo, pos: kit.logoPos, size: kit.logoSize, opacity: kit.logoOpacity } : null;
    }

    /** A title clip in the kit's font and colours. */
    function brandTitle(kit, track, start, duration, text, patch) {
        return Object.assign(T.textClip(track, start, text), {
            duration: duration, font: kit.font, color: kit.text, boxColor: kit.primary, shadow: true,
            fadeIn: 0.2, fadeOut: 0.3
        }, patch || {});
    }

    /**
     * Applies the kit to the current project: `opts` says which parts —
     * logo, titles, intro, outro. One undo step.
     */
    async function applyKit(kit, opts) {
        app.pause();
        const before = app.state.project;
        const W = before.width;
        const H = before.height;
        const needCard = opts.intro || opts.outro;
        let cardId = null;
        let logoId = null;
        if (needCard) {
            const ids = await app.importFiles([await app.makeCard(W, H, 'linear', kit.primary, darker(kit.primary))], { noCommit: true, fresh: true });
            cardId = ids[0] || null;
            if (kit.logo) {
                const logoIds = await app.importFiles([await dataUrlFile(kit.logo, (kit.name || 'Brand') + ' logo.png')], { noCommit: true, fresh: true });
                logoId = logoIds[0] || null;
            }
        }
        let p = T.clone(app.state.project);
        if (opts.logo && kit.logo) p.brandLogo = logoOverlay(kit);
        if (opts.titles) {
            p.clips.forEach(function (c) {
                if (c.type !== 'text') return;
                c.font = T.isArabic(c.text || '') && !(app.FONTS[kit.font] || {}).arabic ? c.font : kit.font;
                c.color = kit.text;
                c.boxColor = kit.primary;
            });
        }
        const scene = (where, seconds, text, sub) => {
            // A card, the logo and the words, on fresh tracks so nothing is covered.
            const vt = T.nextTrackId(p, 'video');
            p = T.addTrack(p, 'video', 'Brand ' + where);
            if (cardId) p = T.addClip(p, Object.assign(T.clipFromMedia(T.getMedia(p, cardId), vt, start), { duration: seconds, fit: 'cover', enter: 'fade' }));
            if (logoId) {
                const lt = T.nextTrackId(p, 'video');
                p = T.addTrack(p, 'video', 'Brand logo');
                p = T.addClip(p, Object.assign(T.clipFromMedia(T.getMedia(p, logoId), lt, start), {
                    duration: seconds, fit: 'contain', scale: 0.32, y: 0.34, enter: 'pop', enterDuration: 0.7, exit: 'fade'
                }));
            }
            const tt = app.addTitleTrack(p, 'Brand ' + where + ' text');
            p = tt.project;
            p = T.addClip(p, brandTitle(kit, tt.id, start, seconds, text, { y: logoId ? 0.62 : 0.46, fontSize: 64, anim: 'zoom-in', animDuration: 0.8, exit: 'fade' }));
            if (sub) {
                const st = app.addTitleTrack(p, 'Brand ' + where + ' subtitle');
                p = st.project;
                p = T.addClip(p, brandTitle(kit, st.id, start + 0.4, seconds - 0.4, sub, { y: logoId ? 0.74 : 0.6, fontSize: 30, bold: false, anim: 'fade', color: kit.secondary }));
            }
        };
        let start = 0;
        if (opts.intro) {
            p = T.insertTime(p, 0, 3);
            start = 0;
            scene('intro', 3, kit.intro || kit.name || 'Welcome', kit.intro && kit.name ? kit.name : '');
        }
        if (opts.outro) {
            start = T.projectDuration(p);
            scene('outro', 4, kit.outro || 'Thank you for watching', kit.name);
        }
        app.apply(p);
        app.zoomToFit();
        app.toast('Your brand kit is on this video. Undo takes it off again.');
    }

    function darker(hex) {
        const n = parseInt(hex.slice(1), 16);
        const f = (v) => Math.round(v * 0.55).toString(16).padStart(2, '0');
        return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
    }

    function openBrandKit() {
        app.pause();
        const kit = get() || Object.assign({}, DEFAULTS);
        const field = (label, input, hint) => app.dialogField(label, input, hint);
        const name = el('input', { type: 'text', value: kit.name, maxlength: 80, placeholder: 'Your channel or organisation' });
        const logoIn = el('input', { type: 'file', accept: 'image/*' });
        const logoPreview = el('img', { alt: 'Logo', style: { maxWidth: '120px', maxHeight: '70px', display: kit.logo ? 'block' : 'none', background: '#222', borderRadius: '6px', padding: '4px' } });
        if (kit.logo) logoPreview.src = kit.logo;
        let logo = kit.logo;
        const removeLogo = el('button', { type: 'button', className: 'ghost', text: 'Remove logo', onclick: function () { logo = ''; logoPreview.style.display = 'none'; } });
        logoIn.addEventListener('change', async function () {
            if (!logoIn.files[0]) return;
            try {
                logo = await logoToDataUrl(logoIn.files[0]);
                logoPreview.src = logo;
                logoPreview.style.display = 'block';
            } catch (err) { app.toast(err.message); }
        });
        const colour = (v, label) => el('input', { type: 'color', value: v, 'aria-label': label });
        const primary = colour(kit.primary, 'Main colour');
        const secondary = colour(kit.secondary, 'Accent colour');
        const text = colour(kit.text, 'Text colour');
        const font = el('select', { 'aria-label': 'Brand font' }, Object.keys(app.FONTS).map((k) => el('option', { value: k, text: app.FONTS[k].label })));
        font.value = app.FONTS[kit.font] ? kit.font : 'sans';
        const pos = el('select', { 'aria-label': 'Logo corner' }, CORNERS.map((o) => el('option', { value: o[0], text: o[1] })));
        pos.value = kit.logoPos;
        const size = el('input', { type: 'range', min: 5, max: 35, value: Math.round(kit.logoSize * 100), 'aria-label': 'Logo size' });
        const intro = el('input', { type: 'text', value: kit.intro, maxlength: 120, placeholder: 'e.g. Assalamu alaykum, welcome to…' });
        const outro = el('input', { type: 'text', value: kit.outro, maxlength: 120 });
        const check = (label, on) => { const b = el('input', { type: 'checkbox' }); b.checked = on; return [b, el('label', { className: 'check' }, [b, label])]; };
        const [useLogo, useLogoRow] = check('My logo in the corner of every frame', true);
        const [useTitles, useTitlesRow] = check('Titles in my font and colours', true);
        const [useIntro, useIntroRow] = check('Add my intro at the start (3 s)', false);
        const [useOutro, useOutroRow] = check('Add my outro at the end (4 s)', false);
        const read = () => Object.assign({}, kit, {
            name: name.value.trim(), logo: logo, primary: primary.value, secondary: secondary.value, text: text.value,
            font: font.value, logoPos: pos.value, logoSize: Number(size.value) / 100, intro: intro.value.trim(), outro: outro.value.trim()
        });
        app.openDialog({
            title: 'Brand kit',
            wide: true,
            intro: 'Save your look once and use it on every video. It is kept in this browser.',
            body: [
                el('div', { className: 'dialog-grid' }, [
                    el('div', {}, [field('Name', name), field('Logo', logoIn, 'A PNG with a transparent background looks best.'), el('div', { className: 'row-buttons' }, [logoPreview, removeLogo]),
                        field('Logo corner', pos), field('Logo size', size)]),
                    el('div', {}, [field('Main colour', primary), field('Accent colour', secondary), field('Text colour', text), field('Font', font),
                        field('Intro words', intro), field('Outro words', outro)])
                ]),
                el('h3', { text: 'Use it on this video' }),
                useLogoRow, useTitlesRow, useIntroRow, useOutroRow
            ],
            actions: [
                { label: 'Cancel' },
                { label: 'Save kit', run: function () { if (save(read())) app.toast('Brand kit saved.'); } },
                {
                    label: 'Save and apply', primary: true, run: async function (d) {
                        const next = read();
                        if (!save(next)) return false;
                        d.busy(true);
                        try {
                            await applyKit(next, { logo: useLogo.checked, titles: useTitles.checked, intro: useIntro.checked, outro: useOutro.checked });
                        } catch (err) { d.status(err.message); d.busy(false); return false; }
                        return true;
                    }
                }
            ]
        });
    }

    const bar = document.querySelector('.studio-bar');
    if (bar) bar.append(el('button', { type: 'button', id: 'studio-brand', text: 'Brand kit', onclick: openBrandKit }));
    app.addTool({ section: 'Create', label: 'Brand kit…', run: openBrandKit });

    window.ReelBrand = { get, save, applyKit, openBrandKit, logoOverlay, brandTitle };
}());
