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
const crypto = require('crypto');

const ROOT = __dirname;

const PARTIALS = {
    '<!-- @site-css -->': { file: 'src/site.css' },
    '<!-- @header -->': { file: 'src/chrome-header.html' },
    '<!-- @footer -->': { file: 'src/chrome-footer.html' },
    '<!-- @chrome-js -->': { file: 'src/chrome.js', note: 'src/chrome.js' },
    '<!-- @pwa-js -->': { file: 'src/pwa.js', note: 'src/pwa.js' },
    '<!-- @core-js -->': { file: 'src/core.js', note: 'src/core.js' }
};

/*
 * `root` is what {{ROOT}} becomes: how each page reaches /quran-tracker/, so
 * the manifest, icons and service worker resolve from either depth.
 */
const PAGES = [
    { source: 'pages/tracker.html', out: 'dist/quran-tracker/index.html', root: './' },
    { source: 'pages/reader.html', out: 'dist/quran-tracker/reader/index.html', root: '../' }
];

const ICONS = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

// Assets the pages may legitimately reference beside themselves, compared
// after stripping the "./" or "../" each page's {{ROOT}} puts in front.
const ALLOWED_REFS = ['reader/', '', 'manifest.webmanifest', 'icons/apple-touch-icon.png'];

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function buildPage(source, root) {
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

    html = html.split('{{ROOT}}').join(root);

    // The page's own code stays inline; only the listed assets may sit beside it.
    const stray = [...html.matchAll(/(?:src|href)="(?!https?:|#|data:|mailto:|tel:|\?)([^"]+)"/g)]
        .filter((m) => ALLOWED_REFS.indexOf(m[1].replace(/^(\.\.?\/)+/, '')) === -1);
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
    outputs[page.out] = buildPage(page.source, page.root);
});
outputs['dist/index.html'] = redirectPage();
outputs['dist/quran-tracker/manifest.webmanifest'] = read('src/manifest.webmanifest');

/*
 * The service worker's cache name carries a hash of everything it caches, so a
 * deploy makes a new cache and the previous one is dropped instead of serving
 * a stale page.
 */
const buildId = crypto.createHash('sha1')
    .update(Object.keys(outputs).sort().map((k) => outputs[k]).join('\0'))
    .digest('hex')
    .slice(0, 12);
outputs['dist/quran-tracker/sw.js'] =
    read('src/sw.js').split('__BUILD_ID__').join(buildId);

const binaryOutputs = {};
ICONS.forEach(function (icon) {
    binaryOutputs['dist/quran-tracker/icons/' + icon] =
        fs.readFileSync(path.join(ROOT, 'src', 'icons', icon));
});

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

Object.keys(binaryOutputs).forEach(function (relPath) {
    const target = path.join(ROOT, relPath);
    const content = binaryOutputs[relPath];

    if (checking) {
        const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
        if (!current || !current.equals(content)) stale.push(relPath);
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
