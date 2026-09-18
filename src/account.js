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
    var CLOUD_WAIT_MS = 8000;

    var state = {
        ready: false,
        available: false,   // the shared auth module loaded
        apiReady: false,    // the reminder API answered
        signedIn: false,
        user: null,         // { uid, username, displayName }
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

    /** Resolves once the shared auth module is on the page, or null if it never is. */
    function waitForCloud() {
        if (cloud()) return Promise.resolve(cloud());
        return new Promise(function (resolve) {
            var settled = false;
            function done(value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }
            window.addEventListener('kidscloud-ready', function () { done(cloud()); });
            setTimeout(function () { done(cloud() || null); }, CLOUD_WAIT_MS);
        });
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
                           displayName: user.displayName || user.username };
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
        try {
            await cloud().studentLogin(username, password);
            return { ok: true };
        } catch (err) {
            return { ok: false, message: friendlyError(err) };
        }
    }

    async function signUp(username, password) {
        try {
            // No contact address: these accounts are keyed by username, and
            // nothing here needs an email.
            await cloud().studentSignUp(username, '', password);
            return { ok: true };
        } catch (err) {
            return { ok: false, message: friendlyError(err) };
        }
    }

    async function signOut() {
        try { await cloud().studentLogout(); } catch (err) { /* already out */ }
        try { localStorage.removeItem(SYNCED_KEY); } catch (err) { /* ignore */ }
    }

    async function saveSettings(fields) {
        var result = await api('PUT', 'settings', fields);
        if (result.ok) {
            state.settings = result.body.settings;
            emit();
        }
        return result.ok;
    }

    /** Fire and forget: the local log stays the thing the page renders. */
    function setDay(day, read) {
        if (!state.signedIn) return Promise.resolve(false);
        return api('POST', 'readings', { day: day, read: read })
            .then(function (result) {
                if (result.ok) state.days = result.body.days || state.days;
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
