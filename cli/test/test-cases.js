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

  // ── Content / RAG indexing ────────────────────────────────────────────
  {
    name: 'Document all tabs content',
    command: 'Please document all the tabs content',
    expect: {
      action: 'index_tabs',
      fields: { targets: 'all' },
    },
  },
  {
    name: 'Document tabs',
    command: 'document all tabs',
    expect: {
      action: 'index_tabs',
      fields: { targets: 'all' },
    },
  },
  {
    name: 'Index all tabs',
    command: 'index all tabs',
    expect: {
      action: 'index_tabs',
      fields: { targets: 'all' },
    },
  },
  {
    name: 'Read all tabs into RAG',
    command: 'read all tabs',
    expect: {
      action: 'index_tabs',
      fields: { targets: 'all' },
    },
  },
  {
    name: 'Which tab talks about X',
    command: 'Which tab talks about machine learning?',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.includes('machine') && v.includes('learning') },
    },
  },
  {
    name: 'What tab is about X',
    command: 'What tab is about neural networks?',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.includes('neural') },
    },
  },
  {
    name: 'Tab that discusses X',
    command: 'do I have a tab about kubernetes?',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.includes('kubernetes') },
    },
  },
  {
    name: 'Open tab that talks about X',
    command: 'Please open the tab which talks about machine learning',
    expect: {
      action: 'open_from_search',
      fields: { query: (v) => typeof v === 'string' && v.includes('machine') && v.includes('learning') },
    },
  },
  {
    name: 'Open all tabs about X',
    command: 'open all tabs about kubernetes',
    expect: {
      action: 'open_from_search',
      fields: {
        query: (v) => typeof v === 'string' && v.includes('kubernetes'),
        all: true,
      },
    },
  },
  {
    name: 'Summarize current tab',
    command: 'summarize this tab',
    expect: {
      action: 'summarize_tab',
    },
  },
  {
    name: 'Search page content',
    command: 'search content for kubernetes',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.includes('kubernetes') },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 1. Close — Verb Synonyms & Domain Filtering ────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Close: remove reddit',
    command: 'remove the reddit tab',
    expect: { action: 'close_tabs', targets: [8] },
  },
  {
    name: 'Close: kill twitter',
    command: 'kill the twitter tab',
    expect: { action: 'close_tabs', targets: [6] },
  },
  {
    name: 'Close: delete stackoverflow',
    command: 'delete the stackoverflow tab',
    expect: { action: 'close_tabs', targets: [4] },
  },
  {
    name: 'Close: please close youtube',
    command: 'please close all youtube tabs',
    expect: { action: 'close_tabs', targets: [2, 3] },
  },
  {
    name: 'Close: react keyword match',
    command: 'close the react tutorial tab',
    expect: { action: 'close_tabs', targets: [3] },
  },
  {
    name: 'Close: javascript keyword match',
    command: 'close the javascript tab',
    expect: { action: 'close_tabs', targets: [2] },
  },
  {
    name: 'Close: all tabs',
    command: 'close all tabs',
    expect: { action: 'close_tabs', targets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  },
  {
    name: 'Close: kill all github',
    command: 'kill all github tabs now',
    expect: { action: 'close_tabs', targets: [1, 9] },
  },
  {
    name: 'Close: all google tabs',
    command: 'close all google tabs',
    expect: { action: 'close_tabs', targets: [5, 7, 10] },
  },
  {
    name: 'Close: remove all youtube',
    command: 'remove all youtube tabs',
    expect: { action: 'close_tabs', targets: [2, 3] },
  },
  {
    name: 'Close: delete all github',
    command: 'delete all github tabs',
    expect: { action: 'close_tabs', targets: [1, 9] },
  },
  {
    name: 'Close: calendar tab',
    command: 'close the calendar tab',
    expect: { action: 'close_tabs', targets: [10] },
  },
  {
    name: 'Close: remove gmail',
    command: 'remove the gmail tab',
    expect: { action: 'close_tabs', targets: [5] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 2. Close All Except / Keep ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Except: everything except github',
    command: 'close everything except github',
    expect: { action: 'close_all_except', keep: [1, 9] },
  },
  {
    name: 'Except: all but youtube',
    command: 'close all but youtube',
    expect: { action: 'close_all_except', keep: [2, 3] },
  },
  {
    name: 'Except: but keep gmail',
    command: 'close all tabs but keep gmail',
    expect: { action: 'close_all_except', keep: [5] },
  },
  {
    name: 'Except: but not github',
    command: 'close everything but not github tabs',
    expect: { action: 'close_all_except', keep: [1, 9] },
  },
  {
    name: 'Except: all except google',
    command: 'close all except google tabs',
    expect: { action: 'close_all_except', keep: [5, 7, 10] },
  },
  {
    name: 'Except: but keep twitter',
    command: 'close tabs but keep twitter',
    expect: { action: 'close_all_except', keep: [6] },
  },
  {
    name: 'Except: except reddit tab',
    command: 'close everything except the reddit tab',
    expect: { action: 'close_all_except', keep: [8] },
  },
  {
    name: 'Except: all but gmail',
    command: 'close all but the gmail tab',
    expect: { action: 'close_all_except', keep: [5] },
  },
  {
    name: 'NL: keep only calendar',
    command: 'keep only the calendar tab',
    expect: { action: 'close_all_except', keep: [10] },
  },
  {
    name: 'NL: only keep youtube',
    command: 'only keep youtube',
    expect: { action: 'close_all_except', keep: [2, 3] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 3. Close Duplicates ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Dedup: deduplicate',
    command: 'deduplicate my tabs',
    expect: { actionOneOf: ['close_duplicates', 'answer'] },
  },
  {
    name: 'Dedup: remove duplicate',
    command: 'remove duplicate tabs',
    expect: { action: 'close_duplicates' },
  },
  {
    name: 'Dedup: close the dupes',
    command: 'close all the dupes',
    expect: { actionOneOf: ['close_duplicates', 'close_tabs'] },
  },
  {
    name: 'Dedup: delete duplicated',
    command: 'delete duplicated tabs please',
    expect: { action: 'close_duplicates' },
  },
  {
    name: 'Dedup: kill duplicate',
    command: 'kill any duplicate tabs',
    expect: { action: 'close_duplicates' },
  },
  {
    name: 'Dedup: close all duplicate',
    command: 'close all duplicate tabs',
    expect: { action: 'close_duplicates' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 4. NL Close Idioms ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'NL close: don\'t need youtube',
    command: "I don't need youtube anymore",
    expect: { action: 'close_tabs', targets: [2, 3] },
  },
  {
    name: 'NL close: done with reddit',
    command: 'done with reddit',
    expect: { action: 'close_tabs', targets: [8] },
  },
  {
    name: 'NL close: get rid of stackoverflow',
    command: 'get rid of the stackoverflow tab',
    expect: { action: 'close_tabs', targets: [4] },
  },
  {
    name: 'NL close: nuke twitter',
    command: 'nuke the twitter tab',
    expect: { action: 'close_tabs', targets: [6] },
  },
  {
    name: 'NL close: clear out youtube',
    command: 'clear out all youtube tabs',
    expect: { action: 'close_tabs', targets: [2, 3] },
  },
  {
    name: 'NL close: wipe github',
    command: 'wipe the github tabs',
    expect: { action: 'close_tabs', targets: [1, 9] },
  },
  {
    name: 'NL close: don\'t need github',
    command: "don't need github tabs anymore",
    expect: { action: 'close_tabs', targets: [1, 9] },
  },
  {
    name: 'NL close: get rid of google',
    command: 'get rid of all google tabs',
    expect: { action: 'close_tabs', targets: [5, 7, 10] },
  },
  {
    name: 'NL close: don\'t need reddit',
    command: "I don't need reddit",
    expect: { action: 'close_tabs', targets: [8] },
  },
  {
    name: 'NL close: get rid of calendar',
    command: 'get rid of the calendar tab',
    expect: { action: 'close_tabs', targets: [10] },
  },
  {
    name: 'NL close: done with youtube',
    command: "I'm done with the youtube tabs",
    expect: { action: 'close_tabs', targets: [2, 3] },
  },
  {
    name: 'NL close: clean up duplicates',
    command: 'clean up duplicate tabs',
    expect: { actionOneOf: ['close_duplicates', 'duplicate_tab'] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 5. Navigate — Verb Forms & Positional ──────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Nav: switch to reddit',
    command: 'switch to reddit',
    expect: { action: 'activate_tab', target: 8 },
  },
  {
    name: 'Nav: go to github',
    command: 'go to the github tab',
    expect: { action: 'activate_tab', target: 1 },
  },
  {
    name: 'Nav: focus on stackoverflow',
    command: 'focus on stackoverflow',
    expect: { action: 'activate_tab', target: 4 },
  },
  {
    name: 'Nav: activate youtube',
    command: 'activate the youtube tab',
    expect: { action: 'activate_tab', target: 2 },
  },
  {
    name: 'Nav: go to first tab',
    command: 'go to the first tab',
    expect: { action: 'activate_tab', target: 1 },
  },
  {
    name: 'Nav: go to last tab',
    command: 'go to the last tab',
    expect: { action: 'activate_tab', target: 10 },
  },
  {
    name: 'Nav: switch to second tab',
    command: 'switch to the second tab',
    expect: { action: 'activate_tab', target: 2 },
  },
  {
    name: 'Nav: switch to third tab',
    command: 'switch to the third tab',
    expect: { action: 'activate_tab', target: 3 },
  },
  {
    name: 'Nav: go to fifth tab',
    command: 'go to the fifth tab',
    expect: { action: 'activate_tab', target: 5 },
  },
  {
    name: 'Nav: switch to google (first match)',
    command: 'switch to my google docs tab',
    expect: { action: 'activate_tab', target: 5 },
  },
  {
    name: 'Nav: node issues keyword',
    command: 'switch to the node issues tab',
    expect: { action: 'activate_tab', target: 4 },
  },
  {
    name: 'Nav: go to twitter',
    command: 'go to the twitter tab',
    expect: { action: 'activate_tab', target: 6 },
  },
  {
    name: 'Nav: switch to calendar',
    command: 'switch to calendar',
    expect: { action: 'activate_tab', target: 10 },
  },
  {
    name: 'Nav: focus on reddit',
    command: 'focus on the reddit tab',
    expect: { action: 'activate_tab', target: 8 },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 6. NL Navigate Idioms ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'NL nav: take me to reddit',
    command: 'take me to reddit',
    expect: { action: 'activate_tab', target: 8 },
  },
  {
    name: 'NL nav: bring up gmail',
    command: 'bring up the gmail tab',
    expect: { action: 'activate_tab', target: 5 },
  },
  {
    name: 'NL nav: pull up calendar',
    command: 'pull up the calendar',
    expect: { action: 'activate_tab', target: 10 },
  },
  {
    name: 'NL nav: let me see twitter',
    command: 'let me see twitter',
    expect: { action: 'activate_tab', target: 6 },
  },
  {
    name: 'NL nav: take me to stackoverflow',
    command: 'take me to stackoverflow',
    expect: { action: 'activate_tab', target: 4 },
  },
  {
    name: 'NL nav: bring up github',
    command: 'bring up github',
    expect: { action: 'activate_tab', target: 1 },
  },
  {
    name: 'NL nav: take me to youtube',
    command: 'take me to the youtube tab',
    expect: { action: 'activate_tab', target: 2 },
  },
  {
    name: 'NL nav: pull up reddit',
    command: 'pull up the reddit tab',
    expect: { action: 'activate_tab', target: 8 },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 7. Open — URL_MAP Sites ────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Open: youtube',
    command: 'open youtube',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('youtube') } },
  },
  {
    name: 'Open: reddit.com',
    command: 'open reddit.com',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('reddit') } },
  },
  {
    name: 'Open: hacker news',
    command: 'open hacker news',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('ycombinator') } },
  },
  {
    name: 'Open: new tab',
    command: 'open a new tab',
    expect: { action: 'open_new_tabs', fields: { count: 1 } },
  },
  {
    name: 'Open: 3 new tabs',
    command: 'open 3 new tabs',
    expect: { action: 'open_new_tabs', fields: { count: 3 } },
  },
  {
    name: 'Open: blank tab',
    command: 'open a blank tab',
    expect: { action: 'open_new_tabs' },
  },
  {
    name: 'Open: linkedin',
    command: 'open linkedin',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('linkedin') } },
  },
  {
    name: 'Open: notion',
    command: 'open notion',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('notion') } },
  },
  {
    name: 'Open: slack',
    command: 'open slack',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('slack') } },
  },
  {
    name: 'Open: stackoverflow.com',
    command: 'open stackoverflow.com',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('stackoverflow') } },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 8. Open — "open the X tab" (deterministic open_url via URL_MAP) ────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Open-tab trap: github',
    command: 'open the github tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('github') } },
  },
  {
    name: 'Open-tab trap: gmail',
    command: 'open my gmail tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('google') } },
  },
  {
    name: 'Open-tab trap: reddit',
    command: 'open the reddit tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('reddit') } },
  },
  {
    name: 'Open-tab trap: youtube',
    command: 'open the youtube tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('youtube') } },
  },
  {
    name: 'Open-tab trap: calendar',
    command: 'open my calendar tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('calendar') } },
  },
  {
    name: 'Open-tab trap: twitter',
    command: 'open the twitter tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('twitter') } },
  },
  {
    name: 'Open-tab trap: stackoverflow',
    command: 'open the stackoverflow tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('stackoverflow') } },
  },
  {
    name: 'Open-tab trap: my github',
    command: 'open my github tab',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('github') } },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 9. Open — "open the tab about X" (content L1 → open_from_search) ──
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Open-content: tab about react hooks',
    command: 'open the tab that talks about react hooks',
    expect: { action: 'open_from_search', fields: { query: (v) => typeof v === 'string' && v.includes('react') } },
  },
  {
    name: 'Open-content: tab discussing docker',
    command: 'open the tab discussing docker',
    expect: { actionOneOf: ['open_from_search', 'activate_tab'] },
  },
  {
    name: 'Open-content: tab mentions auth',
    command: 'open the tab that mentions authentication',
    expect: { actionOneOf: ['open_from_search', 'answer'] },
  },
  {
    name: 'Open-content: all tabs about testing',
    command: 'open all tabs about testing',
    expect: { action: 'open_from_search', fields: { all: true } },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 10. Open Multi-URL & Raw URL ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Open: multi-URL with and',
    command: 'open github and youtube and reddit',
    expect: { action: 'open_urls' },
  },
  {
    name: 'Open: raw URL',
    command: 'open https://docs.python.org',
    expect: { action: 'open_url', fields: { url: (v) => typeof v === 'string' && v.includes('docs.python.org') } },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 11. Info — Counting & Listing ──────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Info: count my tabs',
    command: 'count my tabs',
    expect: { action: 'answer' },
  },
  {
    name: 'Info: how many youtube',
    command: 'how many youtube tabs do I have?',
    expect: { action: 'answer' },
  },
  {
    name: 'Info: list all tabs',
    command: 'list all tabs',
    expect: { action: 'answer' },
  },
  {
    name: 'Info: what tabs open',
    command: 'what tabs are open right now?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info: which tabs open',
    command: 'which tabs are open?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info: any reddit tabs',
    command: 'do I have any reddit tabs?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info: any github tabs',
    command: 'are there any github tabs?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info: how many github',
    command: 'how many github tabs are open?',
    expect: { action: 'answer' },
  },
  {
    name: 'Info: list my open tabs',
    command: 'list my open tabs',
    expect: { action: 'answer' },
  },
  {
    name: 'Info: tell me tabs',
    command: 'tell me what tabs I have',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info: show me tabs',
    command: 'show me my tabs',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 12. Info — "open" Trap (info before open) ──────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Info-open trap: which currently open',
    command: 'which tabs are currently open?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info-open trap: list open tabs',
    command: 'list open tabs',
    expect: { action: 'answer' },
  },
  {
    name: 'Info-open trap: any tabs open',
    command: 'do I have any tabs open?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info-open trap: show all open',
    command: 'show me all open tabs',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info-open trap: what do I have open',
    command: 'what do I have open?',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 13. Pin / Unpin ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Pin: github tabs',
    command: 'pin the github tabs',
    expect: { action: 'pin_tabs', targets: [1, 9] },
  },
  {
    name: 'Pin: reddit tab',
    command: 'pin the reddit tab',
    expect: { action: 'pin_tabs', targets: [8] },
  },
  {
    name: 'Pin: all tabs',
    command: 'pin all tabs',
    expect: { action: 'pin_tabs', targets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  },
  {
    name: 'Unpin: gmail tab',
    command: 'unpin the gmail tab',
    expect: { action: 'unpin_tabs', targets: [5] },
  },
  {
    name: 'Unpin: youtube tabs',
    command: 'unpin the youtube tabs',
    expect: { action: 'unpin_tabs', targets: [2, 3] },
  },
  {
    name: 'Pin: stackoverflow',
    command: 'pin stackoverflow',
    expect: { action: 'pin_tabs', targets: [4] },
  },
  {
    name: 'Pin: twitter tab',
    command: 'pin the twitter tab',
    expect: { action: 'pin_tabs', targets: [6] },
  },
  {
    name: 'Pin: all google tabs',
    command: 'pin all google tabs',
    expect: { action: 'pin_tabs', targets: [5, 7, 10] },
  },
  {
    name: 'Unpin: google tabs',
    command: 'unpin google tabs',
    expect: { action: 'unpin_tabs', targets: [5, 7, 10] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 14. Mute / Unmute ──────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Mute: all tabs',
    command: 'mute all tabs',
    expect: { action: 'mute_tabs' },
  },
  {
    name: 'Unmute: youtube tabs',
    command: 'unmute the youtube tabs',
    expect: { action: 'unmute_tabs', targets: [2, 3] },
  },
  {
    name: 'Mute: reddit tab',
    command: 'mute the reddit tab',
    expect: { action: 'mute_tabs', targets: [8] },
  },
  {
    name: 'Unmute: all tabs',
    command: 'unmute all tabs',
    expect: { action: 'unmute_tabs' },
  },
  {
    name: 'Mute: github tabs',
    command: 'mute the github tabs',
    expect: { action: 'mute_tabs', targets: [1, 9] },
  },
  {
    name: 'NL mute: quiet youtube',
    command: 'quiet the youtube tabs',
    expect: { action: 'mute_tabs', targets: [2, 3] },
  },
  {
    name: 'NL mute: silence twitter',
    command: 'silence the twitter tab',
    expect: { action: 'mute_tabs', targets: [6] },
  },
  {
    name: 'Mute: google tabs',
    command: 'mute the google tabs',
    expect: { action: 'mute_tabs', targets: [5, 7, 10] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 15. Group, Bookmark, Reload, Duplicate, Discard ────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Group: all by domain',
    command: 'group all tabs by domain',
    expect: { action: 'group_tabs', fields: { by: 'domain' } },
  },
  {
    name: 'Bookmark: github tabs',
    command: 'bookmark the github tabs',
    expect: { action: 'bookmark_tabs', targets: [1, 9] },
  },
  {
    name: 'Reload: github tabs',
    command: 'reload the github tabs',
    expect: { action: 'reload_tabs', targets: [1, 9] },
  },
  {
    name: 'Refresh: all tabs',
    command: 'refresh all tabs',
    expect: { action: 'reload_tabs' },
  },
  {
    name: 'Duplicate: current tab',
    command: 'duplicate the current tab',
    expect: { action: 'duplicate_tab' },
  },
  {
    name: 'Discard: youtube tabs',
    command: 'discard the youtube tabs',
    expect: { action: 'discard_tabs', targets: [2, 3] },
  },
  {
    name: 'Reload: stackoverflow',
    command: 'reload the stackoverflow tab',
    expect: { action: 'reload_tabs', targets: [4] },
  },
  {
    name: 'Bookmark: youtube tabs',
    command: 'bookmark the youtube tabs',
    expect: { action: 'bookmark_tabs', targets: [2, 3] },
  },
  {
    name: 'Reload: google tabs',
    command: 'reload google tabs',
    expect: { action: 'reload_tabs', targets: [5, 7, 10] },
  },
  {
    name: 'Discard: all tabs',
    command: 'discard all tabs',
    expect: { action: 'discard_tabs' },
  },
  {
    name: 'Refresh: reddit tab',
    command: 'refresh the reddit tab',
    expect: { action: 'reload_tabs', targets: [8] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 16. NL Organize Idioms ─────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'NL org: tidy up tabs',
    command: 'tidy up my tabs',
    expect: { action: 'group_tabs' },
  },
  {
    name: 'NL org: arrange tabs',
    command: 'arrange my tabs',
    expect: { action: 'group_tabs' },
  },
  {
    name: 'NL org: organize tabs',
    command: 'organize tabs',
    expect: { action: 'group_tabs' },
  },
  {
    name: 'NL org: save this page',
    command: 'save this page for later',
    expect: { action: 'bookmark_tabs' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 17. Session & History ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Session: save as label',
    command: 'save this session as "morning work"',
    expect: {
      action: 'save_session',
      fields: { label: (v) => typeof v === 'string' && v.includes('morning') },
    },
  },
  {
    name: 'Session: save current',
    command: 'save the current session',
    expect: { action: 'save_session' },
  },
  {
    name: 'Session: restore last 3',
    command: 'restore the last 3 closed tabs',
    expect: { action: 'restore_last_closed', fields: { count: 3 } },
  },
  {
    name: 'Session: undo last close',
    command: 'undo my last close',
    expect: { action: 'restore_last_closed' },
  },
  {
    name: 'Session: restore named session',
    command: 'restore session "morning work"',
    expect: { action: 'restore_session' },
  },
  {
    name: 'Session: list saved sessions',
    command: 'list my saved sessions',
    expect: { actionOneOf: ['list_sessions', 'answer'] },
  },
  {
    name: 'Session: show sessions',
    command: 'show my sessions',
    expect: { actionOneOf: ['list_sessions', 'answer'] },
  },
  {
    name: 'Session: show history',
    command: 'show my history',
    expect: { action: 'list_history' },
  },
  {
    name: 'Session: search history',
    command: 'search history for github',
    expect: {
      action: 'search_history',
      fields: { query: (v) => typeof v === 'string' && v.includes('github') },
    },
  },
  {
    name: 'Session: restore last 5',
    command: 'restore last 5 tabs',
    expect: { action: 'restore_last_closed', fields: { count: 5 } },
  },
  {
    name: 'NL session: bring back tabs',
    command: 'bring back my tabs',
    expect: { action: 'restore_last_closed' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 18. Content/RAG — Index & Summarize ────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Content: index tab 3',
    command: 'index tab 3',
    expect: { action: 'index_tabs' },
  },
  {
    name: 'Content: load all content',
    command: 'load all tab content',
    expect: { action: 'index_tabs', fields: { targets: 'all' } },
  },
  {
    name: 'Content: document the tabs',
    command: 'document the tabs',
    expect: { action: 'index_tabs' },
  },
  {
    name: 'Content: index youtube tabs',
    command: 'index the youtube tabs',
    expect: { actionOneOf: ['index_tabs', 'answer'] },
  },
  {
    name: 'Content: summarize this page',
    command: 'summarize this page',
    expect: { action: 'summarize_tab' },
  },
  {
    name: 'Content: what is this page about',
    command: 'what is this page about?',
    expect: { actionOneOf: ['summarize_tab', 'search_content'] },
  },
  {
    name: 'Content: summarize tab 5',
    command: 'summarize tab 5',
    expect: { action: 'summarize_tab', fields: { target: 5 } },
  },
  {
    name: 'Content: summarise (British)',
    command: 'summarise this tab',
    expect: { action: 'summarize_tab' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 19. Content/RAG — Search Content ───────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Content search: react',
    command: 'search content for react',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.includes('react') },
    },
  },
  {
    name: 'Content search: which tab docker',
    command: 'which tab talks about docker?',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.includes('docker') },
    },
  },
  {
    name: 'Content search: CSS frameworks',
    command: 'what tab is about CSS frameworks?',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.toLowerCase().includes('css') },
    },
  },
  {
    name: 'Content search: websockets',
    command: 'which tab discusses websockets?',
    expect: { actionOneOf: ['search_content', 'answer'] },
  },
  {
    name: 'Content search: kubernetes',
    command: 'what tab mentions kubernetes?',
    expect: { actionOneOf: ['search_content', 'answer'] },
  },
  {
    name: 'NL content: which page typescript',
    command: 'which page talks about typescript?',
    expect: { actionOneOf: ['search_content', 'answer'] },
  },
  {
    name: 'NL content: where did I read webpack',
    command: 'where did I read about webpack?',
    expect: { action: 'search_content' },
  },
  {
    name: 'NL content: do any tabs mention python',
    command: 'do any tabs mention python?',
    expect: { action: 'search_content' },
  },
  {
    name: 'NL content: anything about databases',
    command: 'anything about databases in my tabs?',
    expect: { action: 'search_content' },
  },
  {
    name: 'Content search: GraphQL',
    command: 'which tab is about GraphQL?',
    expect: {
      action: 'search_content',
      fields: { query: (v) => typeof v === 'string' && v.toLowerCase().includes('graphql') },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 20. Polite / Casual / Terse Variations ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Polite: please close reddit',
    command: 'could you please close the reddit tab?',
    expect: { action: 'close_tabs', targets: [8] },
  },
  {
    name: 'Casual: yo close youtube',
    command: 'yo close youtube',
    expect: { action: 'close_tabs', targets: [2, 3] },
  },
  {
    name: 'Terse: close reddit',
    command: 'close reddit',
    expect: { action: 'close_tabs', targets: [8] },
  },
  {
    name: 'Terse: mute youtube',
    command: 'mute youtube',
    expect: { action: 'mute_tabs', targets: [2, 3] },
  },
  {
    name: 'Polite: bookmark all please',
    command: 'can you bookmark all my tabs please?',
    expect: { action: 'bookmark_tabs' },
  },
  {
    name: 'Polite: please pin gmail',
    command: 'please pin the gmail tab',
    expect: { action: 'pin_tabs', targets: [5] },
  },
  {
    name: 'Casual: just close twitter',
    command: 'just close twitter',
    expect: { action: 'close_tabs', targets: [6] },
  },
  {
    name: 'Polite: reload stackoverflow please',
    command: 'reload stackoverflow please',
    expect: { action: 'reload_tabs', targets: [4] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ── 21. Ambiguous / AI-Dependent ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'Ambiguous: save this',
    command: 'save this',
    expect: { actionOneOf: ['save_session', 'bookmark_tabs', 'answer'] },
  },
  {
    name: 'Ambiguous: restore my tabs',
    command: 'restore my tabs',
    expect: { actionOneOf: ['restore_last_closed', 'restore_session'] },
  },
  {
    name: 'NL nav: that react thing',
    command: 'that react thing',
    expect: { action: 'activate_tab', target: 3 },
  },
  {
    name: 'AI: finished with stackoverflow',
    command: 'finished with stackoverflow',
    expect: { actionOneOf: ['close_tabs', 'activate_tab', 'answer'] },
  },
  {
    name: 'AI: the JSON one',
    command: 'the JSON one',
    expect: { actionOneOf: ['activate_tab', 'search_content', 'answer'] },
  },
  {
    name: 'NL info: status',
    command: 'status',
    expect: { actionOneOf: ['answer', 'search_tabs'] },
  },
  {
    name: 'Info: how many tabs',
    command: 'how many tabs are there?',
    expect: { action: 'answer' },
  },
];
