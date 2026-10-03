/* Trace the centre of the shaped glyphs so the pen follows actual ink.
 * Works with joined Arabic as well as Latin fonts. Cached per rendered line;
 * preview and both exporters use the same deterministic path and mask. */
(function () {
    'use strict';
    const cache = new Map();
    const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

    function skeleton(binary, w, h) {
        const a = binary.slice();
        let changed = true;
        for (let pass = 0; pass < 80 && changed; pass++) {
            changed = false;
            for (let phase = 0; phase < 2; phase++) {
                const remove = [];
                for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
                    const i = y * w + x;
                    if (!a[i]) continue;
                    const p = [a[i-w], a[i-w+1], a[i+1], a[i+w+1], a[i+w], a[i+w-1], a[i-1], a[i-w-1]];
                    const n = p.reduce((s, v) => s + v, 0);
                    if (n < 2 || n > 6) continue;
                    let crossings = 0;
                    for (let j = 0; j < 8; j++) if (!p[j] && p[(j+1)%8]) crossings++;
                    if (crossings !== 1) continue;
                    if (phase === 0 ? p[0]*p[2]*p[4] || p[2]*p[4]*p[6] : p[0]*p[2]*p[6] || p[0]*p[4]*p[6]) continue;
                    remove.push(i);
                }
                if (remove.length) changed = true;
                remove.forEach(i => { a[i] = 0; });
            }
        }
        return a;
    }

    function trace(source, rtl) {
        const w = source.width, h = source.height;
        const rgba = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        const binary = new Uint8Array(w*h), distance = new Float32Array(w*h);
        for (let i = 0; i < binary.length; i++) { binary[i] = rgba[i*4+3] > 40 ? 1 : 0; distance[i] = binary[i] ? w+h : 0; }
        // Distance to the edge gives the mask a local stroke width.
        for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
            const i = y*w+x;
            if (binary[i]) distance[i] = Math.min(distance[i], distance[i-1]+1, distance[i-w]+1, distance[i-w-1]+1.414, distance[i-w+1]+1.414);
        }
        for (let y = h-2; y > 0; y--) for (let x = w-2; x > 0; x--) {
            const i = y*w+x;
            if (binary[i]) distance[i] = Math.min(distance[i], distance[i+1]+1, distance[i+w]+1, distance[i+w+1]+1.414, distance[i+w-1]+1.414);
        }
        const a = skeleton(binary, w, h), visited = new Uint8Array(w*h);
        const offsets = [-w, -w+1, 1, w+1, w, w-1, -1, -w-1];
        const neighbours = i => offsets.map(d => i+d).filter(j => j >= 0 && j < a.length && a[j]);
        const components = [];
        for (let i = 0; i < a.length; i++) {
            if (!a[i] || visited[i]) continue;
            const component = [], pending = [i]; visited[i] = 1;
            while (pending.length) {
                const p = pending.pop(); component.push(p);
                neighbours(p).forEach(n => { if (!visited[n]) { visited[n] = 1; pending.push(n); } });
            }
            components.push(component);
        }
        const edge = points => rtl ? Math.max(...points.map(i => i%w)) : Math.min(...points.map(i => i%w));
        components.sort((a,b) => (rtl ? -1 : 1) * (edge(a)-edge(b)));
        visited.fill(0);
        const strokes = [];
        components.forEach(component => {
            const order = component.slice().sort((a,b) => (rtl ? -1 : 1)*(a%w-b%w) || a-b);
            while (order.some(i => !visited[i])) {
                let current = order.find(i => !visited[i] && neighbours(i).filter(n => !visited[n]).length <= 1);
                if (current === undefined) current = order.find(i => !visited[i]);
                const points = [];
                let dx = rtl ? -1 : 1, dy = 0;
                while (current !== undefined) {
                    visited[current] = 1;
                    points.push({ x: current%w+.5, y: Math.floor(current/w)+.5, r: distance[current]+1.3 });
                    const next = neighbours(current).filter(i => !visited[i]);
                    next.sort((a,b) => {
                        const score = n => (n%w-current%w)*dx+(Math.floor(n/w)-Math.floor(current/w))*dy;
                        return score(b)-score(a);
                    });
                    const n = next[0];
                    if (n !== undefined) { dx = n%w-current%w; dy = Math.floor(n/w)-Math.floor(current/w); }
                    current = n;
                }
                strokes.push(points);
            }
        });
        return strokes;
    }

    function prepare(o) {
        const key = JSON.stringify([o.line,o.font,o.width,o.size,o.lineHeight,o.rtl,o.color,o.outline]);
        if (cache.has(key)) return cache.get(key);
        const pad = Math.ceil(o.size*.8), w = Math.ceil(o.width+pad*2), h = Math.ceil(o.lineHeight*2);
        const ink = canvas(w,h), g = ink.getContext('2d');
        g.font = o.font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = o.rtl ? 'rtl' : 'ltr';
        g.fillStyle = o.color;
        if (o.outline && o.outline.width) {
            g.lineJoin = 'round'; g.lineWidth = o.outline.width*2; g.strokeStyle = o.outline.color; g.strokeText(o.line,w/2,h/2);
        }
        g.fillText(o.line,w/2,h/2);
        const scale = Math.min(1,48/o.size);
        const small = canvas(Math.max(1,Math.ceil(w*scale)),Math.max(1,Math.ceil(h*scale)));
        small.getContext('2d').drawImage(ink,0,0,small.width,small.height);
        const paths = trace(small,o.rtl);
        let total = 0;
        paths.forEach(points => {
            points.forEach((p,i) => { total += i ? Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y) : 7; p.at=total; });
        });
        const entry = { ink, paths, total, mask:canvas(small.width,small.height), output:canvas(w,h) };
        if (cache.size >= 24) cache.delete(cache.keys().next().value);
        cache.set(key,entry);
        return entry;
    }

    function drawLine(c,o) {
        const a = prepare(o), progress = Math.max(0,Math.min(1,o.reveal));
        const x = o.x-a.ink.width/2, y = o.y-a.ink.height/2;
        const mx = a.ink.width/a.mask.width, my = a.ink.height/a.mask.height;
        const budget = a.total*progress;
        const g = a.mask.getContext('2d');
        g.clearRect(0,0,a.mask.width,a.mask.height); g.fillStyle='#fff'; g.strokeStyle='#fff'; g.lineCap='round';
        let tip = null, previous = null, done = false;
        for (const path of a.paths) {
            for (let i=0;i<path.length;i++) {
                const p=path[i], from=i ? path[i-1] : previous;
                if (p.at > budget) {
                    if (from) {
                        const u=Math.max(0,Math.min(1,(budget-from.at)/(p.at-from.at)));
                        tip={x:from.x+(p.x-from.x)*u,y:from.y+(p.y-from.y)*u};
                    }
                    done=true; break;
                }
                g.beginPath(); g.arc(p.x,p.y,p.r,0,Math.PI*2); g.fill(); tip=p;
            }
            if(done) break;
            previous=path[path.length-1];
        }
        if(progress>=1 || !a.total) c.drawImage(a.ink,x,y);
        else if(progress>0) {
            const out=a.output.getContext('2d');
            out.clearRect(0,0,a.output.width,a.output.height); out.globalCompositeOperation='source-over';
            out.drawImage(a.ink,0,0); out.globalCompositeOperation='destination-in';
            out.drawImage(a.mask,0,0,a.output.width,a.output.height); out.globalCompositeOperation='source-over';
            c.drawImage(a.output,x,y);
        }
        return tip ? {x:x+tip.x*mx,y:y+tip.y*my, traced:true} : null;
    }
    if (document.fonts) document.fonts.addEventListener('loadingdone',()=>cache.clear());
    window.ReelInk={drawLine,clear:()=>cache.clear()};
}());
