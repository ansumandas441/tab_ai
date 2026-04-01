/**
 * Test cases for evaluating LLM performance on tabai commands.
 *
 * Each test case has:
 *   name    — short description
 *   command — natural language input (what the user types)
 *   expect  — what the LLM should return:
 *     action      — exact action type expected
 *     actionOneOf — array of acceptable action types (use instead of action)
 *     targets     — expected sequential tab IDs in targets array
 *     target      — expected single sequential tab ID
 *     keep        — expected sequential tab IDs in keep array (close_all_except)
 *     fields      — { key: value } or { key: validatorFn } for other fields
 *
 * Mock tabs use sequential IDs [1]-[10] as assigned by formatTabs:
 *   [1]  github.com/anthropics/claude     (active)
 *   [2]  youtube.com/watch?v=abc123       "Learn JavaScript in 10 min"
 *   [3]  youtube.com/watch?v=def456       "React Tutorial"
 *   [4]  stackoverflow.com/questions/...  "How to parse JSON in Node.js"
 *   [5]  mail.google.com                  "Inbox (3) - Gmail"  (pinned)
 *   [6]  twitter.com/home                 "Home / X"
 *   [7]  docs.google.com/document/...     "Meeting Notes - Google Docs"
 *   [8]  reddit.com/r/programming
 *   [9]  github.com/nodejs/node/issues
 *   [10] calendar.google.com              "Google Calendar"
 */

export const MOCK_TABS = [
  { id: 101, windowId: 1, index: 0, url: 'https://github.com/anthropics/claude', title: 'anthropics/claude - GitHub', pinned: false, active: true, audible: false, muted: false },
  { id: 102, windowId: 1, index: 1, url: 'https://www.youtube.com/watch?v=abc123', title: 'Learn JavaScript in 10 min - YouTube', pinned: false, active: false, audible: false, muted: false },
  { id: 103, windowId: 1, index: 2, url: 'https://www.youtube.com/watch?v=def456', title: 'React Tutorial - YouTube', pinned: false, active: false, audible: false, muted: false },
  { id: 104, windowId: 1, index: 3, url: 'https://stackoverflow.com/questions/12345', title: 'How to parse JSON in Node.js - Stack Overflow', pinned: false, active: false, audible: false, muted: false },
  { id: 105, windowId: 1, index: 4, url: 'https://mail.google.com/mail/u/0/', title: 'Inbox (3) - Gmail', pinned: true, active: false, audible: false, muted: false },
  { id: 106, windowId: 1, index: 5, url: 'https://twitter.com/home', title: 'Home / X', pinned: false, active: false, audible: false, muted: false },
  { id: 107, windowId: 1, index: 6, url: 'https://docs.google.com/document/d/abc', title: 'Meeting Notes - Google Docs', pinned: false, active: false, audible: false, muted: false },
  { id: 108, windowId: 1, index: 7, url: 'https://www.reddit.com/r/programming', title: 'r/programming - Reddit', pinned: false, active: false, audible: false, muted: false },
  { id: 109, windowId: 1, index: 8, url: 'https://github.com/nodejs/node/issues', title: 'Issues - nodejs/node - GitHub', pinned: false, active: false, audible: false, muted: false },
  { id: 110, windowId: 1, index: 9, url: 'https://calendar.google.com', title: 'Google Calendar', pinned: false, active: false, audible: false, muted: false },
];

export const TEST_CASES = [
  // ── Close actions ──────────────────────────────────────────────────────
  {
    name: 'Close YouTube tabs',
    command: 'close all youtube tabs',
    expect: {
      action: 'close_tabs',
      targets: [2, 3],
    },
  },
  {
    name: 'Close single tab by name',
    command: 'close the reddit tab',
    expect: {
      action: 'close_tabs',
      targets: [8],
    },
  },
  {
    name: 'Close Twitter tab',
    command: 'close the twitter tab',
    expect: {
      action: 'close_tabs',
      targets: [6],
    },
  },
  {
    name: 'Close GitHub tabs',
    command: 'close all github tabs',
    expect: {
      action: 'close_tabs',
      targets: [1, 9],
    },
  },
  {
    name: 'Close all except Gmail',
    command: 'close all tabs except gmail',
    expect: {
      action: 'close_all_except',
      keep: [5],
    },
  },
  {
    name: 'Close duplicate tabs',
    command: 'close duplicate tabs',
    expect: {
      action: 'close_duplicates',
    },
  },

  // ── Informational queries (must NOT mutate) ────────────────────────────
  {
    name: 'What tabs are open',
    command: 'what tabs do I have open?',
    expect: {
      actionOneOf: ['answer', 'search_tabs'],
    },
  },
  {
    name: 'Count tabs',
    command: 'how many tabs do I have?',
    expect: {
      action: 'answer',
    },
  },
  {
    name: 'Do I have GitHub tabs',
    command: 'do I have any github tabs open?',
    expect: {
      actionOneOf: ['answer', 'search_tabs'],
    },
  },
  {
    name: 'Find StackOverflow tab',
    command: 'find my stackoverflow tab',
    expect: {
      actionOneOf: ['answer', 'search_tabs', 'activate_tab', 'search_content'],
    },
  },

  // ── Navigation ─────────────────────────────────────────────────────────
  {
    name: 'Switch to Gmail',
    command: 'switch to the gmail tab',
    expect: {
      action: 'activate_tab',
      target: 5,
    },
  },
  {
    name: 'Go to Calendar tab',
    command: 'go to my calendar tab',
    expect: {
      action: 'activate_tab',
      target: 10,
    },
  },

  // ── Organization ───────────────────────────────────────────────────────
  {
    name: 'Pin Gmail tab',
    command: 'pin the gmail tab',
    expect: {
      action: 'pin_tabs',
      targets: [5],
    },
  },
  {
    name: 'Unpin all tabs',
    command: 'unpin all tabs',
    expect: {
      action: 'unpin_tabs',
    },
  },
  {
    name: 'Group by domain',
    command: 'group tabs by domain',
    expect: {
      action: 'group_tabs',
      fields: { by: 'domain' },
    },
  },
  {
    name: 'Mute YouTube tabs',
    command: 'mute the youtube tabs',
    expect: {
      action: 'mute_tabs',
      targets: [2, 3],
    },
  },
  {
    name: 'Bookmark all tabs',
    command: 'bookmark all open tabs',
    expect: {
      action: 'bookmark_tabs',
    },
  },

  // ── Open ───────────────────────────────────────────────────────────────
  {
    name: 'Open a URL',
    command: 'open github.com',
    expect: {
      action: 'open_url',
      fields: { url: (v) => typeof v === 'string' && v.includes('github') },
    },
  },

  // ── Sessions & history ─────────────────────────────────────────────────
  {
    name: 'Restore last closed',
    command: 'restore the last tab I closed',
    expect: {
      action: 'restore_last_closed',
    },
  },
  {
    name: 'Save session',
    command: 'save this session',
    expect: {
      action: 'save_session',
    },
  },

  // ── Misc ───────────────────────────────────────────────────────────────
  {
    name: 'Reload all tabs',
    command: 'reload all tabs',
    expect: {
      action: 'reload_tabs',
    },
  },
  {
    name: 'Duplicate current tab',
    command: 'duplicate this tab',
    expect: {
      action: 'duplicate_tab',
    },
  },

  // ── Natural language (no clear action keyword) ────────────────────────
  {
    name: 'NL: get rid of youtube',
    command: "get rid of the youtube tabs",
    expect: {
      action: 'close_tabs',
      targets: [2, 3],
    },
  },
  {
    name: "NL: I'm done with twitter",
    command: "I'm done with twitter",
    expect: {
      action: 'close_tabs',
      targets: [6],
    },
  },
  {
    name: 'NL: keep only gmail',
    command: 'keep only gmail',
    expect: {
      action: 'close_all_except',
      keep: [5],
    },
  },
  {
    name: 'NL: take me to github',
    command: 'take me to my github',
    expect: {
      action: 'activate_tab',
      target: 1,
    },
  },
  {
    name: 'NL: the noisy one',
    command: 'the noisy one, shut it up',
    expect: {
      action: 'mute_tabs',
    },
  },
  {
    name: 'NL: sort tabs by site',
    command: 'sort my tabs by site',
    expect: {
      action: 'group_tabs',
    },
  },
  {
    name: 'NL: save my work',
    command: 'save my work',
    expect: {
      action: 'save_session',
    },
  },
  {
    name: 'NL: old tabs back',
    command: 'I need my old tabs back',
    expect: {
      action: 'restore_last_closed',
    },
  },
  {
    name: 'NL: too many tabs',
    command: 'too many tabs, clean up',
    expect: {
      action: 'close_duplicates',
    },
  },
  {
    name: 'NL: bring up stackoverflow',
    command: 'bring up the stackoverflow tab',
    expect: {
      action: 'activate_tab',
      target: 4,
    },
  },
];
