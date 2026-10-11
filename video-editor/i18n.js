/*
 * Reel: interface languages — English and Arabic (right to left).
 *
 * Menus, buttons, the details panel, windows and messages are translated from
 * the table in i18n-ar.js by matching their English text, so new parts of the
 * editor translate as soon as their words are in the table. Text panels and
 * windows read right to left in Arabic; the preview and the timeline stay left
 * to right. Titles you type, file names and the help page stay as they are.
 * The choice is in View ▸ Language (in ☰ on a phone) and is remembered.
 */
(function () {
    'use strict';
    const LANGS = [['en', 'English'], ['ar', 'العربية']];
    const KEY = 'reel.lang';
    const table = new Map();
    (window.REEL_AR || []).forEach(function (row) { if (row[1]) table.set(row[0], row[1]); });
    const patterns = window.REEL_AR_PATTERNS || [];

    let lang = 'en';
    try { lang = localStorage.getItem(KEY) || (/^ar\b/i.test(navigator.language || '') ? 'ar' : 'en'); } catch (err) { /* private mode */ }
    if (!LANGS.some((l) => l[0] === lang)) lang = 'en';

    const norm = (s) => s.replace(/\s+/g, ' ');
    // "✓ Medium", "  Small": translate the words, keep the tick.
    function tr(s) {
        if (lang === 'en' || !s) return s;
        const key = norm(s.trim());
        if (table.has(key)) return table.get(key);
        const m = key.match(/^([✓•▶◆●■＋+←→⬇↶↷✂✕×… \s]+)(.+)$/);
        if (m && table.has(m[2])) return m[1] + table.get(m[2]);
        const n = key.match(/^(.+?)(\s*[…:]|\s*\([^)]*\))$/);
        if (n && table.has(n[1])) return table.get(n[1]) + n[2];
        for (const p of patterns) {
            const r = key.match(p[0]);
            if (r) { const out = p[1](r, tr); if (out) return out; }
        }
        return s;
    }

    // Keep each text's English original, so switching back (or again) works.
    const texts = new WeakMap();
    const attrs = new WeakMap();
    const SKIP = 'script,style,textarea,input,canvas,svg,.clip,.clip-label,.media-item .name,.media-list .name,#project-name,.timecode,#timecode,output,.ruler,.lang-keep,[contenteditable]';
    function textNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return;
        const orig = texts.has(n) ? texts.get(n) : n.nodeValue;
        const m = orig.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (!m[2] || !/[A-Za-z]/.test(m[2])) return;
        const t = tr(m[2]);
        const val = t === m[2] ? orig : m[1] + t + m[3];
        if (!texts.has(n)) texts.set(n, orig);
        if (n.nodeValue !== val) n.nodeValue = val;
    }
    function elementAttrs(e) {
        for (const a of ['title', 'aria-label', 'placeholder']) {
            if (!e.hasAttribute(a)) continue;
            let o = attrs.get(e);
            if (!o) attrs.set(e, o = {});
            if (!(a in o)) o[a] = e.getAttribute(a);
            const v = tr(o[a]);
            if (e.getAttribute(a) !== v) e.setAttribute(a, v);
        }
    }
    function tree(root) {
        if (root.nodeType === 3) { textNode(root); return; }
        if (root.nodeType !== 1 || (root.closest && root.closest('script,style,svg'))) return;
        elementAttrs(root);
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else elementAttrs(n); }
    }
    const watch = new MutationObserver(function (records) {
        for (const r of records) {
            if (r.type === 'characterData') { texts.set(r.target, r.target.nodeValue); textNode(r.target); }
            else if (r.type === 'attributes') {
                const o = attrs.get(r.target);
                if (o) o[r.attributeName] = r.target.getAttribute(r.attributeName);
                elementAttrs(r.target);
            } else r.addedNodes.forEach(tree);
        }
        watch.takeRecords(); // our own changes
    });

    function apply() {
        document.documentElement.lang = lang;
        document.documentElement.classList.toggle('ui-rtl', lang === 'ar');
        tree(document.body);
        watch.takeRecords();
    }

    function set(code) {
        if (!LANGS.some((l) => l[0] === code)) return;
        const back = lang !== 'en' && code === 'en';
        lang = code;
        try { localStorage.setItem(KEY, code); } catch (err) { /* private mode */ }
        if (back) {
            // Put every English original back.
            const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
            let n;
            while ((n = w.nextNode())) {
                if (n.nodeType === 3) { if (texts.has(n)) n.nodeValue = texts.get(n); }
                else { const o = attrs.get(n); if (o) Object.keys(o).forEach((a) => n.setAttribute(a, o[a])); }
            }
            watch.takeRecords();
        }
        apply();
        if (window.ReelApp && window.ReelApp.renderAll) window.ReelApp.renderAll();
    }

    window.ReelI18n = { LANGS: LANGS, lang: () => lang, set: set, tr: tr };
    watch.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
    apply();
}());
