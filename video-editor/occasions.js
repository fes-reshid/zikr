/*
 * Reel: occasion videos.
 *
 * Ramadan, Eid al-Fitr, Eid al-Adha, Jumu'ah, Hajj, Laylat al-Qadr and a
 * plain nature set: each has a handful of scenes painted on the device (no
 * photos to download, no people or faces), a greeting in English and Arabic,
 * and a closing line. Add a recitation or nasheed and the scenes change on its
 * pauses; without one, each scene stays four seconds. One undo step.
 * The scenes are also offered to the Qur'an tool as backgrounds.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelOccasions = Object.assign(root.ReelOccasions || {}, api);
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ---------------------------------------------------------- painting kit */

    function rng(seed) {
        let s = seed >>> 0 || 1;
        return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }

    function sky(g, W, H, stops) {
        const gr = g.createLinearGradient(0, 0, 0, H);
        stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
    }

    function stars(g, W, H, n, seed, maxY) {
        const r = rng(seed);
        for (let i = 0; i < n; i += 1) {
            const x = r() * W;
            const y = r() * H * (maxY || 0.6);
            const s = (r() * 1.6 + 0.4) * Math.max(1, W / 1280);
            g.globalAlpha = 0.35 + r() * 0.65;
            g.fillStyle = '#fffbe8';
            g.beginPath();
            g.arc(x, y, s, 0, Math.PI * 2);
            g.fill();
        }
        g.globalAlpha = 1;
    }

    function glow(g, x, y, r, color) {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
    }

    /** A crescent moon facing right, with its glow. */
    function crescent(g, x, y, r, color) {
        glow(g, x, y, r * 3.2, 'rgba(255,240,190,.22)');
        // The moon's disc, minus an offset disc: clipped so the sky behind stays painted.
        g.save();
        g.beginPath();
        g.rect(x - r * 2, y - r * 2, r * 4, r * 4);
        g.arc(x + r * 0.42, y - r * 0.18, r * 0.86, 0, Math.PI * 2, true);
        g.clip('evenodd');
        g.fillStyle = color || '#f6e7b0';
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
    }

    function star5(g, x, y, r, color) {
        g.fillStyle = color;
        g.beginPath();
        for (let i = 0; i < 10; i += 1) {
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const rr = i % 2 ? r * 0.45 : r;
            g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
    }

    /** A mosque: dome, drum, hall and two minarets, centred on `x`, standing on `base`. */
    function mosque(g, x, base, s, color, lit) {
        g.fillStyle = color;
        const hallW = 340 * s;
        const hallH = 130 * s;
        g.fillRect(x - hallW / 2, base - hallH, hallW, hallH);
        g.fillRect(x - 95 * s, base - hallH - 40 * s, 190 * s, 40 * s);
        g.beginPath();
        g.moveTo(x - 110 * s, base - hallH - 40 * s);
        g.bezierCurveTo(x - 120 * s, base - hallH - 190 * s, x + 120 * s, base - hallH - 190 * s, x + 110 * s, base - hallH - 40 * s);
        g.fill();
        g.fillRect(x - 3 * s, base - hallH - 200 * s, 6 * s, 40 * s);
        crescentTop(g, x, base - hallH - 210 * s, 9 * s, color);
        [-1, 1].forEach(function (side) {
            const mx = x + side * (hallW / 2 + 40 * s);
            g.fillRect(mx - 13 * s, base - 330 * s, 26 * s, 330 * s);
            g.fillRect(mx - 19 * s, base - 250 * s, 38 * s, 10 * s);
            g.beginPath();
            g.moveTo(mx - 15 * s, base - 330 * s);
            g.lineTo(mx, base - 390 * s);
            g.lineTo(mx + 15 * s, base - 330 * s);
            g.fill();
            // The two small domes beside the main one.
            g.beginPath();
            g.arc(x + side * 120 * s, base - hallH, 45 * s, Math.PI, 0);
            g.fill();
        });
        if (lit) {
            g.fillStyle = lit;
            for (let i = -2; i <= 2; i += 1) {
                const wx = x + i * 55 * s;
                g.beginPath();
                g.moveTo(wx - 12 * s, base - 20 * s);
                g.lineTo(wx - 12 * s, base - 70 * s);
                g.quadraticCurveTo(wx, base - 92 * s, wx + 12 * s, base - 70 * s);
                g.lineTo(wx + 12 * s, base - 20 * s);
                g.fill();
            }
        }
    }

    function crescentTop(g, x, y, r, color) {
        g.save();
        g.strokeStyle = color;
        g.lineWidth = r * 0.45;
        g.beginPath();
        g.arc(x, y, r, Math.PI * 0.25, Math.PI * 1.75, false);
        g.stroke();
        g.restore();
    }

    /** A hanging lantern on a cord from the top edge. */
    function lantern(g, x, y, s, body, light) {
        g.strokeStyle = 'rgba(230,200,140,.8)';
        g.lineWidth = 2 * s;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, y - 46 * s);
        g.stroke();
        glow(g, x, y, 120 * s, light || 'rgba(255,190,90,.45)');
        g.fillStyle = body;
        g.beginPath();
        g.moveTo(x - 12 * s, y - 46 * s);
        g.lineTo(x + 12 * s, y - 46 * s);
        g.lineTo(x + 30 * s, y - 20 * s);
        g.lineTo(x - 30 * s, y - 20 * s);
        g.closePath();
        g.fill();
        g.fillStyle = '#ffd98a';
        g.beginPath();
        g.moveTo(x - 30 * s, y - 20 * s);
        g.lineTo(x + 30 * s, y - 20 * s);
        g.lineTo(x + 22 * s, y + 40 * s);
        g.lineTo(x - 22 * s, y + 40 * s);
        g.closePath();
        g.fill();
        g.strokeStyle = body;
        g.lineWidth = 3 * s;
        for (let i = -1; i <= 1; i += 1) {
            g.beginPath();
            g.moveTo(x + i * 14 * s, y - 20 * s);
            g.lineTo(x + i * 11 * s, y + 40 * s);
            g.stroke();
        }
        g.fillStyle = body;
        g.beginPath();
        g.moveTo(x - 24 * s, y + 40 * s);
        g.lineTo(x + 24 * s, y + 40 * s);
        g.lineTo(x, y + 66 * s);
        g.closePath();
        g.fill();
    }

    function hills(g, W, H, y, amp, color, phase) {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 40) g.lineTo(x, y + Math.sin(x / W * Math.PI * 2 + (phase || 0)) * amp + Math.sin(x / W * Math.PI * 5 + 1 + (phase || 0)) * amp * 0.3);
        g.lineTo(W, H);
        g.closePath();
        g.fill();
    }

    function sun(g, x, y, r, color) {
        glow(g, x, y, r * 4, 'rgba(255,220,150,.35)');
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
    }

    function sparkles(g, W, H, n, seed, colors) {
        const r = rng(seed);
        for (let i = 0; i < n; i += 1) {
            const x = r() * W;
            const y = r() * H;
            const s = (2 + r() * 7) * W / 1280;
            g.globalAlpha = 0.4 + r() * 0.6;
            star5(g, x, y, s, colors[i % colors.length]);
        }
        g.globalAlpha = 1;
    }

    function kaaba(g, x, base, s) {
        // The Kaaba: a black cube with its gold band and door, seen from a corner.
        g.fillStyle = '#121212';
        g.beginPath();
        g.moveTo(x - 160 * s, base - 30 * s);
        g.lineTo(x, base);
        g.lineTo(x, base - 260 * s);
        g.lineTo(x - 160 * s, base - 280 * s);
        g.fill();
        g.fillStyle = '#1c1c1c';
        g.beginPath();
        g.moveTo(x, base);
        g.lineTo(x + 190 * s, base - 34 * s);
        g.lineTo(x + 190 * s, base - 284 * s);
        g.lineTo(x, base - 260 * s);
        g.fill();
        g.fillStyle = '#0a0a0a';
        g.beginPath();
        g.moveTo(x - 160 * s, base - 280 * s);
        g.lineTo(x, base - 260 * s);
        g.lineTo(x + 190 * s, base - 284 * s);
        g.lineTo(x + 30 * s, base - 300 * s);
        g.fill();
        g.fillStyle = '#d4af37';
        g.beginPath();
        g.moveTo(x - 160 * s, base - 230 * s);
        g.lineTo(x, base - 210 * s);
        g.lineTo(x + 190 * s, base - 234 * s);
        g.lineTo(x + 190 * s, base - 214 * s);
        g.lineTo(x, base - 190 * s);
        g.lineTo(x - 160 * s, base - 210 * s);
        g.fill();
        g.fillRect(x + 70 * s, base - 160 * s, 48 * s, 110 * s);
    }

    function tents(g, W, base, rows, color, shade) {
        for (let r = 0; r < rows; r += 1) {
            const y = base + r * 34 * W / 1280;
            const size = (26 + r * 8) * W / 1280;
            for (let x = -size + (r % 2) * size; x < W + size; x += size * 2.1) {
                g.fillStyle = color;
                g.beginPath();
                g.moveTo(x - size, y);
                g.lineTo(x, y - size * 0.9);
                g.lineTo(x + size, y);
                g.fill();
                g.fillStyle = shade;
                g.beginPath();
                g.moveTo(x, y - size * 0.9);
                g.lineTo(x + size, y);
                g.lineTo(x + size * 0.3, y);
                g.fill();
            }
        }
    }

    function book(g, x, y, s) {
        // An open book on a wooden stand.
        g.fillStyle = '#6b3e1f';
        g.beginPath();
        g.moveTo(x - 150 * s, y + 110 * s);
        g.lineTo(x, y + 20 * s);
        g.lineTo(x + 150 * s, y + 110 * s);
        g.lineTo(x + 120 * s, y + 125 * s);
        g.lineTo(x, y + 55 * s);
        g.lineTo(x - 120 * s, y + 125 * s);
        g.fill();
        [-1, 1].forEach(function (side) {
            g.fillStyle = '#f4ead2';
            g.beginPath();
            g.moveTo(x, y + 20 * s);
            g.quadraticCurveTo(x + side * 80 * s, y - 20 * s, x + side * 170 * s, y + 5 * s);
            g.lineTo(x + side * 150 * s, y + 85 * s);
            g.quadraticCurveTo(x + side * 80 * s, y + 60 * s, x, y + 95 * s);
            g.fill();
            g.strokeStyle = 'rgba(120,90,50,.35)';
            g.lineWidth = 2 * s;
            for (let l = 0; l < 5; l += 1) {
                g.beginPath();
                g.moveTo(x + side * 20 * s, y + (32 + l * 11) * s);
                g.quadraticCurveTo(x + side * 80 * s, y + (8 + l * 11) * s, x + side * 140 * s, y + (24 + l * 11) * s);
                g.stroke();
            }
        });
        g.strokeStyle = '#c99a2e';
        g.lineWidth = 3 * s;
        g.beginPath();
        g.moveTo(x, y + 20 * s);
        g.lineTo(x, y + 95 * s);
        g.stroke();
    }

    function dates(g, x, y, s) {
        // A bowl of dates and a glass of water, for iftar.
        g.fillStyle = '#e9e1cf';
        g.beginPath();
        g.ellipse(x, y, 150 * s, 34 * s, 0, 0, Math.PI);
        g.fill();
        const r = rng(7);
        for (let i = 0; i < 11; i += 1) {
            g.fillStyle = i % 2 ? '#5a2a14' : '#6e3418';
            g.beginPath();
            g.ellipse(x - 110 * s + i * 22 * s, y - 8 * s - (i % 3) * 9 * s, 22 * s, 13 * s, r() - 0.5, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = 'rgba(200,230,255,.45)';
        g.fillRect(x + 200 * s, y - 120 * s, 70 * s, 150 * s);
        g.fillStyle = 'rgba(160,210,255,.55)';
        g.fillRect(x + 204 * s, y - 70 * s, 62 * s, 96 * s);
    }

    function ground(g, W, H, y, color) {
        g.fillStyle = color;
        g.fillRect(0, y, W, H - y);
    }

    /* ----------------------------------------------------------- the scenes */

    /** Each scene paints a W×H canvas context; sizes scale from a 1280-wide design. */
    const SCENES = {
        'night-crescent': function (g, W, H) {
            sky(g, W, H, ['#070b1f', '#1b2350', '#3b3560']);
            stars(g, W, H, 220, 3);
            crescent(g, W * 0.72, H * 0.26, H * 0.11);
            hills(g, W, H, H * 0.8, H * 0.03, '#120f24', 0.5);
            mosque(g, W * 0.3, H * 0.86, W / 1700, '#0b0918', '#ffcf73');
        },
        'lanterns': function (g, W, H) {
            sky(g, W, H, ['#160b2a', '#3a1747', '#6d2b4d']);
            stars(g, W, H, 90, 11, 0.5);
            const s = W / 1280;
            [[0.16, 0.38, 1.1], [0.34, 0.27, 0.8], [0.52, 0.46, 1.3], [0.7, 0.3, 0.9], [0.86, 0.42, 1.15]]
                .forEach((l, i) => lantern(g, W * l[0], H * l[1], s * l[2], ['#b5832a', '#8a5a1e', '#c9962f'][i % 3]));
        },
        'iftar': function (g, W, H) {
            sky(g, W, H, ['#2a1638', '#a04a3a', '#f0a35b']);
            sun(g, W * 0.5, H * 0.62, H * 0.08, '#ffd27a');
            hills(g, W, H, H * 0.64, H * 0.02, '#5a2a2a', 1);
            ground(g, W, H, H * 0.7, '#3a1c18');
            g.fillStyle = '#7a4a2a';
            g.fillRect(0, H * 0.76, W, H * 0.24);
            dates(g, W * 0.42, H * 0.86, W / 1280);
        },
        'desert-dusk': function (g, W, H) {
            sky(g, W, H, ['#13183d', '#6a3f6b', '#f2a65a']);
            stars(g, W, H, 60, 21, 0.35);
            crescent(g, W * 0.2, H * 0.22, H * 0.06);
            hills(g, W, H, H * 0.7, H * 0.05, '#b8693a', 0);
            hills(g, W, H, H * 0.8, H * 0.04, '#8f4a26', 2);
            hills(g, W, H, H * 0.9, H * 0.03, '#6a3418', 4);
        },
        'mosque-dawn': function (g, W, H) {
            sky(g, W, H, ['#1d2b64', '#7b5ea7', '#f8a978']);
            sun(g, W * 0.75, H * 0.66, H * 0.07, '#ffe2a8');
            ground(g, W, H, H * 0.8, '#26213b');
            mosque(g, W * 0.5, H * 0.8, W / 1500, '#26213b');
        },
        'green-dome': function (g, W, H) {
            sky(g, W, H, ['#8fd3f4', '#c2e9fb', '#fdf6e3']);
            sun(g, W * 0.2, H * 0.2, H * 0.06, '#fff6d5');
            ground(g, W, H, H * 0.8, '#d9c9a3');
            mosque(g, W * 0.55, H * 0.8, W / 1500, '#e8dcc0');
            // The green dome over the hall.
            const s = W / 1500;
            const x = W * 0.55;
            const base = H * 0.8 - 130 * s - 40 * s;
            g.fillStyle = '#1f7a4d';
            g.beginPath();
            g.moveTo(x - 110 * s, base);
            g.bezierCurveTo(x - 120 * s, base - 150 * s, x + 120 * s, base - 150 * s, x + 110 * s, base);
            g.fill();
        },
        'quran-stand': function (g, W, H) {
            sky(g, W, H, ['#0d2a24', '#134e43', '#1d6b5a']);
            glow(g, W * 0.5, H * 0.45, H * 0.55, 'rgba(255,215,140,.25)');
            sparkles(g, W, H * 0.7, 40, 5, ['#e8c66a', '#fff1c1']);
            book(g, W * 0.5, H * 0.5, W / 900);
        },
        'eid-sparkle': function (g, W, H) {
            sky(g, W, H, ['#0b3d2e', '#0f5c4c', '#127a63']);
            sparkles(g, W, H, 160, 9, ['#e6c77d', '#fff3c4', '#f2d27a']);
            crescent(g, W * 0.5, H * 0.42, H * 0.18, '#f2d27a');
            star5(g, W * 0.6, H * 0.36, H * 0.035, '#fff3c4');
        },
        'eid-fireworks': function (g, W, H) {
            sky(g, W, H, ['#05060f', '#141a3a', '#2a2f5a']);
            const r = rng(13);
            [[0.25, 0.3, '#f2d27a'], [0.55, 0.22, '#7fd1c7'], [0.8, 0.34, '#f4a3c0'], [0.4, 0.45, '#ffffff']].forEach(function (f) {
                const cx = W * f[0];
                const cy = H * f[1];
                glow(g, cx, cy, H * 0.16, 'rgba(255,255,255,.08)');
                g.strokeStyle = f[2];
                g.lineWidth = 2.2 * W / 1280;
                for (let i = 0; i < 28; i += 1) {
                    const a = i / 28 * Math.PI * 2;
                    const len = H * (0.08 + r() * 0.06);
                    g.beginPath();
                    g.moveTo(cx + Math.cos(a) * len * 0.3, cy + Math.sin(a) * len * 0.3);
                    g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
                    g.stroke();
                }
            });
            ground(g, W, H, H * 0.86, '#05050b');
            mosque(g, W * 0.5, H * 0.86, W / 2000, '#05050b', '#ffcf73');
        },
        'eid-sheep-field': function (g, W, H) {
            // Eid al-Adha: a calm green field at sunrise, with a flock in the distance.
            sky(g, W, H, ['#f6d365', '#fda085', '#fbc2a4']);
            sun(g, W * 0.3, H * 0.5, H * 0.07, '#fff1c9');
            hills(g, W, H, H * 0.62, H * 0.04, '#7fb26a', 0.3);
            hills(g, W, H, H * 0.74, H * 0.03, '#5a9a4d', 2.2);
            const r = rng(17);
            for (let i = 0; i < 9; i += 1) {
                const x = W * (0.55 + r() * 0.35);
                const y = H * (0.7 + r() * 0.06);
                const s = W / 1280 * (0.8 + r() * 0.4);
                g.fillStyle = '#f5f1e6';
                g.beginPath();
                g.ellipse(x, y, 16 * s, 10 * s, 0, 0, Math.PI * 2);
                g.fill();
                g.fillStyle = '#3a3a3a';
                g.beginPath();
                g.ellipse(x + 15 * s, y - 3 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2);
                g.fill();
            }
        },
        'kaaba': function (g, W, H) {
            sky(g, W, H, ['#0a1530', '#1f2f5a', '#3a4a7a']);
            stars(g, W, H, 80, 31, 0.4);
            ground(g, W, H, H * 0.72, '#e9e5dc');
            // The circles of the mataf around the Kaaba.
            g.strokeStyle = 'rgba(160,150,140,.35)';
            g.lineWidth = 2 * W / 1280;
            for (let i = 1; i <= 6; i += 1) {
                g.beginPath();
                g.ellipse(W * 0.5, H * 0.86, W * 0.08 * i, H * 0.025 * i, 0, 0, Math.PI * 2);
                g.stroke();
            }
            kaaba(g, W * 0.5, H * 0.86, W / 1500);
        },
        'arafat': function (g, W, H) {
            sky(g, W, H, ['#fbd786', '#f7797d', '#c6426e']);
            sun(g, W * 0.68, H * 0.42, H * 0.07, '#fff3d1');
            g.fillStyle = '#7a4a3a';
            g.beginPath();
            g.moveTo(W * 0.2, H * 0.8);
            g.quadraticCurveTo(W * 0.42, H * 0.38, W * 0.66, H * 0.8);
            g.fill();
            g.fillStyle = '#f5f0e6';
            g.fillRect(W * 0.425, H * 0.5, W * 0.008, H * 0.08);
            ground(g, W, H, H * 0.8, '#a9764f');
        },
        'mina-tents': function (g, W, H) {
            sky(g, W, H, ['#89c4f4', '#c9e6fb', '#f7f3e8']);
            hills(g, W, H, H * 0.5, H * 0.05, '#b89b7a', 0.8);
            ground(g, W, H, H * 0.58, '#d8c7a8');
            tents(g, W, H * 0.64, 9, '#fbfbf7', '#dedbd2');
        },
        'mountain-lake': function (g, W, H) {
            sky(g, W, H, ['#4facfe', '#a1d8ff', '#e8f6ff']);
            g.fillStyle = '#6c7a96';
            g.beginPath();
            g.moveTo(0, H * 0.62);
            g.lineTo(W * 0.22, H * 0.3);
            g.lineTo(W * 0.4, H * 0.55);
            g.lineTo(W * 0.62, H * 0.22);
            g.lineTo(W * 0.85, H * 0.5);
            g.lineTo(W, H * 0.38);
            g.lineTo(W, H * 0.62);
            g.fill();
            g.fillStyle = '#f5f8ff';
            [[0.22, 0.3], [0.62, 0.22]].forEach(function (p) {
                g.beginPath();
                g.moveTo(W * p[0], H * p[1]);
                g.lineTo(W * (p[0] - 0.05), H * (p[1] + 0.08));
                g.lineTo(W * (p[0] + 0.05), H * (p[1] + 0.08));
                g.fill();
            });
            const lake = g.createLinearGradient(0, H * 0.62, 0, H);
            lake.addColorStop(0, '#5d9bd6');
            lake.addColorStop(1, '#1d4f8a');
            g.fillStyle = lake;
            g.fillRect(0, H * 0.62, W, H * 0.38);
            hills(g, W, H, H * 0.86, H * 0.02, '#2f6b3a', 1.5);
        },
        'forest-sun': function (g, W, H) {
            sky(g, W, H, ['#ffe29f', '#ffa99f', '#ff719a']);
            sun(g, W * 0.5, H * 0.55, H * 0.1, '#fff4d6');
            const r = rng(41);
            for (let layer = 0; layer < 3; layer += 1) {
                g.fillStyle = ['#7a3b5a', '#4a2340', '#2a1226'][layer];
                for (let x = -40; x < W + 40; x += 40 + r() * 50) {
                    const h = H * (0.18 + r() * 0.12 + layer * 0.05);
                    const base = H * (0.78 + layer * 0.08);
                    g.beginPath();
                    g.moveTo(x - 30 * W / 1280, base);
                    g.lineTo(x, base - h);
                    g.lineTo(x + 30 * W / 1280, base);
                    g.fill();
                }
                g.fillRect(0, H * (0.78 + layer * 0.08), W, H);
            }
        },
        'sea-sunset': function (g, W, H) {
            sky(g, W, H, ['#2b5876', '#8e5c9a', '#f6a55a']);
            sun(g, W * 0.5, H * 0.6, H * 0.08, '#ffd89a');
            const sea = g.createLinearGradient(0, H * 0.62, 0, H);
            sea.addColorStop(0, '#5a4a7a');
            sea.addColorStop(1, '#1a2240');
            g.fillStyle = sea;
            g.fillRect(0, H * 0.62, W, H * 0.38);
            g.fillStyle = 'rgba(255,216,154,.5)';
            for (let i = 0; i < 12; i += 1) g.fillRect(W * 0.5 - (60 - i * 4) * W / 1280, H * (0.64 + i * 0.025), (120 - i * 8) * W / 1280, 3 * W / 1280);
        }
    };

    const OCCASIONS = {
        ramadan: {
            label: 'Ramadan', title: 'Ramadan Mubarak', arabic: 'رمضان مبارك', sub: 'May Allah accept your fasting and prayers',
            end: 'Ramadan Kareem', scenes: ['night-crescent', 'lanterns', 'iftar', 'desert-dusk', 'quran-stand'], color: '#f2d27a'
        },
        'eid-fitr': {
            label: 'Eid al-Fitr', title: 'Eid Mubarak', arabic: 'عيد مبارك', sub: 'Taqabbal Allahu minna wa minkum',
            end: 'Eid Mubarak to you and your family', scenes: ['eid-sparkle', 'eid-fireworks', 'mosque-dawn', 'lanterns', 'green-dome'], color: '#f2d27a'
        },
        'eid-adha': {
            label: 'Eid al-Adha', title: 'Eid al-Adha Mubarak', arabic: 'عيد أضحى مبارك', sub: 'Taqabbal Allahu minna wa minkum',
            end: 'Eid Mubarak', scenes: ['eid-sheep-field', 'kaaba', 'eid-sparkle', 'mosque-dawn', 'arafat'], color: '#ffffff'
        },
        jumuah: {
            label: 'Jumu‘ah', title: 'Jumu‘ah Mubarak', arabic: 'جمعة مباركة', sub: 'Read Surah al-Kahf and send salawat on the Prophet ﷺ',
            end: 'Jumu‘ah Mubarak', scenes: ['mosque-dawn', 'green-dome', 'quran-stand', 'sea-sunset', 'mountain-lake'], color: '#ffffff'
        },
        hajj: {
            label: 'Hajj', title: 'Labbayk Allahumma labbayk', arabic: 'لبيك اللهم لبيك', sub: 'May Allah accept the Hajj of every pilgrim',
            end: 'Hajj Mabrur', scenes: ['kaaba', 'arafat', 'mina-tents', 'desert-dusk', 'night-crescent'], color: '#ffffff'
        },
        qadr: {
            label: 'Laylat al-Qadr', title: 'Laylat al-Qadr', arabic: 'ليلة القدر خير من ألف شهر', sub: 'Better than a thousand months',
            end: 'Seek it in the last ten nights', scenes: ['night-crescent', 'quran-stand', 'lanterns', 'desert-dusk', 'eid-sparkle'], color: '#f2d27a'
        },
        nature: {
            label: 'Nature (any day)', title: 'SubhanAllah', arabic: 'سبحان الله', sub: 'Reflect on the signs of Allah',
            end: 'Alhamdulillah', scenes: ['mountain-lake', 'sea-sunset', 'forest-sun', 'desert-dusk', 'mosque-dawn'], color: '#ffffff'
        }
    };

    function paintScene(name, W, H, canvas) {
        const c = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
        if (!c) throw new Error('No canvas to paint on.');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        (SCENES[name] || SCENES['mountain-lake'])(g, W, H);
        return c;
    }

    return { OCCASIONS, SCENES, paintScene };
}));

/* ---------------------------------------------------------------- the dialog */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp) return;
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const O = window.ReelOccasions;

    /** The scenes of a set as PNG files the size of the frame. */
    async function sceneFiles(names, W, H, label) {
        const files = [];
        for (const name of names) {
            const c = O.paintScene(name, W, H);
            const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
            files.push(new File([blob], (label ? label + ' – ' : '') + name.replace(/-/g, ' ') + '.png', { type: 'image/png', lastModified: Date.now() }));
        }
        return files;
    }

    /** Imports a set's scenes without an undo step of their own; resolves to their media ids. */
    async function importScenes(key, project) {
        const occ = O.OCCASIONS[key] || O.OCCASIONS.nature;
        return app.importFiles(await sceneFiles(occ.scenes, project.width, project.height, occ.label), { noCommit: true, fresh: true, origin: 'occasion' });
    }

    function titleClip(track, start, duration, text, patch) {
        return Object.assign(T.textClip(track, start, text), { duration: duration, fadeIn: 0.3, fadeOut: 0.4, shadow: true, bold: true }, patch);
    }

    /**
     * Makes an occasion video: `o` = { occasion, title, arabic, sub, end, voiceId|null, secondsEach }.
     * The scenes go after what is on the timeline, or under the chosen voice.
     */
    async function makeOccasion(o) {
        const occ = O.OCCASIONS[o.occasion] || O.OCCASIONS.nature;
        const ids = await importScenes(o.occasion, app.state.project);
        if (!ids.length) throw new Error('The scenes could not be made.');
        let p = app.state.project;
        const voice = o.voiceId ? T.getClip(p, o.voiceId) : null;
        let from;
        let to;
        let cuts;
        if (voice) {
            from = voice.start;
            to = T.clipEnd(voice);
            const sound = await window.ReelPauses.soundPeaks(p, voice.id, from, to);
            const pauses = sound ? window.ReelPauses.pausesOf(sound, { minPause: 0.35, sensitivity: 0.5 }) : [];
            const want = Math.max(2.5, (to - from) / Math.max(ids.length, Math.round((to - from) / 6)));
            cuts = T.pauseCuts(pauses, from, to, Math.min(want, 6));
            if (!cuts.length) for (let t = from + 4; t < to - 1.5; t += 4) cuts.push(t);
        } else {
            from = T.projectDuration(p);
            const each = o.secondsEach || 4;
            to = from + each * ids.length;
            cuts = ids.slice(1).map((x, i) => from + each * (i + 1));
        }
        p = window.ReelPauses.picturesOnCuts(p, ids, from, to, cuts, { trackName: occ.label + ' scenes', transition: 'crossfade', kenBurns: true });
        const length = to - from;
        const first = Math.min(5, Math.max(2.5, (cuts[0] || to) - from));
        const titleTrack = T.nextTrackId(p, 'text');
        p = T.addTrack(p, 'text', occ.label + ' greeting');
        p = T.addClip(p, titleClip(titleTrack, from + 0.3, first - 0.3, o.title, { fontSize: 72, color: occ.color, y: 0.4, anim: 'zoom-in', animDuration: 0.9, exit: 'fade' }));
        if (o.arabic) {
            const arTrack = T.nextTrackId(p, 'text');
            p = T.addTrack(p, 'text', occ.label + ' Arabic');
            p = T.addClip(p, titleClip(arTrack, from + 0.8, first - 0.8, o.arabic, { font: 'naskh', fontSize: 56, color: '#ffffff', y: 0.58, anim: 'fade', exit: 'fade' }));
        }
        if (o.sub && length > first + 2) {
            p = T.addClip(p, titleClip(titleTrack, from + first + 0.2, Math.min(5, length - first - 2.4), o.sub, { fontSize: 40, y: 0.82, box: true, boxColor: '#000000', anim: 'rise', exit: 'fade' }));
        }
        if (o.end && length > 6) {
            const endStart = Math.max(from + first + 0.4, to - 3.5);
            const room = T.trackClips(p, titleTrack).every((c) => T.clipEnd(c) <= endStart + 1e-6);
            if (room) p = T.addClip(p, titleClip(titleTrack, endStart, to - endStart, o.end, { fontSize: 60, color: occ.color, y: 0.45, anim: 'pop', exit: 'fade' }));
        }
        app.apply(p);
        app.zoomToFit();
        app.seek(from + 1.2);
        return { scenes: ids.length, from: from, to: to };
    }

    function openOccasion() {
        app.pause();
        const occasion = el('select', null, Object.keys(O.OCCASIONS).map((k) => el('option', { value: k, text: O.OCCASIONS[k].label })));
        const title = el('input', { type: 'text', maxlength: 80 });
        const arabic = el('input', { type: 'text', maxlength: 80, dir: 'rtl' });
        const sub = el('input', { type: 'text', maxlength: 120 });
        const end = el('input', { type: 'text', maxlength: 120 });
        const preview = el('div', { className: 'occasion-preview' });
        const fill = function () {
            const occ = O.OCCASIONS[occasion.value];
            const kit = window.ReelBrand && window.ReelBrand.get();
            title.value = occ.title;
            arabic.value = occ.arabic;
            sub.value = occ.sub;
            end.value = occ.end + (kit && kit.name ? ' — ' + kit.name : '');
            preview.textContent = '';
            occ.scenes.forEach(function (name) {
                const c = O.paintScene(name, 192, 108);
                c.setAttribute('aria-hidden', 'true');
                preview.append(c);
            });
        };
        occasion.addEventListener('change', fill);
        fill();
        const voices = window.ReelPauses ? window.ReelPauses.voiceClips(app.state.project) : [];
        const voice = el('select', null, [el('option', { value: '', text: 'No voice — each scene stays 4 seconds' })].concat(voices.map(function (c) {
            const m = T.getMedia(app.state.project, c.mediaId);
            return el('option', { value: c.id, text: 'Change on the pauses of: ' + (m ? m.name : 'clip') + ' (' + app.fmt(c.duration) + ')' });
        })));
        const sel = app.state.selected && voices.find((c) => c.id === app.state.selected);
        if (sel) voice.value = sel.id; else if (voices.length) voice.value = voices[0].id;
        app.openDialog({
            title: 'Occasion video',
            wide: true,
            intro: 'Scenes painted on this device for the occasion, with a greeting. Put a recitation or nasheed on the timeline first and the scenes change on its pauses.',
            body: [
                app.dialogField('Occasion', occasion), preview,
                el('div', { className: 'field-pair' }, [app.dialogField('Greeting', title), app.dialogField('In Arabic', arabic)]),
                app.dialogField('Second line', sub), app.dialogField('Closing line', end),
                app.dialogField('Timing', voice, voices.length ? '' : 'Tip: add a recitation or nasheed first, then the scenes follow its pauses.')
            ],
            actions: [{ label: 'Cancel' }, {
                label: 'Make video', primary: true, run: async function (d) {
                    d.busy(true);
                    d.status('Painting the scenes…');
                    try {
                        const r = await makeOccasion({ occasion: occasion.value, title: title.value.trim(), arabic: arabic.value.trim(), sub: sub.value.trim(), end: end.value.trim(), voiceId: voice.value || null });
                        app.toast(r.scenes + ' scenes and the greeting are on the timeline. Press Space to watch.');
                    } catch (err) { d.busy(false); d.status(err.message); return false; }
                    return true;
                }
            }]
        });
    }

    app.addTool({ section: 'Create', label: 'Occasion video (Ramadan, Eid, Jumu‘ah, Hajj)…', run: openOccasion });
    Object.assign(window.ReelOccasions, { openOccasion, makeOccasion, sceneFiles, importScenes });
}());
