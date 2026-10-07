/*
 * Reel: sync to the voice.
 *
 * Finds the pauses in a recitation, a talk or a nasheed and uses them:
 * - Pictures on the pauses: chosen photos as scenes, one after another,
 *   each changing in a pause, with a transition and a slow zoom.
 * - Cut at the pauses: the clip split into pieces at each pause.
 * - Remove the pauses: the quiet taken out and closed up (jump cuts).
 * - Markers at the pauses.
 * The sound is read on this device; nothing is uploaded.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const RATE = 100;
    const KEN_BURNS = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right'];

    /**
     * Peak levels at 100 per second of one clip's sound (or the whole mix
     * when `clipId` is empty) between `from` and `to`, in timeline time.
     */
    async function soundPeaks(project, clipId, from, to) {
        let p = project;
        if (clipId) {
            p = T.clone(project);
            p.clips.forEach(function (c) { c.muted = c.id !== clipId; });
        }
        const audio = await window.ReelMix.renderMono16k(p, { from: from, to: to });
        if (!audio) return null;
        const step = 16000 / RATE;
        const peaks = new Float32Array(Math.ceil(audio.length / step));
        for (let i = 0; i < peaks.length; i += 1) {
            let m = 0;
            const end = Math.min(audio.length, (i + 1) * step);
            for (let k = i * step; k < end; k += 1) { const v = Math.abs(audio[k]); if (v > m) m = v; }
            peaks[i] = m;
        }
        return { peaks: peaks, rate: RATE, from: from, to: to };
    }

    /** Pauses as timeline times, from soundPeaks' result. */
    function pausesOf(sound, options) {
        return T.findPauses(sound.peaks, sound.rate, options)
            .map((q) => ({ start: q.start + sound.from, end: q.end + sound.from }));
    }

    /** Clips whose sound can be listened to: audio, and videos that are not muted. */
    function voiceClips(project) {
        return project.clips.filter(function (c) {
            if (!T.isTimed(project, c) || c.muted) return false;
            const m = T.getMedia(project, c.mediaId);
            return m && (m.type === 'audio' || m.type === 'video');
        }).sort((a, b) => (T.getMedia(project, a.mediaId).type === 'audio' ? 0 : 1) - (T.getMedia(project, b.mediaId).type === 'audio' ? 0 : 1) || a.start - b.start);
    }

    /**
     * Puts `photoIds` on a new track as scenes from `from` to `to`, one per
     * piece between `cuts`, taking the photos in turn. Returns the project.
     */
    function picturesOnCuts(project, photoIds, from, to, cuts, o) {
        const opts = Object.assign({ transition: 'crossfade', transitionDuration: 0.5, kenBurns: true, fit: 'cover' }, o);
        if (!photoIds.length) return project;
        const id = T.nextTrackId(project, 'video');
        let p = T.addTrack(project, 'video', opts.trackName || 'Scenes on the pauses');
        const edges = [from].concat(cuts.filter((t) => t > from && t < to)).concat([to]);
        for (let i = 0; i < edges.length - 1; i += 1) {
            const media = T.getMedia(p, photoIds[i % photoIds.length]);
            if (!media) continue;
            const length = edges[i + 1] - edges[i];
            const clip = Object.assign(T.clipFromMedia(media, id, edges[i]), { duration: Math.round(length * 1000) / 1000, fit: opts.fit });
            if (opts.kenBurns && media.type === 'image') clip.motion = { type: KEN_BURNS[i % KEN_BURNS.length], amount: 0.12 };
            if (media.type === 'video') clip.muted = true;
            if (i === 0) clip.enter = 'fade';
            if (i > 0 && opts.transition && opts.transition !== 'none') {
                clip.transition = { type: opts.transition, duration: Math.min(opts.transitionDuration, length / 3, (edges[i] - edges[i - 1]) / 3) };
            }
            if (i === edges.length - 2) clip.fadeOut = Math.min(0.5, length / 3);
            p = T.addClip(p, clip);
        }
        return p;
    }

    function openSync() {
        app.pause();
        const project = app.state.project;
        const voices = voiceClips(project);
        if (!voices.length) { app.toast('Add a recitation, talk or song with sound to the timeline first.'); return; }
        const sel = app.state.selected && T.getClip(project, app.state.selected);
        const name = (c) => {
            const m = T.getMedia(project, c.mediaId);
            return (m ? m.name : 'Clip') + ' · ' + app.fmt(c.start) + '–' + app.fmt(T.clipEnd(c));
        };
        const voice = el('select', null, voices.map((c) => el('option', { value: c.id, text: name(c) })));
        if (sel && voices.some((c) => c.id === sel.id)) voice.value = sel.id;
        const mode = el('select', null, [
            ['pictures', 'Pictures on the pauses — a new scene at each pause'],
            ['cut', 'Cut this clip at the pauses'],
            ['remove', 'Remove the pauses (jump cuts)'],
            ['markers', 'Markers at the pauses']
        ].map((o) => el('option', { value: o[0], text: o[1] })));
        const sens = el('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Pause sensitivity' });
        const minPause = el('input', { type: 'number', min: 0.1, max: 3, step: 0.05, value: 0.35 });
        const minScene = el('input', { type: 'number', min: 0.5, max: 30, step: 0.5, value: 2.5 });
        const pad = el('input', { type: 'number', min: 0, max: 1, step: 0.05, value: 0.15 });
        const found = el('p', { className: 'hint sync-found', 'aria-live': 'polite', text: 'Listening for the pauses…' });

        // Photos: the pictures already in the media, plus any added here.
        const photoList = el('div', { className: 'sync-photos' });
        const chosen = new Set();
        const renderPhotos = function () {
            photoList.textContent = '';
            const pics = app.state.project.media.filter((m) => m.type === 'image');
            if (!pics.length) photoList.append(el('p', { className: 'hint', text: 'No photos yet — add some below.' }));
            pics.forEach(function (m) {
                const box = el('input', { type: 'checkbox' });
                box.checked = chosen.has(m.id);
                box.addEventListener('change', function () { if (box.checked) chosen.add(m.id); else chosen.delete(m.id); show(); });
                const f = app.files.get(m.id);
                photoList.append(el('label', { className: 'sync-photo', title: m.name }, [box,
                    f && (f.thumbnail || f.url) ? el('img', { src: f.thumbnail || f.url, alt: '' }) : el('span', { text: '▣' }),
                    el('span', { text: m.name })]));
            });
        };
        app.state.project.media.filter((m) => m.type === 'image').forEach((m) => chosen.add(m.id));
        renderPhotos();
        const addPhotos = el('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Add photos' });
        addPhotos.addEventListener('change', async function () {
            const ids = await app.importFiles(Array.from(addPhotos.files), { noCommit: true });
            ids.forEach((x) => chosen.add(x));
            addPhotos.value = '';
            renderPhotos();
            show();
        });
        const transition = el('select', null, [['crossfade', 'Crossfade'], ['none', 'Straight cut'], ['dip', 'Dip to black'], ['slide', 'Slide'], ['push', 'Push'], ['zoom', 'Zoom'], ['blur', 'Blur'], ['iris', 'Iris']]
            .map((o) => el('option', { value: o[0], text: o[1] })));
        const kb = el('input', { type: 'checkbox' });
        kb.checked = true;
        const shuffle = el('input', { type: 'checkbox' });
        const photoBox = el('div', { className: 'sync-group' }, [
            el('strong', { text: 'Photos (taken in turn, again from the first when they run out)' }), photoList,
            app.dialogField('Add photos', addPhotos), app.dialogField('Transition', transition),
            el('label', { className: 'check' }, [kb, 'Slow zoom and pan on each photo']),
            el('label', { className: 'check' }, [shuffle, 'Shuffle the photos'])
        ]);
        const sceneField = app.dialogField('Shortest scene (seconds)', minScene, 'Pauses closer together than this are skipped.');
        const padField = app.dialogField('Quiet kept each side (seconds)', pad, 'So the ends of words are not cut off.');

        let sound = null;
        let pauses = [];
        const clip = () => T.getClip(app.state.project, voice.value);
        const cuts = () => { const c = clip(); return T.pauseCuts(pauses, c.start, T.clipEnd(c), Number(minScene.value) || 1); };
        const show = function () {
            const m = mode.value;
            photoBox.hidden = m !== 'pictures';
            sceneField.hidden = m === 'remove';
            padField.hidden = m !== 'remove';
            if (!sound) return;
            pauses = pausesOf(sound, { sensitivity: Number(sens.value) / 100, minPause: Number(minPause.value) || 0.3 });
            const c = clip();
            const quiet = pauses.reduce((a, q) => a + Math.max(0, q.end - q.start - 2 * (Number(pad.value) || 0)), 0);
            const n = cuts().length;
            found.textContent = 'Found ' + pauses.length + ' pause' + (pauses.length === 1 ? '' : 's') + '. ' + (
                m === 'pictures' ? (n + 1) + ' scenes of about ' + ((T.clipEnd(c) - c.start) / (n + 1)).toFixed(1) + ' s' + (chosen.size ? ' from ' + chosen.size + ' photo' + (chosen.size === 1 ? '' : 's') : ' — choose some photos') + '.' :
                m === 'cut' ? 'The clip becomes ' + (n + 1) + ' pieces.' :
                m === 'remove' ? 'About ' + quiet.toFixed(1) + ' s of quiet comes out.' : n + ' markers.');
        };
        const listen = async function () {
            sound = null;
            found.textContent = 'Listening for the pauses…';
            const c = clip();
            try {
                sound = await soundPeaks(app.state.project, c.id, c.start, T.clipEnd(c));
            } catch (err) { found.textContent = 'The sound could not be read: ' + err.message; return; }
            if (!sound) { found.textContent = 'This clip has no sound to listen to.'; return; }
            show();
        };
        [sens, minPause, minScene, pad].forEach((x) => x.addEventListener('input', show));
        mode.addEventListener('change', show);
        voice.addEventListener('change', listen);

        app.openDialog({
            title: 'Sync to the voice',
            wide: true,
            intro: 'Finds the pauses in a recitation, talk or nasheed and changes the picture on each one, cuts there, or takes the quiet out. One undo puts it back.',
            body: [
                app.dialogField('Voice', voice), app.dialogField('Do this', mode),
                app.dialogField('Sensitivity', sens, 'Higher finds more, shorter pauses.'),
                app.dialogField('Shortest pause (seconds)', minPause), sceneField, padField, found, photoBox
            ],
            actions: [{ label: 'Cancel' }, {
                label: 'Apply', primary: true, run: function (d) {
                    if (!sound) { d.status('Still listening — try again in a moment.'); return false; }
                    const c = clip();
                    const p0 = app.state.project;
                    const m = mode.value;
                    let p = p0;
                    const list = cuts();
                    if (m === 'pictures') {
                        const ids = p0.media.filter((x) => chosen.has(x.id)).map((x) => x.id);
                        if (!ids.length) { d.status('Choose at least one photo.'); return false; }
                        if (shuffle.checked) ids.sort(() => Math.random() - 0.5);
                        p = picturesOnCuts(p0, ids, c.start, T.clipEnd(c), list, { transition: transition.value, kenBurns: kb.checked });
                    } else if (m === 'cut') {
                        p = T.cutAt(p0, c.id, list).project;
                    } else if (m === 'remove') {
                        p = T.removePauses(p0, pauses, Number(pad.value) || 0);
                    } else {
                        list.forEach(function (t, i) { p = T.addMarker(p, t, 'Pause ' + (i + 1)).project; });
                    }
                    if (p === p0) { d.status('No pauses to use — try a higher sensitivity or a shorter pause.'); return false; }
                    app.apply(p);
                    app.zoomToFit();
                    app.toast(m === 'pictures' ? (list.length + 1) + ' scenes placed on the pauses.' : m === 'cut' ? 'Cut into ' + (list.length + 1) + ' pieces.' : m === 'remove' ? 'Pauses removed. Undo brings them back.' : list.length + ' markers added.');
                    return true;
                }
            }]
        });
        show();
        listen();
    }

    const bar = document.querySelector('.studio-bar');
    if (bar) bar.append(el('button', { type: 'button', id: 'studio-pauses', text: 'Pictures on pauses', onclick: openSync }));
    app.addTool({ section: 'Create', label: 'Sync to the voice (pictures on pauses, jump cuts)…', run: openSync });

    window.ReelPauses = { openSync, soundPeaks, pausesOf, picturesOnCuts, voiceClips };
}());
