#!/bin/sh
# Copies the video editor into the diinislaam.com repo (fes-reshid/barnoota), where it is
# served at /video-editing/, and stamps every asset link with a release version so browsers
# and the offline cache pick up the new files instead of mixing old and new.
#
#   sh tools/deploy-video-editor.sh [path/to/barnoota/video-editing]
#
# The editor's source is video-editor/ in this repo — edit there, not in the copy.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC="$HERE/video-editor"
DEST=${1:-"$HERE/../barnoota/video-editing"}
V=$(date -u +%Y%m%d%H%M)

FILES="index.html help.html manifest.webmanifest sw.js consent.js timeline.js audio-core.js webm.js editor.js
media-store.js audio-mix.js export-fast.js quran.js captions.js transcribe-worker.js"

rm -rf "$DEST"
mkdir -p "$DEST/icons" "$DEST/vendor"
for f in $FILES; do cp "$SRC/$f" "$DEST/$f"; done
cp "$SRC"/icons/* "$DEST/icons/"
cp "$SRC"/vendor/* "$DEST/vendor/"
# Portable in-place edit (GNU and BSD sed disagree on -i).
perl -pi -e "s/\?v=[0-9a-z]+/?v=$V/g" "$DEST/index.html"
perl -pi -e 's/^<!DOCTYPE html>/<!DOCTYPE html>\n<!-- Built from fes-reshid\/zikr video-editor\/ by tools\/deploy-video-editor.sh — edit the source there. -->/' "$DEST/index.html"
echo "video editor $V -> $DEST"
