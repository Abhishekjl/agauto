#!/usr/bin/env bash
# Build the extension and produce a distributable zip.
#   - agauto-extension.zip : the built extension (load unpacked, or upload to the Web Store)
# Run this whenever you change extension source. To just RUN the app, use ./run.sh.
set -e
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the extension. Install Node.js." >&2
  exit 1
fi

echo "→ installing deps…"
npm install --silent

echo "→ building extension…"
npm run build:extension

echo "→ zipping extension/dist → agauto-extension.zip…"
rm -f agauto-extension.zip
( cd extension/dist && zip -r -X -q ../../agauto-extension.zip . )

echo ""
echo "Done:"
echo "  agauto-extension.zip   → Chrome Web Store upload, or unzip + Load unpacked"
echo "  app.py                 → the backend (run with: python3 app.py)"
echo ""
echo "Distribute both. The recipient runs 'python3 app.py' and loads the unzipped"
echo "extension folder in Chrome — no npm needed on their side."
