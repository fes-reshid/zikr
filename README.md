# Zikr — Qur'ān Daily Tracker & Reader

Two pages for reading one juz of the Qur'ān a day, published as part of
[diinislaam.com](https://diinislaam.com):

| Page | What it does |
| --- | --- |
| `/quran-tracker/` | The day's juz, your streak, and the last week of progress |
| `/quran-tracker/reader/` | Reads and recites any juz, verse by verse |

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

No build step. Open `index.html` in a browser, or serve the folder:

```sh
npm run serve   # http://localhost:8000
```

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
cp dist/quran-tracker/index.html ../barnoota/quran-tracker/index.html
```

Committing that to `main` publishes it at
`https://diinislaam.com/quran-tracker/`. The file is generated — edit the
source here and rebuild, never the copy in the site repo.

Because the page can be served from either repo, its header and footer links
are absolute `https://diinislaam.com/...` URLs rather than the site's usual
relative ones, so the navigation works from both.

### Any other host

Copy `dist/quran-tracker/` into the document root. The app is static, has no
server side, and touches no other path.

### Cloudflare Worker

`cloudflare/` deploys the page as a Worker on the route
`diinislaam.com/quran-tracker*`, for a domain where the origin cannot be
changed. Only that path is intercepted; everything else continues to the
existing origin.

```sh
npm run build
npx wrangler login
npx wrangler deploy --config cloudflare/wrangler.toml
```

### GitHub Pages

`.github/workflows/pages.yml` publishes `dist/` on every push. Pages has to be
turned on once by hand, under **Settings → Pages → Build and deployment →
Source → GitHub Actions**; the workflow token is not allowed to create the
Pages site itself.

## Tests

```sh
npm test        # date, cycle and streak logic (Node, no dependencies)
npm run test:e2e   # full UI in headless Chromium, Quran.com API stubbed
```

The unit tests run the pure logic in `src/core.js` under several timezones. The
end-to-end test drives the real `index.html` and needs Chromium:

```sh
npm install && npx playwright install chromium
```

It skips itself with a message if `playwright-core` is not installed. Set
`CHROMIUM_PATH` to use a Chromium you already have.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Markup plus the UI code that drives it |
| `src/core.js` | Pure date/cycle/streak logic, no DOM — shared with the tests |
| `test/core.test.js` | Unit tests for that logic |
| `test/browser.test.js` | End-to-end test of the page |

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
