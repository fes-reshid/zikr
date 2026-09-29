#!/usr/bin/env node
/*
 * Renders video-editor/icons/*.png from icons/icon.svg with Chromium.
 * The PNGs are committed, so a normal build needs neither this nor a browser.
 *
 *   node tools/make-video-editor-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const DIR = path.join(__dirname, '..', 'video-editor', 'icons');
const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
const SIZES = [
    ['favicon-32.png', 32, false], ['apple-touch-icon.png', 180, true],
    ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true]
];

(async function () {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
    const page = await browser.newPage();
    for (const [name, size, full] of SIZES) {
        // Maskable and Apple icons are cropped by the system: fill the square, keep the mark inside the safe zone.
        const inner = full ? svg.replace('rx="112"', 'rx="0"').replace('<path ', '<path transform="translate(51 51) scale(.8)" ') : svg;
        await page.setViewportSize({ width: size, height: size });
        await page.setContent('<html><body style="margin:0;background:transparent">' +
            inner.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') + '</body></html>');
        await page.screenshot({ path: path.join(DIR, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
        console.log('wrote icons/' + name);
    }
    await browser.close();
}());
