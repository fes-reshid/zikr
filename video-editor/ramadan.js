/*
 * Reel: the Ramadan pack.
 *
 * - A greeting for someone: Ramadan, Eid al-Fitr, Eid al-Adha, Laylat al-Qadr
 *   or Jumu'ah, with their name and yours, in the WhatsApp Status shape.
 * - A 30-day reminder series: one short video for each day of Ramadan, with
 *   an ayah or hadith and its reference, on the painted Ramadan scenes.
 *
 * Both open in a new tab when the current project already has something in it.
 * The reminder texts are short English renderings with their references; every
 * line stays editable, so people can use their own translation or language.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReelRamadan = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** One reminder for each day: [theme, text, reference]. */
    const REMINDERS = [
        ['Fasting was written for you', 'O you who believe, fasting has been prescribed for you as it was prescribed for those before you, so that you may become mindful of Allah.', 'Qur’an 2:183'],
        ['Fast with faith', 'Whoever fasts Ramadan out of faith and hoping for reward, his past sins will be forgiven.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['The month of the Qur’an', 'The month of Ramadan is the one in which the Qur’an was sent down, a guidance for people and clear proofs of guidance and the criterion.', 'Qur’an 2:185'],
        ['The gates are open', 'When Ramadan begins, the gates of Paradise are opened, the gates of Hell are closed and the devils are chained.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['He is near', 'When My servants ask you about Me, I am near. I answer the call of the one who calls upon Me.', 'Qur’an 2:186'],
        ['Guard your tongue', 'Whoever does not give up false speech and acting on it, Allah has no need of his giving up his food and drink.', 'Sahih al-Bukhari'],
        ['The blessing of suhoor', 'Take suhoor, for in suhoor there is blessing.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Hasten to break the fast', 'The people will remain upon goodness as long as they hasten to break the fast.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Feed a fasting person', 'Whoever gives a fasting person food to break his fast will have a reward like his, without anything being taken from the reward of the fasting person.', 'Jami‘ at-Tirmidhi'],
        ['Fasting is a shield', 'Fasting is a shield. So when one of you is fasting, let him not speak obscenely or act foolishly.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Two joys', 'The fasting person has two joys: a joy when he breaks his fast, and a joy when he meets his Lord.', 'Sahih Muslim'],
        ['Stand at night', 'Whoever stands in prayer in Ramadan out of faith and hoping for reward, his past sins will be forgiven.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Better than a thousand months', 'We sent it down on the Night of Decree. And what will make you know what the Night of Decree is? The Night of Decree is better than a thousand months.', 'Qur’an 97:1–3'],
        ['Learn and teach', 'The best of you are those who learn the Qur’an and teach it.', 'Sahih al-Bukhari'],
        ['Most generous in Ramadan', 'The Messenger of Allah ﷺ was the most generous of people, and he was at his most generous in Ramadan.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['A seed that grows', 'Those who spend their wealth in the way of Allah are like a seed that grows seven ears, in every ear a hundred grains.', 'Qur’an 2:261'],
        ['Charity never decreases', 'Charity does not decrease wealth.', 'Sahih Muslim'],
        ['Never lose hope', 'Say: O My servants who have wronged themselves, do not despair of the mercy of Allah. Allah forgives all sins.', 'Qur’an 39:53'],
        ['The du‘a of these nights', 'O Allah, You are the Pardoner and You love to pardon, so pardon me.', 'Jami‘ at-Tirmidhi'],
        ['Seek the Night of Decree', 'Seek Laylat al-Qadr in the odd nights of the last ten nights of Ramadan.', 'Sahih al-Bukhari'],
        ['The last ten nights', 'When the last ten nights began, the Prophet ﷺ would stay up at night, wake his family, and strive hard in worship.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Remember Me', 'So remember Me, and I will remember you. Be grateful to Me and do not be ungrateful.', 'Qur’an 2:152'],
        ['Hearts find rest', 'Truly, in the remembrance of Allah hearts find rest.', 'Qur’an 13:28'],
        ['Call upon Me', 'Your Lord says: Call upon Me and I will answer you.', 'Qur’an 40:60'],
        ['Hearts and deeds', 'Allah does not look at your appearance or your wealth, but He looks at your hearts and your deeds.', 'Sahih Muslim'],
        ['Love for your brother', 'None of you truly believes until he loves for his brother what he loves for himself.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Small and steady', 'The deeds most loved by Allah are those done regularly, even if they are small.', 'Sahih al-Bukhari and Sahih Muslim'],
        ['Zakat al-Fitr', 'The Messenger of Allah ﷺ made Zakat al-Fitr obligatory as a purification for the fasting person and as food for the poor.', 'Sunan Abi Dawud'],
        ['Six days of Shawwal', 'Whoever fasts Ramadan and follows it with six days of Shawwal, it is as if he fasted the whole year.', 'Sahih Muslim'],
        ['Complete it with gratitude', 'Complete the number of days, and glorify Allah for having guided you, so that you may be grateful.', 'Qur’an 2:185']
    ];

    const GREETINGS = {
        ramadan: { label: 'Ramadan', occasion: 'ramadan', title: 'Ramadan Mubarak', message: 'May Allah accept your fasting, your prayers and your du‘a.' },
        'eid-fitr': { label: 'Eid al-Fitr', occasion: 'eid-fitr', title: 'Eid Mubarak', message: 'Taqabbal Allahu minna wa minkum — may Allah accept from us and from you.' },
        'eid-adha': { label: 'Eid al-Adha', occasion: 'eid-adha', title: 'Eid al-Adha Mubarak', message: 'May Allah accept your sacrifice and your worship.' },
        qadr: { label: 'Laylat al-Qadr', occasion: 'qadr', title: 'Blessed nights', message: 'Remember me in your du‘a in these last ten nights.' },
        jumuah: { label: 'Jumu‘ah', occasion: 'jumuah', title: 'Jumu‘ah Mubarak', message: 'A blessed Friday to you and your family.' }
    };

    /** The words of a greeting for `to` from `from`. */
    function greetingText(kind, to, from, message) {
        const g = GREETINGS[kind] || GREETINGS.ramadan;
        const name = (to || '').trim();
        const sender = (from || '').trim();
        return {
            title: name ? g.title + ', ' + name + '!' : g.title + '!',
            sub: (message || g.message).trim(),
            end: sender ? 'With love, from ' + sender : g.title
        };
    }

    /** The reminder for day `n` (1–30). */
    function reminder(n) {
        const d = Math.max(1, Math.min(30, Math.round(n) || 1));
        const r = REMINDERS[d - 1];
        return { day: d, theme: r[0], text: r[1], ref: r[2] };
    }

    return { REMINDERS, GREETINGS, greetingText, reminder };
}));

/* ---------------------------------------------------------------- the dialogs */
(function () {
    'use strict';
    if (typeof window === 'undefined' || !window.ReelApp || !window.ReelOccasions) return;
    const app = window.ReelApp;
    const T = app.T;
    const el = app.el;
    const R = window.ReelRamadan;
    const O = window.ReelOccasions;
    const SHAPES = { status: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };

    /** A fresh project of the chosen shape: in a new tab if this one is in use, otherwise this one. */
    function freshProject(shape, name) {
        const size = SHAPES[shape] || [app.state.project.width, app.state.project.height];
        const p = T.createProject({ width: size[0], height: size[1], fps: app.state.project.fps || 30 });
        p.name = name;
        if (app.state.project.clips.length) {
            if (!app.openProjectInTab(p)) throw new Error('Close one of your project tabs first.');
        } else {
            const cur = T.clone(app.state.project);
            cur.width = size[0]; cur.height = size[1]; cur.name = name;
            app.apply(cur);
        }
    }

    function shapeSelect() {
        return el('select', null, [['status', 'Phone status, Reels, Shorts · 9:16'], ['square', 'Square post · 1:1'], ['wide', 'YouTube · 16:9']]
            .map((o) => el('option', { value: o[0], text: o[1] })));
    }

    function text(track, start, duration, words, patch) {
        return Object.assign(T.textClip(track, start, words), { duration: duration, fadeIn: 0.3, fadeOut: 0.4, shadow: true }, patch);
    }

    /* ------------------------------------------------------------ greeting */

    function openGreeting() {
        app.pause();
        const kind = el('select', null, Object.keys(R.GREETINGS).map((k) => el('option', { value: k, text: R.GREETINGS[k].label })));
        const to = el('input', { type: 'text', maxlength: 40, placeholder: 'e.g. Amina, or Uncle Yusuf' });
        const from = el('input', { type: 'text', maxlength: 60, placeholder: 'e.g. the Hassan family' });
        const message = el('textarea', { rows: 2, maxlength: 160 });
        const shape = shapeSelect();
        const kit = window.ReelBrand && window.ReelBrand.get();
        if (kit && kit.name) from.value = kit.name;
        const fill = function () { message.value = R.GREETINGS[kind.value].message; };
        kind.addEventListener('change', fill);
        fill();
        app.openDialog({
            title: 'Greeting for someone',
            wide: true,
            intro: 'A short greeting video with their name, painted scenes and your message — ready to send on WhatsApp or post as a Status.',
            body: [
                app.dialogField('Occasion', kind),
                el('div', { className: 'field-pair' }, [app.dialogField('To', to), app.dialogField('From', from)]),
                app.dialogField('Message', message),
                app.dialogField('Shape', shape)
            ],
            actions: [{ label: 'Cancel' }, {
                label: 'Make greeting', primary: true, run: async function (d) {
                    d.busy(true);
                    d.status('Painting the scenes…');
                    try {
                        const g = R.GREETINGS[kind.value];
                        const words = R.greetingText(kind.value, to.value, from.value, message.value);
                        freshProject(shape.value, g.title + (to.value.trim() ? ' — ' + to.value.trim() : ''));
                        const occ = O.OCCASIONS[g.occasion];
                        await O.makeOccasion({ occasion: g.occasion, title: words.title, arabic: occ ? occ.arabic : '', sub: words.sub, end: words.end, voiceId: null, secondsEach: 3.5 });
                        app.toast('Your greeting is ready. Press Space to watch, then Export to send it.');
                    } catch (err) { d.busy(false); d.status(err.message); return false; }
                    return true;
                }
            }]
        });
    }

    /* -------------------------------------------------------- daily series */

    /** Builds the video for one day on the current (fresh) project. */
    async function makeDay(r, opts) {
        const occ = O.OCCASIONS.ramadan;
        const names = [occ.scenes[(r.day - 1) % occ.scenes.length], occ.scenes[(r.day + 1) % occ.scenes.length]];
        let p = app.state.project;
        const files = await O.sceneFiles(names, p.width, p.height, 'Ramadan day ' + r.day);
        const ids = await app.importFiles(files, { noCommit: true, fresh: true, origin: 'occasion' });
        if (!ids.length) throw new Error('The scenes could not be made.');
        p = app.state.project;
        const len = Math.max(10, Math.min(24, 8 + r.text.split(/\s+/).length * 0.28));
        p = window.ReelPauses.picturesOnCuts(p, ids, 0, len, [len / 2], { trackName: 'Ramadan scenes', transition: 'crossfade', kenBurns: true });
        const tall = p.height > p.width;
        const add = function (name, clip) { const id = T.nextTrackId(p, 'text'); p = T.addTrack(p, 'text', name); p = T.addClip(p, Object.assign(clip, { track: id })); };
        add('Day', text(null, 0.2, len - 0.2, (opts.heading || 'Ramadan · Day') + ' ' + r.day, { fontSize: tall ? 54 : 64, color: occ.color, y: tall ? 0.13 : 0.12, anim: 'drop', exit: 'fade' }));
        add('Theme', text(null, 0.7, len - 0.7, r.theme, { fontSize: tall ? 40 : 46, bold: false, y: tall ? 0.22 : 0.24, anim: 'fade', exit: 'fade' }));
        add('Reminder', text(null, 1.3, len - 3.3, r.text, { fontSize: tall ? 42 : 46, bold: false, y: 0.5, box: true, boxColor: '#000000', anim: 'rise', exit: 'fade' }));
        add('Reference', text(null, 1.9, len - 3.9, '— ' + r.ref, { fontSize: tall ? 30 : 32, bold: false, color: occ.color, y: tall ? 0.71 : 0.78, anim: 'fade', exit: 'fade' }));
        add('Closing', text(null, len - 2, 2, opts.closing || 'Ramadan Kareem', { fontSize: tall ? 52 : 60, color: occ.color, y: tall ? 0.85 : 0.88, anim: 'pop', exit: 'fade' }));
        app.apply(p);
        app.zoomToFit();
        app.seek(Math.min(4, len / 2));
    }

    function openSeries() {
        app.pause();
        const day = el('select', null, R.REMINDERS.map((r, i) => el('option', { value: String(i + 1), text: 'Day ' + (i + 1) + ' — ' + r[0] })));
        const theme = el('input', { type: 'text', maxlength: 80 });
        const words = el('textarea', { rows: 4, maxlength: 400 });
        const ref = el('input', { type: 'text', maxlength: 80 });
        const closing = el('input', { type: 'text', maxlength: 80 });
        const shape = shapeSelect();
        const kit = window.ReelBrand && window.ReelBrand.get();
        closing.value = 'Ramadan Kareem' + (kit && kit.name ? ' · ' + kit.name : '');
        const fill = function () { const r = R.reminder(Number(day.value)); theme.value = r.theme; words.value = r.text; ref.value = r.ref; };
        day.addEventListener('change', fill);
        fill();
        app.openDialog({
            title: 'Ramadan daily reminders',
            wide: true,
            intro: 'One short video for each day of Ramadan: an ayah or hadith with its reference, on painted Ramadan scenes. Make today’s, then come back tomorrow for the next. Every line can be changed — use your own translation or language, and check the wording against your trusted source before sharing.',
            body: [
                app.dialogField('Day', day),
                app.dialogField('Theme', theme),
                app.dialogField('Reminder', words),
                app.dialogField('Reference', ref),
                app.dialogField('Closing line', closing),
                app.dialogField('Shape', shape)
            ],
            actions: [{ label: 'Cancel' }, {
                label: 'Make this day’s video', primary: true, run: async function (d) {
                    d.busy(true);
                    d.status('Painting the scenes…');
                    try {
                        const r = { day: Number(day.value), theme: theme.value.trim(), text: words.value.trim() || R.reminder(Number(day.value)).text, ref: ref.value.trim() };
                        freshProject(shape.value, 'Ramadan day ' + r.day);
                        await makeDay(r, { closing: closing.value.trim() });
                        app.toast('Day ' + r.day + ' is ready. Press Space to watch, then Export.');
                    } catch (err) { d.busy(false); d.status(err.message); return false; }
                    return true;
                }
            }]
        });
    }

    app.addTool({ section: 'Create', label: 'Occasion greeting for someone (with their name)…', run: openGreeting });
    app.addTool({ section: 'Create', label: 'Ramadan daily reminders (30 days)…', run: openSeries });
    Object.assign(window.ReelRamadan, { openGreeting, openSeries, makeDay });
}());
