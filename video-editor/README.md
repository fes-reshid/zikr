# Reel: a video editor in the browser

Reel is a multitrack video editor that runs entirely in the browser. You import
video, audio and images, arrange them on a timeline, add titles, and export a
video file. **Nothing is uploaded.** Files are opened in place, the preview is
drawn on a canvas, and the export is recorded on your own machine.

It is four static files with no dependencies and no build step:

```sh
npm run serve:video-editor   # http://localhost:8001/
```

Opening `video-editor/index.html` straight off disk works as well.

## What it does

| | |
| --- | --- |
| **Import** | Video, audio and images from the Import button, or dropped anywhere on the page. Drop them onto a track to place them at that point. |
| **Timeline** | Title, overlay, video and audio tracks. You can add more video and audio tracks and remove empty ones. Tracks can be hidden or muted. |
| **Editing** | Move clips, including onto another track of the same kind. Trim either edge, split at the playhead, duplicate, delete, or delete and close the gap. Clips snap to edges and to the playhead. |
| **Layers** | Upper video tracks draw over lower ones. Scale and position give picture-in-picture, with one-click Full, Corner and Lower-third presets. |
| **Look** | Per-clip brightness, contrast, saturation, greyscale, blur and opacity, plus fade in and fade out. |
| **Titles** | Multi-line text with a choice of font, size, colour, alignment, bold/italic, shadow and an optional background box. Text wraps to the frame. |
| **Sound** | Per-clip volume from 0 to 200% and mute. Audio fades follow the clip's fades. Audio clips show a waveform. |
| **Frame** | 16:9 (720p or 1080p), 9:16 vertical, 1:1 and 4:5 frame sizes, at 24, 25, 30 or 60 fps. |
| **Export** | MP4 (H.264) where the browser can record it, otherwise WebM (VP9/VP8), at three quality levels. A single frame can also be saved as a PNG. |
| **Projects** | Undo/redo for every edit. The project autosaves in the browser and can be saved to or opened from a `.reel.json` file. |

### Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| S | Split at the playhead (the selected clip, or everything under it) |
| Delete / Backspace | Delete the selected clip; add Shift to close the gap |
| Ctrl/⌘ + D | Duplicate |
| T | Add a title at the playhead |
| ← / → | Step one frame; with Shift, one second; with Alt, nudge the selected clip one frame |
| Home / End | Jump to the start / end |
| Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z | Undo, redo |
| + / −, Ctrl + wheel | Zoom the timeline |

## How it works

| File | What it is |
| --- | --- |
| `timeline.js` | The project model: pure functions, no DOM, unit tested in Node |
| `editor.js` | UI, preview engine, media handling and export |
| `webm.js` | Adds the duration to recorded WebM files |
| `index.html` | Layout and styles |

**The timeline is data.** Every edit goes through `timeline.js`. Each operation
(move, trim, split, delete and so on) takes a project and returns a new one
without touching the old one. Undo keeps whole-project snapshots, which is
cheap because media is referenced, never embedded, and much harder to get wrong
than inverse operations. Clips never overlap on a track: a clip dropped onto
another slides to the nearest gap that fits.

**Preview.** Every media clip gets its own `<video>` or `<audio>` element. Each
frame, a clock sets where the timeline should be. Elements for clips under the
playhead are started, seeked if they drift more than 0.3 s, and paused once the
playhead leaves them. Clips starting within the next 1.5 s are seeked to their
in-point early, so cuts land cleanly. If a clip that should be playing is still
loading or seeking, the clock waits for it rather than running ahead, for up to
4 s. The visible layers are drawn onto a canvas with the clip's colour filter,
opacity and fade applied.

**Audio.** Each element feeds its own gain node, then a master bus, which goes
both to the speakers and to a `MediaStreamDestination`. Volume, fades and mutes
are gain changes.

**Export.** The canvas is recorded with `captureStream()` together with the
master audio stream, using `MediaRecorder`, while the project plays through once
in real time. If the clock waits on a stalled clip, the recorder is paused as
well, so the file has no frozen frames. MediaRecorder writes WebM as a stream,
without a duration, which leaves many players unable to seek. `webm.js` adds the
Duration element to the file afterwards.

**Saving.** Browsers cannot re-open a file on their own, so a saved or
autosaved project keeps each media item's name, size and type rather than its
contents. When a project is restored its media shows as offline. Importing the
same files again relinks them by name and size, without creating duplicates or
an undo step. Each item also has a Relink button for a file that was renamed.

## Tests

```sh
npm test                    # includes timeline.js and webm.js unit tests
npm run test:video-editor   # end to end in Chromium
```

The end-to-end test makes its own media. It records a two-second WebM in the
page with MediaRecorder, so the file has the `Infinity` duration real
recordings have. It also generates a PNG and a WAV tone. It then drives the
real UI:

- import, double-click, the + button, and dragging from the bin onto a track
- pixel checks that layers stack correctly and that seeking shows the right frame
- split, undo, redo, trimming by an edge, moving by drag, an inspector edit
- titles, deletion, playback, and saving the project
- reload, restore and relink
- a full export, whose file is checked for its container, duration, frame size and playable length

Set `CHROMIUM_PATH` to use a particular Chromium.

## Limits

- **Export runs in real time** and needs the tab in front. Browsers throttle
  background tabs, and the recording would stall.
- **What imports depends on the browser.** A file only imports if the browser
  can decode it. Most can play H.264 MP4, WebM, MP3, WAV and AAC. HEVC and
  ProRes depend on the platform.
- **The output format depends on the browser.** Chrome, Edge and Safari can
  record MP4. Firefox records WebM.
- **Waveforms are skipped for audio files over 200 MB**, to avoid decoding
  that much into memory.
- There is no speed change, no transitions between clips beyond fades, and no
  keyframed animation.
