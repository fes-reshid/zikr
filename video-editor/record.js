/*
 * Reel: record your screen and camera together.
 *
 * For lessons and tutorials: your screen with your camera in a round or
 * rounded bubble in a corner (picture-in-picture), or the camera alone, or
 * the screen alone — with your microphone. The two are combined live on a
 * canvas and recorded in the browser; when you stop, the recording is added
 * to the media and to the end of the timeline. Nothing is uploaded.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const el = app.el;
    const OUT_W = 1280;
    const OUT_H = 720;

    function supported() {
        return !!(navigator.mediaDevices && window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
    }

    function pickMime() {
        const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
        return list.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    }

    function videoFor(stream) {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.srcObject = stream;
        return v.play().then(() => v);
    }

    /** Draws `v` to cover or fit the box. */
    function drawInto(c, v, x, y, w, h, cover) {
        const vw = v.videoWidth || 16;
        const vh = v.videoHeight || 9;
        const k = cover ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
        const dw = vw * k;
        const dh = vh * k;
        c.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    let session = null;

    async function start(opts) {
        const streams = [];
        let screen = null;
        let camera = null;
        let mic = null;
        try {
            if (opts.screen) {
                screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: !!opts.systemAudio });
                streams.push(screen);
            }
            if (opts.camera || opts.mic) {
                const cam = await navigator.mediaDevices.getUserMedia({ video: opts.camera ? { width: 1280, height: 720 } : false, audio: !!opts.mic });
                streams.push(cam);
                if (opts.camera) camera = cam;
                if (opts.mic) mic = cam;
            }
        } catch (err) {
            streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
            throw new Error(err && err.name === 'NotAllowedError' ? 'Permission was not given. Allow the camera, microphone or screen and try again.' : 'Recording could not start: ' + (err && err.message || err));
        }
        const screenVideo = screen ? await videoFor(screen) : null;
        const cameraVideo = camera ? await videoFor(new MediaStream(camera.getVideoTracks())) : null;
        const canvas = document.createElement('canvas');
        canvas.width = OUT_W;
        canvas.height = OUT_H;
        const c = canvas.getContext('2d');
        let raf = 0;
        const frame = function () {
            c.fillStyle = '#000';
            c.fillRect(0, 0, OUT_W, OUT_H);
            if (screenVideo) drawInto(c, screenVideo, 0, 0, OUT_W, OUT_H, false);
            if (cameraVideo) {
                if (!screenVideo) {
                    drawInto(c, cameraVideo, 0, 0, OUT_W, OUT_H, true);
                } else {
                    // The camera bubble in its corner.
                    const size = OUT_H * opts.bubble;
                    const m = OUT_H * 0.04;
                    const x = opts.corner.indexOf('l') !== -1 ? m : OUT_W - m - size;
                    const y = opts.corner.indexOf('t') === 0 ? m : OUT_H - m - size;
                    c.save();
                    c.beginPath();
                    if (opts.shape === 'circle') c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
                    else if (c.roundRect) c.roundRect(x, y, size, size, size * 0.16);
                    else c.rect(x, y, size, size);
                    c.clip();
                    drawInto(c, cameraVideo, x, y, size, size, true);
                    c.restore();
                    c.lineWidth = 6;
                    c.strokeStyle = opts.ring;
                    c.beginPath();
                    if (opts.shape === 'circle') c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
                    else if (c.roundRect) c.roundRect(x, y, size, size, size * 0.16);
                    else c.rect(x, y, size, size);
                    c.stroke();
                }
            }
            raf = requestAnimationFrame(frame);
        };
        frame();
        // Mix the microphone with any screen sound.
        const out = canvas.captureStream(30);
        let audioCtx = null;
        const audioIn = [mic, screen].filter((s) => s && s.getAudioTracks().length);
        if (audioIn.length === 1) out.addTrack(audioIn[0].getAudioTracks()[0]);
        else if (audioIn.length > 1) {
            audioCtx = new AudioContext();
            const dest = audioCtx.createMediaStreamDestination();
            audioIn.forEach((s) => audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest));
            out.addTrack(dest.stream.getAudioTracks()[0]);
        }
        const mime = pickMime();
        const rec = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 5000000 } : undefined);
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const done = new Promise((resolve) => { rec.onstop = resolve; });
        rec.start(500);
        const began = performance.now();
        session = { rec, chunks, done, began, raf: () => raf, streams, audioCtx, canvas, mime, paused: 0, pausedAt: 0 };
        // If the person stops sharing from the browser's own bar, finish too.
        if (screen) screen.getVideoTracks()[0].addEventListener('ended', () => { if (session && session.rec.state !== 'inactive') stop(); });
        showBar();
    }

    async function stop() {
        if (!session) return;
        const s = session;
        session = null;
        hideBar();
        if (s.rec.state !== 'inactive') s.rec.stop();
        await s.done;
        cancelAnimationFrame(s.raf());
        s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
        if (s.audioCtx) s.audioCtx.close();
        const type = (s.mime || 'video/webm').split(';')[0];
        const blob = new Blob(s.chunks, { type: type });
        if (!blob.size) { app.toast('Nothing was recorded.'); return; }
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
        const file = new File([blob], 'Recording ' + stamp + (type === 'video/mp4' ? '.mp4' : '.webm'), { type: type, lastModified: Date.now() });
        const ids = await app.importFiles([file]);
        if (ids.length) app.addToTimeline(ids[0]);
        app.toast('Recording added to your media and the end of the timeline.');
    }

    function togglePause() {
        if (!session) return;
        if (session.rec.state === 'recording') { session.rec.pause(); session.pausedAt = performance.now(); } else if (session.rec.state === 'paused') {
            session.rec.resume();
            session.paused += performance.now() - session.pausedAt;
        }
        updateBar();
    }

    let bar = null;
    let timer = 0;
    function showBar() {
        bar = el('div', { className: 'record-bar', role: 'status' }, [
            el('span', { className: 'record-dot' }),
            el('span', { className: 'record-time', text: '00:00' }),
            el('button', { type: 'button', className: 'ghost', text: 'Pause', onclick: togglePause }),
            el('button', { type: 'button', className: 'primary', text: '■ Stop', onclick: stop })
        ]);
        const thumb = session.canvas;
        thumb.className = 'record-thumb';
        bar.prepend(thumb);
        document.body.append(bar);
        timer = setInterval(updateBar, 250);
    }
    function updateBar() {
        if (!bar || !session) return;
        const pausedNow = session.rec.state === 'paused';
        const ms = (pausedNow ? session.pausedAt : performance.now()) - session.began - session.paused;
        const sec = Math.max(0, Math.floor(ms / 1000));
        bar.querySelector('.record-time').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') + (pausedNow ? ' · paused' : '');
        bar.querySelector('.ghost').textContent = pausedNow ? 'Resume' : 'Pause';
        bar.classList.toggle('paused', pausedNow);
    }
    function hideBar() {
        clearInterval(timer);
        if (bar) bar.remove();
        bar = null;
    }

    function countdown() {
        return new Promise(function (resolve) {
            const box = el('div', { className: 'record-countdown', text: '3' });
            document.body.append(box);
            let n = 3;
            const tick = setInterval(function () {
                n -= 1;
                if (n <= 0) { clearInterval(tick); box.remove(); resolve(); } else box.textContent = String(n);
            }, 800);
        });
    }

    function openRecorder() {
        if (!supported()) { app.toast('This browser cannot record here. Try Chrome, Edge or Firefox on a computer.'); return; }
        if (session) { app.toast('A recording is already running.'); return; }
        app.pause();
        const mode = el('select', null, [['both', 'Screen with my camera in a corner'], ['screen', 'Screen only'], ['camera', 'Camera only']]
            .map((o) => el('option', { value: o[0], text: o[1] })));
        if (!navigator.mediaDevices.getDisplayMedia) mode.value = 'camera';
        const corner = el('select', null, [['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left']].map((o) => el('option', { value: o[0], text: o[1] })));
        const shape = el('select', null, [['circle', 'Circle'], ['rounded', 'Rounded square']].map((o) => el('option', { value: o[0], text: o[1] })));
        const size = el('input', { type: 'range', min: 18, max: 45, value: 28 });
        const ring = el('input', { type: 'color', value: '#f2b84b' });
        const check = (label, on) => { const b = el('input', { type: 'checkbox' }); b.checked = on; return [b, el('label', { className: 'check' }, [b, label])]; };
        const [mic, micRow] = check('Record my microphone', true);
        const [sys, sysRow] = check('Also record the sound from the screen (if the browser allows)', false);
        app.openDialog({
            title: 'Record screen & camera',
            intro: 'Great for lessons and tutorials. The recording stays on this device and is added to your timeline when you stop.',
            body: [app.dialogField('Record', mode), app.dialogField('Camera corner', corner), app.dialogField('Camera shape', shape),
                app.dialogField('Camera size', size), app.dialogField('Ring colour', ring), micRow, sysRow,
                el('p', { className: 'hint', text: 'Your browser will ask which screen or window to share, and for the camera and microphone. A 3-2-1 countdown starts the recording.' })],
            actions: [{ label: 'Cancel' }, {
                label: '● Start recording', primary: true, run: async function (d) {
                    const m = mode.value;
                    d.busy(true);
                    try {
                        await countdown();
                        await start({
                            screen: m !== 'camera', camera: m !== 'screen', mic: mic.checked, systemAudio: sys.checked,
                            corner: corner.value, shape: shape.value, bubble: Number(size.value) / 100, ring: ring.value
                        });
                    } catch (err) { d.status(err.message); d.busy(false); return false; }
                    return true;
                }
            }]
        });
    }

    const studio = document.querySelector('.studio-bar');
    if (studio) studio.append(el('button', { type: 'button', id: 'studio-screen', text: 'Record screen', onclick: openRecorder }));
    app.addTool({ section: 'Create', label: 'Record screen & camera…', run: openRecorder });

    window.ReelRecorder = { openRecorder, start, stop, togglePause, isRecording: () => !!session };
}());
