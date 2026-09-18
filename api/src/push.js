/*
 * Web Push, sent without a payload.
 *
 * A payload would have to be encrypted per subscription (aes128gcm over an
 * ECDH shared secret); sending none needs only the VAPID signature, and the
 * service worker fills in the message from the API when it wakes. The nudge
 * is the same every time, so nothing is lost and there is much less to get
 * subtly wrong.
 */
import { b64url } from './util.js';

const TWELVE_HOURS = 12 * 60 * 60;

async function signingKey(privateJwk) {
    const jwk = typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk;
    return crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
}

export async function vapidAuthorization(env, endpoint) {
    const encoder = new TextEncoder();
    const audience = new URL(endpoint).origin;

    const header = b64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = b64url(encoder.encode(JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + TWELVE_HOURS,
        sub: env.VAPID_SUBJECT || 'mailto:fesbackups@gmail.com'
    })));

    const unsigned = header + '.' + claims;
    const key = await signingKey(env.VAPID_PRIVATE_JWK);
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)
    );

    return 'vapid t=' + unsigned + '.' + b64url(new Uint8Array(signature)) +
        ', k=' + env.VAPID_PUBLIC_KEY;
}

/** `gone` means the browser dropped the subscription and the row should go. */
export async function sendPush(env, endpoint) {
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: await vapidAuthorization(env, endpoint),
                TTL: '86400',
                Urgency: 'normal',
                'Content-Length': '0'
            }
        });
        return {
            ok: response.ok,
            status: response.status,
            gone: response.status === 404 || response.status === 410
        };
    } catch (err) {
        return { ok: false, status: 0, gone: false, error: String(err) };
    }
}
