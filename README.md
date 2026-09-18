# Zikr — Quran Daily Tracker & Reader

A single-page web app for reading one Juz of the Quran a day. It tracks your
streak, shows the last week of progress, and reads the day's Juz inline using
the [Quran.com API](https://api-docs.quran.com/).

Everything is stored in your browser's `localStorage`. There is no account, no
server, and nothing leaves your device except the verse requests to Quran.com.

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

A few things that are easy to get wrong and are covered by tests:

- **Dates are local, never UTC.** `new Date('2026-09-12')` parses as UTC
  midnight, which is the *previous* day for anyone west of Greenwich — enough to
  show the wrong Juz all day. Date keys are built and parsed from local calendar
  fields instead.
- **Day counts survive DST.** Day arithmetic normalises to local midnight first,
  so a week spanning a clock change is still seven days.
- **The Hijri date is computed, not hardcoded**, including the year.
- **The reader pages through the whole Juz.** Quran.com caps `per_page` at 50
  while a Juz runs to a few hundred verses, so the reader follows
  `pagination.next_page` and appends each page as it arrives.
- **Arabic text is requested explicitly.** `text_uthmani` is only returned when
  asked for via `fields`; without it the verses come back with no script.
- **Translations are rendered as text.** Quran.com returns HTML with footnote
  markup; the footnotes are stripped and the rest is inserted as text, so no
  network content is ever executed as markup.
- **Stale responses are discarded.** Each load carries a token, so switching Juz
  mid-request cannot render the previous one's verses.
- **A tab left open past midnight rolls over** to the new day's Juz on its own.
