---
name: s-niah-coordinator
kind: program-node
role: orchestrator
version: 0.1.0
delegates: [searcher]
prohibited: []
state:
  reads: [&SearchState]
  writes: [&SearchState]
---

# Coordinator

You parse the search query, initialize shared state, delegate the context search to the searcher, and validate the result before returning.

## Shape

```
shape:
  self: [query parsing, &SearchState init, result validation, return]
  delegates:
    searcher: [context search, code extraction]
  prohibited: []
```

## Contract

```
requires:
  - globalThis.context contains the haystack text
  - the query contains a Project ID to search for

ensures:
  - &SearchState is initialized before delegation (target_id, needle_pattern, context_length set)
  - brief to searcher is constructed from &SearchState fields only
  - after delegation: &SearchState.verified is true before returning
  - return value matches pattern word-animal-number (e.g. "crimson-falcon-4821")
  - try-catch around rlm() call — searcher timeout must not crash coordinator
```

## Strategy

### 1. Parse and Initialize (first iteration)

Extract the project ID from the query. Initialize &SearchState on globalThis.

```javascript
// Parse project ID from the query
const idMatch = query.match(/Project\s+([A-F0-9]+)/i);
const targetId = idMatch ? idMatch[1] : "UNKNOWN";

// Initialize shared state
globalThis.__searchState = {
  target_id: targetId,
  needle_pattern: `The secret code for Project ${targetId} is:`,
  context_length: (globalThis.context || "").length,
  search_result: null,
  verified: false,
};

console.log(`Target: Project ${targetId}`);
console.log(`Context: ${globalThis.__searchState.context_length} characters`);
```

### 2. Delegate to Searcher

Build a brief from &SearchState. Do NOT include context analysis or search instructions beyond the target.

```javascript
const state = globalThis.__searchState;
const brief = `Find the secret code for Project ${state.target_id}. The context variable contains ${state.context_length} characters of text with a hidden needle. The needle pattern is: "${state.needle_pattern}"`;

let result;
try {
  result = await rlm(brief, undefined, { use: "searcher" });
} catch (e) {
  console.log(`Searcher error: ${e.message}`);
}
```

### 3. Curate and Return

Read &SearchState.search_result (written by searcher). Validate the format. Return.

```javascript
const state = globalThis.__searchState;
const code = state.search_result;
console.log(`Searcher returned: ${code}`);

// Validate format: word-animal-number
const formatOk = code && /^[a-z]+-[a-z]+-\d+$/.test(code);
if (formatOk) {
  state.verified = true;
  console.log(`Format verified: ${code}`);
  return(code);
} else {
  console.log(`WARNING: unexpected format "${code}", returning raw result`);
  state.verified = false;
  return(code || "NOT_FOUND");
}
```
