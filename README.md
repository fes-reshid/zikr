# Zikr — Qur'ān Daily Tracker & Reader

Two pages for reading one juz of the Qur'ān a day, published as part of
[diinislaam.com](https://diinislaam.com):

| Page | What it does |
| --- | --- |
| `/quran-tracker/` | The day's juz, your streak, and the last week of progress |
| `/quran-tracker/reader/` | Reads and recites any juz, verse by verse |

It installs to a phone's home screen as a progressive web app, so it opens
without browser chrome and the pages you have already opened work offline.

Signing in is optional and uses the site's existing accounts — the same
username and password as the quest games, with no email anywhere. It adds two
things: the reading log follows you between devices, and a missed day is
followed by a notification. Without an account everything still works, stored on
the device alone, and if either the shared accounts module or the reminder API
is absent the pages show nothing about accounts at all.

Everything is stored in your browser's `localStorage`. There is no account and
no server; the only requests leaving the device go to the Quran.com API for
verse text and recitation audio.

The pages are styled to match diinislaam.com — the same parchment/gold/green
tokens, the same Amiri / Cormorant Garamond / Marcellus fonts, and the site's
own header and footer. Following the site's convention each page is
self-contained with inline CSS: there is no Tailwind and no icon font.

## The cycle

The Quran has 30 Juz and Hijri months run 29–30 days, so one Juz a day lines up
with a month. This app anchors the cycle so that **Juz 1 falls on Rabiʿ II 1**,
which makes the Juz number match the day of the month through Rabiʿ II:

| Date | Hijri | Juz |
| --- | --- | --- |
| 2026-09-12 | Rabiʿ II 1, 1448 | 1 |
| 2026-09-18 | Rabiʿ II 7, 1448 | 7 |
| 2026-10-11 | Rabiʿ II 30, 1448 | 30 |
| 2026-10-12 | Jumada I 1, 1448 | 1 (cycle repeats) |

On first run the start date is pre-filled with the most recent Rabiʿ II 1,
derived from the Umm al-Qura calendar via `Intl.DateTimeFormat`. You can change
it if you started your cycle on a different day — the 30-day rotation just
follows whatever anchor you set.

The page is styled to match [diinislaam.com](https://diinislaam.com): the same
parchment/gold/green tokens, the same Amiri / Cormorant Garamond / Marcellus
fonts, and the site's own header and footer, so it reads as a page of that site
rather than a separate app. Following the site's convention, all of its CSS is
inline — there is no Tailwind, no icon font, and the only external requests are
Google Fonts and the Quran.com API.

## Running it

```sh
npm run build   # pages/ + src/ -> dist/
npm run serve   # http://localhost:8000/quran-tracker/
```

`dist/` is committed, so serving works without building first; rebuild after
editing anything under `pages/` or `src/`. Opening
`dist/quran-tracker/index.html` straight off disk works too, except for the
service worker, which needs an http origin.

## Installing it on a phone

The pages ship a web app manifest, icons and a service worker, so both Android
and iOS can install them to the home screen. Once installed the app opens
standalone — no address bar — and moving between the tracker and the reader is
served from cache, so the header does not blink between pages.

- **Android / Chrome** fires `beforeinstallprompt`, so the tracker shows an
  Install button.
- **iOS / Safari** has no such event and installs only through *Share → Add to
  Home Screen*, so the tracker shows those steps instead of a button that could
  not work.

The service worker is registered under `/quran-tracker/` and its scope is that
directory, so no other page of the site can be intercepted by it — there is a
test for exactly that. It caches the two pages, the manifest and the icons, and
deliberately leaves the Quran.com API and the recitation audio alone: the audio
is far too large to cache and both pages already handle it failing. Its cache
name carries a hash of the build, so a deploy replaces the old cache instead of
serving a stale page.

`npm run icons` regenerates the PNGs from one HTML source with Playwright. They
are committed, so an ordinary build needs neither a browser nor that script.

## Accounts and reminders

Accounts are not this project's. `kids-quest-cloud.js` on diinislaam.com already
signs people in to the quest games with a **username and password** against the
Firebase project `diinislaam-8fdeb`, and the tracker reuses exactly those: the
same credentials as Arabic Quest, and no second account to create.

**No email address is involved anywhere.** Those accounts are keyed by username
— the module maps each one to a synthetic `+tag` address internally, which the
tracker never sees. Sign-up here passes an empty contact address, and the
reminder API stores only the Firebase `uid`, an opaque id. No email, no
username, no display name reaches the server.

`api/` is a Cloudflare Worker at `diinislaam.com/quran-tracker/api/*`. It exists
for one reason: a notification has to be sent while nobody has the page open,
and that needs something on a schedule. It never handles a password and issues
no session of its own — the page sends the Firebase ID token, the Worker
verifies it against Google's published signing keys, and keeps the `sub` claim.

The cron runs hourly rather than nightly because "20:00" has to mean 20:00 where
the person is; each run takes those whose local clock has just reached their
chosen hour, have not marked the day, and have not already been nudged. A row is
claimed before anything is sent, so overlapping runs cannot nudge twice, and a
subscription the browser has dropped is deleted on 404/410.

Push is sent **without a payload**. Encrypting one per subscription buys nothing
when the message is always the same, so only the VAPID signature is needed and
the service worker asks the API which juz is due when it wakes.

### Why there is no email reminder

There is no address to send one to. Every quest account maps to a synthetic
`fesbackups+quest-<username>@gmail.com`, which delivers to the site admin's own
inbox — so "emailing the user" would in fact email the admin, once per person
per day. A notification reaches the actual person; an email would not. Adding
real email would mean collecting and storing addresses, which is exactly what
this design avoids.

### Setting it up

```sh
cd api
npm install
npx wrangler login

npx wrangler d1 create quran-tracker     # put the id into wrangler.toml
npm run db:remote                        # create the tables

npm run vapid                            # generates the two push keys
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_JWK

npx wrangler deploy
```

Until the Worker is deployed people can still sign in; the account sheet says
reminders are not switched on and everything else behaves normally.

`npm test` in `api/` runs the suite against a real `wrangler dev` with a local
D1. It mints its own Firebase-shaped ID tokens and serves the matching public
key from a stub, so the Worker's real verification path runs — including the
rejections: another project's token, a wrong issuer, an expired one, a tampered
payload, an unknown signing key. Push goes to the same stub, so the VAPID
signature it actually sends is verified against the public key.

## Deploying

`npm run build` inlines `src/core.js` into a single self-contained
`dist/quran-tracker/index.html`. One file, no relative references, so it works
at any URL depth — including `/quran-tracker` served without a trailing slash,
where a relative `src/core.js` would otherwise resolve to `/src/core.js` and
break the page. `npm test` fails if the committed build is stale, so `dist/`
cannot drift from the source.

### diinislaam.com

The live site is the `fes-reshid/barnoota` repo, served by GitHub Pages from
`main` with Cloudflare in front. Copy the built file in as a page:

```sh
npm run build
cp -r dist/quran-tracker/. ../barnoota/quran-tracker/
```

That copies both pages plus the manifest, service worker and icons.

Committing that to `main` publishes it at
`https://diinislaam.com/quran-tracker/`. The file is generated — edit the
source here and rebuild, never the copy in the site repo.

Because the page can be served from either repo, its header and footer links
are absolute `https://diinislaam.com/...` URLs rather than the site's usual
relative ones, so the navigation works from both.

### Any other host

Copy `dist/quran-tracker/` into the document root. The app is static, has no
server side, and touches no other path.

## Tests

```sh
npm test           # date, cycle and streak logic (Node, no dependencies)
npm run test:e2e   # both pages plus the installable behaviour, in Chromium
```

The end-to-end suites stub Quran.com, so they run offline. The reader's suite
serves each verse as a short silent WAV, so playback genuinely runs and `ended`
really fires — the auto-advance and the auto-tick are exercised, not assumed.

The unit tests run the pure logic in `src/core.js` under several timezones. The
end-to-end suites drive the built pages in `dist/` — what actually ships — and
need Chromium:

```sh
npm install && npx playwright install chromium
```

It skips itself with a message if `playwright-core` is not installed. Set
`CHROMIUM_PATH` to use a Chromium you already have.

## Layout

| Path | What it is |
| --- | --- |
| `pages/` | The page sources, with build placeholders |
| `src/core.js` | Pure date/cycle/streak logic, no DOM — shared with the tests |
| `src/site.css`, `src/chrome-*.html` | Chrome shared by both pages |
| `src/sw.js`, `src/manifest.webmanifest`, `src/icons/` | The installable app |
| `build.js` | Inlines the shared parts and writes `dist/` |
| `tools/make-icons.js` | Regenerates the app icons |
| `test/core.test.js` | Unit tests for the date logic |
| `test/tracker.test.js`, `test/reader.test.js` | End-to-end tests of each page |
| `test/pwa.test.js` | Manifest, offline behaviour and worker scope |
| `test/account.test.js` | The sign-in UI, against a stubbed API |
| `api/` | The Cloudflare Worker: accounts, sync and reminders |

`src/core.js` loads as a plain script in the browser (`window.QuranCore`) and as
a CommonJS module in Node, so the same code is tested and shipped. It is not an
ES module on purpose: `file://` pages cannot load those.

## Notes on the implementation

Things that are easy to get wrong here, each covered by a test:

- **Dates are local, never UTC.** `new Date('2026-09-12')` parses as UTC
  midnight, which is the *previous* day west of Greenwich — enough to show the
  wrong juz all day. Date keys are built and parsed from local calendar fields.
- **Day counts survive DST.** Day arithmetic normalises to local midnight, so a
  week spanning a clock change is still seven days.
- **The Hijri date is computed, not hardcoded**, including the year.
- **Nothing is identified by a hardcoded API id.** Reciters and the translation
  are resolved by matching names against Quran.com's own `/resources` lists at
  runtime. The first version pinned `translations=131` and labelled it "Saheeh
  International"; that id is something else, and the result was verses with no
  translation at all. Matching by name cannot drift like that, and the page
  shows whichever name the API gives back.
- **Whole juz, not the first page of one.** Quran.com caps `per_page` at 50
  while a juz runs to a few hundred verses, so both verses and audio follow
  `pagination.next_page`.
- **Arabic text is requested explicitly.** `text_uthmani` is only returned when
  asked for via `fields`; without it the verses arrive with no script.
- **Translations are rendered as text.** Quran.com returns HTML with footnote
  markup; the footnotes are stripped and the rest inserted as text, so no
  network content is ever executed as markup.
- **Audio URLs may be relative.** `audio_files[].url` comes back as a path, so
  it is resolved against `verses.quran.com` — and passed through untouched if
  it is already absolute.
- **One `<audio>` element for the session.** Reusing the element the listener
  first unlocked with a tap is what lets later verses start by themselves,
  iOS included; a fresh element per verse would need a new gesture. Playback
  uses a plain media element rather than the Web Audio API, which browsers
  suspend in the background.
- **A bad verse file does not end the session.** An audio error advances to the
  next verse instead of stopping.
- **Stale responses are discarded.** Each load carries a token, so switching
  juz or reciter mid-request cannot render the previous one's verses.
- **Finishing only ticks off the juz that was due.** If you listen to a
  different juz the page says so and changes nothing.
- **A tab left open past midnight rolls over** to the new day's juz, and the
  tracker re-reads the log on focus so a juz finished in the reader shows up.

## Known limits

- **Autoplay is best-effort.** Browsers refuse to start audio until a listener
  has interacted with the page, so the first play may need one tap; after that
  verses advance on their own. Passing `?autoplay=0` opens the reader paused.
- **Background playback depends on the browser.** Audio keeps going while the
  tab is backgrounded or the phone is locked, with lock-screen controls via the
  Media Session API, but a browser that discards the tab stops it.
