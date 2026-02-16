# Implementation Plan: Trace Observability

The plan covers three features that compose to enable full step-by-step replay of any recursive RLM run.

## Critical context from codebase exploration

**Current trace structure** (`src/rlm.ts` lines 44-55):
- `RlmResult` returns `{ answer, iterations, trace }` where trace is `TraceEntry[]`
- `TraceEntry` is `{ reasoning, code[], output, error }`
- No child trace data, no environment state, no application-specific action logs

**Child trace discard** (line 489-490 of `rlm.ts`):
```typescript
const result = await rlmInternal(q, c, savedDepth + 1, ...);
return result.answer; // result.trace and result.iterations discarded
```

**Sandbox context** (`src/environment.ts` line 25-45): The `vm.createContext` sandbox object contains known built-in keys: `console`, `require`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`. Plus any injected globals (`__rlm`, `__ctx`, `rlm`, `context`, user-provided `sandboxGlobals`).

**ARC-3 client** (`eval/arc3-client.ts` lines 47-48, 99-101): `_lastFrame` is overwritten on every `step()`. No action history is kept. Only `_actionCount` survives as a scalar.

**Eval types** (`eval/types.ts` line 17): `EvalResult.trace` is typed as `TraceEntry[]` -- the same flat structure.

**Existing HTML visualizations** (e.g., `eval/analyses/007-arc3-setup-runs/run-015-delegation-v8/trajectory.html`): Dark-themed timeline UI with stat cards and expandable iteration blocks. These are hand-authored analysis artifacts, not generated from trace data. They show what the viewer *should* look like but are not reusable code.

---

## Feature 1: Child Trace Propagation

**Goal**: Stop discarding child agent traces. Capture the full trace of every child `rlm()` invocation and attach it to the parent's trace entry.

### 1.1 Type Changes

**File**: `src/rlm.ts`

Add a new type for child trace records, and extend `TraceEntry` with an optional field:

```typescript
// New type (add after line 55)
export interface ChildTrace {
  invocationId: string;
  parentId: string;
  query: string;
  depth: number;
  answer: string | null;       // null if child errored/timed out
  iterations: number;
  trace: TraceEntry[];
  error?: string;
}

// Extend TraceEntry (line 50-55)
export interface TraceEntry {
  reasoning: string;
  code: string[];
  output: string;
  error: string | null;
  children?: ChildTrace[];     // NEW: opt-in, only present when traceChildren is enabled
  envSnapshot?: Record<string, unknown>;  // NEW: Feature 2, opt-in
}
```

**File**: `src/index.ts` -- add `ChildTrace` to exports.

### 1.2 Options Changes

**File**: `src/rlm.ts`, `RlmOptions` interface (lines 12-42)

Add:
```typescript
/** When true, child rlm() traces are captured in the parent's trace entries. Default: false. */
traceChildren?: boolean;
/** When true, sandbox variable snapshots are captured after each iteration. Default: false. */
traceSnapshots?: boolean;
```

### 1.3 Core Engine Changes

**File**: `src/rlm.ts`

**Step A**: Propagate options into `opts` (line 135-145). Add `traceChildren` and `traceSnapshots` to the opts destructure.

**Step B**: Create a per-iteration child accumulator. Inside `rlmInternal` (after line 296 where `trace` is declared), add:

```typescript
// Only allocate when feature is enabled
let pendingChildren: ChildTrace[] | undefined;
```

Before each iteration (inside the for-loop, around line 298), reset it:

```typescript
if (opts.traceChildren) {
  pendingChildren = [];
}
```

**Step C**: Modify the sandbox `rlm()` function (lines 435-500). The key change is at lines 487-494 where the promise body is:

```typescript
const promise = (async () => {
  try {
    const result = await rlmInternal(q, c, savedDepth + 1, ...);
    // CURRENT: return result.answer;  (discards trace)

    // NEW: capture child trace if enabled
    if (opts.traceChildren && pendingChildren) {
      pendingChildren.push({
        invocationId: childInvocationId,
        parentId: callerInvocationId,
        query: q,
        depth: savedDepth + 1,
        answer: result.answer,
        iterations: result.iterations,
        trace: result.trace,
      });
    }
    return result.answer;
  } catch (err) {
    // NEW: capture failed child trace too
    if (opts.traceChildren && pendingChildren && err instanceof RlmError) {
      pendingChildren.push({
        invocationId: childInvocationId,
        parentId: callerInvocationId,
        query: q,
        depth: savedDepth + 1,
        answer: null,
        iterations: err.iterations,
        trace: err.trace,
        error: err.message,
      });
    }
    throw err;
  } finally {
    activeDepth = savedDepth;
  }
})();
```

**Problem**: `pendingChildren` is defined in `rlmInternal`'s scope, but the sandbox `rlm()` function is defined in the outer `rlm()` scope (line 435). The sandbox function closure captures `activeDepth` via the outer scope, but `pendingChildren` would be in the inner scope.

**Solution**: Use a mutable reference object in the outer scope that `rlmInternal` sets before each iteration. Add to the outer `rlm()` function (around line 160):

```typescript
// Shared mutable slot for child trace accumulation across rlmInternal scopes
const childTraceSlot: { current: ChildTrace[] | null } = { current: null };
```

In `rlmInternal`, before each iteration:
```typescript
if (opts.traceChildren) {
  childTraceSlot.current = [];
}
```

In the sandbox `rlm()` function, push to `childTraceSlot.current` instead of `pendingChildren`.

**Step D**: Attach children to trace entries. At line 399 (`trace.push(...)`) and line 389 (early return `trace.push(...)`), conditionally add the children:

```typescript
const entry: TraceEntry = { reasoning: response, code: codeBlocks, output: combinedOutput, error: combinedError };
if (opts.traceChildren && childTraceSlot.current && childTraceSlot.current.length > 0) {
  entry.children = childTraceSlot.current;
}
trace.push(entry);
```

### 1.4 Gating Mechanism

- **Engine level**: `RlmOptions.traceChildren` (default `false`).
- **Harness level**: Add `traceChildren?: boolean` to `HarnessConfig` (line 51 of `harness.ts`), pass through to `rlm()` call at line 228-238.
- **CLI level**: Add `--trace-children` flag to `eval/run.ts` (parsed in `parseArgs`, passed to harness config).

### 1.5 Size Implications

A child running 30 iterations produces roughly 50-100KB of trace (reasoning text dominates). With 4-5 children per parent run, that is 200-500KB. For a 7-game ARC-3 eval, total could reach 1-3MB of trace data. This is acceptable for JSON results files but should be noted in documentation.

### 1.6 Test Strategy

**File**: `test/rlm.test.ts`

Add tests in a new `describe("traceChildren")` block:

1. **Child trace captured**: Parent delegates to child with `traceChildren: true`. Assert `result.trace[N].children` is defined, has length 1, and the child's trace entries are present.
2. **Child trace absent when disabled**: Same scenario with `traceChildren: false` (default). Assert `result.trace[N].children` is `undefined`.
3. **Failed child trace captured**: Child hits max iterations. Assert `result.trace[N].children[0].error` is defined and `answer` is `null`.
4. **Parallel children**: `Promise.all([rlm("A"), rlm("B")])`. Assert `result.trace[N].children` has length 2.
5. **Nested children**: Parent -> child -> grandchild. Assert child's trace entries also have `children` with the grandchild's trace.

Pattern: Follow the existing `mockCallLLM` helper and the delegation test patterns from lines 107-167 of `rlm.test.ts`.

---

## Feature 2: Environment Snapshots

**Goal**: Capture the sandbox variable state after each iteration, enabling inspection of how the agent's working memory evolves.

### 2.1 Environment Changes

**File**: `src/environment.ts`

Add a `snapshot()` method to `JsEnvironment`:

```typescript
// Add to RlmEnvironment interface (line 4-8)
snapshot(excludeKeys?: Set<string>): Record<string, unknown>;

// Implementation in JsEnvironment class (after line 94)
snapshot(excludeKeys?: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(this.context)) {
    if (excludeKeys?.has(key)) continue;
    try {
      const value = this.context[key];
      // Skip functions (builtins, user-defined helpers)
      if (typeof value === 'function') continue;
      // Attempt JSON serialization to test serializability and get a clean copy
      result[key] = JSON.parse(JSON.stringify(value));
    } catch {
      // Non-serializable value (circular refs, symbols, etc.) -- store a placeholder
      result[key] = '[non-serializable]';
    }
  }
  return result;
}
```

The `JSON.parse(JSON.stringify(value))` round-trip serves two purposes: (1) deep-copies the value so mutations after snapshot don't corrupt it, and (2) filters out non-serializable values that would break JSON results files.

### 2.2 Built-in Exclusion Set

Define a constant set of keys to always exclude from snapshots. These are sandbox infrastructure, not user variables:

```typescript
// In rlm.ts, near the top
const SNAPSHOT_EXCLUDE_KEYS = new Set([
  'console', 'require', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'rlm', '__rlm', '__ctx',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'Map', 'Set',
  'Promise', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'NaN', 'Infinity', 'globalThis',
  'eval', 'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Uint8ClampedArray',
  'BigInt', 'BigInt64Array', 'BigUint64Array',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Atomics', 'WebAssembly',
  'AggregateError', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError',
  'FinalizationRegistry', 'WeakRef',
  'queueMicrotask', 'structuredClone', 'atob', 'btoa',
]);
```

The `sandboxGlobals` keys provided by the caller (e.g., `arc3`) should also be excluded. Add them dynamically:

```typescript
const excludeKeys = new Set(SNAPSHOT_EXCLUDE_KEYS);
if (opts.sandboxGlobals) {
  for (const key of Object.keys(opts.sandboxGlobals)) {
    excludeKeys.add(key);
  }
}
```

This means snapshots capture only *agent-created* variables: `x`, `__knowledge`, `__outerIter`, `__levelAttempts`, etc. -- the actual working memory.

### 2.3 Snapshot Size Control

For ARC-3, grids are `[1][64][64]` = 4096 integers. A single JSON-serialized grid snapshot is ~16KB. If the agent stores 3-4 grid variables, that is ~64KB per snapshot. With 10 iterations, that is 640KB.

Add a size limit to `snapshot()`:

```typescript
snapshot(excludeKeys?: Set<string>, maxBytes = 256 * 1024): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let totalSize = 0;
  for (const key of Object.getOwnPropertyNames(this.context)) {
    if (excludeKeys?.has(key)) continue;
    try {
      const value = this.context[key];
      if (typeof value === 'function') continue;
      const serialized = JSON.stringify(value);
      totalSize += serialized.length;
      if (totalSize > maxBytes) {
        result[key] = `[truncated: ${serialized.length} chars]`;
        continue;
      }
      result[key] = JSON.parse(serialized);
    } catch {
      result[key] = '[non-serializable]';
    }
  }
  return result;
}
```

### 2.4 Hook into Trace

**File**: `src/rlm.ts`

At the two `trace.push()` call sites (lines 389 and 399), add the snapshot:

```typescript
const entry: TraceEntry = { reasoning: response, code: codeBlocks, output: combinedOutput, error: combinedError };
if (opts.traceChildren && childTraceSlot.current && childTraceSlot.current.length > 0) {
  entry.children = childTraceSlot.current;
}
if (opts.traceSnapshots) {
  entry.envSnapshot = env.snapshot(excludeKeys);
}
trace.push(entry);
```

The `excludeKeys` set is computed once before `rlmInternal` begins (in the outer `rlm()` function).

### 2.5 Gating Mechanism

- **Engine level**: `RlmOptions.traceSnapshots` (default `false`).
- **Harness level**: Add `traceSnapshots?: boolean` to `HarnessConfig`, pass through to `rlm()`.
- **CLI level**: Add `--trace-snapshots` flag to `eval/run.ts`.
- Combined flag: Consider adding `--trace-full` that enables both `traceChildren` and `traceSnapshots`.

### 2.6 Test Strategy

**File**: `test/environment.test.ts`

1. **snapshot returns user variables**: `env.set("x", 42); await env.exec("y = 'hello'"); const snap = env.snapshot(...)`. Assert `snap.x === 42`, `snap.y === 'hello'`.
2. **snapshot excludes builtins**: Assert `snap.console` is undefined, `snap.setTimeout` is undefined.
3. **snapshot excludes custom exclude keys**: Pass `new Set(["x"])`, assert `snap.x` is undefined.
4. **snapshot handles non-serializable**: `env.set("circ", circularObj)`. Assert `snap.circ === '[non-serializable]'`.
5. **snapshot size limit**: Store a large array, set `maxBytes=100`. Assert truncation placeholder appears.

**File**: `test/rlm.test.ts`

6. **envSnapshot in trace**: Run with `traceSnapshots: true`. Agent sets `x = 42` in iteration 1, `x = 99` in iteration 2. Assert `result.trace[0].envSnapshot.x === 42`, `result.trace[1].envSnapshot.x === 99`.
7. **envSnapshot absent when disabled**: Assert `result.trace[0].envSnapshot` is `undefined`.

---

## Feature 3: Action Log (ARC-3 Client Specific)

**Goal**: Record every game action and its resulting frame in the ARC-3 client, creating a complete replay log.

### 3.1 Type Changes

**File**: `eval/arc3-client.ts`

Add a new type and extend the client:

```typescript
// New type (add after Arc3Frame interface, ~line 16)
export interface Arc3ActionEntry {
  index: number;           // 0-based action index
  action: number;          // action code (1-7)
  x?: number;              // for action 6 (click)
  y?: number;              // for action 6 (click)
  resultFrame: Arc3Frame;  // the frame returned by this action
  timestampMs: number;     // wall-clock time since start()
}
```

### 3.2 Client Changes

**File**: `eval/arc3-client.ts`

Add private state and a public accessor:

```typescript
// New private fields (add after line 49)
private _actionLog: Arc3ActionEntry[] = [];
private _startTime: number = 0;
private _logActions: boolean = false;

// Public accessor
get actionLog(): readonly Arc3ActionEntry[] { return this._actionLog; }
```

Modify `start()` (line 68-82) to initialize logging:

```typescript
async start(opts?: { logActions?: boolean }): Promise<Arc3Frame> {
  this._logActions = opts?.logActions ?? false;
  this._startTime = Date.now();
  this._actionLog = [];
  // ... rest unchanged
}
```

Modify `step()` (line 85-103) to record actions:

```typescript
async step(action: number, x?: number, y?: number): Promise<Arc3Frame> {
  // ... existing code up to line 100
  const frame = await this._request("POST", `/api/cmd/${cmd}`, body) as unknown as Arc3Frame;
  this._lastFrame = frame;
  this._actionCount++;

  // NEW: log action if enabled
  if (this._logActions) {
    this._actionLog.push({
      index: this._actionCount - 1,
      action,
      ...(x !== undefined && { x }),
      ...(y !== undefined && { y }),
      resultFrame: structuredClone(frame),  // deep copy to prevent mutation
      timestampMs: Date.now() - this._startTime,
    });
  }

  return frame;
}
```

**Important**: Use `structuredClone(frame)` to snapshot the frame at the time of the action. The frame object from `_request` is fresh each time (not reused), but deep-copying is defensive.

### 3.3 Integration with Harness

**File**: `eval/run.ts`

In the `arc3` case of `getBenchmarkConfig` (lines 359-403), modify `getResultMetadata` to include the action log:

```typescript
getResultMetadata: (task) => {
  const client = clients.get(task.id);
  if (!client?.scorecardId) return undefined;
  return {
    scorecardId: client.scorecardId,
    replayUrl: `https://three.arcprize.org/scorecards/${client.scorecardId}`,
    // NEW: include action log if populated
    ...(client.actionLog.length > 0 && { actionLog: client.actionLog }),
  };
},
```

### 3.4 Gating Mechanism

The `logActions` option on `Arc3Client.start()` is the gate. The harness controls it:

- **CLI level**: Add `--trace-actions` flag to `eval/run.ts`.
- **Harness level**: When `--trace-actions` is set, pass `logActions: true` to `arc3.start()`.

But there is a subtlety: `arc3.start()` is called by the *agent* (from sandbox code), not by the harness. The harness injects the `Arc3Client` as a sandbox global. Two options:

**Option A (Preferred)**: Add a `logActions` config option to `Arc3Client` constructor rather than `start()`:

```typescript
constructor(gameId: string, apiKey?: string, opts?: { logActions?: boolean }) {
  // ...
  this._logActions = opts?.logActions ?? false;
}
```

Then in `setupSandbox` in `run.ts`:
```typescript
setupSandbox: (task) => {
  const gameId = task.metadata?.gameId as string;
  const client = new Arc3Client(gameId, undefined, { logActions: args.traceActions });
  clients.set(task.id, client);
  return { arc3: client };
},
```

This requires no changes to the agent's code (`arc3.start()` call remains unchanged).

**Option B**: Enable it by default when `--trace-actions` is set, using a property on the client.

Go with **Option A**.

### 3.5 Size Implications

Each action entry includes a full `Arc3Frame` with a `[1][64][64]` grid. That is ~16KB per action. A game with 180 actions would produce ~2.9MB of action log. For a single-game run, this is acceptable. For multi-game runs, consider:

- A `maxActionLogEntries` option to cap the log length
- Only storing the grid diff (delta from previous frame) instead of full frames
- Compressing frames to run-length encoding

For the initial implementation, store full frames with a configurable cap (default 500). Add a comment noting that compression is a future optimization.

### 3.6 Test Strategy

**File**: New test file `test/arc3-client.test.ts` (or add to existing test patterns)

Since `Arc3Client` makes real HTTP calls, tests should use a mock HTTP layer or test only the logging logic in isolation:

1. **Action log disabled by default**: Create client, verify `actionLog` is empty array, `logActions` defaults to false.
2. **Action log accumulates entries**: Mock the `_request` method (or subclass). Call `start()` then `step()` three times. Assert `actionLog.length === 3`, entries have correct `index`, `action`, and `resultFrame`.
3. **Action log includes coordinates for action 6**: `step(6, 10, 20)`. Assert entry has `x: 10, y: 20`.
4. **Action log frames are deep copies**: Modify `_lastFrame` after step, verify `actionLog[0].resultFrame` is unchanged.
5. **Cleanup resets state**: Verify `actionLog` is cleared on new `start()`.

---

## Feature Composition

When all three features are enabled together, a single `EvalResult` contains:

```
EvalResult
  .trace[]                          // Parent orchestrator iterations
    [i].reasoning                   // LLM response text
    [i].code[]                      // Executed code blocks
    [i].output                      // Combined stdout
    [i].error                       // Error if any
    [i].envSnapshot                 // {__knowledge: {...}, __outerIter: 3, ...}
    [i].children[]                  // Child delegations in this iteration
      [j].invocationId             // "d1-c0"
      [j].query                    // "Play level 1..."
      [j].trace[]                  // Full child trace
        [k].reasoning              // Child's LLM responses
        [k].code[]                 // Child's code
        [k].output                 // Child's output
        [k].error                  // Child's errors
        [k].envSnapshot            // Child's sandbox state (shared sandbox)
        [k].children[]             // Grandchildren (if any)
  .metadata
    .actionLog[]                    // ARC-3 specific: every game action
      [n].action                   // 1-7
      [n].resultFrame.frame        // [1][64][64] grid
      [n].timestampMs              // Time since game start
```

This enables the viewer to:
1. Walk through parent iterations, seeing orchestrator reasoning and sandbox state
2. Drill into any child delegation, seeing the child's full trace
3. Correlate actions in the action log with child iterations (by timestamp or by matching action counts in the output)
4. Display the game board at any point by finding the relevant frame in the action log

**Shared sandbox note**: Parent and children share the same `JsEnvironment` (line 152 creates one env for the entire run). Environment snapshots at child depth show the same context as the parent, with additional child-specific variables. This is correct behavior -- it reflects the actual shared state.

---

## HTML Trace Viewer

After the three data features are implemented, build a standalone HTML viewer that consumes a results JSON file.

### Viewer Architecture

A single-file HTML document (no build step, no dependencies) that:
1. Accepts a results JSON file via drag-and-drop or file picker
2. Renders a task selector (for multi-task eval results)
3. For each task, renders the iteration timeline

### Core Components

1. **Task Selector**: Dropdown or list showing all tasks with scores, iteration counts.

2. **Iteration Timeline**: Vertical timeline (matching existing trajectory.html style):
   - Each iteration is an expandable card
   - Shows: iteration number, code preview, output preview, error badge
   - Expanded view: full reasoning, full code, full output

3. **Child Delegation Panel**: When a trace entry has `children`:
   - Show a collapsible "Child: d1-c0" section
   - Render the child's trace as a nested timeline (recursive)
   - Badge showing child iterations count and success/failure

4. **Environment Inspector**: When a trace entry has `envSnapshot`:
   - Collapsible panel showing variable state as a JSON tree
   - Highlight variables that changed since the previous iteration (diff)
   - Large values (arrays, objects) are collapsed by default

5. **Game Board Viewer** (ARC-3 specific): When metadata has `actionLog`:
   - Render the 64x64 grid as a colored pixel canvas
   - Scrubber/slider to step through actions
   - Action badge showing what action was taken
   - Link actions to the iteration that triggered them (via action count ranges)

### Viewer File Location

`eval/viewer.html` -- a single self-contained HTML file.

### Implementation Notes

- Use `<canvas>` for grid rendering (64x64 at 4-8px per cell = 256-512px)
- ARC color palette: 16 fixed colors (black, blue, red, green, yellow, grey, fuchsia, orange, cyan, brown, etc.)
- JSON tree viewer: recursive `<details>/<summary>` elements, no library needed
- Diff highlighting: compare `envSnapshot[i]` vs `envSnapshot[i-1]` keys/values, mark changed keys in yellow
- File size target: under 2000 lines of HTML/CSS/JS

---

## Implementation Order and Dependencies

```
Phase 1: Environment snapshot method (foundation)
  1a. Add snapshot() to JsEnvironment      [environment.ts]
  1b. Add snapshot tests                    [environment.test.ts]

Phase 2: Core trace extensions (engine)
  2a. Add ChildTrace type and extend TraceEntry    [rlm.ts]
  2b. Add traceChildren / traceSnapshots options   [rlm.ts]
  2c. Implement child trace capture                [rlm.ts, ~lines 435-500]
  2d. Implement env snapshot at trace.push()       [rlm.ts, ~lines 389, 399]
  2e. Update index.ts exports                      [index.ts]
  2f. Add rlm.test.ts tests for both features      [rlm.test.ts]

Phase 3: ARC-3 action log (eval-level)
  3a. Add Arc3ActionEntry type                     [arc3-client.ts]
  3b. Add logging to Arc3Client                    [arc3-client.ts]
  3c. Wire up in run.ts getBenchmarkConfig         [run.ts]
  3d. Add arc3-client tests                        [arc3-client.test.ts]

Phase 4: Harness and CLI integration
  4a. Add trace options to HarnessConfig           [harness.ts]
  4b. Pass through to rlm() in runSingleTask       [harness.ts]
  4c. Add CLI flags to run.ts                      [run.ts]

Phase 5: HTML Viewer
  5a. Build viewer.html                            [eval/viewer.html]
  5b. Test with real run data
```

Phases 1-2 are engine changes and should be done together. Phase 3 is independent and can be done in parallel. Phase 4 depends on 2 and 3. Phase 5 depends on all prior phases being complete so there is real data to test with.

---

## Estimated Complexity

| Feature | Files Modified | Lines Added (est.) | Complexity |
|---------|---------------|-------------------|------------|
| 1. Child trace propagation | 3 (rlm.ts, index.ts, rlm.test.ts) | ~80 | Medium -- tricky closure scope for `childTraceSlot` |
| 2. Environment snapshots | 3 (environment.ts, rlm.ts, environment.test.ts + rlm.test.ts) | ~70 | Low -- straightforward serialization |
| 3. ARC-3 action log | 2 (arc3-client.ts, run.ts) | ~40 | Low -- simple accumulator |
| 4. Harness/CLI wiring | 2 (harness.ts, run.ts) | ~30 | Low -- plumbing |
| 5. HTML Viewer | 1 new file (viewer.html) | ~1500 | Medium-High -- standalone UI |
| **Total** | **~8 files** | **~1720** | |

The riskiest part is Feature 1's closure handling -- the sandbox `rlm()` function is defined in the outer scope but needs to write to a per-iteration accumulator in the inner `rlmInternal` scope. The `childTraceSlot` pattern (mutable reference object) solves this cleanly but must be tested carefully for parallel child scenarios (`Promise.all([rlm("A"), rlm("B")])`).

---

## Critical Files for Implementation

- `src/rlm.ts` - Core engine: type extensions (TraceEntry, ChildTrace), options (traceChildren, traceSnapshots), child trace capture at lines 487-494, snapshot hook at lines 389/399
- `src/environment.ts` - New `snapshot()` method on JsEnvironment with serialization, exclusion set, and size limiting
- `eval/arc3-client.ts` - Action log accumulator: Arc3ActionEntry type, logging in `step()`, constructor option for `logActions`
- `eval/harness.ts` - Plumbing: pass `traceChildren`/`traceSnapshots` from HarnessConfig through to rlm() call at lines 228-238
- `eval/run.ts` - CLI flags (`--trace-children`, `--trace-snapshots`, `--trace-actions`), wire `logActions` into Arc3Client constructor in `setupSandbox`
