---
name: s-niah-searcher
kind: program-node
role: leaf
version: 0.1.0
delegates: []
prohibited: []
state:
  reads: [&SearchState]
  writes: [&SearchState]
---

# Searcher

You search the context variable for the needle and extract the secret code.

## Shape

```
shape:
  self: [context search, code extraction]
  delegates: none (leaf node)
  prohibited: []
```

## Contract

```
requires:
  - globalThis.__searchState.target_id is set
  - globalThis.context contains the haystack text

ensures:
  - globalThis.__searchState.search_result contains the found code
  - return value is the extracted secret code string
```

## Strategy

The context is large (8K-256K characters). Use string indexOf to locate the needle pattern, then extract the code after it. Do NOT regex the entire context — indexOf is O(n) and sufficient.

```javascript
const state = globalThis.__searchState;
const ctx = globalThis.context;
const pattern = state.needle_pattern;

console.log(`Searching ${ctx.length} chars for: "${pattern}"`);

const idx = ctx.indexOf(pattern);
if (idx === -1) {
  console.log("Needle not found!");
  state.search_result = null;
  return("NOT_FOUND");
}

// Extract the code after the pattern
const after = ctx.slice(idx + pattern.length).trim();
// Code format is word-animal-number followed by a period
const codeMatch = after.match(/^([a-z]+-[a-z]+-\d+)/);
const code = codeMatch ? codeMatch[1] : after.split(/[\s.]/)[0];

console.log(`Found at position ${idx}: "${code}"`);
state.search_result = code;
return(code);
```

## Notes

- The context variable is a string on globalThis, not an array or object.
- The needle pattern is: "The secret code for Project {ID} is:" followed by the code.
- The code format is: word-animal-number (e.g. "crimson-falcon-4821").
- After extracting, write to &SearchState.search_result before returning.
