const SYSTEM_PROMPT = `You are tabai, a Chrome tab manager. Given the user's command and their current open tabs, return a single JSON action object. Return ONLY valid JSON, no markdown, no explanation, no preamble. Do not use thinking tags.

Available actions:
{"action":"close_tabs","targets":[tabId,...],"reason":"description"}
{"action":"close_all_except","keep":[tabId,...]}
{"action":"open_url","url":"https://..."}
{"action":"open_urls","urls":["https://...",...]}
{"action":"open_new_tabs","count":N}
{"action":"bookmark_tabs","targets":[tabId,...],"folder":"FolderName"}
{"action":"list_bookmarks","query":"optional search term"}
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

Rules:
- Use exact tab IDs from the provided tab list
- Always pick the closest matching action — never refuse with "answer" if an action can handle it
- For "open tabs" / "new tabs" without specific URLs, use open_new_tabs
- For "open <site>" without a full URL, infer the URL (e.g. "open youtube" → open_url with "https://www.youtube.com")
- For close commands, identify matching tabs by title/URL keywords and use close_tabs
- For "close everything except" use close_all_except with the keep list
- For search/answer queries where no action applies, use answer
- For restore_session, use "label" to match by name or "index" for position (0 = most recent)
- Return ONLY the JSON object, nothing else`;

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
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    options: {
      temperature: 0,
    },
  };

  // Some Ollama versions support options.think — include it to suppress thinking
  if (config.think === false) {
    body.options.think = false;
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
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Your previous response was not valid JSON. Here is what you returned:\n\n${badOutput.slice(0, 1000)}\n\nPlease return ONLY the corrected JSON object, nothing else.`,
      },
    ],
    options: { temperature: 0 },
  };

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

/**
 * Custom error class so callers can distinguish Ollama failures.
 */
export class OllamaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OllamaError';
  }
}
