/**
 * Layered decision tree for functiongemma and similar function-calling models.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  LAYER 1 — Action Group                                            │
 * │  "Which family does this command belong to?"                       │
 * │  close | open | navigate | organize | info | session | content     │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  LAYER 2 — Specific Action (varies per group)                      │
 * │  "Within that group, which exact action?"                          │
 * │  e.g. close → {close_tabs, close_all_except, close_duplicates}    │
 * │  e.g. organize → {pin, unpin, mute, unmute, group, bookmark, ...} │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  LAYER 3 — Parameters                                              │
 * │  "Which tabs / what value?"                                        │
 * │  Deterministic: domain filter, keyword match, positional, "all"    │
 * │  AI only for: content summarization                                │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * At every layer: try deterministic keyword match first → AI fallback.
 * Each AI call sees ONLY the options for that layer, nothing more.
 */

import { OllamaError } from './ollama.js';

// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const KNOWN_DOMAINS = [
  'github', 'youtube', 'google', 'stackoverflow', 'reddit',
  'twitter', 'facebook', 'linkedin', 'slack', 'notion',
  'figma', 'vercel', 'netlify', 'jira', 'confluence',
];

const URL_MAP = {
  github: 'https://github.com',
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  reddit: 'https://www.reddit.com',
  twitter: 'https://twitter.com',
  facebook: 'https://www.facebook.com',
  linkedin: 'https://www.linkedin.com',
  slack: 'https://slack.com',
  notion: 'https://www.notion.so',
  stackoverflow: 'https://stackoverflow.com',
  calendar: 'https://calendar.google.com',
  'hacker news': 'https://news.ycombinator.com',
};

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 1 — Action Group Classification
// ═══════════════════════════════════════════════════════════════════════════
//
//  Groups and their trigger keywords:
//    close     — close, remove, kill, delete, deduplicate
//    open      — open (+ URL/site), launch, visit
//    navigate  — switch to, go to, focus, activate
//    organize  — pin, unpin, mute, unmute, group, bookmark, reload,
//                refresh, duplicate, copy, discard, move
//    info      — what, which, show, list, tell, how many, count,
//                do I have, are there, find
//    session   — save session, restore, undo, history
//    content   — index, summarize, search content, read tab(s)

const L1_KEYWORDS = [
  // Order matters: more specific patterns first
  { group: 'content',  pattern: /\b(index\s+tab|summarize|summarise|search\s+content|read\s+(all\s+)?tab|page\s+content|what\s+is\s+this\s+page)\b/ },
  { group: 'session',  pattern: /\b(save\s+(this\s+|my\s+)?session|restore|undo|history|sessions?\b.*\b(list|show))\b/ },
  { group: 'close',    pattern: /\b(close|remove|kill|delete)\b/ },
  { group: 'organize', pattern: /\b(unpin|pin|unmute|mute|group|bookmark|reload|refresh|duplicate|copy\s+tab|discard|move\s+tab)\b/ },
  { group: 'navigate', pattern: /\b(switch\s+to|go\s+to|focus\s+on|activate)\b/ },
  { group: 'info',     pattern: /^(what|which|show|list|tell|how\s+many|count|do\s+i\s+have|are\s+there|find)\b/ },
  { group: 'info',     pattern: /\bhow\s+many\b/ },
  // "open" is checked last because "what tabs do I have open" is info, not open
  { group: 'open',     pattern: /\bopen\b/ },
];

/** AI tools for Layer 1 fallback */
function aiTool(name, description) {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties: {} } },
  };
}

const L1_AI_TOOLS = [
  aiTool('close',    'Close, remove, kill, delete, or deduplicate tabs'),
  aiTool('open',     'Launch a new website URL or create blank tabs'),
  aiTool('navigate', 'Switch to, go to, focus, or activate an existing tab'),
  aiTool('organize', 'Pin, unpin, group, mute, unmute, bookmark, reload, or duplicate tabs'),
  aiTool('info',     'List, show, count, find tabs. Answer a question.'),
  aiTool('session',  'Save or restore sessions. Restore closed tabs. Show history.'),
  aiTool('content',  'Index tab pages, summarize a page, search page content.'),
];

function resolveL1(cmd) {
  // "open" is ambiguous: "open github.com" = open, but "what tabs do I have open" = info
  // The L1_KEYWORDS list checks info patterns BEFORE the open pattern.
  // Additionally, guard "open" to require a URL/site or "new tab"/"blank"
  for (const { group, pattern } of L1_KEYWORDS) {
    if (pattern.test(cmd)) {
      if (group === 'open') {
        const hasUrl = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/.test(cmd);
        const hasSite = Object.keys(URL_MAP).some(s => cmd.includes(s));
        if (hasUrl || hasSite || /\bnew\s+tab|\bblank\b/.test(cmd)) return 'open';
        return null; // ambiguous "open" — AI needed
      }
      return group;
    }
  }
  return null; // no keyword match — AI needed
}

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 2 — Specific Action Selection (per group)
// ═══════════════════════════════════════════════════════════════════════════
//
//  Each group defines:
//    keywords  — deterministic resolution rules (tried first)
//    aiTools   — AI fallback tool set (only shown if keywords fail)
//    default   — fallback action if AI also fails

// ── CLOSE group ─────────────────────────────────────────────────────────

const L2_CLOSE = {
  keywords: [
    { action: 'close_duplicates', pattern: /\bduplic|dedup/ },
    { action: 'close_all_except', pattern: /\b(except|but not|but keep|all\s+but|everything\s+except)\b/ },
    { action: 'close_tabs',       pattern: /.*/ },  // default
  ],
  aiTools: [
    aiTool('close_tabs',       'Close specific tabs'),
    aiTool('close_all_except', 'Close ALL tabs EXCEPT certain ones'),
    aiTool('close_duplicates', 'Close duplicate tabs with same URL'),
  ],
};

// ── OPEN group ──────────────────────────────────────────────────────────

const L2_OPEN = {
  keywords: [
    { action: 'open_urls',     pattern: /\band\b.*\band\b|\bmultiple\b|\bseveral\b/ },  // 3+ sites
    { action: 'open_new_tabs', pattern: /\bnew\s+tab|\bblank\b|\b\d+\s+tabs?\b/ },
    { action: 'open_url',      pattern: /.*/ },  // default
  ],
  aiTools: [
    aiTool('open_url',      'Open one website URL'),
    aiTool('open_urls',     'Open multiple website URLs'),
    aiTool('open_new_tabs', 'Open blank new tabs'),
  ],
};

// ── NAVIGATE group ──────────────────────────────────────────────────────

const L2_NAVIGATE = {
  keywords: [
    { action: 'activate_tab', pattern: /.*/ },  // only one action
  ],
};

// ── ORGANIZE group ──────────────────────────────────────────────────────

const L2_ORGANIZE = {
  keywords: [
    // Check negation forms (un-) first
    { action: 'unpin_tabs',   pattern: /\bunpin\b/ },
    { action: 'unmute_tabs',  pattern: /\bunmute\b/ },
    // Then positive forms
    { action: 'pin_tabs',     pattern: /\bpin\b/ },
    { action: 'mute_tabs',    pattern: /\bmute\b/ },
    { action: 'group_tabs',   pattern: /\bgroup\b/ },
    { action: 'bookmark_tabs', pattern: /\bbookmark\b/ },
    { action: 'reload_tabs',  pattern: /\breload|\brefresh\b/ },
    { action: 'duplicate_tab', pattern: /\bduplicate|\bcopy\s+tab\b/ },
    { action: 'discard_tabs', pattern: /\bdiscard\b/ },
    { action: 'move_tab',     pattern: /\bmove\b/ },
  ],
  aiTools: [
    aiTool('pin_tabs',     'Pin tabs'),
    aiTool('unpin_tabs',   'Unpin tabs'),
    aiTool('mute_tabs',    'Mute tabs'),
    aiTool('unmute_tabs',  'Unmute tabs'),
    aiTool('group_tabs',   'Group tabs by domain'),
    aiTool('bookmark_tabs', 'Bookmark tabs'),
    aiTool('reload_tabs',  'Reload or refresh tabs'),
    aiTool('duplicate_tab', 'Duplicate a tab'),
    aiTool('discard_tabs', 'Discard tabs to save memory'),
    aiTool('move_tab',     'Move a tab to another window'),
  ],
};

// ── INFO group ──────────────────────────────────────────────────────────
// Entirely code-resolved. No sub-action AI.

const L2_INFO = {
  keywords: [
    { action: 'answer', pattern: /.*/ },  // all info → code-generated answer
  ],
};

// ── SESSION group ───────────────────────────────────────────────────────

const L2_SESSION = {
  keywords: [
    { action: 'save_session',       pattern: /\bsave\b/ },
    { action: 'search_history',     pattern: /\bsearch\b.*\bhistory\b/ },
    { action: 'list_history',       pattern: /\bhistory\b/ },
    { action: 'list_sessions',      pattern: /\bsessions?\b.*\b(list|show)\b|\b(list|show)\b.*\bsessions?\b/ },
    { action: 'restore_session',    pattern: /\brestore\b.*\bsession\b|\bsession\b.*\brestore\b/ },
    { action: 'restore_last_closed', pattern: /\brestore|\bundo\b/ },
  ],
  aiTools: [
    aiTool('save_session',        'Save current browser session'),
    aiTool('restore_last_closed', 'Restore recently closed tabs'),
    aiTool('restore_session',     'Restore a saved session'),
    aiTool('list_sessions',       'List saved sessions'),
    aiTool('list_history',        'Show closed tab history'),
  ],
};

// ── CONTENT group (RAG) ─────────────────────────────────────────────────

const L2_CONTENT = {
  keywords: [
    { action: 'summarize_tab',   pattern: /\bsummar/ },
    { action: 'search_content',  pattern: /\bsearch\b|\bfind\b.*\bcontent\b|\bwhat.*talk|which.*about\b/ },
    { action: 'index_tabs',      pattern: /\bindex|\bread\b.*\btab|\bload\b.*\bcontent\b/ },
    { action: 'open_from_search', pattern: /\bopen\b.*\b(about|content|talk)\b/ },
  ],
  aiTools: [
    aiTool('index_tabs',       'Index tab pages for content search'),
    aiTool('summarize_tab',    'Summarize a page'),
    aiTool('search_content',   'Search through indexed page content'),
    aiTool('open_from_search', 'Open a page matching content search'),
  ],
};

const L2_MAP = {
  close:    L2_CLOSE,
  open:     L2_OPEN,
  navigate: L2_NAVIGATE,
  organize: L2_ORGANIZE,
  info:     L2_INFO,
  session:  L2_SESSION,
  content:  L2_CONTENT,
};

function resolveL2(group, cmd) {
  const spec = L2_MAP[group];
  if (!spec) return null;
  for (const { action, pattern } of spec.keywords) {
    if (pattern.test(cmd)) return action;
  }
  return null; // AI needed for this layer
}

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 3 — Parameter Resolution (deterministic)
// ═══════════════════════════════════════════════════════════════════════════
//
//  Given a specific action + command + tabs, produce the final params.
//  This is always code — no AI — except for content.summarize_tab
//  where AI generates the summary text (handled by the bridge, not here).

function resolveL3(action, cmd, command, tabs) {
  switch (action) {
    // ── Close ─────────────────────────────────────────────────────────
    case 'close_tabs':
      return resolveCloseTargets(cmd, tabs);

    case 'close_all_except':
      return resolveKeepTargets(cmd, tabs);

    case 'close_duplicates':
      return { action: 'close_duplicates', keep: 'first' };

    // ── Open ──────────────────────────────────────────────────────────
    case 'open_url':
      return resolveOpenUrl(cmd);

    case 'open_urls':
      return resolveOpenUrls(cmd);

    case 'open_new_tabs':
      return resolveOpenNewTabs(cmd);

    // ── Navigate ──────────────────────────────────────────────────────
    case 'activate_tab':
      return resolveNavTarget(cmd, tabs);

    // ── Organize (singular target) ────────────────────────────────────
    case 'duplicate_tab':
      return { action: 'duplicate_tab', target: findActiveSeqId(tabs) };

    case 'move_tab':
      return { action: 'move_tab', target: findActiveSeqId(tabs) };

    // ── Organize (multi-target) ───────────────────────────────────────
    case 'pin_tabs':
    case 'unpin_tabs':
    case 'mute_tabs':
    case 'unmute_tabs':
    case 'bookmark_tabs':
    case 'reload_tabs':
    case 'discard_tabs':
      return { action, targets: resolveTargets(cmd, tabs) };

    case 'group_tabs':
      return { action: 'group_tabs', targets: allSeqIds(tabs), by: 'domain' };

    // ── Info ──────────────────────────────────────────────────────────
    case 'answer':
      return buildInfoAnswer(command, tabs);

    // ── Session ───────────────────────────────────────────────────────
    case 'save_session': {
      const m = cmd.match(/(?:as|named?|called?)\s+"?([^"]+)"?/i);
      return { action: 'save_session', label: m ? m[1].trim() : 'manual' };
    }

    case 'restore_last_closed': {
      const m = cmd.match(/(?:last\s+)?(\d+)\s+(?:closed\s+)?tabs?/);
      return { action: 'restore_last_closed', count: m ? parseInt(m[1], 10) : 1 };
    }

    case 'restore_session': {
      const m = cmd.match(/session\s+"?([^"]+)"?/i);
      return m
        ? { action: 'restore_session', label: m[1].trim() }
        : { action: 'restore_session', index: 0 };
    }

    case 'list_sessions':
      return { action: 'list_sessions' };

    case 'list_history':
      return { action: 'list_history' };

    case 'search_history': {
      const terms = extractSearchTerms(cmd, ['search', 'history', 'find', 'in']);
      return { action: 'search_history', query: terms };
    }

    // ── Content (RAG) ─────────────────────────────────────────────────
    // summarize_tab: the actual summarization is done by the bridge/Ollama,
    // not here. We just tell it which tab.
    case 'summarize_tab': {
      const tabRef = /\btab\s+(\d+)\b/.test(cmd) ? parseInt(cmd.match(/\btab\s+(\d+)/)[1], 10) : 'current';
      return { action: 'summarize_tab', target: tabRef };
    }

    case 'index_tabs': {
      const isAll = /\ball\b/.test(cmd);
      return { action: 'index_tabs', targets: isAll ? 'all' : resolveTargets(cmd, tabs) };
    }

    case 'search_content': {
      const terms = extractSearchTerms(cmd, ['search', 'content', 'find', 'about', 'pages', 'tabs', 'page']);
      return { action: 'search_content', query: terms };
    }

    case 'open_from_search': {
      const terms = extractSearchTerms(cmd, ['open', 'go', 'to', 'switch', 'about', 'content', 'page', 'that', 'talks']);
      const all = /\ball\b/.test(cmd);
      return { action: 'open_from_search', query: terms, all };
    }

    default:
      return { action, ...({}) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 3 HELPERS — Target & parameter resolution
// ═══════════════════════════════════════════════════════════════════════════

function resolveCloseTargets(cmd, tabs) {
  const domain = findDomain(cmd);
  if (domain) {
    const m = tabsMatchingDomain(tabs, domain);
    if (m.length > 0) return { action: 'close_tabs', targets: m, reason: `Close ${domain} tabs` };
  }
  const kw = extractKeywords(cmd, ['close', 'remove', 'kill', 'delete', 'tab', 'tabs', 'all', 'the', 'my', 'please']);
  if (kw.length > 0) {
    const m = tabsMatchingKeywords(tabs, kw);
    if (m.length > 0) return { action: 'close_tabs', targets: m, reason: 'Close matching tabs' };
  }
  return { action: 'close_tabs', targets: allSeqIds(tabs) };
}

function resolveKeepTargets(cmd, tabs) {
  const after = cmd.match(/(?:except|but not|but keep|but)\s+(.+)/i);
  if (after) {
    const phrase = after[1].replace(/\btabs?\b/gi, '').trim();
    const domain = KNOWN_DOMAINS.find(d => phrase.includes(d));
    if (domain) return { action: 'close_all_except', keep: tabsMatchingDomain(tabs, domain) };
    const kw = phrase.split(/\s+/).filter(w => w.length > 1);
    if (kw.length > 0) {
      const m = tabsMatchingKeywords(tabs, kw);
      if (m.length > 0) return { action: 'close_all_except', keep: m };
    }
  }
  return { action: 'close_all_except', keep: [] };
}

function resolveOpenUrl(cmd) {
  for (const [name, url] of Object.entries(URL_MAP)) {
    if (cmd.includes(name)) return { action: 'open_url', url };
  }
  const m = cmd.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z]{2,})+(?:\/\S*)?)/i);
  if (m) {
    const url = m[0].startsWith('http') ? m[0] : `https://${m[0]}`;
    return { action: 'open_url', url };
  }
  return { action: 'open_new_tabs', count: 1 };
}

function resolveOpenUrls(cmd) {
  const urls = [];
  for (const [name, url] of Object.entries(URL_MAP)) {
    if (cmd.includes(name)) urls.push(url);
  }
  return urls.length > 0
    ? { action: 'open_urls', urls }
    : { action: 'open_new_tabs', count: 1 };
}

function resolveOpenNewTabs(cmd) {
  const m = cmd.match(/(\d+)\s*(?:new\s+)?tabs?/);
  return { action: 'open_new_tabs', count: m ? parseInt(m[1], 10) : 1 };
}

function resolveNavTarget(cmd, tabs) {
  const domain = findDomain(cmd);
  if (domain) {
    const m = tabsMatchingDomain(tabs, domain);
    if (m.length > 0) return { action: 'activate_tab', target: m[0] };
  }
  const kw = extractKeywords(cmd, ['switch', 'go', 'to', 'focus', 'on', 'activate', 'tab', 'the', 'my']);
  if (kw.length > 0) {
    const m = tabsMatchingKeywords(tabs, kw);
    if (m.length > 0) return { action: 'activate_tab', target: m[0] };
  }
  const posMap = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: tabs.length };
  for (const [word, pos] of Object.entries(posMap)) {
    if (cmd.includes(word)) return { action: 'activate_tab', target: Math.min(pos, tabs.length) };
  }
  return { action: 'activate_tab', target: findActiveSeqId(tabs) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function allSeqIds(tabs)       { return tabs.map((_, i) => i + 1); }
function findActiveSeqId(tabs) { const i = tabs.findIndex(t => t.active); return i >= 0 ? i + 1 : 1; }

function findDomain(cmd) {
  return KNOWN_DOMAINS.find(d => cmd.includes(d)) || null;
}

function tabsMatchingDomain(tabs, domain) {
  return tabs
    .map((t, i) => ({ t, seq: i + 1 }))
    .filter(({ t }) => ((t.title || '') + ' ' + (t.url || '')).toLowerCase().includes(domain))
    .map(({ seq }) => seq);
}

function tabsMatchingKeywords(tabs, keywords) {
  return tabs
    .map((t, i) => ({ t, seq: i + 1 }))
    .filter(({ t }) => {
      const hay = ((t.title || '') + ' ' + (t.url || '')).toLowerCase();
      return keywords.some(kw => hay.includes(kw));
    })
    .map(({ seq }) => seq);
}

function resolveTargets(cmd, tabs) {
  const domain = findDomain(cmd);
  if (domain) { const m = tabsMatchingDomain(tabs, domain); if (m.length > 0) return m; }
  if (/\ball\b/.test(cmd)) return allSeqIds(tabs);
  const kw = extractKeywords(cmd, [
    'pin', 'unpin', 'mute', 'unmute', 'bookmark', 'reload', 'refresh',
    'tab', 'tabs', 'all', 'the', 'my', 'please', 'every',
  ]);
  if (kw.length > 0) { const m = tabsMatchingKeywords(tabs, kw); if (m.length > 0) return m; }
  return allSeqIds(tabs);
}

function extractKeywords(cmd, stopWords) {
  const stop = new Set([
    'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
    'do', 'i', 'have', 'it', 'this', 'that', 'and', 'or', 'but',
    ...(stopWords || []),
  ]);
  return cmd.split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(w => w.length > 1 && !stop.has(w));
}

function extractSearchTerms(cmd, stopWords) {
  return extractKeywords(cmd, stopWords).join(' ');
}

function buildInfoAnswer(command, tabs) {
  const cmd = command.toLowerCase();
  if (/how many|count|number of/i.test(cmd)) {
    return { action: 'answer', text: `You have ${tabs.length} tabs open.` };
  }
  const domain = findDomain(cmd);
  if (domain) {
    const matching = tabs.filter(t => ((t.title || '') + ' ' + (t.url || '')).toLowerCase().includes(domain));
    if (matching.length === 0) return { action: 'answer', text: `No ${domain} tabs found.` };
    const list = matching.slice(0, 30).map(t => `  ${t.title || 'Untitled'} | ${safeHost(t.url)}`).join('\n');
    return { action: 'answer', text: `${matching.length} ${domain} tab${matching.length !== 1 ? 's' : ''}:\n${list}` };
  }
  const list = tabs.slice(0, 30).map(t => `  ${t.title || 'Untitled'} | ${safeHost(t.url)}`).join('\n');
  return { action: 'answer', text: `${tabs.length} tabs open:\n${list}` };
}

function safeHost(url) {
  if (!url) return '?';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 40); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AI FALLBACK — called only when keywords can't resolve a layer
// ═══════════════════════════════════════════════════════════════════════════

async function aiPickTool(config, systemMsg, userMsg, tools, debug, label) {
  const url = `${config.ollamaUrl}/api/chat`;
  const body = {
    model: config.model,
    stream: false,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg },
    ],
    tools,
    options: { temperature: 1.0, top_k: 64, top_p: 0.95 },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new OllamaError(`Cannot reach Ollama: ${err.message}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OllamaError(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  if (debug && data.eval_count) log(`  ${label} tokens: ${data.eval_count} eval`);

  // Native tool_calls
  const tc = data.message?.tool_calls;
  if (tc && tc.length > 0) return tc[0].function.name;

  // Fallback: parse content
  const content = (data.message?.content || '').trim();
  if (content) {
    try {
      const obj = JSON.parse(content);
      if (obj.name) return obj.name;
      if (obj.action) return obj.action;
    } catch {
      for (const t of tools) {
        if (content.includes(t.function.name)) return t.function.name;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Layered decision tree for functiongemma.
 * Same interface as queryOllama — returns an action object.
 */
export async function queryFunctiongemma({ command, tabsFormatted, config, history, tabs }) {
  const debug = config.debug;
  tabs = tabs || [];
  const cmd = command.toLowerCase();

  // ── LAYER 1: Determine action group ─────────────────────────────────
  let group = resolveL1(cmd);
  if (debug) log(`L1 keyword → ${group ?? '(none)'}`);

  if (!group) {
    group = await aiPickTool(
      config,
      'Pick the ONE function that matches the user command.',
      command,  // just the command, no tabs — keep it short
      L1_AI_TOOLS,
      debug, 'L1',
    );
    if (debug) log(`L1 AI → ${group ?? '(none)'}`);
  }
  if (!group) return buildInfoAnswer(command, tabs);

  // ── LAYER 2: Determine specific action ──────────────────────────────
  let action = resolveL2(group, cmd);
  if (debug) log(`L2 keyword (${group}) → ${action ?? '(none)'}`);

  if (!action) {
    const spec = L2_MAP[group];
    if (spec?.aiTools) {
      action = await aiPickTool(
        config,
        `The user wants to ${group} tabs. Pick the specific action.`,
        command,
        spec.aiTools,
        debug, 'L2',
      );
      if (debug) log(`L2 AI → ${action ?? '(none)'}`);
    }
  }
  if (!action) return buildInfoAnswer(command, tabs);

  // ── LAYER 3: Resolve parameters ─────────────────────────────────────
  const result = resolveL3(action, cmd, command, tabs);
  if (debug) log('L3 →', JSON.stringify(result));

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════

function log(...args) {
  console.log('\x1b[36m[layers]\x1b[0m', ...args);
}
