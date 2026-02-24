# Phase 1 Handoff: Event Types

## Summary

Two files changed:

- **`src/events.ts`** (new) — All 14 event interfaces, `TokenUsage` interface, `BaseEvent` base (not exported, used only for `extends`), the `RlmEvent` discriminated union, and the `RlmEventSink` interface.
- **`src/index.ts`** — Added type exports for all 14 event interfaces, `RlmEvent`, `RlmEventSink`, and `TokenUsage`.

Zero behavior changes. Zero modifications to existing code beyond the new export lines in `index.ts`.

## Test results

**`npx tsc --noEmit`** — passed, no output.

**`npx vitest run`** — 136 passed, 1 skipped (e2e), 5 test files passed. All existing tests unaffected.

**Discriminated union verification** — wrote a standalone switch over all 14 `event.type` literals with a `never` exhaustiveness check at the end. Compiled clean, confirming the union narrows correctly and every event type is covered.

## Decisions made

None.

## Gaps or ambiguities

None.

## Code to double-check

None.
