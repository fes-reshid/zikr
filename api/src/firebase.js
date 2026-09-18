/*
 * Verifies a Firebase ID token.
 *
 * The site already has accounts — kids-quest-cloud.js signs people in to the
 * quest games with a username and password against the Firebase project
 * diinislaam-8fdeb. The tracker reuses exactly those accounts, so this Worker
 * never handles a password, never issues a session, and never sees an email
 * address: the page sends the ID token Firebase gave it, and all that is kept
 * here is the `sub` claim, an opaque user id.
 */
const GOOGLE_JWKS_URL =
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedKeys = null;
let cachedUntil = 0;

function b64urlToBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Google rotates these roughly daily; honour the Cache-Control it sends. */
async function publicKeys(jwksUrl) {
    const seconds = Math.floor(Date.now() / 1000);
    if (cachedKeys && seconds < cachedUntil) return cachedKeys;

    const response = await fetch(jwksUrl || GOOGLE_JWKS_URL);
    if (!response.ok) throw new Error('could not fetch Google signing keys');
    const body = await response.json();

    const control = response.headers.get('cache-control') || '';
    const maxAge = Number((control.match(/max-age=(\d+)/) || [])[1] || 3600);
    cachedKeys = body.keys || [];
    cachedUntil = seconds + Math.max(300, maxAge);
    return cachedKeys;
}

export function resetKeyCache() {
    cachedKeys = null;
    cachedUntil = 0;
}

/**
 * Returns the token's claims, or null for anything that does not verify.
 * Deliberately silent about which check failed: the caller has nothing useful
 * to do with the distinction.
 */
export async function verifyClaims(token, projectId, options = {}) {
    if (!projectId) return null;
    if (typeof token !== 'string' || token.split('.').length !== 3) return null;

    const [headerPart, payloadPart, signaturePart] = token.split('.');
    let header, claims;
    try {
        header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerPart)));
        claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadPart)));
    } catch (err) {
        return null;
    }

    if (header.alg !== 'RS256' || !header.kid) return null;

    const seconds = Math.floor(Date.now() / 1000);
    if (!claims.sub || typeof claims.sub !== 'string') return null;
    if (claims.aud !== projectId) return null;
    if (claims.iss !== 'https://securetoken.google.com/' + projectId) return null;
    if (!(claims.exp > seconds)) return null;
    if (claims.iat && claims.iat > seconds + 300) return null;

    let keys;
    try {
        keys = await publicKeys(options.jwksUrl);
    } catch (err) {
        return null;
    }
    const jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) return null;

    try {
        const key = await crypto.subtle.importKey(
            'jwk',
            { kty: jwk.n ? 'RSA' : jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
        );
        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            b64urlToBytes(signaturePart),
            new TextEncoder().encode(headerPart + '.' + payloadPart)
        );
        return valid ? claims : null;
    } catch (err) {
        return null;
    }
}

/** Just the user id, which is all most routes need. */
export async function verifyIdToken(token, projectId, options = {}) {
    const claims = await verifyClaims(token, projectId, options);
    return claims ? claims.sub : null;
}

export function bearerToken(request) {
    const header = request.headers.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : null;
}
