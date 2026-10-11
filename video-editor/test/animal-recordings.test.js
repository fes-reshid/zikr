const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const S = require('../sounds.js');
const T = require('../timeline.js');
const A = require('../audio-core.js');
const manifest = require('../assets/animal-recordings.json');
const source = fs.readFileSync(path.join(__dirname, '../sounds.js'), 'utf8');
const ok = () => new Response(new Blob(['real recording bytes'], {type: 'audio/mpeg'}));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('every real animal has a local, audited CC0 audio file', () => {
    assert.equal(Object.keys(S.RECORDINGS).length, 23);
    assert.deepEqual(Object.keys(S.RECORDINGS).sort(), Object.keys(manifest).sort());
    for (const [kind, file] of Object.entries(S.RECORDINGS)) {
        const m = manifest[kind];
        assert.equal(m.file, file);
        assert.equal(m.license, 'CC0-1.0');
        assert.match(m.source, /^https:\/\//);
        assert.ok(m.author && m.duration > 0 && m.duration < 15);
        const data = fs.readFileSync(path.join(__dirname, '..', file));
        assert.ok(data.length > 5000);
        assert.equal(createHash('sha256').update(data).digest('hex'), m.sha256);
        assert.equal(data.subarray(0, 3).toString(), 'ID3');
    }
});

test('recordings load on demand and preview/add share one download', async () => {
    let calls = 0;
    const load = S.createRecordingLoader(async () => {calls++; return ok();});
    assert.equal(calls, 0);
    const [a, b] = await Promise.all([load('cat'), load('cat')]);
    assert.equal(a, b);
    await load('cat');
    assert.equal(calls, 1);
});

test('failed downloads and HTML error pages are rejected, not synthesized, and retry works', async () => {
    for (const bad of [new Response('Not found', {status: 404}), new Response('<html>Error</html>', {headers: {'content-type': 'text/html'}}), new Response(new Blob([], {type:'audio/mpeg'}))]) {
        let calls = 0;
        const load = S.createRecordingLoader(async () => ++calls === 1 ? bad : ok());
        await assert.rejects(load('dog'), /could not load/);
        assert.ok((await load('dog')).size > 0);
        assert.equal(calls, 2);
    }
    await assert.rejects(S.createRecordingLoader(async () => ok())('unknown'), /No real recording/);
});

function browser(fetcher) {
    const played = [], imported = [], notices = [];
    let resumes = 0;
    const app = {T, el() {}, addTool() {}, toast(t) {notices.push(t);}, selectOnly() {},
        state: {time: 4.25, project: T.createProject()}, apply(p) {this.state.project = p;},
        async importFiles(files) {
            imported.push(...files);
            const id = 'recording-' + imported.length;
            this.state.project.media.push({id, type: 'audio', duration: 2.5, name: files[0].name});
            return [id];
        }
    };
    class AudioContext {
        constructor() {this.state = 'suspended';}
        resume() {resumes++; this.state = 'running'; return Promise.resolve();}
        decodeAudioData(bytes) {return Promise.resolve({bytes, duration: 2.5});}
        createBufferSource() {return {connect() {}, disconnect() {}, start() {played.push(this);}, stop() {this.stopped = true;}};}
    }
    const sandbox = {window: {ReelApp: app, ReelAudio: A, AudioContext}, document: {querySelector() {return null;}},
        module: {exports: {}}, fetch: fetcher, File, Blob, AbortController, setTimeout, clearTimeout};
    vm.runInNewContext(source, sandbox);
    return {api: sandbox.module.exports, app, played, imported, notices, resumes: () => resumes};
}

test('closing during download prevents late playback; audio unlock happens in the tap', async () => {
    let resolve;
    const b = browser(() => new Promise(r => {resolve = r;}));
    const pending = b.api.preview('cat', 6);
    assert.equal(b.resumes(), 1);
    await tick();
    b.api.stopPreview();
    resolve(ok());
    await pending;
    assert.equal(b.played.length, 0);
});

test('switching previews plays only the newest selection', async () => {
    let resolve;
    const b = browser(url => url.includes('cat') ? new Promise(r => {resolve = r;}) : Promise.resolve(ok()));
    const first = b.api.preview('cat', 6);
    await tick();
    await b.api.preview('dog', 6);
    resolve(ok());
    await first;
    assert.equal(b.played.length, 1);
    b.api.stopPreview();
    assert.ok(b.played[0].stopped);
});

test('Add imports the recording itself and captures the playhead before downloading', async () => {
    let resolve;
    const b = browser(() => new Promise(r => {resolve = r;}));
    const pending = b.api.addSound('cat', 30);
    await tick();
    b.app.state.time = 20;
    resolve(ok());
    const clip = await pending;
    assert.equal(b.imported[0].type, 'audio/mpeg');
    assert.match(b.imported[0].name, /real recording\.mp3$/);
    assert.equal(await b.imported[0].text(), 'real recording bytes');
    assert.equal(clip.start, 4.25);
    assert.equal(clip.duration, 2.5);
    assert.equal(T.getTrack(b.app.state.project, clip.track).kind, 'audio');
    const second = await b.api.addSound('cat', 30);
    assert.equal(second.start, 20);
});

test('failed Add leaves the project unchanged', async () => {
    const b = browser(async () => new Response('', {status: 503}));
    await assert.rejects(b.api.addSound('lion', 6), /could not load/);
    assert.equal(b.imported.length, 0);
    assert.equal(b.app.state.project.clips.length, 0);
});
