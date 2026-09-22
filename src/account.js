/*
 * Optional sign-in, using the site's existing accounts.
 *
 * The quest games already sign people in with a username and password through
 * kids-quest-cloud.js (Firebase project diinislaam-8fdeb), so the tracker
 * reuses exactly those accounts: the same username and password as Arabic
 * Quest, and no second account to create.
 *
 * No email is involved anywhere. Those accounts are keyed by username, and the
 * reminder API is told only the Firebase ID token, from which it keeps just the
 * opaque user id. Signing in remains entirely optional: both pages work from
 * localStorage alone, every call here fails soft, and if either the shared
 * auth module or the reminder API is missing, the pages show nothing about
 * accounts at all.
 *
 * Exposes window.QuranAccount.
 */
(function () {
    'use strict';

    var API = '{{ROOT}}api/';
    var SYNCED_KEY = 'quran_synced_with';
    var PENDING_KEY = 'quran_pending_writes';
    var CLOUD_WAIT_MS = 8000; // ultimate fallback only; the error listener below is what actually fires fast

    var state = {
        ready: false,
        available: false,   // the shared auth module loaded
        apiReady: false,    // the reminder API answered
        signedIn: false,
        user: null,         // { uid, username, displayName, fullName }
        settings: null,
        days: []
    };
    var listeners = [];
    var pendingLocal = { days: [], profile: null };

    function emit() {
        listeners.forEach(function (fn) {
            try { fn(state); } catch (err) { console.error(err); }
        });
    }

    function cloud() { return window.KidsCloud; }

    /**
     * Resolves once the shared auth module is on the page, or null if it never
     * is. Memoized: every caller shares one wait rather than racing separate
     * listeners, and `signIn`/`signUp` can call this even before `start()` has
     * — a click on the very first screen should not have to wait for `start()`
     * to get there first.
     *
     * A missing script fires the element's own `error` event almost at once,
     * so that is what settles this on a 404 — the timeout below only guards
     * against the module loading but never calling back, which `error` cannot
     * catch.
     */
    var cloudPromise = null;
    function waitForCloud() {
        if (cloudPromise) return cloudPromise;
        if (cloud()) return (cloudPromise = Promise.resolve(cloud()));

        cloudPromise = new Promise(function (resolve) {
            var settled = false;
            function done(value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }
            function onScriptError(event) {
                var target = event && event.target;
                if (target && target.tagName === 'SCRIPT' &&
                    /kids-quest-cloud\.js/.test(target.src || '')) {
                    window.removeEventListener('error', onScriptError, true);
                    done(null);
                }
            }
            window.addEventListener('kidscloud-ready', function () { done(cloud()); });
            // capture: a resource load failure does not bubble.
            window.addEventListener('error', onScriptError, true);
            setTimeout(function () { done(cloud() || null); }, CLOUD_WAIT_MS);
        });
        return cloudPromise;
    }

    async function api(method, route, body) {
        var token = null;
        try {
            token = cloud() && cloud().getIdToken ? await cloud().getIdToken() : null;
        } catch (err) { token = null; }
        if (!token) return { ok: false, status: 401, body: {} };

        var response = await fetch(API + route, {
            method: method,
            headers: Object.assign(
                { authorization: 'Bearer ' + token },
                body ? { 'content-type': 'application/json' } : {}
            ),
            body: body ? JSON.stringify(body) : undefined
        });
        var payload = null;
        try { payload = await response.json(); } catch (err) { /* empty body */ }
        return { ok: response.ok, status: response.status, body: payload || {} };
    }

    function readLocal(key) {
        try { return localStorage.getItem(key); } catch (err) { return null; }
    }
    function writeLocal(key, value) {
        try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
    }

    function guessTimeZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
        catch (err) { return 'UTC'; }
    }

    function readPending() {
        try { return JSON.parse(readLocal(PENDING_KEY) || '{}') || {}; } catch (err) { return {}; }
    }
    function writePending(pending) { writeLocal(PENDING_KEY, JSON.stringify(pending)); }

    /*
     * Marking a day never waits on the network (see setDay below), so a
     * write that failed to reach the server — a cold Worker, a dropped
     * connection, a moment of downtime — has to be retried somewhere, or it
     * quietly vanishes the next time this runs: the GET below is trusted as
     * the day list, and that day was never in it. Replaying whatever is
     * still pending here, before that GET's answer is accepted, is what
     * keeps a mark-as-read from reverting itself on the next visit.
     */
    async function flushPending() {
        var pending = readPending();
        var days = Object.keys(pending);
        for (var i = 0; i < days.length; i++) {
            var day = days[i];
            var result = await api('POST', 'readings', { day: day, read: pending[day] });
            if (result.ok) {
                state.days = result.body.days || state.days;
                delete pending[day];
            }
        }
        writePending(pending);

        // Anything still pending — the retry above just failed too — is
        // still this device's most recent, real intent, more so than
        // whatever the server answered with. Overlay it onto state.days so
        // a caller reading state right after this sees that intent rather
        // than the server's stale answer, and it survives one more round.
        var stillPending = Object.keys(pending);
        if (stillPending.length) {
            var set = {};
            state.days.forEach(function (d) { set[d] = true; });
            stillPending.forEach(function (day) {
                if (pending[day]) set[day] = true; else delete set[day];
            });
            state.days = Object.keys(set);
        }
    }

    /* Pull the account's reading log, merging this device's in on first use. */
    async function refresh() {
        var result;
        try {
            result = await api('GET', 'me');
        } catch (err) {
            state.apiReady = false;
            emit();
            return;
        }
        if (!result.ok) {
            // Signed in, but the reminder API is not deployed or is unhappy.
            state.apiReady = false;
            emit();
            return;
        }

        state.apiReady = true;
        state.settings = result.body.settings;
        state.days = result.body.days || [];
        await flushPending();

        var marker = state.user ? state.user.uid : '';
        if (readLocal(SYNCED_KEY) !== marker) {
            if (pendingLocal.days.length) {
                var merged = await api('POST', 'sync', { days: pendingLocal.days });
                if (merged.ok) state.days = merged.body.days || state.days;
            }
            writeLocal(SYNCED_KEY, marker);
        }

        // A fresh account adopts the cycle this device already knew.
        var fill = {};
        if (!state.settings.startDate && pendingLocal.profile && pendingLocal.profile.startDate) {
            fill.startDate = pendingLocal.profile.startDate;
        }
        if (state.settings.timezone === 'UTC') fill.timezone = guessTimeZone();
        if (Object.keys(fill).length) {
            var saved = await api('PUT', 'settings', fill);
            if (saved.ok) state.settings = saved.body.settings;
        }
        emit();
    }

    /**
     * `localDays` and `localProfile` are what this device already had; they are
     * merged up the first time an account is used here, so a streak built
     * before signing in is not lost. The merge only ever adds days.
     */
    async function start(localDays, localProfile) {
        pendingLocal.days = localDays || [];
        pendingLocal.profile = localProfile || null;

        var kids = await waitForCloud();
        state.ready = true;
        if (!kids) {
            state.available = false;
            emit();
            return;
        }
        state.available = true;

        kids.onStudentAuth(function (user) {
            if (!user) {
                state.signedIn = false;
                state.user = null;
                state.settings = null;
                state.days = [];
                emit();
                return;
            }
            state.signedIn = true;
            state.user = { uid: user.uid, username: user.username,
                           displayName: user.displayName || user.username,
                           fullName: user.fullName || '' };
            emit();
            refresh();
        });
        emit();
    }

    function friendlyError(err) {
        var code = (err && err.code) || '';
        if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
            code === 'auth/user-not-found' || code === 'auth/invalid-login-credentials') {
            return 'That username and password do not match.';
        }
        if (code === 'auth/email-already-in-use') return 'That username is already taken.';
        if (code === 'auth/weak-password') return 'Choose a password of at least six characters.';
        if (code === 'auth/too-many-requests') return 'Too many attempts. Try again in a few minutes.';
        if (code === 'auth/network-request-failed') return 'No connection. Try again.';
        return (err && err.message) || 'Could not sign in.';
    }

    async function signIn(username, password) {
        var kids = await waitForCloud();
        if (!kids) return { ok: false, message: 'Accounts are not available on this page right now.' };
        try {
            await kids.studentLogin(username, password);
            return { ok: true };
        } catch (err) {
            return { ok: false, message: friendlyError(err) };
        }
    }

    async function signUp(username, password, fullName) {
        var kids = await waitForCloud();
        if (!kids) return { ok: false, message: 'Accounts are not available on this page right now.' };
        try {
            // No contact address: these accounts are keyed by username, and
            // nothing here needs an email. fullName is optional and becomes
            // the account's display name in place of the username.
            await kids.studentSignUp(username, '', password, fullName || '');
            return { ok: true };
        } catch (err) {
            return { ok: false, message: friendlyError(err) };
        }
    }

    async function signOut() {
        try { await cloud().studentLogout(); } catch (err) { /* already out */ }
        try { localStorage.removeItem(SYNCED_KEY); } catch (err) { /* ignore */ }
        // A pending write is only meaningful for the account that made it —
        // on a shared device, replaying it after someone else signs in would
        // write to the wrong account.
        try { localStorage.removeItem(PENDING_KEY); } catch (err) { /* ignore */ }
    }

    async function saveSettings(fields) {
        var result = await api('PUT', 'settings', fields);
        if (result.ok) {
            state.settings = result.body.settings;
            emit();
        }
        return result.ok;
    }

    /*
     * Fire and forget: the local log stays the thing the page renders, so
     * this never makes the caller wait. But "fire and forget" must not mean
     * "and maybe lose it" — the write is recorded as pending first, and only
     * cleared once the server has actually confirmed it, so a failed
     * attempt gets replayed by the next refresh() instead of silently
     * reverting on the next visit.
     */
    function setDay(day, read) {
        if (!state.signedIn) return Promise.resolve(false);
        var pending = readPending();
        pending[day] = read;
        writePending(pending);

        return api('POST', 'readings', { day: day, read: read })
            .then(function (result) {
                if (result.ok) {
                    state.days = result.body.days || state.days;
                    var stillPending = readPending();
                    if (stillPending[day] === read) {
                        delete stillPending[day];
                        writePending(stillPending);
                    }
                }
                return result.ok;
            })
            .catch(function () { return false; });
    }

    async function forgetMe() {
        var result = await api('DELETE', 'me');
        return result.ok;
    }

    // --- Push -------------------------------------------------------------
    function urlBase64ToUint8Array(base64) {
        var padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
            .replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(padded);
        var output = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
        return output;
    }

    function pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window &&
            typeof Notification !== 'undefined';
    }

    async function enablePush() {
        if (!pushSupported()) return { ok: false, reason: 'unsupported' };
        if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };

        var permission = Notification.permission === 'granted'
            ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };

        var keyResponse = await fetch(API + 'push/key');
        var keyBody = keyResponse.ok ? await keyResponse.json() : null;
        if (!keyBody || !keyBody.key) return { ok: false, reason: 'no-key' };

        var registration = await navigator.serviceWorker.ready;
        var subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(keyBody.key)
            });
        }
        var saved = await api('POST', 'push/subscribe', { endpoint: subscription.endpoint });
        return saved.ok ? { ok: true } : { ok: false, reason: 'save-failed' };
    }

    async function disablePush() {
        if (!pushSupported()) return;
        try {
            var registration = await navigator.serviceWorker.ready;
            var subscription = await registration.pushManager.getSubscription();
            if (subscription) {
                await api('POST', 'push/unsubscribe', { endpoint: subscription.endpoint });
                await subscription.unsubscribe();
            }
        } catch (err) { /* nothing subscribed */ }
    }

    window.QuranAccount = {
        state: state,
        onChange: function (fn) { listeners.push(fn); },
        start: start,
        signIn: signIn,
        signUp: signUp,
        signOut: signOut,
        saveSettings: saveSettings,
        setDay: setDay,
        forgetMe: forgetMe,
        enablePush: enablePush,
        disablePush: disablePush,
        pushSupported: pushSupported,
        guessTimeZone: guessTimeZone
    };
})();
