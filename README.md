# tabai

tabai is a CLI tool that lets you control Google Chrome from your terminal using plain English. It connects a local Ollama language model to your browser via a Chrome extension and native messaging bridge, so you can close tabs, organize bookmarks, restore sessions, and more — all without touching the mouse.

## Quick Start

```sh
# 1. Install CLI
cd /Users/(username)/Documents/browser_assistant/tabai/cli
npm install
npm link

# 2. Pull the Ollama model
ollama pull qwen3.5:4b

# 3. Load the Chrome extension
#    Open chrome://extensions
#    Enable "Developer mode" (top-right toggle)
#    Click "Load unpacked" → select /Users/(username)/Documents/browser_assistant/tabai/extension
#    Copy the Extension ID Chrome assigns

# 4. Register native messaging host (macOS)
chmod +x /Users/(username)/Documents/browser_assistant/tabai/extension/native-host.js
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cp /Users/(username)/Documents/browser_assistant/tabai/extension/com.tabai.bridge.json \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/

# 5. Edit the copied manifest to set your actual values
#    File: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tabai.bridge.json
#    Set "path" to: "/Users/(username)/Documents/browser_assistant/tabai/extension/native-host.js"
#    Set "allowed_origins" to: ["chrome-extension://YOUR_EXTENSION_ID/"]

# 6. Reload the extension at chrome://extensions (click refresh icon)

# 7. Add alias (optional)
echo 'alias t="tabai"' >> ~/.zshrc && source ~/.zshrc

# 8. Run it
tabai "what tabs do I have open?"
t "close all youtube tabs"
t "group tabs by domain"
```

## Prerequisites

- **Node.js** v18 or later
- **Google Chrome** (or Chromium-based browser)
- **Ollama** installed and running locally (https://ollama.com)

## Setup

### 1. Clone or download tabai

```sh
cd /path/to/browser_assistant
```

### 2. Install CLI dependencies

```sh
cd tabai/cli
npm install
npm link
```

This makes the `tabai` command available globally.

### 3. Load the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `tabai/extension` directory
5. Note the **Extension ID** that Chrome assigns (a long string like `abcdefghijklmnopqrstuvwxyz`)

### 4. Set up native messaging

The bridge server needs to be registered as a Chrome native messaging host.

**macOS:**

```sh
# Make the native host executable
chmod +x /path/to/browser_assistant/tabai/extension/native-host.js

# Create the manifest directory if it doesn't exist
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

# Copy the manifest
cp /path/to/browser_assistant/tabai/extension/com.tabai.bridge.json \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/

# Edit the manifest to set the correct path
# Open the file and update two fields:
#   "path": "/path/to/browser_assistant/tabai/extension/native-host.js"
#   "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
```

**Linux:**

```sh
chmod +x /path/to/browser_assistant/tabai/extension/native-host.js

mkdir -p ~/.config/google-chrome/NativeMessagingHosts

cp /path/to/browser_assistant/tabai/extension/com.tabai.bridge.json \
   ~/.config/google-chrome/NativeMessagingHosts/

# Edit the manifest: update "path" and "allowed_origins" as above
```

Replace `/path/to/browser_assistant` with your actual path, and `YOUR_EXTENSION_ID` with the ID from step 3.

### 5. Pull the Ollama model

```sh
ollama pull qwen3.5:4b
```

Ensure Ollama is running (it starts automatically on macOS; on Linux run `ollama serve`).

### 6. Add a shell alias (optional but recommended)

Add this to your `~/.zshrc` or `~/.bashrc`:

```sh
alias t="tabai"
```

Then reload:

```sh
source ~/.zshrc
```

### 7. Create an icon (optional)

The extension expects a `tabai/extension/icon.png` file (128x128 pixels). This is purely cosmetic for the extensions page. You can use any PNG or skip it — the extension works without it.

## Usage

```sh
tabai "close all youtube tabs"
```

Or with the alias:

```sh
t "close all youtube tabs"
```

## Example Commands

### Closing tabs

```sh
t "close all tabs"
t "close the twitter tab"
t "close all tabs except the one I'm looking at"
t "close duplicate tabs"
t "close tabs I haven't used in a while"
```

### Opening tabs

```sh
t "open github.com"
t "open hacker news and reddit"
t "open my usual morning sites: gmail, calendar, github"
```

### Searching tabs

```sh
t "find my jira tab"
t "which tab has the deployment docs"
t "do I have any stackoverflow tabs open"
```

### Organizing tabs

```sh
t "group tabs by domain"
t "group all the google docs tabs together"
t "pin the gmail tab"
t "unpin all tabs"
t "mute the youtube tab"
```

### Bookmarks

```sh
t "bookmark all open tabs"
t "bookmark this tab"
t "find my bookmarks about kubernetes"
t "list all bookmarks"
```

### History and sessions

```sh
t "restore the last tab I closed"
t "reopen the last 3 tabs I closed"
t "save this session"
t "show my saved sessions"
t "restore yesterday's session"
t "what tabs did I close recently"
```

### General

```sh
t "how many tabs do I have open"
t "show me all my tabs"
t "reload all tabs"
t "duplicate this tab"
```

## Configuration

Settings live in `tabai/config.json`:

```json
{
  "ollamaUrl": "http://localhost:11434",
  "model": "qwen3.5:4b",
  "think": false,
  "bridgePort": 9999,
  "confirmDestructive": true
}
```

### Overrides

Use a different model:

```sh
tabai --model llama3:8b "close all reddit tabs"
```

Skip confirmation for destructive actions:

```sh
tabai -y "close all tabs"
tabai --no-confirm "close all tabs"
```

Use a different Ollama server:

```sh
tabai --ollama-url http://192.168.1.50:11434 "group tabs by domain"
```

Change the bridge port (set both for bridge and CLI):

```sh
TABAI_PORT=8888 tabai "list tabs"
```

Or change `bridgePort` in `config.json` (the CLI also reads this).

## Architecture

```
Terminal                 Bridge Server              Chrome Extension
  |                         |                            |
  |  tabai "close yt tabs"  |                            |
  |  ----HTTP POST /action->|                            |
  |                         |---native messaging msg---->|
  |                         |                            | chrome.tabs.remove(...)
  |                         |<--native messaging resp----|
  |  <---HTTP JSON response-|                            |
  |                         |                            |
```

1. The CLI sends your natural language command to Ollama, which returns a structured action.
2. The CLI sends the action to the bridge server on `localhost:9999` via HTTP.
3. The bridge server forwards the action to the Chrome extension via native messaging.
4. The extension executes the action using Chrome APIs and returns the result.
5. The result flows back to the CLI and is displayed in the terminal.

## Troubleshooting

### "Extension not connected" error

- Make sure the Chrome extension is loaded and enabled at `chrome://extensions`
- Verify the native messaging host manifest is in the correct directory:
  - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tabai.bridge.json`
  - Linux: `~/.config/google-chrome/NativeMessagingHosts/com.tabai.bridge.json`
- Check that the `path` in the manifest points to the actual location of `native-host.js`
- Check that the `allowed_origins` contains your extension's ID
- Reload the extension at `chrome://extensions` (click the refresh icon)

### "Port 9999 already in use"

Another instance of the bridge server is running. Kill it:

```sh
lsof -ti:9999 | xargs kill
```

Or change the port in `config.json` and set `TABAI_PORT` accordingly.

### "Ollama connection refused"

- Make sure Ollama is running: `ollama serve`
- Verify the model is pulled: `ollama list`
- Pull it if missing: `ollama pull qwen3.5:4b`
- Check that `ollamaUrl` in `config.json` matches your Ollama server address

### "command not found: tabai"

Run `npm link` again from the `tabai/cli` directory:

```sh
cd tabai/cli && npm link
```

### Chrome closes the native messaging connection immediately

- Run `native-host.js` manually to check for startup errors:
  ```sh
  # The native messaging protocol requires a 4-byte length prefix, so a simple echo won't work.
  # Instead, just run it to verify it starts without crashing:
  node tabai/extension/native-host.js 2>&1 &
  # Then test the HTTP bridge:
  curl http://127.0.0.1:9999/ping
  # Kill it when done:
  kill %1
  ```
- Check Chrome's extension service worker logs: go to `chrome://extensions`, find tabai bridge, and click "Inspect views: service worker"

### Tabs not tracked after Chrome restart

The extension rebuilds its tab index on startup. If tabs appear missing, reload the extension at `chrome://extensions`.

### Actions seem slow

- Use a smaller Ollama model for faster inference (e.g., `qwen3.5:1b`)
- Ensure Ollama is using GPU acceleration: check `ollama ps`
- The native messaging roundtrip adds minimal latency; slowness is almost always model inference time
