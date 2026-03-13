const SYSTEM_PROMPT = `You are tabai, a Chrome tab manager. Given the user's command and their current open tabs, return a single JSON action object. Return ONLY valid JSON, no markdown, no explanation, no preamble. Do not use thinking tags.

Available actions:
{"action":"close_tabs","targets":[tabId,...],"reason":"description"}
{"action":"close_all_except","keep":[tabId,...]}
{"action":"close_duplicates","keep":"first"}
{"action":"open_url","url":"https://..."}
{"action":"open_urls","urls":["https://...",...]}
{"action":"open_new_tabs","count":N}
{"action":"bookmark_tabs","targets":[tabId,...],"folder":"FolderName"}
{"action":"list_bookmarks"}
{"action":"list_bookmarks","query":"search term"}
{"action":"group_tabs","targets":[tabId,...],"by":"domain"}
{"action":"group_tabs","targets":[tabId,...],"by":"custom","name":"GroupName"}
{"action":"search_tabs","query":"search term"}
{"action":"mute_tabs","targets":[tabId,...]}
{"action":"unmute_tabs","targets":[tabId,...]}
{"action":"pin_tabs","targets":[tabId,...]}
{"action":"unpin_tabs","targets":[tabId,...]}
{"action":"duplicate_tab","target":tabId}
{"action":"move_tab","target":tabId,"windowId":N,"index":N}
{"action":"activate_tab","target":tabId}
{"action":"reload_tabs","targets":[tabId,...]}
{"action":"discard_tabs","targets":[tabId,...]}
{"action":"answer","text":"response text"}
{"action":"restore_last_closed","count":N}
{"action":"restore_session","label":"session label"}
{"action":"restore_session","index":0}
{"action":"save_session","label":"session name"}
{"action":"list_history"}
{"action":"search_history","query":"search term"}
{"action":"list_sessions"}
{"action":"index_tabs","targets":"all"}
{"action":"index_tabs","targets":[tabId,...]}
{"action":"summarize_tab","target":"current"}
{"action":"summarize_tab","target":tabId}
{"action":"search_content","query":"search terms"}
{"action":"open_from_search","query":"search terms"}
{"action":"open_from_search","query":"search terms","all":true}

Rules:
- Tabs are numbered [1], [2], [3], etc. Use these numbers as tab IDs in your response
- For informational queries (list/show/what/which/how many tabs), prefer "answer". For action requests (close/open/pin/mute), prefer the matching action.
- If the user asks to open/activate a specific tab but NO tab in the list matches that site or topic, use answer to say "No matching tab found" and do NOT use open_url to navigate to that site. "open the tab with X" means find an existing tab, not open a new one.
- For "open tabs" / "new tabs" without specific URLs, use open_new_tabs
- For "open <site>" without a full URL, infer the URL (e.g. "open youtube" → open_url with "https://www.youtube.com"). But "open the tab with X" or "my X tab" means find an existing tab — use activate_tab or open_from_search, NOT open_url.
- IMPORTANT: "select", "switch to", "go to", "focus", "activate" a tab means activate_tab — NOT close_tabs
- For "list bookmarks" or "show bookmarks" without a specific search topic, use list_bookmarks WITHOUT a query field. Only include "query" when the user explicitly mentions a search term.
- For close commands ONLY (words like "close", "delete", "remove", "kill"), use close_tabs
- For "close everything except" use close_all_except with the keep list
- For "list tabs", "show tabs", "list all tabs" — use answer with tab info. There is NO list_tabs action. Do NOT use list_bookmarks for tab listing.
- For "close duplicate tabs" or "deduplicate", use close_duplicates. Keeps one tab per URL, closes the rest. Set keep to "first" (default) or "last".
- IMPORTANT: "mention", "list", "show", "tell me", "which tabs", "what tabs", "find", "how many", "count", "number of", "do I have" are ALL informational queries — use answer (with the matching tab info or count as text) or search_tabs. NEVER use close_tabs, open_url, summarize_tab, or any mutation action for informational queries. "what youtube tabs" means "which tabs are youtube" — use answer, NOT open_url.
- For "read all tabs", "index all tabs", "load tabs into context", "get tab content", use index_tabs to extract and index page content into RAG. Use targets "all" or specific tab IDs.
- For "read this tab" or "index tab X", use index_tabs with the specific tab ID(s)
- For "summarize this tab/page" or "what is this page about", use summarize_tab with target "current" (or a specific tabId)
- IMPORTANT: "which article/tab/page about X", "what tabs talk about X", "find pages about X", "do I have a tab about X" are informational queries about page CONTENT — use search_content to list matching results. NEVER use open_from_search for these.
- IMPORTANT: Only use open_from_search when the user explicitly says "open", "go to", "switch to", "activate" a tab based on its content (e.g. "open the tab that talks about X", "go to the page about X"). The word "open"/"go to"/"switch to" MUST be present.
- For "open ALL tabs about X" or "open all pages having content X", use open_from_search with "all":true to open every matching page
- When the user mentions a specific site or domain (e.g. "github tabs", "youtube tabs"), ONLY include tab IDs whose title or URL matches. Example: if [1] Home | github.com, [2] Video | youtube.com, [3] Repo | github.com and user says "pin github tabs", targets should be [1, 3] only.
- CRITICAL: When the user says "<domain> tabs" (e.g. "github tabs", "youtube tabs"), you MUST filter by domain. Include tabs whose URL contains that domain OR its subdomains (e.g. "github" matches github.com, github.io, *.github.io). Count ALL matching tabs first, then build your targets array with ONLY those tab IDs. Never include all tabs when a domain is specified.
- For search/answer queries where no action applies, use answer
- For "answer" actions: keep "text" SHORT (one sentence). The CLI reformats tab listings, so do NOT enumerate all tabs. Just state the key fact (e.g. "You have 25 tabs open" or "4 GitHub tabs found").
- For restore_session, use "label" to match by name or "index" for position (0 = most recent)
Examples:
User: "close all youtube tabs" (tabs: [1] Home | youtube.com, [2] Repo | github.com, [3] Video | youtube.com)
→ {"action":"close_tabs","targets":[1,3],"reason":"closing youtube tabs"}

User: "how many github tabs do I have?" (tabs: [1] PR | github.com, [2] Video | youtube.com, [3] Blog | karpathy.github.io, [4] Issues | github.com)
→ {"action":"answer","text":"You have 3 GitHub tabs: [1] PR, [3] Blog, and [4] Issues."}

User: "pin all github tabs" (tabs: [1] Home | youtube.com, [2] Repo | github.com, [3] PR | github.com)
→ {"action":"pin_tabs","targets":[2,3]}

Return ONLY the JSON object, nothing else`;

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'close_tabs', 'close_all_except', 'close_duplicates',
        'open_url', 'open_urls', 'open_new_tabs',
        'bookmark_tabs', 'list_bookmarks', 'group_tabs',
        'search_tabs', 'mute_tabs', 'unmute_tabs',
        'pin_tabs', 'unpin_tabs', 'duplicate_tab',
        'move_tab', 'activate_tab', 'reload_tabs', 'discard_tabs',
        'answer', 'restore_last_closed', 'restore_session',
        'save_session', 'list_history', 'search_history',
        'list_sessions', 'index_tabs', 'summarize_tab',
        'search_content', 'open_from_search',
      ],
    },
    targets: { type: 'array', items: { type: 'integer' } },
    target: { type: 'integer' },
    url: { type: 'string' },
    urls: { type: 'array', items: { type: 'string' } },
    query: { type: 'string' },
    text: { type: 'string' },
    reason: { type: 'string' },
    keep: {},
    count: { type: 'integer' },
    by: { type: 'string' },
    name: { type: 'string' },
    folder: { type: 'string' },
    label: { type: 'string' },
    index: { type: 'integer' },
    all: { type: 'boolean' },
  },
  required: ['action'],
};

/**
 * Send a command + tab context to Ollama and get back a parsed action object.
 *
 * @param {object} params
 * @param {string} params.command - The natural language command from the user
 * @param {string} params.tabsFormatted - Compact tab metadata string
 * @param {object} params.config - Merged config
 * @param {string} [params.history] - Optional formatted history/session context
 * @returns {Promise<object>} Parsed action object from the model
 */
export async function queryOllama({ command, tabsFormatted, config, history }) {
  const debug = config.debug;
  const url = `${config.ollamaUrl}/api/chat`;

  const userContent = buildUserMessage(command, tabsFormatted, history);

  if (debug) {
    console.log('\x1b[35m\x1b[1m\n─── DEBUG: Full prompt to LLM ───\x1b[0m');
    console.log('\x1b[35m[SYSTEM]\x1b[0m', SYSTEM_PROMPT.slice(0, 200) + '...');
    console.log('\x1b[35m[USER]\x1b[0m', userContent);
  }

  const body = {
    model: config.model,
    stream: false,
    format: ACTION_SCHEMA,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    options: {
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      presence_penalty: 1.5,
    },
  };

  // Disable thinking for qwen3.5 and similar models — set at top level (Ollama API)
  if (config.think === false) {
    body.think = false;
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new OllamaError(`Cannot reach Ollama at ${config.ollamaUrl}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new OllamaError(`Ollama returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.message?.content ?? data.response ?? '';

  if (debug) {
    console.log('\x1b[35m\x1b[1m\n─── DEBUG: Raw LLM response ───\x1b[0m');
    console.log('\x1b[35m' + raw + '\x1b[0m');
    if (data.eval_count) {
      console.log(`\x1b[35m  Tokens: ${data.eval_count} eval, ${data.prompt_eval_count ?? '?'} prompt\x1b[0m`);
    }
  }

  // First attempt to parse
  let parsed = tryParseJson(raw);
  if (parsed) return parsed;

  if (debug) console.log('\x1b[35m  [DEBUG] Direct JSON parse failed, trying code fence strip...\x1b[0m');

  // Retry: strip markdown code fences and try again
  parsed = tryParseJson(stripCodeFences(raw));
  if (parsed) return parsed;

  if (debug) console.log('\x1b[35m  [DEBUG] Code fence strip failed, retrying with model...\x1b[0m');

  // Second API call as a last resort — ask the model to fix its output
  const retryParsed = await retryParse(config, raw);
  if (retryParsed) return retryParsed;

  throw new OllamaError(
    `Model returned invalid JSON after retry.\nRaw output:\n${raw.slice(0, 500)}`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUserMessage(command, tabsFormatted, history) {
  let msg = `Command: ${command}\n\n${tabsFormatted}`;
  if (history) {
    msg += `\n\n${history}`;
  }
  return msg;
}

function tryParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && obj.action) return obj;
    return null;
  } catch {
    // Try to extract a JSON object from the string.
    // First try greedy match (handles nested objects), then try each closing brace
    // from left to right in case there's trailing garbage.
    const start = trimmed.indexOf('{');
    if (start === -1) return null;

    // Try greedy (last }) first — correct for nested objects
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && typeof obj === 'object' && obj.action) return obj;
      } catch {
        // Greedy failed — try finding a valid JSON substring by scanning closing braces
        let depth = 0;
        for (let i = start; i < trimmed.length; i++) {
          if (trimmed[i] === '{') depth++;
          else if (trimmed[i] === '}') depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(trimmed.slice(start, i + 1));
              if (obj && typeof obj === 'object' && obj.action) return obj;
            } catch {
              // Continue scanning
            }
            break;
          }
        }
      }
    }
    return null;
  }
}

function stripCodeFences(str) {
  return str
    .replace(/^```(?:json)?\s*\n?/gm, '')
    .replace(/\n?```\s*$/gm, '')
    .trim();
}

async function retryParse(config, badOutput) {
  const url = `${config.ollamaUrl}/api/chat`;

  const body = {
    model: config.model,
    stream: false,
    format: ACTION_SCHEMA,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Your previous response was not valid JSON. Here is what you returned:\n\n${badOutput.slice(0, 1000)}\n\nPlease return ONLY the corrected JSON object, nothing else.`,
      },
    ],
    options: { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 },
  };

  // Disable thinking for retry call as well
  if (config.think === false) {
    body.think = false;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;

    const data = await response.json();
    const raw = data.message?.content ?? data.response ?? '';
    return tryParseJson(raw) || tryParseJson(stripCodeFences(raw));
  } catch {
    return null;
  }
}

// ── Stage 1: Intent Classification (small, focused prompt) ───────────────────

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['informational', 'navigate', 'mutate', 'organize', 'content', 'session'],
    },
    topic: { type: 'string' },
    specifics: { type: 'string' },
  },
  required: ['intent'],
};

const CLASSIFY_PROMPT = `Classify this browser tab command. Return JSON with:
- "intent": one of "informational", "navigate", "mutate", "organize", "content", "session"
- "topic": subject keywords (e.g. "youtube", "react docs")
- "specifics": action detail (e.g. "close", "pin", "group by domain")

Intent meanings:
- informational: questions about tabs (how many, which, list, show, count)
- navigate: switch to, go to, focus, activate a tab
- mutate: close, open, reload, discard tabs
- organize: pin, unpin, group, bookmark, mute, unmute tabs
- content: summarize, index, search page content
- session: restore, save, list sessions or history`;

/**
 * Stage 1 LLM call: classify the user's intent into one of 6 categories.
 * Much simpler than the full 30-action classification.
 *
 * @param {object} params
 * @param {string} params.command - Natural language command
 * @param {object} params.config - Merged config
 * @returns {Promise<{ intent: string, topic: string, specifics: string }>}
 */
export async function classifyIntent({ command, config }) {
  const url = `${config.ollamaUrl}/api/chat`;

  const body = {
    model: config.model,
    stream: false,
    format: CLASSIFY_SCHEMA,
    messages: [
      { role: 'system', content: CLASSIFY_PROMPT },
      { role: 'user', content: `Command: "${command}"` },
    ],
    options: { temperature: 0.3, top_p: 0.8, top_k: 10 },
  };

  if (config.think === false) body.think = false;

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
    throw new OllamaError(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.message?.content ?? data.response ?? '';

  let parsed = tryParseJson(raw);
  if (!parsed) parsed = tryParseJson(stripCodeFences(raw));
  if (!parsed) throw new OllamaError('Classification returned invalid JSON');

  // Map LLM intent categories back to pipeline intents
  const intentMap = {
    informational: 'list_tabs',
    navigate: 'navigate',
    mutate: 'mutate_close',
    organize: 'organize',
    content: 'content',
    session: 'session',
  };

  return {
    intent: intentMap[parsed.intent] || parsed.intent || 'list_tabs',
    topic: (parsed.topic || '').toLowerCase(),
    specifics: parsed.specifics || '',
  };
}

// ── Stage 3: Focused Action Emission ─────────────────────────────────────────

const ACTION_CATEGORIES = {
  list_tabs:     ['answer', 'search_tabs', 'search_content'],
  navigate:      ['activate_tab', 'open_from_search', 'open_url', 'answer'],
  mutate_close:  ['close_tabs', 'close_all_except', 'close_duplicates',
                  'open_url', 'open_urls', 'open_new_tabs',
                  'reload_tabs', 'discard_tabs', 'answer'],
  organize:      ['pin_tabs', 'unpin_tabs', 'group_tabs', 'bookmark_tabs',
                  'duplicate_tab', 'move_tab', 'mute_tabs', 'unmute_tabs', 'answer'],
  content:       ['summarize_tab', 'search_content', 'open_from_search', 'index_tabs', 'answer'],
  session:       ['save_session', 'restore_session', 'restore_last_closed',
                  'list_sessions', 'list_history', 'search_history', 'list_bookmarks', 'answer'],
};

/**
 * Stage 3 LLM call: emit the final action JSON using only the subset of actions
 * relevant to the classified intent. Turns a 30-way decision into ~5-way.
 *
 * @param {object} params
 * @param {object} params.classification - { intent, topic, specifics }
 * @param {Array}  params.tabs - tab objects
 * @param {string} params.tabsFormatted - formatted tab string for LLM
 * @param {string} params.command - original command
 * @param {object} params.config - merged config
 * @param {string} [params.historyContext] - optional history context
 * @returns {Promise<object>} Action object
 */
export async function emitAction({ classification, tabs, tabsFormatted, command, config, historyContext }) {
  const url = `${config.ollamaUrl}/api/chat`;
  const actions = ACTION_CATEGORIES[classification.intent] || ACTION_CATEGORIES.list_tabs;

  // Build focused schema with only relevant actions
  const focusedSchema = {
    ...ACTION_SCHEMA,
    properties: {
      ...ACTION_SCHEMA.properties,
      action: { type: 'string', enum: actions },
    },
  };

  const focusedPrompt = `You are tabai, a Chrome tab manager. Given the user's command and tabs, return a single JSON action.
Available actions for this command: ${actions.join(', ')}
Rules:
- Tabs are numbered [1], [2], etc. Use these numbers as tab IDs.
- When a domain is mentioned (e.g. "github tabs"), ONLY include tabs matching that domain.
- For close commands, use close_tabs with targets array.
- For "close everything except X", use close_all_except with keep array.
- For informational queries, use answer with a short text.
Return ONLY valid JSON.`;

  let userContent = `Command: ${command}\n\n${tabsFormatted}`;
  if (historyContext) userContent += `\n\n${historyContext}`;
  if (classification.topic) userContent += `\n\nDetected topic: ${classification.topic}`;
  if (classification.specifics) userContent += `\nDetected specifics: ${classification.specifics}`;

  const body = {
    model: config.model,
    stream: false,
    format: focusedSchema,
    messages: [
      { role: 'system', content: focusedPrompt },
      { role: 'user', content: userContent },
    ],
    options: { temperature: 0.5, top_p: 0.8, top_k: 15, presence_penalty: 1.5 },
  };

  if (config.think === false) body.think = false;

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
    throw new OllamaError(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.message?.content ?? data.response ?? '';

  if (config.debug) {
    console.log('\x1b[35m  [emitAction] Raw LLM response: ' + raw.slice(0, 300) + '\x1b[0m');
    if (data.eval_count) {
      console.log(`\x1b[35m  Tokens: ${data.eval_count} eval, ${data.prompt_eval_count ?? '?'} prompt\x1b[0m`);
    }
  }

  let parsed = tryParseJson(raw);
  if (!parsed) parsed = tryParseJson(stripCodeFences(raw));
  if (!parsed) {
    const retryParsed = await retryParse(config, raw);
    if (retryParsed) return retryParsed;
    throw new OllamaError('Emission returned invalid JSON');
  }

  return parsed;
}

/**
 * Custom error class so callers can distinguish Ollama failures.
 */
export class OllamaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OllamaError';
  }
}
