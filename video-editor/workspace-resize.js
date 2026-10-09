/*
 * Reel: resize the workspace by dragging around the video.
 *
 * Two thin dividers at the left and right edges of the preview change how
 * wide the media and inspector panels are, and a grip in the preview's
 * bottom-right corner makes the whole video area bigger or smaller at once
 * — wider by narrowing the inspector, taller by lowering the timeline. The
 * sizes are remembered in this browser. Phones keep their own layout.
 */
(function () {
    'use strict';

    const workspace = document.getElementById('workspace');
    const stage = document.getElementById('stage');
    if (!workspace || !stage) return;

    const KEYS = { bin: 'reel.binWidth', insp: 'reel.inspectorWidth', timeline: 'reel.timelineHeight' };
    const LIMITS = { bin: [140, 480], insp: [180, 520] };
    const wide = window.matchMedia ? window.matchMedia('(min-width: 901px)') : { matches: true };

    function read(key) {
        try { return Number(localStorage.getItem(key)) || 0; } catch (err) { return 0; }
    }
    function save(key, value) {
        try { localStorage.setItem(key, String(Math.round(value))); } catch (err) { /* private mode */ }
    }
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function setWidth(which, px) {
        const v = clamp(px, LIMITS[which][0], LIMITS[which][1]);
        document.body.style.setProperty(which === 'bin' ? '--bin-w' : '--insp-w', v + 'px');
        return v;
    }
    function width(which) {
        const panel = workspace.querySelector(which === 'bin' ? '.bin' : '.inspector');
        return panel ? panel.getBoundingClientRect().width : 0;
    }
    function setTimeline(px) {
        const h = clamp(px, 140, window.innerHeight - 220);
        document.body.style.setProperty('--timeline-h', h + 'px');
        return h;
    }
    function relayout() {
        window.dispatchEvent(new Event('resize'));
    }

    if (read(KEYS.bin)) setWidth('bin', read(KEYS.bin));
    if (read(KEYS.insp)) setWidth('insp', read(KEYS.insp));

    /** Calls `move(dx, dy)` while the pointer is dragged from `node`, and `done()` at the end. */
    function draggable(node, move, done) {
        node.addEventListener('pointerdown', function (e) {
            if (e.button > 0 || !wide.matches) return;
            e.preventDefault();
            e.stopPropagation(); // not a click on the preview underneath
            node.setPointerCapture(e.pointerId);
            node.classList.add('active');
            document.body.classList.add('resizing');
            const x0 = e.clientX;
            const y0 = e.clientY;
            const start = move.start ? move.start() : null;
            function onMove(ev) {
                move(ev.clientX - x0, ev.clientY - y0, start);
                relayout();
            }
            function onUp() {
                node.classList.remove('active');
                document.body.classList.remove('resizing');
                node.removeEventListener('pointermove', onMove);
                node.removeEventListener('pointerup', onUp);
                node.removeEventListener('pointercancel', onUp);
                done();
                relayout();
            }
            node.addEventListener('pointermove', onMove);
            node.addEventListener('pointerup', onUp);
            node.addEventListener('pointercancel', onUp);
        });
    }

    // The dividers at the preview's left and right edges.
    ['bin', 'insp'].forEach(function (which) {
        const bar = document.createElement('div');
        bar.className = 'col-resizer ' + (which === 'bin' ? 'left' : 'right');
        bar.setAttribute('role', 'separator');
        bar.setAttribute('aria-orientation', 'vertical');
        bar.setAttribute('aria-label', which === 'bin' ? 'Resize the media panel' : 'Resize the inspector panel');
        bar.title = 'Drag to resize';
        bar.tabIndex = 0;
        const move = function (dx, dy, start) {
            setWidth(which, which === 'bin' ? start + dx : start - dx);
        };
        move.start = function () { return width(which); };
        draggable(bar, move, function () { save(which === 'bin' ? KEYS.bin : KEYS.insp, width(which)); });
        bar.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const step = (e.key === 'ArrowRight' ? 20 : -20) * (which === 'bin' ? 1 : -1);
            save(which === 'bin' ? KEYS.bin : KEYS.insp, setWidth(which, width(which) + step));
            relayout();
        });
        workspace.append(bar);
    });

    // The corner grip: drag down and right for a bigger video area.
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'stage-grip';
    grip.title = 'Drag to make the video area bigger or smaller';
    grip.setAttribute('aria-label', 'Resize the video area');
    grip.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M15 6L6 15M15 10.5L10.5 15M15 1.5L1.5 15"/></svg>';
    const corner = function (dx, dy, start) {
        setWidth('insp', start.insp - dx);
        setTimeline(start.timeline - dy);
    };
    corner.start = function () {
        const tl = document.querySelector('.timeline-panel');
        return { insp: width('insp'), timeline: tl ? tl.getBoundingClientRect().height : window.innerHeight * 0.36 };
    };
    draggable(grip, corner, function () {
        save(KEYS.insp, width('insp'));
        const tl = document.querySelector('.timeline-panel');
        if (tl) save(KEYS.timeline, tl.getBoundingClientRect().height);
    });
    stage.append(grip);
}());
