#!/usr/bin/env node
/*
 * Renders the app icons from one SVG, so the home-screen icon matches the
 * site's brand mark. Run with `npm run icons`; the PNGs are committed, so a
 * normal build needs neither a browser nor this script.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const OUT = path.join(__dirname, '..', 'src', 'icons');
const GREEN = '#2e6b58';
const GREEN_DARK = '#1f4f40';
const PARCHMENT = '#faf3e0';
const GOLD = '#d3ac5c';

/** `pad` leaves the safe zone a maskable icon needs (Android crops to a shape). */
function markup(size, pad, round) {
    const inner = size * (1 - pad * 2);
    const glyph = Math.round(inner * 0.72);
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;}
  .bg{width:${size}px;height:${size}px;background:${GREEN_DARK};display:flex;align-items:center;justify-content:center;}
  .disc{
    width:${inner}px;height:${inner}px;border-radius:${round ? '50%' : Math.round(inner * 0.22) + 'px'};
    background:linear-gradient(140deg, ${GREEN} 0%, ${GREEN_DARK} 100%);
    border:${Math.max(2, Math.round(inner * 0.025))}px solid ${GOLD};
    display:flex;align-items:center;justify-content:center;
  }
  .glyph{
    font-family:'Amiri',serif;font-weight:700;color:${PARCHMENT};
    font-size:${glyph}px;line-height:1;margin-bottom:${Math.round(glyph * 0.14)}px;
  }
</style></head><body>
<div class="bg"><div class="disc"><span class="glyph">د</span></div></div>
</body></html>`;
}

const ICONS = [
    { file: 'icon-192.png', size: 192, pad: 0.06, round: true },
    { file: 'icon-512.png', size: 512, pad: 0.06, round: true },
    // Maskable: Android may crop to a circle, so keep art inside the safe zone.
    { file: 'icon-maskable-512.png', size: 512, pad: 0.19, round: true },
    // iOS draws its own rounded corners and ignores transparency.
    { file: 'apple-touch-icon.png', size: 180, pad: 0.08, round: false }
];

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    const page = await browser.newPage();

    for (const icon of ICONS) {
        await page.setViewportSize({ width: icon.size, height: icon.size });
        await page.setContent(markup(icon.size, icon.pad, icon.round), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(OUT, icon.file), omitBackground: false });
        console.log('wrote src/icons/' + icon.file + ' (' + icon.size + 'px)');
    }
    await browser.close();
})();
