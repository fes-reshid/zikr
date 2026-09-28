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
 * its track; for video and audio, `in` is where in the source file it begins.
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

    const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0 };

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
            // Listed top to bottom as the timeline shows them. Upper video
            // tracks are drawn over lower ones, as in any editor.
            tracks: o.tracks || [
                { id: 'T1', kind: 'text', name: 'Titles', muted: false, hidden: false },
                { id: 'V2', kind: 'video', name: 'Overlay', muted: false, hidden: false },
                { id: 'V1', kind: 'video', name: 'Video', muted: false, hidden: false },
                { id: 'A1', kind: 'audio', name: 'Audio', muted: false, hidden: false }
            ],
            media: [],
            clips: []
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
    function addTrack(project, kind) {
        const p = clone(project);
        const prefix = { video: 'V', audio: 'A', text: 'T' }[kind];
        if (!prefix) throw new Error('Unknown track kind: ' + kind);
        let n = 1;
        while (p.tracks.some((t) => t.id === prefix + n)) n += 1;
        const names = { video: 'Video', audio: 'Audio', text: 'Titles' };
        const track = { id: prefix + n, kind: kind, name: names[kind] + ' ' + n, muted: false, hidden: false };
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

    /** What a clip is: 'video', 'image', 'audio' or 'text'. */
    function clipKind(project, clip) {
        if (clip.type === 'text') return 'text';
        const m = getMedia(project, clip.mediaId);
        return m ? m.type : 'video';
    }

    /** Which track kind a clip of this kind belongs on. */
    function trackKindFor(kind) {
        if (kind === 'text') return 'text';
        if (kind === 'audio') return 'audio';
        return 'video';
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
        return !trackClips(project, trackId, excludeId)
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
            fadeOut: 0.3
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
        Object.keys(patch).forEach(function (k) {
            if (k === 'filters') c.filters = Object.assign({}, c.filters || DEFAULT_FILTERS, patch.filters);
            else if (k !== 'id') c[k] = patch[k];
        });
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

    /** How far a clip's source can stretch: Infinity for stills and titles. */
    function sourceLength(project, clip) {
        const kind = clipKind(project, clip);
        if (kind === 'video' || kind === 'audio') {
            const m = getMedia(project, clip.mediaId);
            return m && m.duration ? m.duration : clip.in + clip.duration;
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
        const bounded = clipKind(project, clip) === 'video' || clipKind(project, clip) === 'audio';

        if (edge === 'start') {
            const prevEnd = others.filter((o) => clipEnd(o) <= clip.start + EPS)
                .reduce((m, o) => Math.max(m, clipEnd(o)), 0);
            let lo = prevEnd;
            if (bounded) lo = Math.max(lo, clip.start - clip.in);
            const hi = end - MIN_DURATION;
            const s = round(clamp(time, lo, hi));
            const delta = s - clip.start;
            c.start = s;
            c.duration = round(end - s);
            if (clip.type !== 'text') c.in = round(Math.max(0, clip.in + delta));
        } else if (edge === 'end') {
            const nextStart = others.filter((o) => o.start >= end - EPS)
                .reduce((m, o) => Math.min(m, o.start), Infinity);
            const hi = Math.min(nextStart, clip.start + sourceLength(project, clip) - (clip.in || 0));
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
        if (right.type !== 'text') right.in = round((clip.in || 0) + offset);
        p.clips.splice(p.clips.indexOf(left) + 1, 0, right);
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
        let p = clone(project);
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
        const copy = Object.assign(clone(clip), { id: newId('c') });
        const at = findFreeStart(project, clip.track, clipEnd(clip), clip.duration, null);
        let start = at;
        if (start === null || start < clipEnd(clip) - EPS) start = trackEnd(project, clip.track);
        copy.start = start;
        const p = clone(project);
        p.clips.push(copy);
        return { project: p, id: copy.id };
    }

    /* --------------------------------------------------------------- playback */

    /** Clips under the playhead, in no particular order. */
    function activeClips(project, time) {
        return project.clips.filter((c) => c.start <= time + EPS && time < clipEnd(c) - EPS);
    }

    /** Where in its source file a clip is at timeline time `time`. */
    function sourceTime(clip, time) {
        return (clip.in || 0) + (time - clip.start);
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

    /**
     * What to draw at `time`, bottom layer first: one entry per visible video
     * track with a clip under the playhead, then the titles on top.
     */
    function renderLayers(project, time) {
        const active = activeClips(project, time);
        const layers = [];
        const tracks = project.tracks.slice().reverse();
        ['video', 'text'].forEach(function (kind) {
            tracks.filter((t) => t.kind === kind && !t.hidden).forEach(function (t) {
                active.filter((c) => c.track === t.id).forEach(function (c) {
                    layers.push({ clip: c, kind: clipKind(project, c), alpha: fadeAt(c, time) * (c.opacity === undefined ? 1 : c.opacity) });
                });
            });
        });
        return layers;
    }

    /** Clips whose sound should be playing at `time`, with their gain. */
    function audibleClips(project, time) {
        return activeClips(project, time)
            .filter(function (c) {
                const kind = clipKind(project, c);
                if (kind !== 'video' && kind !== 'audio') return false;
                const track = getTrack(project, c.track);
                return track && !track.muted && !c.muted;
            })
            .map((c) => ({ clip: c, gain: (c.volume === undefined ? 1 : c.volume) * fadeAt(c, time) }));
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

    /** A canvas `filter` string for a clip's colour settings. */
    function filterString(filters) {
        const f = Object.assign({}, DEFAULT_FILTERS, filters || {});
        const parts = [];
        if (f.brightness !== 100) parts.push('brightness(' + f.brightness + '%)');
        if (f.contrast !== 100) parts.push('contrast(' + f.contrast + '%)');
        if (f.saturate !== 100) parts.push('saturate(' + f.saturate + '%)');
        if (f.grayscale) parts.push('grayscale(' + f.grayscale + '%)');
        if (f.blur) parts.push('blur(' + f.blur + 'px)');
        return parts.length ? parts.join(' ') : 'none';
    }

    /* ------------------------------------------------------------ interaction */

    /**
     * Snaps `time` to the nearest clip edge, playhead or zero within
     * `threshold` seconds, ignoring the clip being dragged.
     */
    function snapTime(project, time, threshold, excludeId, extra) {
        const points = [0].concat(extra || []);
        project.clips.forEach(function (c) {
            if (c.id === excludeId) return;
            points.push(c.start, clipEnd(c));
        });
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
            ['id', 'name', 'type', 'mime', 'size', 'lastModified', 'duration', 'width', 'height']
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
        const trackIds = new Set(p.tracks.map((t) => t.id));
        const mediaIds = new Set(p.media.map((m) => m.id));
        p.clips = p.clips.filter(function (c) {
            if (!trackIds.has(c.track) || !(c.duration > 0) || !(c.start >= 0)) return false;
            return c.type === 'text' || mediaIds.has(c.mediaId);
        });
        return p;
    }

    /** The saved media item a file most likely is, by name and size. */
    function matchMedia(project, file) {
        return project.media.find((m) => m.name === file.name && m.size === file.size) ||
            project.media.find((m) => m.name === file.name) || null;
    }

    return {
        FORMAT, VERSION, MIN_DURATION, DEFAULT_STILL, DEFAULT_FILTERS,
        newId, clone, clamp,
        createProject, addMedia, getMedia, getClip, getTrack, addTrack, updateTrack, removeTrack,
        clipKind, trackKindFor, clipEnd, trackClips, trackEnd, projectDuration, lowestTrack,
        isFree, findFreeStart, clipFromMedia, textClip, addClip, appendMedia, updateClip,
        moveClip, trimClip, splitClip, splitAt, deleteClips, duplicateClip, sourceLength,
        activeClips, sourceTime, fadeAt, renderLayers, audibleClips, placeRect, filterString,
        snapTime, rulerStep, formatTime, parseTime, toFrame,
        History, serialize, deserialize, matchMedia
    };
}));
