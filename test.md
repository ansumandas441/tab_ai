# Pipeline Test Cases

Each test calls `runPipeline()` directly with mock tabs and a mock config (no real Ollama or bridge needed for client-side shortcut tests). Tests that require LLM or bridge calls should mock `fetch`.

## Mock Data

```javascript
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
```

---

## Test 1: Count all tabs
- **Command:** `"how many tabs do I have?"`
- **Expected action:** `{ action: 'answer', text: 'You have 8 tabs open.' }`
- **LLM calls:** 0

## Test 2: Count domain-specific tabs
- **Command:** `"how many github tabs do I have?"`
- **Expected action:** `{ action: 'answer', text: 'You have 2 github tabs open.' }`
- **LLM calls:** 0

## Test 3: List all tabs
- **Command:** `"what tabs do I have open?"`
- **Expected:** `action === 'answer'` and `text` contains `"8"` and `"tab"` and contains `"github.com"`
- **LLM calls:** 0

## Test 4: List domain-filtered tabs
- **Command:** `"show me my youtube tabs"`
- **Expected:** `action === 'answer'` and `text` contains `"1 youtube tab"` and `"Cat Videos"`
- **LLM calls:** 0

## Test 5: Close domain tabs
- **Command:** `"close all youtube tabs"`
- **Expected:** `{ action: 'close_tabs', targets: [1002], reason: 'Close youtube tabs' }`
- **LLM calls:** 0

## Test 6: Close domain tabs (multiple matches)
- **Command:** `"close github tabs"`
- **Expected:** `{ action: 'close_tabs', targets: [1001, 1005] }` with `reason` containing `"github"`
- **LLM calls:** 0

## Test 7: Close duplicate tabs
- **Command:** `"close duplicate tabs"`
- **Expected:** `{ action: 'close_duplicates', keep: 'first' }`
- **LLM calls:** 0

## Test 8: Close all except
- **Command:** `"close everything except github tabs"`
- **Expected:** `{ action: 'close_all_except', keep: [1001, 1005] }`
- **LLM calls:** 0

## Test 9: Navigate to single match
- **Command:** `"switch to the react tab"`
- **Expected:** `{ action: 'activate_tab', target: 1003 }`
- **LLM calls:** 0

## Test 10: Navigate to first match (multiple)
- **Command:** `"go to github"`
- **Expected:** `{ action: 'activate_tab', target: 1001 }`
- **LLM calls:** 0

## Test 11: Navigate positional - first tab
- **Command:** `"switch to the first tab"`
- **Expected:** `{ action: 'activate_tab', target: 1001 }`
- **LLM calls:** 0

## Test 12: Navigate positional - last tab
- **Command:** `"go to the last tab"`
- **Expected:** `{ action: 'activate_tab', target: 1008 }`
- **LLM calls:** 0

## Test 13: Navigate - no match
- **Command:** `"switch to the figma tab"`
- **Expected:** `action === 'answer'` and `text` contains `"No matching tab"`
- **LLM calls:** 0

## Test 14: Open explicit URL
- **Command:** `"open https://example.com"`
- **Expected:** `{ action: 'open_url', url: 'https://example.com' }`
- **LLM calls:** 0

## Test 15: Pin domain tabs
- **Command:** `"pin github tabs"`
- **Expected:** `{ action: 'pin_tabs', targets: [1001, 1005] }`
- **LLM calls:** 0

## Test 16: Unpin all tabs (no topic)
- **Command:** `"unpin all tabs"`
- **Expected:** `{ action: 'unpin_tabs' }` with `targets` being all 8 tab IDs
- **LLM calls:** 0

## Test 17: Mute domain tabs
- **Command:** `"mute youtube tabs"`
- **Expected:** `{ action: 'mute_tabs', targets: [1002] }`
- **LLM calls:** 0

## Test 18: Unmute tabs
- **Command:** `"unmute all tabs"`
- **Expected:** `{ action: 'unmute_tabs' }` with `targets` containing all 8 IDs
- **LLM calls:** 0

## Test 19: Bookmark domain tabs
- **Command:** `"bookmark github tabs"`
- **Expected:** `{ action: 'bookmark_tabs', targets: [1001, 1005] }`
- **LLM calls:** 0

## Test 20: Group tabs by domain
- **Command:** `"group tabs by domain"`
- **Expected:** `{ action: 'group_tabs', by: 'domain' }` with `targets` being all 8 IDs
- **LLM calls:** 0

## Test 21: Restore last closed tab
- **Command:** `"restore last closed tab"`
- **Expected:** `{ action: 'restore_last_closed', count: 1 }`
- **LLM calls:** 0

## Test 22: Restore last N closed tabs
- **Command:** `"restore 3 last closed tabs"`
- **Expected:** `{ action: 'restore_last_closed', count: 3 }`
- **LLM calls:** 0

## Test 23: Restore session
- **Command:** `"restore session"`
- **Expected:** `{ action: 'restore_session', index: 0 }`
- **LLM calls:** 0

## Test 24: Save session with label
- **Command:** `"save session as research"`
- **Expected:** `{ action: 'save_session', label: 'research' }`
- **LLM calls:** 0

## Test 25: List sessions
- **Command:** `"list sessions"`
- **Expected:** `{ action: 'list_sessions' }`
- **LLM calls:** 0

## Test 26: Show history
- **Command:** `"show history"`
- **Expected:** `{ action: 'list_history' }`
- **LLM calls:** 0

## Test 27: Summarize current tab
- **Command:** `"summarize this tab"`
- **Expected:** `{ action: 'summarize_tab', target: 'current' }`
- **LLM calls:** 0

## Test 28: Index all tabs
- **Command:** `"index all tabs"`
- **Expected:** `{ action: 'index_tabs', targets: 'all' }`
- **LLM calls:** 0

## Test 29: Search content
- **Command:** `"search content about authentication"`
- **Expected:** `{ action: 'search_content' }` with `query` containing `"authentication"`
- **LLM calls:** 0

## Test 30: Close non-existent domain (graceful no-op)
- **Command:** `"close all spotify tabs"`
- **Expected:** `action === 'answer'` and `text` contains `"No spotify tabs found"`
- **LLM calls:** 0
