/**
 * Format tab metadata compactly for the LLM prompt.
 * @param {Array<object>} tabs - Array of tab metadata objects from the bridge
 * @returns {string} Compact multi-line representation
 */
export function formatTabs(tabs) {
  if (!tabs || tabs.length === 0) return 'Open tabs (0):';

  // Group tabs by windowId
  const byWindow = new Map();
  for (const tab of tabs) {
    const wid = tab.windowId ?? 0;
    if (!byWindow.has(wid)) byWindow.set(wid, []);
    byWindow.get(wid).push(tab);
  }

  const windowCount = byWindow.size;
  const lines = [`Open tabs (${tabs.length} across ${windowCount} window${windowCount !== 1 ? 's' : ''}):`];

  for (const [wid, windowTabs] of byWindow) {
    lines.push(`--- Window ${wid} ---`);
    for (const t of windowTabs) {
      const domain = extractDomain(t.url);
      const pinned = t.pinned ? ' pinned' : '';
      const muted = t.muted ? ' muted' : '';
      const active = t.active ? ' active' : '';
      const audible = t.audible ? ' audible' : '';
      const flags = [pinned, muted, active, audible].filter(Boolean).join('');

      let line = `[id:${t.id}] ${truncate(t.title, 80)} | ${domain}`;
      line += ` | w:${t.windowId ?? 0} i:${t.index ?? 0}`;
      if (flags) line += ` |${flags}`;
      lines.push(line);
    }
  }

  return lines.join('\n');
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
