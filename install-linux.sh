#!/usr/bin/env bash
#
# tabai — Linux installer
#
# Registers the native messaging host with every Chromium-family browser found
# on this machine, generates the host manifest with the correct absolute paths,
# makes native-host.js executable, and (optionally) links the `tabai` CLI.
#
# Unlike macOS, Chrome on Linux can exec a shebang script directly, so no
# compiled wrapper (native-host-wrapper.c) is needed here — we point the
# manifest straight at native-host.js.
#
# Usage:
#   ./install-linux.sh [EXTENSION_ID]
#   ./install-linux.sh --ext-id <id> [--no-link]
#
# If you don't pass the extension ID, the script will prompt for it. Load the
# unpacked extension at chrome://extensions first to get the ID.

set -euo pipefail

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$SCRIPT_DIR/extension"
CLI_DIR="$SCRIPT_DIR/cli"
NATIVE_HOST="$EXTENSION_DIR/native-host.js"
HOST_NAME="com.tabai.bridge"

EXT_ID=""
DO_LINK=1

# ── Parse args ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --ext-id) EXT_ID="${2:-}"; shift 2 ;;
    --no-link) DO_LINK=0; shift ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) EXT_ID="$1"; shift ;;
  esac
done

# ── Sanity checks ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "error: node not found on PATH. Install Node.js v18+." >&2; exit 1; }
[ -f "$NATIVE_HOST" ] || { echo "error: native host not found at $NATIVE_HOST" >&2; exit 1; }

# ── Extension ID ──────────────────────────────────────────────────────────────
if [ -z "$EXT_ID" ]; then
  echo "Load the unpacked extension at chrome://extensions, then copy its ID."
  printf "Extension ID: "
  read -r EXT_ID
fi
EXT_ID="$(echo "$EXT_ID" | tr -d '[:space:]/')"
if ! echo "$EXT_ID" | grep -Eq '^[a-p]{32}$'; then
  echo "warning: '$EXT_ID' doesn't look like a normal 32-char Chrome extension ID — continuing anyway." >&2
fi

# ── Make the native host executable ───────────────────────────────────────────
chmod +x "$NATIVE_HOST"
echo "✓ chmod +x $NATIVE_HOST"

# ── Browser native-messaging-host directories on Linux ────────────────────────
# Each Chromium-family browser reads per-user hosts from its own config dir.
CANDIDATES=(
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/google-chrome-beta/NativeMessagingHosts"
  "$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
  "$HOME/.config/chromium/NativeMessagingHosts"
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  "$HOME/.config/vivaldi/NativeMessagingHosts"
)

# Build the manifest once.
MANIFEST_JSON=$(cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "Native messaging host for tabai CLI bridge",
  "path": "$NATIVE_HOST",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
JSON
)

installed=0
for dir in "${CANDIDATES[@]}"; do
  parent="$(dirname "$dir")"            # the browser's config dir (e.g. ~/.config/chromium)
  if [ -d "$parent" ]; then
    mkdir -p "$dir"
    printf '%s\n' "$MANIFEST_JSON" > "$dir/$HOST_NAME.json"
    echo "✓ registered host → $dir/$HOST_NAME.json"
    installed=$((installed + 1))
  fi
done

if [ "$installed" -eq 0 ]; then
  echo "warning: no Chromium-family browser config dir found under ~/.config." >&2
  echo "         Launch your browser once, then re-run this script." >&2
  # Fall back to plain Chrome location so the user has something to point at.
  fallback="$HOME/.config/google-chrome/NativeMessagingHosts"
  mkdir -p "$fallback"
  printf '%s\n' "$MANIFEST_JSON" > "$fallback/$HOST_NAME.json"
  echo "✓ wrote default manifest → $fallback/$HOST_NAME.json"
fi

# ── Link the CLI ──────────────────────────────────────────────────────────────
if [ "$DO_LINK" -eq 1 ]; then
  if [ -d "$CLI_DIR" ]; then
    echo "Linking tabai CLI (npm install && npm link in $CLI_DIR)…"
    ( cd "$CLI_DIR" && npm install --silent && npm link ) \
      && echo "✓ tabai CLI linked" \
      || echo "warning: npm link failed — run it manually from $CLI_DIR" >&2
  fi
else
  echo "Skipping npm link (--no-link)."
fi

cat <<DONE

Done. Next steps:
  1. Reload the extension at chrome://extensions (click the refresh icon).
  2. Make sure Ollama is running:   ollama serve
     (or start your vLLM server and run with: tabai --provider vllm ...)
  3. Try it:   tabai "what tabs do I have open?"
DONE
