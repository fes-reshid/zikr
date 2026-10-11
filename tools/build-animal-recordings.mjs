// Rebuild the reviewed CC0 field-recording assets. Requires curl and ffmpeg.
// Audio is hosted with the editor; no third-party requests are made by users.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'noor-real-animals-'));
const out = join(root, 'video-editor/assets');
const bsb = (kind, page, seconds = 12) => ({kind, page: 'https://bigsoundbank.com/' + page, seconds});
const fs = (kind, user, id, seconds = 12) => ({kind, author: user, page: `https://freesound.org/people/${user}/sounds/${id}/`, seconds});
const sources = [
    bsb('rooster', 'chant-du-coq-s0283.html'),
    bsb('sheep', 'sheep-1-s2343.html'),
    bsb('cow', 'cow-moos-6-s2386.html'),
    bsb('cat', 'little-meow-of-a-cat-s0494.html'),
    bsb('dog', 'barking-dogs-s0288.html'),
    bsb('duck', 'ducks-s0276.html'),
    bsb('owl', 'tawny-owl-2-s1764.html'),
    bsb('frog', 'one-frog-s0819.html'),
    bsb('horse', 'neighing-of-a-horse-1-s0284.html'),
    bsb('bees', 'bumblebee-against-a-window-s0797.html', 8),
    bsb('seagull', 'gulls-on-the-harbor-s2573.html'),
    bsb('goat', 'bleating-goat-1-s0279.html'),
    bsb('donkey', 'donkey-braying-3-s1551.html'),
    bsb('crow', 'crows-2-s0956.html'),
    bsb('hens', 'annoyed-hen-s0453.html'),
    bsb('chicks', 'chick-2-stuffings-s0431.html', 8),
    bsb('parrot', 'cockatiel-parakeet-11-s2779.html'),
    fs('lion', 'Bidone', 69572),
    fs('tiger', 'lauramellis', 263115),
    fs('elephant', 'D.jones', 527845),
    fs('wolf', 'betchkal', 500646),
    {kind: 'camel', page: 'https://opengameart.org/content/camel-groan', author: 'craigsmith / AntumDeluge', seconds: 12},
    {kind: 'bear', page: 'https://opengameart.org/content/bear-growls', author: 'U.S. Fish & Wildlife Service / AntumDeluge', seconds: 12}
];
await mkdir(out, {recursive: true});
const manifest = {};
async function build(s) {
    const {stdout: html} = await run('curl', ['-sfL', '--max-time', '40', s.page], {maxBuffer: 4e6});
    if (!/CC0|creativecommons\.org\/publicdomain\/zero\/1\.0/.test(html)) throw Error('No CC0 declaration: ' + s.page);
    let url, author = s.author, original;
    if (s.page.includes('bigsoundbank.com')) {
        const json = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)]
            .map(m => {try {return JSON.parse(m[1]);} catch {return null;}}).find(x => x && x['@type'] === 'AudioObject');
        if (!json) throw Error('Missing recording metadata: ' + s.page);
        url = json.encoding.find(x => x.encodingFormat === 'audio/mpeg').contentUrl;
        author = json.author.name;
    } else if (s.page.includes('freesound.org')) {
        url = html.match(/data-static-file-url="([^"]+-hq\.mp3)"/)?.[1];
    } else {
        url = html.match(/href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"<>]+\.zip)"/)?.[1];
    }
    if (!url) throw Error('No public download: ' + s.page);
    const download = join(temp, s.kind + (url.endsWith('.zip') ? '.zip' : '.mp3'));
    await run('curl', ['-sfL', '--retry', '1', '--max-time', '50', url, '-o', download]);
    original = download;
    if (url.endsWith('.zip')) {
        const {stdout: list} = await run('unzip', ['-Z1', download]);
        const member = list.split('\n').find(x => /\.flac$/i.test(x));
        if (!member || member.includes('..')) throw Error('No lossless archive member');
        const {stdout: data} = await run('unzip', ['-p', download, member], {encoding: 'buffer', maxBuffer: 20e6});
        original = join(temp, s.kind + '.flac');
        await writeFile(original, data);
    }
    const target = join(out, 'animal-' + s.kind + '-v1.mp3');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', original, '-t', String(s.seconds),
        '-af', 'afade=t=in:d=0.008,areverse,afade=t=in:d=0.025,areverse', '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', target]);
    const {stdout: duration} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', target]);
    const bytes = await readFile(target);
    manifest[s.kind] = {file: 'assets/animal-' + s.kind + '-v1.mp3', duration: Number(duration.trim()), author, source: s.page, download: url,
        license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        changes: 'Excerpt (up to ' + s.seconds + ' seconds), mono 44.1 kHz MP3, short edge fades. Original pitch and speed.',
        sha256: createHash('sha256').update(bytes).digest('hex')};
    console.log(s.kind + ': ' + manifest[s.kind].duration + ' s, ' + bytes.length + ' bytes');
}
let next = 0;
await Promise.all(Array.from({length: 5}, async () => {while(next < sources.length) await build(sources[next++]);}));
await writeFile(join(out, 'animal-recordings.json'), JSON.stringify(Object.fromEntries(sources.map(s => [s.kind, manifest[s.kind]])), null, 2) + '\n');
console.log('Created ' + sources.length + ' recordings. Source downloads: ' + temp);
