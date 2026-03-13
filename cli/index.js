#!/usr/bin/env node

import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { formatTabs, remapActionIds, formatHistory, formatSessions } from './format.js';
import { queryOllama, OllamaError } from './ollama.js';
import { executeAction, isDestructive, formatResult, BridgeError } from './actions.js';
import { showHistory, showSessions } from './history.js';

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2); // drop node + script
  const parsed = {
    command: '',
    yes: false,
    dryRun: false,
    debug: false,
    model: undefined,
    ollamaUrl: undefined,
    subcommand: null,
    full: false,
  };

  const positional = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '-y' || arg === '--yes' || arg === '--no-confirm') {
      parsed.yes = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--debug') {
      parsed.debug = true;
    } else if (arg === '--model') {
      i++;
      parsed.model = args[i];
    } else if (arg.startsWith('--model=')) {
      parsed.model = arg.split('=').slice(1).join('=');
    } else if (arg === '--ollama-url') {
      i++;
      parsed.ollamaUrl = args[i];
    } else if (arg.startsWith('--ollama-url=')) {
      parsed.ollamaUrl = arg.split('=').slice(1).join('=');
    } else if (arg === '--full') {
      parsed.full = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    } else {
      console.error(chalk.red(`Unknown flag: ${arg}`));
      process.exit(1);
    }

    i++;
  }

  // Detect subcommands
  if (positional[0] === 'history') {
    parsed.subcommand = 'history';
  } else if (positional[0] === 'sessions') {
    parsed.subcommand = 'sessions';
  } else {
    parsed.command = positional.join(' ');
  }

  return parsed;
}

function printUsage() {
  console.log(`
${chalk.bold('tabai')} — Control Chrome tabs with natural language

${chalk.bold('Usage:')}
  tabai <command>           Send a natural language command
  tabai history             Show last 20 closed tabs
  tabai sessions            List saved sessions
  tabai sessions --full     Show full tab list per session

${chalk.bold('Flags:')}
  -y, --yes, --no-confirm   Skip confirmation for destructive actions
  --dry-run                 Preview what would happen, don't execute
  --debug                   Show full LLM request/response and bridge calls
  --model <name>            Override the Ollama model
  --ollama-url <url>        Override the Ollama server URL
  -h, --help                Show this help message

${chalk.bold('Examples:')}
  tabai "close all youtube tabs"
  tabai "bookmark my research tabs"
  tabai "what tabs do I have open about react?"
  tabai "restore last closed tab"
  tabai -y "close duplicate tabs"
`);
}

// ── Confirmation prompt ──────────────────────────────────────────────────────

function confirm(message) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

// ── Preview helpers ──────────────────────────────────────────────────────────

function previewAction(action, tabs) {
  switch (action.action) {
    case 'close_tabs': {
      const targets = action.targets ?? [];
      const tabMap = new Map(tabs.map((t) => [t.id, t]));
      console.log(chalk.red.bold(`\nWill close ${targets.length} tab${targets.length !== 1 ? 's' : ''}:`));
      for (const id of targets) {
        const tab = tabMap.get(id);
        if (tab) {
          console.log(chalk.red(`  x ${tab.title ?? 'Untitled'} (${extractDomain(tab.url)})`));
        } else {
          console.log(chalk.red(`  x Tab ID ${id}`));
        }
      }
      if (action.reason) {
        console.log(chalk.red.dim(`\n  Reason: ${action.reason}`));
      }
      break;
    }

    case 'close_all_except': {
      const keep = new Set(action.keep ?? []);
      const closing = tabs.filter((t) => !keep.has(t.id));
      console.log(chalk.red.bold(`\nWill close ${closing.length} tab${closing.length !== 1 ? 's' : ''}, keeping ${keep.size}:`));
      for (const tab of closing) {
        console.log(chalk.red(`  x ${tab.title ?? 'Untitled'} (${extractDomain(tab.url)})`));
      }
      console.log(chalk.green.dim(`\n  Keeping:`));
      for (const tab of tabs.filter((t) => keep.has(t.id))) {
        console.log(chalk.green.dim(`  + ${tab.title ?? 'Untitled'}`));
      }
      break;
    }

    case 'close_duplicates':
      console.log(chalk.red.bold(`\nWill close duplicate tabs (keeping ${action.keep ?? 'first'} of each URL)`));
      break;

    case 'open_url':
      console.log(chalk.cyan(`\nWill open: ${action.url}`));
      break;

    case 'open_urls':
      console.log(chalk.cyan(`\nWill open ${action.urls?.length ?? 0} URLs:`));
      for (const url of action.urls ?? []) {
        console.log(chalk.cyan(`  + ${url}`));
      }
      break;

    case 'open_new_tabs':
      console.log(chalk.cyan(`\nWill open ${action.count ?? 1} new tab${(action.count ?? 1) !== 1 ? 's' : ''}`));
      break;

    case 'bookmark_tabs': {
      const n = action.targets?.length ?? 0;
      const folder = action.folder ? ` into "${action.folder}"` : '';
      console.log(chalk.cyan(`\nWill bookmark ${n} tab${n !== 1 ? 's' : ''}${folder}`));
      break;
    }

    case 'group_tabs':
      console.log(chalk.cyan(`\nWill group tabs by ${action.by ?? 'domain'}`));
      break;

    case 'mute_tabs':
      console.log(chalk.cyan(`\nWill mute ${action.targets?.length ?? 0} tabs`));
      break;

    case 'unmute_tabs':
      console.log(chalk.cyan(`\nWill unmute ${action.targets?.length ?? 0} tabs`));
      break;

    case 'pin_tabs':
      console.log(chalk.cyan(`\nWill pin ${action.targets?.length ?? 0} tabs`));
      break;

    case 'unpin_tabs':
      console.log(chalk.cyan(`\nWill unpin ${action.targets?.length ?? 0} tabs`));
      break;

    case 'duplicate_tab':
      console.log(chalk.cyan(`\nWill duplicate tab ${action.target}`));
      break;

    case 'move_tab':
      console.log(chalk.cyan(`\nWill move tab ${action.target} to window ${action.windowId}`));
      break;

    case 'activate_tab':
      console.log(chalk.cyan(`\nWill activate tab ${action.target}`));
      break;

    case 'reload_tabs':
      console.log(chalk.cyan(`\nWill reload ${action.targets?.length ?? 1} tab${(action.targets?.length ?? 1) !== 1 ? 's' : ''}`));
      break;

    case 'discard_tabs':
      console.log(chalk.cyan(`\nWill discard ${action.targets?.length ?? 0} tab${(action.targets?.length ?? 0) !== 1 ? 's' : ''}`));
      break;

    case 'save_session':
      console.log(chalk.cyan(`\nWill save current session as "${action.label ?? 'manual'}"`));
      break;

    case 'restore_last_closed':
      console.log(chalk.cyan(`\nWill restore ${action.count ?? 1} recently closed tab${(action.count ?? 1) !== 1 ? 's' : ''}`));
      break;

    case 'restore_session':
      console.log(chalk.cyan(`\nWill restore session "${action.label ?? action.index ?? '(most recent)'}"`));
      break;

    case 'index_tabs': {
      const t = action.targets;
      const desc = t === 'all' ? 'all tabs' : (Array.isArray(t) ? `${t.length} tab${t.length !== 1 ? 's' : ''}` : `tab ${t}`);
      console.log(chalk.cyan(`\nWill index ${desc} into RAG`));
      break;
    }

    case 'summarize_tab':
      console.log(chalk.cyan(`\nWill summarize tab ${action.target || 'current'}`));
      break;

    case 'search_content':
      console.log(chalk.cyan(`\nSearching indexed page content for "${action.query}"`));
      break;

    case 'open_from_search':
      console.log(chalk.cyan(`\nWill find and open ${action.all ? 'all pages' : 'a page'} matching "${action.query}"`));
      break;

    case 'answer':
      console.log(chalk.yellow(`\n${action.text}`));
      break;

    case 'search_tabs':
      console.log(chalk.yellow(`\nSearch results for "${action.query}"`));
      break;

    default:
      console.log(chalk.cyan(`\nWill execute: ${action.action}`));
  }
}

function extractDomain(url) {
  if (!url) return '?';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

// ── Domain keywords for client-side validation ───────────────────────────────
const DOMAIN_WORDS = ['github','youtube','google','stackoverflow','reddit','twitter','facebook','linkedin','slack','notion','figma','vercel','netlify'];

// ── Informational actions (no bridge call, just display) ─────────────────────

// Actions that only read data or provide a text answer — no confirmation needed
const INFORMATIONAL_ACTIONS = new Set([
  'answer',
  'search_tabs',
  'list_bookmarks',
  'list_history',
  'search_history',
  'list_sessions',
  'summarize_tab',
  'search_content',
]);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const parsed = parseArgs(process.argv);

  // Load config with CLI overrides
  const config = await loadConfig({ model: parsed.model, ollamaUrl: parsed.ollamaUrl, debug: parsed.debug || undefined });

  // ── Subcommands (no model call) ──────────────────────────────────────────
  if (parsed.subcommand === 'history') {
    await showHistory(config);
    return;
  }

  if (parsed.subcommand === 'sessions') {
    await showSessions(config, parsed.full);
    return;
  }

  // ── Require a command ────────────────────────────────────────────────────
  if (!parsed.command) {
    printUsage();
    process.exit(1);
  }

  // ── Step 1: Fetch tabs from the bridge ───────────────────────────────────
  let tabs;
  try {
    const res = await fetch(`${config.bridgeUrl}/tabs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tabs = Array.isArray(data) ? data : (data.tabs ?? []);
  } catch (err) {
    console.error(chalk.red('Chrome bridge not running. Is the extension loaded?'));
    process.exit(1);
  }

  // ── Step 2: Format tabs compactly (sequential IDs for the LLM) ──────────
  const { text: tabsFormatted, idMap } = formatTabs(tabs);

  if (config.debug) {
    console.log(chalk.magenta.bold('\n─── DEBUG: Tabs from bridge ───'));
    console.log(chalk.magenta(JSON.stringify(tabs, null, 2)));
    console.log(chalk.magenta.bold('\n─── DEBUG: Formatted tabs sent to LLM ───'));
    console.log(chalk.magenta(tabsFormatted));
    console.log(chalk.magenta.bold('\n─── DEBUG: ID map (sequential → Chrome) ───'));
    console.log(chalk.magenta(JSON.stringify(idMap)));
  }

  // ── Step 3: Fetch optional history context for relevant commands ─────────
  let historyContext = '';
  const lowerCmd = parsed.command.toLowerCase();
  if (
    lowerCmd.includes('restore') ||
    lowerCmd.includes('history') ||
    lowerCmd.includes('session') ||
    lowerCmd.includes('closed') ||
    lowerCmd.includes('undo')
  ) {
    try {
      const [histRes, sessRes] = await Promise.all([
        fetch(`${config.bridgeUrl}/history`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`${config.bridgeUrl}/sessions`).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);

      const histEntries = histRes
        ? (Array.isArray(histRes) ? histRes : (histRes.history ?? histRes.entries ?? [])).slice(0, 20)
        : [];
      const sessEntries = sessRes
        ? (Array.isArray(sessRes) ? sessRes : (sessRes.sessions ?? [])).slice(0, 10)
        : [];

      if (histEntries.length > 0) {
        historyContext += formatHistory(histEntries);
      }
      if (sessEntries.length > 0) {
        historyContext += (historyContext ? '\n\n' : '') + formatSessions(sessEntries);
      }
    } catch {
      // History context is optional — continue without it
    }
  }

  // ── Step 4: Query Ollama ─────────────────────────────────────────────────
  if (config.debug) {
    console.log(chalk.magenta.bold('\n─── DEBUG: Querying Ollama ───'));
    console.log(chalk.magenta(`  Model: ${config.model}`));
    console.log(chalk.magenta(`  URL: ${config.ollamaUrl}`));
    console.log(chalk.magenta(`  Command: ${parsed.command}`));
    if (historyContext) {
      console.log(chalk.magenta(`  History context: included`));
    }
  }

  let action;
  try {
    action = await queryOllama({
      command: parsed.command,
      tabsFormatted,
      config,
      history: historyContext || undefined,
    });
  } catch (err) {
    // Fallback for search-type commands when JSON parsing fails entirely
    const lCmd = parsed.command.toLowerCase();
    if (/\b(search|find|look\s+for)\b/.test(lCmd) && err instanceof OllamaError && err.message.includes('invalid JSON')) {
      const searchTerms = lCmd.replace(/\b(search|find|look\s+for|my|tabs?|in|for|the|all|please)\b/g, '').trim();
      if (searchTerms) {
        action = { action: 'search_content', query: searchTerms };
        if (config.debug) console.log(chalk.hex('#b388ff')(`[fallback] JSON parse failed, falling back to search_content for "${searchTerms}"`));
      }
    }
    if (!action) {
      if (err instanceof OllamaError) {
        console.error(chalk.red(`Ollama not running at ${config.ollamaUrl}`));
        if (err.message) console.error(chalk.red.dim(err.message));
      } else {
        console.error(chalk.red(`Unexpected error: ${err.message}`));
      }
      process.exit(1);
    }
  }

  // ── Step 5: Remap sequential IDs → real Chrome tab IDs ──────────────────
  action = remapActionIds(action, idMap);

  if (config.debug) {
    console.log(chalk.magenta.bold('\n─── DEBUG: Parsed action from LLM (after ID remap) ───'));
    console.log(chalk.magenta(JSON.stringify(action, null, 2)));
  }

  // ── Client-side validation (defense in depth for small LLMs) ────────────
  {
    const cmd = parsed.command.toLowerCase();
    const domainWords = DOMAIN_WORDS;

    // Informational question override — questions about tabs should answer, not act
    const isDomainQuery = domainWords.some(d => cmd.toLowerCase().includes(d));
    if (/^(what|which|show me|list|tell|are there|do i have)\b/i.test(cmd) && /\btabs?\b/i.test(cmd) &&
        (action.action !== 'answer' || isDomainQuery) && action.action !== 'search_content') {
      const domainFilter = domainWords.find(d => cmd.toLowerCase().includes(d));
      let matching = tabs;
      if (domainFilter) matching = tabs.filter(t => ((t.title||'')+ ' ' + (t.url||'')).toLowerCase().includes(domainFilter));
      const label = domainFilter ? `${domainFilter} ` : '';
      if (matching.length === 0) {
        action = { action: 'answer', text: `No ${label}tabs found.` };
      } else {
        const list = matching.slice(0, 30).map(t => `  ${t.title || 'Untitled'} | ${t.url ? new URL(t.url).hostname : 'unknown'}`).join('\n');
        action = { action: 'answer', text: `${matching.length} ${label}tab${matching.length !== 1 ? 's' : ''} open:\n${list}` };
      }
      if (config.debug) console.log(chalk.hex('#b388ff')(`[validate] Overrode ${action.action} → answer for informational query`));
    }

    // Counting question override (domain-aware)
    if (/how many|count\s.*tab|number of\s.*tab/i.test(cmd) && action.action !== 'answer') {
      const countDomain = domainWords.find(d => cmd.toLowerCase().includes(d));
      const countTabs = countDomain ? tabs.filter(t => ((t.title||'')+ ' ' + (t.url||'')).toLowerCase().includes(countDomain)) : tabs;
      const label = countDomain ? `${countDomain} ` : '';
      action = { action: 'answer', text: `You have ${countTabs.length} ${label}tab${countTabs.length !== 1 ? 's' : ''} open.` };
    }

    // Navigation intent override — "go to", "switch to", "navigate to" + positional word should activate, not answer
    if (action.action === 'answer' && /\b(go\s+to|switch\s+to|navigate\s+to|focus|activate)\b/i.test(cmd) && /\btab\b/i.test(cmd)) {
      const positionalMap = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1, previous: -1, prev: -1 };
      const posMatch = cmd.match(/\b(first|second|third|fourth|fifth|last|previous|prev)\b/i);
      if (posMatch) {
        const pos = positionalMap[posMatch[1].toLowerCase()];
        const targetIdx = pos === -1 ? tabs.length - 1 : pos;
        if (targetIdx >= 0 && targetIdx < tabs.length) {
          action = { action: 'activate_tab', target: tabs[targetIdx].id };
          if (config.debug) console.log(chalk.hex('#b388ff')(`[validate] Overrode answer → activate_tab for positional navigation (${posMatch[1]} → tab index ${targetIdx})`));
        }
      }
    }

    // activate_tab relevance check
    if (action.action === 'activate_tab') {
      const stopWords = new Set(['open','switch','go','to','focus','activate','the','tab','with','about','a','my','me','on','in','for',
        'first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth',
        'last','next','previous','prev','1st','2nd','3rd','4th','5th',
        'number','num','no','that','this','current','other','another','one','two','three']);
      const keywords = cmd.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
      const targetId = action.target ?? action.targets;
      const tab = tabs.find(t => t.id === targetId);
      if (tab && keywords.length > 0) {
        const haystack = ((tab.title || '') + ' ' + (tab.url || '')).toLowerCase();
        const matches = keywords.some(kw => haystack.includes(kw));
        if (!matches) {
          action = { action: 'answer', text: 'No matching tab found for your query.' };
        }
      }
    }

    // open_url override — "open the tab with X" means existing tab, not new URL
    if (action.action === 'open_url' && /\b(the\s+tab|tab\s+with|tab\s+about|my\s+\w+\s+tab)\b/i.test(cmd)) {
      const stopWords = new Set(['open','the','tab','with','about','a','my','go','to','switch','please','that','is','on']);
      const keywords = cmd.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      const found = tabs.find(t => {
        const hay = ((t.title||'')+ ' ' + (t.url||'')).toLowerCase();
        return keywords.some(kw => hay.includes(kw));
      });
      if (found) {
        action = { action: 'activate_tab', target: found.id };
      } else {
        action = { action: 'answer', text: `No open tab matches "${keywords.join(' ')}". Say "open <site>" (without "tab") to open a new page.` };
      }
    }

    // close_all_except correction — "close all X tabs" should close X tabs, not everything except X
    if (action.action === 'close_all_except' && /\bclose\b/i.test(cmd)) {
      const closeDomain = domainWords.find(d => cmd.toLowerCase().includes(d));
      if (closeDomain) {
        const domainTabs = tabs.filter(t => ((t.title||'')+ ' ' + (t.url||'')).toLowerCase().includes(closeDomain));
        if (domainTabs.length > 0) {
          if (config.debug) console.log(chalk.hex('#b388ff')(`[validate] Corrected close_all_except → close_tabs targeting ${domainTabs.length} ${closeDomain} tabs`));
          action = { action: 'close_tabs', targets: domainTabs.map(t => t.id), reason: `Close ${closeDomain} tabs` };
        }
      }
    }

    // Domain filtering correction — if domain mentioned but LLM selected too many tabs, filter
    const mentionedDomain = domainWords.find(d => cmd.toLowerCase().includes(d));
    if (mentionedDomain && Array.isArray(action.targets) && tabs.length > 1) {
      const matchingTabs = tabs.filter(t => ((t.title||'')+ ' ' + (t.url||'')).toLowerCase().includes(mentionedDomain));
      if (matchingTabs.length > 0 && action.targets.length > matchingTabs.length) {
        console.log(chalk.yellow(`\n⚠ Corrected: LLM selected ${action.targets.length} tabs but only ${matchingTabs.length} match "${mentionedDomain}". Filtering.`));
        action.targets = matchingTabs.map(t => t.id);
      }
    }

    // Upgrade search commands — when user wants to search and got unhelpful answer, try RAG
    if (action.action === 'answer' && /\b(search|find|look\s+for)\b/i.test(cmd) && /\btabs?\b/i.test(cmd)) {
      const answerText = (action.text || '').toLowerCase();
      if (answerText.includes('no tab') || answerText.includes('not found') || answerText.includes('no matching')) {
        const searchStopWords = new Set(['search','find','look','for','my','tabs','tab','in','the','all','please','any','a','about','do','i','have']);
        const searchTerms = cmd.split(/\s+/).filter(w => w.length > 1 && !searchStopWords.has(w)).join(' ');
        if (searchTerms) {
          if (config.debug) console.log(chalk.hex('#b388ff')(`[validate] Upgraded unhelpful answer → search_content for "${searchTerms}"`));
          action = { action: 'search_content', query: searchTerms };
        }
      }
    }

    // Upgrade search_tabs to search_content when no tab titles/URLs match the query
    if (action.action === 'search_tabs' && action.query) {
      const q = action.query.toLowerCase();
      const titleMatch = tabs.some(t => ((t.title||'')+ ' ' + (t.url||'')).toLowerCase().includes(q));
      if (!titleMatch) {
        if (config.debug) console.log(chalk.hex('#b388ff')(`[validate] Upgraded search_tabs → search_content (no title/URL match for "${q}")`));
        action = { action: 'search_content', query: action.query };
      }
    }
  }

  previewAction(action, tabs);

  // Dry run — stop after preview
  if (parsed.dryRun) {
    console.log(chalk.dim('\n--dry-run: no changes made.'));
    return;
  }

  // Informational actions — just display the result from the model or a quick GET
  if (INFORMATIONAL_ACTIONS.has(action.action)) {
    if (action.action === 'answer' || action.action === 'search_tabs') {
      // Already printed in preview
      return;
    }

    try {
      const result = await executeAction(action, config);
      const summary = formatResult(action, result);
      console.log(chalk.yellow(`\n${summary}`));
    } catch (err) {
      handleBridgeError(err);
    }
    return;
  }

  // Destructive actions — require confirmation unless -y
  if (isDestructive(action)) {
    if (!parsed.yes && config.confirmDestructive) {
      const ok = await confirm(chalk.yellow('\nConfirm? (y/n) '));
      if (!ok) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
    }
  }

  // Execute the action
  let result;
  try {
    result = await executeAction(action, config);
  } catch (err) {
    handleBridgeError(err);
    process.exit(1);
  }

  // ── Step 6: Print summary ────────────────────────────────────────────────
  const summary = formatResult(action, result);
  console.log(chalk.green(`\n\u2713 ${summary}`));
}

function handleBridgeError(err) {
  if (err instanceof BridgeError) {
    console.error(chalk.red(`Bridge error: ${err.message}`));
  } else if (err?.cause?.code === 'ECONNREFUSED' || err?.message?.includes('fetch')) {
    console.error(chalk.red('Chrome bridge not running. Is the extension loaded?'));
  } else {
    console.error(chalk.red(`Error: ${err.message}`));
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  process.exit(1);
});
