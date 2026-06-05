#!/usr/bin/env node

/**
 * tabai LLM evaluation runner
 *
 * Sends a fixed set of natural-language commands + mock tab data to one or
 * more Ollama models and scores the JSON action they return against expected
 * results.
 *
 * Automatically uses the two-stage tool-based strategy for functiongemma
 * and the system-prompt strategy for all other models.
 *
 * Usage:
 *   node cli/test/llm-eval.js [flags] [model ...]
 *
 * Examples:
 *   node cli/test/llm-eval.js qwen3.5:2b functiongemma
 *   node cli/test/llm-eval.js functiongemma -v
 *   node cli/test/llm-eval.js                       # defaults to qwen3.5:2b
 *
 * Flags:
 *   -v, --verbose   Show raw LLM output on non-PASS results
 *   -h, --help      Show help
 */

import chalk from 'chalk';
import { formatTabs } from '../format.js';
import { SYSTEM_PROMPT } from '../ollama.js';
import { queryFunctiongemma } from '../ollama-tools.js';
import { MOCK_TABS, TEST_CASES } from './test-cases.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.bold('tabai LLM evaluation')}

Usage: node cli/test/llm-eval.js [flags] [model ...]

Flags:
  -v, --verbose   Show raw LLM output for non-PASS results
  -h, --help      Show this help

Models with "functiongemma" in the name use the two-stage tool-calling
strategy automatically. All other models use the system-prompt strategy.

Examples:
  node cli/test/llm-eval.js qwen3.5:2b functiongemma
  node cli/test/llm-eval.js functiongemma --verbose
`);
    process.exit(0);
  }

  const verbose = args.includes('--verbose') || args.includes('-v');
  const models = args.filter((a) => !a.startsWith('-'));
  if (models.length === 0) models.push('qwen3.5:2b');

  return { models, verbose };
}

// ── Ollama helpers ───────────────────────────────────────────────────────────

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    return null;
  }
}

/** System-prompt strategy (qwen, llama, etc.) */
async function queryWithPrompt(model, command, tabsFormatted) {
  const start = Date.now();

  const body = {
    model,
    stream: false,
    format: 'json',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Command: ${command}\n\n${tabsFormatted}` },
    ],
    options: { temperature: 0.3, top_p: 0.9, top_k: 20 },
    think: false,
  };

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.message?.content ?? data.response ?? '';
  const elapsed = Date.now() - start;
  const tokens = data.eval_count || 0;

  const parsed = tryParseJson(raw);
  return { parsed, raw, elapsed, tokens };
}

/** Two-stage tool strategy (functiongemma) */
async function queryWithTools(model, command, tabsFormatted, tabs) {
  const start = Date.now();
  const config = { model, ollamaUrl: OLLAMA_URL, debug: false };

  try {
    const action = await queryFunctiongemma({
      command,
      tabsFormatted,
      config,
      tabs,
    });
    const elapsed = Date.now() - start;
    return { parsed: action, raw: JSON.stringify(action), elapsed, tokens: 0 };
  } catch (e) {
    return { parsed: null, raw: e.message, elapsed: Date.now() - start, tokens: 0, error: e.message };
  }
}

function useToolStrategy(model) {
  return model.includes('functiongemma');
}

function tryParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();

  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && obj.action) return obj;
  } catch {
    // fall through
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && typeof obj === 'object' && obj.action) return obj;
    } catch {
      // fall through
    }
  }

  return null;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate a single LLM result against a test case.
 *
 * status: 'PASS' | 'PARTIAL' | 'FAIL' | 'ERROR'
 */
function evaluate(testCase, result) {
  const { expect } = testCase;
  const out = { jsonValid: false, actionCorrect: false, targetsCorrect: null };

  if (!result.parsed) {
    return { ...out, status: 'ERROR', detail: 'Invalid JSON' };
  }
  out.jsonValid = true;

  const action = result.parsed;

  // Action type check
  if (expect.action) {
    out.actionCorrect = action.action === expect.action;
  } else if (expect.actionOneOf) {
    out.actionCorrect = expect.actionOneOf.includes(action.action);
  }

  if (!out.actionCorrect) {
    const wanted = expect.action || expect.actionOneOf.join('|');
    return { ...out, status: 'FAIL', detail: `got "${action.action}", expected "${wanted}"` };
  }

  // Targets array
  if (expect.targets !== undefined) {
    const got = (action.targets || []).map(Number).sort((a, b) => a - b);
    const want = [...expect.targets].sort((a, b) => a - b);
    out.targetsCorrect = JSON.stringify(got) === JSON.stringify(want);
    if (!out.targetsCorrect) {
      return { ...out, status: 'PARTIAL', detail: `targets [${got}] != expected [${want}]` };
    }
  }

  // Single target
  if (expect.target !== undefined) {
    const got = Number(action.target);
    out.targetsCorrect = got === expect.target;
    if (!out.targetsCorrect) {
      return { ...out, status: 'PARTIAL', detail: `target ${got} != expected ${expect.target}` };
    }
  }

  // Keep array (close_all_except)
  if (expect.keep !== undefined) {
    const got = (action.keep || []).map(Number).sort((a, b) => a - b);
    const want = [...expect.keep].sort((a, b) => a - b);
    out.targetsCorrect = JSON.stringify(got) === JSON.stringify(want);
    if (!out.targetsCorrect) {
      return { ...out, status: 'PARTIAL', detail: `keep [${got}] != expected [${want}]` };
    }
  }

  // Field checks
  if (expect.fields) {
    for (const [key, expected] of Object.entries(expect.fields)) {
      const got = action[key];
      if (typeof expected === 'function') {
        if (!expected(got)) {
          return { ...out, status: 'PARTIAL', detail: `field "${key}": ${JSON.stringify(got)} failed check` };
        }
      } else if (got !== expected) {
        return { ...out, status: 'PARTIAL', detail: `field "${key}": got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}` };
      }
    }
  }

  return { ...out, status: 'PASS', detail: null };
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runModel(model, tabsFormatted, tabs, verbose) {
  const isTools = useToolStrategy(model);
  const strategy = isTools ? 'tools (2-stage)' : 'system-prompt';

  console.log(chalk.bold.cyan(`\n${'='.repeat(60)}`));
  console.log(chalk.bold.cyan(`  Model: ${model}  [${strategy}]`));
  console.log(chalk.bold.cyan(`${'='.repeat(60)}\n`));

  const results = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const idx = `[${String(i + 1).padStart(2)}/${TEST_CASES.length}]`;
    process.stdout.write(chalk.dim(`  ${idx} ${tc.name.padEnd(28)} `));

    let result;
    try {
      if (isTools) {
        result = await queryWithTools(model, tc.command, tabsFormatted, tabs);
      } else {
        result = await queryWithPrompt(model, tc.command, tabsFormatted);
      }
    } catch (e) {
      result = { parsed: null, raw: '', elapsed: 0, tokens: 0, error: e.message };
    }

    const ev = evaluate(tc, result);
    const ms = `${result.elapsed}ms`.padStart(7);

    if (ev.status === 'PASS') {
      const got = result.parsed.action;
      const tgt = result.parsed.targets
        ? ` [${result.parsed.targets}]`
        : result.parsed.target != null
          ? ` -> ${result.parsed.target}`
          : '';
      console.log(chalk.green(`PASS `) + chalk.dim(`${got}${tgt}`) + chalk.dim(`  ${ms}`));
    } else if (ev.status === 'PARTIAL') {
      console.log(chalk.yellow(`PART `) + chalk.yellow(ev.detail) + chalk.dim(`  ${ms}`));
    } else if (ev.status === 'FAIL') {
      console.log(chalk.red(`FAIL `) + chalk.red(ev.detail) + chalk.dim(`  ${ms}`));
    } else {
      console.log(chalk.red(`ERR  `) + chalk.red(ev.detail || result.error || 'unknown') + chalk.dim(`  ${ms}`));
    }

    if (verbose && ev.status !== 'PASS') {
      console.log(chalk.dim(`         raw: ${(result.raw || '').slice(0, 200)}`));
    }

    results.push({ ...ev, elapsed: result.elapsed, tokens: result.tokens });
  }

  return results;
}

function printSummary(allResults, models) {
  console.log(chalk.bold(`\n${'='.repeat(60)}`));
  console.log(chalk.bold('  Summary'));
  console.log(chalk.bold(`${'='.repeat(60)}\n`));

  for (const model of models) {
    const results = allResults[model];
    const pass = results.filter((r) => r.status === 'PASS').length;
    const partial = results.filter((r) => r.status === 'PARTIAL').length;
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const err = results.filter((r) => r.status === 'ERROR').length;
    const total = results.length;
    const pct = Math.round((pass / total) * 100);
    const avgMs = Math.round(results.reduce((s, r) => s + r.elapsed, 0) / total);
    const totalMs = results.reduce((s, r) => s + r.elapsed, 0);
    const strategy = useToolStrategy(model) ? 'tools' : 'prompt';

    const color = pct >= 80 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.red;

    console.log(chalk.bold(`  ${model} [${strategy}]`));
    console.log(
      `    ${color(`${pass}/${total} PASS (${pct}%)`)}` +
        (partial ? chalk.yellow(`, ${partial} PARTIAL`) : '') +
        (fail ? chalk.red(`, ${fail} FAIL`) : '') +
        (err ? chalk.red(`, ${err} ERROR`) : '')
    );
    console.log(chalk.dim(`    avg ${avgMs}ms per call, ${Math.round(totalMs / 1000)}s total`));
    console.log('');
  }

  // Side-by-side comparison if multiple models
  if (models.length >= 2) {
    console.log(chalk.bold('  Head-to-head:\n'));
    const nameW = 30;
    let header = '  ' + 'Test'.padEnd(nameW);
    for (const m of models) header += m.padEnd(20);
    console.log(chalk.bold(header));
    console.log('  ' + '-'.repeat(nameW + models.length * 20));

    for (let i = 0; i < TEST_CASES.length; i++) {
      let row = '  ' + TEST_CASES[i].name.slice(0, nameW - 2).padEnd(nameW);
      for (const m of models) {
        const s = allResults[m][i].status;
        const cell =
          s === 'PASS' ? chalk.green('PASS')
          : s === 'PARTIAL' ? chalk.yellow('PART')
          : chalk.red(s.padEnd(4));
        row += (cell + '                ').slice(0, 30);
      }
      console.log(row);
    }
    console.log('');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { models, verbose } = parseArgs();

  console.log(chalk.bold('\ntabai LLM Evaluation'));
  console.log(chalk.dim(`Ollama:  ${OLLAMA_URL}`));
  console.log(chalk.dim(`Models:  ${models.join(', ')}`));
  console.log(chalk.dim(`Tests:   ${TEST_CASES.length}`));

  // Verify Ollama is running
  const available = await checkOllama();
  if (available === null) {
    console.error(chalk.red(`\nCannot reach Ollama at ${OLLAMA_URL}. Is it running?`));
    process.exit(1);
  }

  for (const model of models) {
    if (!available.some((m) => m.startsWith(model))) {
      console.warn(chalk.yellow(`\nWarning: "${model}" not found. Available: ${available.join(', ')}`));
    }
  }

  // Format mock tabs the same way the real CLI does
  const { text: tabsFormatted } = formatTabs(MOCK_TABS);

  console.log(chalk.dim(`\nMock tabs sent to LLM:\n${tabsFormatted}\n`));

  // Run each model
  const allResults = {};
  for (const model of models) {
    allResults[model] = await runModel(model, tabsFormatted, MOCK_TABS, verbose);
  }

  printSummary(allResults, models);
}

main().catch((e) => {
  console.error(chalk.red(`Fatal: ${e.message}`));
  process.exit(1);
});
