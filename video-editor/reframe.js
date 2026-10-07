/*
 * Reel: auto-reframe.
 *
 * Keeps the speaker's face in the frame when a wide video goes into a tall
 * (9:16) or square project: the video is looked through every 0.4 s, the face
 * found, and the picture glides to follow it with keyframes — holding still
 * while the face stays near the middle. Faces are found on this device, with
 * the browser's own face detector, else Google's MediaPipe face detector
 * (downloaded once, about 1 MB), else an estimate from skin colour that needs
 * no download. Nothing is uploaded.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const STEP = 0.4;
    const SAMPLE_W = 320;
    const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

    /* --------------------------------------------------------- face finders */

    /** Centre x (0–1) of the largest face, or null. */
    let finder = null;
    async function getFinder() {
        if (window.__reelTestFaceDetector) return { name: 'test', find: window.__reelTestFaceDetector };
        if (finder) return finder;
        if ('FaceDetector' in window) {
            try {
                const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
                return (finder = { name: 'browser', find: async (c) => largest((await fd.detect(c)).map((f) => f.boundingBox), c.width) });
            } catch (err) { /* not usable here */ }
        }
        try {
            const vision = await import(MP + '/vision_bundle.mjs');
            const files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
            const det = await vision.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MP_MODEL }, runningMode: 'IMAGE' });
            return (finder = {
                name: 'mediapipe',
                find: async (c) => largest(det.detect(c).detections.map((d) => ({ x: d.boundingBox.originX, width: d.boundingBox.width, height: d.boundingBox.height })), c.width)
            });
        } catch (err) {
            return (finder = { name: 'skin', find: async (c) => skinCentre(c) });
        }
    }

    function largest(boxes, W) {
        if (!boxes.length) return null;
        const b = boxes.reduce((a, x) => (x.width * x.height > a.width * a.height ? x : a));
        return (b.x + b.width / 2) / W;
    }

    /** Where skin-coloured pixels gather across the picture (an estimate, no download). */
    function skinCentre(c) {
        const g = c.getContext('2d');
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const cols = new Float32Array(c.width);
        let total = 0;
        for (let y = 0; y < c.height; y += 2) {
            for (let x = 0; x < c.width; x += 2) {
                const i = (y * c.width + x) * 4;
                const r = d[i];
                const gg = d[i + 1];
                const b = d[i + 2];
                const cb = 128 - 0.168736 * r - 0.331264 * gg + 0.5 * b;
                const cr = 128 + 0.5 * r - 0.418688 * gg - 0.081312 * b;
                if (cr > 135 && cr < 180 && cb > 85 && cb < 135 && r > 60) { cols[x] += 1; total += 1; }
            }
        }
        if (total < c.width * c.height * 0.004) return null;
        // The densest band, not the average: two hands should not pull the camera between them.
        const band = Math.round(c.width * 0.18);
        let best = 0;
        let at = 0;
        let run = 0;
        for (let x = 0; x < c.width; x += 1) {
            run += cols[x] - (x >= band ? cols[x - band] : 0);
            if (run > best) { best = run; at = x - band / 2; }
        }
        return Math.min(1, Math.max(0, at / c.width));
    }

    /* ------------------------------------------------------------ sampling */

    function seekTo(v, t) {
        return new Promise(function (resolve) {
            const done = () => { v.removeEventListener('seeked', done); resolve(); };
            v.addEventListener('seeked', done);
            v.currentTime = t;
            setTimeout(done, 3000);
        });
    }

    /** Looks through a clip's video and returns samples { t, fx }. */
    async function sampleFaces(clip, onProgress) {
        const f = app.files.get(clip.mediaId);
        const media = T.getMedia(app.state.project, clip.mediaId);
        if (!f || !f.url || !media || media.type !== 'video') throw new Error('Select a video clip.');
        const find = await getFinder();
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.src = f.url;
        await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = () => reject(new Error('The video could not be read.')); });
        const c = document.createElement('canvas');
        c.width = SAMPLE_W;
        c.height = Math.max(2, Math.round(SAMPLE_W * (v.videoHeight || 9) / (v.videoWidth || 16)));
        const g = c.getContext('2d', { willReadFrequently: true });
        const speed = T.speedOf(clip);
        const samples = [];
        const n = Math.max(1, Math.ceil(clip.duration / STEP));
        for (let i = 0; i <= n; i += 1) {
            const t = Math.min(clip.duration, i * STEP);
            await seekTo(v, Math.min((media.duration || Infinity) - 0.05, (clip.in || 0) + t * speed));
            g.drawImage(v, 0, 0, c.width, c.height);
            let fx = null;
            try { fx = await find.find(c); } catch (err) { fx = null; }
            samples.push({ t: t, fx: fx });
            if (onProgress) onProgress((i + 1) / (n + 1), find.name);
        }
        v.removeAttribute('src');
        v.load();
        return { samples: samples, srcW: v.videoWidth || media.width, srcH: v.videoHeight || media.height, finder: find.name };
    }

    /** Reframes clip `id` in `project`; resolves to { project, keys, finder, faces }. */
    async function reframeClip(project, id, onProgress) {
        const clip = T.getClip(project, id);
        const r = await sampleFaces(clip, onProgress);
        const keys = T.reframeKeys(r.samples, r.srcW, r.srcH, project.width, project.height, { scale: clip.scale || 1 });
        const faces = r.samples.filter((s) => s.fx != null).length;
        return { project: keys.length ? T.applyReframe(project, id, keys) : project, keys: keys, finder: r.finder, faces: faces, samples: r.samples.length };
    }

    /** Video clips that are wider than the frame, so there is room to follow a face. */
    function candidates(project) {
        return project.clips.filter(function (c) {
            const m = T.getMedia(project, c.mediaId);
            return m && m.type === 'video' && m.width && m.height && m.width / m.height > project.width / project.height * 1.05;
        });
    }

    const FINDER_TEXT = {
        test: 'test faces', browser: 'the browser’s face detector', mediapipe: 'the MediaPipe face detector',
        skin: 'an estimate from skin colour (no face detector could load — check the internet connection for a better result)'
    };

    async function reframeAll(ids, status) {
        let p = app.state.project;
        let moved = 0;
        let used = '';
        for (let i = 0; i < ids.length; i += 1) {
            const r = await reframeClip(p, ids[i], function (f, name) {
                status('Looking for faces' + (ids.length > 1 ? ' in clip ' + (i + 1) + ' of ' + ids.length : '') + '… ' + Math.round(f * 100) + '%');
                used = name;
            });
            p = r.project;
            if (r.keys.length) moved += 1;
        }
        if (moved) { app.apply(p); app.requestDraw(); }
        return { moved: moved, finder: used };
    }

    function openReframe() {
        app.pause();
        const p = app.state.project;
        const list = candidates(p);
        if (!list.length) {
            app.toast(p.height >= p.width ? 'Add a wide video first — there is nothing to follow in this frame.' : 'Auto-reframe is for tall or square videos. Change the frame to 9:16 (or make a Short) first.');
            return;
        }
        const sel = app.state.selected && list.find((c) => c.id === app.state.selected);
        const which = el('select', null, [el('option', { value: 'all', text: 'Every wide video in this project (' + list.length + ')' })]
            .concat(sel ? [el('option', { value: 'one', text: 'Only the selected clip' })] : []));
        if (sel) which.value = 'one';
        app.openDialog({
            title: 'Auto-reframe — follow the face',
            intro: 'Keeps the speaker’s face in the tall frame. The picture holds still while the face stays near the middle and glides when it moves. Faces are found on this device; nothing is uploaded. It replaces the clip’s keyframes; one undo takes it back.',
            body: [app.dialogField('Reframe', which)],
            actions: [{ label: 'Cancel' }, {
                label: 'Follow the face', primary: true, run: async function (d) {
                    d.busy(true);
                    try {
                        const r = await reframeAll(which.value === 'one' ? [sel.id] : list.map((c) => c.id), d.status);
                        app.toast(r.moved ? 'Reframed ' + r.moved + ' clip' + (r.moved === 1 ? '' : 's') + ' using ' + FINDER_TEXT[r.finder] + '.' : 'No faces were found to follow.', 6000);
                    } catch (err) { d.busy(false); d.status(err.message); return false; }
                    return true;
                }
            }]
        });
    }

    app.addTool({ section: 'Video', label: 'Auto-reframe — follow the face…', run: openReframe });
    window.ReelReframe = { openReframe, reframeClip, reframeAll, candidates, skinCentre, getFinder };
}());
