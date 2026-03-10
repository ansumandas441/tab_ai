import chalk from 'chalk';
import { formatHistory, formatSessions, formatSessionsFull } from './format.js';

/**
 * Display the last 20 closed-tab history entries.
 * Called directly via `tabai history` — no model involved.
 */
export async function showHistory(config) {
  const url = `${config.bridgeUrl}/history`;

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error(chalk.red(`Failed to fetch history from bridge: ${err.message}`));
    console.error(chalk.red('Is the Chrome extension loaded and the bridge running?'));
    process.exit(1);
  }

  const entries = Array.isArray(data) ? data : (data.history ?? data.entries ?? []);
  const last20 = entries.slice(0, 20);

  if (last20.length === 0) {
    console.log(chalk.yellow('No closed tab history yet.'));
    return;
  }

  const formatted = formatHistory(last20);
  console.log(chalk.yellow(formatted));
}

/**
 * Display saved sessions.
 * Called directly via `tabai sessions` or `tabai sessions --full`.
 *
 * @param {object} config
 * @param {boolean} full - If true, show all tabs per session
 */
export async function showSessions(config, full = false) {
  const url = full ? `${config.bridgeUrl}/sessions?full=1` : `${config.bridgeUrl}/sessions`;

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error(chalk.red(`Failed to fetch sessions from bridge: ${err.message}`));
    console.error(chalk.red('Is the Chrome extension loaded and the bridge running?'));
    process.exit(1);
  }

  const sessions = Array.isArray(data) ? data : (data.sessions ?? []);

  if (sessions.length === 0) {
    console.log(chalk.yellow('No saved sessions.'));
    return;
  }

  if (full) {
    const formatted = formatSessionsFull(sessions);
    console.log(chalk.yellow(formatted));
  } else {
    const formatted = formatSessions(sessions);
    console.log(chalk.yellow(formatted));
  }
}
