/**
 * Execute an action object by dispatching to the Chrome bridge.
 *
 * @param {object} action - Parsed action object from the model
 * @param {object} config - Merged config with bridgeUrl
 * @returns {Promise<object>} Result from the bridge (or locally constructed)
 */
export async function executeAction(action, config) {
  const base = config.bridgeUrl;

  switch (action.action) {
    // ── Actions that POST to /action ──────────────────────────────────────
    // The bridge's /action endpoint expects { action: "...", params: {...} }
    // so we extract the action name and pass the rest as params.
    case 'close_tabs':
    case 'close_all_except':
    case 'open_url':
    case 'open_urls':
    case 'open_new_tabs':
    case 'bookmark_tabs':
    case 'group_tabs':
    case 'mute_tabs':
    case 'unmute_tabs':
    case 'pin_tabs':
    case 'unpin_tabs':
    case 'duplicate_tab':
    case 'move_tab':
    case 'activate_tab':
    case 'reload_tabs':
    case 'discard_tabs':
    case 'save_session':
      return postAction(base, action, config.debug);

    // ── Restore actions POST to /action as well ──────────────────────────
    case 'restore_last_closed':
    case 'restore_session':
      return postAction(base, action, config.debug);

    // ── Read-only GET endpoints ───────────────────────────────────────────
    case 'list_bookmarks': {
      const q = action.query || action.filter || '';
      const url = q
        ? `${base}/bookmarks?q=${encodeURIComponent(q)}`
        : `${base}/bookmarks`;
      return getJson(url);
    }

    case 'list_history': {
      return getJson(`${base}/history`);
    }

    case 'search_history': {
      const q = action.query || '';
      if (!q) return getJson(`${base}/history`);
      return getJson(`${base}/history/search?q=${encodeURIComponent(q)}`);
    }

    case 'list_sessions':
      return getJson(`${base}/sessions`);

    // ── RAG actions ───────────────────────────────────────────────────────
    case 'summarize_tab':
      return postJson(`${base}/rag/summarize`, {
        target: action.target || 'current'
      });

    case 'search_content':
      return getJson(`${base}/rag/search?q=${encodeURIComponent(action.query || '')}&limit=${action.limit || 5}`);

    case 'open_from_search': {
      const searchResult = await getJson(`${base}/rag/search?q=${encodeURIComponent(action.query || '')}&limit=1`);
      const results = searchResult?.results || [];
      if (results.length === 0) {
        return { text: `No indexed pages found matching "${action.query}"` };
      }
      const topUrl = results[0].url;
      return postJson(`${base}/action`, { action: 'open_url', params: { url: topUrl } });
    }

    // ── Purely local actions (no bridge call) ─────────────────────────────
    case 'search_tabs':
      // The model already resolved matching tabs in its answer; nothing to call.
      return { searched: true, query: action.query };

    case 'answer':
      return { text: action.text };

    default:
      throw new Error(`Unknown action type: ${action.action}`);
  }
}

/**
 * Returns true if the action is destructive and should require confirmation.
 */
export function isDestructive(action) {
  return action.action === 'close_tabs' ||
         action.action === 'close_all_except' ||
         action.action === 'restore_session';
}

/**
 * Build a short human-readable summary string for a completed action.
 */
export function formatResult(action, result) {
  switch (action.action) {
    case 'close_tabs': {
      const count = action.targets?.length ?? 0;
      const reason = action.reason ? ` (${action.reason})` : '';
      return `Closed ${count} tab${count !== 1 ? 's' : ''}${reason}`;
    }

    case 'close_all_except': {
      const kept = action.keep?.length ?? 0;
      return `Closed all tabs except ${kept} kept`;
    }

    case 'open_url':
      return `Opened ${action.url}`;

    case 'open_urls': {
      const n = action.urls?.length ?? 0;
      return `Opened ${n} URL${n !== 1 ? 's' : ''}`;
    }

    case 'open_new_tabs': {
      const n = action.count ?? 1;
      return `Opened ${n} new tab${n !== 1 ? 's' : ''}`;
    }

    case 'bookmark_tabs': {
      const n = action.targets?.length ?? 0;
      const folder = action.folder ? ` \u2192 ${action.folder}` : '';
      return `Bookmarked ${n} tab${n !== 1 ? 's' : ''}${folder}`;
    }

    case 'list_bookmarks':
      return formatBookmarksResult(result, action.filter);

    case 'group_tabs':
      return `Grouped tabs by ${action.by ?? 'domain'}`;

    case 'search_tabs':
      return `Search results for "${action.query}"`;

    case 'mute_tabs': {
      const n = action.targets?.length ?? 0;
      return `Muted ${n} tab${n !== 1 ? 's' : ''}`;
    }

    case 'unmute_tabs': {
      const n = action.targets?.length ?? 0;
      return `Unmuted ${n} tab${n !== 1 ? 's' : ''}`;
    }

    case 'pin_tabs': {
      const n = action.targets?.length ?? 0;
      return `Pinned ${n} tab${n !== 1 ? 's' : ''}`;
    }

    case 'unpin_tabs': {
      const n = action.targets?.length ?? 0;
      return `Unpinned ${n} tab${n !== 1 ? 's' : ''}`;
    }

    case 'duplicate_tab':
      return `Duplicated tab ${action.target}`;

    case 'move_tab':
      return `Moved tab ${action.target} to window ${action.windowId}`;

    case 'activate_tab':
      return `Activated tab ${action.target}`;

    case 'reload_tabs': {
      const n = action.targets?.length ?? 1;
      return `Reloaded ${n} tab${n !== 1 ? 's' : ''}`;
    }

    case 'discard_tabs': {
      const n = action.targets?.length ?? 0;
      return `Discarded ${n} tab${n !== 1 ? 's' : ''}`;
    }

    case 'save_session':
      return `Saved session "${action.label ?? 'manual'}"`;


    case 'restore_last_closed': {
      const n = action.count ?? 1;
      return `Restored ${n} recently closed tab${n !== 1 ? 's' : ''}`;
    }

    case 'restore_session':
      return formatSessionRestoreResult(action, result);

    case 'list_history':
      return formatHistoryResult(result, action.filter);

    case 'search_history':
      return formatHistoryResult(result, action.query);

    case 'list_sessions':
      return formatSessionsResult(result);

    case 'summarize_tab':
      return result?.summary || result?.text || 'Summary not available';

    case 'search_content': {
      const items = result?.results || [];
      if (items.length === 0) return `No indexed pages found matching "${action.query}"`;
      const lines = items.map((r, i) =>
        `  ${i + 1}. ${r.title || 'Untitled'} (${extractDomain(r.url)}) [score: ${r.score.toFixed(2)}]\n     ${r.snippet || ''}`
      );
      return [`Content search for "${action.query}" (${items.length} results):`, ...lines].join('\n');
    }

    case 'open_from_search': {
      if (result?.text) return result.text; // "No indexed pages found..."
      return `Opened page matching "${action.query}"`;
    }

    case 'answer':
      return action.text ?? result?.text ?? '';

    default:
      return `Executed ${action.action}`;
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a flat action object from the model into the { action, params }
 * shape the bridge's POST /action endpoint expects, then POST it.
 */
async function postAction(base, action, debug) {
  const { action: actionName, ...params } = action;
  const payload = { action: actionName, params };
  if (debug) {
    console.log('\x1b[35m\x1b[1m\n─── DEBUG: POST to bridge ───\x1b[0m');
    console.log('\x1b[35m' + JSON.stringify(payload, null, 2) + '\x1b[0m');
  }
  const result = await postJson(`${base}/action`, payload);
  if (debug) {
    console.log('\x1b[35m\x1b[1m\n─── DEBUG: Bridge response ───\x1b[0m');
    console.log('\x1b[35m' + JSON.stringify(result, null, 2) + '\x1b[0m');
  }
  return result;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BridgeError(`Bridge returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BridgeError(`Bridge returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Result formatting helpers ────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return '?';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

function formatBookmarksResult(result, filter) {
  const items = Array.isArray(result) ? result : (result?.bookmarks ?? []);
  if (items.length === 0) return filter ? `No bookmarks matching "${filter}"` : 'No bookmarks found';
  const lines = items.slice(0, 20).map((b) => `  ${b.title ?? 'Untitled'} | ${b.url ?? '?'}`);
  const header = filter
    ? `Bookmarks matching "${filter}" (${items.length}):`
    : `Bookmarks (${items.length}):`;
  return [header, ...lines].join('\n');
}

function formatHistoryResult(result, filter) {
  const entries = Array.isArray(result) ? result : (result?.history ?? result?.entries ?? []);
  if (entries.length === 0) return filter ? `No history matching "${filter}"` : 'No history entries';
  const lines = entries.slice(0, 20).map((h) => `  ${h.title ?? 'Untitled'} | ${h.url ?? '?'}`);
  const header = filter
    ? `History matching "${filter}" (${entries.length}):`
    : `History (${entries.length}):`;
  return [header, ...lines].join('\n');
}

function formatSessionsResult(result) {
  const sessions = Array.isArray(result) ? result : (result?.sessions ?? []);
  if (sessions.length === 0) return 'No saved sessions';
  const lines = sessions.map((s) => {
    const tabs = s.tabs ?? (Array.isArray(s.windows)
      ? s.windows.reduce((sum, w) => sum + (w.tabs?.length ?? 0), 0)
      : (s.tabCount ?? '?'));
    const wins = Array.isArray(s.windows) ? s.windows.length : (s.windows ?? s.windowCount ?? '?');
    return `  [${s.label ?? s.sessionId ?? s.id}] ${wins} window${wins !== 1 ? 's' : ''}, ${tabs} tabs`;
  });
  return [`Sessions (${sessions.length}):`, ...lines].join('\n');
}

function formatSessionRestoreResult(action, result) {
  const sessionName = action.label ?? action.index ?? action.sessionId ?? '?';
  // The bridge wraps the response in { ok, result } — unwrap if needed
  const inner = result?.result ?? result;
  if (inner?.windows && Array.isArray(inner.windows)) {
    const parts = inner.windows.map(
      (w, i) => `Window ${i + 1}: ${w.tabCount ?? w.tabs?.length ?? '?'} tabs`
    );
    return `Restored session "${inner.restored ?? sessionName}" \u2014 ${parts.join(', ')}`;
  }
  return `Restored session "${inner?.restored ?? sessionName}"`;
}

/**
 * Custom error class so callers can distinguish bridge failures.
 */
export class BridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BridgeError';
  }
}
