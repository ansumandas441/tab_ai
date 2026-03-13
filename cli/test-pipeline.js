/**
 * Test runner for pipeline.js — 30 test cases from test.md
 *
 * Mocks global.fetch so no real bridge/Ollama calls are made.
 * All 30 tests hit client-side shortcuts (0 LLM calls).
 */

// ── Mock global.fetch before any imports ─────────────────────────────────────

global.fetch = async (url) => {
  if (typeof url === 'string' && url.includes('/rag/search')) {
    return {
      ok: true,
      json: async () => ({ results: [] }),
    };
  }
  throw new Error(`Unexpected fetch call: ${url}`);
};

// ── Import pipeline ──────────────────────────────────────────────────────────

const { runPipeline } = await import('./pipeline.js');

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_TABS = [
  { id: 1001, title: 'Pull Requests - GitHub', url: 'https://github.com/pulls', windowId: 1 },
  { id: 1002, title: 'YouTube - Cat Videos', url: 'https://www.youtube.com/watch?v=abc', windowId: 1 },
  { id: 1003, title: 'React Docs', url: 'https://react.dev/learn', windowId: 1 },
  { id: 1004, title: 'Stack Overflow - JS Question', url: 'https://stackoverflow.com/questions/123', windowId: 1 },
  { id: 1005, title: 'GitHub Issues', url: 'https://github.com/repo/issues', windowId: 1 },
  { id: 1006, title: 'Reddit - Programming', url: 'https://www.reddit.com/r/programming', windowId: 2 },
  { id: 1007, title: 'Google Docs - Meeting Notes', url: 'https://docs.google.com/doc123', windowId: 2 },
  { id: 1008, title: 'Netflix - Stranger Things', url: 'https://www.netflix.com/watch/456', windowId: 2 },
];

const MOCK_CONFIG = {
  ollamaUrl: 'http://localhost:11434',
  model: 'qwen3:4b',
  think: false,
  bridgeUrl: 'http://127.0.0.1:9999',
  bridgePort: 9999,
  confirmDestructive: false,
  debug: false,
  pipeline: true,
};

const ALL_IDS = MOCK_TABS.map(t => t.id);

// ── Test infrastructure ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, path = '') {
  if (typeof expected !== 'object' || expected === null) {
    if (actual !== expected) {
      throw new Error(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      throw new Error(`${path}: expected array, got ${JSON.stringify(actual)}`);
    }
    if (actual.length !== expected.length) {
      throw new Error(`${path}: expected array length ${expected.length}, got ${actual.length} (${JSON.stringify(actual)})`);
    }
    for (let i = 0; i < expected.length; i++) {
      assertDeepEqual(actual[i], expected[i], `${path}[${i}]`);
    }
    return;
  }
  for (const key of Object.keys(expected)) {
    assertDeepEqual(actual?.[key], expected[key], `${path}.${key}`);
  }
}

function assertContains(actual, substring, fieldName) {
  if (typeof actual !== 'string' || !actual.toLowerCase().includes(substring.toLowerCase())) {
    throw new Error(`${fieldName}: expected to contain "${substring}", got ${JSON.stringify(actual)}`);
  }
}

async function runTest(num, description, command, check) {
  try {
    const result = await runPipeline({ command, tabs: MOCK_TABS, config: MOCK_CONFIG });
    check(result);
    passed++;
    console.log(`  PASS  Test ${num}: ${description}`);
  } catch (err) {
    failed++;
    failures.push({ num, description, error: err.message });
    console.log(`  FAIL  Test ${num}: ${description}`);
    console.log(`        ${err.message}`);
  }
}

// ── Run all 30 tests ─────────────────────────────────────────────────────────

console.log('\nRunning pipeline tests...\n');

await runTest(1, 'Count all tabs',
  'how many tabs do I have?',
  (r) => {
    assertDeepEqual(r, { action: 'answer', text: 'You have 8 tabs open.' });
  }
);

await runTest(2, 'Count domain-specific tabs',
  'how many github tabs do I have?',
  (r) => {
    assertDeepEqual(r, { action: 'answer', text: 'You have 2 github tabs open.' });
  }
);

await runTest(3, 'List all tabs',
  'what tabs do I have open?',
  (r) => {
    assert(r.action === 'answer', `action: expected 'answer', got '${r.action}'`);
    assertContains(r.text, '8', 'text');
    assertContains(r.text, 'tab', 'text');
    assertContains(r.text, 'github.com', 'text');
  }
);

await runTest(4, 'List domain-filtered tabs',
  'show me my youtube tabs',
  (r) => {
    assert(r.action === 'answer', `action: expected 'answer', got '${r.action}'`);
    assertContains(r.text, '1 youtube tab', 'text');
    assertContains(r.text, 'Cat Videos', 'text');
  }
);

await runTest(5, 'Close domain tabs',
  'close all youtube tabs',
  (r) => {
    assertDeepEqual(r, { action: 'close_tabs', targets: [1002], reason: 'Close youtube tabs' });
  }
);

await runTest(6, 'Close domain tabs (multiple matches)',
  'close github tabs',
  (r) => {
    assert(r.action === 'close_tabs', `action: expected 'close_tabs', got '${r.action}'`);
    assertDeepEqual(r.targets, [1001, 1005]);
    assertContains(r.reason, 'github', 'reason');
  }
);

await runTest(7, 'Close duplicate tabs',
  'close duplicate tabs',
  (r) => {
    assertDeepEqual(r, { action: 'close_duplicates', keep: 'first' });
  }
);

await runTest(8, 'Close all except',
  'close everything except github tabs',
  (r) => {
    assertDeepEqual(r, { action: 'close_all_except', keep: [1001, 1005] });
  }
);

await runTest(9, 'Navigate to single match',
  'switch to the react tab',
  (r) => {
    assertDeepEqual(r, { action: 'activate_tab', target: 1003 });
  }
);

await runTest(10, 'Navigate to first match (multiple)',
  'go to github',
  (r) => {
    assertDeepEqual(r, { action: 'activate_tab', target: 1001 });
  }
);

await runTest(11, 'Navigate positional - first tab',
  'switch to the first tab',
  (r) => {
    assertDeepEqual(r, { action: 'activate_tab', target: 1001 });
  }
);

await runTest(12, 'Navigate positional - last tab',
  'go to the last tab',
  (r) => {
    assertDeepEqual(r, { action: 'activate_tab', target: 1008 });
  }
);

await runTest(13, 'Navigate - no match',
  'switch to the figma tab',
  (r) => {
    assert(r.action === 'answer', `action: expected 'answer', got '${r.action}'`);
    assertContains(r.text, 'No matching tab', 'text');
  }
);

await runTest(14, 'Open explicit URL',
  'open https://example.com',
  (r) => {
    assertDeepEqual(r, { action: 'open_url', url: 'https://example.com' });
  }
);

await runTest(15, 'Pin domain tabs',
  'pin github tabs',
  (r) => {
    assertDeepEqual(r, { action: 'pin_tabs', targets: [1001, 1005] });
  }
);

await runTest(16, 'Unpin all tabs (no topic)',
  'unpin all tabs',
  (r) => {
    assert(r.action === 'unpin_tabs', `action: expected 'unpin_tabs', got '${r.action}'`);
    assertDeepEqual(r.targets.sort(), ALL_IDS.slice().sort());
  }
);

await runTest(17, 'Mute domain tabs',
  'mute youtube tabs',
  (r) => {
    assertDeepEqual(r, { action: 'mute_tabs', targets: [1002] });
  }
);

await runTest(18, 'Unmute tabs',
  'unmute all tabs',
  (r) => {
    assert(r.action === 'unmute_tabs', `action: expected 'unmute_tabs', got '${r.action}'`);
    assertDeepEqual(r.targets.sort(), ALL_IDS.slice().sort());
  }
);

await runTest(19, 'Bookmark domain tabs',
  'bookmark github tabs',
  (r) => {
    assertDeepEqual(r, { action: 'bookmark_tabs', targets: [1001, 1005] });
  }
);

await runTest(20, 'Group tabs by domain',
  'group tabs by domain',
  (r) => {
    assert(r.action === 'group_tabs', `action: expected 'group_tabs', got '${r.action}'`);
    assert(r.by === 'domain', `by: expected 'domain', got '${r.by}'`);
    assertDeepEqual(r.targets.sort(), ALL_IDS.slice().sort());
  }
);

await runTest(21, 'Restore last closed tab',
  'restore last closed tab',
  (r) => {
    assertDeepEqual(r, { action: 'restore_last_closed', count: 1 });
  }
);

await runTest(22, 'Restore last N closed tabs',
  'restore 3 last closed tabs',
  (r) => {
    assertDeepEqual(r, { action: 'restore_last_closed', count: 3 });
  }
);

await runTest(23, 'Restore session',
  'restore session',
  (r) => {
    assertDeepEqual(r, { action: 'restore_session', index: 0 });
  }
);

await runTest(24, 'Save session with label',
  'save session as research',
  (r) => {
    assertDeepEqual(r, { action: 'save_session', label: 'research' });
  }
);

await runTest(25, 'List sessions',
  'list sessions',
  (r) => {
    assertDeepEqual(r, { action: 'list_sessions' });
  }
);

await runTest(26, 'Show history',
  'show history',
  (r) => {
    assertDeepEqual(r, { action: 'list_history' });
  }
);

await runTest(27, 'Summarize current tab',
  'summarize this tab',
  (r) => {
    assertDeepEqual(r, { action: 'summarize_tab', target: 'current' });
  }
);

await runTest(28, 'Index all tabs',
  'index all tabs',
  (r) => {
    assertDeepEqual(r, { action: 'index_tabs', targets: 'all' });
  }
);

await runTest(29, 'Search content',
  'search content about authentication',
  (r) => {
    assert(r.action === 'search_content', `action: expected 'search_content', got '${r.action}'`);
    assertContains(r.query, 'authentication', 'query');
  }
);

await runTest(30, 'Close non-existent domain (graceful no-op)',
  'close all spotify tabs',
  (r) => {
    assert(r.action === 'answer', `action: expected 'answer', got '${r.action}'`);
    assertContains(r.text, 'No spotify tabs found', 'text');
  }
);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed}/${passed + failed} passed`);
if (failures.length > 0) {
  console.log(`\nFailed tests:`);
  for (const f of failures) {
    console.log(`  Test ${f.num}: ${f.description}`);
    console.log(`    ${f.error}`);
  }
}
console.log();

process.exit(failed > 0 ? 1 : 0);
