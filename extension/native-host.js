#!/Users/primetrce/.nvm/versions/node/v24.13.0/bin/node

/*
 * tabai native messaging host + HTTP bridge server
 *
 * This process:
 *   1. Speaks Chrome's native messaging protocol on stdin/stdout (4-byte LE length prefix + JSON).
 *   2. Runs an HTTP server on port 9999 (configurable via TABAI_PORT env var).
 *   3. Routes HTTP requests from the CLI to the Chrome extension and returns responses.
 *
 * Install:
 *   - Copy (or symlink) this file to /usr/local/bin/tabai-native-host
 *   - chmod +x /usr/local/bin/tabai-native-host
 *   - Register the native messaging host manifest (com.tabai.bridge.json) with Chrome.
 *     On macOS: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tabai.bridge.json
 *     On Linux: ~/.config/google-chrome/NativeMessagingHosts/com.tabai.bridge.json
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const rag = require("./rag");

/* ------------------------------------------------------------------ */
/*  Configuration                                                     */
/* ------------------------------------------------------------------ */

function loadConfig() {
  try {
    const configPath = path.join(__dirname, "..", "config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (_) {
    return {};
  }
}

const config = loadConfig();
const PORT = parseInt(process.env.TABAI_PORT || config.bridgePort || "9999", 10);
const REQUEST_TIMEOUT = 15000; // ms
const OLLAMA_URL = config.ollamaUrl || "http://localhost:11434";
const OLLAMA_MODEL = config.model || "qwen3:4b";
const RAG_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

/* ------------------------------------------------------------------ */
/*  Native messaging protocol helpers                                 */
/* ------------------------------------------------------------------ */

/*
 * Chrome native messaging uses a simple framing protocol:
 *   - 4 bytes: message length as unsigned 32-bit little-endian integer
 *   - N bytes: UTF-8 encoded JSON message
 */

function sendToExtension(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

/*
 * Read messages from stdin. Chrome sends messages in the same 4-byte framed format.
 * We accumulate data in a buffer and parse complete messages as they arrive.
 */

let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInput();
});

function drainInput() {
  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (msgLen === 0 || msgLen > 10 * 1024 * 1024) {
      // Sanity check: discard corrupt frames
      inputBuffer = Buffer.alloc(0);
      return;
    }
    if (inputBuffer.length < 4 + msgLen) {
      return; // Wait for more data
    }
    const jsonBuf = inputBuffer.slice(4, 4 + msgLen);
    inputBuffer = inputBuffer.slice(4 + msgLen);
    let msg;
    try {
      msg = JSON.parse(jsonBuf.toString("utf-8"));
    } catch (e) {
      log("Failed to parse message from extension: " + e.message);
      continue;
    }
    handleExtensionMessage(msg);
  }
}

/* ------------------------------------------------------------------ */
/*  Pending request tracking                                          */
/* ------------------------------------------------------------------ */

// Map of request id -> { resolve, reject, timer }
const pending = new Map();

function requestExtension(action, params) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Extension request timed out after " + REQUEST_TIMEOUT + "ms"));
    }, REQUEST_TIMEOUT);

    pending.set(id, { resolve, reject, timer });
    sendToExtension({ id, action, params: params || {} });
  });
}

function handleExtensionMessage(msg) {
  if (!msg || !msg.id) {
    log("Received message without id: " + JSON.stringify(msg));
    return;
  }

  // Handle fire-and-forget indexing messages from the extension
  if (msg.action === "index_page") {
    const { url, title, text } = msg.params || {};
    if (url && text) {
      rag.indexDocument({ url, title, text });
      log("Indexed page: " + (title || url).slice(0, 60));
    }
    return;
  }

  const entry = pending.get(msg.id);
  if (!entry) {
    log("Received response for unknown request: " + msg.id);
    return;
  }
  clearTimeout(entry.timer);
  pending.delete(msg.id);
  if (msg.error) {
    entry.reject(new Error(msg.error));
  } else {
    entry.resolve(msg.result != null ? msg.result : msg);
  }
}

/* ------------------------------------------------------------------ */
/*  Logging (to stderr so it doesn't corrupt the native messaging     */
/*  protocol on stdout)                                               */
/* ------------------------------------------------------------------ */

function log(...args) {
  process.stderr.write("[tabai-bridge] " + args.join(" ") + "\n");
}

/* ------------------------------------------------------------------ */
/*  HTTP Server                                                       */
/* ------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function summarizeText(text, title) {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: "You are a helpful assistant. Summarize the following web page content concisely in 3-5 sentences." },
        { role: "user", content: `Page title: ${title}\n\nContent:\n${text.slice(0, 8000)}` }
      ],
      options: { temperature: 0.3 }
    })
  });
  const data = await resp.json();
  return data.message?.content || data.response || "Could not generate summary.";
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    // GET /tabs — return current tab index
    if (req.method === "GET" && path === "/tabs") {
      const result = await requestExtension("get_tabs", {});
      sendJSON(res, 200, { ok: true, tabs: result });
      return;
    }

    // GET /tabs/search?q=... — search tabs
    if (req.method === "GET" && path === "/tabs/search") {
      const q = url.searchParams.get("q") || "";
      const result = await requestExtension("search_tabs", { query: q });
      sendJSON(res, 200, { ok: true, tabs: result });
      return;
    }

    // GET /history — return closed-tab history
    if (req.method === "GET" && path === "/history") {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const result = await requestExtension("get_history", { limit });
      sendJSON(res, 200, { ok: true, history: result });
      return;
    }

    // GET /history/search?q=... — search history
    if (req.method === "GET" && path === "/history/search") {
      const q = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const result = await requestExtension("search_history", { query: q, limit });
      sendJSON(res, 200, { ok: true, history: result });
      return;
    }

    // GET /sessions — return session snapshots (add ?full=1 for full tab data)
    if (req.method === "GET" && path === "/sessions") {
      const full = url.searchParams.get("full") === "1";
      const result = await requestExtension("list_sessions", { full });
      sendJSON(res, 200, { ok: true, sessions: result });
      return;
    }

    // GET /bookmarks — return bookmarks
    if (req.method === "GET" && path === "/bookmarks") {
      const q = url.searchParams.get("q") || "";
      if (q) {
        const result = await requestExtension("list_bookmarks", { query: q });
        sendJSON(res, 200, { ok: true, bookmarks: result });
      } else {
        const result = await requestExtension("get_bookmarks", {});
        sendJSON(res, 200, { ok: true, bookmarks: result });
      }
      return;
    }

    // GET /rag/search?q=...&limit=5 — search indexed page content
    if (req.method === "GET" && path === "/rag/search") {
      const q = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "5", 10);
      const results = rag.search(q, limit);
      sendJSON(res, 200, { ok: true, results });
      return;
    }

    // GET /rag/stats — RAG index statistics
    if (req.method === "GET" && path === "/rag/stats") {
      sendJSON(res, 200, { ok: true, ...rag.getStats() });
      return;
    }

    // POST /rag/index — extract and index content from tabs into RAG
    if (req.method === "POST" && path === "/rag/index") {
      const body = await readBody(req);
      const targets = body.targets || body.target || "all";
      try {
        const result = await requestExtension("extract_tabs_content", { targets });
        const indexed = result.indexed || [];
        const failed = result.failed || [];
        let count = 0;
        for (const doc of indexed) {
          rag.indexDocument({ url: doc.url, title: doc.title, text: doc.text });
          count++;
        }
        log("Indexed " + count + " tabs (" + failed.length + " failed)");
        sendJSON(res, 200, { ok: true, indexed: count, failed: failed.length, details: { indexed: indexed.map(d => ({ url: d.url, title: d.title })), failed } });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: e.message });
      }
      return;
    }

    // POST /rag/summarize — extract content from a tab and summarize via Ollama
    if (req.method === "POST" && path === "/rag/summarize") {
      const body = await readBody(req);
      const target = body.target || "current";
      try {
        const content = await requestExtension("extract_content", { target });
        if (!content || !content.text) {
          sendJSON(res, 200, { ok: false, error: "Could not extract page content" });
          return;
        }
        const summary = await summarizeText(content.text, content.title);
        sendJSON(res, 200, { ok: true, summary, title: content.title, url: content.url });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: e.message });
      }
      return;
    }

    // POST /action — execute any action
    if (req.method === "POST" && path === "/action") {
      const body = await readBody(req);
      if (!body.action) {
        sendJSON(res, 400, { ok: false, error: "Missing 'action' field in body" });
        return;
      }
      const result = await requestExtension(body.action, body.params || {});
      sendJSON(res, 200, { ok: true, result });
      return;
    }

    // POST /restore — shortcut for session restore (supports restore_session and restore_last_closed)
    if (req.method === "POST" && path === "/restore") {
      const body = await readBody(req);
      const action = body.action || "restore_session";
      const params = body.params || body;
      const result = await requestExtension(action, params);
      sendJSON(res, 200, { ok: true, result });
      return;
    }

    // GET /ping — health check
    if (req.method === "GET" && path === "/ping") {
      try {
        const result = await requestExtension("ping", {});
        sendJSON(res, 200, { ok: true, ...result });
      } catch (e) {
        sendJSON(res, 200, { ok: false, error: "Extension not connected: " + e.message });
      }
      return;
    }

    // GET / — basic info
    if (req.method === "GET" && path === "/") {
      sendJSON(res, 200, {
        service: "tabai-bridge",
        version: "1.0.0",
        endpoints: [
          "GET  /tabs",
          "GET  /tabs/search?q=...",
          "GET  /history",
          "GET  /history/search?q=...",
          "GET  /sessions",
          "GET  /bookmarks",
          "POST /action",
          "POST /restore",
          "GET  /ping",
          "GET  /rag/search?q=...",
          "GET  /rag/stats",
          "POST /rag/summarize"
        ]
      });
      return;
    }

    // 404
    sendJSON(res, 404, { ok: false, error: "Not found: " + path });

  } catch (e) {
    log("Request error:", e.message);
    sendJSON(res, 500, { ok: false, error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/*  Startup                                                           */
/* ------------------------------------------------------------------ */

// Load RAG index and start periodic cleanup
rag.load();
rag.cleanup(RAG_MAX_AGE_MS);
setInterval(() => {
  const removed = rag.cleanup(RAG_MAX_AGE_MS);
  if (removed > 0) log("RAG cleanup: removed " + removed + " expired documents");
}, 6 * 60 * 60 * 1000); // every 6 hours

// Ensure stdin stays open for native messaging
process.stdin.resume();
process.stdin.on("end", () => {
  log("stdin closed (Chrome disconnected). Shutting down.");
  server.close();
  process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
  log("HTTP bridge listening on http://127.0.0.1:" + PORT);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log("Port " + PORT + " is already in use. Is another bridge running?");
    process.exit(1);
  }
  log("Server error:", err.message);
});

// Graceful shutdown
process.on("SIGINT",  () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
