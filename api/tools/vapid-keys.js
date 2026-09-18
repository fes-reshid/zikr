#!/usr/bin/env node
/*
 * Generates the VAPID key pair that identifies this server to the push
 * services. Run once: `npm run vapid` in api/, then store the two secrets
 * with `wrangler secret put`.
 */
import { webcrypto } from 'node:crypto';

function b64url(bytes) {
    return Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
);

const publicRaw = await webcrypto.subtle.exportKey('raw', pair.publicKey);
const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);

console.log('VAPID_PUBLIC_KEY  (safe to publish, the page fetches it)\n');
console.log('  ' + b64url(new Uint8Array(publicRaw)) + '\n');
console.log('VAPID_PRIVATE_JWK (secret)\n');
console.log('  ' + JSON.stringify({
    kty: privateJwk.kty, crv: privateJwk.crv,
    d: privateJwk.d, x: privateJwk.x, y: privateJwk.y
}) + '\n');
console.log('Store them:');
console.log('  npx wrangler secret put VAPID_PUBLIC_KEY');
console.log('  npx wrangler secret put VAPID_PRIVATE_JWK');
