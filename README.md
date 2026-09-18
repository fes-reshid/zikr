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

## Running it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
npm run serve   # http://localhost:8000
```

Styling comes from the Tailwind CDN script, so the first load needs a network
connection. For an offline or production deployment, replace that script tag
with a pre-built Tailwind stylesheet.

## Deploying

`npm run build` inlines `src/core.js` into a single self-contained
`dist/quran-tracker/index.html`. One file, no relative references, so it works
at any URL depth — including `/quran-tracker` served without a trailing slash,
where a relative `src/core.js` would otherwise resolve to `/src/core.js` and
break the page. `npm test` fails if the committed build is stale, so `dist/`
cannot drift from the source.

### Onto a domain you already run

If you know what serves the domain — a VPS, cPanel, WordPress, any static host
— copy `dist/quran-tracker/` into its document root. The app is static, has no
server side, and touches no other path, so nothing else changes.

### Onto a domain behind Cloudflare, without knowing the origin

`cloudflare/` deploys the app as a Worker bound to the route
`diinislaam.com/quran-tracker*`. Only that path is intercepted; every other
request never reaches the Worker and continues to the existing origin. No DNS
record changes and the current site is untouched.

```sh
npm run build
npx wrangler login
npx wrangler deploy --config cloudflare/wrangler.toml
```

Edit the `pattern` and `zone_name` in `cloudflare/wrangler.toml` for a
different domain. The built page is compiled into the Worker as a text module,
so there is no origin to keep running — about 11 KB gzipped, inside the free
tier. Re-run `npm run build` before deploying to pick up source changes.

### GitHub Pages

`.github/workflows/pages.yml` publishes `dist/` on every push, serving the app
at `/<repo>/quran-tracker/`. It checks the build is current and runs the unit
tests before publishing.

Pages has to be turned on once by hand, under **Settings → Pages → Build and
deployment → Source → GitHub Actions**. The workflow token is not allowed to
create the Pages site itself, so until that setting is flipped the deploy step
fails with `Resource not accessible by integration`.

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
