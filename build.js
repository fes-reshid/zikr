#!/usr/bin/env node
/*
 * Builds the deployable pages.
 *
 * diinislaam.com serves self-contained HTML — every page carries its own CSS
 * and script, with no shared stylesheet. These pages follow that, but keep the
 * shared parts in src/ and inline them here, so the chrome cannot drift
 * between pages and the logic stays in one tested file.
 *
 * Inlining also makes each page safe to serve at any URL depth: with a
 * separate src/core.js, `/quran-tracker` requested without a trailing slash
 * would resolve it to `/src/core.js` and the page would break.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const PARTIALS = {
    '<!-- @site-css -->': { file: 'src/site.css' },
    '<!-- @header -->': { file: 'src/chrome-header.html' },
    '<!-- @footer -->': { file: 'src/chrome-footer.html' },
    '<!-- @chrome-js -->': { file: 'src/chrome.js', note: 'src/chrome.js' },
    '<!-- @core-js -->': { file: 'src/core.js', note: 'src/core.js' }
};

const PAGES = [
    { source: 'pages/tracker.html', out: 'dist/quran-tracker/index.html' },
    { source: 'pages/reader.html', out: 'dist/quran-tracker/reader/index.html' }
];

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function buildPage(source) {
    let html = read(source);

    Object.keys(PARTIALS).forEach(function (marker) {
        const partial = PARTIALS[marker];
        if (!html.includes(marker)) return;
        let body = read(partial.file).trimEnd();
        if (partial.note) {
            body = '/* ' + partial.note + ', inlined by build.js — edit the source, not this file. */\n' + body;
        }
        html = html.split(marker).join(body);
    });

    const unresolved = html.match(/<!--\s*@[a-z-]+\s*-->/g);
    if (unresolved) {
        throw new Error(source + ' has unknown placeholders: ' + unresolved.join(', '));
    }

    // Nothing may reference a sibling file: the point is one file per page.
    const stray = [...html.matchAll(/(?:src|href)="(?!https?:|#|data:|mailto:|tel:|\?)([^"]+)"/g)]
        .filter((m) => !m[1].startsWith('reader/') && m[1] !== '../');
    if (stray.length) {
        throw new Error(source + ' has unexpected relative references: ' +
            stray.map((m) => m[1]).join(', '));
    }
    return html;
}

/*
 * The pages live under /quran-tracker, so the directory above them would
 * otherwise 404. Send it on instead of showing nothing.
 */
function redirectPage() {
    return [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta http-equiv="refresh" content="0; url=quran-tracker/">',
        '<link rel="canonical" href="quran-tracker/">',
        "<title>Qur'ān Daily Tracker</title>",
        '</head>',
        '<body>',
        '<p><a href="quran-tracker/">Continue to the Qur\'ān Daily Tracker</a></p>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

const outputs = {};
PAGES.forEach(function (page) {
    outputs[page.out] = buildPage(page.source);
});
outputs['dist/index.html'] = redirectPage();

const checking = process.argv.includes('--check');
const stale = [];

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
