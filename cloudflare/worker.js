/*
 * Serves the Quran tracker at /quran-tracker on a domain that is already on
 * Cloudflare, without touching whatever serves the rest of the site.
 *
 * The Worker route only matches /quran-tracker*; every other request never
 * reaches this code and continues to the existing origin untouched. Nothing
 * about the site's DNS, hosting or content changes.
 *
 * The page is compiled into the Worker as a text module (see wrangler.toml),
 * so there is no origin to fetch from and nothing else to keep running.
 */
import page from '../dist/quran-tracker/index.html';

const BASE = '/quran-tracker';

export default {
    fetch(request) {
        const url = new URL(request.url);

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', {
                status: 405,
                headers: { Allow: 'GET, HEAD' }
            });
        }

        // Keep one canonical URL: /quran-tracker -> /quran-tracker/
        if (url.pathname === BASE) {
            url.pathname = BASE + '/';
            return Response.redirect(url.toString(), 301);
        }

        // The app is a single page; anything deeper under it is not a thing.
        if (url.pathname !== BASE + '/') {
            return new Response('Not found', { status: 404 });
        }

        return new Response(request.method === 'HEAD' ? null : page, {
            headers: {
                'content-type': 'text/html; charset=utf-8',
                // Short cache: the page is small and updates should show up.
                'cache-control': 'public, max-age=300',
                'x-content-type-options': 'nosniff',
                'referrer-policy': 'strict-origin-when-cross-origin'
            }
        });
    }
};
