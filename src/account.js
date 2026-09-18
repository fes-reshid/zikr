/*
 * Optional accounts.
 *
 * Signing in is never required: both pages work from localStorage alone, and
 * every call here fails soft. An account only adds carrying the reading log
 * between devices and being reminded when a day is missed.
 *
 * Exposes window.QuranAccount.
 */
(function () {
    'use strict';

    var API = '{{ROOT}}api/';
    var SYNCED_KEY = 'quran_synced_with';

    // `available` stays false when there is no API deployed, or it is
    // unreachable; the pages then show nothing about accounts at all.
    var state = { ready: false, available: false, signedIn: false, user: null, days: [] };
    var listeners = [];

    function emit() {
        listeners.forEach(function (fn) {
            try { fn(state); } catch (err) { console.error(err); }
        });
    }

    async function api(method, route, body) {
        var response = await fetch(API + route, {
            method: method,
            credentials: 'same-origin',
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        var payload = null;
        try { payload = await response.json(); } catch (err) { /* empty body */ }
        return { ok: response.ok, status: response.status, body: payload || {} };
    }

    function localStore(key) {
        try { return localStorage.getItem(key); } catch (err) { return null; }
    }
    function setLocalStore(key, value) {
        try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
    }

    function guessTimeZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
        catch (err) { return 'UTC'; }
    }

    /**
     * Loads the session. `localDays` and `localProfile` are what this device
     * already had: on the first sign-in they are merged up, so a streak built
     * before signing in is not lost. The merge only ever adds days.
     */
    async function load(localDays, localProfile) {
        var result;
        try {
            result = await api('GET', 'me');
        } catch (err) {
            // Offline, or no API deployed: the pages carry on without it.
            state.ready = true;
            state.available = false;
            emit();
            return state;
        }

        state.available = result.ok;

        if (!result.ok || !result.body.signedIn) {
            state.ready = true;
            state.signedIn = false;
            state.user = null;
            state.days = [];
            emit();
            return state;
        }

        state.signedIn = true;
        state.user = result.body.user;
        state.days = result.body.days || [];

        if (localStore(SYNCED_KEY) !== state.user.email) {
            if (localDays && localDays.length) {
                var merged = await api('POST', 'sync', { days: localDays });
                if (merged.ok) state.days = merged.body.days || state.days;
            }
            setLocalStore(SYNCED_KEY, state.user.email);
        }

        // A fresh account adopts whatever this device already knew.
        var fill = {};
        if (!state.user.name && localProfile && localProfile.name) fill.name = localProfile.name;
        if (!state.user.startDate && localProfile && localProfile.startDate) {
            fill.startDate = localProfile.startDate;
        }
        if (state.user.timezone === 'UTC') fill.timezone = guessTimeZone();
        if (Object.keys(fill).length) {
            var saved = await api('PUT', 'profile', fill);
            if (saved.ok) state.user = saved.body.user;
        }

        state.ready = true;
        emit();
        return state;
    }

    async function requestLink(email) {
        var result = await api('POST', 'login', { email: email });
        return result.ok
            ? { ok: true, message: result.body.message }
            : { ok: false, message: (result.body && result.body.error) || 'Could not send the link.' };
    }

    async function signOut() {
        await api('POST', 'logout');
        state.signedIn = false;
        state.user = null;
        state.days = [];
        try { localStorage.removeItem(SYNCED_KEY); } catch (err) { /* ignore */ }
        emit();
    }

    async function saveProfile(fields) {
        var result = await api('PUT', 'profile', fields);
        if (result.ok) {
            state.user = result.body.user;
            emit();
        }
        return result.ok;
    }

    /** Fire and forget: the local log stays the thing the page renders. */
    function setDay(day, read, juz) {
        if (!state.signedIn) return Promise.resolve(false);
        return api('POST', 'readings', { day: day, read: read, juz: juz })
            .then(function (result) {
                if (result.ok) state.days = result.body.days || state.days;
                return result.ok;
            })
            .catch(function () { return false; });
    }

    async function deleteAccount() {
        var result = await api('DELETE', 'account');
        if (result.ok) await signOut();
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
            ? 'granted'
            : await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };

        var keyResult = await api('GET', 'push/key');
        var key = keyResult.body && keyResult.body.key;
        if (!key) return { ok: false, reason: 'no-key' };

        var registration = await navigator.serviceWorker.ready;
        var subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key)
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
        load: load,
        requestLink: requestLink,
        signOut: signOut,
        saveProfile: saveProfile,
        setDay: setDay,
        deleteAccount: deleteAccount,
        enablePush: enablePush,
        disablePush: disablePush,
        pushSupported: pushSupported,
        guessTimeZone: guessTimeZone
    };
})();
