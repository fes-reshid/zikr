#!/bin/sh
# Copies the video editor into NoorEditor (fes-reshid/nooreditor), where it is served at
# https://nooreditor.web.app/video-editing/, and stamps every asset link with a release version
# so browsers and the offline cache pick up the new files instead of mixing old and new.
# With the default destination it also brands the copy for NoorEditor (watermark, Pro, settings).
# Then commit and push in the nooreditor repo: it publishes itself.
# (diinislaam.com/video-editing/ only redirects to NoorEditor now — do not deploy there.)
#
#   sh tools/deploy-video-editor.sh [path/to/nooreditor/public/video-editing]
#
# The editor's source is video-editor/ in this repo — edit there, not in the copy.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC="$HERE/video-editor"
DEST=${1:-"$HERE/../nooreditor/public/video-editing"}
V=$(date -u +%Y%m%d%H%M)

FILES="index.html help.html manifest.webmanifest sw.js consent.js timeline.js hands.js handwriting.js studio.js workspace-layout.js workspace-resize.js brand.js short.js sounds.js record.js library.js pauses.js occasions.js ramadan.js reframe.js speak.js mobile.js hadith.js art-gallery.js preview-edit.js creator-tools.js creative-effects.js audio-core.js webm.js editor.js
media-store.js audio-mix.js export-fast.js quran.js captions.js transcribe-worker.js speak-worker.js"

rm -rf "$DEST"
mkdir -p "$DEST/icons" "$DEST/vendor" "$DEST/assets"
for f in $FILES; do cp "$SRC/$f" "$DEST/$f"; done
cp "$SRC"/icons/* "$DEST/icons/"
cp "$SRC"/vendor/* "$DEST/vendor/"
cp "$SRC"/assets/* "$DEST/assets/"
mkdir -p "$DEST/help-img"
cp "$SRC"/help-img/* "$DEST/help-img/"
# Portable in-place edit (GNU and BSD sed disagree on -i).
perl -pi -e "s/\?v=[0-9a-z]+/?v=$V/g" "$DEST/index.html"
perl -pi -e 's/^<!DOCTYPE html>/<!DOCTYPE html>\n<!-- Built from fes-reshid\/zikr video-editor\/ by tools\/deploy-video-editor.sh — edit the source there. -->/' "$DEST/index.html"
echo "video editor $V -> $DEST"
BRAND="$HERE/../nooreditor/tools/brand-editors.js"
if [ -z "$1" ] && [ -f "$BRAND" ]; then node "$BRAND" "$HERE/../nooreditor/public"; fi
