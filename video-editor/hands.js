/*
 * Reel: a drawn hand that writes, draws or types.
 *
 * A right hand holding a pencil or a pen, drawn in an outlined sketch style
 * with the tool lying almost flat and its point to the left — thumb in
 * front, index finger curled over the top, the other fingers tucked under
 * — or a hand tapping with one finger. It is all canvas paths, so it needs
 * no image files and stays sharp at any size. Its point — the tool's tip
 * or the fingertip — is placed exactly at (x, y), and the arm runs down
 * and to the right, out of the way of what it writes.
 *
 * `ReelHands.draw(ctx, { x, y, size, tool, skin, ink, press, angle })`
 *   tool   'pen', 'pencil' or 'finger'
 *   size   how long the pencil or pen is, in pixels (the hand is a little
 *          smaller); for 'finger', about how tall the hand is
 *   skin   a skin colour, or 'outline' for black-and-white line art
 *   ink    the colour being written in: the pencil's lead, and its paint
 *          (or the pen's barrel) unless that colour is too pale to see
 *   press  0..1, how far the finger is pressed (for typing)
 *   angle  extra tilt in radians, for a little movement while writing
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReelHands = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // `line` outlines the typing hand; `ink` is the sketch outline of the writing hand.
    const SKINS = {
        light: { label: 'Light', fill: '#f3cfb0', shade: '#dfae8a', line: '#9c6b4e', ink: '#3a2416' },
        medium: { label: 'Medium', fill: '#d39b6a', shade: '#b97f50', line: '#7a4b2a', ink: '#2e1b0e' },
        tan: { label: 'Tan', fill: '#b0764a', shade: '#935f37', line: '#5e3a1f', ink: '#24150a' },
        dark: { label: 'Dark', fill: '#7d4f30', shade: '#653d24', line: '#3b2212', ink: '#170c05' },
        outline: { label: 'Line art', fill: '#ffffff', shade: '#c8c8c8', line: '#1a1a1a', ink: '#141414' }
    };
    const TOOLS = { pen: 'Hand with pen', pencil: 'Hand with pencil', finger: 'Hand typing' };

    // The writing hand is drawn with its tool lying flat to the right of its
    // tip at (0, 0), in units where the pencil is 610 long, then tipped a
    // little so the tool slopes gently down to the right. The typing hand is
    // drawn in units where it is about 230 tall.
    const HOLD_UNIT = 610;
    const HOLD_TILT = 0.055;
    const TAP_UNIT = 230;
    // The writing hand's extent in its units, and where its arm fades away.
    const HOLD_BOX = { x: -12, y: -140, w: 644, h: 560 };
    const FADE_FROM = 240;
    const FADE_TO = 410;

    // Two scratch canvases: one for the hand, one for the hand with its shadow.
    const scratch = [null, null];
    function scratchCanvas(i, w, h) {
        if (!scratch[i]) scratch[i] = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
        const cv = scratch[i];
        if (cv.width < w) cv.width = w;
        if (cv.height < h) cv.height = h;
        const g = cv.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, cv.width, cv.height);
        return g;
    }

    function skinOf(name) {
        return SKINS[name] || SKINS.light;
    }

    /** A thick round-ended stroke with an outline: a finger, or an arm. */
    function limb(c, pts, width, s) {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        const path = new Path2D();
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i += 1) path.lineTo(pts[i][0], pts[i][1]);
        c.strokeStyle = s.line;
        c.lineWidth = width + 5;
        c.stroke(path);
        c.strokeStyle = s.fill;
        c.lineWidth = width;
        c.stroke(path);
        return path;
    }

    /** A filled shape with an outline. */
    function blob(c, d, fill, line) {
        const path = new Path2D(d);
        c.fillStyle = fill;
        c.fill(path);
        c.lineWidth = 4;
        c.lineJoin = 'round';
        c.strokeStyle = line;
        c.stroke(path);
    }

    /** A fingernail near the end of a finger running from a to b. */
    function nail(c, a, b, len, width, s) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const ux = dx / l;
        const uy = dy / l;
        const cx = b[0] - ux * len * 0.55;
        const cy = b[1] - uy * len * 0.55;
        c.save();
        c.translate(cx, cy);
        c.rotate(Math.atan2(uy, ux));
        c.beginPath();
        c.ellipse(0, 0, len / 2, width / 2, 0, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,.35)';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = s.shade;
        c.stroke();
        c.restore();
    }

    const SLEEVE = { fill: '#e8ecf1', line: '#8e98a4', shade: '#cfd6de' };

    /** A shirt cuff over the arm, so it reads as an arm and not a shape. */
    function sleeve(c, d, cuff) {
        blob(c, d, SLEEVE.fill, SLEEVE.line);
        c.strokeStyle = SLEEVE.shade;
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(cuff[0][0], cuff[0][1]);
        c.lineTo(cuff[1][0], cuff[1][1]);
        c.stroke();
    }

    /** The outline of the hand and arm, filled once with a soft drop shadow. */
    function shadow(c, d) {
        c.save();
        c.shadowColor = 'rgba(0,0,0,.3)';
        c.shadowBlur = 22;
        c.shadowOffsetX = 12;
        c.shadowOffsetY = 16;
        c.fillStyle = 'rgba(0,0,0,.01)';
        c.fill(new Path2D(d));
        c.restore();
    }

    // The outline of the hand and arm, behind the tool.
    const SIL = 'M 100 -12 C 94 -18 95 -27 103 -31 C 113 -41 126 -54 142 -68 C 158 -82 172 -91 192 -98 ' +
        'C 220 -107 250 -117 280 -118 C 302 -118 320 -107 342 -93 C 374 -73 412 -53 436 -38 C 452 -27 458 -13 458 4 ' +
        'C 462 60 460 140 466 200 C 472 260 490 300 512 340 ' +
        'L 524 470 L 244 470 L 238 340 C 224 280 206 230 183 183 C 150 150 120 120 106 79 C 100 56 92 30 90 12 C 89 0 92 -8 100 -12 Z';
    // The curled middle, ring and little fingers, top to bottom.
    const FINGERS = [
        'M 132 30 C 100 22 70 26 63 46 C 58 66 72 80 98 78 C 118 76 132 70 134 60 Z',
        'M 138 76 C 104 70 70 74 65 92 C 61 108 80 117 106 115 C 126 113 140 106 142 98 Z',
        'M 160 112 C 130 106 100 110 93 124 C 88 137 106 143 128 141 C 146 139 160 132 162 124 Z'
    ];
    // The thumb, in front of the tool; its far side melts into the palm.
    const THUMB_FILL = 'M 100 -12 C 108 -18 124 -16 140 -8 C 162 4 182 24 198 48 C 214 76 236 110 240 140 ' +
        'L 200 200 L 183 183 C 150 150 120 120 106 79 C 100 56 92 30 90 12 C 89 0 92 -8 100 -12 Z';

    /**
     * A right hand holding a pencil or pen whose tip is at (0, 0). The thumb
     * points up to the tip from the front, and its lower edge is the hand's
     * lower outline; the index finger runs along the top and pinches the tool
     * from above; the other fingers curl under, peeping out past the thumb.
     */
    function holding(c, s, tool, ink) {
        const LW = 4.2;
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.strokeStyle = s.ink;
        const line = function (d, w) {
            c.lineWidth = w || LW * 0.7;
            c.stroke(new Path2D(d));
        };
        // Behind the tool: the hand's outline and the curled fingers as one
        // shape — every part stroked thickly, then all filled, so only the
        // outline around the whole is left.
        const back = [SIL].concat(FINGERS).map((d) => new Path2D(d));
        c.lineWidth = LW * 2;
        back.forEach((p) => c.stroke(p));
        c.fillStyle = s.fill;
        back.forEach((p) => c.fill(p));
        // Lines between the curled fingers: each one's edge where it lies over the next.
        c.lineWidth = LW;
        for (let i = 0; i < FINGERS.length - 1; i += 1) {
            c.save();
            c.clip(new Path2D(FINGERS[i + 1]));
            c.stroke(new Path2D(FINGERS[i]));
            c.restore();
        }
        // The index finger's joints and underside, the knuckles, and the hollow of the palm under the pencil.
        line('M 176 -74 C 186 -56 192 -40 196 -24');
        line('M 196 -24 C 216 -30 238 -34 258 -34');
        line('M 250 -104 C 254 -84 256 -60 258 -34');
        line('M 258 -34 C 274 -24 288 -14 300 -4');
        line('M 322 -36 C 316 -24 312 -16 306 -8', LW * 0.6);
        line('M 356 -22 C 350 -14 344 -8 338 -2', LW * 0.6);
        line('M 200 52 C 224 68 252 74 282 70 C 304 66 322 56 336 42');
        line('M 284 70 C 292 62 300 56 310 52', LW * 0.6);
        line('M 258 88 C 284 94 312 98 338 98', LW * 0.6);
        writingTool(c, tool, ink);
        // The thumb, in front: its lower edge is the hand's lower-left outline.
        c.strokeStyle = s.ink;
        c.fillStyle = s.fill;
        c.fill(new Path2D(THUMB_FILL));
        line('M 100 -12 C 108 -18 124 -16 140 -8 C 162 4 182 24 198 48 C 204 56 208 62 210 68', LW);
        line('M 100 -12 C 92 -8 89 0 90 12 C 92 30 100 56 106 79 C 120 120 150 150 183 183 C 192 192 198 200 202 210', LW);
        // Thumbnail and the thumb's joint.
        c.save();
        c.translate(122, 10);
        c.rotate(0.95);
        c.beginPath();
        c.ellipse(0, 0, 17, 10.5, 0, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.fill();
        c.lineWidth = LW * 0.6;
        c.stroke();
        c.restore();
        line('M 146 66 C 156 54 166 42 176 32', LW * 0.6);
    }

    /** True for colours too pale to paint a pencil with: it would vanish. */
    function pale(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return true;
        const n = parseInt(m[1], 16);
        return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.82;
    }

    /** The pencil or pen, lying to the right of its tip at (0, 0). */
    function writingTool(c, tool, ink) {
        const LW = 5;
        c.lineJoin = 'round'; c.lineWidth = LW; c.strokeStyle = '#1e1e1e';
        const paintable = ink && !pale(ink);
        if (tool === 'pen') {
            c.fillStyle = '#4a4f57'; c.beginPath(); c.moveTo(0, 0); c.lineTo(12, -3); c.lineTo(12, 3); c.closePath(); c.fill(); c.stroke();
            c.fillStyle = '#c9ccd1'; c.beginPath(); c.moveTo(12, -4); c.lineTo(52, -12); c.lineTo(52, 12); c.lineTo(12, 4); c.closePath(); c.fill(); c.stroke();
            c.fillStyle = '#23262d'; c.beginPath(); c.rect(52, -12, 80, 24); c.fill(); c.stroke();
            c.fillStyle = paintable ? ink : '#1f3c88'; c.beginPath(); c.moveTo(132, -13); c.lineTo(580, -13); c.quadraticCurveTo(610, -13, 610, 0); c.quadraticCurveTo(610, 13, 580, 13); c.lineTo(132, 13); c.closePath(); c.fill(); c.stroke();
            c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(140, -9, 430, 5);
            c.fillStyle = '#d7dbe0'; c.beginPath(); c.rect(470, -20, 110, 8); c.fill(); c.stroke();
            return;
        }
        // Graphite, sharpened wood, painted body with a facet, ferrule and eraser.
        c.fillStyle = ink || '#333333'; c.beginPath(); c.moveTo(0, 0); c.lineTo(16, -4); c.lineTo(16, 4); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#efc995'; c.beginPath(); c.moveTo(16, -4); c.lineTo(56, -13); c.lineTo(56, 13); c.lineTo(16, 4); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = paintable ? ink : '#f4c430'; c.beginPath(); c.rect(56, -13, 490, 26); c.fill(); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3; c.beginPath(); c.moveTo(56, 4); c.lineTo(546, 4); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(60, -9, 482, 5);
        c.strokeStyle = '#1e1e1e'; c.lineWidth = LW;
        c.fillStyle = '#c9ccd1'; c.beginPath(); c.rect(546, -14, 32, 28); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(556, -14); c.lineTo(556, 14); c.moveTo(566, -14); c.lineTo(566, 14); c.stroke();
        c.fillStyle = '#f08a9b'; c.beginPath(); c.moveTo(578, -14); c.lineTo(596, -14); c.quadraticCurveTo(606, -14, 606, 0); c.quadraticCurveTo(606, 14, 596, 14); c.lineTo(578, 14); c.closePath(); c.fill(); c.stroke();
    }

    const TAP_ARM = 'M 40 70 C 60 30 120 20 160 40 C 210 64 260 100 310 140 L 240 230 ' +
        'C 190 196 150 186 110 170 C 70 150 30 110 40 70 Z';
    const TAP_SLEEVE = 'M 282 112 L 380 190 L 310 290 L 214 214 Z';

    /** A hand tapping with its index finger; the fingertip is at (0, 0). */
    function tapping(c, s, press) {
        const lift = (1 - press) * 26;
        shadow(c, TAP_ARM + ' ' + TAP_SLEEVE);
        blob(c, TAP_ARM, s.fill, s.line);
        sleeve(c, TAP_SLEEVE, [[290, 124], [226, 210]]);
        // Curled middle, ring and little fingers.
        limb(c, [[96, 44], [70, 32], [64, 54]], 22, s);
        limb(c, [[124, 56], [100, 46], [94, 68]], 21, s);
        limb(c, [[150, 72], [130, 64], [124, 86]], 19, s);
        // The pointing finger, lifted and pressed.
        const finger = [[70, 70], [36 - lift * 0.3, 34 - lift * 0.6], [lift * 0.25, -lift * 0.5]];
        limb(c, finger, 20, s);
        nail(c, finger[1], finger[2], 12, 9, s);
        // The thumb, tucked along the side.
        limb(c, [[96, 112], [62, 106], [46, 88]], 22, s);
    }

    /**
     * The writing hand is drawn on a scratch canvas first, with one soft
     * shadow under the whole hand, and then its arm is faded out towards the
     * bottom — shadow and all, so no shadow shows through the fading arm.
     */
    function drawHolding(c, s, o, size) {
        const k = size / HOLD_UNIT;
        const pad = Math.ceil(60 * k) + 2;
        const w = Math.ceil(HOLD_BOX.w * k) + pad;
        const h = Math.ceil(HOLD_BOX.h * k) + pad;
        const hand = scratchCanvas(0, w, h);
        hand.setTransform(k, 0, 0, k, -HOLD_BOX.x * k, -HOLD_BOX.y * k);
        holding(hand, s, o.tool === 'pen' ? 'pen' : 'pencil', o.ink);
        const g = scratchCanvas(1, w, h);
        g.shadowColor = 'rgba(0,0,0,.3)';
        g.shadowBlur = Math.max(2, 40 * k);
        g.shadowOffsetX = 18 * k;
        g.shadowOffsetY = 26 * k;
        g.drawImage(hand.canvas, 0, 0, w, h, 0, 0, w, h);
        g.shadowColor = 'transparent';
        const top = (FADE_FROM - HOLD_BOX.y) * k;
        const fade = g.createLinearGradient(0, top, 0, (FADE_TO - HOLD_BOX.y) * k);
        fade.addColorStop(0, 'rgba(0,0,0,0)');
        fade.addColorStop(1, 'rgba(0,0,0,1)');
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = fade;
        g.fillRect(0, top, w, h - top);
        c.rotate(HOLD_TILT + (o.angle || 0));
        c.drawImage(g.canvas, 0, 0, w, h, HOLD_BOX.x * k, HOLD_BOX.y * k, w, h);
    }

    function draw(c, o) {
        const s = skinOf(o.skin);
        const size = Math.max(10, o.size || 200);
        c.save();
        c.translate(o.x, o.y);
        if (o.tool === 'finger') {
            c.scale(size / TAP_UNIT, size / TAP_UNIT);
            c.rotate((o.angle || 0) - 0.15);
            tapping(c, s, o.press === undefined ? 1 : o.press);
        } else {
            drawHolding(c, s, o, size);
        }
        c.restore();
    }

    return { draw: draw, pale: pale, SKINS: SKINS, TOOLS: TOOLS };
}));
