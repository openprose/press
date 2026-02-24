# Implementation Phases

Observability for node-rlm, broken into phases that can be implemented, tested, and verified independently.

Each phase is designed to be handed to an async subagent. The subagent receives this document, the two design documents (`DESIGN.md` and `emission-model.md`), and the relevant source files. It implements the phase, verifies it, and writes a handoff file.

## Ground rules for every phase

**Do not overcomplicate.** The implementation should be obvious, boring code. No abstractions "for later." No helper utilities for one-time operations. No wrapper classes around simple functions. If something takes 3 lines, write 3 lines.

**Do not over-comment.** Only add comments where the logic is genuinely non-obvious. Do not add JSDoc to every function. Do not add "// emit event" above an emit call. Do not add comments explaining what TypeScript types already express.

**Do not over-type.** Use TypeScript's inference. Don't annotate locals that are obviously typed. Don't create type aliases for things used once.

**Write it as if it was always there.** The goal is NOT "add observability to existing code." The goal is "this is how the code would look if observability was part of the original design." No leftover trace artifacts. No compatibility shims. No "// was previously X" comments. Clean, integrated, native.

**Handoff file.** When done, write `todo/observability/handoff-phase-N.md` containing:

1. **Summary** — What specific files were changed and what was done.
2. **Test results** — Output from `tsc --noEmit`, test runs, or whatever verification was performed.
3. **Decisions made** — Any choices the subagent made that weren't explicitly specified. These are things we may want to review. Ideally this section is empty.
4. **Gaps or ambiguities** — Anything from the design docs that was unclear or seemed wrong. Ideally empty.
5. **Code to double-check** — Specific file:line ranges that are tricky or where the subagent is less confident. Ideally empty.

If the implementation is clean and all tests pass, sections 3-5 should just say "None."

---

## Phase 1: Event types

**Goal:** Define all event types and the engine-facing sink interface. Pure type definitions in a new file. Zero behavior changes. Zero changes to existing code.

**What to do:**

Create `src/events.ts` with:

- A discriminated union `RlmEvent` covering all event types from DESIGN.md's event catalog (all four buckets).
- Individual event interfaces: `RunStartEvent`, `RunEndEvent`, `InvocationStartEvent`, `InvocationEndEvent`, `IterationStartEvent`, `IterationEndEvent`, `LlmRequestEvent`, `LlmResponseEvent`, `LlmErrorEvent`, `DelegationSpawnEvent`, `DelegationReturnEvent`, `DelegationErrorEvent`, `DelegationUnawaitedEvent`, `SandboxSnapshotEvent`.
- The `RlmEventSink` interface (one method: `emit(event: RlmEvent): void`).
- Each event interface has a `type` string literal field for discrimination.
- All events share: `runId: string`, `timestamp: number`, `invocationId: string`, `parentId: string | null`, `depth: number`.
- Include `model?` and `usage?` as optional where specified in DESIGN.md.
- Export everything from `src/index.ts`.

**What NOT to do:**

- Do not implement `RlmObserver` yet. That's Phase 4.
- Do not modify `rlm.ts`, `environment.ts`, or any existing file except `src/index.ts` (to add exports).
- Do not create helper functions, factory functions, or event builders. Just types.

**Back pressure:**

- `npx tsc --noEmit` passes.
- Manually verify that the discriminated union works: a function that switches on `event.type` should narrow correctly.
- Check: does every event in DESIGN.md's catalog have a corresponding interface?

**Files touched:** `src/events.ts` (new), `src/index.ts` (add exports).

---

## Phase 2: Strip trace machinery

**Goal:** Remove all trace-related code from the engine. After this phase, `rlm()` returns `{ answer, iterations }` and there is no trace anywhere. The code is "blind" temporarily — Phase 3 wires in the new observation. This is purely subtractive.

**What to do:**

In `src/rlm.ts`:
- Delete `TraceEntry` interface.
- Delete `ChildTrace` interface.
- Remove `trace` from `RlmResult`. It becomes `{ answer: string; iterations: number }`.
- Remove `trace` from `RlmError` constructor and class body. Keep `iterations`.
- Update `RlmMaxIterationsError` — no `trace` parameter, just `maxIterations`.
- Remove `traceChildren` and `traceSnapshots` from `RlmOptions`.
- Remove `childTraceSlot` and all code that reads/writes it (lines 138, 312-314, 390-395, 401-404, 496-523).
- Remove `traceChildren` and `traceSnapshots` from the `opts` object built in `rlm()`.
- Remove the `trace` array declaration (line 309) and all `trace.push(...)` calls.
- Remove `trace` from the return statement in the normal-return path (line 397).
- Remove `trace` from the `RlmMaxIterationsError` throw (line 442).
- Remove `trace` from the `RlmError` throw in the callLLM catch (line 322).
- Clean up the sandbox `rlm` callback: remove the `parentTraceSlot`/`childTraceSlot` save-restore (lines 496-522). The callback should just call `rlmInternal`, return `result.answer`, and handle errors. The `activeDepth = savedDepth` restore stays (in `finally`).

In `src/index.ts`:
- Remove `TraceEntry` and `ChildTrace` from exports.

**What NOT to do:**

- Do not add `observer`, `emit`, or any new observability code yet. This phase is purely subtractive.
- Do not modify the iteration loop structure, message building, sandbox setup, or anything unrelated to trace.
- Do not touch `environment.ts`. The `snapshotExcludeKeys` setup stays in `rlm.ts` — it will be used by snapshot events in Phase 3.

**Back pressure:**

- `npx tsc --noEmit` passes.
- Run tests: `npx vitest run`. Tests that assert on `result.trace` will fail — update them to remove trace assertions. Tests should still pass for correctness (answer, iterations, error behavior). If a test exists solely to test trace structure, delete it.
- Verify: grep for `trace` in `src/rlm.ts` — the only hits should be the word appearing in comments or unrelated identifiers, not the old trace machinery.
- Verify: grep for `TraceEntry` and `ChildTrace` across `src/` — zero hits.

**Files touched:** `src/rlm.ts`, `src/index.ts`, test files (to remove trace assertions).

---

## Phase 3: Wire emit into rlm.ts

**Goal:** Integrate the `emit` closure and place all event emission calls throughout `rlm.ts`. This is the core surgery. After this phase, passing an observer to `rlm()` produces a stream of typed events.

**What to do:**

Read `emission-model.md` carefully. The cross-cutting pattern is closure capture — `emit` is a `const` in the `rlm()` closure scope, either `undefined` or a forwarding function.

In `src/rlm.ts`:

1. **Add `observer` to `RlmOptions`:**
   ```typescript
   observer?: RlmEventSink;
   ```
   Import `RlmEventSink` and event types from `./events.js`.

2. **Create the `emit` binding** at the top of `rlm()`, after the `opts` object:
   ```typescript
   const emit: ((event: RlmEvent) => void) | undefined = options.observer
     ? (event) => options.observer!.emit(event)
     : undefined;
   ```

3. **Generate `runId`** once per top-level call:
   ```typescript
   const runId = crypto.randomUUID();
   ```
   Import `crypto` from `node:crypto` (or use `globalThis.crypto.randomUUID()`).

4. **Place emit calls.** Use `emit?.()` for cheap events. Use `if (emit) { ... }` for expensive ones (snapshots). Every emit call explicitly includes `runId`, `invocationId`, `parentId`, `depth`, and `timestamp: performance.now()`.

   **Lifecycle events:**
   - `run:start` — right before the `return rlmInternal(...)` call at the bottom of `rlm()`.
   - `run:end` — wrap the `rlmInternal` call in a try/finally that emits `run:end` with either the answer or error.
   - `invocation:start` — top of `rlmInternal`, after system prompt is built.
   - `invocation:end` — at the return point and in the max-iterations throw. Wrap appropriately.
   - `iteration:start` — top of the for-loop.
   - `iteration:end` — at all three exit paths (see DESIGN.md: normal return, continue, callLLM error). Always fires. Uses `returned` boolean.

   **LLM events:**
   - `llm:request` — before `callLLM()`. Include message count, system prompt length.
   - `llm:response` — after `callLLM()` returns. Include `performance.now() - start` duration, reasoning, code, usage if present.
   - `llm:error` — in the callLLM catch block. Include duration, error message.

   **Delegation events:**
   - `delegation:spawn` — in the sandbox `rlm` callback, after validation succeeds and `childInvocationId` is computed.
   - `delegation:return` — after child `rlmInternal` resolves successfully.
   - `delegation:error` — after child `rlmInternal` rejects.
   - `delegation:unawaited` — where the existing unawaited-call warning is generated.

   **Sandbox state:**
   - `sandbox:snapshot` — where `traceSnapshots` previously triggered `env.snapshot()`. Guard with `if (emit)` since snapshot involves serialization.

5. **Export `RlmEventSink` and `RlmEvent` from `src/index.ts`** (if not already done in Phase 1).

**What NOT to do:**

- Do not restructure `rlmInternal`. The emit calls go at the existing code seams, not in new wrapper functions.
- Do not create event-builder helpers. Inline the event object at each call site.
- Do not add default observers, automatic file writers, or console loggers. The engine just calls `emit`.
- Do not implement `RlmObserver`. That's Phase 4.

**Back pressure:**

- `npx tsc --noEmit` passes.
- Write a focused integration test (can be in a new test file or added to existing): call `rlm()` with a mock `callLLM` and an `RlmEventSink` that collects events into an array. Assert:
  - Events appear in the expected order: `run:start`, `invocation:start`, `iteration:start`, `llm:request`, `llm:response`, `iteration:end`, ..., `invocation:end`, `run:end`.
  - All events have `runId`, `timestamp`, `invocationId`.
  - `iteration:start` count equals `iteration:end` count (matching pairs).
  - The `run:end` event has the answer.
  - When `callLLM` throws, `llm:error` and `iteration:end` (with error) fire.
- Run existing tests — they should still pass (observer is optional, no behavior change when omitted).

**Files touched:** `src/rlm.ts`, `src/index.ts` (exports), test file(s).

---

## Phase 4: RlmObserver

**Goal:** Implement the built-in observer — the standard consumer that collects events, supports typed `.on()` handlers, and provides post-hoc query methods. This is what users and the eval harness will actually use.

**What to do:**

Create `src/observer.ts` with class `RlmObserver` implementing `RlmEventSink`:

1. **Event collection:** `emit(event)` stores events in an internal array and dispatches to typed handlers.

2. **Typed `.on()` subscription:**
   ```typescript
   on<T extends RlmEvent['type']>(type: T, handler: (event: Extract<RlmEvent, { type: T }>) => void): void
   ```
   Handlers are called synchronously during `emit()`. Keep the implementation simple — a `Map<string, handler[]>`.

3. **Post-hoc query methods:**
   - `getEvents(filter?)` — return collected events, optionally filtered by `runId`, `invocationId`, event type.
   - `getTree(runId)` — reconstruct the delegation tree from `invocation:start`/`delegation:spawn` events. Return a simple nested structure: `{ invocationId, children: [...] }`.

4. **No over-engineering.** Do not add:
   - Event replay or playback
   - Observable/RxJS patterns
   - Event persistence or serialization
   - Automatic console logging
   - Event deduplication
   - Anything not described in DESIGN.md

Export `RlmObserver` from `src/index.ts`.

**Back pressure:**

- `npx tsc --noEmit` passes.
- Unit tests for `RlmObserver`:
  - Emit a sequence of events manually, verify `getEvents()` returns them.
  - Verify `.on()` handlers fire for matching event types and not for others.
  - Verify `getEvents({ invocationId: "X" })` filters correctly.
  - Verify `getTree()` reconstructs parent-child relationships.
- Integration test: run `rlm()` with a real `RlmObserver`, verify the collected events match expectations.

**Files touched:** `src/observer.ts` (new), `src/index.ts` (add export).

---

## Phase 5: Eval migration

**Goal:** Update the eval harness, types, and analysis to use the observer instead of trace. After this phase, running evals produces results with an `events` field instead of `trace`.

**What to do:**

In `eval/types.ts`:
- Replace `trace: TraceEntry[]` with `events: RlmEvent[]` in `EvalResult`.
- Remove the `TraceEntry` import.

In `eval/harness.ts`:
- In `runSingleTask`: create an `RlmObserver`, pass it as `observer` in the `rlm()` options.
- After `rlm()` completes (success or error), collect events: `observer.getEvents({ runId })`. But since the harness doesn't know the `runId` (it's generated inside `rlm()`), use `observer.getEvents()` to get all events (one run per observer instance, so this is fine — create a fresh observer per task).
- Remove `traceChildren` and `traceSnapshots` from `HarnessConfig` and from the options passed to `rlm()`.
- In the error catch: `RlmError` no longer has `.trace`. Use `observer.getEvents()` for events, `err.iterations` for iteration count.
- Populate `EvalResult.events` instead of `EvalResult.trace`.

In `eval/analyze.ts`:
- Update `analyzeTask` to work from `result.events` instead of `result.trace`. Use the mapping table from DESIGN.md:
  - Count `iteration:end` events for iteration count.
  - Read `llm:response` events for code and reasoning.
  - Read `iteration:end` events for output and errors.
- The analysis logic (pattern detection, scoring, etc.) should produce the same results — just reading from a different shape.

In `eval/harness.ts` `HarnessConfig`:
- Remove `traceChildren` and `traceSnapshots` properties.

**What NOT to do:**

- Do not add backwards compatibility for old result files with `trace`. Old files are old files. If `analyze.ts` is run on them, it can fail or skip gracefully.
- Do not rewrite the analysis logic. Adapt it to the new shape with minimal changes.

**Back pressure:**

- `npx tsc --noEmit` passes (across the entire project, including `eval/`).
- The benchmark CLI should work: `npx tsx eval/run.ts --benchmark oolong --max-tasks 2 --model <available-model>` (or whatever quick test is available). The result JSON should have `events` arrays instead of `trace` arrays.
- `npx tsx eval/analyze.ts` should work on the new result file. If it previously printed iteration counts and behavioral patterns, it should still do so.
- Verify: grep for `TraceEntry` across the entire project — zero hits (except perhaps in old result JSON files in `eval/results/`, which are data files, not code).

**Files touched:** `eval/types.ts`, `eval/harness.ts`, `eval/analyze.ts`. Possibly benchmark-specific runners if they reference trace options.

---

## Phase order and dependencies

```
Phase 1 (types) ──→ Phase 2 (strip trace) ──→ Phase 3 (wire emit) ──→ Phase 4 (observer) ──→ Phase 5 (eval)
```

Strictly sequential. Each phase builds on the previous. Do not start Phase N+1 until Phase N's handoff file confirms clean results.

Phase 1 and Phase 2 could technically run in parallel (types don't depend on trace removal, and trace removal doesn't need new types). But running them sequentially is simpler and avoids merge conflicts in `src/index.ts`.

## Estimated scope

| Phase | New files | Modified files | Approximate size |
|-------|-----------|----------------|------------------|
| 1 | `src/events.ts` | `src/index.ts` | ~120 lines of type definitions |
| 2 | — | `src/rlm.ts`, `src/index.ts`, test files | Net deletion. ~80 lines removed. |
| 3 | — | `src/rlm.ts`, `src/index.ts`, test file(s) | ~60 emit calls added, ~100 lines of test |
| 4 | `src/observer.ts` | `src/index.ts` | ~100-150 lines of implementation + tests |
| 5 | — | `eval/types.ts`, `eval/harness.ts`, `eval/analyze.ts` | ~80 lines changed |
