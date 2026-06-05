# Research: Optimizing qwen3.5:2b for TabAI Structured JSON Output

Research conducted 2026-03-13 to improve LLM reliability for the TabAI CLI tool.

## Model Specifications

- **Model:** qwen3.5:2b (actually Qwen3-1.7B, 1.4B non-embedding parameters, Q8_0 quantization)
- **Context window:** 32,768 tokens (32k)
- **Current token usage:** ~2,500-3,000 tokens per prompt (~10% of window) — context is NOT a bottleneck

## Critical Finding: Temperature Setting

The official Qwen3 documentation on HuggingFace explicitly warns:

> **"DO NOT use greedy decoding"** — causes performance degradation and endless repetitions.

We were using `temperature: 0` (greedy decoding), directly contradicting official guidance.

### Official Recommended Settings (Non-Thinking Mode)

| Parameter | Official | For JSON Output | Previous |
|-----------|----------|----------------|----------|
| temperature | 0.7 | **0.3** | 0 |
| top_p | 0.8 | **0.9** | unset |
| top_k | 20 | **20** | unset |
| min_p | 0 | 0 | unset |

If endless repetitions occur, add `presence_penalty: 1.5` (note: higher values may cause language mixing in multilingual models).

## Ollama `format: "json"` — Highest-Impact Change

Ollama supports a `format` parameter that constrains output to valid JSON at the **token generation level** using grammar-based sampling. This is not a prompt hint — it structurally prevents the model from generating non-JSON tokens.

### What It Eliminates

- Markdown code fences wrapping JSON
- Preamble text before the JSON object
- Trailing explanations after the JSON
- Thinking tags leaking into output
- Structurally malformed JSON (missing braces, trailing commas, unquoted keys)

### Basic Usage

```javascript
format: "json"
```

### Advanced: JSON Schema Mode (Ollama 0.5+)

```javascript
format: {
  type: "object",
  properties: {
    action: { type: "string" },
    targets: { type: "array", items: { type: "integer" } },
    target: {},
    query: { type: "string" },
    url: { type: "string" },
    text: { type: "string" },
    reason: { type: "string" },
    keep: {},
    count: { type: "integer" },
    by: { type: "string" },
    name: { type: "string" },
    folder: { type: "string" },
    label: { type: "string" },
    index: { type: "integer" },
    all: { type: "boolean" }
  },
  required: ["action"]
}
```

**Caveat:** `format: "json"` guarantees syntactically valid JSON but does NOT guarantee semantically correct actions. Client-side validation remains important.

## Thinking Tags — Known Risk with Qwen3

All Qwen3 models have built-in "thinking mode" generating `<think>...</think>` blocks before responses, enabled by default.

### Mitigations Applied

- `body.think = false` at Ollama API level
- `"Do not use thinking tags."` in system prompt

### Bug Found and Fixed

The `retryParse()` function was missing `think: false` on the retry body. If the first call failed and triggered a retry, the retry could emit thinking tags. Fixed by adding `think: false` to the retry call.

## System Prompt Analysis

### Token Budget

- System prompt (~64 lines, ~3,000 chars): ~900-1,100 tokens
- User prompt with 46 tabs (~80 chars each): ~1,200-1,500 tokens
- Total: ~2,500-3,000 tokens — only 10% of 32k window

### Limitations for 1.7B Models

1. **Too many rules compete for attention.** 40+ action templates and 22 disambiguation rules exceed what a 1.7B model can reliably apply simultaneously.
2. **Negative instructions are hard.** Rules like "NEVER use close_tabs for informational queries" require suppressing instincts — small models struggle with negation.
3. **Client-side validation compensates.** The validation layer in `cli/index.js` already catches and corrects most LLM errors, making some prompt rules redundant.

### Recommended Restructuring (Future Work)

Transform from a flat list into a **decision tree**:

```
Step 1: INFORMATIONAL (list/show/what/which/how many) or ACTION (close/open/pin/etc)?
  → INFORMATIONAL: use answer or search_content
  → ACTION: proceed to Step 2

Step 2: Select action from grouped categories:
  [Tab Management] close_tabs, close_all_except, close_duplicates
  [Navigation] open_url, activate_tab, open_from_search
  [Organization] pin_tabs, group_tabs, bookmark_tabs
  [Data] list_bookmarks, list_history, save_session
  [RAG] index_tabs, summarize_tab, search_content
```

This turns a 40-way classification into a 2-way → 5-way → N-way hierarchy, which small models handle much better.

### Trimming Opportunities

1. Remove duplicate entries (e.g., two `list_bookmarks` definitions)
2. Remove rules the client-side validation already enforces
3. Merge related rules (e.g., "activate" vs "close" disambiguation)
4. Target ~30% prompt reduction without losing effective coverage

## Alternative Models

| Model | Params | JSON Reliability | RAM (Q4_K_M) | Latency vs Current |
|-------|--------|-----------------|-------------|-------------------|
| qwen3:1.7b | 1.7B | Adequate with format:json | ~1.2GB | Baseline |
| **qwen3:4b** | **4B** | **Significantly better** | **~2.5GB** | **~1.5-2x slower** |
| qwen3:8b | 8B | Very good | ~5GB | ~3-4x slower |
| phi-4-mini | 3.8B | Good | ~2.3GB | ~1.5x slower |
| gemma3:4b | 4B | Good | ~2.5GB | ~1.5-2x slower |
| llama3.2:3b | 3.2B | Decent | ~2GB | ~1.3x slower |

**Strongest recommendation:** Upgrade to `qwen3:4b` if hardware permits. It excels at "tool calling and agentic capabilities" per official docs, runs on any laptop with 8GB RAM, and the latency increase (~1.5-2x) is negligible for a CLI tool where responses take 1-3 seconds.

## Changes Applied from This Research

### High Priority (Implemented)

1. Added `format: "json"` to Ollama API calls (main + retry)
2. Changed temperature 0 → 0.3 with top_p: 0.9, top_k: 20
3. Fixed retry function to include `think: false`

### Medium Priority (Future Work)

4. Use JSON schema mode instead of bare `format: "json"`
5. Restructure system prompt into decision tree
6. Evaluate qwen3:4b as drop-in upgrade

### Low Priority (Future Work)

7. Trim redundant system prompt rules (~30% reduction possible)
8. Add `presence_penalty: 1.5` if repetition issues emerge

## Sources

- [Qwen3-1.7B Model Card (HuggingFace)](https://huggingface.co/Qwen/Qwen3-1.7B)
- [Qwen3-4B Model Card (HuggingFace)](https://huggingface.co/Qwen/Qwen3-4B)
- [Qwen3 Collection (HuggingFace)](https://huggingface.co/collections/Qwen/qwen3-67dd247413f0e2e4f653967f)
- [Ollama API Documentation — format parameter](https://github.com/ollama/ollama/blob/main/docs/api.md)
