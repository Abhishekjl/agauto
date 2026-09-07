#!/usr/bin/env bash
# Run AgAuto with one command.
#   - Builds the extension once (only if extension/dist is missing).
#   - Starts the single-file Python backend + test-form server.
# The backend needs NO npm; npm is only used the first time to build the UI.
set -e
cd "$(dirname "$0")"

if [ ! -f extension/dist/manifest.json ]; then
  echo "→ extension/dist not found — building the extension once…"
  if ! command -v npm >/dev/null 2>&1; then
    echo "   npm not found. Install Node.js once to build the extension, or obtain a prebuilt extension/dist." >&2
    exit 1
  fi
  npm install
  npm run build:extension
  echo "→ extension built."
fi

echo ""
echo "AgAuto is starting."
echo "  1. In Chrome: chrome://extensions → Developer mode → Load unpacked → select:"
echo "       $(pwd)/extension/dist"
echo "  2. Test form:  http://127.0.0.1:8787/form/advanced.html"
echo ""
exec python3 app.py
