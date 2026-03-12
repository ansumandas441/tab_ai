import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULTS = {
  ollamaUrl: 'http://localhost:11434',
  model: 'qwen3.5:2b',
  think: false,
  bridgePort: 9999,
  confirmDestructive: false,
  debug: false,
};

/**
 * Load config from tabai/config.json, merge with defaults and CLI overrides.
 * @param {object} [overrides] - CLI flag overrides (e.g. { model: 'llama3' })
 * @returns {Promise<object>} Merged configuration object
 */
export async function loadConfig(overrides = {}) {
  let fileConfig = {};

  // config.json lives one level up from cli/ — at tabai/config.json
  const configPath = resolve(__dirname, '..', 'config.json');

  try {
    const raw = await readFile(configPath, 'utf-8');
    fileConfig = JSON.parse(raw);
  } catch {
    // No config file or invalid JSON — use defaults silently
  }

  const merged = { ...DEFAULTS, ...fileConfig, ...stripUndefined(overrides) };

  // Respect the TABAI_PORT env var (same one the bridge reads)
  if (process.env.TABAI_PORT) {
    merged.bridgePort = parseInt(process.env.TABAI_PORT, 10);
  }

  // Derived convenience property
  merged.bridgeUrl = `http://127.0.0.1:${merged.bridgePort}`;

  return merged;
}

/**
 * Remove keys whose value is undefined so they don't clobber file/default values.
 */
function stripUndefined(obj) {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = v;
  }
  return clean;
}
