/*
 * Reel's timeline model: pure data and functions, no DOM.
 *
 * Every operation takes a project and returns a new one, never mutating its
 * input. That is what makes undo a matter of keeping old snapshots, and lets
 * the same code run in the browser (window.TimelineCore) and under `node
 * --test` (module.exports). It is a plain script rather than an ES module so
 * the editor still works when opened straight off disk.
 *
 * Times are seconds, as floats. A clip occupies [start, start + duration) on
 * its track; for video and audio, `in` is where in the source file it begins,
 * and `speed` is how many seconds of source play per second of timeline.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TimelineCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const FORMAT = 'reel-project';
    const VERSION = 1;

    /** The shortest a clip may be trimmed or split to. */
    const MIN_DURATION = 0.1;
    /** How long a still image or a new title lasts when first placed. */
    const DEFAULT_STILL = 5;
    /** Floating-point slack when comparing clip edges. */
    const EPS = 1e-6;
    const MIN_SPEED = 0.25;
    const MAX_SPEED = 4;

    const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0, sepia: 0, hue: 0 };

    /** A clip's effects, beyond colour: looks, transform, frame, hidden area. */
    const DEFAULT_FX = {
        look: 'none',
        tint: null,              // { color, amount 0–1 }
        vignette: 0,             // 0–1
        grain: 0,                // 0–1
        flipH: false,
        flipV: false,
        rotate: 0,               // degrees
        crop: { l: 0, r: 0, t: 0, b: 0 },   // fractions of the picture
        radius: 0,               // rounded corners, 0–1 of half the shorter side
        border: { width: 0, color: '#ffffff' },
        shadow: false,
        hide: null               // { shape: 'rect'|'oval', mode: 'blur'|'pixelate'|'solid', x, y, w, h, strength, color }
    };

    /** One-click looks: colour settings plus tint, vignette and grain. */
    const LOOKS = {
        none: { label: 'Natural', filters: {}, fx: {} },
        warm: { label: 'Warm', filters: { saturate: 115, sepia: 12, brightness: 103 }, fx: { tint: { color: '#ff9a3c', amount: 0.25 } } },
        cool: { label: 'Cool', filters: { saturate: 105, hue: -8 }, fx: { tint: { color: '#3c8cff', amount: 0.25 } } },
        golden: { label: 'Golden hour', filters: { sepia: 25, saturate: 120, brightness: 105 }, fx: { tint: { color: '#ffc04d', amount: 0.3 }, vignette: 0.25 } },
        vintage: { label: 'Vintage', filters: { sepia: 45, contrast: 90, saturate: 80, brightness: 105 }, fx: { vignette: 0.45, grain: 0.25 } },
        bw: { label: 'Black & white', filters: { grayscale: 100, contrast: 115 }, fx: {} },
        vivid: { label: 'Vivid', filters: { saturate: 150, contrast: 112 }, fx: {} },
        faded: { label: 'Faded', filters: { contrast: 80, saturate: 70, brightness: 110 }, fx: { grain: 0.1 } },
        dramatic: { label: 'Dramatic', filters: { contrast: 135, saturate: 85, brightness: 92 }, fx: { vignette: 0.6 } },
        night: { label: 'Night', filters: { brightness: 80, saturate: 70, hue: 15 }, fx: { tint: { color: '#1a3a8a', amount: 0.45 }, vignette: 0.4 } }
    };

    /** Ready-made title styles: position, size, box and entrance. */
    const TITLE_STYLES = {
        big: { label: 'Big title', patch: { fontSize: 96, bold: true, box: false, shadow: true, x: 0.5, y: 0.45, anim: 'rise', font: 'marcellus', color: '#ffffff' } },
        lower: { label: 'Lower-third bar', patch: { fontSize: 40, bold: true, box: true, boxColor: '#0f3d33', shadow: false, x: 0.5, y: 0.84, anim: 'slide', font: 'sans', color: '#ffffff' } },
        subtitle: { label: 'Subtitle', patch: { fontSize: 36, bold: true, box: true, boxColor: '#000000', shadow: false, x: 0.5, y: 0.88, anim: 'none', font: 'sans', color: '#ffffff' } },
        quote: { label: 'Quote card', patch: { fontSize: 54, bold: false, italic: true, box: false, shadow: true, x: 0.5, y: 0.5, anim: 'fade', font: 'cormorant', color: '#f3ead3' } },
        verse: { label: 'Arabic verse', patch: { fontSize: 64, bold: false, box: false, shadow: true, x: 0.5, y: 0.42, anim: 'fade', font: 'amiri', color: '#ffffff' } }
    };

    const TRANSITIONS = ['crossfade', 'dip', 'slide', 'push', 'wipe', 'zoom', 'slide-up', 'wipe-right', 'iris', 'blur'];
    const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];
    /** Entrance and exit movements any clip can make (titles, pictures, videos, drawings, stickers). */
    const MOVES = ['fade', 'rise', 'drop', 'slide', 'slide-right', 'pop', 'zoom-in', 'zoom-out', 'spin', 'flip', 'blur', 'bounce', 'swing'];
    const TEXT_ANIMS = MOVES.concat(['typewriter', 'words', 'handwrite']);
    /** Entrances that reveal a title bit by bit, and so can show a hand doing it. */
    const REVEAL_ANIMS = ['typewriter', 'words', 'handwrite'];
    const HAND_TOOLS = ['pen', 'pencil', 'finger'];
    /** How long a hand takes to leave once it has finished, in seconds. */
    const HAND_EXIT = 0.6;

    let idCounter = 0;
    function newId(prefix) {
        idCounter += 1;
        return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
            idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function clamp(v, lo, hi) {
        return Math.min(hi, Math.max(lo, v));
    }

    function round(v) {
        // Keep edges off 0.30000000000000004 so they compare and display cleanly.
        return Math.round(v * 1e6) / 1e6;
    }

    function smooth(u) {
        const x = clamp(u, 0, 1);
        return x * x * (3 - 2 * x);
    }

    function easeOut(u) {
        const x = clamp(u, 0, 1);
        return 1 - Math.pow(1 - x, 3);
    }

    /* ---------------------------------------------------------------- project */

    function createProject(options) {
        const o = options || {};
        return {
            format: FORMAT,
            version: VERSION,
            name: o.name || 'Untitled project',
            width: o.width || 1280,
            height: o.height || 720,
            fps: o.fps || 30,
            background: o.background || '#000000',
            // How far ducked tracks drop while someone is speaking (a gain).
            duckAmount: o.duckAmount === undefined ? 0.25 : o.duckAmount,
            // Listed top to bottom as the timeline shows them. Upper video
            // tracks are drawn over lower ones, as in any editor.
            tracks: o.tracks || [
                { id: 'T1', kind: 'text', name: 'Titles', muted: false, hidden: false },
                { id: 'V2', kind: 'video', name: 'Overlay', muted: false, hidden: false },
                { id: 'V1', kind: 'video', name: 'Video', muted: false, hidden: false },
                { id: 'A1', kind: 'audio', name: 'Audio', muted: false, hidden: false, duck: false }
            ],
            media: [],
            clips: [],
            markers: []
        };
    }

    function addMedia(project, media) {
        const p = clone(project);
        p.media.push(Object.assign({ id: newId('m') }, media));
        return p;
    }

    function getMedia(project, id) {
        return project.media.find((m) => m.id === id) || null;
    }

    function getClip(project, id) {
        return project.clips.find((c) => c.id === id) || null;
    }

    function getTrack(project, id) {
        return project.tracks.find((t) => t.id === id) || null;
    }

    /** Adds a track of a kind, above the others of that kind. */
    function addTrack(project, kind, name) {
        const p = clone(project);
        const prefix = { video: 'V', audio: 'A', text: 'T' }[kind];
        if (!prefix) throw new Error('Unknown track kind: ' + kind);
        let n = 1;
        while (p.tracks.some((t) => t.id === prefix + n)) n += 1;
        const names = { video: 'Video', audio: 'Audio', text: 'Titles' };
        const track = { id: prefix + n, kind: kind, name: name || names[kind] + ' ' + n, muted: false, hidden: false };
        if (kind === 'audio') track.duck = false;
        const firstOfKind = p.tracks.findIndex((t) => t.kind === kind);
        if (firstOfKind === -1) {
            // Keep the conventional order: titles, video, audio.
            const order = ['text', 'video', 'audio'];
            const at = p.tracks.findIndex((t) => order.indexOf(t.kind) > order.indexOf(kind));
            p.tracks.splice(at === -1 ? p.tracks.length : at, 0, track);
        } else {
            p.tracks.splice(firstOfKind, 0, track);
        }
        return p;
    }

    /** The id the next addTrack(kind) will use. */
    function nextTrackId(project, kind) {
        const prefix = { video: 'V', audio: 'A', text: 'T' }[kind];
        let n = 1;
        while (project.tracks.some((t) => t.id === prefix + n)) n += 1;
        return prefix + n;
    }

    function updateTrack(project, id, patch) {
        const p = clone(project);
        const t = p.tracks.find((x) => x.id === id);
        if (t) Object.assign(t, patch);
        return p;
    }

    /** A track can be removed only when it is empty and not its kind's last. */
    function removeTrack(project, id) {
        const t = getTrack(project, id);
        if (!t) return project;
        if (project.clips.some((c) => c.track === id)) return project;
        if (project.tracks.filter((x) => x.kind === t.kind).length < 2) return project;
        const p = clone(project);
        p.tracks = p.tracks.filter((x) => x.id !== id);
        return p;
    }

    /* ------------------------------------------------------------------ clips */

    /** True for clips made in the editor — titles and drawings — that have no media file. */
    function isGenerated(clip) {
        return clip.type === 'text' || clip.type === 'draw';
    }

    /** What a clip is: 'video', 'image', 'audio' or 'text' (titles and drawings). */
    function clipKind(project, clip) {
        if (isGenerated(clip)) return 'text';
        if (clip.audioOnly) return 'audio';
        const m = getMedia(project, clip.mediaId);
        return m ? m.type : 'video';
    }

    /** Which track kind a clip of this kind belongs on. */
    function trackKindFor(kind) {
        if (kind === 'text') return 'text';
        if (kind === 'audio') return 'audio';
        return 'video';
    }

    /** True for clips whose source plays through time: video and audio, not freeze frames. */
    function isTimed(project, clip) {
        if (isGenerated(clip) || clip.freeze) return false;
        const k = clipKind(project, clip);
        return k === 'video' || k === 'audio';
    }

    function speedOf(clip) {
        return clip.speed > 0 ? clip.speed : 1;
    }

    function clipEnd(clip) {
        return round(clip.start + clip.duration);
    }

    function trackClips(project, trackId, excludeId) {
        return project.clips
            .filter((c) => c.track === trackId && c.id !== excludeId)
            .sort((a, b) => a.start - b.start);
    }

    function trackEnd(project, trackId) {
        return trackClips(project, trackId).reduce((end, c) => Math.max(end, clipEnd(c)), 0);
    }

    function projectDuration(project) {
        return project.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
    }

    function overlaps(aStart, aEnd, bStart, bEnd) {
        return aStart < bEnd - EPS && bStart < aEnd - EPS;
    }

    function isFree(project, trackId, start, duration, excludeId) {
        if (start < -EPS) return false;
        const end = start + duration;
        const skip = Array.isArray(excludeId) ? excludeId : [excludeId];
        return !project.clips
            .filter((c) => c.track === trackId && skip.indexOf(c.id) === -1)
            .some((c) => overlaps(start, end, c.start, clipEnd(c)));
    }

    /**
     * The start nearest `wanted` where a clip of `duration` fits on the track
     * without overlapping anything, or null if nothing is near enough. Clips
     * never overlap on a track; dropping onto one slides to the closest gap.
     */
    function findFreeStart(project, trackId, wanted, duration, excludeId) {
        const others = trackClips(project, trackId, excludeId);
        const candidates = [Math.max(0, wanted)];
        others.forEach(function (c) {
            candidates.push(clipEnd(c));
            candidates.push(c.start - duration);
        });
        let best = null;
        candidates.forEach(function (s) {
            s = round(s);
            if (!isFree(project, trackId, s, duration, excludeId)) return;
            if (best === null || Math.abs(s - wanted) < Math.abs(best - wanted)) best = s;
        });
        return best;
    }

    /**
     * Defaults for a clip made from a media item. Video and audio start at the
     * top of the file and run its full length; stills last DEFAULT_STILL.
     */
    function clipFromMedia(media, trackId, start) {
        const bounded = media.type === 'video' || media.type === 'audio';
        const clip = {
            id: newId('c'),
            type: 'media',
            mediaId: media.id,
            track: trackId,
            start: start || 0,
            duration: round(bounded ? media.duration : DEFAULT_STILL),
            in: 0,
            speed: 1,
            volume: 1,
            muted: false,
            fadeIn: 0,
            fadeOut: 0
        };
        if (media.type !== 'audio') {
            Object.assign(clip, {
                fit: 'contain',
                scale: 1,
                x: 0.5,
                y: 0.5,
                opacity: 1,
                bgFill: 'none',
                motion: null,
                filters: clone(DEFAULT_FILTERS)
            });
        }
        return clip;
    }

    function textClip(trackId, start, text) {
        return {
            id: newId('c'),
            type: 'text',
            track: trackId,
            start: start || 0,
            duration: DEFAULT_STILL,
            text: text === undefined ? 'Your title' : text,
            font: 'sans',
            fontSize: 72,
            bold: true,
            italic: false,
            color: '#ffffff',
            align: 'center',
            box: false,
            boxColor: '#000000',
            shadow: true,
            x: 0.5,
            y: 0.5,
            opacity: 1,
            fadeIn: 0.3,
            fadeOut: 0.3,
            anim: 'none',
            animDuration: 0.6,
            hand: 'none',
            handStyle: 'realistic',
            handSkin: 'medium',
            handSize: 1,
            penColor: null
        };
    }

    /**
     * A drawing: freehand strokes and shapes, drawn on over time by default
     * with a hand holding a pencil. Each stroke is
     * `{ color, width, alpha, points: [x0, y0, x1, y1, …] }`, with points as
     * shares of the frame and widths in pixels of a 720-line frame.
     */
    function drawClip(trackId, start, strokes) {
        return {
            id: newId('c'),
            type: 'draw',
            track: trackId,
            start: start || 0,
            duration: 6,
            strokes: clone(strokes || []),
            x: 0.5,
            y: 0.5,
            scale: 1,
            opacity: 1,
            fadeIn: 0,
            fadeOut: 0.3,
            anim: 'draw',
            animDuration: 3,
            hand: 'pen',
            handStyle: 'realistic',
            handSkin: 'medium',
            handSize: 1,
            penColor: null
        };
    }

    /**
     * Places a clip. If its spot is taken it slides to the nearest free one,
     * and if the track is the wrong kind for it, nothing changes.
     */
    function addClip(project, clip) {
        const track = getTrack(project, clip.track);
        if (!track || track.kind !== trackKindFor(clipKind(project, clip))) return project;
        const start = findFreeStart(project, clip.track, clip.start, clip.duration, null);
        if (start === null) return project;
        const p = clone(project);
        p.clips.push(Object.assign(clone(clip), { start: start }));
        return p;
    }

    /** Appends a media item to the end of the first track that takes it. */
    function appendMedia(project, mediaId, trackId) {
        const media = getMedia(project, mediaId);
        if (!media) return project;
        const kind = trackKindFor(media.type);
        const track = trackId ? getTrack(project, trackId) : lowestTrack(project, kind);
        if (!track || track.kind !== kind) return project;
        return addClip(project, clipFromMedia(media, track.id, trackEnd(project, track.id)));
    }

    /**
     * The main track of a kind: the bottom video track (the base layer), the
     * top audio track, the top titles track.
     */
    function lowestTrack(project, kind) {
        const tracks = project.tracks.filter((t) => t.kind === kind);
        if (!tracks.length) return null;
        return kind === 'video' ? tracks[tracks.length - 1] : tracks[0];
    }

    function updateClip(project, id, patch) {
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        if (!c) return project;
        if (c.keys && c.keys.length && !('keys' in patch)) {
            // Moving or resizing a clip with keyframes moves or resizes its whole path.
            const dx = 'x' in patch ? patch.x - (c.x === undefined ? 0.5 : c.x) : 0;
            const dy = 'y' in patch ? patch.y - (c.y === undefined ? 0.5 : c.y) : 0;
            const ks = 'scale' in patch && (c.scale || 1) ? patch.scale / (c.scale || 1) : 1;
            if (dx || dy || ks !== 1) {
                c.keys = c.keys.map((k) => Object.assign({}, k, {
                    x: k.x === undefined ? k.x : round(k.x + dx), y: k.y === undefined ? k.y : round(k.y + dy),
                    scale: k.scale === undefined ? k.scale : round(k.scale * ks)
                }));
            }
        }
        Object.keys(patch).forEach(function (k) {
            if (k === 'filters') c.filters = Object.assign({}, c.filters || DEFAULT_FILTERS, patch.filters);
            else if (k === 'fx') c.fx = mergeFx(c.fx, patch.fx);
            else if (k !== 'id') c[k] = patch[k];
        });
        return p;
    }

    /** The same patch applied to several clips at once. */
    function updateClips(project, ids, patch) {
        let p = project;
        ids.forEach(function (id) { p = updateClip(p, id, patch); });
        return p;
    }

    /**
     * Moves a clip to a new start and, optionally, another track of the right
     * kind. If the spot is taken it slides to the nearest gap; if there is
     * none, or the track is the wrong kind, nothing changes.
     */
    function moveClip(project, id, start, trackId) {
        const clip = getClip(project, id);
        if (!clip) return project;
        const target = trackId || clip.track;
        const track = getTrack(project, target);
        if (!track || track.kind !== trackKindFor(clipKind(project, clip))) return project;
        const at = findFreeStart(project, target, round(Math.max(0, start)), clip.duration, id);
        if (at === null) return project;
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        c.start = at;
        c.track = target;
        return p;
    }

    /**
     * Shifts several clips by the same amount, keeping their spacing. The
     * whole move is refused if any of them would land on another clip, and
     * the shift is clamped so none goes before zero.
     */
    function moveClips(project, ids, delta) {
        const moving = project.clips.filter((c) => ids.indexOf(c.id) !== -1);
        if (!moving.length) return project;
        const earliest = Math.min.apply(null, moving.map((c) => c.start));
        const d = Math.max(delta, -earliest);
        if (Math.abs(d) < EPS) return project;
        const ok = moving.every((c) => isFree(project, c.track, c.start + d, c.duration, ids));
        if (!ok) return project;
        const p = clone(project);
        p.clips.forEach(function (c) { if (ids.indexOf(c.id) !== -1) c.start = round(c.start + d); });
        return p;
    }

    /** How far a clip's source can stretch: Infinity for stills, titles and freeze frames. */
    function sourceLength(project, clip) {
        if (clip.freeze) return Infinity;
        const kind = clipKind(project, clip);
        if (kind === 'video' || kind === 'audio') {
            const m = getMedia(project, clip.mediaId);
            return m && m.duration ? m.duration : (clip.in || 0) + clip.duration * speedOf(clip);
        }
        return Infinity;
    }

    /**
     * Drags one edge of a clip to `time`, keeping the other edge still. It
     * stops at the neighbouring clip, at the start or end of the source file,
     * and at MIN_DURATION.
     */
    function trimClip(project, id, edge, time) {
        const clip = getClip(project, id);
        if (!clip) return project;
        const others = trackClips(project, clip.track, id);
        const end = clipEnd(clip);
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        const bounded = isTimed(project, clip);
        const speed = speedOf(clip);

        if (edge === 'start') {
            const prevEnd = others.filter((o) => clipEnd(o) <= clip.start + EPS)
                .reduce((m, o) => Math.max(m, clipEnd(o)), 0);
            let lo = prevEnd;
            if (bounded) lo = Math.max(lo, clip.start - (clip.in || 0) / speed);
            const hi = end - MIN_DURATION;
            const s = round(clamp(time, lo, hi));
            const delta = s - clip.start;
            c.start = s;
            c.duration = round(end - s);
            if (!isGenerated(clip) && !clip.freeze) c.in = round(Math.max(0, (clip.in || 0) + delta * speed));
            // Keyframes stay where they were in time.
            if (c.keys) c.keys = c.keys.map((k) => Object.assign({}, k, { t: round(k.t - delta) }));
        } else if (edge === 'end') {
            const nextStart = others.filter((o) => o.start >= end - EPS)
                .reduce((m, o) => Math.min(m, o.start), Infinity);
            const hi = Math.min(nextStart, clip.start + (sourceLength(project, clip) - (clip.in || 0)) / speed);
            const e = clamp(time, clip.start + MIN_DURATION, hi);
            c.duration = round(e - clip.start);
        } else {
            return project;
        }
        const room = c.duration;
        c.fadeIn = Math.min(c.fadeIn || 0, room);
        c.fadeOut = Math.min(c.fadeOut || 0, room);
        return p;
    }

    /**
     * Cuts a clip in two at `time`. The left half keeps the fade-in, the right
     * half the fade-out. Returns the project unchanged if `time` is too close
     * to either edge to leave two clips of MIN_DURATION.
     */
    function splitClip(project, id, time) {
        const clip = getClip(project, id);
        if (!clip) return project;
        const end = clipEnd(clip);
        if (time <= clip.start + MIN_DURATION - EPS || time >= end - MIN_DURATION + EPS) return project;
        const p = clone(project);
        const left = p.clips.find((x) => x.id === id);
        const right = clone(left);
        right.id = newId('c');
        const offset = round(time - clip.start);
        left.duration = offset;
        left.fadeOut = 0;
        left.fadeIn = Math.min(left.fadeIn || 0, offset);
        right.start = round(time);
        right.duration = round(end - time);
        right.fadeIn = 0;
        right.fadeOut = Math.min(right.fadeOut || 0, right.duration);
        right.transition = null;
        if (!isGenerated(right) && !right.freeze) right.in = round((clip.in || 0) + offset * speedOf(clip));
        if (clip.keys && clip.keys.length) {
            // Each half keeps its part of the animation, with a keyframe at the cut so nothing jumps.
            const atCut = Object.assign({ t: offset }, keyframeAt(clip, time));
            left.keys = clip.keys.filter((k) => k.t < offset - EPS).concat([atCut]);
            right.keys = [Object.assign({}, atCut, { t: 0 })].concat(clip.keys.filter((k) => k.t > offset + EPS)
                .map((k) => Object.assign({}, k, { t: round(k.t - offset) })));
        }
        p.clips.splice(p.clips.indexOf(left) + 1, 0, right);
        return p;
    }

    /**
     * The part of a project between `from` and `to`, as a project of its own
     * starting at 0: clips are trimmed to the range (their source, keyframes
     * and fades with them) and markers outside it are dropped.
     */
    function excerpt(project, from, to) {
        const p = clone(project);
        const a = Math.max(0, from);
        const b = Math.max(a + MIN_DURATION, to);
        p.clips = p.clips.filter((c) => c.start < b - EPS && clipEnd(c) > a + EPS).map(function (c) {
            const cut = Math.max(0, a - c.start);
            const end = Math.min(clipEnd(c), b);
            if (cut > 0) {
                if (!isGenerated(c) && !c.freeze) c.in = round((c.in || 0) + cut * speedOf(c));
                if (c.keys) c.keys = c.keys.map((k) => Object.assign({}, k, { t: round(k.t - cut) }));
                c.transition = null;
                c.fadeIn = 0;
            }
            c.start = round(Math.max(c.start, a) - a);
            c.duration = round(end - a - c.start);
            if (end < clipEnd(project.clips.find((x) => x.id === c.id))) c.fadeOut = Math.min(c.fadeOut || 0, 0.3);
            return c;
        });
        p.markers = (p.markers || []).filter((m) => m.time >= a && m.time < b).map((m) => Object.assign({}, m, { time: round(m.time - a) }));
        return p;
    }

    /** Opens a gap: every clip and marker from `at` on moves `seconds` later. */
    function insertTime(project, at, seconds) {
        const p = clone(project);
        p.clips.forEach(function (c) { if (c.start >= at - EPS) c.start = round(c.start + seconds); });
        (p.markers || []).forEach(function (m) { if (m.time >= at - EPS) m.time = round(m.time + seconds); });
        return p;
    }

    /**
     * Closes the time between `from` and `to`: what lies there is removed and
     * everything after moves left. A clip crossing the span is cut in two and
     * joined up (a jump cut); one starting or ending inside it is trimmed.
     */
    function removeTime(project, from, to) {
        const a = Math.max(0, Math.min(from, to));
        const b = Math.max(from, to);
        const gap = round(b - a);
        if (!(gap > EPS)) return project;
        let p = project;
        p.clips.filter((c) => c.start < a - EPS && clipEnd(c) > b + EPS && !isGenerated(c))
            .forEach(function (c) { p = splitClip(p, c.id, b); });
        p = clone(p);
        const out = [];
        p.clips.forEach(function (c) {
            const end = clipEnd(c);
            if (end <= a + EPS) { out.push(c); return; }
            if (c.start >= b - EPS) { c.start = round(c.start - gap); out.push(c); return; }
            if (c.start < a - EPS) {
                // Starts before: keep up to the span, or shorten a title across it.
                c.duration = round(end > b ? c.duration - gap : a - c.start);
                c.fadeOut = Math.min(c.fadeOut || 0, c.duration);
                if (c.keys) c.keys = c.keys.filter((k) => k.t <= c.duration + EPS);
                out.push(c);
                return;
            }
            if (end > b + EPS) {
                // Starts inside: its first part goes.
                const cut = b - c.start;
                if (!isGenerated(c) && !c.freeze) c.in = round((c.in || 0) + cut * speedOf(c));
                if (c.keys) c.keys = c.keys.filter((k) => k.t >= cut - EPS).map((k) => Object.assign({}, k, { t: round(k.t - cut) }));
                c.start = round(a);
                c.duration = round(end - b);
                c.fadeIn = 0;
                c.transition = null;
                out.push(c);
            }
            // Wholly inside: removed.
        });
        p.clips = out;
        p.markers = (p.markers || []).filter((m) => m.time < a - EPS || m.time >= b - EPS)
            .map((m) => (m.time >= b - EPS ? Object.assign({}, m, { time: round(m.time - gap) }) : m));
        return p;
    }

    /* ---------------------------------------------------------------- pauses */

    /**
     * Quiet stretches in a sound, from its waveform `peaks` (`rate` per
     * second): [{ start, end }] in source seconds. A pause is at least
     * `minPause` long; quiet means under `threshold`, which by default sits a
     * little above the sound's own background level, so it works for a quiet
     * room and a noisy one. `sensitivity` 0–1 raises it (more pauses).
     */
    function findPauses(peaks, rate, options) {
        const o = Object.assign({ minPause: 0.3, sensitivity: 0.5, from: 0, to: Infinity }, options);
        if (!peaks || !peaks.length || !rate) return [];
        const i0 = Math.max(0, Math.floor(o.from * rate));
        const i1 = Math.min(peaks.length, Math.ceil(Math.min(o.to, peaks.length / rate) * rate));
        if (i1 - i0 < 2) return [];
        // Smooth over ~40 ms so the gaps between syllables don't count.
        const win = Math.max(1, Math.round(rate * 0.04));
        const level = new Float32Array(i1 - i0);
        for (let i = i0; i < i1; i += 1) {
            let m = 0;
            for (let k = Math.max(i0, i - win); k <= Math.min(i1 - 1, i + win); k += 1) if (peaks[k] > m) m = peaks[k];
            level[i - i0] = m;
        }
        let thr = o.threshold;
        if (thr == null) {
            const sorted = Array.from(level).sort((x, y) => x - y);
            const floor = sorted[Math.floor(sorted.length * 0.05)];
            const loud = sorted[Math.floor(sorted.length * 0.9)];
            thr = Math.max(0.005, floor + (loud - floor) * (0.06 + 0.24 * clamp(o.sensitivity, 0, 1)));
        }
        const pauses = [];
        let runStart = -1;
        for (let i = 0; i <= level.length; i += 1) {
            const quiet = i < level.length && level[i] < thr;
            if (quiet && runStart < 0) runStart = i;
            if (!quiet && runStart >= 0) {
                const s = (i0 + runStart) / rate;
                const e = (i0 + i) / rate;
                if (e - s >= o.minPause - EPS) pauses.push({ start: round(s), end: round(e) });
                runStart = -1;
            }
        }
        return pauses;
    }

    /** The stretches with sound between the pauses, within `from`–`to`: [{ start, end }]. */
    function speechSegments(pauses, from, to, minLength) {
        const out = [];
        let at = from;
        pauses.forEach(function (q) {
            if (q.end <= from || q.start >= to) return;
            if (q.start > at) out.push({ start: round(at), end: round(Math.min(q.start, to)) });
            at = Math.max(at, q.end);
        });
        if (to > at) out.push({ start: round(at), end: round(to) });
        return out.filter((s) => s.end - s.start >= (minLength || 0.15));
    }

    /**
     * Where to cut between `from` and `to`: the middle of each pause, keeping
     * every piece at least `minScene` long (a short piece joins the next).
     */
    function pauseCuts(pauses, from, to, minScene) {
        const min = minScene || 1;
        const cuts = [];
        let last = from;
        pauses.forEach(function (q) {
            const t = round((q.start + q.end) / 2);
            if (t - last >= min - EPS && to - t >= Math.min(min, 0.5) - EPS && t > from && t < to) {
                cuts.push(t);
                last = t;
            }
        });
        return cuts;
    }

    /** Pauses of a clip's source, as timeline times (clipped to the clip). */
    function clipPauses(clip, peaks, rate, options) {
        const sp = speedOf(clip);
        const inPt = clip.in || 0;
        const srcTo = inPt + clip.duration * sp;
        return findPauses(peaks, rate, Object.assign({}, options, { from: inPt, to: srcTo, minPause: ((options && options.minPause) || 0.3) * sp }))
            .map((q) => ({ start: round(clip.start + (q.start - inPt) / sp), end: round(clip.start + (q.end - inPt) / sp) }));
    }

    /** Splits a clip at each of `times` (timeline seconds). Returns { project, ids } of the pieces. */
    function cutAt(project, id, times) {
        let p = project;
        let cur = id;
        const ids = [id];
        times.slice().sort((x, y) => x - y).forEach(function (t) {
            const before = p;
            p = splitClip(p, cur, t);
            if (p !== before) {
                cur = p.clips[p.clips.findIndex((c) => c.id === cur) + 1].id;
                ids.push(cur);
            }
        });
        return { project: p, ids: ids };
    }

    /**
     * Jump cuts: takes the pauses out of a clip and closes them up across the
     * whole project, keeping `pad` seconds of quiet each side so words are not
     * clipped. Pauses shorter than 2 × pad + `minPause` stay.
     */
    function removePauses(project, pauses, pad) {
        const keep = pad == null ? 0.12 : pad;
        let p = project;
        pauses.slice().sort((x, y) => y.start - x.start).forEach(function (q) {
            const a = q.start + keep;
            const b = q.end - keep;
            if (b - a > MIN_DURATION) p = removeTime(p, a, b);
        });
        return p;
    }

    /** Splits every clip under the playhead, or only those listed. */
    function splitAt(project, time, ids) {
        let p = project;
        activeClips(project, time)
            .filter((c) => !ids || !ids.length || ids.indexOf(c.id) !== -1)
            .forEach(function (c) { p = splitClip(p, c.id, time); });
        return p;
    }

    /**
     * Removes clips. With `ripple`, everything after each removed clip on the
     * same track moves left to close the gap.
     */
    function deleteClips(project, ids, ripple) {
        const p = clone(project);
        const removed = p.clips.filter((c) => ids.indexOf(c.id) !== -1)
            .sort((a, b) => b.start - a.start);
        removed.forEach(function (r) {
            p.clips = p.clips.filter((c) => c.id !== r.id);
            if (!ripple) return;
            p.clips.forEach(function (c) {
                if (c.track === r.track && c.start >= clipEnd(r) - EPS) c.start = round(c.start - r.duration);
            });
        });
        return p;
    }

    /** Copies a clip into the nearest gap after it on the same track. */
    function duplicateClip(project, id) {
        const clip = getClip(project, id);
        if (!clip) return { project: project, id: null };
        const copy = Object.assign(clone(clip), { id: newId('c'), transition: null });
        const at = findFreeStart(project, clip.track, clipEnd(clip), clip.duration, null);
        let start = at;
        if (start === null || start < clipEnd(clip) - EPS) start = trackEnd(project, clip.track);
        copy.start = start;
        const p = clone(project);
        p.clips.push(copy);
        return { project: p, id: copy.id };
    }

    /** What Ctrl+C keeps: the clips, and where the earliest of them started. */
    function copyClips(project, ids) {
        const clips = project.clips.filter((c) => ids.indexOf(c.id) !== -1).map(clone);
        if (!clips.length) return null;
        return { clips: clips, base: Math.min.apply(null, clips.map((c) => c.start)) };
    }

    /**
     * Pastes copied clips with their spacing kept, the earliest at `time`.
     * Each goes on its own track when that still exists, else its kind's main
     * track, sliding to the nearest gap if its spot is taken.
     */
    function pasteClips(project, clipboard, time) {
        let p = project;
        const ids = [];
        if (!clipboard) return { project: p, ids: ids };
        clipboard.clips.forEach(function (src) {
            if (!isGenerated(src) && !getMedia(p, src.mediaId)) return;
            const copy = Object.assign(clone(src), { id: newId('c'), transition: null });
            copy.start = round(time + (src.start - clipboard.base));
            const kind = trackKindFor(clipKind(p, copy));
            const own = getTrack(p, copy.track);
            if (!own || own.kind !== kind) {
                const t = lowestTrack(p, kind);
                if (!t) return;
                copy.track = t.id;
            }
            const next = addClip(p, copy);
            if (next !== p) { p = next; ids.push(copy.id); }
        });
        return { project: p, ids: ids };
    }

    /* ------------------------------------------------------- speed and freeze */

    /**
     * Plays a clip faster or slower. Its in-point stays; its length changes
     * to cover the same source, stopping short of the next clip and the end
     * of the file.
     */
    function setSpeed(project, id, speed) {
        const clip = getClip(project, id);
        if (!clip || !isTimed(project, clip)) return project;
        const s = clamp(speed, MIN_SPEED, MAX_SPEED);
        const span = clip.duration * speedOf(clip);
        const nextStart = trackClips(project, clip.track, id)
            .filter((o) => o.start >= clipEnd(clip) - EPS)
            .reduce((m, o) => Math.min(m, o.start), Infinity);
        const maxBySource = (sourceLength(project, clip) - (clip.in || 0)) / s;
        const duration = round(Math.max(MIN_DURATION, Math.min(span / s, nextStart - clip.start, maxBySource)));
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        c.speed = round(s);
        c.duration = duration;
        c.fadeIn = Math.min(c.fadeIn || 0, duration);
        c.fadeOut = Math.min(c.fadeOut || 0, duration);
        return p;
    }

    /**
     * Holds the frame under the playhead for `hold` seconds: the video is
     * split there, a still of that frame is inserted, and everything after
     * it on the track moves along to make room.
     */
    function freezeFrame(project, id, time, hold) {
        const clip = getClip(project, id);
        const len = hold > 0 ? hold : 2;
        if (!clip || clipKind(project, clip) !== 'video' || clip.freeze || clip.audioOnly) return { project: project, id: null };
        if (time < clip.start - EPS || time > clipEnd(clip) + EPS) return { project: project, id: null };
        const frameAt = clamp(sourceTime(clip, Math.min(time, clipEnd(clip) - 1e-3)), 0, sourceLength(project, clip));
        // Too near an edge to split: hold at that edge instead.
        let at = time;
        if (at < clip.start + MIN_DURATION) at = clip.start;
        else if (at > clipEnd(clip) - MIN_DURATION) at = clipEnd(clip);
        let p = splitClip(project, id, at);
        p = clone(p);
        p.clips.forEach(function (c) {
            if (c.track === clip.track && c.start >= at - EPS) c.start = round(c.start + len);
        });
        const still = Object.assign(clone(clip), {
            id: newId('c'), start: round(at), duration: round(len), in: round(frameAt),
            speed: 1, freeze: true, muted: true, fadeIn: 0, fadeOut: 0, transition: null, motion: null
        });
        p.clips.push(still);
        return { project: p, id: still.id };
    }

    /**
     * Moves a video clip's sound to its own clip on an audio track (adding a
     * track if none is free), and mutes the original.
     */
    function detachAudio(project, id) {
        const clip = getClip(project, id);
        if (!clip || clipKind(project, clip) !== 'video' || clip.freeze) return { project: project, id: null };
        let p = project;
        let track = p.tracks.find((t) => t.kind === 'audio' && isFree(p, t.id, clip.start, clip.duration, null));
        if (!track) {
            const tid = nextTrackId(p, 'audio');
            p = addTrack(p, 'audio');
            track = getTrack(p, tid);
        }
        const sound = {
            id: newId('c'), type: 'media', mediaId: clip.mediaId, track: track.id, audioOnly: true,
            start: clip.start, duration: clip.duration, in: clip.in || 0, speed: speedOf(clip),
            volume: clip.volume === undefined ? 1 : clip.volume, muted: false,
            fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0
        };
        p = clone(p);
        p.clips.push(sound);
        p.clips.find((c) => c.id === id).muted = true;
        return { project: p, id: sound.id };
    }

    /* ------------------------------------------------------------ transitions */

    /** The clip that ends exactly where this one starts on its track, if any. */
    function previousAdjacent(project, clip) {
        return trackClips(project, clip.track, clip.id)
            .find((o) => Math.abs(clipEnd(o) - clip.start) < 1e-3) || null;
    }

    /**
     * The window over which a clip's incoming transition runs: centred on
     * the cut, and no longer than either clip. Null if it has none or there
     * is no clip right before it.
     */
    function transitionWindow(project, clip) {
        const tr = clip.transition;
        if (!tr || !tr.type || !(tr.duration > 0)) return null;
        const from = previousAdjacent(project, clip);
        if (!from) return null;
        const d = Math.min(tr.duration, clip.duration, from.duration);
        return { from: from, to: clip, type: tr.type, start: clip.start - d / 2, end: clip.start + d / 2, duration: d };
    }

    /** The transition running on a track at `time`, with its 0–1 progress, or null. */
    function transitionAt(project, trackId, time) {
        const clips = trackClips(project, trackId);
        for (let i = 0; i < clips.length; i += 1) {
            const w = transitionWindow(project, clips[i]);
            if (w && time >= w.start - EPS && time < w.end - EPS) {
                return Object.assign(w, { progress: clamp((time - w.start) / w.duration, 0, 1) });
            }
        }
        return null;
    }

    function setTransition(project, id, type, duration) {
        if (!type || type === 'none') return updateClip(project, id, { transition: null });
        return updateClip(project, id, { transition: { type: type, duration: duration > 0 ? duration : 1 } });
    }

    /** Puts the same transition on every cut between touching clips on visual and audio tracks. */
    function transitionAllCuts(project, type, duration) {
        let p = project;
        project.clips.forEach(function (c) {
            if (previousAdjacent(project, c)) p = setTransition(p, c.id, type, duration);
        });
        return p;
    }

    /* --------------------------------------------------------------- playback */

    /** Clips under the playhead, in no particular order. */
    function activeClips(project, time) {
        return project.clips.filter((c) => c.start <= time + EPS && time < clipEnd(c) - EPS);
    }

    /** Where in its source file a clip is at timeline time `time`. */
    function sourceTime(clip, time) {
        if (clip.freeze) return clip.in || 0;
        return (clip.in || 0) + (time - clip.start) * speedOf(clip);
    }

    /** 0–1 envelope from the clip's fade-in and fade-out at `time`. */
    function fadeAt(clip, time) {
        const local = time - clip.start;
        const remaining = clipEnd(clip) - time;
        let a = 1;
        if (clip.fadeIn > 0 && local < clip.fadeIn) a = Math.min(a, local / clip.fadeIn);
        if (clip.fadeOut > 0 && remaining < clip.fadeOut) a = Math.min(a, remaining / clip.fadeOut);
        return clamp(a, 0, 1);
    }

    /** Fade for a clip that may be shown a little past its edges by a transition. */
    function edgeFade(clip, time) {
        return fadeAt(clip, clamp(time, clip.start, clipEnd(clip) - 1e-3));
    }

    /**
     * How the two sides of a transition are weighted at `progress`: `from`
     * and `to` are 0–1 opacities (and gains, for sound).
     */
    function transitionMix(type, progress) {
        if (type === 'dip') return { from: clamp(1 - 2 * progress, 0, 1), to: clamp(2 * progress - 1, 0, 1) };
        if (type === 'crossfade' || type === 'zoom' || type === 'blur') return { from: 1 - progress, to: progress };
        // Slides and wipes move the pictures instead; the sound still crossfades.
        return { from: 1, to: 1, soundFrom: 1 - progress, soundTo: progress };
    }

    /**
     * What to draw at `time`, bottom layer first: one entry per visible video
     * track with a clip under the playhead (two during a transition), then
     * the titles on top.
     */
    function renderLayers(project, time) {
        const active = activeClips(project, time);
        const layers = [];
        const tracks = project.tracks.slice().reverse();
        ['video', 'text'].forEach(function (kind) {
            tracks.filter((t) => t.kind === kind && !t.hidden).forEach(function (t) {
                const tr = transitionAt(project, t.id, time);
                if (tr) {
                    const mix = transitionMix(tr.type, tr.progress);
                    [['from', tr.from, mix.from], ['to', tr.to, mix.to]].forEach(function (side) {
                        const c = side[1];
                        const k = clipKind(project, c);
                        if (k === 'audio') return;
                        layers.push({
                            clip: c, kind: k,
                            alpha: edgeFade(c, time) * (c.opacity === undefined ? 1 : c.opacity) * side[2],
                            transition: { type: tr.type, progress: tr.progress, role: side[0] }
                        });
                    });
                    return;
                }
                active.filter((c) => c.track === t.id).forEach(function (c) {
                    const k = clipKind(project, c);
                    if (k === 'audio') return;
                    layers.push({ clip: c, kind: k, alpha: fadeAt(c, time) * (c.opacity === undefined ? 1 : c.opacity) });
                });
            });
        });
        return layers;
    }

    /**
     * Every clip whose source should be positioned at `time` — those under
     * the playhead plus both sides of any running transition — with the time
     * in the source, clamped inside the file.
     */
    function mediaAt(project, time) {
        const seen = new Set();
        const out = [];
        function add(c) {
            if (seen.has(c.id) || isGenerated(c)) return;
            const kind = clipKind(project, c);
            if (kind === 'image') return;
            seen.add(c.id);
            const len = sourceLength(project, c);
            const src = clamp(sourceTime(c, time), 0, isFinite(len) ? Math.max(0, len - 0.04) : Infinity);
            out.push({ clip: c, sourceTime: src, playing: isTimed(project, c), inside: c.start <= time + EPS && time < clipEnd(c) - EPS });
        }
        project.tracks.forEach(function (t) {
            const tr = transitionAt(project, t.id, time);
            if (tr) { add(tr.from); add(tr.to); }
        });
        activeClips(project, time).forEach(add);
        return out;
    }

    /**
     * Clips whose sound should be playing at `time`, with their gain. Pass
     * `duck` (a function of time returning a gain) to lower ducked tracks.
     */
    function audibleClips(project, time, duck) {
        const out = [];
        const seen = new Set();
        function push(c, weight) {
            if (seen.has(c.id) || !isTimed(project, c)) return;
            const track = getTrack(project, c.track);
            if (!track || track.muted || c.muted) return;
            seen.add(c.id);
            let gain = (c.volume === undefined ? 1 : c.volume) * edgeFade(c, time) * weight;
            if (duck && track.duck) gain *= duck(time);
            out.push({ clip: c, gain: gain });
        }
        project.tracks.forEach(function (t) {
            const tr = transitionAt(project, t.id, time);
            if (!tr) return;
            const mix = transitionMix(tr.type, tr.progress);
            push(tr.from, mix.soundFrom === undefined ? mix.from : mix.soundFrom);
            push(tr.to, mix.soundTo === undefined ? mix.to : mix.soundTo);
        });
        activeClips(project, time).forEach(function (c) { push(c, 1); });
        return out;
    }

    /** The clip that starts exactly where this one ends on its track, if any. */
    function nextAdjacent(project, clip) {
        const end = clipEnd(clip);
        return trackClips(project, clip.track, clip.id).find((o) => Math.abs(o.start - end) < 1e-3) || null;
    }

    /**
     * The span of timeline a clip's sound can be heard over: its own, widened
     * by the transitions on either side of it.
     */
    function soundWindow(project, clip) {
        let start = clip.start;
        let end = clipEnd(clip);
        const inW = transitionWindow(project, clip);
        if (inW) start = inW.start;
        const next = nextAdjacent(project, clip);
        const outW = next && transitionWindow(project, next);
        if (outW) end = outW.end;
        return { start: start, end: end, incoming: inW, outgoing: outW };
    }

    /**
     * One clip's gain at `time` — the same value audibleClips gives it, but
     * computed directly, so rendering a long project's sound stays fast.
     * Pass the clip's soundWindow to avoid recomputing it for every sample.
     */
    function clipGainAt(project, clip, time, duck, win) {
        if (!isTimed(project, clip) || clip.muted) return 0;
        const track = getTrack(project, clip.track);
        if (!track || track.muted) return 0;
        const w = win || soundWindow(project, clip);
        if (time < w.start - EPS || time >= w.end - EPS) return 0;
        let weight = 1;
        if (w.incoming && time < w.incoming.end) {
            const mix = transitionMix(w.incoming.type, clamp((time - w.incoming.start) / w.incoming.duration, 0, 1));
            weight = mix.soundTo === undefined ? mix.to : mix.soundTo;
        } else if (w.outgoing && time >= w.outgoing.start) {
            const mix = transitionMix(w.outgoing.type, clamp((time - w.outgoing.start) / w.outgoing.duration, 0, 1));
            weight = mix.soundFrom === undefined ? mix.from : mix.soundFrom;
        }
        let gain = (clip.volume === undefined ? 1 : clip.volume) * edgeFade(clip, time) * weight;
        if (duck && track.duck) gain *= duck(time);
        return gain;
    }

    /**
     * The rectangle to draw a source of srcW×srcH into a frame of dstW×dstH:
     * letterboxed ('contain') or cropped to fill ('cover'), then scaled about
     * and centred on (x, y), given as fractions of the frame.
     */
    function placeRect(srcW, srcH, dstW, dstH, fit, scale, x, y) {
        if (!srcW || !srcH) return { x: 0, y: 0, w: dstW, h: dstH };
        const ratio = fit === 'cover'
            ? Math.max(dstW / srcW, dstH / srcH)
            : Math.min(dstW / srcW, dstH / srcH);
        const s = scale === undefined ? 1 : scale;
        const w = srcW * ratio * s;
        const h = srcH * ratio * s;
        const cx = (x === undefined ? 0.5 : x) * dstW;
        const cy = (y === undefined ? 0.5 : y) * dstH;
        return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
    }

    /**
     * Slow pan-and-zoom ("Ken Burns") at `time`: an extra scale and an offset
     * as fractions of the frame, eased over the clip's length.
     */
    function motionAt(clip, time) {
        const m = clip.motion;
        if (!m || !m.type || m.type === 'none') return { scale: 1, dx: 0, dy: 0 };
        const a = m.amount > 0 ? m.amount : 0.15;
        const u = smooth((time - clip.start) / Math.max(clip.duration, 1e-3));
        const drift = a / 2 * (1 - 2 * u); // +a/2 → −a/2
        switch (m.type) {
        case 'zoom-in': return { scale: 1 + a * u, dx: 0, dy: 0 };
        case 'zoom-out': return { scale: 1 + a * (1 - u), dx: 0, dy: 0 };
        case 'pan-left': return { scale: 1 + a, dx: drift, dy: 0 };
        case 'pan-right': return { scale: 1 + a, dx: -drift, dy: 0 };
        case 'pan-up': return { scale: 1 + a, dx: 0, dy: drift };
        case 'pan-down': return { scale: 1 + a, dx: 0, dy: -drift };
        default: return { scale: 1, dx: 0, dy: 0 };
        }
    }

    /**
     * How a title's entrance animation looks at `time`: opacity, offset and
     * scale, and `reveal` — the share of characters (typewriter) or words
     * (word by word) shown so far.
     */
    function textAnimAt(clip, time) {
        const out = Object.assign({ reveal: 1, unit: 'none' }, exitAt(clip, time));
        const type = clip.anim;
        if (!type || type === 'none') return out;
        const d = clip.animDuration > 0 ? clip.animDuration : 0.6;
        const local = Math.max(0, time - clip.start);
        if (MOVES.indexOf(type) !== -1) {
            Object.assign(out, combineMoves(moveAt(type, local / d), out));
        } else if (REVEAL_ANIMS.indexOf(type) !== -1) {
            // Spread across most of the clip, so the last word lands before it ends.
            const span = type === 'handwrite' && clip.writeDuration > 0
                ? Math.max(0.1, Math.min(clip.writeDuration, clip.duration * 0.9))
                : Math.max(d, clip.duration * 0.75);
            out.reveal = clamp(local / span, 0, 1);
            out.unit = type === 'typewriter' ? 'chars' : type === 'words' ? 'words' : 'width';
            out.exit = handExit(local - span);
        }
        return out;
    }

    /* ------------------------------------------------------------- keyframes */

    /** What keyframes animate: position, size, turn (degrees) and opacity. */
    const KEY_PROPS = ['x', 'y', 'scale', 'rotate', 'opacity'];

    /** A clip's own values for the keyframed properties. */
    function keyBase(clip) {
        return {
            x: clip.x === undefined ? 0.5 : clip.x, y: clip.y === undefined ? 0.5 : clip.y,
            scale: clip.scale === undefined ? 1 : clip.scale, rotate: 0,
            opacity: clip.opacity === undefined ? 1 : clip.opacity
        };
    }

    function easeInOut(u) {
        return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    }

    /**
     * The keyframed values at `time`, eased between neighbouring keyframes and
     * held before the first and after the last; null for a clip without any.
     * Keyframe times (`t`) are seconds from the start of the clip.
     */
    function keyframeAt(clip, time) {
        const keys = clip.keys;
        if (!keys || !keys.length) return null;
        const base = keyBase(clip);
        const full = (k) => {
            const o = {};
            KEY_PROPS.forEach((prop) => { o[prop] = k[prop] === undefined ? base[prop] : k[prop]; });
            return o;
        };
        const t = time - clip.start;
        if (t <= keys[0].t) return full(keys[0]);
        const last = keys[keys.length - 1];
        if (t >= last.t) return full(last);
        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].t <= t) i += 1;
        const a = full(keys[i]);
        const b = full(keys[i + 1]);
        const span = keys[i + 1].t - keys[i].t;
        const u = easeInOut(span > 0 ? clamp((t - keys[i].t) / span, 0, 1) : 1);
        const o = {};
        KEY_PROPS.forEach((prop) => { o[prop] = a[prop] + (b[prop] - a[prop]) * u; });
        return o;
    }

    /**
     * Adds a keyframe at `t` seconds into the clip, or changes the one already
     * there: it starts from what the clip looks like at that moment, with
     * `values` on top.
     */
    function setKeyframe(project, id, t, values) {
        const clip = getClip(project, id);
        if (!clip) return project;
        const at = round(clamp(t, 0, clip.duration));
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        const keys = (c.keys || []).slice();
        const near = keys.findIndex((k) => Math.abs(k.t - at) < 1 / 60);
        const now = keyframeAt(clip, clip.start + at) || keyBase(clip);
        const v = {};
        Object.keys(values || {}).forEach((k) => { if (KEY_PROPS.indexOf(k) !== -1) v[k] = round(values[k]); });
        if (near !== -1) keys[near] = Object.assign({}, keys[near], v);
        else keys.push(Object.assign({ t: at }, now, v));
        keys.sort((a, b) => a.t - b.t);
        c.keys = keys;
        return p;
    }

    /**
     * Auto-reframe: a camera path that keeps a face in a frame narrower than
     * the source (a wide video in a 9:16 Short). `samples` are { t: seconds
     * into the clip, fx: the face's centre across the source 0–1 (null when
     * no face) }. The picture holds still until the face moves more than
     * `deadZone` of the frame, then glides there over `glide` seconds, like a
     * camera operator. Returns keyframes [{ t, x }] for the clip.
     */
    function reframeKeys(samples, srcW, srcH, dstW, dstH, options) {
        const o = Object.assign({ scale: 1, deadZone: 0.12, glide: 0.6 }, options);
        if (!srcW || !srcH || !samples || !samples.length) return [];
        const rw = srcW * Math.max(dstW / srcW, dstH / srcH) * o.scale / dstW;
        const room = Math.max(0, (rw - 1) / 2);
        if (room < 1e-3) return [];
        const xFor = (fx) => round(clamp(0.5 + (0.5 - fx) * rw, 0.5 - room, 0.5 + room));
        const seen = samples.filter((s) => s.fx != null).sort((a, b) => a.t - b.t);
        if (!seen.length) return [];
        // Lightly smooth the detections so one wobbly frame does not move the camera.
        const smooth = seen.map(function (s, i) {
            const near = seen.slice(Math.max(0, i - 1), i + 2).map((n) => n.fx).sort((a, b) => a - b);
            return { t: s.t, fx: near[Math.floor(near.length / 2)] };
        });
        const keys = [{ t: 0, x: xFor(smooth[0].fx) }];
        let held = keys[0].x;
        let heldSince = 0;
        smooth.forEach(function (s) {
            const x = xFor(s.fx);
            // |x − held| is how far the face sits from the middle of the frame, in frame widths.
            if (Math.abs(x - held) <= o.deadZone) return;
            const start = Math.max(heldSince, s.t - o.glide);
            if (start - keys[keys.length - 1].t > 1e-3) keys.push({ t: round(start), x: held });
            keys.push({ t: round(Math.max(start + 0.05, s.t)), x: x });
            held = x;
            heldSince = s.t;
        });
        return keys;
    }

    /** Puts a reframe path on a clip (replacing its keyframes) and fills the frame with it. */
    function applyReframe(project, id, keys) {
        const clip = getClip(project, id);
        if (!clip || !keys.length) return project;
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        c.fit = 'cover';
        c.keys = keys.filter((k) => k.t <= c.duration + EPS).map((k) => ({ t: k.t, x: k.x }));
        if (!c.keys.length) delete c.keys;
        return p;
    }

    function removeKeyframe(project, id, index) {
        const clip = getClip(project, id);
        if (!clip || !clip.keys || !clip.keys[index]) return project;
        const p = clone(project);
        const c = p.clips.find((x) => x.id === id);
        c.keys = c.keys.filter((k, i) => i !== index);
        if (!c.keys.length) delete c.keys;
        return p;
    }

    const IDENTITY_MOVE = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, scaleX: 1, blur: 0 };

    function bounceOut(u) {
        const n = 7.5625;
        const d = 2.75;
        if (u < 1 / d) return n * u * u;
        if (u < 2 / d) { u -= 1.5 / d; return n * u * u + 0.75; }
        if (u < 2.5 / d) { u -= 2.25 / d; return n * u * u + 0.9375; }
        u -= 2.625 / d;
        return n * u * u + 0.984375;
    }

    /**
     * How a clip looks part-way through a movement: `u` runs from 0 (not yet
     * arrived, or gone) to 1 (in place). Offsets are shares of the frame,
     * `rotate` is in radians and `blur` in pixels of a 720-line frame.
     */
    function moveAt(type, u) {
        const o = Object.assign({}, IDENTITY_MOVE);
        u = clamp(u, 0, 1);
        if (u >= 1 || MOVES.indexOf(type) === -1) return o;
        const e = easeOut(u);
        switch (type) {
        case 'fade': o.alpha = u; break;
        case 'rise': o.alpha = u; o.dy = 0.05 * (1 - e); break;
        case 'drop': o.alpha = clamp(u * 3, 0, 1); o.dy = -0.18 * (1 - bounceOut(u)); break;
        case 'slide': o.alpha = u; o.dx = -0.08 * (1 - e); break;
        case 'slide-right': o.alpha = u; o.dx = 0.08 * (1 - e); break;
        case 'pop': {
            const back = 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2);
            o.alpha = clamp(u * 3, 0, 1);
            o.scale = 0.6 + 0.4 * back;
            break;
        }
        case 'zoom-in': o.alpha = u; o.scale = 0.3 + 0.7 * e; break;
        case 'zoom-out': o.alpha = u; o.scale = 1 + 0.6 * (1 - e); break;
        case 'spin': o.alpha = clamp(u * 2, 0, 1); o.rotate = -Math.PI * (1 - e); o.scale = 0.5 + 0.5 * e; break;
        case 'flip': o.alpha = clamp(u * 4, 0, 1); o.scaleX = Math.max(0.02, e); break;
        case 'blur': o.alpha = u; o.blur = 18 * (1 - e); break;
        case 'bounce':
            o.alpha = clamp(u * 4, 0, 1);
            o.scale = 1 - Math.cos(u * Math.PI * 3.5) * Math.exp(-5 * u) * (1 - u);
            break;
        case 'swing':
            o.alpha = clamp(u * 3, 0, 1);
            o.rotate = 0.45 * Math.cos(u * Math.PI * 3) * Math.exp(-3 * u) * (1 - u);
            break;
        default: break;
        }
        return o;
    }

    /** Two movements at once: an entrance still finishing and an exit starting. */
    function combineMoves(a, b) {
        return {
            alpha: a.alpha * b.alpha, dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale,
            rotate: a.rotate + b.rotate, scaleX: a.scaleX * b.scaleX, blur: Math.max(a.blur, b.blur)
        };
    }

    /** True when a movement leaves the clip exactly as it is. */
    function isStill(m) {
        return m.alpha === 1 && !m.dx && !m.dy && m.scale === 1 && !m.rotate && m.scaleX === 1 && !m.blur;
    }

    /** A clip's exit movement at `time`, over its last `exitDuration` seconds. */
    function exitAt(clip, time) {
        if (MOVES.indexOf(clip.exit) === -1) return Object.assign({}, IDENTITY_MOVE);
        const d = clip.exitDuration > 0 ? clip.exitDuration : 0.6;
        return moveAt(clip.exit, (clipEnd(clip) - time) / d);
    }

    /**
     * How a picture, video, drawing or sticker moves at `time`: its entrance
     * (`enter`, over `enterDuration`) combined with its exit.
     */
    function clipMoveAt(clip, time) {
        let m = Object.assign({}, IDENTITY_MOVE);
        if (MOVES.indexOf(clip.enter) !== -1) {
            const d = clip.enterDuration > 0 ? clip.enterDuration : 0.6;
            m = moveAt(clip.enter, (time - clip.start) / d);
        }
        return combineMoves(m, exitAt(clip, time));
    }

    /** 0 while a hand is still working, rising to 1 as it leaves. */
    function handExit(sinceDone) {
        return clamp(sinceDone / HAND_EXIT, 0, 1);
    }

    /**
     * The hand a clip shows while it reveals itself, or null: its tool, style
     * ('emoji' or 'sketch'), skin, size, and `pen`, the pen's own colour —
     * null to take the colour being written in.
     */
    function handOf(clip) {
        if (!clip || HAND_TOOLS.indexOf(clip.hand) === -1) return null;
        if (clip.type === 'draw' ? clip.anim !== 'draw' : REVEAL_ANIMS.indexOf(clip.anim) === -1) return null;
        return {
            tool: clip.hand,
            style: ['realistic', 'sketch'].includes(clip.handStyle) ? clip.handStyle : 'emoji',
            skin: clip.handSkin || 'yellow',
            size: clip.handSize > 0 ? clip.handSize : 1,
            pen: /^#[0-9a-f]{6}$/i.test(clip.penColor || '') ? clip.penColor : null
        };
    }

    /** How far a drawing has been drawn at `time`: `reveal` 0..1, and the hand's `exit`. */
    function drawAnimAt(clip, time) {
        const local = Math.max(0, time - clip.start);
        if (clip.anim !== 'draw') return { reveal: 1, exit: 1, alpha: clip.anim === 'fade' ? clamp(local / 0.6, 0, 1) : 1 };
        const span = Math.max(0.1, Math.min(clip.animDuration > 0 ? clip.animDuration : 3, clip.duration * 0.95));
        return { reveal: clamp(local / span, 0, 1), exit: handExit(local - span), alpha: 1 };
    }

    /** The length of each stroke, measured on a frame `aspect` times as wide as it is high. */
    function strokeLengths(strokes, aspect) {
        return strokes.map(function (s) {
            const pts = s.points || [];
            let len = 0;
            for (let i = 2; i < pts.length; i += 2) len += Math.hypot((pts[i] - pts[i - 2]) * aspect, pts[i + 1] - pts[i - 1]);
            return len;
        });
    }

    /**
     * The part of a drawing shown when `reveal` of it has been drawn, at an
     * even speed in the order it was drawn: whole strokes, then part of the
     * stroke being drawn, and `tip`, the point where the pen is.
     */
    function revealStrokes(strokes, reveal, aspect) {
        const a = aspect || 16 / 9;
        const lengths = strokeLengths(strokes, a);
        // A dot has no length but still takes a moment to draw.
        const dot = 0.004;
        const cost = lengths.map((l) => Math.max(l, dot));
        const total = cost.reduce((x, y) => x + y, 0);
        if (reveal >= 1 || !total) {
            const last = strokes[strokes.length - 1];
            const pts = last ? last.points : [];
            return { strokes: strokes, tip: pts.length ? { x: pts[pts.length - 2], y: pts[pts.length - 1] } : null, done: true };
        }
        let budget = Math.max(0, reveal) * total;
        const out = [];
        let lastTip = null;
        for (let i = 0; i < strokes.length; i += 1) {
            const s = strokes[i];
            const pts = s.points || [];
            if (budget >= cost[i]) {
                out.push(s);
                budget -= cost[i];
                if (pts.length) lastTip = { x: pts[pts.length - 2], y: pts[pts.length - 1] };
                continue;
            }
            // The pen has only just reached the end of the last stroke.
            if (budget <= 0 && out.length) return { strokes: out, tip: lastTip, done: false };
            if (lengths[i] === 0 || pts.length < 4) {
                if (budget > 0) out.push(s);
                return { strokes: out, tip: pts.length ? { x: pts[0], y: pts[1] } : null, done: false };
            }
            const part = [pts[0], pts[1]];
            let left = budget / cost[i] * lengths[i];
            let tip = { x: pts[0], y: pts[1] };
            for (let j = 2; j < pts.length; j += 2) {
                const seg = Math.hypot((pts[j] - pts[j - 2]) * a, pts[j + 1] - pts[j - 1]);
                if (left >= seg) {
                    part.push(pts[j], pts[j + 1]);
                    left -= seg;
                    tip = { x: pts[j], y: pts[j + 1] };
                    continue;
                }
                const u = seg ? left / seg : 0;
                tip = { x: pts[j - 2] + (pts[j] - pts[j - 2]) * u, y: pts[j - 1] + (pts[j + 1] - pts[j - 1]) * u };
                part.push(tip.x, tip.y);
                break;
            }
            out.push(Object.assign({}, s, { points: part }));
            return { strokes: out, tip: tip, done: false };
        }
        return { strokes: out, tip: null, done: true };
    }

    /**
     * Thins a freehand stroke as it is recorded: drops points closer than
     * `minGap` to the last one kept and rounds the rest, so a drawing stays
     * small in the project file.
     */
    function simplifyPoints(points, minGap) {
        const gap = minGap === undefined ? 0.002 : minGap;
        const r = (v) => Math.round(v * 10000) / 10000;
        const out = [];
        for (let i = 0; i < points.length; i += 2) {
            const x = r(points[i]);
            const y = r(points[i + 1]);
            const n = out.length;
            const last = i + 2 >= points.length;
            if (n && !last && Math.hypot(x - out[n - 2], y - out[n - 1]) < gap) continue;
            if (n && last && x === out[n - 2] && y === out[n - 1]) continue;
            out.push(x, y);
        }
        return out;
    }

    /** The points of a shape dragged from (x0, y0) to (x1, y1): a line, an arrow, a box or an oval. */
    function shapeStrokes(shape, x0, y0, x1, y1, aspect) {
        const a = aspect || 16 / 9;
        const r = (v) => Math.round(v * 10000) / 10000;
        const pts = (list) => list.map(r);
        if (shape === 'rect') return [pts([x0, y0, x1, y0, x1, y1, x0, y1, x0, y0])];
        if (shape === 'oval') {
            const out = [];
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            for (let i = 0; i <= 48; i += 1) {
                const t = -Math.PI / 2 + i / 48 * Math.PI * 2;
                out.push(cx + Math.cos(t) * Math.abs(x1 - x0) / 2, cy + Math.sin(t) * Math.abs(y1 - y0) / 2);
            }
            return [pts(out)];
        }
        const line = pts([x0, y0, x1, y1]);
        if (shape !== 'arrow') return [line];
        // The head: two short strokes back from the point, at ±28°.
        const dx = (x1 - x0) * a;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const head = Math.min(0.05, len * 0.35);
        const ang = Math.atan2(dy, dx);
        const wing = (s) => pts([x1, y1, x1 - Math.cos(ang + s) * head / a, y1 - Math.sin(ang + s) * head]);
        return [line, wing(0.5), wing(-0.5)];
    }

    /** A clip's effects with every default filled in. */
    function fxOf(clip) {
        return mergeFx(null, clip && clip.fx);
    }

    /** Merges an effects patch into effects, one level deep for crop, border and hide. */
    function mergeFx(base, patch) {
        const out = clone(DEFAULT_FX);
        [base, patch].forEach(function (src) {
            if (!src) return;
            Object.keys(src).forEach(function (k) {
                const v = src[k];
                if ((k === 'crop' || k === 'border') && v) out[k] = Object.assign({}, out[k], v);
                else if (k === 'hide' || k === 'tint') out[k] = v ? Object.assign({}, out[k] || {}, v) : null;
                else out[k] = v;
            });
        });
        return out;
    }

    /** Applies a look: its colour settings, tint, vignette and grain; transform and frame are kept. */
    function applyLook(project, id, name) {
        const look = LOOKS[name] || LOOKS.none;
        const clip = getClip(project, id);
        if (!clip) return project;
        const keep = fxOf(clip);
        const fx = Object.assign(keep, { look: name, tint: null, vignette: 0, grain: 0 }, clone(look.fx));
        return updateClip(project, id, { filters: Object.assign(clone(DEFAULT_FILTERS), look.filters), fx: fx });
    }

    /** The part of a source kept by a crop, in source pixels. */
    function cropRect(srcW, srcH, crop) {
        const c = Object.assign({ l: 0, r: 0, t: 0, b: 0 }, crop);
        const l = clamp(c.l, 0, 0.9);
        const t = clamp(c.t, 0, 0.9);
        const w = Math.max(0.05, 1 - l - clamp(c.r, 0, 0.9));
        const h = Math.max(0.05, 1 - t - clamp(c.b, 0, 0.9));
        return { sx: srcW * l, sy: srcH * t, sw: srcW * w, sh: srcH * h };
    }

    /** True when a clip has any effect a badge should show. */
    function hasFx(clip) {
        const fx = fxOf(clip);
        return fx.look !== 'none' || !!fx.tint || fx.vignette > 0 || fx.grain > 0 || fx.flipH || fx.flipV ||
            !!fx.rotate || fx.crop.l + fx.crop.r + fx.crop.t + fx.crop.b > 0 || fx.radius > 0 ||
            fx.border.width > 0 || fx.shadow || !!fx.hide;
    }

    /** Peak loudness 0–1 of a clip's source span, from its waveform peaks. */
    function clipPeak(clip, peaks, rate) {
        if (!peaks || !rate) return null;
        const from = Math.max(0, Math.floor((clip.in || 0) * rate));
        const to = Math.min(peaks.length, Math.ceil(((clip.in || 0) + clip.duration * speedOf(clip)) * rate));
        let m = 0;
        for (let i = from; i < to; i += 1) if (peaks[i] > m) m = peaks[i];
        return m;
    }

    /** The volume that brings a clip's loudest moment to about −1 dB, within 0–200%. */
    function normalisedVolume(peak) {
        if (!(peak > 0)) return 1;
        return clamp(Math.round(0.89 / peak * 100) / 100, 0.05, 2);
    }

    /** A canvas `filter` string for a clip's colour settings. */
    function filterString(filters) {
        const f = Object.assign({}, DEFAULT_FILTERS, filters || {});
        const parts = [];
        if (f.brightness !== 100) parts.push('brightness(' + f.brightness + '%)');
        if (f.contrast !== 100) parts.push('contrast(' + f.contrast + '%)');
        if (f.saturate !== 100) parts.push('saturate(' + f.saturate + '%)');
        if (f.grayscale) parts.push('grayscale(' + f.grayscale + '%)');
        if (f.sepia) parts.push('sepia(' + f.sepia + '%)');
        if (f.hue) parts.push('hue-rotate(' + f.hue + 'deg)');
        if (f.blur) parts.push('blur(' + f.blur + 'px)');
        return parts.length ? parts.join(' ') : 'none';
    }

    /* ---------------------------------------------------------------- ducking */

    /**
     * Gain over time for ducked tracks: drops to the project's duckAmount
     * while anything on a track that is not ducked is making sound, and
     * comes back up after it stops. `levelAt(clip, sourceTime)` returns that
     * clip's loudness 0–1 (return 1 if unknown). Sampled every `step` seconds
     * with a quick attack and a slower release, so it does not pump.
     */
    function duckEnvelope(project, levelAt, step, threshold) {
        const dt = step || 0.05;
        const thr = threshold === undefined ? 0.04 : threshold;
        const amount = project.duckAmount === undefined ? 0.25 : project.duckAmount;
        const total = projectDuration(project);
        const n = Math.ceil(total / dt) + 1;
        const gains = new Float32Array(n);
        if (!project.tracks.some((t) => t.kind === 'audio' && t.duck)) { gains.fill(1); return { step: dt, gains: gains }; }
        const attack = 1 - Math.exp(-dt / 0.08);
        const release = 1 - Math.exp(-dt / 0.5);
        let g = 1;
        let hold = 0;
        for (let i = 0; i < n; i += 1) {
            const t = i * dt;
            const voice = activeClips(project, t).some(function (c) {
                if (!isTimed(project, c) || c.muted) return false;
                const track = getTrack(project, c.track);
                if (!track || track.muted || track.duck) return false;
                return levelAt(c, sourceTime(c, t)) * (c.volume === undefined ? 1 : c.volume) > thr;
            });
            // Bridge the short gaps between words.
            hold = voice ? 0.35 : Math.max(0, hold - dt);
            const target = voice || hold > 0 ? amount : 1;
            g += (target - g) * (target < g ? attack : release);
            gains[i] = g;
        }
        return { step: dt, gains: gains };
    }

    /** Reads a duck envelope at `time`, interpolating between samples. */
    function envelopeAt(env, time) {
        if (!env || !env.gains.length) return 1;
        const x = time / env.step;
        const i = Math.floor(x);
        if (i < 0) return env.gains[0];
        if (i >= env.gains.length - 1) return env.gains[env.gains.length - 1];
        return env.gains[i] + (env.gains[i + 1] - env.gains[i]) * (x - i);
    }

    /* ---------------------------------------------------------------- markers */

    function addMarker(project, time, label) {
        const p = clone(project);
        p.markers = (p.markers || []).slice();
        const m = { id: newId('k'), time: round(Math.max(0, time)), label: label || '' };
        p.markers.push(m);
        p.markers.sort((a, b) => a.time - b.time);
        return { project: p, id: m.id };
    }

    function updateMarker(project, id, patch) {
        const p = clone(project);
        const m = (p.markers || []).find((x) => x.id === id);
        if (!m) return project;
        Object.assign(m, patch);
        if (patch.time !== undefined) m.time = round(Math.max(0, patch.time));
        p.markers.sort((a, b) => a.time - b.time);
        return p;
    }

    function removeMarker(project, id) {
        const p = clone(project);
        p.markers = (p.markers || []).filter((m) => m.id !== id);
        return p;
    }

    /** "00:00 Intro" lines, as YouTube reads chapters from a description. */
    function chaptersText(project) {
        const marks = (project.markers || []).slice().sort((a, b) => a.time - b.time);
        if (!marks.length || marks[0].time > 0.5) marks.unshift({ time: 0, label: 'Start' });
        return marks.map(function (m, i) {
            const s = Math.floor(m.time);
            const h = Math.floor(s / 3600);
            const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            return (h ? h + ':' : '') + mm + ':' + ss + ' ' + (m.label || 'Chapter ' + (i + 1));
        }).join('\n');
    }

    /* ------------------------------------------------------------ interaction */

    /**
     * Snaps `time` to the nearest clip edge, marker, playhead or zero within
     * `threshold` seconds, ignoring the clips being dragged.
     */
    function snapTime(project, time, threshold, excludeId, extra) {
        const skip = Array.isArray(excludeId) ? excludeId : [excludeId];
        const points = [0].concat(extra || []);
        project.clips.forEach(function (c) {
            if (skip.indexOf(c.id) !== -1) return;
            points.push(c.start, clipEnd(c));
        });
        (project.markers || []).forEach(function (m) { points.push(m.time); });
        let best = time;
        let bestDist = threshold;
        points.forEach(function (pt) {
            const d = Math.abs(pt - time);
            if (d <= bestDist) { best = pt; bestDist = d; }
        });
        return best;
    }

    /** A ruler step giving labels at least `minPx` apart at this zoom. */
    function rulerStep(pxPerSecond, minPx) {
        const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
        for (let i = 0; i < steps.length; i += 1) {
            if (steps[i] * pxPerSecond >= minPx) return steps[i];
        }
        return steps[steps.length - 1];
    }

    /** 75.5 → "01:15.15" at 30 fps: minutes, seconds, frames. */
    function formatTime(seconds, fps) {
        const f = fps || 30;
        const totalFrames = Math.round(Math.max(0, seconds) * f);
        const frames = totalFrames % f;
        const totalSeconds = Math.floor(totalFrames / f);
        const s = totalSeconds % 60;
        const m = Math.floor(totalSeconds / 60) % 60;
        const h = Math.floor(totalSeconds / 3600);
        const pad = (n) => String(n).padStart(2, '0');
        return (h ? h + ':' : '') + pad(m) + ':' + pad(s) + '.' + pad(frames);
    }

    /** "1:15.5", "75.5", "01:15.15" (with fps) → seconds, or null. */
    function parseTime(text, fps) {
        const str = String(text).trim();
        const framed = str.match(/^(?:(\d+):)?(\d+):(\d{1,2})\.(\d{1,2})$/);
        if (framed && fps) {
            const [, h, m, s, fr] = framed;
            return (Number(h || 0) * 3600) + Number(m) * 60 + Number(s) + Number(fr) / fps;
        }
        const parts = str.split(':');
        if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
        return parts.reduce((acc, x) => acc * 60 + Number(x), 0);
    }

    /** Snaps a time to the frame grid. */
    function toFrame(time, fps) {
        return Math.round(time * fps) / fps;
    }

    /* ------------------------------------------------------------ text, RTL */

    const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

    /** True if the text contains Arabic script, so it is laid out right to left. */
    function isArabic(text) {
        return ARABIC_RE.test(String(text || ''));
    }

    /** 12 → "١٢", for ayah numbers. */
    function arabicDigits(n) {
        return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    }

    /* ------------------------------------------------------------- subtitles */

    /**
     * Groups timed words into caption lines: a new line at sentence ends,
     * pauses longer than `gap`, or when a line would pass `maxChars` or
     * `maxDuration`. Words are { text, start, end }.
     */
    function wordsToCaptions(words, options) {
        const o = Object.assign({ maxChars: 42, maxDuration: 4, gap: 0.6 }, options);
        const cues = [];
        let cur = null;
        words.forEach(function (w) {
            const text = String(w.text).trim();
            if (!text) return;
            const joined = cur ? cur.text + ' ' + text : text;
            const breakHere = !cur || w.start - cur.end > o.gap || joined.length > o.maxChars ||
                w.end - cur.start > o.maxDuration || /[.!?؟。]$/.test(cur.text);
            if (breakHere) {
                if (cur) cues.push(cur);
                cur = { start: w.start, end: w.end, text: text };
            } else {
                cur.text = joined;
                cur.end = w.end;
            }
        });
        if (cur) cues.push(cur);
        return cues.map((c) => ({ start: round(c.start), end: round(Math.max(c.end, c.start + 0.3)), text: c.text }));
    }

    /**
     * Times a written text to speech it was not recognised from — for
     * languages the recogniser does not know, such as Afaan Oromoo. Words are
     * shared out over the `segments` with sound ([{ start, end }], from the
     * pauses) by their length, each word kept whole inside one segment.
     * Returns words { text, start, end } for wordsToCaptions.
     */
    function alignWords(text, segments) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        const segs = (segments || []).filter((s) => s.end > s.start);
        if (!words.length || !segs.length) return [];
        const weight = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5 + (/[.!?؟,;:،]$/.test(w) ? 1.5 : 0);
        const total = words.reduce((a, w) => a + weight(w), 0);
        const speech = segs.reduce((a, s) => a + s.end - s.start, 0);
        // Which segment each word's middle falls in, on the segments laid end to end.
        const bins = segs.map(() => []);
        let acc = 0;
        words.forEach(function (w) {
            const mid = (acc + weight(w) / 2) / total * speech;
            acc += weight(w);
            let run = 0;
            let k = 0;
            while (k < segs.length - 1 && run + (segs[k].end - segs[k].start) < mid) { run += segs[k].end - segs[k].start; k += 1; }
            bins[k].push(w);
        });
        const out = [];
        bins.forEach(function (list, k) {
            if (!list.length) return;
            const s = segs[k];
            const sum = list.reduce((a, w) => a + weight(w), 0);
            let t = s.start;
            list.forEach(function (w) {
                const d = (s.end - s.start) * weight(w) / sum;
                out.push({ text: w, start: round(t), end: round(t + d) });
                t += d;
            });
        });
        return out;
    }

    /**
     * Like alignWords, for a text in lines (one caption each): when there
     * are at least as many stretches of speech as lines, each line starts on
     * a pause — the one nearest where its share of the text falls — so a line
     * is not split across two phrases. Words carry the `line` they came from.
     */
    function alignLines(lines, segments) {
        const list = (lines || []).map((l) => String(l).trim()).filter(Boolean);
        const segs = (segments || []).filter((s) => s.end > s.start);
        if (!list.length || !segs.length) return [];
        const tag = (words, i) => words.map((w) => Object.assign(w, { line: i }));
        if (segs.length < list.length) {
            let k = 0;
            const words = alignWords(list.join(' '), segs);
            return list.reduce(function (out, l, i) {
                const n = l.split(/\s+/).length;
                out.push.apply(out, tag(words.slice(k, k + n), i));
                k += n;
                return out;
            }, []);
        }
        const weight = (l) => l.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5 * l.split(/\s+/).length;
        const total = list.reduce((a, l) => a + weight(l), 0);
        const starts = [0];
        segs.forEach((s, i) => starts.push(starts[i] + s.end - s.start));
        const speech = starts[segs.length];
        const first = [0];
        let acc = weight(list[0]);
        for (let i = 1; i < list.length; i += 1) {
            const want = acc / total * speech;
            let best = first[i - 1] + 1;
            for (let k = best; k <= segs.length - (list.length - i); k += 1) if (Math.abs(starts[k] - want) < Math.abs(starts[best] - want)) best = k;
            first.push(best);
            acc += weight(list[i]);
        }
        first.push(segs.length);
        return list.reduce((out, l, i) => out.concat(tag(alignWords(l, segs.slice(first[i], first[i + 1])), i)), []);
    }

    function subtitleTime(t, sep) {
        const ms = Math.round(Math.max(0, t) * 1000);
        const pad = (n, w) => String(n).padStart(w || 2, '0');
        return pad(Math.floor(ms / 3600000)) + ':' + pad(Math.floor(ms / 60000) % 60) + ':' +
            pad(Math.floor(ms / 1000) % 60) + sep + pad(ms % 1000, 3);
    }

    function toSRT(cues) {
        return cues.map((c, i) => (i + 1) + '\n' + subtitleTime(c.start, ',') + ' --> ' +
            subtitleTime(c.end, ',') + '\n' + c.text + '\n').join('\n');
    }

    function toVTT(cues) {
        return 'WEBVTT\n\n' + cues.map((c) => subtitleTime(c.start, '.') + ' --> ' +
            subtitleTime(c.end, '.') + '\n' + c.text + '\n').join('\n');
    }

    /** Reads SRT or WebVTT into cues. */
    function parseSubtitles(text) {
        const hms = function (s) {
            const parts = s.trim().replace(',', '.').split(':').map(Number);
            return parts.reduce((a, x) => a * 60 + x, 0);
        };
        const cues = [];
        String(text).replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/).forEach(function (block) {
            const m = block.match(/((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)[^\n]*\n([\s\S]*)/);
            if (!m) return;
            const body = m[3].replace(/<[^>]+>/g, '').trim();
            if (body) cues.push({ start: hms(m[1]), end: hms(m[2]), text: body });
        });
        return cues;
    }

    /** Subtitle cues from the titles on a text track, in time order. */
    function trackCues(project, trackId) {
        return trackClips(project, trackId)
            .filter((c) => c.type === 'text' && String(c.text || '').trim())
            .map((c) => ({ start: c.start, end: clipEnd(c), text: c.text }));
    }

    /* ---------------------------------------------------------------- history */

    /**
     * Undo/redo over whole-project snapshots. Projects are small (media is
     * referenced, never embedded), so a snapshot per edit is cheap and far
     * harder to get wrong than inverse operations.
     */
    function History(initial, limit) {
        this.limit = limit || 200;
        this.states = [clone(initial)];
        this.index = 0;
    }
    History.prototype.push = function (state) {
        const snapshot = JSON.stringify(state);
        if (snapshot === JSON.stringify(this.states[this.index])) return false;
        this.states = this.states.slice(0, this.index + 1);
        this.states.push(JSON.parse(snapshot));
        if (this.states.length > this.limit) this.states.shift();
        this.index = this.states.length - 1;
        return true;
    };
    History.prototype.canUndo = function () { return this.index > 0; };
    History.prototype.canRedo = function () { return this.index < this.states.length - 1; };
    History.prototype.undo = function () {
        if (!this.canUndo()) return null;
        this.index -= 1;
        return clone(this.states[this.index]);
    };
    History.prototype.redo = function () {
        if (!this.canRedo()) return null;
        this.index += 1;
        return clone(this.states[this.index]);
    };
    History.prototype.current = function () {
        return clone(this.states[this.index]);
    };

    /* ---------------------------------------------------------- serialization */

    /**
     * Project JSON for saving. Media files are never embedded: each item keeps
     * its name, size and type so the file can be matched again on re-import.
     */
    function serialize(project) {
        const p = clone(project);
        p.format = FORMAT;
        p.version = VERSION;
        p.media = p.media.map(function (m) {
            const out = {};
            ['id', 'name', 'type', 'mime', 'size', 'lastModified', 'duration', 'width', 'height', 'origin']
                .forEach(function (k) { if (m[k] !== undefined) out[k] = m[k]; });
            return out;
        });
        return JSON.stringify(p, null, 2);
    }

    /** Parses saved JSON, throwing a readable error if it is not a project. */
    function deserialize(text) {
        let data;
        try {
            data = typeof text === 'string' ? JSON.parse(text) : clone(text);
        } catch (err) {
            throw new Error('That file is not valid JSON.');
        }
        if (!data || data.format !== FORMAT) throw new Error('That file is not a Reel project.');
        if (data.version > VERSION) throw new Error('That project was saved by a newer version of Reel.');
        if (!Array.isArray(data.tracks) || !Array.isArray(data.clips) || !Array.isArray(data.media)) {
            throw new Error('That project file is incomplete.');
        }
        const base = createProject();
        const p = Object.assign(base, data);
        if (!Array.isArray(p.markers)) p.markers = [];
        const trackIds = new Set(p.tracks.map((t) => t.id));
        const mediaIds = new Set(p.media.map((m) => m.id));
        p.clips = p.clips.filter(function (c) {
            if (!trackIds.has(c.track) || !(c.duration > 0) || !(c.start >= 0)) return false;
            return isGenerated(c) || mediaIds.has(c.mediaId);
        });
        return p;
    }

    /** The saved media item a file most likely is, by name and size. */
    function matchMedia(project, file) {
        return project.media.find((m) => m.name === file.name && m.size === file.size) ||
            project.media.find((m) => m.name === file.name) || null;
    }

    return {
        FORMAT, VERSION, MIN_DURATION, DEFAULT_STILL, DEFAULT_FILTERS, MIN_SPEED, MAX_SPEED,
        TRANSITIONS, MOTIONS, MOVES, TEXT_ANIMS, REVEAL_ANIMS, HAND_TOOLS, DEFAULT_FX, LOOKS, TITLE_STYLES,
        fxOf, mergeFx, applyLook, cropRect, hasFx, clipPeak, normalisedVolume,
        newId, clone, clamp,
        createProject, addMedia, getMedia, getClip, getTrack, addTrack, nextTrackId, updateTrack, removeTrack,
        isGenerated, clipKind, trackKindFor, isTimed, speedOf, clipEnd, trackClips, trackEnd, projectDuration, lowestTrack,
        isFree, findFreeStart, clipFromMedia, textClip, drawClip, addClip, appendMedia, updateClip, updateClips,
        moveClip, moveClips, trimClip, splitClip, insertTime, removeTime, excerpt,
        findPauses, speechSegments, pauseCuts, clipPauses, cutAt, removePauses, splitAt, deleteClips, duplicateClip, copyClips, pasteClips,
        sourceLength, setSpeed, freezeFrame, detachAudio,
        previousAdjacent, transitionWindow, transitionAt, setTransition, transitionAllCuts, transitionMix,
        activeClips, sourceTime, fadeAt, edgeFade, renderLayers, mediaAt, audibleClips, placeRect,
        nextAdjacent, soundWindow, clipGainAt,
        motionAt, textAnimAt, keyframeAt, setKeyframe, removeKeyframe, reframeKeys, applyReframe, KEY_PROPS, moveAt, combineMoves, isStill, exitAt, clipMoveAt, handOf, drawAnimAt, strokeLengths, revealStrokes, simplifyPoints, shapeStrokes, filterString, duckEnvelope, envelopeAt,
        addMarker, updateMarker, removeMarker, chaptersText,
        snapTime, rulerStep, formatTime, parseTime, toFrame,
        isArabic, arabicDigits, wordsToCaptions, alignWords, alignLines, toSRT, toVTT, parseSubtitles, trackCues,
        History, serialize, deserialize, matchMedia
    };
}));
