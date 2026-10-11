/*
 * Reel: keeps imported files in this browser (IndexedDB), so a project opens
 * again with its media instead of asking for every file to be re-imported,
 * and passes files to and from the site's audio editor.
 *
 * Files never leave the device. The browser may refuse to keep very large
 * ones when space runs short; those simply show as offline next time, as
 * they did before this existed.
 *
 * The hand-over store ("diin-handoff") is shared with /audio-editor/: one
 * page puts a file under a key and opens the other, which takes it out.
 */
(function () {
    'use strict';

    const MEDIA_DB = 'reel-media';
    const HANDOFF_DB = 'diin-handoff';
    const HANDOFF_MAX_AGE = 60 * 60 * 1000;

    const dbs = {};
    function open(name, store) {
        if (!dbs[name]) {
            dbs[name] = new Promise(function (resolve, reject) {
                if (!window.indexedDB) { reject(new Error('No IndexedDB')); return; }
                const req = indexedDB.open(name, 1);
                req.onupgradeneeded = function () { req.result.createObjectStore(store); };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
            dbs[name].catch(function () { delete dbs[name]; });
        }
        return dbs[name];
    }

    function request(r) {
        return new Promise(function (resolve, reject) {
            r.onsuccess = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
        });
    }

    async function tx(name, store, mode, fn) {
        const db = await open(name, store);
        const t = db.transaction(store, mode);
        const out = await fn(t.objectStore(store));
        await new Promise(function (resolve, reject) {
            t.oncomplete = resolve;
            t.onerror = function () { reject(t.error); };
            t.onabort = function () { reject(t.error || new Error('aborted')); };
        });
        return out;
    }

    function asFile(rec) {
        if (!rec || !rec.blob) return null;
        if (rec.blob instanceof File && rec.blob.name === rec.name) return rec.blob;
        return new File([rec.blob], rec.name || 'file', { type: rec.type || rec.blob.type || '', lastModified: rec.lastModified || Date.now() });
    }

    let persistAsked = false;
    let warnedFull = false;

    /** Keeps a copy of an imported file under its media id. */
    function keep(id, file) {
        if (!persistAsked && navigator.storage && navigator.storage.persist) {
            persistAsked = true;
            navigator.storage.persist().catch(function () {});
        }
        return tx(MEDIA_DB, 'files', 'readwrite', function (s) {
            s.put({ blob: file, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, saved: Date.now() }, id);
        }).catch(function (err) {
            if (!warnedFull && window.ReelApp) {
                warnedFull = true;
                window.ReelApp.toast('The browser would not keep a copy of ' + file.name + (err && err.name === 'QuotaExceededError' ? ' (not enough space)' : '') +
                    ' — you may need to import it again next time.', 6000);
            }
        });
    }

    /**
     * Stored files for these media items: by id, and with `byName` also by
     * name and size (a project opened from a file has new ids).
     * Resolves to [[mediaId, File], …].
     */
    async function find(mediaList, byName) {
        return tx(MEDIA_DB, 'files', 'readonly', async function (s) {
            const out = [];
            const all = byName ? await request(s.getAll()) : null;
            for (const m of mediaList) {
                let rec = await request(s.get(m.id));
                if (!rec && byName) rec = all.find((r) => r.name === m.name && r.size === m.size) || null;
                const file = asFile(rec);
                if (file) out.push([m.id, file]);
            }
            return out;
        });
    }

    /** Drops stored files no project uses any more. */
    function keepOnly(ids) {
        const wanted = new Set(ids);
        return tx(MEDIA_DB, 'files', 'readwrite', async function (s) {
            const keys = await request(s.getAllKeys());
            keys.forEach(function (k) { if (!wanted.has(k)) s.delete(k); });
        }).catch(function () {});
    }

    async function usage() {
        return tx(MEDIA_DB, 'files', 'readonly', async function (s) {
            const all = await request(s.getAll());
            return { used: all.reduce((n, r) => n + (r.size || 0), 0), count: all.length };
        });
    }

    function clear() {
        return tx(MEDIA_DB, 'files', 'readwrite', function (s) { s.clear(); });
    }

    /** Leaves a file for the other editor to pick up. */
    function putHandoff(key, blob, name) {
        return tx(HANDOFF_DB, 'items', 'readwrite', function (s) {
            s.put({ blob: blob, name: name || blob.name || 'file', type: blob.type, time: Date.now() }, key);
        });
    }

    /** Takes (and removes) a file left for this editor, or null. */
    async function takeHandoff(key) {
        try {
            return await tx(HANDOFF_DB, 'items', 'readwrite', async function (s) {
                const rec = await request(s.get(key));
                s.delete(key);
                if (!rec || Date.now() - (rec.time || 0) > HANDOFF_MAX_AGE) return null;
                return asFile(rec);
            });
        } catch (err) {
            return null;
        }
    }

    window.ReelStore = { keep, find, keepOnly, usage, clear, putHandoff, takeHandoff };
}());
