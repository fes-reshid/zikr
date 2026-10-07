/*
 * Reel: captions and subtitles.
 *
 * - Auto captions: the project's sound (or one clip's) is rendered offline,
 *   run through Whisper on this device (the same speech recogniser, worker
 *   and models as the site's audio editor), grouped into short lines and laid
 *   out as titles on a new "Captions" track — burned into the export like any
 *   other title, and editable.
 * - Import subtitles: an .srt or .vtt file becomes titles.
 * - Export subtitles: any titles track saved as .srt or .vtt.
 *
 * The recogniser model (40–250 MB) downloads once, then works offline.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const script = document.currentScript;
    const version = script ? new URL(script.src).searchParams.get('v') : '';

    const MODELS = [
        ['onnx-community/whisper-base_timestamped', 'Balanced — about 80 MB download'],
        ['onnx-community/whisper-tiny_timestamped', 'Fast — about 40 MB, less accurate'],
        ['onnx-community/whisper-small_timestamped', 'Most accurate — about 250 MB, slow']
    ];
    const LANGS = [['', 'Detect automatically'], ['english', 'English'], ['arabic', 'Arabic'], ['oromo', 'Afaan Oromoo'],
        ['amharic', 'Amharic (አማርኛ)'], ['somali', 'Somali'], ['swahili', 'Swahili'], ['french', 'French'], ['turkish', 'Turkish'],
        ['urdu', 'Urdu'], ['indonesian', 'Indonesian'], ['malay', 'Malay'], ['hausa', 'Hausa'], ['persian', 'Persian']];
    /** Languages the recogniser does not know: their captions are timed from a text you paste. */
    const FROM_TEXT = ['oromo'];
    /** Languages the smaller models often get wrong. */
    const NEED_SMALL = ['amharic', 'somali', 'hausa'];
    const SMALL = 'onnx-community/whisper-small_timestamped';

    let worker = null;
    let seq = 0;
    const pending = new Map();

    /**
     * Speech to text. Resolves to { text, chunks: [{ text, timestamp: [s, e] }] }.
     * Tests replace this with window.__reelTestTranscriber.
     */
    function transcribe(audio16k, model, language, onMessage) {
        if (window.__reelTestTranscriber) return window.__reelTestTranscriber(audio16k, model, language);
        if (!worker) {
            worker = new Worker(new URL('transcribe-worker.js' + (version ? '?v=' + version : ''), script ? script.src : location.href), { type: 'module' });
            worker.onmessage = function (e) { const p = pending.get(e.data.id); if (p) p(e.data); };
            worker.onerror = function (e) {
                pending.forEach((p) => p({ error: e.message || 'The speech recogniser stopped' }));
                pending.clear();
                worker = null;
            };
        }
        const id = ++seq;
        return new Promise(function (resolve, reject) {
            pending.set(id, function (d) {
                if (d.error) { pending.delete(id); reject(new Error(d.error)); }
                else if (d.out) { pending.delete(id); resolve(d.out); }
                else if (onMessage) onMessage(d);
            });
            worker.postMessage({ id: id, audio: audio16k, model: model, language: language, words: true }, [audio16k.buffer]);
        });
    }

    function progressText(d, files) {
        if (d.status === 'listening') return 'Listening… (about as long as the audio, often faster)';
        if (d.progress && d.progress.status === 'progress' && d.progress.total) {
            files.set(d.progress.file, [d.progress.loaded, d.progress.total]);
            let got = 0;
            let all = 0;
            files.forEach(function (v) { got += v[0]; all += v[1]; });
            return 'Downloading the speech model (first time only)… ' + Math.round(got / 1048576) + ' of ' + Math.round(all / 1048576) + ' MB';
        }
        if (d.progress && d.progress.status === 'initiate') return 'Downloading the speech model (first time only)…';
        if (d.progress && d.progress.status === 'ready') return 'Model ready';
        return null;
    }

    /** A new titles track for captions, named, and returned with its id. */
    function newTextTrack(project, name) {
        const id = T.nextTrackId(project, 'text');
        return { project: T.addTrack(project, 'text', name), id: id };
    }

    function captionClip(track, cue, style) {
        const c = T.textClip(track, cue.start, cue.text);
        return Object.assign(c, {
            duration: Math.max(0.3, cue.end - cue.start),
            font: T.isArabic(cue.text) ? 'naskh' : 'sans',
            fontSize: style.size,
            bold: true,
            box: style.box,
            boxColor: '#000000',
            shadow: !style.box,
            y: style.y,
            fadeIn: 0.08,
            fadeOut: 0.08,
            anim: 'none'
        });
    }

    /** Places cues as titles on a new track, dropping any that would overlap. */
    function placeCues(cues, name, style) {
        let r = newTextTrack(app.state.project, name);
        const p = T.clone(r.project);
        let lastEnd = -Infinity;
        cues.forEach(function (cue) {
            const start = Math.max(cue.start, lastEnd);
            if (cue.end - start < 0.2) return;
            p.clips.push(captionClip(r.id, { start: start, end: cue.end, text: cue.text }, style));
            lastEnd = cue.end;
        });
        app.apply(p);
        return r.id;
    }

    function styleFor(project) {
        const vertical = project.height > project.width;
        const px = Math.min(project.width, project.height) * (vertical ? 0.055 : 0.05);
        return { size: Math.round(px * 720 / project.height), y: vertical ? 0.78 : 0.86, box: true };
    }

    /* --------------------------------------------------------------- dialogs */

    function openAutoCaptions() {
        const p = app.state.project;
        if (!p.clips.some((c) => T.isTimed(p, c))) { app.toast('Add a clip with sound first.'); return; }
        const sel = app.state.selected ? T.getClip(p, app.state.selected) : null;
        const source = el('select', null, [el('option', { value: 'mix', text: 'Everything you hear (the whole mix)' })]
            .concat(sel && T.isTimed(p, sel) ? [el('option', { value: 'clip', text: 'Only the selected clip' })] : []));
        const model = el('select', null, MODELS.map((m) => el('option', { value: m[0], text: m[1] })));
        const lang = el('select', null, LANGS.map((l) => el('option', { value: l[0], text: l[1] })));
        const box = el('input', { type: 'checkbox', checked: true });
        const text = el('textarea', { rows: 6, placeholder: 'Paste or type what is said, in order. A new line starts a new caption.', 'aria-label': 'What is said' });
        const langHint = el('small', { className: 'hint caption-lang-hint' });
        const modelField = app.dialogField('Model', model);
        const textField = app.dialogField('What is said', text, 'The words are timed to the speech by its pauses. Check the result and drag captions to fine-tune.');
        try {
            const saved = JSON.parse(localStorage.getItem('ae-transcribe') || '{}');
            if (saved.model) model.value = saved.model;
            if (saved.lang != null) lang.value = saved.lang;
        } catch (err) { /* defaults */ }
        const langChanged = function (pick) {
            const fromText = FROM_TEXT.indexOf(lang.value) !== -1;
            modelField.hidden = fromText;
            textField.hidden = !fromText;
            if (pick && NEED_SMALL.indexOf(lang.value) !== -1) model.value = SMALL;
            langHint.textContent = fromText ? 'Whisper does not know Afaan Oromoo yet, so paste the words below: they are timed to the voice on this device.' :
                NEED_SMALL.indexOf(lang.value) !== -1 ? (model.value === SMALL ? 'Good: the most accurate model works best for ' + lang.selectedOptions[0].text + '. If some words still come out wrong, use Tools → “Timed captions from your text” and paste the correct words.' :
                    'The smaller models often get ' + lang.selectedOptions[0].text + ' wrong — “Most accurate” is better.') : '';
        };
        lang.addEventListener('change', function () { langChanged(true); });
        model.addEventListener('change', function () { langChanged(false); });
        langChanged(false);
        const langField = app.dialogField('Language', lang);
        langField.append(langHint);
        app.openDialog({
            title: 'Auto captions',
            intro: 'Turns speech into captions on this device — nothing is uploaded. Most languages are recognised by Whisper (the model downloads the first time, then works offline); for Afaan Oromoo you paste the words and they are timed to the voice. For Qur’an recitation use the Qur’ān verse video tool instead: its text is exact.',
            body: [
                app.dialogField('Listen to', source),
                langField,
                modelField,
                textField,
                el('label', { className: 'check' }, [box, 'Captions on a dark box'])
            ],
            actions: [
                { label: 'Cancel', always: true },
                {
                    label: 'Make captions', primary: true,
                    run: async function (d) {
                        d.busy(true);
                        try { localStorage.setItem('ae-transcribe', JSON.stringify({ model: model.value, lang: lang.value })); } catch (err) { /* private mode */ }
                        try {
                            const fromText = FROM_TEXT.indexOf(lang.value) !== -1;
                            if (fromText && !text.value.trim()) { d.busy(false); d.status('Paste the words that are said first.'); return false; }
                            const o = { source: source.value, clipId: sel && sel.id, model: model.value, language: lang.value, box: box.checked, text: text.value };
                            const n = fromText ? await textCaption(o, d.status) : await autoCaption(o, d.status);
                            app.toast(n ? 'Added ' + n + ' caption' + (n === 1 ? '' : 's') + ' on a new track. Click one to edit it.' : 'No speech was found.');
                        } catch (err) {
                            console.error(err);
                            d.busy(false);
                            d.status(/fetch|network|import|load/i.test(err.message) ? 'Could not download the speech model — check the internet connection.' : 'Failed: ' + err.message);
                            return false;
                        }
                    }
                }
            ]
        });
    }

    async function autoCaption(o, status) {
        const p = app.state.project;
        status('Preparing the sound…');
        let range = { from: 0, to: T.projectDuration(p) };
        let project = p;
        if (o.source === 'clip' && o.clipId) {
            const clip = T.getClip(p, o.clipId);
            range = { from: clip.start, to: T.clipEnd(clip) };
            // Only that clip's sound: everything else muted for this render.
            project = T.clone(p);
            project.clips.forEach(function (c) { if (c.id !== clip.id) c.muted = true; });
            project.clips.find((c) => c.id === clip.id).muted = false;
        }
        const audio = await window.ReelMix.renderMono16k(project, range);
        if (!audio) throw new Error('There is no sound to listen to.');
        const files = new Map();
        const out = await transcribe(audio, o.model, o.language, function (d) {
            const text = progressText(d, files);
            if (text) status(text);
        });
        const words = (out.chunks || []).filter((c) => c.timestamp && String(c.text).trim()).map(function (c) {
            const s = c.timestamp[0] || 0;
            const e = c.timestamp[1] == null ? s + 0.3 : c.timestamp[1];
            return { text: c.text, start: range.from + s, end: range.from + e };
        });
        const cues = T.wordsToCaptions(words, { maxChars: p.height > p.width ? 28 : 42 });
        if (!cues.length) return 0;
        placeCues(cues, 'Captions', Object.assign(styleFor(p), { box: o.box }));
        return cues.length;
    }

    /**
     * Captions from a written text, timed to the speech by its pauses — for
     * Afaan Oromoo and any language the recogniser does not know, or to fix
     * one it gets wrong. A new line in the text starts a new caption.
     */
    async function textCaption(o, status) {
        const p = app.state.project;
        status('Listening for the pauses…');
        let range = { from: 0, to: T.projectDuration(p) };
        let clipId = '';
        if (o.source === 'clip' && o.clipId) {
            const clip = T.getClip(p, o.clipId);
            range = { from: clip.start, to: T.clipEnd(clip) };
            clipId = clip.id;
        }
        const sound = await window.ReelPauses.soundPeaks(p, clipId, range.from, range.to);
        if (!sound) throw new Error('There is no sound to listen to.');
        const pauses = window.ReelPauses.pausesOf(sound, { minPause: 0.25, sensitivity: 0.5 });
        const segments = T.speechSegments(pauses, range.from, range.to, 0.2);
        const lines = String(o.text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
        // Each line of the text starts a new caption; a long one is broken up.
        const words = T.alignLines(lines, segments);
        const maxChars = Math.max(p.height > p.width ? 28 : 42, lines.length > 1 ? 56 : 0);
        const cues = [];
        lines.forEach(function (line, i) {
            T.wordsToCaptions(words.filter((w) => w.line === i), { maxChars: maxChars, gap: lines.length > 1 ? 99 : 0.6 }).forEach((c) => cues.push(c));
        });
        if (!cues.length) return 0;
        placeCues(cues, 'Captions', Object.assign(styleFor(p), { box: o.box !== false }));
        return cues.length;
    }

    function openTextCaptions() {
        const p = app.state.project;
        if (!p.clips.some((c) => T.isTimed(p, c))) { app.toast('Add a clip with sound first.'); return; }
        const sel = app.state.selected ? T.getClip(p, app.state.selected) : null;
        const source = el('select', null, [el('option', { value: 'mix', text: 'Everything you hear (the whole mix)' })]
            .concat(sel && T.isTimed(p, sel) ? [el('option', { value: 'clip', text: 'Only the selected clip' })] : []));
        if (sel && T.isTimed(p, sel)) source.value = 'clip';
        const text = el('textarea', { rows: 8, placeholder: 'Paste or type what is said, in order — in any language: Afaan Oromoo, Amharic, Somali… A new line starts a new caption.' });
        const box = el('input', { type: 'checkbox', checked: true });
        app.openDialog({
            title: 'Timed captions from your text',
            intro: 'Paste the words of a talk, khutbah or nasheed and they are timed to the voice by its pauses, on this device. Works in every language and script.',
            body: [app.dialogField('Listen to', source), app.dialogField('What is said', text), el('label', { className: 'check' }, [box, 'Captions on a dark box'])],
            actions: [{ label: 'Cancel' }, {
                label: 'Make captions', primary: true, run: async function (d) {
                    if (!text.value.trim()) { d.status('Paste the words that are said first.'); return false; }
                    d.busy(true);
                    try {
                        const n = await textCaption({ source: source.value, clipId: sel && sel.id, text: text.value, box: box.checked }, d.status);
                        app.toast(n ? 'Added ' + n + ' timed caption' + (n === 1 ? '' : 's') + ' on a new track.' : 'No speech was found.');
                    } catch (err) { d.busy(false); d.status('Failed: ' + err.message); return false; }
                    return true;
                }
            }]
        });
    }

    function importSubtitles() {
        const input = el('input', { type: 'file', accept: '.srt,.vtt,text/vtt,application/x-subrip' });
        input.addEventListener('change', async function () {
            const file = input.files[0];
            if (!file) return;
            const cues = T.parseSubtitles(await file.text());
            if (!cues.length) { app.toast('No subtitles found in ' + file.name + '.'); return; }
            placeCues(cues, 'Subtitles', styleFor(app.state.project));
            app.toast('Imported ' + cues.length + ' subtitles onto a new track.');
        });
        input.click();
    }

    function exportSubtitles() {
        const p = app.state.project;
        const tracks = p.tracks.filter((t) => t.kind === 'text' && T.trackCues(p, t.id).length);
        if (!tracks.length) { app.toast('There are no titles to save as subtitles.'); return; }
        const track = el('select', null, tracks.map((t) => el('option', { value: t.id, text: t.id + ' — ' + t.name + ' (' + T.trackCues(p, t.id).length + ')' })));
        const kind = el('select', null, [el('option', { value: 'srt', text: 'SubRip (.srt) — YouTube, Facebook, players' }), el('option', { value: 'vtt', text: 'WebVTT (.vtt) — web pages' })]);
        const captions = tracks.find((t) => /caption|subtitle|translation/i.test(t.name));
        if (captions) track.value = captions.id;
        app.openDialog({
            title: 'Save subtitles',
            intro: 'Saves the titles on one track as a subtitle file, for uploading alongside the video instead of burning them in.',
            body: [app.dialogField('Track', track), app.dialogField('Format', kind)],
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Save', primary: true,
                    run: function () {
                        const cues = T.trackCues(app.state.project, track.value);
                        const text = kind.value === 'vtt' ? T.toVTT(cues) : T.toSRT(cues);
                        app.download(new Blob([text], { type: 'text/plain' }), app.safeName(app.state.project.name) + '.' + kind.value);
                    }
                }
            ]
        });
    }

    app.addTool({ section: 'Create', label: 'Auto captions (speech to text)…', run: openAutoCaptions });
    app.addTool({ section: 'Create', label: 'Timed captions from your text (Afaan Oromoo, any language)…', run: openTextCaptions });
    app.addTool({ section: 'Subtitles', label: 'Import subtitles (.srt, .vtt)…', run: importSubtitles });
    app.addTool({ section: 'Subtitles', label: 'Save a titles track as subtitles…', run: exportSubtitles });

    function cancelTranscription() {
        if (worker) worker.terminate();
        worker = null;
        Array.from(pending.values()).forEach(p => p({ error: 'Transcription cancelled.' }));
        pending.clear();
    }
    window.ReelCaptions = { open: openAutoCaptions, openTextCaptions, textCaption, autoCaption: autoCaption, placeCues: placeCues, transcribe, progressText, cancelTranscription };
}());
