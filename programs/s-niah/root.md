---
name: s-niah-solver
kind: program
version: 0.1.0
description: Find a hidden needle in a large haystack context
nodes: [coordinator, searcher]
---

# S-NIAH Solver

A two-node program for finding a secret code hidden in a large text context. The coordinator parses the query, initializes shared state, delegates the search to a leaf, and validates the result before returning.

## Components

### coordinator

```
role: orchestrator
use: "coordinator"

good at:
  - parsing the query to extract the project ID
  - initializing &SearchState from query facts
  - validating result format (word-animal-number)

bad at:
  - searching large text efficiently (delegate to searcher)

requires from caller:
  - context variable contains the haystack text with a hidden needle

produces for caller:
  - the secret code string (e.g. "crimson-falcon-4821")

does NOT produce:
  - the raw text search (searcher does this)

state:
  reads: &SearchState
  writes: &SearchState (init + curation)
```

### searcher

```
role: leaf
use: "searcher"

good at:
  - searching large text for a target pattern
  - extracting the secret code from context

bad at:
  - query parsing (coordinator does this)
  - result validation (coordinator does this)

requires from caller:
  - &SearchState.target_id is set
  - context variable is available on globalThis

produces for caller:
  - the raw extracted secret code

does NOT produce:
  - validation of the answer format

state:
  reads: &SearchState
  writes: &SearchState (search_result)
```

## Composition

Always use **direct** composition. With only two nodes there is no benefit to a coordinator tier. The orchestrator delegates straight to the searcher.

Always use **targeted** briefs. The search target and context length are known facts — pass them, not open-ended exploration instructions.

## Shared State

### &SearchState

```
SearchState {
  target_id: string          -- project ID extracted from query (e.g. "A1B2C3D4")
  needle_pattern: string     -- search string: "The secret code for Project {id} is:"
  context_length: number     -- length of the context variable in characters
  search_result: string|null -- raw code found by searcher (e.g. "crimson-falcon-4821")
  verified: boolean          -- true after coordinator validates format
}
```

## Composition Principles

```
principles:

  1. CURATION IS THE RETURN ON COMPOSITION
     The coordinator validates the searcher's result before returning.
     A format-valid answer is worth more than a raw extraction.
     After delegation: check search_result matches word-animal-number,
     set verified=true only if format is correct.

  2. BRIEFS ARE INTERFACES
     The coordinator's brief to the searcher must be constructed from
     &SearchState only — target_id, needle_pattern, context_length.
     The coordinator does NOT dump its own analysis of the context
     into the brief.

  3. COLLAPSE IS THE DEFAULT FAILURE MODE
     Without discipline, the coordinator will search the context itself
     instead of delegating. The coordinator's job is parse + validate.
     The searcher's job is search + extract.
```
