/*
 * Reel: PowerPoint in and out.
 *
 * Open a .pptx and each slide becomes part of an editable video: its
 * background, its pictures where they sat, and every text box as a real
 * title (font size, colour, bold, alignment, box colour), each slide lasting
 * its own timing or the time you choose, with an optional fade and the
 * speaker notes as captions. Any video — imported or made here — saves back
 * as a .pptx: each change of picture becomes a slide whose background is the
 * picture, the titles stay editable text boxes, and the slides advance by
 * themselves with the video's timing. Sound is not included in the .pptx.
 *
 * Charts, tables, SmartArt and drawn shapes without text are not brought in.
 * JSZip (vendor/jszip.min.js, MIT) is loaded only when it is needed.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelSlides = Object.assign(root.ReelSlides || {}, api);
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const NS = {
        a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
        p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
        r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        rel: 'http://schemas.openxmlformats.org/package/2006/relationships'
    };
    const PT = 12700;             // EMU in a point
    const WIDE = 12192000;        // 13.333 in: PowerPoint's 16:9 width

    /* ------------------------------------------------------------- geometry */

    /** Slide size in EMU for a frame of W × H (the long side 13.333 in). */
    function slideSize(W, H) {
        return W >= H ? { cx: WIDE, cy: Math.round(WIDE * H / W) } : { cx: Math.round(WIDE * W / H), cy: WIDE };
    }

    /** A frame size for a slide size: common shapes get the usual sizes. */
    function frameFor(cx, cy) {
        const r = cx / cy;
        if (Math.abs(r - 16 / 9) < 0.02) return [1920, 1080];
        if (Math.abs(r - 4 / 3) < 0.02) return [1440, 1080];
        if (Math.abs(r - 9 / 16) < 0.02) return [1080, 1920];
        if (Math.abs(r - 1) < 0.02) return [1080, 1080];
        return r >= 1 ? [1920, Math.round(1920 / r / 2) * 2] : [Math.round(1920 * r / 2) * 2, 1920];
    }

    /**
     * The video split where its pictures change: one slide for each stretch in
     * which the same clips are on screen. Short stretches join the one before;
     * at most `max` slides.
     */
    function segments(project, opts) {
        const o = Object.assign({ min: 0.6, max: 80 }, opts);
        const audioTracks = new Set(project.tracks.filter((t) => t.kind === 'audio').map((t) => t.id));
        const hidden = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
        const clips = project.clips.filter((c) => !audioTracks.has(c.track) && !hidden.has(c.track) && !c.audioOnly);
        if (!clips.length) return [];
        const end = Math.max.apply(null, clips.map((c) => c.start + c.duration));
        const cuts = new Set([0, end]);
        clips.forEach((c) => { cuts.add(Math.max(0, c.start)); cuts.add(Math.min(end, c.start + c.duration)); });
        const times = Array.from(cuts).map((t) => Math.round(t * 1000) / 1000).sort((a, b) => a - b).filter((t, i, a) => !i || t - a[i - 1] > 0.001);
        let out = [];
        for (let i = 0; i < times.length - 1; i += 1) out.push({ start: times[i], end: times[i + 1] });
        // Join slivers to the slide before (or after, for the first).
        out = out.reduce(function (acc, s) {
            if (acc.length && s.end - s.start < o.min) acc[acc.length - 1].end = s.end;
            else if (acc.length && acc[acc.length - 1].end - acc[acc.length - 1].start < o.min) acc[acc.length - 1].end = s.end;
            else acc.push(Object.assign({}, s));
            return acc;
        }, []);
        while (out.length > o.max) {
            // Join the shortest neighbouring pair until there are few enough.
            let best = 0;
            for (let i = 1; i < out.length - 1; i += 1) if (out[i].end - out[i].start < out[best].end - out[best].start) best = i;
            const j = best === out.length - 1 ? best - 1 : best;
            out.splice(j, 2, { start: out[j].start, end: out[j + 1].end });
        }
        return out;
    }

    const FONT_NAMES = {
        sans: 'Arial', serif: 'Georgia', display: 'Impact', mono: 'Consolas', hand: 'Segoe Print', cormorant: 'Cormorant Garamond',
        marcellus: 'Marcellus', amiri: 'Amiri', scheherazade: 'Scheherazade New', naskh: 'Noto Naskh Arabic', kufi: 'Reem Kufi', cairo: 'Cairo'
    };
    const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

    /** The editor font for a PowerPoint typeface. */
    function fontFor(typeface, text) {
        const f = String(typeface || '').toLowerCase();
        if (ARABIC.test(text || '')) return /kufi/.test(f) ? 'kufi' : /cairo/.test(f) ? 'cairo' : /amiri|traditional|scheherazade/.test(f) ? 'amiri' : 'naskh';
        if (/times|georgia|cambria|garamond|book|serif|palatino/.test(f)) return 'serif';
        if (/courier|consolas|mono|lucida console/.test(f)) return 'mono';
        if (/impact|black/.test(f)) return 'display';
        if (/marcellus/.test(f)) return 'marcellus';
        if (/cormorant/.test(f)) return 'cormorant';
        if (/print|comic|hand|script/.test(f)) return 'hand';
        return 'sans';
    }

    /** A title's text box on a slide `size` (EMU) of a W × H frame. */
    function textShape(clip, W, H, size) {
        const text = String(clip.text || '');
        const pt = Math.max(6, Math.round(clip.fontSize * (size.cy / PT) / 720 * 10) / 10);
        const wrap = clip.wrap > 0.05 && clip.wrap <= 1 ? clip.wrap : 0.9;
        const cx = Math.round(size.cx * wrap);
        // Lines: the typed ones, and any that wrap at about half an em per character.
        const perLine = Math.max(4, Math.floor(cx / (pt * PT * 0.52)));
        const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
        const cy = Math.round(Math.min(size.cy, lines * pt * PT * (ARABIC.test(text) ? 1.7 : 1.3) + pt * PT * 0.3));
        // The video centres each title on its x; a left or right aligned box starts or ends where its widest line does.
        const widest = Math.min(cx, Math.max.apply(null, text.split('\n').map((l) => l.length)) * pt * PT * 0.52);
        const align = clip.align || 'center';
        const left = align === 'left' ? clip.x * size.cx - widest / 2 : align === 'right' ? clip.x * size.cx + widest / 2 - cx : clip.x * size.cx - cx / 2;
        const x = Math.round(Math.min(Math.max(0, left), size.cx - cx));
        const y = Math.round(Math.min(Math.max(0, clip.y * size.cy - cy / 2), Math.max(0, size.cy - cy)));
        return {
            text: text, x: x, y: y, cx: cx, cy: cy, pt: pt, color: clip.color || '#ffffff', bold: !!clip.bold, italic: !!clip.italic,
            align: clip.align || 'center', font: FONT_NAMES[clip.font] || 'Arial', rtl: ARABIC.test(text),
            fill: clip.box ? (clip.boxColor || '#000000') : null, shadow: !!clip.shadow,
            outline: clip.outline && clip.outline.width > 0 ? { w: Math.round(clip.outline.width * (size.cy / 720) * 0.5), color: clip.outline.color || '#000000' } : null,
            glow: clip.glow || null
        };
    }

    /* ------------------------------------------------------------ the .pptx */

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    const hex = (c) => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).replace('#', '').toUpperCase() : 'FFFFFF');
    const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const XMLNS = 'xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '" xmlns:p="' + NS.p + '"';
    const TREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

    function shapeXml(s, id) {
        const algn = { left: 'l', center: 'ctr', right: 'r' }[s.align] || 'ctr';
        const lang = s.rtl ? 'ar-SA' : 'en-US';
        const effects = (s.glow ? '<a:glow rad="101600"><a:srgbClr val="' + hex(s.glow) + '"><a:alpha val="60000"/></a:srgbClr></a:glow>' : '') +
            (s.shadow ? '<a:outerShdw blurRad="76200" dist="25400" dir="5400000" algn="t" rotWithShape="0"><a:prstClr val="black"><a:alpha val="55000"/></a:prstClr></a:outerShdw>' : '');
        const rPr = '<a:rPr lang="' + lang + '" sz="' + Math.round(s.pt * 100) + '" b="' + (s.bold ? 1 : 0) + '" i="' + (s.italic ? 1 : 0) + '" dirty="0">' +
            (s.outline ? '<a:ln w="' + Math.max(3175, s.outline.w) + '"><a:solidFill><a:srgbClr val="' + hex(s.outline.color) + '"/></a:solidFill></a:ln>' : '') +
            '<a:solidFill><a:srgbClr val="' + hex(s.color) + '"/></a:solidFill>' + (effects ? '<a:effectLst>' + effects + '</a:effectLst>' : '') +
            '<a:latin typeface="' + esc(s.font) + '"/><a:cs typeface="' + esc(s.font) + '"/></a:rPr>';
        const paras = s.text.split('\n').map((line) => '<a:p><a:pPr algn="' + algn + '"' + (s.rtl ? ' rtl="1"' : '') + '/>' +
            (line ? '<a:r>' + rPr + '<a:t>' + esc(line) + '</a:t></a:r>' : '') + '<a:endParaRPr lang="' + lang + '" sz="' + Math.round(s.pt * 100) + '" dirty="0"/></a:p>').join('');
        return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Text ' + (id - 1) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
            '<p:spPr><a:xfrm><a:off x="' + s.x + '" y="' + s.y + '"/><a:ext cx="' + s.cx + '" cy="' + s.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
            (s.fill ? '<a:solidFill><a:srgbClr val="' + hex(s.fill) + '"/></a:solidFill>' : '<a:noFill/>') + '</p:spPr>' +
            '<p:txBody><a:bodyPr wrap="square" lIns="45720" tIns="22860" rIns="45720" bIns="22860" rtlCol="0" anchor="ctr"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' + paras + '</p:txBody></p:sp>';
    }

    function slideXml(slide) {
        const shapes = (slide.texts || []).map((s, i) => shapeXml(s, i + 2)).join('');
        const bg = slide.image
            ? '<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId2"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>'
            : '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + hex(slide.color || '#000000') + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
        const ms = Math.max(100, Math.round(slide.ms || 5000));
        return HEAD + '<p:sld ' + XMLNS + '><p:cSld>' + bg + '<p:spTree>' + TREE_HEAD + shapes + '</p:spTree></p:cSld>' +
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:transition spd="med" advTm="' + ms + '">' + (slide.fade ? '<p:fade/>' : '') + '</p:transition></p:sld>';
    }

    const THEME = HEAD + '<a:theme xmlns:a="' + NS.a + '" name="NoorEditor"><a:themeElements>' +
        '<a:clrScheme name="NoorEditor"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
        '<a:dk2><a:srgbClr val="1F2A2E"/></a:dk2><a:lt2><a:srgbClr val="F2EEE3"/></a:lt2><a:accent1><a:srgbClr val="0F7A5C"/></a:accent1><a:accent2><a:srgbClr val="E3B85A"/></a:accent2>' +
        '<a:accent3><a:srgbClr val="2E6B58"/></a:accent3><a:accent4><a:srgbClr val="5B8CFF"/></a:accent4><a:accent5><a:srgbClr val="E5484D"/></a:accent5><a:accent6><a:srgbClr val="7A1FFF"/></a:accent6>' +
        '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
        '<a:fontScheme name="NoorEditor"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
        '<a:fmtScheme name="NoorEditor"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
        '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
        '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
        '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

    const LEVEL = (sz) => '<a:lvl1pPr><a:defRPr sz="' + sz + '"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>';
    const MASTER = HEAD + '<p:sldMaster ' + XMLNS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + TREE_HEAD + '</p:spTree></p:cSld>' +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
        '<p:txStyles><p:titleStyle>' + LEVEL(4400) + '</p:titleStyle><p:bodyStyle>' + LEVEL(2800) + '</p:bodyStyle><p:otherStyle>' + LEVEL(1800) + '</p:otherStyle></p:txStyles></p:sldMaster>';
    const LAYOUT = HEAD + '<p:sldLayout ' + XMLNS + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + TREE_HEAD + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    const rels = (list) => HEAD + '<Relationships xmlns="' + NS.rel + '">' + list.map((r, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + r[0] + '" Target="' + r[1] + '"/>').join('') + '</Relationships>';
    const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const CT = 'application/vnd.openxmlformats-officedocument.';

    /**
     * Writes a .pptx: `deck` = { cx, cy, title, slides: [{ image (bytes, JPEG), color, texts: [textShape], ms, fade }] }.
     * Resolves to what `type` asks JSZip for ('blob' in the browser, 'nodebuffer' in Node).
     */
    function buildPptx(JSZip, deck, type) {
        const zip = new JSZip();
        const n = deck.slides.length;
        const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        zip.file('[Content_Types].xml', HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' +
            '<Override PartName="/ppt/presentation.xml" ContentType="' + CT + 'presentationml.presentation.main+xml"/>' +
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="' + CT + 'presentationml.slideMaster+xml"/>' +
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="' + CT + 'presentationml.slideLayout+xml"/>' +
            deck.slides.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="' + CT + 'presentationml.slide+xml"/>').join('') +
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="' + CT + 'theme+xml"/>' +
            '<Override PartName="/ppt/presProps.xml" ContentType="' + CT + 'presentationml.presProps+xml"/>' +
            '<Override PartName="/ppt/viewProps.xml" ContentType="' + CT + 'presentationml.viewProps+xml"/>' +
            '<Override PartName="/ppt/tableStyles.xml" ContentType="' + CT + 'presentationml.tableStyles+xml"/>' +
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
            '<Override PartName="/docProps/app.xml" ContentType="' + CT + 'extended-properties+xml"/></Types>');
        zip.file('_rels/.rels', rels([[RT + 'officeDocument', 'ppt/presentation.xml'],
            ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], [RT + 'extended-properties', 'docProps/app.xml']]));
        zip.file('docProps/core.xml', HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
            'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
            '<dc:title>' + esc(deck.title || 'NoorEditor') + '</dc:title><dc:creator>NoorEditor</dc:creator>' +
            '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
        zip.file('docProps/app.xml', HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
            '<Application>NoorEditor</Application><Slides>' + n + '</Slides></Properties>');
        zip.file('ppt/presentation.xml', HEAD + '<p:presentation ' + XMLNS + ' saveSubsetFonts="1">' +
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
            '<p:sldIdLst>' + deck.slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst>' +
            '<p:sldSz cx="' + deck.cx + '" cy="' + deck.cy + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
        zip.file('ppt/_rels/presentation.xml.rels', rels([[RT + 'slideMaster', 'slideMasters/slideMaster1.xml']]
            .concat(deck.slides.map((s, i) => [RT + 'slide', 'slides/slide' + (i + 1) + '.xml']))
            .concat([[RT + 'presProps', 'presProps.xml'], [RT + 'viewProps', 'viewProps.xml'], [RT + 'theme', 'theme/theme1.xml'], [RT + 'tableStyles', 'tableStyles.xml']])));
        zip.file('ppt/presProps.xml', HEAD + '<p:presentationPr ' + XMLNS + '/>');
        zip.file('ppt/viewProps.xml', HEAD + '<p:viewPr ' + XMLNS + '><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>');
        zip.file('ppt/tableStyles.xml', HEAD + '<a:tblStyleLst xmlns:a="' + NS.a + '" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>');
        zip.file('ppt/theme/theme1.xml', THEME);
        zip.file('ppt/slideMasters/slideMaster1.xml', MASTER);
        zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([[RT + 'slideLayout', '../slideLayouts/slideLayout1.xml'], [RT + 'theme', '../theme/theme1.xml']]));
        zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
        zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([[RT + 'slideMaster', '../slideMasters/slideMaster1.xml']]));
        deck.slides.forEach(function (s, i) {
            zip.file('ppt/slides/slide' + (i + 1) + '.xml', slideXml(s));
            const list = [[RT + 'slideLayout', '../slideLayouts/slideLayout1.xml']];
            if (s.image) {
                zip.file('ppt/media/image' + (i + 1) + '.jpeg', s.image);
                list.push([RT + 'image', '../media/image' + (i + 1) + '.jpeg']);
            }
            zip.file('ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', rels(list));
        });
        return zip.generateAsync({ type: type || 'blob', mimeType: CT + 'presentationml.presentation', compression: 'DEFLATE' });
    }

    /* -------------------------------------------------------- reading .pptx */

    function dirOf(path) { return path.replace(/[^/]*$/, ''); }
    function resolve(base, target) {
        if (target.charAt(0) === '/') return target.slice(1);
        const parts = (dirOf(base) + target).split('/');
        const out = [];
        parts.forEach((x) => { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); });
        return out.join('/');
    }
    const kids = (node, ns, name) => (node ? Array.prototype.filter.call(node.childNodes, (c) => c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) : []);
    const kid = (node, ns, name) => kids(node, ns, name)[0] || null;
    const deep = (node, ns, name) => (node ? node.getElementsByTagNameNS(ns, name)[0] || null : null);
    const num = (v, d) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
        if (max === min) return [0, 0, l];
        const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [h / 6, s, l];
    }
    function hslToHex(h, s, l) {
        const f = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
        let r, g, b;
        if (!s) r = g = b = l;
        else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); }
        return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
    }

    /** A colour element's value (srgbClr, sysClr, schemeClr, prstClr) with lumMod/lumOff/tint/shade. */
    function colourOf(node, theme) {
        if (!node) return null;
        const c = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].map((n) => kid(node, NS.a, n)).find(Boolean);
        if (!c) return null;
        let base;
        if (c.localName === 'srgbClr') base = '#' + c.getAttribute('val');
        else if (c.localName === 'sysClr') base = '#' + (c.getAttribute('lastClr') || (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000'));
        else if (c.localName === 'prstClr') base = ({ black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00', gray: '#808080' })[c.getAttribute('val')] || '#000000';
        else {
            const v = c.getAttribute('val');
            const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
            base = (theme && theme[map[v] || v]) || (v === 'bg1' || v === 'lt1' ? '#ffffff' : '#000000');
        }
        if (!/^#[0-9a-f]{6}$/i.test(base)) return null;
        const mod = (n) => { const e = kid(c, NS.a, n); return e ? num(e.getAttribute('val'), 100000) / 100000 : null; };
        const lm = mod('lumMod'), lo = mod('lumOff'), tint = mod('tint'), shade = mod('shade');
        if (lm === null && lo === null && tint === null && shade === null) return base.toLowerCase();
        let [h, s, l] = rgbToHsl(parseInt(base.slice(1, 3), 16), parseInt(base.slice(3, 5), 16), parseInt(base.slice(5, 7), 16));
        if (lm !== null) l *= lm;
        if (lo !== null) l += lo;
        if (tint !== null) l = l * tint + (1 - tint);
        if (shade !== null) l *= shade;
        return hslToHex(h, s, Math.max(0, Math.min(1, l)));
    }

    /** A fill (solidFill or blipFill) under `node`: { color } or { embed }. */
    function fillOf(node, theme) {
        if (!node) return null;
        const solid = kid(node, NS.a, 'solidFill');
        if (solid) { const c = colourOf(solid, theme); return c ? { color: c } : null; }
        const blip = kid(node, NS.a, 'blipFill') || kid(node, NS.p, 'blipFill');
        if (blip) { const b = kid(blip, NS.a, 'blip'); return b ? { embed: b.getAttributeNS(NS.r, 'embed') } : null; }
        const grad = kid(node, NS.a, 'gradFill');
        if (grad) { const gs = deep(grad, NS.a, 'gs'); const c = gs ? colourOf(gs, theme) : null; return c ? { color: c } : null; }
        return null;
    }

    function xfrmOf(spPr) {
        const x = kid(spPr, NS.a, 'xfrm');
        if (!x) return null;
        const off = kid(x, NS.a, 'off'), ext = kid(x, NS.a, 'ext');
        if (!off || !ext) return null;
        return { x: num(off.getAttribute('x'), 0), y: num(off.getAttribute('y'), 0), cx: num(ext.getAttribute('cx'), 0), cy: num(ext.getAttribute('cy'), 0) };
    }

    /** The placeholder an element fills: { type, idx }. */
    function placeholderOf(node) {
        const nv = kids(node, NS.p, 'nvSpPr')[0] || kids(node, NS.p, 'nvPicPr')[0];
        const nvPr = nv && kid(nv, NS.p, 'nvPr');
        const ph = nvPr && kid(nvPr, NS.p, 'ph');
        if (!ph) return null;
        return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') || '' };
    }

    /** Positions of the placeholders on a layout or master: by type and by idx. */
    function placeholders(doc) {
        const out = { type: {}, idx: {} };
        if (!doc) return out;
        Array.prototype.forEach.call(doc.getElementsByTagNameNS(NS.p, 'sp'), function (sp) {
            const ph = placeholderOf(sp);
            if (!ph) return;
            const box = xfrmOf(kid(sp, NS.p, 'spPr'));
            const info = { box: box, sp: sp };
            if (!out.type[ph.type]) out.type[ph.type] = info;
            if (ph.idx && !out.idx[ph.idx]) out.idx[ph.idx] = info;
        });
        return out;
    }
    const sameKind = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t);

    /** Reads a .pptx (bytes) into slides. `DOMParserImpl` defaults to the browser's. */
    async function parsePptx(JSZip, data, DOMParserImpl) {
        const zip = await JSZip.loadAsync(data);
        const Parser = DOMParserImpl || DOMParser;
        const xml = async function (path) {
            const f = zip.file(path);
            return f ? new Parser().parseFromString(await f.async('string'), 'application/xml') : null;
        };
        const relsOf = async function (path) {
            const doc = await xml(dirOf(path) + '_rels/' + path.replace(/^.*\//, '') + '.rels');
            const out = {};
            if (doc) Array.prototype.forEach.call(doc.getElementsByTagNameNS(NS.rel, 'Relationship'), function (r) {
                out[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', target: r.getAttribute('TargetMode') === 'External' ? null : resolve(path, r.getAttribute('Target') || '') };
            });
            return out;
        };
        const byType = (rs, end) => Object.keys(rs).map((k) => rs[k]).find((r) => r.target && r.type.slice(-end.length) === end);
        const pres = await xml('ppt/presentation.xml');
        if (!pres) throw new Error('This is not a PowerPoint file.');
        const sz = deep(pres, NS.p, 'sldSz');
        const cx = num(sz && sz.getAttribute('cx'), WIDE), cy = num(sz && sz.getAttribute('cy'), 6858000);
        const presRels = await relsOf('ppt/presentation.xml');
        const ids = Array.prototype.map.call(pres.getElementsByTagNameNS(NS.p, 'sldId'), (s) => s.getAttributeNS(NS.r, 'id'));
        const cache = {};
        const load = async function (path) {
            if (!cache[path]) cache[path] = (async () => ({ doc: await xml(path), rels: await relsOf(path) }))();
            return cache[path];
        };
        const themeOf = async function (masterPath, masterRels) {
            const t = byType(masterRels, '/theme');
            const doc = t ? await xml(t.target) : null;
            const out = {};
            const scheme = doc && deep(doc, NS.a, 'clrScheme');
            if (scheme) Array.prototype.forEach.call(scheme.childNodes, function (n) { if (n.nodeType === 1) { const c = colourOf(n, null); if (c) out[n.localName] = c; } });
            return out;
        };
        const media = {};
        const bytes = async function (path) {
            if (!path || !zip.file(path)) return null;
            if (!media[path]) media[path] = await zip.file(path).async('uint8array');
            return media[path];
        };
        const shown = (path) => /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(path || '');

        const slides = [];
        let skipped = 0;
        for (const id of ids) {
            const rel = presRels[id];
            if (!rel || !rel.target) continue;
            const path = rel.target;
            const { doc, rels: sRels } = await load(path);
            if (!doc) continue;
            const root = doc.documentElement;
            if (root.getAttribute('show') === '0') continue;
            const layoutRel = byType(sRels, '/slideLayout');
            const layout = layoutRel ? await load(layoutRel.target) : { doc: null, rels: {} };
            const masterRel = byType(layout.rels, '/slideMaster');
            const master = masterRel ? await load(masterRel.target) : { doc: null, rels: {} };
            const theme = masterRel ? await themeOf(masterRel.target, master.rels) : {};
            const lph = placeholders(layout.doc), mph = placeholders(master.doc);

            // Background: the slide's, else the layout's, else the master's.
            let bg = null;
            for (const src of [[doc, sRels, path], [layout.doc, layout.rels, layoutRel && layoutRel.target], [master.doc, master.rels, masterRel && masterRel.target]]) {
                const node = src[0] && deep(src[0], NS.p, 'bgPr');
                const f = node ? fillOf(node, theme) : null;
                if (f && f.color) { bg = { color: f.color }; break; }
                if (f && f.embed && src[1][f.embed] && shown(src[1][f.embed].target)) { bg = { image: await bytes(src[1][f.embed].target), name: src[1][f.embed].target }; break; }
                const ref = src[0] && deep(src[0], NS.p, 'bgRef');
                if (ref) { const c = colourOf(ref, theme); if (c) { bg = { color: c }; break; } }
            }
            if (!bg) bg = { color: theme.lt1 || '#ffffff' };

            const pictures = [], texts = [];
            const defaults = function (ph) {
                const style = master.doc && deep(master.doc, NS.p, ph && sameKind(ph.type) === 'title' ? 'titleStyle' : ph ? 'bodyStyle' : 'otherStyle');
                const lvl = style && deep(style, NS.a, 'lvl1pPr');
                const def = lvl && kid(lvl, NS.a, 'defRPr');
                return {
                    sz: num(def && def.getAttribute('sz'), ph ? (sameKind(ph.type) === 'title' ? 4400 : 2800) : 1800) / 100,
                    color: (def && colourOf(kid(def, NS.a, 'solidFill'), theme)) || theme.dk1 || '#000000',
                    bold: def ? def.getAttribute('b') === '1' : false
                };
            };
            // Placeholders take their place, size and default text style from the layout or master when the slide leaves them out.
            const chain = function (ph) {
                if (!ph) return [];
                const t = sameKind(ph.type);
                return [ph.idx && lph.idx[ph.idx], lph.type[ph.type], lph.type[t], ph.idx && mph.idx[ph.idx], mph.type[ph.type], mph.type[t]].filter(Boolean);
            };
            const inherited = function (ph, key) {
                const hit = chain(ph).find((c) => c[key]);
                return hit ? hit[key] : null;
            };
            /** The first-level paragraph style a placeholder inherits: { algn, sz, b, color }. */
            const inheritedStyle = function (ph) {
                const out = {};
                chain(ph).forEach(function (c) {
                    const body = kid(c.sp, NS.p, 'txBody');
                    const lvl = body && deep(kid(body, NS.a, 'lstStyle'), NS.a, 'lvl1pPr');
                    if (!lvl) return;
                    if (out.algn === undefined && lvl.getAttribute('algn')) out.algn = lvl.getAttribute('algn');
                    const def = kid(lvl, NS.a, 'defRPr');
                    if (!def) return;
                    if (out.sz === undefined && def.getAttribute('sz')) out.sz = num(def.getAttribute('sz'), 0) / 100;
                    if (out.b === undefined && def.getAttribute('b') !== null) out.b = def.getAttribute('b') === '1';
                    if (out.color === undefined) { const col = colourOf(kid(def, NS.a, 'solidFill'), theme); if (col) out.color = col; }
                });
                // The master's text styles come last.
                const style = master.doc && ph && deep(master.doc, NS.p, sameKind(ph.type) === 'title' ? 'titleStyle' : 'bodyStyle');
                const lvl = style && deep(style, NS.a, 'lvl1pPr');
                if (lvl && out.algn === undefined && lvl.getAttribute('algn')) out.algn = lvl.getAttribute('algn');
                return out;
            };
            const walk = async function (container, map) {
                for (const node of Array.prototype.slice.call(container.childNodes)) {
                    if (node.nodeType !== 1 || node.namespaceURI !== NS.p) continue;
                    if (node.localName === 'grpSp') {
                        const gx = kid(kid(node, NS.p, 'grpSpPr'), NS.a, 'xfrm');
                        const g = (n, a, d) => num(gx && kid(gx, NS.a, n) && kid(gx, NS.a, n).getAttribute(a), d);
                        const off = { x: g('off', 'x', 0), y: g('off', 'y', 0) }, ext = { cx: g('ext', 'cx', 1), cy: g('ext', 'cy', 1) };
                        const chOff = { x: g('chOff', 'x', 0), y: g('chOff', 'y', 0) }, chExt = { cx: g('chExt', 'cx', ext.cx) || 1, cy: g('chExt', 'cy', ext.cy) || 1 };
                        await walk(node, function (b) {
                            const sx = ext.cx / chExt.cx, sy = ext.cy / chExt.cy;
                            const inner = { x: off.x + (b.x - chOff.x) * sx, y: off.y + (b.y - chOff.y) * sy, cx: b.cx * sx, cy: b.cy * sy };
                            return map ? map(inner) : inner;
                        });
                        continue;
                    }
                    const spPr = kid(node, NS.p, 'spPr');
                    const ph = placeholderOf(node);
                    let box = xfrmOf(spPr) || inherited(ph, 'box');
                    if (box && map) box = map(box);
                    if (node.localName === 'pic' || (node.localName === 'sp' && spPr && kid(spPr, NS.a, 'blipFill'))) {
                        const blip = deep(node, NS.a, 'blip');
                        const r = blip && sRels[blip.getAttributeNS(NS.r, 'embed')];
                        if (r && shown(r.target) && box) pictures.push({ image: await bytes(r.target), name: r.target, x: box.x, y: box.y, cx: box.cx, cy: box.cy });
                        else skipped += 1;
                        continue;
                    }
                    if (node.localName === 'graphicFrame') { skipped += 1; continue; }
                    if (node.localName !== 'sp' || !box) continue;
                    const body = kid(node, NS.p, 'txBody');
                    const paras = body ? kids(body, NS.a, 'p') : [];
                    const def = defaults(ph);
                    const own = inheritedStyle(ph);
                    if (own.sz) def.sz = own.sz;
                    if (own.b !== undefined) def.bold = own.b;
                    if (own.color) def.color = own.color;
                    const fontScale = (() => { const fit = body && deep(body, NS.a, 'normAutofit'); return fit ? num(fit.getAttribute('fontScale'), 100000) / 100000 : 1; })();
                    let first = null, align = null, rtl = false;
                    const lines = paras.map(function (pEl) {
                        const pPr = kid(pEl, NS.a, 'pPr');
                        if (pPr && align === null && pPr.getAttribute('algn')) align = pPr.getAttribute('algn');
                        if (pPr && pPr.getAttribute('rtl') === '1') rtl = true;
                        const runs = kids(pEl, NS.a, 'r').concat(kids(pEl, NS.a, 'fld'));
                        const text = Array.prototype.map.call(pEl.childNodes, function (n) {
                            if (n.nodeType !== 1) return '';
                            if (n.localName === 'br') return '\n';
                            if (n.localName === 'r' || n.localName === 'fld') { const t = kid(n, NS.a, 't'); return t ? t.textContent : ''; }
                            return '';
                        }).join('');
                        if (!first && runs.length) first = kid(runs[0], NS.a, 'rPr');
                        const bullet = pPr && (kid(pPr, NS.a, 'buChar') || kid(pPr, NS.a, 'buAutoNum'));
                        const noBullet = pPr && kid(pPr, NS.a, 'buNone');
                        const isBody = ph && sameKind(ph.type) === 'body' && ph.type !== 'subTitle';
                        return text && (bullet || (isBody && !noBullet && paras.length > 1)) ? '• ' + text : text;
                    });
                    const text = lines.join('\n').replace(/\n+$/, '');
                    const fill = fillOf(spPr, theme);
                    if (!text.trim()) { if (fill && fill.color) skipped += 1; continue; }
                    const sz = num(first && first.getAttribute('sz'), def.sz * 100) / 100 * fontScale;
                    // Where the text sits in its box: top unless the box (or its placeholder) says otherwise.
                    let anchor = null;
                    [node].concat(chain(ph).map((c) => c.sp)).some(function (n) {
                        const bp = deep(kid(n, NS.p, 'txBody'), NS.a, 'bodyPr');
                        if (bp && bp.getAttribute('anchor')) { anchor = bp.getAttribute('anchor'); return true; }
                        return false;
                    });
                    if (!anchor && master.doc && ph && sameKind(ph.type) === 'title') {
                        const mt = mph.type.title, bp = mt && deep(kid(mt.sp, NS.p, 'txBody'), NS.a, 'bodyPr');
                        anchor = bp && bp.getAttribute('anchor');
                    }
                    const perLine = Math.max(4, Math.floor(box.cx / (sz * PT * 0.5)));
                    const rows = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
                    const tall = Math.min(box.cy, rows * sz * PT * (ARABIC.test(text) ? 1.6 : 1.2) + 91440);
                    const color = (first && colourOf(kid(first, NS.a, 'solidFill'), theme)) || def.color;
                    const latin = first && kid(first, NS.a, 'latin');
                    const top = anchor === 'ctr' ? box.y + (box.cy - tall) / 2 : anchor === 'b' ? box.y + box.cy - tall : box.y;
                    const widest = Math.min(box.cx, Math.max.apply(null, text.split('\n').map((l) => l.length)) * sz * PT * 0.52);
                    texts.push({
                        text: text, x: box.x, y: top, cx: box.cx, cy: tall, w: widest, pt: sz, color: color,
                        bold: first && first.getAttribute('b') !== null ? first.getAttribute('b') === '1' : def.bold,
                        italic: !!(first && first.getAttribute('i') === '1'),
                        align: ({ l: 'left', ctr: 'center', r: 'right', just: 'left', dist: 'center' })[align || own.algn] || 'left',
                        font: latin ? latin.getAttribute('typeface') : '', rtl: rtl || ARABIC.test(text),
                        fill: fill && fill.color ? fill.color : null, title: !!(ph && sameKind(ph.type) === 'title')
                    });
                }
            };
            const tree = deep(doc, NS.p, 'spTree');
            if (tree) await walk(tree, null);

            const tr = deep(doc, NS.p, 'transition');
            const notesRel = byType(sRels, '/notesSlide');
            let notes = '';
            if (notesRel) {
                const nd = await xml(notesRel.target);
                if (nd) Array.prototype.forEach.call(nd.getElementsByTagNameNS(NS.p, 'sp'), function (sp) {
                    const ph = placeholderOf(sp);
                    if (ph && ph.type === 'body') notes = kids(kid(sp, NS.p, 'txBody'), NS.a, 'p').map((pEl) => Array.prototype.map.call(pEl.getElementsByTagNameNS(NS.a, 't'), (t) => t.textContent).join('')).join('\n').trim();
                });
            }
            slides.push({ bg: bg, pictures: pictures, texts: texts, ms: tr && tr.getAttribute('advTm') ? num(tr.getAttribute('advTm'), 0) : 0, fade: !!(tr && Array.prototype.some.call(tr.childNodes, (n) => n.nodeType === 1)), notes: notes });
        }
        if (!slides.length) throw new Error('No slides were found in this PowerPoint file.');
        return { cx: cx, cy: cy, slides: slides, skipped: skipped };
    }

    return { slideSize, frameFor, segments, fontFor, textShape, buildPptx, parsePptx, slideXml, NS, PT };
}));

/* ------------------------------------------------------- the editor side */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp) return;
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const S = window.ReelSlides;
    const script = document.currentScript;

    let zipLib = null;
    /** Loads JSZip from vendor/ the first time a PowerPoint is opened or saved. */
    function jszip() {
        if (window.JSZip) return Promise.resolve(window.JSZip);
        if (!zipLib) {
            zipLib = new Promise(function (resolve, reject) {
                const s = document.createElement('script');
                s.src = new URL('vendor/jszip.min.js', script ? script.src : location.href).href;
                s.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip did not load')));
                s.onerror = () => { zipLib = null; reject(new Error('The PowerPoint reader could not load. Check your connection.')); };
                document.head.append(s);
            });
        }
        return zipLib;
    }

    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
    const fileOf = (bytes, name) => new File([bytes], name.replace(/^.*\//, ''), { type: MIME[(name.match(/\.(\w+)$/) || [])[1].toLowerCase()] || 'application/octet-stream', lastModified: Date.now() });
    async function colourCard(color, W, H, label) {
        const c = document.createElement('canvas');
        c.width = Math.min(W, 640); c.height = Math.round(c.width * H / W);
        const g = c.getContext('2d');
        g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        return new File([blob], label + ' ' + color.replace('#', '') + '.png', { type: 'image/png', lastModified: Date.now() });
    }

    /** Builds the deck on the timeline (after what is there); `o` = { seconds|null, fade, notes }. Resolves to { slides, from, to }. */
    async function placeDeck(deck, o, name) {
        app.pause();
        let p = app.state.project;
        if (!p.clips.length) {
            const q = T.clone(p);
            [q.width, q.height] = S.frameFor(deck.cx, deck.cy);
            q.name = (name || 'Slides').replace(/\.pptx$/i, '').slice(0, 60);
            app.state.project = q;
        }
        const W = app.state.project.width, H = app.state.project.height;
        // Pictures and backgrounds become media first (no undo step of their own).
        const ids = {};
        const want = async function (key, file) {
            if (ids[key] !== undefined) return ids[key];
            const got = await app.importFiles([file], { noCommit: true, fresh: true, noSlides: true });
            ids[key] = got[0] || null;
            return ids[key];
        };
        for (const s of deck.slides) {
            if (s.bg.image) await want(s.bg.name, fileOf(s.bg.image, s.bg.name));
            else await want('colour ' + s.bg.color, await colourCard(s.bg.color, W, H, 'Slide background'));
            for (const pic of s.pictures) await want(pic.name, fileOf(pic.image, pic.name));
        }
        p = T.clone(app.state.project);
        const start = T.projectDuration(p);
        const tracks = {};
        const track = function (key, kind, label) {
            if (tracks[key]) return tracks[key];
            const id = T.nextTrackId(p, kind);
            p = T.addTrack(p, kind, label);
            return (tracks[key] = id);
        };
        const ptToPx = 720 / (deck.cy / S.PT);
        let at = start;
        deck.slides.forEach(function (s, i) {
            const len = Math.max(1, o.seconds || (s.ms ? s.ms / 1000 : 5));
            const fade = o.fade && i ? { type: 'crossfade', duration: 0.5 } : null;
            const bgId = s.bg.image ? ids[s.bg.name] : ids['colour ' + s.bg.color];
            const bgMedia = bgId && T.getMedia(p, bgId);
            if (bgMedia) {
                const c = Object.assign(T.clipFromMedia(bgMedia, track('bg', 'video', 'Slides · background'), at), { duration: len, fit: 'cover', transition: fade, slide: i + 1 });
                p = T.addClip(p, c);
            }
            s.pictures.forEach(function (pic, k) {
                const m = ids[pic.name] && T.getMedia(p, ids[pic.name]);
                if (!m || !m.width || !m.height) return;
                const boxW = pic.cx / deck.cx * W, boxH = pic.cy / deck.cy * H;
                const fit = Math.min(W / m.width, H / m.height);
                const scale = Math.min(boxW / (m.width * fit), boxH / (m.height * fit));
                const c = Object.assign(T.clipFromMedia(m, track('pic' + k, 'video', 'Slides · picture ' + (k + 1)), at), {
                    duration: len, fit: 'contain', scale: Math.round(scale * 1000) / 1000,
                    x: (pic.x + pic.cx / 2) / deck.cx, y: (pic.y + pic.cy / 2) / deck.cy, fadeIn: o.fade && i ? 0.4 : 0, slide: i + 1
                });
                p = T.addClip(p, c);
            });
            s.texts.forEach(function (t, k) {
                const c = Object.assign(T.textClip(track('text' + k, 'text', 'Slides · text ' + (k + 1)), at, t.text), {
                    duration: len, x: (t.align === 'left' ? t.x + (t.w || t.cx) / 2 : t.align === 'right' ? t.x + t.cx - (t.w || t.cx) / 2 : t.x + t.cx / 2) / deck.cx,
                    y: (t.y + t.cy / 2) / deck.cy, wrap: Math.min(1, Math.max(0.1, t.cx / deck.cx * 1.02)),
                    fontSize: Math.max(8, Math.round(t.pt * ptToPx * 10) / 10), color: t.color, bold: t.bold, italic: t.italic, align: t.align,
                    font: S.fontFor(t.font, t.text), shadow: false, box: !!t.fill, boxColor: t.fill || '#000000',
                    fadeIn: o.fade && i ? 0.4 : 0, fadeOut: 0, anim: 'none', slide: i + 1
                });
                p = T.addClip(p, c);
            });
            if (o.notes && s.notes) {
                const vertical = H > W;
                const note = Object.assign(T.textClip(track('notes', 'text', 'Slides · speaker notes'), at, s.notes), { // adds the track to p first
                    duration: len, fontSize: vertical ? 30 : 26, bold: false, box: true, boxColor: '#000000', y: vertical ? 0.86 : 0.9, wrap: 0.9,
                    fadeIn: 0.2, fadeOut: 0.2, font: T.isArabic(s.notes) ? 'naskh' : 'sans'
                });
                p = T.addClip(p, note);
            }
            at += len;
        });
        app.apply(p);
        app.zoomToFit();
        app.seek(start + 0.05);
        return { slides: deck.slides.length, from: start, to: at };
    }

    /** Opens a .pptx: reads it, asks how long each slide lasts, and puts it on the timeline. */
    async function openDeck(file) {
        app.pause();
        let deck;
        app.toast('Opening ' + file.name + '…');
        try {
            const Z = await jszip();
            deck = await S.parsePptx(Z, await file.arrayBuffer());
        } catch (err) {
            app.toast(/not a PowerPoint|No slides/.test(err.message) ? err.message : 'This PowerPoint file could not be opened: ' + err.message);
            return null;
        }
        const timed = deck.slides.some((s) => s.ms > 0);
        const hasNotes = deck.slides.some((s) => s.notes);
        const timing = el('select', { 'aria-label': 'Slide timing' }, [timed ? ['deck', 'As in the presentation'] : null, ['3', '3 seconds a slide'], ['5', '5 seconds a slide'], ['8', '8 seconds a slide'], ['12', '12 seconds a slide']]
            .filter(Boolean).map((x) => el('option', { value: x[0], text: x[1] })));
        timing.value = timed ? 'deck' : '5';
        const fade = el('input', { type: 'checkbox', checked: true });
        const notes = el('input', { type: 'checkbox' });
        const empty = !app.state.project.clips.length;
        const size = S.frameFor(deck.cx, deck.cy);
        return new Promise(function (resolve) {
            app.openDialog({
                title: 'Open PowerPoint as a video',
                intro: deck.slides.length + ' slide' + (deck.slides.length === 1 ? '' : 's') + ' found in ' + file.name + '. Each slide becomes editable parts of the video: its background, its pictures and every text box as a title you can change.',
                body: [
                    app.dialogField('How long each slide shows', timing),
                    el('label', { className: 'check' }, [fade, 'Fade from one slide to the next']),
                    hasNotes ? el('label', { className: 'check' }, [notes, 'Show the speaker notes as captions']) : null,
                    el('p', { className: 'hint', text: (empty ? 'The video will be ' + size[0] + '×' + size[1] + ', the shape of the slides. ' : 'The slides go after what is on your timeline. ') +
                        (deck.skipped ? deck.skipped + ' item' + (deck.skipped === 1 ? '' : 's') + ' (charts, tables or drawn shapes) could not be brought in. ' : '') + 'Sound and animations in the presentation are not brought in.' })
                ],
                onClose: () => resolve(null),
                actions: [{ label: 'Cancel' }, {
                    label: 'Make the video', primary: true, run: async function (d) {
                        d.busy(true);
                        d.status('Placing ' + deck.slides.length + ' slides…');
                        try {
                            const r = await placeDeck(deck, { seconds: timing.value === 'deck' ? null : Number(timing.value), fade: fade.checked, notes: notes.checked }, file.name);
                            app.toast(r.slides + ' slides are on the timeline (' + app.fmt(r.to - r.from) + '). Click any text or picture to change it; File ▸ Save as PowerPoint makes a .pptx again.');
                            resolve(r);
                        } catch (err) { d.busy(false); d.status('Could not place the slides: ' + err.message); return false; }
                        return true;
                    }
                }]
            });
        });
    }

    function pickDeck() {
        const input = el('input', { type: 'file', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', hidden: true });
        input.addEventListener('change', function () { if (input.files[0]) openDeck(input.files[0]); input.remove(); });
        document.body.append(input);
        input.click();
    }

    /** Makes a .pptx of the project: one slide per change of picture, titles as text boxes. Resolves to a Blob. */
    async function makeDeck(status) {
        const say = status || function () {};
        const project = app.state.project;
        const parts = S.segments(project);
        if (!parts.length) throw new Error('Add something to the timeline first.');
        const Z = await jszip();
        const W = project.width, H = project.height;
        const size = S.slideSize(W, H);
        const scale = Math.min(1, 1920 / Math.max(W, H));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
        const ctx = canvas.getContext('2d');
        // The pictures without the titles: those become text boxes.
        const plain = Object.assign(T.clone(project), { clips: project.clips.filter((c) => c.type !== 'text') });
        const slides = [];
        const was = app.state.time;
        for (let i = 0; i < parts.length; i += 1) {
            const s = parts[i];
            say('Making slide ' + (i + 1) + ' of ' + parts.length + '…');
            // Far enough in for fades to finish, and never past the end.
            const mid = Math.min(s.end - 0.02, s.start + Math.min(1.2, (s.end - s.start) / 2));
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            await app.renderStill(mid, ctx, { project: plain });
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
            const texts = T.renderLayers(project, mid).filter((l) => l.clip.type === 'text' && !l.clip.sticker && String(l.clip.text || '').trim())
                .map((l) => S.textShape(l.clip, W, H, size));
            const starts = project.clips.filter((c) => Math.abs(c.start - s.start) < 0.01 && c.transition);
            slides.push({ image: new Uint8Array(await blob.arrayBuffer()), texts: texts, ms: (s.end - s.start) * 1000, fade: i > 0 && starts.length > 0 });
        }
        app.seek(was);
        say('Saving the PowerPoint…');
        return S.buildPptx(Z, { cx: size.cx, cy: size.cy, title: project.name, slides: slides }, 'blob');
    }

    function saveDeck() {
        app.pause();
        const parts = S.segments(app.state.project);
        if (!parts.length) { app.toast('Add something to the timeline first.'); return; }
        app.openDialog({
            title: 'Save as PowerPoint',
            intro: 'Your video becomes a PowerPoint presentation: ' + parts.length + ' slide' + (parts.length === 1 ? '' : 's') + ', one for each change of picture.',
            body: [el('ul', null, [
                el('li', { text: 'Titles stay editable text boxes, with their font, size and colour.' }),
                el('li', { text: 'Pictures, videos, drawings and stickers become each slide’s background picture.' }),
                el('li', { text: 'Slides move on by themselves with the same timing as the video.' }),
                el('li', { text: 'Sound is not included — export the video (MP4) for that.' })
            ])],
            actions: [{ label: 'Cancel' }, {
                label: 'Save .pptx', primary: true, run: async function (d) {
                    d.busy(true);
                    try {
                        const blob = await makeDeck(d.status);
                        app.download(blob, app.safeName(app.state.project.name || 'NoorEditor') + '.pptx');
                        app.toast('PowerPoint saved: ' + parts.length + ' slides.');
                    } catch (err) { d.busy(false); d.status('Could not make the PowerPoint: ' + err.message); return false; }
                    return true;
                }
            }]
        });
    }

    app.addTool({ section: 'Project', label: 'Open a PowerPoint (.pptx) as a video…', run: pickDeck });
    app.addTool({ section: 'Project', label: 'Save as PowerPoint (.pptx)…', run: saveDeck });
    // The export window offers it too, for videos made here.
    const exportRow = document.querySelector('#export-dialog .actions');
    if (exportRow && !document.getElementById('export-pptx')) {
        const b = el('button', { type: 'button', id: 'export-pptx', className: 'ghost', text: 'Save as PowerPoint…', title: 'Save this video as a PowerPoint presentation instead', onclick: function () { const c = document.getElementById('export-cancel'); if (c) c.click(); saveDeck(); } });
        exportRow.prepend(b);
    }
    Object.assign(window.ReelSlides, { openDeck, pickDeck, placeDeck, makeDeck, saveDeck, jszip });
}());
