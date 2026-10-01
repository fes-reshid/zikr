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
        outline: { label: 'Line art', fill: '#ffffff', shade: '#c8c8c8', line: '#1a1a1a', ink: '#141414', sleeve: '#ffffff' }
    };
    const TOOLS = { pen: 'Hand with pen', pencil: 'Hand with pencil', finger: 'Hand typing' };

    // The writing hand is drawn with its tool lying flat to the right of its
    // tip at (0, 0), in units where the pencil is 610 long, then tipped a
    // little so the tool slopes gently down to the right. The typing hand is
    // drawn in units where it is about 230 tall.
    const HOLD_UNIT = 610;
    const HOLD_TILT = 0.05;
    const TAP_UNIT = 230;

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

    /** A right hand holding a pencil or pen whose tip is at (0, 0), in sketch style. */
    function holding(c, s, tool, ink) {
        const LW = 6;
        const fill = (d, colour) => { c.fillStyle = colour; c.fill(new Path2D(d)); };
        const line = (d, w) => { c.lineWidth = w || LW; c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = s.ink; c.stroke(new Path2D(d)); };
        const outline = (d, colour) => { fill(d, colour); line(d); };
        // Hand and arm behind the pencil; the outline leaves the cut end of the arm open.
        const contour = 'M 540 380 C 500 310 470 230 464 150 C 458 90 464 30 452 -16 C 436 -66 392 -102 336 -120 ' +
            'C 292 -134 240 -128 204 -104 C 158 -96 120 -66 112 -22 C 96 -6 78 6 70 30 C 60 60 70 100 96 120 ' +
            'C 126 140 160 156 186 196 C 214 248 236 300 258 380';
        const arm = contour + ' L 258 700 L 560 700 Z';
        shadow(c, arm);
        fill(arm, s.fill);
        line(contour);
        // Knuckles and back-of-hand lines.
        line('M 236 -112 C 262 -96 274 -78 276 -58', LW * 0.7);
        line('M 318 -122 C 330 -104 336 -86 332 -66', LW * 0.7);
        line('M 398 -92 C 404 -76 404 -60 398 -44', LW * 0.7);
        line('M 300 210 C 330 196 370 192 404 200', LW * 0.6);
        // A shirt cuff over the wrist.
        outline('M 236 350 C 330 364 450 366 552 348 L 600 720 L 250 720 Z', s.sleeve || '#e8ecf1');
        line('M 244 384 C 330 398 450 400 556 382', LW * 0.6);
        // Middle, ring and little fingers tucked under, the little one lowest.
        outline('M 124 118 C 100 126 80 122 78 106 C 76 90 94 82 120 84 C 140 86 150 100 148 112 C 146 120 136 122 124 118 Z', s.fill);
        outline('M 104 88 C 78 94 58 88 58 70 C 58 52 80 46 108 50 C 132 54 142 70 136 82 C 130 92 118 92 104 88 Z', s.fill);
        outline('M 98 50 C 72 54 52 46 54 28 C 56 12 78 6 104 12 C 128 18 138 34 130 46 C 124 54 112 54 98 50 Z', s.fill);
        writingTool(c, tool, ink);
        // The index finger curls over the top of the pencil.
        outline('M 112 -22 C 106 -46 124 -70 158 -78 C 190 -84 218 -72 224 -50 C 228 -32 214 -14 196 -12 ' +
            'L 124 -12 C 117 -13 113 -17 112 -22 Z', s.fill);
        line('M 190 -76 C 182 -58 182 -36 190 -16', LW * 0.6);
        // The thumb presses in front near the point; its base blends into the palm.
        fill('M 96 -14 C 92 -30 104 -42 124 -40 C 160 -34 205 -8 246 22 L 268 64 L 222 100 C 196 80 160 52 128 30 C 108 16 98 2 96 -14 Z', s.fill);
        line('M 96 -14 C 92 -30 104 -42 124 -40 C 160 -34 205 -8 246 22');
        line('M 96 -14 C 98 2 108 16 128 30 C 160 52 196 80 222 100');
        c.save(); c.translate(116, -20); c.rotate(0.42);
        c.beginPath(); c.ellipse(0, 0, 17, 12, 0, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,.45)'; c.fill(); c.lineWidth = LW * 0.6; c.strokeStyle = s.ink; c.stroke(); c.restore();
        line('M 176 24 C 190 34 198 48 198 62', LW * 0.6);
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
            c.scale(size / HOLD_UNIT, size / HOLD_UNIT);
            c.rotate(HOLD_TILT + (o.angle || 0));
            holding(c, s, o.tool === 'pen' ? 'pen' : 'pencil', o.ink);
        }
        c.restore();
    }

    return { draw: draw, pale: pale, SKINS: SKINS, TOOLS: TOOLS };
}));
