/*
 * Reel: project library.
 *
 * Every project you work on is kept here, in this browser, with a small
 * picture of it, its length and when it was last changed — not only the ones
 * open in tabs. Open one (in a new tab), duplicate it, or delete it. The
 * media files of kept projects stay stored, so they open ready to edit.
 */
(function () {
    'use strict';

    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const KEY = 'reel.library';
    const MAX = 40;

    function list() {
        try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (err) { return []; }
    }

    /** Writes the list, dropping the oldest projects if the browser's storage is full. */
    function write(items) {
        let rest = items.slice(0, MAX);
        while (rest.length) {
            try { localStorage.setItem(KEY, JSON.stringify(rest)); return true; } catch (err) { rest = rest.slice(0, -1); }
        }
        try { localStorage.removeItem(KEY); } catch (err) { /* nothing to do */ }
        return false;
    }

    /** A small JPEG of what the preview shows now. */
    function thumbnail(project) {
        const preview = document.getElementById('preview');
        if (!preview || !preview.width) return '';
        const w = 192;
        const h = Math.round(w * project.height / project.width);
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = Math.min(h, 340);
        try {
            cv.getContext('2d').drawImage(preview, 0, 0, cv.width, cv.height);
            return cv.toDataURL('image/jpeg', 0.7);
        } catch (err) { return ''; }
    }

    let timer = 0;
    /** Keeps the current project in the library, a moment after the last change. */
    function remember() {
        clearTimeout(timer);
        timer = setTimeout(rememberNow, 1500);
    }

    function rememberNow() {
        const p = app.state.project;
        if (!p || (!p.clips.length && !p.media.length)) return;
        if (!p.libraryId) p.libraryId = T.newId('proj');
        const items = list();
        const old = items.find((e) => e.id === p.libraryId);
        const entry = {
            id: p.libraryId, name: p.name || 'Untitled project', updated: Date.now(), duration: T.projectDuration(p),
            size: p.width + '×' + p.height, thumb: thumbnail(p) || (old && old.thumb) || '', project: T.serialize(p)
        };
        write([entry].concat(items.filter((e) => e.id !== entry.id)));
    }

    /** Ids of every media file the kept projects use, so their stored copies are not cleared. */
    function mediaIds() {
        const ids = [];
        list().forEach(function (e) {
            try { JSON.parse(e.project).media.forEach((m) => ids.push(m.id)); } catch (err) { /* skip a broken entry */ }
        });
        return ids;
    }

    function remove(id) {
        write(list().filter((e) => e.id !== id));
    }

    function open(id) {
        const entry = list().find((e) => e.id === id);
        if (!entry) return false;
        let p;
        try { p = T.deserialize(entry.project); } catch (err) { app.toast('That project could not be opened.'); return false; }
        if (app.focusLibraryProject && app.focusLibraryProject(id)) return true;
        p.libraryId = id;
        return app.openProjectInTab(p);
    }

    function duplicate(id) {
        const entry = list().find((e) => e.id === id);
        if (!entry) return;
        const p = T.deserialize(entry.project);
        p.libraryId = T.newId('proj');
        p.name = (p.name || 'Untitled project') + ' (copy)';
        const copy = Object.assign({}, entry, { id: p.libraryId, name: p.name, updated: Date.now(), project: T.serialize(p) });
        write([copy].concat(list()));
    }

    function ago(ms) {
        const s = Math.round((Date.now() - ms) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.round(s / 60) + ' min ago';
        if (s < 86400) return Math.round(s / 3600) + ' h ago';
        return new Date(ms).toLocaleDateString();
    }

    function openLibrary() {
        rememberNow();
        let dialog = null;
        const grid = el('div', { className: 'library-grid' });
        const render = function () {
            grid.textContent = '';
            const items = list();
            if (!items.length) grid.append(el('p', { className: 'hint', text: 'Projects you work on appear here automatically.' }));
            items.forEach(function (e) {
                const current = app.state.project.libraryId === e.id;
                const card = el('div', { className: 'library-card' + (current ? ' current' : '') }, [
                    e.thumb ? el('img', { src: e.thumb, alt: '' }) : el('div', { className: 'library-blank', text: '▶' }),
                    el('strong', { text: e.name, title: e.name }),
                    el('span', { className: 'hint', text: app.fmt(e.duration || 0) + ' · ' + e.size + ' · ' + ago(e.updated) + (current ? ' · open now' : '') }),
                    el('div', { className: 'row-buttons' }, [
                        el('button', { type: 'button', className: 'primary', text: current ? 'Open' : 'Open in a tab', onclick: function () { if (open(e.id)) dialog.close(); } }),
                        el('button', { type: 'button', className: 'ghost', text: 'Duplicate', onclick: function () { duplicate(e.id); render(); } }),
                        el('button', {
                            type: 'button', className: 'ghost', text: 'Delete', 'aria-label': 'Delete ' + e.name, onclick: function () {
                                if (!window.confirm('Delete “' + e.name + '” from the library? This cannot be undone.')) return;
                                remove(e.id);
                                render();
                            }
                        })
                    ])
                ]);
                grid.append(card);
            });
        };
        render();
        dialog = app.openDialog({
            title: 'My projects', wide: true,
            intro: 'Every project you work on is kept in this browser. Save a project as a file to move it to another computer.',
            body: [grid]
        });
    }

    app.addTool({ section: 'Project', label: 'My projects…', run: openLibrary });

    window.ReelLibrary = { list, remember, rememberNow, mediaIds, open, duplicate, remove, openLibrary };
}());
