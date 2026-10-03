# Reel: a video editor in the browser

Reel is a multitrack video editor that runs entirely in the browser. It is
published on diinislaam.com at
[/video-editing/](https://diinislaam.com/video-editing/).

You import video, audio and images, arrange them on a timeline, add titles
in Arabic or English, make Qur'ān verse videos with recitation, caption
speech, and export an MP4 or WebM. **Nothing is uploaded.** Files are opened
in place, the preview is drawn on a canvas, and the export is made on your
own machine.

It is static files with no build step:

```sh
npm run serve:video-editor   # http://localhost:8001/
```

Opening `video-editor/index.html` straight off disk works for editing and
real-time export. Fast export, offline use and the Qur'ān tool need HTTP.

## What it does

| | |
| --- | --- |
| **Import** | Video, audio and images from the Import button, or dropped on the page or onto a track. |
| **Timeline** | Titles, overlay, video and audio tracks, and you can add more. Tracks can be hidden, muted, ducked, or removed when empty. |
| **Editing** | Move clips (singly or as a group), trim, split, duplicate, delete, or delete and close the gap. Copy and paste works at the playhead. Clips snap to edges, markers and the playhead. Undo and redo cover every edit. |
| **Speed & freeze** | Speed from ¼× to 4×, with voices keeping their pitch in both preview and export. A freeze frame holds any frame for as long as you like. |
| **Transitions** | Crossfade, dip to black, slide, push, wipe and zoom between touching clips, one cut at a time or on every cut at once. The sound crossfades too. |
| **Layers & look** | Upper tracks draw over lower ones. Scale and position give picture-in-picture, with presets. Also: slow pan-and-zoom (Ken Burns), a blurred-copy fill for vertical frames, colour controls (including sepia and hue), opacity and fades. |
| **Effects** | One-click looks (Warm, Cool, Golden hour, Vintage, Black & white, Vivid, Faded, Dramatic, Night) with tint, vignette and grain; mirror, flip, rotate and crop; rounded corners, border and drop shadow; hide an area by blur, pixelate or a solid cover; colour and gradient cards. Clips with effects show an fx badge. |
| **Titles** | Multi-line titles in Latin or Arabic fonts (Amiri, Scheherazade New, Noto Naskh Arabic, Reem Kufi, Cairo, plus the site's Cormorant and Marcellus). Arabic is laid out right to left. Entrance animations: fade, rise, pop, slide, typewriter and word by word. Ready-made title styles and a coloured outline. |
| **Writing hand** | A drawn hand can write a title with a pen or pencil (the Handwriting entrance), or type it with a tapping finger. It follows the text as it appears, right to left for Arabic, then moves away. The default **Realistic** style uses a transparent photographic hand asset and traces the shaped letter strokes. Set **Hand size** to 20–400%, or use Small / Reset size / Large. **Write time** controls the reveal speed. The additional illustrated styles are: **Emoji** (the default), a rounded, softly shaded hand like ✍️, and **Sketch**, an outlined drawing. The skin can be emoji yellow, four skin colours or line art. The illustrated styles retain their skin and pen-colour choices. The pen can match the ink or have its own colour. The realistic asset is bundled in `assets/hand-real.webp`, generated for this editor, loaded locally and cached offline. |
| **Drawing** | A drawing board over the preview (D): pen, highlighter, line, arrow, box, circle, eraser, colours, thicknesses and undo. A drawing is a clip on a titles track. It is drawn on stroke by stroke at an even speed, by a hand holding a pencil or a pen, like a whiteboard animation. It can be moved, sized, faded in and edited later. |
| **Qur'ān verse videos** | Pick a surah, ayat, reciter and translation. The editor adds each ayah's recitation, the Arabic and translation timed ayah by ayah, a title card, the Bismillah and a background, as one undo step. |
| **Sound** | Per-clip volume up to 200%, fades, mute and detached audio. **Ducking** lowers a background-sound track (a nasheed, say) whenever anything else is speaking. **Clean up voice** is AI noise removal. **Normalise loudness** brings a clip's peak to about −1 dB. Audio clips show waveforms. |
| **Captions** | Speech to text with Whisper on the device. It also imports .srt/.vtt files and saves any titles track as subtitles. |
| **Markers** | Drop them with M, drag them, rename them, and copy them as YouTube chapters. |
| **Audio editor** | "Edit in audio editor" opens a clip's sound in the site's `/audio-editor/`, and its "Send to Video Editor" brings audio back. |
| **Export** | **Fast** export decodes and encodes frame by frame with WebCodecs. It is frame-exact, faster than real time, and works in a background tab. **Real-time** export (MediaRecorder) is the fallback. A single frame can also be saved as PNG. |
| **Projects** | Autosaved in the browser **with the media files**, so the project reopens as you left it. Save and open `.reel.json` files. Once opened, the editor works offline. |
| **Purpose reminder** | On the first visit, the same halal-use reminder as the audio editor. The editor opens only after **I Agree & Continue**, which stays disabled until the box is ticked. The answer is remembered per browser (`consent.js`). |
| **Phones** | One-finger pan, tap to seek, pinch to zoom, bigger handles, and a compact layout. A one-time notice suggests a computer for long projects, as in the audio editor. |
| **Help ▸ About** | A pop-up like the audio editor's: name, author, version, privacy note, contact and credits. |

Keyboard shortcuts and a user guide are in [help.html](help.html).

## Files

| File | What it is |
| --- | --- |
| `timeline.js` | The project model: pure functions, no DOM, unit tested |
| `audio-core.js` | Pure audio helpers: pitch-preserving time-stretch (WSOLA), peaks, resampling, WAV, unit tested |
| `webm.js` | Adds the duration to real-time WebM exports, unit tested |
| `editor.js` | UI, preview engine, real-time export, and the `ReelApp` interface the modules use |
| `media-store.js` | Keeps imported files in IndexedDB, and the hand-over store shared with the audio editor |
| `audio-mix.js` | Renders the project's sound offline, and Clean up voice (RNNoise) |
| `export-fast.js` | Frame-exact export with mediabunny and WebCodecs |
| `quran.js` | The Qur'ān verse video tool (Quran.com API) |
| `captions.js` | Auto captions (Whisper) and subtitle import/export |
| `transcribe-worker.js` | The Whisper worker, shared with the audio editor |
| `vendor/mediabunny.min.mjs` | [mediabunny](https://mediabunny.dev) 1.61 (MPL-2.0, licence alongside), loaded only when exporting |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline use and installing as an app |
| `help.html` | The user guide |

## How it works

**The timeline is data.** Every edit goes through `timeline.js`, whose
operations take a project and return a new one without touching the old
one. Undo keeps whole-project snapshots. This is cheap because media is
referenced, never embedded, and much harder to get wrong than inverse
operations. Clips never overlap on a track: a clip dropped onto another
slides to the nearest gap.

**One model, two renderers.** The preview and the fast exporter both draw
through `drawFrame(t)`, using the model's `renderLayers` (which clips are
visible, in which order, with transitions and fades), `motionAt` (pan and
zoom) and `textAnimAt` (title entrances). They differ only in where source
frames come from: media elements in the preview, decoded frames in the
export. Sound works the same way: the preview's gain nodes and the offline
mix both use the model's `clipGainAt`, and a test checks that it agrees with
`audibleClips` everywhere.

**Preview.** Every media clip gets its own `<video>` or `<audio>` element
running at the clip's speed. A clock sets where the timeline should be.
Elements for clips under the playhead, or inside a transition, are started,
corrected if they drift, and paused when not needed. Freeze frames and clips
waiting at the edge of a transition are held. Upcoming clips are seeked
early, so cuts land cleanly. If a clip is still loading, the clock waits for
it instead of running ahead.

**Fast export.** For every output frame the exporter knows which source frame
each visible clip needs. It gives each clip a mediabunny `CanvasSink` walking
forward through exactly those timestamps (`canvasesAtTimestamps`, which
decodes each packet at most once), composites the frame, and encodes it with
WebCodecs through mediabunny's `CanvasSource` into MP4 (H.264, AAC or Opus)
or WebM (VP9 or VP8, Opus). The sound is mixed offline first: each clip's
source is decoded (only the part it uses), time-stretched to its speed
without changing pitch, and scheduled with the model's gain curve. Nothing
waits on a clock. In the end-to-end test, 5.3 s of 720p video exports in
about 1.2–1.7 s.

**Ducking.** Waveform peaks, which are also used for drawing, give each
clip's loudness. The model turns them into a gain envelope for ducked tracks:
a quick drop while anything else is audible, a slower recovery, and short
pauses between words bridged, so the background doesn't pump.

**Qur'ān videos.** Text and translation come from the Quran.com API (the same
one the site's reader uses), and translations are matched by name, never by a
hard-coded id. Each ayah's recitation is its own file, so its Arabic and
translation clips are exactly as long as its recitation, with no guessing
where an ayah ends. Long ayat are split into pages timed by length. If the
recitation can't be downloaded from Quran.com, the well-known reciters are
fetched from EveryAyah instead. Failing that, you can spread the verses over
a recitation file of your own, or make captions alone.

**Saving.** The project autosaves to `localStorage`, and imported files are
kept in IndexedDB, so a reload or a return visit reopens everything. Files
the browser refuses to keep for lack of space show as offline, and
importing them again relinks them by name and size. `.reel.json` project
files never contain media.

## Tests

```sh
npm test                    # includes the timeline, audio and WebM unit tests
npm run test:video-editor   # end to end in Chromium
```

The end-to-end test serves the editor at `/video-editing/` beside a stand-in
`/audio-editor/`, as on the site, and stubs Quran.com. It makes its own
media:
- a two-second WebM recorded in the page with MediaRecorder, so it has the
  `Infinity` duration real recordings have;
- a PNG;
- a WAV.

Its 68 checks drive the real UI. Pixel checks confirm layering, seeking,
transitions, freeze frames, pan-and-zoom, blurred fill and animated titles.
It exports with both exporters and checks each file's size, length and
sound. It also covers:
- reopening with stored media;
- the audio-editor hand-over both ways;
- voice clean-up;
- a Qur'ān verse video;
- captions and subtitles;
- opening offline.

Set `CHROMIUM_PATH` to use a particular Chromium.

## Deploying

```sh
npm run deploy:video-editor   # copies to ../barnoota/video-editing/
```

The script stamps every asset link with a release version, so browsers and
the offline cache never mix old and new files. Commit the result in the site
repo. The copy there is generated: edit the source here.

## Limits

- **Browser support varies.** Fast export needs WebCodecs (recent Chrome,
  Edge and Safari; Firefox from version 130). H.264 MP4 depends on the
  platform's encoder. Elsewhere the real-time exporter is used, and it needs
  the tab in front.
- **Importing depends on the browser too.** A file imports only if the
  browser can decode it. HEVC and ProRes depend on the platform.
- **Downloads happen once.** The first use of auto captions downloads a
  40–250 MB speech model, and Clean up voice a 5 MB noise remover. Both are
  cached after that. Whisper does not support Afaan Oromoo yet.
- **The Qur'ān tool needs a connection** to Quran.com (and EveryAyah as a
  fallback).
- **Storage is limited by the browser.** A browser short of space may refuse
  to keep very large files.
- **Not supported:** reverse playback, keyframed paths beyond the pan-and-zoom
  presets, and chroma key.

## Creative studio

`studio.js` adds six editable templates, ten transition previews and original English/Arabic nasheed lyrics. Lyrics support word highlighting, handwriting, optional local vocal audio and evenly distributed timing. Templates append to existing projects and are undoable. `handwriting.js` traces the centre of shaped glyphs for the realistic pen, including Arabic. The generated realistic hand asset is an AI-created photographic cutout, not footage of an actual person.

`creator-tools.js` provides microphone recording (five minutes per take), local Whisper word alignment with a 60% overall and 50% per-line match threshold, and personal templates in a separate IndexedDB database (including media, up to 150 MB each). They survive project resets but not clearing browser site data. Tests: `node video-editor/test/creator-tools.test.js`.

## Creative effects

`creative-effects.js` adds ten canvas stickers, four social resize presets, chroma-key removal and on-device MediaPipe person segmentation (tasks-vision 0.10.14; selfie_segmenter float16 v1). Person segmentation runs synchronously on each frame and can reduce playback/export speed, especially on phones. Cutouts are processed at up to 1280 px. The shared renderer applies effects to preview and export. Ramadan, Eid, class and lesson templates add editable titles and sticker decorations. Run `node video-editor/test/creative-effects.test.js`.
