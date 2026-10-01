/*
 * Reel: a drawn hand that writes, draws or types.
 *
 * A right hand holding a pen or a pencil, or a hand tapping with one
 * finger, drawn with canvas paths so it needs no image files and stays
 * sharp at any size. Its point — the pen's tip or the fingertip — is
 * placed exactly at (x, y), and the arm runs off to the bottom right, out
 * of the way of what it writes.
 *
 * `ReelHands.draw(ctx, { x, y, size, tool, skin, press, angle })`
 *   tool   'pen', 'pencil' or 'finger'
 *   size   how tall the hand is, in pixels (the pen is about this long)
 *   skin   a skin colour
 *   press  0..1, how far the finger is pressed (for typing)
 *   angle  extra tilt in radians, for a little movement while writing
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReelHands = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SKINS = {
        light: { label: 'Light', fill: '#f3cfb0', shade: '#dfae8a', line: '#9c6b4e' },
        medium: { label: 'Medium', fill: '#d39b6a', shade: '#b97f50', line: '#7a4b2a' },
        tan: { label: 'Tan', fill: '#b0764a', shade: '#935f37', line: '#5e3a1f' },
        dark: { label: 'Dark', fill: '#7d4f30', shade: '#653d24', line: '#3b2212' }
    };
    const TOOLS = { pen: 'Hand with pen', pencil: 'Hand with pencil', finger: 'Hand typing' };

    // The tool is drawn pointing straight up from its tip at (0, 0), in units
    // where it is 230 long; the whole hand is then tilted so the tool leans
    // right, as a right-handed writer holds it.
    const UNIT = 230;
    const TILT = 0.6;

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

    function pencil(c) {
        // Body, then the sharpened wood, the graphite, the ferrule and the eraser.
        c.lineJoin = 'round';
        c.lineWidth = 3;
        c.strokeStyle = '#3a2a10';
        c.fillStyle = '#f4c430';
        c.beginPath(); c.rect(-10, -195, 20, 165); c.fill(); c.stroke();
        c.fillStyle = '#e0a91c';
        c.fillRect(3, -194, 6, 163);
        c.fillStyle = '#e8c48f';
        c.beginPath(); c.moveTo(-10, -30); c.lineTo(10, -30); c.lineTo(2.6, -7); c.lineTo(-2.6, -7); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#2b2b2b';
        c.beginPath(); c.moveTo(-2.6, -7); c.lineTo(2.6, -7); c.lineTo(0, 0); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#c9ccd1';
        c.beginPath(); c.rect(-10.5, -212, 21, 18); c.fill(); c.stroke();
        c.strokeStyle = '#8b9096';
        c.beginPath(); c.moveTo(-10, -206); c.lineTo(10, -206); c.moveTo(-10, -200); c.lineTo(10, -200); c.stroke();
        c.strokeStyle = '#3a2a10';
        c.fillStyle = '#f08a9b';
        c.beginPath();
        c.moveTo(-10, -212); c.lineTo(-10, -224); c.quadraticCurveTo(-10, -230, -4, -230);
        c.lineTo(4, -230); c.quadraticCurveTo(10, -230, 10, -224); c.lineTo(10, -212); c.closePath();
        c.fill(); c.stroke();
    }

    function pen(c) {
        c.lineJoin = 'round';
        c.lineWidth = 3;
        c.strokeStyle = '#12161f';
        // Barrel, with a highlight.
        c.fillStyle = '#1f3c88';
        c.beginPath();
        c.moveTo(-9, -70); c.lineTo(-10, -212); c.quadraticCurveTo(-10, -228, 0, -228);
        c.quadraticCurveTo(10, -228, 10, -212); c.lineTo(9, -70); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.25)';
        c.fillRect(-6, -210, 4, 136);
        // Clip.
        c.fillStyle = '#d7dbe0';
        c.beginPath(); c.rect(8, -212, 5, 62); c.fill(); c.stroke();
        // Rubber grip, metal cone and tip.
        c.fillStyle = '#23262d';
        c.beginPath(); c.moveTo(-9, -70); c.lineTo(9, -70); c.lineTo(8, -28); c.lineTo(-8, -28); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#c9ccd1';
        c.beginPath(); c.moveTo(-8, -28); c.lineTo(8, -28); c.lineTo(2.2, -5); c.lineTo(-2.2, -5); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#4a4f57';
        c.beginPath(); c.moveTo(-2.2, -5); c.lineTo(2.2, -5); c.lineTo(0, 0); c.closePath(); c.fill(); c.stroke();
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

    const HOLD_ARM = 'M 14 -92 C 40 -114 98 -112 130 -84 C 170 -72 230 -58 300 -46 L 300 66 ' +
        'C 240 58 190 46 150 36 C 110 34 60 28 34 6 C 18 -14 8 -58 14 -92 Z';
    const HOLD_SLEEVE = 'M 268 -60 L 380 -44 L 380 84 L 262 70 Z';

    /** A right hand holding a writing tool whose tip is at (0, 0). */
    function holding(c, tool, s) {
        shadow(c, HOLD_ARM + ' ' + HOLD_SLEEVE);
        blob(c, HOLD_ARM, s.fill, s.line);
        sleeve(c, HOLD_SLEEVE, [[278, -56], [272, 70]]);
        // Knuckles.
        c.strokeStyle = s.shade;
        c.lineWidth = 3;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(62, -104); c.quadraticCurveTo(68, -94, 64, -84);
        c.moveTo(92, -102); c.quadraticCurveTo(98, -92, 94, -82);
        c.moveTo(118, -92); c.quadraticCurveTo(124, -82, 120, -72);
        c.moveTo(150, -40); c.quadraticCurveTo(170, -30, 200, -28);
        c.stroke();
        // Ring and little fingers curled under the palm.
        limb(c, [[124, 22], [104, 36], [88, 30]], 19, s);
        limb(c, [[92, 14], [70, 28], [54, 22]], 20, s);
        // The middle finger, under the tool.
        limb(c, [[50, -26], [22, -16], [9, -8]], 18, s);
        if (tool === 'pencil') pencil(c); else pen(c);
        // The index finger lies along the top of the tool, its tip short of the point.
        const index = [[44, -100], [18, -80], [8, -46]];
        limb(c, index, 19, s);
        nail(c, index[1], index[2], 12, 9, s);
        // The thumb crosses in front from the other side.
        const thumb = [[44, -6], [16, -26], [-5, -50]];
        limb(c, thumb, 22, s);
        nail(c, thumb[1], thumb[2], 13, 10, s);
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
        c.scale(size / UNIT, size / UNIT);
        if (o.tool === 'finger') {
            c.rotate((o.angle || 0) - 0.15);
            tapping(c, s, o.press === undefined ? 1 : o.press);
        } else {
            c.rotate(TILT + (o.angle || 0));
            holding(c, o.tool, s);
        }
        c.restore();
    }

    return { draw: draw, SKINS: SKINS, TOOLS: TOOLS };
}));
