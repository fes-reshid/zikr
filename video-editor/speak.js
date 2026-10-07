/*
 * Reel: read aloud.
 *
 * Typed text becomes a spoken voice-over on the timeline, made on this
 * device with Meta's MMS voices (one per language; each downloads once, about
 * 30 MB, then works offline). Each sentence can become a caption timed to
 * exactly when it is spoken. Not for the Qur'an: use a reciter for that.
 * The MMS voices are licensed CC BY-NC 4.0 — free for non-commercial use.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelSpeak = Object.assign(root.ReelSpeak || {}, api);
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VOICES = [
        ['eng', 'English'], ['orm', 'Afaan Oromoo'], ['amh', 'Amharic (አማርኛ)'], ['som', 'Somali'], ['swh', 'Swahili'],
        ['hau', 'Hausa'], ['fra', 'French'], ['ind', 'Indonesian'], ['tur', 'Turkish']
    ];

    /** Candidate model repos for a language, tried in order. */
    function models(code) {
        return ['Xenova/mms-tts-' + code, 'onnx-community/mms-tts-' + code];
    }

    // Ethiopic (Ge'ez script) to Latin, as the Amharic voice was trained on romanised text.
    // Each consonant row has seven vowel forms (plus a -wa form): ä u i a e ə o.
    const ROWS = {
        0x1200: 'h', 0x1208: 'l', 0x1210: 'h', 0x1218: 'm', 0x1220: 's', 0x1228: 'r', 0x1230: 's', 0x1238: 'sh', 0x1240: 'q',
        0x1250: 'q', 0x1260: 'b', 0x1268: 'v', 0x1270: 't', 0x1278: 'ch', 0x1280: 'h', 0x1290: 'n', 0x1298: 'ny', 0x12A0: '',
        0x12A8: 'k', 0x12B8: 'h', 0x12C8: 'w', 0x12D0: '', 0x12D8: 'z', 0x12E0: 'zh', 0x12E8: 'y', 0x12F0: 'd', 0x12F8: 'd',
        0x1300: 'j', 0x1308: 'g', 0x1318: 'g', 0x1320: 't', 0x1328: 'ch', 0x1330: 'p', 0x1338: 'ts', 0x1340: 'ts', 0x1348: 'f', 0x1350: 'p'
    };
    const ORDERS = ['e', 'u', 'i', 'a', 'e', '', 'o', 'wa'];
    const PUNCT = { 0x1361: ' ', 0x1362: '.', 0x1363: ',', 0x1364: ';', 0x1365: ':', 0x1366: ':', 0x1367: '?', 0x1368: '.' };

    function romanizeEthiopic(text) {
        let out = '';
        for (const ch of String(text)) {
            const cp = ch.codePointAt(0);
            if (cp >= 0x1200 && cp <= 0x135A) {
                const row = cp - ((cp - 0x1200) % 8);
                const order = (cp - 0x1200) % 8;
                const c = ROWS[row];
                if (c === undefined) { out += ' '; continue; }
                // The glottal rows carry the vowel alone (their sixth form is "i"), and with
                // the h rows their first form is said "a" in Amharic.
                const vowel = (c === '' || c === 'h') && order === 0 ? 'a' : c === '' && order === 5 ? 'i' : ORDERS[order];
                out += c + vowel;
            } else if (PUNCT[cp] !== undefined) out += PUNCT[cp];
            else out += ch;
        }
        return out.replace(/\s+/g, ' ').trim();
    }

    /** Splits text into sentences of a size the voice reads well (it slurs very long inputs). */
    function sentences(text, maxChars) {
        const max = maxChars || 220;
        const out = [];
        String(text || '').split(/\n+/).forEach(function (para) {
            const parts = para.match(/[^.!?።؟…]+[.!?።؟…]*["”’)]*\s*/g) || [];
            parts.forEach(function (s) {
                let t = s.trim();
                while (t.length > max) {
                    let cut = t.lastIndexOf(',', max);
                    if (cut < max * 0.4) cut = t.lastIndexOf(' ', max);
                    if (cut < 1) cut = max;
                    out.push(t.slice(0, cut + 1).trim());
                    t = t.slice(cut + 1).trim();
                }
                if (t) out.push(t);
            });
        });
        return out;
    }

    /** What the voice is given for a sentence in `code`. */
    function prepare(code, sentence) {
        return code === 'amh' ? romanizeEthiopic(sentence) : sentence;
    }

    /**
     * Joins spoken parts with a short pause, and returns the audio and where
     * each part starts and ends (for captions).
     */
    function joinParts(parts, rate, gap) {
        const pause = Math.round((gap == null ? 0.3 : gap) * rate);
        const total = parts.reduce((a, p) => a + p.length, 0) + pause * Math.max(0, parts.length - 1);
        const audio = new Float32Array(total);
        const spans = [];
        let at = 0;
        parts.forEach(function (p, i) {
            audio.set(p, at);
            spans.push({ start: at / rate, end: (at + p.length) / rate });
            at += p.length + (i < parts.length - 1 ? pause : 0);
        });
        return { audio: audio, spans: spans };
    }

    return { VOICES, models, romanizeEthiopic, sentences, prepare, joinParts };
}));

/* ---------------------------------------------------------------- the dialog */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp) return;
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const S = window.ReelSpeak;
    const script = document.currentScript;
    const version = script ? new URL(script.src).searchParams.get('v') : '';

    let worker = null;
    let seq = 0;
    const pending = new Map();

    /** Speaks `parts` with the first voice of `candidates` that loads. Tests replace it with window.__reelTestSpeaker. */
    function speak(parts, candidates, onMessage) {
        if (window.__reelTestSpeaker) return window.__reelTestSpeaker(parts, candidates);
        if (!worker) {
            worker = new Worker(new URL('speak-worker.js' + (version ? '?v=' + version : ''), script ? script.src : location.href), { type: 'module' });
            worker.onmessage = function (e) { const p = pending.get(e.data.id); if (p) p(e.data); };
            worker.onerror = function (e) {
                pending.forEach((p) => p({ error: e.message || 'The voice stopped' }));
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
            worker.postMessage({ id: id, parts: parts, models: candidates });
        });
    }

    /** Makes the voice-over and puts it at `at`; resolves to { clipId, seconds, captions }. */
    async function readAloud(o, status) {
        const lines = S.sentences(o.text);
        if (!lines.length) throw new Error('Type something to read aloud first.');
        const files = new Map();
        const out = await speak(lines.map((l) => S.prepare(o.voice, l)), S.models(o.voice), function (d) {
            if (d.status === 'speaking') status('Speaking… sentence ' + (d.done + 1) + ' of ' + d.total);
            else if (d.progress && window.ReelCaptions) {
                const t = window.ReelCaptions.progressText(d, files);
                if (t) status(t.replace('speech model', 'voice'));
            }
        });
        const joined = S.joinParts(out.parts, out.rate, 0.35);
        const wav = window.ReelAudio.encodeWav([joined.audio], out.rate);
        const label = (S.VOICES.find((v) => v[0] === o.voice) || [0, 'Voice'])[1].replace(/ \(.*/, '');
        const name = 'Read aloud (' + label + ') – ' + o.text.trim().slice(0, 32).replace(/\s+/g, ' ') + '.wav';
        const ids = await app.importFiles([new File([wav], name, { type: 'audio/wav', lastModified: Date.now() })], { noCommit: true, fresh: true, origin: 'speak' });
        if (!ids.length) throw new Error('The voice-over could not be added.');
        let p = app.state.project;
        const media = T.getMedia(p, ids[0]);
        const at = Math.max(0, o.at || 0);
        let track = p.tracks.find((t) => t.kind === 'audio' && T.isFree(p, t.id, at, media.duration, null));
        if (!track) {
            const tid = T.nextTrackId(p, 'audio');
            p = T.addTrack(p, 'audio', 'Voice-over');
            track = T.getTrack(p, tid);
        }
        const clip = T.clipFromMedia(media, track.id, at);
        p = T.addClip(p, clip);
        let captions = 0;
        if (o.captions) {
            const vertical = p.height > p.width;
            const tid = T.nextTrackId(p, 'text');
            p = T.addTrack(p, 'text', 'Voice-over captions');
            lines.forEach(function (line, i) {
                const span = joined.spans[i];
                p = T.addClip(p, Object.assign(T.textClip(tid, at + span.start, line), {
                    duration: Math.max(0.4, span.end - span.start + 0.2), fontSize: vertical ? 34 : 30, bold: true, box: true, boxColor: '#000000',
                    y: vertical ? 0.78 : 0.86, fadeIn: 0.08, fadeOut: 0.08, anim: 'none', font: T.isArabic(line) ? 'naskh' : 'sans'
                }));
                captions += 1;
            });
        }
        app.apply(p);
        return { clipId: clip.id, seconds: media.duration, captions: captions, model: out.model };
    }

    function openReadAloud() {
        app.pause();
        const text = el('textarea', { rows: 7, placeholder: 'Type or paste what the voice should say. Each sentence can become a caption.', 'aria-label': 'Text to read aloud' });
        const voice = el('select', null, S.VOICES.map((v) => el('option', { value: v[0], text: v[1] })));
        const captions = el('input', { type: 'checkbox', checked: true });
        try { const saved = localStorage.getItem('reel.speakVoice'); if (saved) voice.value = saved; } catch (err) { /* default */ }
        app.openDialog({
            title: 'Read aloud',
            intro: 'Turns your text into a spoken voice-over at the playhead, made on this device. Each language’s voice downloads once (about 30 MB), then works offline. For the Qur’an, use a reciter instead.',
            body: [
                app.dialogField('Voice', voice), app.dialogField('Text', text),
                el('label', { className: 'check' }, [captions, 'Also add each sentence as a caption, timed to the voice']),
                el('p', { className: 'hint', text: 'Voices: Meta MMS, licence CC BY-NC 4.0 — free for non-commercial use such as da‘wah and teaching. Amharic is read from the Ge‘ez letters automatically.' })
            ],
            actions: [{ label: 'Cancel' }, {
                label: 'Make voice-over', primary: true, run: async function (d) {
                    if (!text.value.trim()) { d.status('Type something to read aloud first.'); return false; }
                    try { localStorage.setItem('reel.speakVoice', voice.value); } catch (err) { /* private mode */ }
                    d.busy(true);
                    d.status('Getting the voice ready…');
                    try {
                        const r = await readAloud({ text: text.value, voice: voice.value, captions: captions.checked, at: app.state.time }, d.status);
                        app.toast('Voice-over added (' + app.fmt(r.seconds) + ')' + (r.captions ? ' with ' + r.captions + ' captions' : '') + '. Press Space to listen.');
                    } catch (err) {
                        d.busy(false);
                        d.status(/NO_VOICE/.test(err.message) ? 'This voice is not available to download yet. Try English or another language — or record your own voice with Create ▸ Record your voice.' :
                            /fetch|network|import|load/i.test(err.message) ? 'Could not download the voice — check the internet connection.' : 'Failed: ' + err.message);
                        return false;
                    }
                    return true;
                }
            }]
        });
    }

    app.addTool({ section: 'Create', label: 'Read aloud — text to voice-over…', run: openReadAloud });
    Object.assign(window.ReelSpeak, { openReadAloud, readAloud, speak });
}());
