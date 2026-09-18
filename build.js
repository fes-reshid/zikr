#!/usr/bin/env node
/*
 * Builds the deployable copy of the app.
 *
 * `index.html` loads `src/core.js` as a separate file, which is convenient for
 * development but fragile to deploy: served at `/quran-tracker` without a
 * trailing slash, a relative `src/core.js` resolves to `/src/core.js` and the
 * page breaks. The build inlines it so the result is one self-contained file
 * that works at any path on any host.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist', 'quran-tracker');
const SCRIPT_TAG = '<script src="src/core.js"></script>';

function build() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');

    if (!html.includes(SCRIPT_TAG)) {
        throw new Error('index.html no longer contains ' + SCRIPT_TAG + '; update build.js');
    }

    const inlined = html.replace(
        SCRIPT_TAG,
        '<script>\n/* src/core.js, inlined by build.js — edit the source, not this file. */\n' +
            core.trimEnd() +
            '\n    </script>'
    );

    // Nothing may reference a sibling file: the whole point is one file.
    const stray = [...inlined.matchAll(/(?:src|href)="(?!https?:|#|data:)([^"]+)"/g)];
    if (stray.length) {
        throw new Error('relative references left in the build: ' +
            stray.map((m) => m[1]).join(', '));
    }

    return inlined;
}

const output = build();
const target = path.join(OUT_DIR, 'index.html');

if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== output) {
        console.error('dist/quran-tracker/index.html is out of date. Run: npm run build');
        process.exit(1);
    }
    console.log('dist/quran-tracker/index.html is up to date.');
} else {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(target, output);
    console.log('built ' + path.relative(ROOT, target) +
        ' (' + Math.round(output.length / 1024) + ' KB, self-contained)');
}
