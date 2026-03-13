/**
 * Multi-stage LLM pipeline: classify → resolve → emit
 *
 * Most commands are handled client-side with 0 LLM calls.
 * Ambiguous commands use 1-2 small, focused LLM calls.
 */

import { classifyIntent, emitAction, queryOllama, OllamaError } from './ollama.js';
import { formatTabs, remapActionIds } from './format.js';

// ── Stage 1: Client-side intent shortcuts ────────────────────────────────────

const SHORTCUT_PATTERNS = [
  { pattern: /^how many\b|count\s.*tab|number of\s.*tab/i, intent: 'count' },
  { pattern: /^(what|which|show|list|tell)\b.*tabs?/i, intent: 'list_tabs' },
  { pattern: /^close\b|^kill\b|^remove\b/i, intent: 'mutate_close' },
  { pattern: /^(go\s+to|switch\s+to|focus|activate)\b/i, intent: 'navigate' },
  { pattern: /^open\s+(https?:\/\/)/i, intent: 'open_url' },
  { pattern: /^(pin|unpin|group|bookmark|mute|unmute)\b/i, intent: 'organize' },
  { pattern: /\b(restore|history|session|undo)\b/i, intent: 'session' },
  { pattern: /\b(summarize|index|search\s+content)\b/i, intent: 'content' },
];

/**
 * Try to classify the command using regex patterns alone.
 * @returns {{ intent: string, topic: string, specifics: string } | null}
 */
function classifyClientSide(command) {
  const cmd = command.toLowerCase();

  for (const { pattern, intent } of SHORTCUT_PATTERNS) {
    if (pattern.test(cmd)) {
      const topic = extractTopic(cmd);
      const specifics = extractSpecifics(cmd, intent);
      return { intent, topic, specifics };
    }
  }
  return null;
}

// ── Topic & specifics extraction ─────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'my', 'all', 'every', 'any', 'some', 'that', 'this',
  'those', 'these', 'tabs', 'tab', 'please', 'can', 'you', 'i', 'me',
  'do', 'have', 'open', 'with', 'about', 'for', 'in', 'on', 'is', 'are',
  'there', 'how', 'many', 'what', 'which', 'show', 'list', 'tell',
  'close', 'kill', 'remove', 'go', 'to', 'switch', 'focus', 'activate',
  'pin', 'unpin', 'group', 'bookmark', 'mute', 'unmute', 'reload',
  'discard', 'duplicate', 'move', 'save', 'restore', 'search', 'find',
  'summarize', 'index', 'content', 'of', 'by', 'number', 'count',
]);

const DOMAIN_KEYWORDS = [
  'github', 'youtube', 'google', 'stackoverflow', 'reddit', 'twitter',
  'facebook', 'linkedin', 'slack', 'notion', 'figma', 'vercel', 'netlify',
  'npm', 'wikipedia', 'amazon', 'netflix', 'spotify', 'discord', 'medium',
];

function extractTopic(cmd) {
  // Check for known domain keywords first
  const domain = DOMAIN_KEYWORDS.find(d => cmd.includes(d));
  if (domain) return domain;

  // Extract remaining meaningful words
  const words = cmd.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return words.join(' ') || '';
}

function extractSpecifics(cmd, intent) {
  if (intent === 'mutate_close') {
    if (/\bduplicate/i.test(cmd)) return 'close_duplicates';
    if (/\b(everything|all)\s+(except|but)\b/i.test(cmd)) return 'close_all_except';
    return 'close';
  }
  if (intent === 'organize') {
    if (/^pin\b/i.test(cmd)) return 'pin';
    if (/^unpin\b/i.test(cmd)) return 'unpin';
    if (/^group\b/i.test(cmd)) return 'group';
    if (/^bookmark\b/i.test(cmd)) return 'bookmark';
    if (/^mute\b/i.test(cmd)) return 'mute';
    if (/^unmute\b/i.test(cmd)) return 'unmute';
  }
  if (intent === 'navigate') {
    const urlMatch = cmd.match(/https?:\/\/\S+/);
    if (urlMatch) return `url:${urlMatch[0]}`;
  }
  if (intent === 'open_url') {
    const urlMatch = cmd.match(/(https?:\/\/\S+)/);
    if (urlMatch) return `url:${urlMatch[1]}`;
  }
  if (intent === 'session') {
    if (/\brestore\b.*\b(last|recent)\b.*\bclosed\b/i.test(cmd)) return 'restore_last_closed';
    if (/\brestore\b.*\bsession\b/i.test(cmd)) return 'restore_session';
    if (/\bsave\b.*\bsession\b/i.test(cmd)) return 'save_session';
    if (/\blist\b.*\bsession/i.test(cmd)) return 'list_sessions';
    if (/\blist\b.*\bhistory/i.test(cmd) || /\bhistory\b/i.test(cmd)) return 'list_history';
    if (/\brestore\b/i.test(cmd)) return 'restore_last_closed';
    if (/\bundo\b/i.test(cmd)) return 'restore_last_closed';
  }
  if (intent === 'content') {
    if (/\bsummarize\b/i.test(cmd)) return 'summarize';
    if (/\bindex\b/i.test(cmd)) return 'index';
    if (/\bsearch\s+content\b/i.test(cmd)) return 'search_content';
  }
  return '';
}

// ── Stage 2: Target resolution ───────────────────────────────────────────────

const POSITIONAL_MAP = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4,
  sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9,
  last: -1, previous: -1, prev: -1,
};

/**
 * Resolve which tabs the command targets.
 * Works with real Chrome tab IDs directly.
 *
 * @param {object} classification - { intent, topic, specifics }
 * @param {string} command - original command text
 * @param {Array} tabs - array of tab objects from bridge
 * @returns {{ matched: Array, method: string }}
 */
function resolveTargets(classification, command, tabs) {
  const { intent, topic } = classification;
  const cmd = command.toLowerCase();

  // Positional resolution: "first tab", "last tab", etc.
  const posMatch = cmd.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|previous|prev)\b/i);
  if (posMatch && (intent === 'navigate' || intent === 'mutate_close')) {
    const pos = POSITIONAL_MAP[posMatch[1].toLowerCase()];
    const idx = pos === -1 ? tabs.length - 1 : pos;
    if (idx >= 0 && idx < tabs.length) {
      return { matched: [tabs[idx]], method: 'positional' };
    }
  }

  // "all tabs" / no topic → all tabs
  if (!topic || /\ball\b/i.test(cmd) && !topic) {
    return { matched: tabs, method: 'all' };
  }

  // Domain/keyword match
  const matched = tabs.filter(t => {
    const haystack = ((t.title || '') + ' ' + (t.url || '')).toLowerCase();
    return haystack.includes(topic);
  });

  if (matched.length > 0) {
    return { matched, method: 'keyword' };
  }

  return { matched: [], method: 'none' };
}

/**
 * RAG fallback when client-side matching finds 0 tabs.
 */
async function tryRAGFallback(topic, tabs, config) {
  if (!topic) return [];
  try {
    const res = await fetch(`${config.bridgeUrl}/rag/search?q=${encodeURIComponent(topic)}&limit=5`);
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) return [];

    // Match RAG results back to open tabs by URL
    const tabUrls = new Map(tabs.map(t => [t.url, t]));
    const matched = [];
    for (const r of results) {
      const tab = tabUrls.get(r.url);
      if (tab) matched.push(tab);
    }
    return matched;
  } catch {
    return [];
  }
}

// ── Stage 3: Action construction ─────────────────────────────────────────────

/**
 * Build action JSON deterministically from classification + resolved targets.
 * @returns {object|null} Action object, or null if LLM emission is needed
 */
function buildAction(classification, targets, command, tabs) {
  const { intent, specifics, topic } = classification;
  const ids = targets.matched.map(t => t.id);
  const cmd = command.toLowerCase();

  switch (intent) {
    case 'count': {
      const label = topic ? `${topic} ` : '';
      const count = targets.matched.length;
      // If topic was specified, use matched count; otherwise use all tabs
      const n = topic ? count : tabs.length;
      return { action: 'answer', text: `You have ${n} ${label}tab${n !== 1 ? 's' : ''} open.` };
    }

    case 'list_tabs': {
      const label = topic ? `${topic} ` : '';
      const matching = topic ? targets.matched : tabs;
      if (matching.length === 0) {
        return { action: 'answer', text: `No ${label}tabs found.` };
      }
      const list = matching.slice(0, 30).map(t => {
        const domain = extractDomainFromUrl(t.url);
        return `  ${t.title || 'Untitled'} | ${domain}`;
      }).join('\n');
      return { action: 'answer', text: `${matching.length} ${label}tab${matching.length !== 1 ? 's' : ''} open:\n${list}` };
    }

    case 'mutate_close': {
      if (specifics === 'close_duplicates') {
        return { action: 'close_duplicates', keep: 'first' };
      }
      if (specifics === 'close_all_except') {
        // "close all except X" — keep X tabs, close the rest
        return { action: 'close_all_except', keep: ids };
      }
      // Normal close
      if (ids.length === 0 && topic) {
        return { action: 'answer', text: `No ${topic} tabs found to close.` };
      }
      if (ids.length === 0) {
        return null; // Ambiguous — let LLM decide
      }
      return { action: 'close_tabs', targets: ids, reason: `Close ${topic || 'selected'} tabs` };
    }

    case 'navigate': {
      if (specifics.startsWith('url:')) {
        const url = specifics.slice(4);
        // Check if this URL is already open
        const existing = tabs.find(t => t.url && t.url.startsWith(url));
        if (existing) return { action: 'activate_tab', target: existing.id };
        return { action: 'open_url', url };
      }
      if (targets.matched.length === 1) {
        return { action: 'activate_tab', target: targets.matched[0].id };
      }
      if (targets.matched.length > 1) {
        // Activate the first match
        return { action: 'activate_tab', target: targets.matched[0].id };
      }
      if (topic) {
        return { action: 'answer', text: `No matching tab found for "${topic}".` };
      }
      return null; // Let LLM handle
    }

    case 'open_url': {
      if (specifics.startsWith('url:')) {
        return { action: 'open_url', url: specifics.slice(4) };
      }
      return null;
    }

    case 'organize': {
      if (ids.length === 0 && topic) {
        return { action: 'answer', text: `No ${topic} tabs found.` };
      }
      const targetIds = ids.length > 0 ? ids : tabs.map(t => t.id);
      switch (specifics) {
        case 'pin': return { action: 'pin_tabs', targets: targetIds };
        case 'unpin': return { action: 'unpin_tabs', targets: targetIds };
        case 'mute': return { action: 'mute_tabs', targets: targetIds };
        case 'unmute': return { action: 'unmute_tabs', targets: targetIds };
        case 'bookmark': return { action: 'bookmark_tabs', targets: targetIds };
        case 'group': {
          const byMatch = cmd.match(/\bby\s+(\w+)/i);
          const by = byMatch ? byMatch[1] : 'domain';
          return { action: 'group_tabs', targets: targetIds, by };
        }
        default: return null;
      }
    }

    case 'session': {
      switch (specifics) {
        case 'restore_last_closed': {
          const countMatch = cmd.match(/\b(\d+)\b/);
          const count = countMatch ? parseInt(countMatch[1], 10) : 1;
          return { action: 'restore_last_closed', count };
        }
        case 'restore_session': {
          const labelMatch = cmd.match(/session\s+["']?([^"']+)["']?/i);
          if (labelMatch) return { action: 'restore_session', label: labelMatch[1].trim() };
          return { action: 'restore_session', index: 0 };
        }
        case 'save_session': {
          const labelMatch = cmd.match(/(?:as|named?|called?)\s+["']?([^"']+)["']?/i);
          const label = labelMatch ? labelMatch[1].trim() : 'manual';
          return { action: 'save_session', label };
        }
        case 'list_sessions': return { action: 'list_sessions' };
        case 'list_history': return { action: 'list_history' };
        default: return null;
      }
    }

    case 'content': {
      switch (specifics) {
        case 'summarize': {
          if (targets.matched.length === 1) {
            return { action: 'summarize_tab', target: targets.matched[0].id };
          }
          return { action: 'summarize_tab', target: 'current' };
        }
        case 'index': {
          if (ids.length > 0 && topic) {
            return { action: 'index_tabs', targets: ids };
          }
          return { action: 'index_tabs', targets: 'all' };
        }
        case 'search_content': {
          const searchTopic = topic || cmd.replace(/search\s+content\s*/i, '').trim();
          return { action: 'search_content', query: searchTopic };
        }
        default: return null;
      }
    }

    default:
      return null;
  }
}

// ── Safety nets (kept from original validation) ──────────────────────────────

/**
 * activate_tab relevance check — ensure the target tab actually matches the query.
 */
function validateActivateTab(action, command, tabs) {
  if (action.action !== 'activate_tab') return action;

  const cmd = command.toLowerCase();
  const relevanceStopWords = new Set([
    'open', 'switch', 'go', 'to', 'focus', 'activate', 'the', 'tab', 'with',
    'about', 'a', 'my', 'me', 'on', 'in', 'for',
    'first', 'second', 'third', 'fourth', 'fifth', 'last', 'next', 'previous', 'prev',
    '1st', '2nd', '3rd', '4th', '5th', 'number', 'num', 'no',
    'that', 'this', 'current', 'other', 'another', 'one', 'two', 'three',
  ]);
  const keywords = cmd.split(/\s+/).filter(w => w.length > 1 && !relevanceStopWords.has(w));
  const targetId = action.target ?? action.targets;
  const tab = tabs.find(t => t.id === targetId);
  if (tab && keywords.length > 0) {
    const haystack = ((tab.title || '') + ' ' + (tab.url || '')).toLowerCase();
    const matches = keywords.some(kw => haystack.includes(kw));
    if (!matches) {
      return { action: 'answer', text: 'No matching tab found for your query.' };
    }
  }
  return action;
}

// ── Pipeline orchestrator ────────────────────────────────────────────────────

/**
 * Run the full classify → resolve → emit pipeline.
 *
 * @param {object} params
 * @param {string} params.command - Natural language command
 * @param {Array}  params.tabs - Tab objects from bridge
 * @param {object} params.config - Merged config
 * @param {string} [params.historyContext] - Optional history/session context for LLM
 * @returns {Promise<object>} Action object ready for execution
 */
export async function runPipeline({ command, tabs, config, historyContext }) {
  const debug = config.debug;

  // ── Stage 1: Classify intent ────────────────────────────────────────────
  let classification = classifyClientSide(command);

  if (classification) {
    if (debug) {
      console.log('\x1b[35m\x1b[1m\n─── PIPELINE: Stage 1 (client-side shortcut) ───\x1b[0m');
      console.log('\x1b[35m  Intent: ' + classification.intent + '\x1b[0m');
      console.log('\x1b[35m  Topic: ' + (classification.topic || '(none)') + '\x1b[0m');
      console.log('\x1b[35m  Specifics: ' + (classification.specifics || '(none)') + '\x1b[0m');
    }
  } else {
    // No shortcut match — use LLM classification
    if (debug) {
      console.log('\x1b[35m\x1b[1m\n─── PIPELINE: Stage 1 (LLM classification) ───\x1b[0m');
    }
    try {
      classification = await classifyIntent({ command, config });
      if (debug) {
        console.log('\x1b[35m  LLM classified: ' + JSON.stringify(classification) + '\x1b[0m');
      }
    } catch (err) {
      // Classification failed — fall through to legacy queryOllama
      if (debug) {
        console.log('\x1b[35m  Classification failed: ' + err.message + ', falling back to legacy\x1b[0m');
      }
      return legacyFallback({ command, tabs, config, historyContext });
    }
  }

  // ── Stage 2: Resolve targets ────────────────────────────────────────────
  const targets = resolveTargets(classification, command, tabs);

  if (debug) {
    console.log('\x1b[35m\x1b[1m\n─── PIPELINE: Stage 2 (target resolution) ───\x1b[0m');
    console.log('\x1b[35m  Method: ' + targets.method + '\x1b[0m');
    console.log('\x1b[35m  Matched: ' + targets.matched.length + ' tabs\x1b[0m');
  }

  // RAG fallback when no tabs matched by title/URL
  if (targets.matched.length === 0 && classification.topic && classification.intent !== 'session') {
    if (debug) console.log('\x1b[35m  Trying RAG fallback...\x1b[0m');
    const ragMatches = await tryRAGFallback(classification.topic, tabs, config);
    if (ragMatches.length > 0) {
      targets.matched = ragMatches;
      targets.method = 'rag';
      if (debug) console.log('\x1b[35m  RAG matched: ' + ragMatches.length + ' tabs\x1b[0m');
    } else if (['mutate_close', 'navigate', 'organize'].includes(classification.intent)) {
      // For content-aware intents, try search_content instead
      if (classification.intent === 'navigate') {
        return { action: 'search_content', query: classification.topic };
      }
    }
  }

  // ── Stage 3: Emit action ────────────────────────────────────────────────
  let action = buildAction(classification, targets, command, tabs);

  if (action) {
    if (debug) {
      console.log('\x1b[35m\x1b[1m\n─── PIPELINE: Stage 3 (client-side construction) ───\x1b[0m');
      console.log('\x1b[35m  Action: ' + JSON.stringify(action) + '\x1b[0m');
    }
  } else {
    // Client-side couldn't determine action — use focused LLM emission
    if (debug) {
      console.log('\x1b[35m\x1b[1m\n─── PIPELINE: Stage 3 (LLM emission) ───\x1b[0m');
    }
    try {
      const { text: tabsFormatted, idMap } = formatTabs(tabs);
      action = await emitAction({
        classification,
        tabs,
        tabsFormatted,
        command,
        config,
        historyContext,
      });
      // Remap sequential IDs from LLM response
      action = remapActionIds(action, idMap);
      if (debug) {
        console.log('\x1b[35m  LLM emitted: ' + JSON.stringify(action) + '\x1b[0m');
      }
    } catch (err) {
      if (debug) {
        console.log('\x1b[35m  Emission failed: ' + err.message + ', falling back to legacy\x1b[0m');
      }
      return legacyFallback({ command, tabs, config, historyContext });
    }
  }

  // ── Safety nets ─────────────────────────────────────────────────────────
  action = validateActivateTab(action, command, tabs);

  return action;
}

/**
 * Fall back to the original monolithic queryOllama for edge cases.
 */
async function legacyFallback({ command, tabs, config, historyContext }) {
  if (config.debug) {
    console.log('\x1b[35m\x1b[1m\n─── PIPELINE: Legacy fallback (queryOllama) ───\x1b[0m');
  }
  const { text: tabsFormatted, idMap } = formatTabs(tabs);
  const action = await queryOllama({
    command,
    tabsFormatted,
    config,
    history: historyContext || undefined,
  });
  return remapActionIds(action, idMap);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDomainFromUrl(url) {
  if (!url) return '?';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}
