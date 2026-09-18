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

/*
 * The app lives at /quran-tracker, so the directory above it would otherwise
 * 404. Send it on instead of showing nothing.
 */
function redirectPage() {
    return [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta http-equiv="refresh" content="0; url=quran-tracker/">',
        '<link rel="canonical" href="quran-tracker/">',
        '<title>Quran Daily Tracker</title>',
        '</head>',
        '<body>',
        '<p><a href="quran-tracker/">Continue to the Quran Daily Tracker</a></p>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

const outputs = {
    'dist/quran-tracker/index.html': build(),
    'dist/index.html': redirectPage()
};

const checking = process.argv.includes('--check');
let stale = [];

Object.keys(outputs).forEach(function (relPath) {
    const target = path.join(ROOT, relPath);
    const content = outputs[relPath];

    if (checking) {
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        if (current !== content) stale.push(relPath);
        return;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    console.log('built ' + relPath + ' (' + Math.round(content.length / 1024) + ' KB)');
});

if (checking) {
    if (stale.length) {
        console.error('Out of date: ' + stale.join(', ') + '\nRun: npm run build');
        process.exit(1);
    }
    console.log('dist/ is up to date with the source.');
}
