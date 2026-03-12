/*
 * tabai background service worker
 *
 * Responsibilities:
 *   - Track every tab lifecycle event and maintain a compact index in storage.
 *   - Keep a rolling history of closed tabs (max 200).
 *   - Snapshot sessions before destructive actions (max 50).
 *   - Connect to the native messaging host and execute action commands.
 *   - Return structured JSON for every action.
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const STORAGE_TABS     = "tabai:tabs";
const STORAGE_HISTORY  = "tabai:history";
const STORAGE_SESSIONS = "tabai:sessions";
const MAX_HISTORY      = 200;
const MAX_SESSIONS     = 50;
const NATIVE_HOST      = "com.tabai.bridge";

/* ------------------------------------------------------------------ */
/*  In-memory tab index (flushed to storage on every mutation)        */
/* ------------------------------------------------------------------ */

let tabIndex = {};   // { [tabId]: { id, windowId, index, url, title, pinned, muted, groupId, favIconUrl, lastAccessed } }
let nativePort = null;
let reconnectTimer = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function compact(tab) {
  return {
    id:           tab.id,
    windowId:     tab.windowId,
    index:        tab.index,
    url:          tab.url  || "",
    title:        tab.title || "",
    pinned:       !!tab.pinned,
    muted:        !!(tab.mutedInfo && tab.mutedInfo.muted),
    active:       !!tab.active,
    audible:      !!tab.audible,
    groupId:      tab.groupId != null ? tab.groupId : -1,
    favIconUrl:   tab.favIconUrl || "",
    lastAccessed: tab.lastAccessed || Date.now(),
    status:       tab.status || "complete"
  };
}

async function flushIndex() {
  try {
    await chrome.storage.local.set({ [STORAGE_TABS]: tabIndex });
  } catch (e) {
    console.error("tabai: flushIndex failed", e);
  }
}

async function getHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_HISTORY);
    return result[STORAGE_HISTORY] || [];
  } catch (_) {
    return [];
  }
}

async function pushHistory(entry) {
  const history = await getHistory();
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [STORAGE_HISTORY]: history });
}

async function getSessions() {
  try {
    const result = await chrome.storage.local.get(STORAGE_SESSIONS);
    return result[STORAGE_SESSIONS] || [];
  } catch (_) {
    return [];
  }
}

async function saveSession(label) {
  const sessions = await getSessions();
  const windows = await chrome.windows.getAll({ populate: true });
  const snapshot = {
    label:     label || "auto-" + new Date().toISOString(),
    timestamp: Date.now(),
    windows:   windows.map(w => ({
      id:     w.id,
      state:  w.state,
      tabs:   w.tabs.map(compact)
    }))
  };
  sessions.unshift(snapshot);
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  await chrome.storage.local.set({ [STORAGE_SESSIONS]: sessions });
  return snapshot;
}

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "unknown";
  }
}

function matchesQuery(tab, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (tab.title && tab.title.toLowerCase().includes(q)) ||
         (tab.url   && tab.url.toLowerCase().includes(q));
}

/* ------------------------------------------------------------------ */
/*  Content extraction (for RAG indexing)                             */
/* ------------------------------------------------------------------ */

async function extractContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clone = document.body.cloneNode(true);
        for (const el of clone.querySelectorAll(
          'script,style,nav,header,footer,aside,iframe,noscript,' +
          '.sidebar,.nav,.menu,[role="navigation"],[role="banner"],' +
          '[role="complementary"]'
        )) {
          el.remove();
        }
        let text = clone.innerText || clone.textContent || '';
        text = text.replace(/\s+/g, ' ').trim();
        return { text: text.slice(0, 10000), title: document.title, url: location.href };
      }
    });
    return results?.[0]?.result || null;
  } catch (e) {
    // Silently fail for restricted pages (chrome://, PDFs, etc.)
    return null;
  }
}

function shouldIndex(url) {
  if (!url) return false;
  return !url.startsWith('chrome://') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('about:') &&
         !url.startsWith('chrome-search://') &&
         !url.startsWith('devtools://');
}

/* ------------------------------------------------------------------ */
/*  Bootstrap: build initial tab index                                */
/* ------------------------------------------------------------------ */

async function buildIndex() {
  try {
    const tabs = await chrome.tabs.query({});
    tabIndex = {};
    for (const tab of tabs) {
      tabIndex[tab.id] = compact(tab);
    }
    await flushIndex();
  } catch (e) {
    console.error("tabai: buildIndex failed", e);
  }
}

buildIndex();

/* ------------------------------------------------------------------ */
/*  Tab event listeners                                               */
/* ------------------------------------------------------------------ */

chrome.tabs.onCreated.addListener(async (tab) => {
  tabIndex[tab.id] = compact(tab);
  await flushIndex();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Merge changes into existing record or create fresh
  if (tabIndex[tabId]) {
    const prev = tabIndex[tabId];
    tabIndex[tabId] = {
      ...prev,
      url:          tab.url   || prev.url,
      title:        tab.title || prev.title,
      pinned:       tab.pinned != null ? tab.pinned : prev.pinned,
      muted:        tab.mutedInfo ? tab.mutedInfo.muted : prev.muted,
      groupId:      tab.groupId != null ? tab.groupId : prev.groupId,
      favIconUrl:   tab.favIconUrl || prev.favIconUrl,
      index:        tab.index != null ? tab.index : prev.index,
      windowId:     tab.windowId != null ? tab.windowId : prev.windowId,
      status:       tab.status || prev.status,
      lastAccessed: Date.now()
    };
  } else {
    tabIndex[tabId] = compact(tab);
  }
  await flushIndex();

  // Background RAG indexing: extract content when page finishes loading
  if (changeInfo.status === 'complete' && shouldIndex(tab.url)) {
    extractContent(tabId).then(content => {
      if (content && nativePort) {
        try {
          nativePort.postMessage({
            id: 'index-' + Date.now(),
            action: 'index_page',
            params: content
          });
        } catch (_) {}
      }
    });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const entry = tabIndex[tabId];
  if (entry) {
    await pushHistory({
      ...entry,
      closedAt: Date.now(),
      windowClosing: removeInfo.isWindowClosing
    });
    delete tabIndex[tabId];
    await flushIndex();
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (tabIndex[activeInfo.tabId]) {
    tabIndex[activeInfo.tabId].lastAccessed = Date.now();
    await flushIndex();
  }
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  if (tabIndex[tabId]) {
    tabIndex[tabId].index    = moveInfo.toIndex;
    tabIndex[tabId].windowId = moveInfo.windowId || tabIndex[tabId].windowId;
    await flushIndex();
  }
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  if (tabIndex[tabId]) {
    tabIndex[tabId].windowId = attachInfo.newWindowId;
    tabIndex[tabId].index    = attachInfo.newPosition;
    await flushIndex();
  }
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  // Just note it; onAttached will fix the window/index.
  if (tabIndex[tabId]) {
    tabIndex[tabId].lastAccessed = Date.now();
    await flushIndex();
  }
});

// Tab group changes (if available)
if (chrome.tabGroups && chrome.tabGroups.onUpdated) {
  chrome.tabGroups.onUpdated.addListener(async (group) => {
    // Refresh all tabs in this group
    try {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      for (const tab of tabs) {
        if (tabIndex[tab.id]) {
          tabIndex[tab.id].groupId = group.id;
        }
      }
      await flushIndex();
    } catch (_) {}
  });
}

/* ------------------------------------------------------------------ */
/*  Native messaging                                                  */
/* ------------------------------------------------------------------ */

function connectNative() {
  if (nativePort) {
    try { nativePort.disconnect(); } catch (_) {}
  }

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    console.error("tabai: connectNative failed", e);
    scheduleReconnect();
    return;
  }

  nativePort.onMessage.addListener(async (msg) => {
    // msg = { id: "...", action: "...", params: {...} }
    let response;
    try {
      response = await handleAction(msg);
    } catch (e) {
      response = { id: msg.id, error: e.message || String(e) };
    }
    try {
      nativePort.postMessage(response);
    } catch (e) {
      console.error("tabai: postMessage failed", e);
    }
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    console.warn("tabai: native port disconnected", err ? err.message : "");
    nativePort = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, 3000);
}

// Connect on startup
connectNative();

// Also reconnect when service worker wakes up
chrome.runtime.onStartup.addListener(() => {
  buildIndex();
  connectNative();
});

chrome.runtime.onInstalled.addListener(() => {
  buildIndex();
  connectNative();
});

/* ------------------------------------------------------------------ */
/*  Resolve tab targets                                               */
/* ------------------------------------------------------------------ */

/*
 * The model may specify targets as:
 *   - Array of tab IDs (numbers)
 *   - A search query string  (we match against title/url)
 *   - "all"
 *   - "current"
 *   - "domain:<hostname>"
 *   - A single tab ID number
 *
 * Returns an array of tab objects from tabIndex.
 */
async function resolveTargets(targets) {
  if (!targets) return [];

  // Single numeric id (or numeric string from LLM)
  if (typeof targets === "number") {
    const t = tabIndex[targets];
    return t ? [t] : [];
  }

  if (typeof targets === "string" && /^\d+$/.test(targets)) {
    const t = tabIndex[parseInt(targets, 10)];
    return t ? [t] : [];
  }

  // Array of numeric ids (or numeric strings)
  if (Array.isArray(targets)) {
    if (targets.length === 0) return [];
    if (typeof targets[0] === "number" || (typeof targets[0] === "string" && /^\d+$/.test(targets[0]))) {
      return targets.map(id => tabIndex[typeof id === "string" ? parseInt(id, 10) : id]).filter(Boolean);
    }
    // Array of query strings — union of matches
    const results = [];
    const seen = new Set();
    for (const q of targets) {
      for (const tab of Object.values(tabIndex)) {
        if (!seen.has(tab.id) && matchesQuery(tab, q)) {
          seen.add(tab.id);
          results.push(tab);
        }
      }
    }
    return results;
  }

  // String specifiers
  if (typeof targets === "string") {
    if (targets === "all") return Object.values(tabIndex);

    if (targets === "current") {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        return active && tabIndex[active.id] ? [tabIndex[active.id]] : [];
      } catch (_) {
        return [];
      }
    }

    if (targets.startsWith("domain:")) {
      const domain = targets.slice(7).toLowerCase();
      return Object.values(tabIndex).filter(t => domainOf(t.url).includes(domain));
    }

    // Treat as search query
    return Object.values(tabIndex).filter(t => matchesQuery(t, targets));
  }

  return [];
}

/* ------------------------------------------------------------------ */
/*  Action handlers                                                   */
/* ------------------------------------------------------------------ */

async function handleAction(msg) {
  const { id, action, params } = msg;
  const p = params || {};

  switch (action) {

    /* ---------- Tab queries ---------- */

    case "get_tabs": {
      return { id, result: Object.values(tabIndex) };
    }

    case "search_tabs": {
      const query = p.query || "";
      const matches = Object.values(tabIndex).filter(t => matchesQuery(t, query));
      return { id, result: matches };
    }

    /* ---------- Tab mutations ---------- */

    case "close_tabs": {
      await saveSession("before-close");
      const targets = await resolveTargets(p.targets);
      if (targets.length === 0) return { id, error: "No matching tabs found" };
      const ids = targets.map(t => t.id);
      await chrome.tabs.remove(ids);
      return { id, result: { closed: ids.length, tabIds: ids } };
    }

    case "close_all_except": {
      await saveSession("before-close-all-except");
      const keep = await resolveTargets(p.keep);
      const keepIds = new Set(keep.map(t => t.id));
      const allTabs = Object.values(tabIndex);
      const toClose = allTabs.filter(t => !keepIds.has(t.id)).map(t => t.id);
      if (toClose.length === 0) return { id, result: { closed: 0, tabIds: [] } };
      await chrome.tabs.remove(toClose);
      return { id, result: { closed: toClose.length, tabIds: toClose } };
    }

    case "open_url": {
      const url = p.url;
      if (!url) return { id, error: "Missing url parameter" };
      const tab = await chrome.tabs.create({ url, active: p.active !== false });
      tabIndex[tab.id] = compact(tab);
      await flushIndex();
      return { id, result: compact(tab) };
    }

    case "open_urls": {
      const urls = p.urls;
      if (!Array.isArray(urls) || urls.length === 0) return { id, error: "Missing or empty urls array" };
      const opened = [];
      for (const url of urls) {
        const tab = await chrome.tabs.create({ url, active: false });
        tabIndex[tab.id] = compact(tab);
        opened.push(compact(tab));
      }
      await flushIndex();
      return { id, result: { opened: opened.length, tabs: opened } };
    }

    case "open_new_tabs": {
      const count = p.count || 1;
      const opened = [];
      for (let i = 0; i < count; i++) {
        const tab = await chrome.tabs.create({ active: i === 0 });
        tabIndex[tab.id] = compact(tab);
        opened.push(compact(tab));
      }
      await flushIndex();
      return { id, result: { opened: opened.length, tabs: opened } };
    }

    case "bookmark_tabs": {
      const targets = await resolveTargets(p.targets);
      if (targets.length === 0) return { id, error: "No matching tabs to bookmark" };
      const folder = p.folder || "tabai";
      // Find or create the folder under "Other Bookmarks"
      let parentId;
      try {
        const tree = await chrome.bookmarks.getTree();
        const otherBookmarks = tree[0].children.find(n => n.title === "Other Bookmarks" || n.title === "Other bookmarks") || tree[0].children[tree[0].children.length - 1];
        // Look for existing tabai folder
        let tabaiFolder = null;
        if (otherBookmarks.children) {
          tabaiFolder = otherBookmarks.children.find(n => n.title === folder && !n.url);
        }
        if (!tabaiFolder) {
          tabaiFolder = await chrome.bookmarks.create({ parentId: otherBookmarks.id, title: folder });
        }
        parentId = tabaiFolder.id;
      } catch (e) {
        // Fallback: create under root
        const tree = await chrome.bookmarks.getTree();
        parentId = tree[0].children[0].id;
      }
      const bookmarked = [];
      for (const tab of targets) {
        try {
          const bm = await chrome.bookmarks.create({ parentId, title: tab.title, url: tab.url });
          bookmarked.push({ id: bm.id, title: bm.title, url: bm.url });
        } catch (e) {
          bookmarked.push({ title: tab.title, url: tab.url, error: e.message });
        }
      }
      return { id, result: { bookmarked: bookmarked.length, bookmarks: bookmarked } };
    }

    case "list_bookmarks": {
      try {
        const tree = await chrome.bookmarks.getTree();
        const flat = [];
        function walk(nodes) {
          for (const node of nodes) {
            if (node.url) {
              flat.push({ id: node.id, title: node.title || "", url: node.url, parentId: node.parentId });
            }
            if (node.children) walk(node.children);
          }
        }
        walk(tree);
        const query = (p.query || "").toLowerCase();
        const filtered = query
          ? flat.filter(b => b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query))
          : flat;
        return { id, result: filtered };
      } catch (e) {
        return { id, error: e.message };
      }
    }

    case "group_tabs": {
      const targets = await resolveTargets(p.targets || "all");
      if (targets.length === 0) return { id, error: "No tabs to group" };

      if (p.by === "domain" || !p.by) {
        // Group by domain
        const domains = {};
        for (const tab of targets) {
          const d = domainOf(tab.url);
          if (!domains[d]) domains[d] = [];
          domains[d].push(tab.id);
        }
        const groups = [];
        for (const [domain, ids] of Object.entries(domains)) {
          if (ids.length < 2) continue; // skip singletons
          try {
            const groupId = await chrome.tabs.group({ tabIds: ids });
            await chrome.tabGroups.update(groupId, { title: domain, collapsed: false });
            groups.push({ domain, groupId, tabCount: ids.length });
          } catch (e) {
            groups.push({ domain, error: e.message });
          }
        }
        await buildIndex();
        return { id, result: { groupsCreated: groups.length, groups } };
      } else {
        // Group specified tabs under a given name
        const name = p.name || p.by || "group";
        try {
          const ids = targets.map(t => t.id);
          const groupId = await chrome.tabs.group({ tabIds: ids });
          await chrome.tabGroups.update(groupId, { title: name, collapsed: false });
          await buildIndex();
          return { id, result: { groupId, name, tabCount: ids.length } };
        } catch (e) {
          return { id, error: e.message };
        }
      }
    }

    case "mute_tabs": {
      const targets = await resolveTargets(p.targets || "all");
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const muted = p.muted !== false; // default true
      const updated = [];
      for (const tab of targets) {
        try {
          await chrome.tabs.update(tab.id, { muted });
          if (tabIndex[tab.id]) tabIndex[tab.id].muted = muted;
          updated.push(tab.id);
        } catch (e) {
          // Tab may have been closed
        }
      }
      await flushIndex();
      return { id, result: { muted, count: updated.length, tabIds: updated } };
    }

    case "unmute_tabs": {
      const targets = await resolveTargets(p.targets || "all");
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const updated = [];
      for (const tab of targets) {
        try {
          await chrome.tabs.update(tab.id, { muted: false });
          if (tabIndex[tab.id]) tabIndex[tab.id].muted = false;
          updated.push(tab.id);
        } catch (e) {}
      }
      await flushIndex();
      return { id, result: { muted: false, count: updated.length, tabIds: updated } };
    }

    case "pin_tabs": {
      const targets = await resolveTargets(p.targets);
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const pinned = p.pinned !== false;
      const updated = [];
      for (const tab of targets) {
        try {
          await chrome.tabs.update(tab.id, { pinned });
          if (tabIndex[tab.id]) tabIndex[tab.id].pinned = pinned;
          updated.push(tab.id);
        } catch (e) {}
      }
      await flushIndex();
      return { id, result: { pinned, count: updated.length, tabIds: updated } };
    }

    case "unpin_tabs": {
      const targets = await resolveTargets(p.targets);
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const updated = [];
      for (const tab of targets) {
        try {
          await chrome.tabs.update(tab.id, { pinned: false });
          if (tabIndex[tab.id]) tabIndex[tab.id].pinned = false;
          updated.push(tab.id);
        } catch (e) {}
      }
      await flushIndex();
      return { id, result: { pinned: false, count: updated.length, tabIds: updated } };
    }

    case "duplicate_tab": {
      const targets = await resolveTargets(p.target || p.targets || "current");
      if (targets.length === 0) return { id, error: "No tab to duplicate" };
      const source = targets[0];
      try {
        const dup = await chrome.tabs.duplicate(source.id);
        tabIndex[dup.id] = compact(dup);
        await flushIndex();
        return { id, result: compact(dup) };
      } catch (e) {
        return { id, error: e.message };
      }
    }

    case "move_tab": {
      const targets = await resolveTargets(p.target || p.targets);
      if (targets.length === 0) return { id, error: "No tab to move" };
      const tab = targets[0];
      const moveProps = {};
      if (p.index != null) moveProps.index = p.index;
      else moveProps.index = -1; // end
      if (p.windowId != null) moveProps.windowId = p.windowId;
      try {
        const moved = await chrome.tabs.move(tab.id, moveProps);
        const movedTab = Array.isArray(moved) ? moved[0] : moved;
        if (tabIndex[movedTab.id]) {
          tabIndex[movedTab.id].index = movedTab.index;
          tabIndex[movedTab.id].windowId = movedTab.windowId;
        }
        await flushIndex();
        return { id, result: tabIndex[movedTab.id] || compact(movedTab) };
      } catch (e) {
        return { id, error: e.message };
      }
    }

    case "activate_tab": {
      const targets = await resolveTargets(p.target || p.targets);
      if (targets.length === 0) return { id, error: "No matching tab" };
      const tab = targets[0];
      try {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return { id, result: { activated: tab.id, title: tab.title } };
      } catch (e) {
        return { id, error: e.message };
      }
    }

    case "reload_tabs": {
      const targets = await resolveTargets(p.targets || "current");
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const reloaded = [];
      for (const tab of targets) {
        try {
          await chrome.tabs.reload(tab.id, { bypassCache: !!p.bypassCache });
          reloaded.push(tab.id);
        } catch (e) {}
      }
      return { id, result: { reloaded: reloaded.length, tabIds: reloaded } };
    }

    case "discard_tabs": {
      const targets = await resolveTargets(p.targets);
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const discarded = [];
      for (const tab of targets) {
        try {
          await chrome.tabs.discard(tab.id);
          discarded.push(tab.id);
        } catch (e) {}
      }
      return { id, result: { discarded: discarded.length, tabIds: discarded } };
    }

    /* ---------- History ---------- */

    case "get_history":
    case "list_history": {
      const history = await getHistory();
      const limit = p.limit || 50;
      return { id, result: history.slice(0, limit) };
    }

    case "search_history": {
      const history = await getHistory();
      const query = (p.query || "").toLowerCase();
      const matches = history.filter(h =>
        (h.title && h.title.toLowerCase().includes(query)) ||
        (h.url   && h.url.toLowerCase().includes(query))
      );
      return { id, result: matches.slice(0, p.limit || 50) };
    }

    case "restore_last_closed": {
      const history = await getHistory();
      const count = p.count || 1;
      const toRestore = history.slice(0, count);
      if (toRestore.length === 0) return { id, error: "No closed tabs in history" };
      const restored = [];
      for (const entry of toRestore) {
        try {
          const tab = await chrome.tabs.create({ url: entry.url, active: false });
          tabIndex[tab.id] = compact(tab);
          restored.push(compact(tab));
        } catch (e) {
          restored.push({ url: entry.url, error: e.message });
        }
      }
      // Remove restored entries from history
      const remaining = history.slice(count);
      await chrome.storage.local.set({ [STORAGE_HISTORY]: remaining });
      await flushIndex();
      return { id, result: { restored: restored.length, tabs: restored } };
    }

    /* ---------- Sessions ---------- */

    case "get_sessions":
    case "list_sessions": {
      const sessions = await getSessions();
      if (p.full) {
        // Return full session data including all tab details
        return { id, result: sessions };
      }
      // Return summaries by default
      const summaries = sessions.map(s => ({
        label:     s.label,
        timestamp: s.timestamp,
        windows:   s.windows.length,
        tabs:      s.windows.reduce((n, w) => n + w.tabs.length, 0)
      }));
      return { id, result: summaries };
    }

    case "save_session": {
      const snapshot = await saveSession(p.label || "manual");
      return {
        id,
        result: {
          label:     snapshot.label,
          timestamp: snapshot.timestamp,
          windows:   snapshot.windows.length,
          tabs:      snapshot.windows.reduce((n, w) => n + w.tabs.length, 0)
        }
      };
    }

    case "restore_session": {
      const sessions = await getSessions();
      let session;
      if (p.index != null) {
        session = sessions[p.index];
      } else if (p.label) {
        session = sessions.find(s => s.label.includes(p.label));
      } else {
        session = sessions[0]; // most recent
      }
      if (!session) return { id, error: "No matching session found" };

      // Save current state first
      await saveSession("before-restore");

      const created = [];
      for (const win of session.windows) {
        // Filter out chrome:// and chrome-extension:// URLs which can't be opened programmatically
        const urls = win.tabs.map(t => t.url).filter(u => u && !u.startsWith("chrome://") && !u.startsWith("chrome-extension://"));
        if (urls.length === 0) continue;
        try {
          const newWin = await chrome.windows.create({ url: urls[0], state: win.state || "normal" });
          // Open remaining tabs in this window
          for (let i = 1; i < urls.length; i++) {
            await chrome.tabs.create({ windowId: newWin.id, url: urls[i], active: false });
          }
          created.push({ windowId: newWin.id, tabCount: urls.length });
        } catch (e) {
          created.push({ error: e.message });
        }
      }
      await buildIndex();
      return { id, result: { restored: session.label, windows: created } };
    }

    /* ---------- Bookmarks queries ---------- */

    case "get_bookmarks": {
      try {
        const tree = await chrome.bookmarks.getTree();
        const flat = [];
        function walk(nodes) {
          for (const node of nodes) {
            if (node.url) {
              flat.push({ id: node.id, title: node.title || "", url: node.url, parentId: node.parentId });
            }
            if (node.children) walk(node.children);
          }
        }
        walk(tree);
        return { id, result: flat };
      } catch (e) {
        return { id, error: e.message };
      }
    }

    /* ---------- Content extraction ---------- */

    case "extract_content": {
      const targets = await resolveTargets(p.target || p.targets || "current");
      if (targets.length === 0) return { id, error: "No matching tab" };
      const content = await extractContent(targets[0].id);
      if (!content) return { id, error: "Could not extract content from this page" };
      return { id, result: content };
    }

    case "extract_tabs_content": {
      const targets = await resolveTargets(p.targets || "all");
      if (targets.length === 0) return { id, error: "No matching tabs" };
      const indexed = [];
      const failed = [];
      for (const tab of targets) {
        if (!shouldIndex(tab.url)) {
          failed.push({ id: tab.id, title: tab.title, reason: "restricted URL" });
          continue;
        }
        try {
          const content = await extractContent(tab.id);
          if (content && content.text) {
            indexed.push({ url: content.url, title: content.title, text: content.text });
          } else {
            failed.push({ id: tab.id, title: tab.title, reason: "could not extract content" });
          }
        } catch (e) {
          failed.push({ id: tab.id, title: tab.title, reason: e.message || "extraction error" });
        }
      }
      return { id, result: { indexed, failed } };
    }

    /* ---------- Utility ---------- */

    case "answer": {
      return { id, result: { text: p.text || "" } };
    }

    case "ping": {
      return { id, result: { pong: true, tabs: Object.keys(tabIndex).length, timestamp: Date.now() } };
    }

    default:
      return { id, error: "Unknown action: " + action };
  }
}
