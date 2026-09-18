/* Small helpers shared by the Worker modules. */

const encoder = new TextEncoder();

export function b64url(bytes) {
    let binary = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Tokens are only ever stored hashed, so the tables are useless if leaked. */
export async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
    return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
    return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function json(body, init = {}) {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            ...(init.headers || {})
        }
    });
}

export function now() {
    return Math.floor(Date.now() / 1000);
}

/**
 * The calendar day and hour where the person is, not where the server is —
 * a reminder at 20:00 has to mean their 20:00.
 */
export function localParts(date, timeZone) {
    let zone = timeZone || 'UTC';
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', hour12: false
        }).formatToParts(date);
    } catch (err) {
        // An unknown zone must not stop everyone else being reminded.
        parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', hour12: false
        }).formatToParts(date);
    }
    const map = {};
    for (const part of parts) map[part.type] = part.value;
    return {
        day: map.year + '-' + map.month + '-' + map.day,
        hour: Number(map.hour) % 24 // some engines report hour 24 for midnight
    };
}

export function isDayKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isEmail(value) {
    return typeof value === 'string' && value.length <= 254 &&
        /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(value);
}

export function isTimeZone(value) {
    if (typeof value !== 'string' || value.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: value });
        return true;
    } catch (err) {
        return false;
    }
}
