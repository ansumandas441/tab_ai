import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = join(homedir(), '.tabai');
const LOG_FILE = join(LOG_DIR, 'calls.jsonl');

async function ensureDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

/**
 * Log a tabai call to ~/.tabai/calls.jsonl
 *
 * @param {object} entry
 * @param {string} entry.command        - User's natural language command
 * @param {Array}  entry.tabs           - Tabs at time of call [{title, url}]
 * @param {object} entry.llmAction      - Raw action from LLM (before validation)
 * @param {object} entry.finalAction    - Final action (after validation/correction)
 * @param {boolean} entry.wasOverridden  - Whether client-side validation changed the action
 * @param {object} [entry.result]       - Execution result (if any)
 * @param {string} [entry.error]        - Error message (if failed)
 * @param {string} entry.model          - Model used
 */
export async function logCall(entry) {
  try {
    await ensureDir();
    const record = {
      timestamp: new Date().toISOString(),
      command: entry.command,
      tabs: (entry.tabs || []).map(t => ({
        title: t.title || 'Untitled',
        url: t.url || '',
      })),
      llmAction: entry.llmAction,
      finalAction: entry.finalAction,
      wasOverridden: entry.wasOverridden,
      result: entry.result ?? null,
      error: entry.error ?? null,
      model: entry.model,
    };
    await appendFile(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // Logging should never break the CLI
  }
}
