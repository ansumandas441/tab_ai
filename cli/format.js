/**
 * Format tab metadata compactly for the LLM prompt.
 * Uses simple sequential IDs (1, 2, 3...) instead of Chrome's large tab IDs
 * to avoid confusing small LLMs.
 *
 * @param {Array<object>} tabs - Array of tab metadata objects from the bridge
 * @returns {{ text: string, idMap: Record<number, number> }}
 *   text    — compact multi-line representation for the LLM
 *   idMap   — mapping from sequential ID → real Chrome tab ID
 */
export function formatTabs(tabs) {
  if (!tabs || tabs.length === 0) return { text: 'Open tabs (0):', idMap: {} };

  const idMap = {};   // { sequentialId: realChromeTabId }
  let seq = 1;

  // Group tabs by windowId
  const byWindow = new Map();
  for (const tab of tabs) {
    const wid = tab.windowId ?? 0;
    if (!byWindow.has(wid)) byWindow.set(wid, []);
    byWindow.get(wid).push(tab);
  }

  const windowCount = byWindow.size;
  const lines = [`Open tabs (${tabs.length} across ${windowCount} window${windowCount !== 1 ? 's' : ''}):`];

  for (const [, windowTabs] of byWindow) {
    for (const t of windowTabs) {
      idMap[seq] = t.id;
      const domain = extractDomain(t.url);
      const flags = [
        t.pinned ? ' pinned' : '',
        t.muted ? ' muted' : '',
        t.active ? ' active' : '',
        t.audible ? ' audible' : '',
      ].filter(Boolean).join('');

      let line = `[${seq}] ${truncate(t.title, 80)} | ${domain}`;
      if (flags) line += ` |${flags}`;
      lines.push(line);
      seq++;
    }
  }

  return { text: lines.join('\n'), idMap };
}

/**
 * Remap sequential tab IDs in an LLM-produced action back to real Chrome tab IDs.
 * @param {object} action - Action object from the LLM
 * @param {Record<number, number>} idMap - Sequential → real Chrome tab ID mapping
 * @returns {object} Action with remapped IDs
 */
export function remapActionIds(action, idMap) {
  if (!action || !idMap || Object.keys(idMap).length === 0) return action;

  const remap = (id) => {
    if (typeof id === 'string' && /^\d+$/.test(id)) id = parseInt(id, 10);
    return (typeof id === 'number' && idMap[id] != null) ? idMap[id] : id;
  };

  const copy = { ...action };

  if (Array.isArray(copy.targets)) {
    copy.targets = copy.targets.map(remap);
  } else if (typeof copy.targets === 'number' || (typeof copy.targets === 'string' && /^\d+$/.test(copy.targets))) {
    copy.targets = remap(copy.targets);
  }

  if (copy.target != null && copy.target !== 'current' && copy.target !== 'all') {
    copy.target = remap(copy.target);
  }

  if (Array.isArray(copy.keep)) {
    copy.keep = copy.keep.map(remap);
  }

  return copy;
}

/**
 * Format closed-tab history compactly for display or prompt.
 * @param {Array<object>} history - Array of closed tab records
 * @returns {string} Compact multi-line representation
 */
export function formatHistory(history) {
  if (!history || history.length === 0) return 'No closed tab history.';

  const lines = [`Closed tabs (${history.length}):`];

  for (const h of history) {
    const domain = extractDomain(h.url);
    const rel = relativeTime(h.closedAt);
    const closedBy = h.closedBy ? ` by ${h.closedBy}` : '';
    lines.push(`[h:${h.historyId ?? h.id ?? '?'}] ${truncate(h.title, 70)} | ${domain} | closed ${rel}${closedBy}`);
  }

  return lines.join('\n');
}

/**
 * Format saved sessions compactly for display or prompt.
 * @param {Array<object>} sessions - Array of session records
 * @returns {string} Compact multi-line representation
 */
export function formatSessions(sessions) {
  if (!sessions || sessions.length === 0) return 'No saved sessions.';

  const lines = [`Sessions (${sessions.length}):`];

  for (const s of sessions) {
    const rel = relativeTime(s.savedAt ?? s.timestamp);
    const trigger = s.trigger ?? 'manual';
    const windowCount = Array.isArray(s.windows) ? s.windows.length : (s.windows ?? s.windowCount ?? '?');
    const totalTabs = Array.isArray(s.windows)
      ? s.windows.reduce((sum, w) => sum + (w.tabs ? w.tabs.length : 0), 0)
      : (s.tabs ?? s.tabCount ?? '?');
    lines.push(`[s:${s.label ?? s.sessionId ?? s.id}] ${rel} | ${trigger} | ${windowCount} window${windowCount !== 1 ? 's' : ''}, ${totalTabs} tabs`);
  }

  return lines.join('\n');
}

/**
 * Format full session details (all tabs per session).
 * @param {Array<object>} sessions
 * @returns {string}
 */
export function formatSessionsFull(sessions) {
  if (!sessions || sessions.length === 0) return 'No saved sessions.';

  const lines = [];

  for (const s of sessions) {
    const rel = relativeTime(s.savedAt ?? s.timestamp);
    const trigger = s.trigger ?? 'manual';
    const windows = Array.isArray(s.windows) ? s.windows : [];
    const totalTabs = windows.length > 0
      ? windows.reduce((sum, w) => sum + (w.tabs ? w.tabs.length : 0), 0)
      : (s.tabs ?? s.tabCount ?? '?');

    lines.push(`\n[s:${s.label ?? s.sessionId ?? s.id}] ${rel} | ${trigger} | ${windows.length || (s.windows ?? '?')} window${(windows.length || s.windows) !== 1 ? 's' : ''}, ${totalTabs} tabs`);

    if (windows.length === 0) {
      lines.push('  (full tab data not available in summary view)');
      continue;
    }

    for (let wi = 0; wi < windows.length; wi++) {
      const w = windows[wi];
      const tabs = w.tabs ?? [];
      lines.push(`  Window ${wi + 1} (${tabs.length} tabs):`);
      for (const t of tabs) {
        const domain = extractDomain(t.url);
        lines.push(`    ${truncate(t.title, 60)} | ${domain}`);
      }
    }
  }

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return '?';
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

/**
 * Convert an ISO timestamp (or epoch ms) to a short human-readable relative string.
 */
function relativeTime(ts) {
  if (!ts) return '?';
  const now = Date.now();
  const then = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  return new Date(then).toLocaleDateString();
}
