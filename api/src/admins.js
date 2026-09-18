/*
 * Who may see the whole-group report.
 *
 * The site already keeps its admin roster in Firestore at
 * kids_quest_admins/{email}, and kids-admin.html reads it to decide who gets
 * in. The client deciding that is no use to a server, so this checks the same
 * document itself — using the caller's own ID token, so the project's own
 * Firestore rules still apply and no service-account key is needed here.
 *
 * ADMIN_EMAILS is a comma-separated fallback, for a project whose rules do not
 * let an admin read that collection directly.
 */
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/';
const COLLECTION = 'kids_quest_admins';

function listed(env, email) {
    const allowed = String(env.ADMIN_EMAILS || '')
        .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    return allowed.indexOf(email) !== -1;
}

export async function isAdmin(env, claims, token) {
    const email = String((claims && claims.email) || '').trim().toLowerCase();
    if (!email) return false;
    if (listed(env, email)) return true;

    const base = env.FIRESTORE_BASE || FIRESTORE;
    const url = base + encodeURIComponent(env.FIREBASE_PROJECT_ID) +
        '/databases/(default)/documents/' + COLLECTION + '/' + encodeURIComponent(email);

    try {
        const response = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
        // 404 means no such admin; 403 means the rules hide the collection, in
        // which case ADMIN_EMAILS is the way in and this is correctly a no.
        return response.status === 200;
    } catch (err) {
        return false;
    }
}
