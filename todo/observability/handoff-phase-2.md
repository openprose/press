# Phase 2 Handoff: Strip Trace Machinery

## Summary

Removed all trace-related code from the engine and its consumers.

**`src/rlm.ts`:**
- Deleted `TraceEntry` interface, `ChildTrace` interface.
- `RlmResult` is now `{ answer: string; iterations: number }`.
- `RlmError` constructor takes `(message, iterations)` -- no `trace` parameter.
- `RlmMaxIterationsError` constructor takes `(maxIterations)` -- no `trace` parameter.
- Removed `traceChildren` and `traceSnapshots` from `RlmOptions`.
- Removed `childTraceSlot` and all code that read/wrote it.
- Removed `traceChildren` and `traceSnapshots` from the `opts` object.
- Removed the `trace` array, all `trace.push(...)` calls, and `trace` from return/throw paths.
- Cleaned up the sandbox `rlm` callback: removed `parentTraceSlot`/`childTraceSlot` save-restore. The callback now calls `rlmInternal`, returns `result.answer`, and re-throws errors. The `activeDepth = savedDepth` restore stays in `finally`.

**`src/index.ts`:**
- Removed `TraceEntry` and `ChildTrace` from exports.

**`src/cli.ts`:**
- Removed the `result.trace` iteration loop that printed reasoning/output per entry.

**`test/rlm.test.ts`:**
- Deleted "trace structure" test (existed solely to test trace).
- Deleted "trace captures errors" test (existed solely to test trace).
- Deleted entire `traceChildren` describe block (3 tests).
- Deleted entire `traceSnapshots` describe block (3 tests).
- Updated 6 tests that read output via `result.trace` to instead capture output from callLLM messages (`__TOOL_RESULT__` entries).

**`eval/types.ts`:**
- Removed `TraceEntry` import and `trace` field from `EvalResult`.

**`eval/harness.ts`:**
- Removed `traceChildren` and `traceSnapshots` from `HarnessConfig` and `SingleTaskConfig`.
- Removed `trace` from all `EvalResult` object literals (success path, error path, retry-failure path).

**`eval/run.ts`:**
- Removed `traceChildren` and `traceSnapshots` from parsed args interface, flag parsing, console output, and harness config passthrough.
- `--trace-full` now only enables `--trace-actions`.

**`eval/analyze.ts`:**
- `analyzeTask` reads trace via `(result as unknown as Record<string, unknown>).trace` for backward compatibility with legacy JSON result files.

**`eval/verify.ts`:**
- Removed `trace: []` from sample `EvalResult` literal.

## Test results

```
npx tsc --noEmit
(clean -- no errors)

npx vitest run
 Test Files  5 passed | 1 skipped (6)
      Tests  128 passed | 1 skipped (129)
```

Verification:
- `grep trace src/rlm.ts` -- zero hits.
- `grep TraceEntry src/` -- zero hits.
- `grep ChildTrace src/` -- zero hits.

## Decisions made

- **eval/analyze.ts backward compat:** The analyze script reads saved JSON files that may contain `trace` from pre-removal runs. Used `(result as unknown as Record<string, unknown>).trace` with a local `LegacyTraceEntry` interface to preserve analysis of old files while keeping the `EvalResult` type clean.
- **eval/run.ts `--trace-full`:** Kept the flag but it now only enables `--trace-actions` (the only remaining trace flag, ARC-3 specific). The `--trace-children` and `--trace-snapshots` flags are gone.
- **src/cli.ts:** Removed the per-iteration output loop since there is no trace to iterate. The CLI now just prints the answer and iteration count.

## Gaps or ambiguities

- `eval/viewer.html` references `result.trace` at lines 600-601 and 774-775. This is a standalone HTML file (not TypeScript), so it won't cause `tsc` errors. It will silently degrade when viewing new results (no trace to render). Old result files with trace will still render correctly. Not touched in this phase.

## Code to double-check

None.
