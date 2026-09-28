/*
 * Writes the duration into a WebM file made by MediaRecorder.
 *
 * MediaRecorder streams WebM as it records, so it cannot know the length when
 * it writes the header and leaves Duration out. Players then show no length
 * and many refuse to seek. This adds the Duration element to the Segment's
 * Info (or fills it in if present) once the whole file is in hand.
 *
 * Browser: window.ReelWebm; Node: module.exports.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelWebm = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const EBML = 0x1A45DFA3;
    const SEGMENT = 0x18538067;
    const SEEK_HEAD = 0x114D9B74;
    const INFO = 0x1549A966;
    const TIMECODE_SCALE = 0x2AD7B1;
    const DURATION = 0x4489;
    const CLUSTER = 0x1F43B675;

    /** An element ID: its leading bits are kept, unlike a size's. */
    function readId(buf, pos) {
        const first = buf[pos];
        if (first === undefined) return null;
        let len = 1;
        let mask = 0x80;
        while (len <= 4 && !(first & mask)) { len += 1; mask >>= 1; }
        if (len > 4 || pos + len > buf.length) return null;
        let value = 0;
        for (let i = 0; i < len; i += 1) value = value * 256 + buf[pos + i];
        return { len: len, value: value };
    }

    /** A variable-length size; all ones means "unknown" (still streaming). */
    function readSize(buf, pos) {
        const first = buf[pos];
        if (first === undefined) return null;
        let len = 1;
        let mask = 0x80;
        while (len <= 8 && !(first & mask)) { len += 1; mask >>= 1; }
        if (len > 8 || pos + len > buf.length) return null;
        let value = first & (mask - 1);
        let unknown = value === mask - 1;
        for (let i = 1; i < len; i += 1) {
            value = value * 256 + buf[pos + i];
            if (buf[pos + i] !== 0xff) unknown = false;
        }
        return { len: len, value: value, unknown: unknown };
    }

    function readUint(buf, pos, len) {
        let v = 0;
        for (let i = 0; i < len; i += 1) v = v * 256 + buf[pos + i];
        return v;
    }

    /**
     * Returns a copy of `buf` (a Uint8Array) with the duration set to
     * `durationMs`, or null if the file is not a WebM this can safely patch.
     */
    function setDuration(buf, durationMs) {
        let pos = 0;
        let el = readId(buf, pos);
        if (!el || el.value !== EBML) return null;
        let size = readSize(buf, pos + el.len);
        if (!size || size.unknown) return null;
        pos += el.len + size.len + size.value;

        el = readId(buf, pos);
        if (!el || el.value !== SEGMENT) return null;
        size = readSize(buf, pos + el.len);
        if (!size) return null;
        pos += el.len + size.len;
        const segmentEnd = size.unknown ? buf.length : Math.min(buf.length, pos + size.value);

        let sawSeekHead = false;
        while (pos < segmentEnd) {
            el = readId(buf, pos);
            if (!el) return null;
            size = readSize(buf, pos + el.len);
            if (!size || size.unknown) return null;
            const dataStart = pos + el.len + size.len;
            const dataEnd = dataStart + size.value;
            if (dataEnd > buf.length) return null;

            if (el.value === SEEK_HEAD) sawSeekHead = true;
            if (el.value === CLUSTER) return null;
            if (el.value !== INFO) { pos = dataEnd; continue; }

            let scale = 1000000;
            let durationAt = -1;
            let durationLen = 0;
            let p = dataStart;
            while (p < dataEnd) {
                const child = readId(buf, p);
                const childSize = child && readSize(buf, p + child.len);
                if (!child || !childSize || childSize.unknown) return null;
                const at = p + child.len + childSize.len;
                if (child.value === TIMECODE_SCALE) scale = readUint(buf, at, childSize.value) || scale;
                if (child.value === DURATION) { durationAt = at; durationLen = childSize.value; }
                p = at + childSize.value;
            }
            const value = durationMs * 1000000 / scale;

            if (durationAt !== -1) {
                const copy = buf.slice();
                const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
                if (durationLen === 8) view.setFloat64(durationAt, value);
                else if (durationLen === 4) view.setFloat32(durationAt, value);
                else return null;
                return copy;
            }
            // Inserting bytes would shift what a SeekHead points at.
            if (sawSeekHead) return null;

            const durationEl = new Uint8Array(11);
            durationEl.set([0x44, 0x89, 0x88]);
            new DataView(durationEl.buffer).setFloat64(3, value);

            // Re-encode Info's size in a fixed 8 bytes, whatever it was before.
            const sizeBytes = new Uint8Array(8);
            let n = size.value + durationEl.length;
            sizeBytes[0] = 0x01;
            for (let i = 7; i >= 1; i -= 1) { sizeBytes[i] = n % 256; n = Math.floor(n / 256); }

            const out = new Uint8Array(buf.length + durationEl.length + (8 - size.len));
            let o = 0;
            out.set(buf.subarray(0, pos + el.len), o); o += pos + el.len;
            out.set(sizeBytes, o); o += 8;
            out.set(buf.subarray(dataStart, dataEnd), o); o += size.value;
            out.set(durationEl, o); o += durationEl.length;
            out.set(buf.subarray(dataEnd), o);
            return out;
        }
        return null;
    }

    /** Reads the duration back, in milliseconds, or null. */
    function getDuration(buf) {
        let pos = 0;
        let el = readId(buf, pos);
        if (!el || el.value !== EBML) return null;
        let size = readSize(buf, pos + el.len);
        pos += el.len + size.len + size.value;
        el = readId(buf, pos);
        if (!el || el.value !== SEGMENT) return null;
        size = readSize(buf, pos + el.len);
        pos += el.len + size.len;
        while (pos < buf.length) {
            el = readId(buf, pos);
            size = el && readSize(buf, pos + el.len);
            if (!el || !size || size.unknown || el.value === CLUSTER) return null;
            const dataStart = pos + el.len + size.len;
            if (el.value === INFO) {
                let scale = 1000000;
                let duration = null;
                let p = dataStart;
                while (p < dataStart + size.value) {
                    const child = readId(buf, p);
                    const childSize = readSize(buf, p + child.len);
                    const at = p + child.len + childSize.len;
                    const view = new DataView(buf.buffer, buf.byteOffset + at, childSize.value);
                    if (child.value === TIMECODE_SCALE) scale = readUint(buf, at, childSize.value);
                    if (child.value === DURATION) duration = childSize.value === 8 ? view.getFloat64(0) : view.getFloat32(0);
                    p = at + childSize.value;
                }
                return duration === null ? null : duration * scale / 1000000;
            }
            pos = dataStart + size.value;
        }
        return null;
    }

    return { setDuration: setDuration, getDuration: getDuration };
}));
