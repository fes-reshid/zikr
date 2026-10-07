/*
 * Reel: one-click Short.
 *
 * Takes a part of the current video — a lecture, say — and makes a vertical
 * 9:16 Short of it in a new tab: the clips trimmed to that part and filled
 * or fitted to the tall frame, your titles and captions kept, a big title on
 * top, a progress bar, an optional "Follow for more" end card, and your brand
 * kit if you have one. The original video is left exactly as it was.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const W = 1080;
    const H = 1920;
    const MAX = 180;

    /** Builds the Short as a new project from `opts`: from, to, title, fit, brand, endCard, progress. */
    function buildShort(source, opts) {
        const from = Math.max(0, opts.from);
        const to = Math.min(T.projectDuration(source), opts.to);
        if (!(to - from >= 1)) throw new Error('Choose a part at least one second long.');
        if (to - from > MAX) throw new Error('A Short can be up to ' + MAX / 60 + ' minutes long. Choose a shorter part.');
        let p = T.excerpt(source, from, to);
        p = window.ReelEffects ? window.ReelEffects.resizeProject(p, W, H, opts.fit) : Object.assign(p, { width: W, height: H });
        p.name = 'Short · ' + (opts.title || source.name || 'Untitled');
        const kit = opts.brand && window.ReelBrand ? window.ReelBrand.get() : null;
        const length = T.projectDuration(p);
        const titleStyle = {
            font: kit ? kit.font : 'sans', color: kit ? kit.text : '#ffffff', box: true, boxColor: kit ? kit.primary : '#000000',
            bold: true, shadow: false, fontSize: 40, x: 0.5, y: 0.12, fadeIn: 0, fadeOut: 0.3, anim: 'drop', animDuration: 0.8
        };
        if (opts.title) {
            const id = T.nextTrackId(p, 'text');
            p = T.addTrack(p, 'text', 'Short title');
            p = T.addClip(p, Object.assign(T.textClip(id, 0, opts.title), titleStyle, { duration: length }));
        }
        if (opts.endCard) {
            const id = T.nextTrackId(p, 'text');
            p = T.addTrack(p, 'text', 'End card');
            p = T.addClip(p, Object.assign(T.textClip(id, length, kit && kit.outro ? kit.outro : 'Follow for more'), titleStyle,
                { duration: 2.5, y: 0.5, fontSize: 52, anim: 'pop', exit: 'fade' }));
        }
        if (kit && kit.logo) p.brandLogo = window.ReelBrand.logoOverlay(kit);
        if (opts.progress) p.progressBar = { color: kit ? kit.secondary : '#f2b84b' };
        return p;
    }

    function openShort() {
        app.pause();
        const src = app.state.project;
        const total = T.projectDuration(src);
        if (!total) { app.toast('Add your video to the timeline first.'); return; }
        // Start at the selected clip, or at the playhead.
        const sel = app.state.selected && T.getClip(src, app.state.selected);
        let a = sel ? sel.start : Math.min(app.state.time, Math.max(0, total - 1));
        let b = sel ? Math.min(T.clipEnd(sel), a + 60) : Math.min(total, a + 45);
        if (b - a < 1) { a = 0; b = Math.min(total, 45); }
        const fps = src.fps || 30;
        const fmt = (v) => T.formatTime(v, fps);
        const parse = (v) => T.parseTime(v, fps);
        const time = (v) => el('input', { type: 'text', value: fmt(v), inputmode: 'decimal' });
        const fromIn = time(a);
        const toIn = time(b);
        const title = el('input', { type: 'text', maxlength: 120, value: src.name && !/^untitled/i.test(src.name) ? src.name : '', placeholder: 'A big title on top' });
        const fit = el('select', null, [['crop', 'Fill the tall frame (crop the sides)'], ['blur', 'Fit, with a blurred background'], ['fit', 'Fit, with plain bars']]
            .map((o) => el('option', { value: o[0], text: o[1] })));
        const check = (label, on, hidden) => { const b = el('input', { type: 'checkbox' }); b.checked = on; return [b, el('label', { className: 'check', hidden: hidden }, [b, label])]; };
        const hasKit = !!(window.ReelBrand && window.ReelBrand.get());
        const [progress, progressRow] = check('A progress bar along the bottom', true);
        const [endCard, endRow] = check('A “Follow for more” end card (2.5 s)', true);
        const [brand, brandRow] = check('Use my brand kit (logo, font and colours)', hasKit, !hasKit);
        const [captions, captionsRow] = check('Then make captions from the speech (Whisper, on this device)', false, !window.ReelCaptions);
        const [follow, followRow] = check('Follow the speaker’s face (auto-reframe)', true, !window.ReelReframe);
        fit.addEventListener('change', function () { followRow.hidden = fit.value !== 'crop' || !window.ReelReframe; });
        const length = el('p', { className: 'hint' });
        const showLength = function () {
            const s = (parse(toIn.value) || 0) - (parse(fromIn.value) || 0);
            length.textContent = s > 0 ? 'Length: ' + fmt(s) + (s > 60 ? ' — Shorts and Reels work best under a minute.' : '') : 'The end must come after the start.';
        };
        fromIn.addEventListener('input', showLength);
        toIn.addEventListener('input', showLength);
        showLength();
        const useSelection = el('button', { type: 'button', className: 'ghost', text: 'Use the playhead as the start', onclick: function () { fromIn.value = fmt(app.state.time); toIn.value = fmt(Math.min(total, app.state.time + 45)); showLength(); } });
        app.openDialog({
            title: 'Make a Short',
            intro: 'Turn part of this video into a vertical 9:16 Short for YouTube Shorts, Reels, TikTok or WhatsApp Status. It opens in a new tab; this video stays as it is.',
            body: [
                el('div', { className: 'field-pair' }, [app.dialogField('From', fromIn), app.dialogField('To', toIn)]),
                el('div', { className: 'row-buttons' }, [useSelection]), length,
                app.dialogField('Title', title), app.dialogField('Picture', fit),
                followRow, progressRow, endRow, brandRow, captionsRow
            ],
            actions: [{ label: 'Cancel' }, {
                label: 'Make Short', primary: true, run: function (d) {
                    let short;
                    try {
                        short = buildShort(src, {
                            from: parse(fromIn.value), to: parse(toIn.value), title: title.value.trim(), fit: fit.value,
                            brand: brand.checked, endCard: endCard.checked, progress: progress.checked
                        });
                    } catch (err) { d.status(err.message); return false; }
                    if (!app.openProjectInTab(short)) return false;
                    app.zoomToFit();
                    app.toast('Your Short is ready in a new tab. Export it when you are happy.');
                    if (follow.checked && fit.value === 'crop' && window.ReelReframe) {
                        const wide = window.ReelReframe.candidates(app.state.project).map((c) => c.id);
                        if (wide.length) {
                            window.ReelReframe.reframeAll(wide, (t) => app.toast(t, 2000))
                                .then((r) => app.toast(r.moved ? 'The Short now follows the speaker’s face.' : 'No faces were found to follow.'))
                                .catch((err) => app.toast('Auto-reframe stopped: ' + err.message));
                        }
                    }
                    if (captions.checked && window.ReelCaptions) setTimeout(function () { window.ReelCaptions.open(); }, 300);
                    return true;
                }
            }]
        });
    }

    const bar = document.querySelector('.studio-bar');
    if (bar) bar.append(el('button', { type: 'button', id: 'studio-short', text: 'Make a Short', onclick: openShort }));
    app.addTool({ section: 'Create', label: 'Make a Short from this video…', run: openShort });

    window.ReelShort = { buildShort, openShort };
}());
