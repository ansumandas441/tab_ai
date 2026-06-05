'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const INDEX_DIR = path.join(os.homedir(), '.tabai');
const INDEX_PATH = path.join(INDEX_DIR, 'rag-index.json');
const MAX_TEXT_LENGTH = 10000;
const SAVE_DEBOUNCE_MS = 5000;
const EMBED_MODEL = 'embeddinggemma';
const EMBED_BATCH_SIZE = 5; // max concurrent embedding requests

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','shall','would','should','can','could','may','might',
  'must','and','but','or','not','no','nor','for','to','of','in','on','at','by',
  'with','from','up','about','into','over','after','this','that','these','those',
  'it','its','i','me','my','we','our','you','your','he','she','they','them',
  'what','which','who','whom','when','where','how','why','all','each','every',
  'both','few','more','most','other','some','such','than','too','very','just',
  'also','now','so','if','then','here','there','out','new','one','two','only',
  'own','same','well','back','even','still','way','take','come','make','like',
  'get','go','see','know','say','think','look','want','give','use','find','tell',
  'ask','work','seem','feel','try','leave','call','need','become','keep','let',
  'begin','show','hear','play','run','move','live','believe','bring','happen',
  'write','provide','sit','stand','lose','pay','meet','include','continue','set',
  'learn','change','lead','understand','watch','follow','stop','create','speak',
  'read','allow','add','spend','grow','open','walk','win','offer','remember',
  'love','consider','appear','buy','wait','serve','die','send','expect','build',
  'stay','fall','cut','reach','kill','remain','was','were','been','being','had',
  'did','does','done','got','going','am','being','having','doing'
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function computeTermFrequency(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

// --- Index state ---
let documents = {};   // keyed by url
let df = {};          // document frequency per term
let docCount = 0;
let avgDocLength = 0;
let saveTimer = null;
let ollamaUrl = 'http://localhost:11434';
let embeddingsAvailable = null; // null = unknown, true/false after first check

function rebuildGlobals() {
  df = {};
  docCount = 0;
  let totalWords = 0;

  const urls = Object.keys(documents);
  docCount = urls.length;

  for (const url of urls) {
    const doc = documents[url];
    totalWords += doc.wordCount;
    const seen = new Set(Object.keys(doc.tf));
    for (const term of seen) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  avgDocLength = docCount > 0 ? totalWords / docCount : 0;
}

// --- Persistence ---

function ensureDir() {
  if (!fs.existsSync(INDEX_DIR)) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
  }
}

function load() {
  try {
    if (fs.existsSync(INDEX_PATH)) {
      const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
      const data = JSON.parse(raw);
      documents = data.documents || {};
      rebuildGlobals();
    }
  } catch (e) {
    console.error('[rag] Failed to load index:', e.message);
    documents = {};
    rebuildGlobals();
  }
}

function saveNow() {
  try {
    ensureDir();
    const tmpPath = INDEX_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify({ documents }, null, 0));
    fs.renameSync(tmpPath, INDEX_PATH);
  } catch (e) {
    console.error('[rag] Failed to save index:', e.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow();
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

// --- Core operations ---

function indexDocument({ url, title, text }) {
  if (!url || !text) return;

  const truncated = text.slice(0, MAX_TEXT_LENGTH);
  const tokens = tokenize(truncated);
  if (tokens.length === 0) return;

  const tf = computeTermFrequency(tokens);

  // Remove old df entries if this URL was already indexed
  if (documents[url]) {
    const oldTerms = new Set(Object.keys(documents[url].tf));
    for (const term of oldTerms) {
      if (df[term]) df[term]--;
      if (df[term] <= 0) delete df[term];
    }
    docCount--;
  }

  documents[url] = {
    url,
    title: title || '',
    content: truncated,
    indexedAt: Date.now(),
    tf,
    wordCount: tokens.length
  };

  // Update globals incrementally
  docCount++;
  const seen = new Set(Object.keys(tf));
  for (const term of seen) {
    df[term] = (df[term] || 0) + 1;
  }

  // Recalculate average
  let totalWords = 0;
  for (const u of Object.keys(documents)) {
    totalWords += documents[u].wordCount;
  }
  avgDocLength = docCount > 0 ? totalWords / docCount : 0;

  scheduleSave();
}

function bm25Score(queryTerms, doc) {
  const k1 = 1.2, b = 0.75;
  let score = 0;

  for (const term of queryTerms) {
    const termDf = df[term] || 0;
    if (termDf === 0) continue;

    const idf = Math.log((docCount - termDf + 0.5) / (termDf + 0.5) + 1);
    const termTf = doc.tf[term] || 0;
    const dl = doc.wordCount;
    score += idf * ((termTf * (k1 + 1)) / (termTf + k1 * (1 - b + b * (dl / avgDocLength))));
  }

  return score;
}

function extractSnippet(content, queryTerms, maxLen = 200) {
  const lower = content.toLowerCase();
  let bestPos = 0;

  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1) {
      bestPos = idx;
      break;
    }
  }

  const start = Math.max(0, bestPos - 50);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet += '...';

  return snippet;
}

function search(query, limit = 5) {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results = [];

  for (const url of Object.keys(documents)) {
    const doc = documents[url];
    const score = bm25Score(queryTerms, doc);
    if (score > 0) {
      results.push({
        url: doc.url,
        title: doc.title,
        score,
        snippet: extractSnippet(doc.content, queryTerms),
        indexedAt: doc.indexedAt
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function getDocument(url) {
  return documents[url] || null;
}

function cleanup(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const url of Object.keys(documents)) {
    if (documents[url].indexedAt < cutoff) {
      delete documents[url];
      removed++;
    }
  }

  if (removed > 0) {
    rebuildGlobals();
    saveNow();
  }

  return removed;
}

function getStats() {
  const urls = Object.keys(documents);
  let oldest = Infinity, newest = 0;

  for (const url of urls) {
    const t = documents[url].indexedAt;
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }

  return {
    docCount: urls.length,
    termCount: Object.keys(df).length,
    oldestDoc: urls.length > 0 ? new Date(oldest).toISOString() : null,
    newestDoc: urls.length > 0 ? new Date(newest).toISOString() : null
  };
}

// --- Embedding support (embeddinggemma via Ollama) ---

function setOllamaUrl(url) {
  ollamaUrl = url || 'http://localhost:11434';
}

async function checkEmbeddings() {
  if (embeddingsAvailable !== null) return embeddingsAvailable;
  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`);
    const data = await resp.json();
    embeddingsAvailable = (data.models || []).some(m => m.name.startsWith(EMBED_MODEL));
    if (embeddingsAvailable) console.error('[rag] embeddinggemma available — hybrid search enabled');
    else console.error('[rag] embeddinggemma not found — BM25 only');
  } catch {
    embeddingsAvailable = false;
  }
  return embeddingsAvailable;
}

async function embed(text) {
  if (!text) return null;
  try {
    const resp = await fetch(`${ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 2000) }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.embeddings?.[0] || null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Index a document and compute its embedding if embeddinggemma is available.
 * The embedding is computed asynchronously — the BM25 index updates immediately.
 */
async function indexDocumentWithEmbedding({ url, title, text }) {
  indexDocument({ url, title, text });

  // Asynchronously add embedding (don't block indexing)
  const hasEmbed = await checkEmbeddings();
  if (hasEmbed && documents[url]) {
    const combined = (title || '') + '. ' + (text || '').slice(0, 1500);
    const vec = await embed(combined);
    if (vec) {
      documents[url].embedding = vec;
      scheduleSave();
    }
  }
}

/**
 * Hybrid search: combines BM25 + cosine similarity on embeddings.
 * Falls back to BM25-only if embeddings are unavailable.
 *
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @param {number} alpha - BM25 weight (0-1). Embedding weight = 1-alpha. Default 0.5.
 */
async function hybridSearch(query, limit = 5, alpha = 0.5) {
  const bm25Results = search(query, limit * 2); // get more candidates for re-ranking

  const hasEmbed = await checkEmbeddings();
  if (!hasEmbed || bm25Results.length === 0) {
    return bm25Results.slice(0, limit);
  }

  // Check if any documents have embeddings
  const docsWithEmbeddings = bm25Results.filter(r => documents[r.url]?.embedding);
  if (docsWithEmbeddings.length === 0) {
    return bm25Results.slice(0, limit);
  }

  // Embed the query
  const queryVec = await embed(query);
  if (!queryVec) return bm25Results.slice(0, limit);

  // Normalize BM25 scores to 0-1
  const maxBm25 = Math.max(...bm25Results.map(r => r.score), 0.001);

  // Re-rank with hybrid score
  const hybrid = bm25Results.map(r => {
    const doc = documents[r.url];
    const bm25Norm = r.score / maxBm25;
    const cosine = doc?.embedding ? cosineSimilarity(queryVec, doc.embedding) : 0;
    const hybridScore = alpha * bm25Norm + (1 - alpha) * cosine;
    return { ...r, score: hybridScore, bm25Score: r.score, cosineScore: cosine };
  });

  hybrid.sort((a, b) => b.score - a.score);
  return hybrid.slice(0, limit);
}

module.exports = {
  load,
  save: saveNow,
  indexDocument,
  indexDocumentWithEmbedding,
  search,
  hybridSearch,
  embed,
  getDocument,
  cleanup,
  getStats,
  setOllamaUrl,
};
