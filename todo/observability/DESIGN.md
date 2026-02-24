# Observability Design

First-class observability for node-rlm. The RLM state is written in real-time such that another process/program can tail, read, and drive dashboards from a running system.

## Design goals

1. **Real-time, not post-hoc.** Events are emitted as they happen, not collected and returned at the end.
2. **Replaces the existing trace.** The current `TraceEntry[]` / `traceChildren` / `traceSnapshots` shim gets removed. The event stream is the sole record. Post-hoc trace reconstruction is a consumer of the event stream (collect events, build a tree).
3. **Cross-cutting via closure.** The `emit` function lives in the `rlm()` closure scope. No parameter threading, no singletons, no ALS. Same pattern as every other shared binding in `rlm.ts`.
4. **Observer is optional.** The `emit` binding is set once at `rlm()` entry — either `undefined` (no observer) or a forwarding function. The engine never checks "is someone listening." Emit call sites are guarded by `if (emit)` for work that involves serialization (e.g., snapshots), but this is a static setup-time decision, not a per-event probe.
5. **Control-plane ready.** The event seams we place now are the same points where a future debugger would attach pause/resume gates. No one-way doors.

## Key decisions

| Question | Decision |
|----------|----------|
| Emission model | In-process EventEmitter; file/socket are subscribers. See `emission-model.md`. |
| Trace replacement | Remove `TraceEntry`, `ChildTrace`, `traceChildren`, `traceSnapshots`. The event stream IS the trace. |
| Performance | Not a concern. LLM latency dwarfs emission cost. Always emit when observer attached. |
| API surface | `observer` option on `RlmOptions`. Cross-cutting from there. Minimal surface change. |
| Control plane | Design observation plane first. Place event seams at points where pause gates would attach. Revisit later. |
| Return value | `RlmResult` becomes `{ answer, iterations }`. No trace in the return. |
| Default consumer | Ship a built-in subscriber that collects events into a queryable structure. The eval harness and `analyze.ts` use this. Not just a "trace collector" — it's the standard consumer that handles common needs (tree reconstruction, post-hoc analysis, etc). |
| System prompts in events | Include full text every time. Simple. Consumer deduplicates if needed. |
| Error payloads | `RlmError` drops `trace` but keeps `iterations`. The observer received all events before the throw, so trace is redundant. `iterations` is cheap and useful without an observer. |

## Identity and correlation

Every event carries:

| Field | Source | Purpose |
|-------|--------|---------|
| `runId` | `crypto.randomUUID()` once per top-level `rlm()` call | Correlates all events from one invocation tree. Essential when multiple programs run concurrently. |
| `invocationId` | Existing (`"root"`, `"d1-c0"`, `"d1-c0.d2-c1"`, ...) | Identifies the specific agent instance. |
| `parentId` | Existing (`null` for root, `"root"` for depth-1, etc.) | Reconstructs the delegation tree. |
| `depth` | Existing | Position in the delegation tree. |
| `timestamp` | Raw `performance.now()` (monotonic, high-resolution) | Wall-clock ordering within a process. `run:start` timestamp establishes the epoch for each run; consumers compute deltas. |

### On traceId / spanId

These come from distributed tracing (OpenTelemetry). A `traceId` is a globally unique ID for a request across services; a `spanId` identifies a unit of work within that trace.

**Where they'd help:** If the RLM engine is embedded in a larger system (e.g., a web server handling user requests), a `traceId` from the caller lets you correlate RLM events with upstream/downstream spans in a distributed trace viewer like Jaeger or Datadog.

**Where they're overkill:** For standalone runs (CLI, eval harness), `runId` serves the same purpose as `traceId`. And `invocationId` already identifies the unit of work, making `spanId` redundant.

**Decision:** Don't add traceId/spanId to the core event schema. Instead, allow the observer to *attach* arbitrary context (e.g., via a `meta` field or by wrapping the emitter). If someone integrates with OpenTelemetry, they map `runId → traceId` and `invocationId → spanId` in their subscriber. No engine changes needed.

## Event catalog

### Buckets

Events fall into four buckets, ordered by implementation complexity:

#### Bucket 1: Lifecycle (easy, high value)

Events at invocation and iteration boundaries. These already have natural seams in `rlmInternal`.

| Event | When | Key payload |
|-------|------|-------------|
| `run:start` | Top-level `rlm()` entry | `runId`, query, maxIterations, maxDepth, model? (optional — engine doesn't know the model, populated if caller provides a label) |
| `run:end` | Top-level `rlm()` returns or throws | `runId`, answer or error, total iterations |
| `invocation:start` | `rlmInternal` entry (any depth) | invocationId, parentId, depth, query, systemPrompt |
| `invocation:end` | `rlmInternal` returns or throws | invocationId, answer or error, iterations used |
| `iteration:start` | Top of the for-loop | invocationId, iteration number, budget remaining |
| `iteration:end` | After code execution (every exit path) | invocationId, iteration, code, output, error, returned (bool) |

**Critical for debuggability:** `invocation:start` should include the full system prompt and query. `iteration:end` should include the code that was executed and its output. This lets an observer answer "what did it see when it decided to do that?"

**`iteration:end` always fires.** Every `iteration:start` gets a matching `iteration:end`. There are three exit paths from an iteration in `rlmInternal`:

1. **Normal return** (returnValue on iteration > 0): emit `iteration:end` with `returned: true`, then return.
2. **Continue** (no return, or early-return intercepted on iteration 0): emit `iteration:end` with `returned: false`, build messages, loop.
3. **callLLM error** (callLLM throws before code execution): emit `iteration:end` with `code: null`, `output: ""`, `error: <message>`, `returned: false`, then rethrow.

This is three `emit` calls at the three exit points. No restructuring of `rlmInternal` needed. The guarantee: a consumer that counts `iteration:start` and `iteration:end` events always gets matching pairs.

#### Bucket 2: LLM calls (easy, high value)

Wrapping `callLLM` at the point where it's called in `rlmInternal`.

| Event | When | Key payload |
|-------|------|-------------|
| `llm:request` | Before `callLLM()` | invocationId, iteration, model? (optional), message count, system prompt length |
| `llm:response` | After `callLLM()` returns | invocationId, iteration, model? (optional), duration, reasoning (full), code (full), has tool use, usage? (optional) |
| `llm:error` | `callLLM()` throws | invocationId, iteration, error message, duration |

**Note:** The reasoning and code from the LLM response are the most important debugging artifacts. Include them in full — they're the "what did it decide" half of the debuggability pair.

#### Bucket 3: Delegation (medium, high value)

Events around child `rlm()` calls. The seam is the sandbox `rlm` function defined in the outer closure.

| Event | When | Key payload |
|-------|------|-------------|
| `delegation:spawn` | Sandbox `rlm()` called | parentId, childId, query, model alias, maxIterations, app name |
| `delegation:return` | Child promise resolves | parentId, childId, answer, iterations used |
| `delegation:error` | Child promise rejects | parentId, childId, error, iterations used |
| `delegation:unawaited` | Unawaited rlm() detected | parentId, count of lost calls |

**Subtlety:** `delegation:spawn` fires when the sandbox calls `rlm()`, but `invocation:start` fires when `rlmInternal` begins. These are different moments — spawn is the parent's intent, start is the child's execution. Both are useful.

#### Bucket 4: Sandbox state (harder, variable value)

Capturing the evolution of shared state (`__gameKnowledge`, `__levelState`, user variables).

| Event | When | Key payload |
|-------|------|-------------|
| `sandbox:snapshot` | After each iteration | invocationId, iteration, serialized state |

**Why harder:**
- Full snapshots require `JSON.stringify` of the VM context — can be large
- Delta detection requires diffing — adds complexity
- Per-mutation tracking would require Proxy wrappers on sandbox variables — invasive

**Decision for first pass:** Emit a `sandbox:snapshot` event after each iteration using the existing `env.snapshot()` mechanism. It's already implemented, just wired to `traceSnapshots`. Rewire it to the event stream. Deltas and per-mutation tracking are future work.

**Snapshot serialization guard:** `env.snapshot()` involves real serialization work (iterating VM context, JSON.stringify). The `emit` binding is set up once at the top of `rlm()` — it's either `undefined` (no observer) or a function. Snapshot call sites guard with `if (emit)` so serialization is skipped entirely when no observer is attached. This is a setup-time decision, not the engine "checking" whether an observer is listening. The engine's control flow is identical either way.

### One-way doors

**Bucket 1 and 2 have no one-way doors.** These are purely additive and the seams are obvious. We can add/remove/reshape these events freely.

**Bucket 3 has a minor one-way door:** If we don't distinguish `delegation:spawn` from `invocation:start`, we lose the ability to measure the gap between "parent decided to delegate" and "child actually started" (which includes model resolution, app loading, etc). Worth capturing both from the start.

**Bucket 4's one-way door is about granularity:** If consumers build tooling around iteration-level snapshots, upgrading to sub-iteration granularity later changes the event density. But iteration-level is a reasonable starting point and upgrading doesn't break consumers (they just filter).

**Control plane one-way door:** The key thing to get right for future breakpoints is that `iteration:start` and `delegation:spawn` are emitted *before* the action happens (not after). This means a future control plane can intercept at those points and gate execution. If we emit them after-the-fact, we'd need to restructure. **Emit before, not after.**

## The "agent developer" UX

The primary debugging questions an agent developer asks, and which events answer them:

| Question | Events needed |
|----------|---------------|
| "What is it doing right now?" | Latest `iteration:start` or `llm:request` for each active invocation |
| "Why did it do that?" | `llm:response` (reasoning) + `invocation:start` (system prompt + query) |
| "What did it see?" | `iteration:end` (output from code execution) |
| "Where in the tree are we?" | `delegation:spawn/return` events reconstruct the live tree |
| "How much budget is left?" | `iteration:start` (iteration/maxIterations per invocation) |
| "What went wrong?" | `llm:error`, `delegation:error`, `invocation:end` with error |
| "What's in the sandbox?" | `sandbox:snapshot` after relevant iteration |
| "How long did the LLM take?" | `llm:request` + `llm:response` timestamps/duration |
| "Is it stuck in a loop?" | Sequence of `iteration:end` events with similar output |
| "Did the child get a good brief?" | `delegation:spawn` (query) + child's `invocation:start` (full system prompt) |

The most important pairing: **"what did it decide" (llm:response) + "what was it told" (invocation:start system prompt + iteration context)**. This is the core debuggability primitive.

## What gets removed

The following are replaced by the event stream and should be deleted:

- `TraceEntry` interface
- `ChildTrace` interface
- `RlmResult.trace` field (RlmResult becomes `{ answer, iterations }`)
- `traceChildren` option
- `traceSnapshots` option
- `childTraceSlot` internal machinery
- `RlmError.trace` field (error events carry this data instead; `iterations` stays)
- `RlmMaxIterationsError` trace field (same; `iterations` stays via parent class)
- Trace-related snapshot wiring (`traceSnapshots` checks, trace entry population). The `snapshotExcludeKeys` setup stays — it's used by `sandbox:snapshot` event emission.
- All trace-related code in `eval/harness.ts`, `eval/types.ts`, `eval/analyze.ts`

**Note:** `eval/analyze.ts` currently walks `TraceEntry[]` to compute behavioral patterns. This becomes a consumer of the event stream (or of collected events post-hoc). The analysis logic doesn't change much — it just reads from a different shape.

## What gets added

### Default consumer

A built-in event subscriber shipped alongside the emitter. This is the standard way to consume RLM events — not just trace reconstruction, but the foundation for analysis, storage, and tooling.

Responsibilities:
- Collects all events during a run
- Reconstructs the delegation tree from flat events
- Provides post-hoc query interface (e.g., "give me all events for invocation X", "give me the iteration sequence for the root agent")
- Used by the eval harness to write result JSON files
- Used by `analyze.ts` to compute behavioral patterns
- Users who just want "what happened?" attach this and query it after `rlm()` returns

This replaces the role that `RlmResult.trace` served, but as an opt-in subscriber rather than a built-in return value.

### Simplified error types

`RlmError` and `RlmMaxIterationsError` drop the `trace` field. `iterations` stays — it's a single integer, cheap to keep, and useful without an observer (tells you "how far it got"). The observer has the full event history; the error has the iteration count.

## Observer interface

Two layers:

### Engine-facing: `RlmEventSink`

Minimal interface the engine calls. One method:

```typescript
interface RlmEventSink {
  emit(event: RlmEvent): void;
}
```

The engine calls `sink.emit(event)` at each event point. Custom consumers implement this one method.

### User-facing: `RlmObserver`

The built-in implementation of `RlmEventSink`. This is what users create and interact with.

```typescript
const observer = new RlmObserver();
observer.on('iteration:end', (e: IterationEndEvent) => { ... });  // typed handler
observer.on('delegation:spawn', (e: DelegationSpawnEvent) => { ... });

await rlm("query", ctx, { callLLM, observer });

// Post-hoc query
const events = observer.getEvents({ runId: "...", invocationId: "..." });
```

Capabilities:
- Typed `.on()` subscription per event type (engine defines all types — consumer never switches on a union)
- Event collection with filtering (by runId, invocationId, event type)
- Delegation tree reconstruction
- Handles multiple concurrent runs via `runId` — one instance serves all concurrent `rlm()` calls

### Event typing

Each event type is a distinct interface, engine-defined:

```typescript
interface RunStartEvent { type: 'run:start'; runId: string; timestamp: number; query: string; ... }
interface IterationEndEvent { type: 'iteration:end'; runId: string; timestamp: number; invocationId: string; iteration: number; code: string; output: string; error: string | null; }
```

The `type` field enables runtime identification and serialization. The typed `.on()` API means most consumers never need to inspect it.

`RlmEvent` is the union of all event types — used by `RlmEventSink.emit()` and by generic consumers (file writers, loggers).

## CallLLM usage extension

To support token counts in `llm:response`, extend `CallLLMResponse` with an optional `usage` field:

```typescript
interface CallLLMResponse {
  reasoning: string;
  code: string | null;
  toolUseId?: string;
  reasoningDetails?: ...;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}
```

The engine passes `usage` through to `llm:response` events when present. Both `model` and `usage` are optional in events — the type signatures capture their shape now, but they're populated later when the driver is updated to parse the API's `usage` response field (the OpenRouter/OpenAI APIs return this data, but `openrouter-compatible.ts` currently ignores it). This is a separate, incremental change.

## Model labeling

The engine doesn't know the model name — `callLLM` is an opaque function. For child delegations, the model **alias** name is available (e.g., `"fast"`). For the root, nothing is available unless the caller provides it.

For now: `model` is optional in all events. Child delegation events include the alias name when one was specified. The root `llm:request`/`llm:response` events omit it. A future change may add an optional `modelLabel` to `RlmOptions` so callers can annotate the root model.

## Eval harness migration

`EvalResult.trace: TraceEntry[]` becomes `EvalResult.events: RlmEvent[]` — the raw collected events from the observer. The eval harness creates an `RlmObserver`, passes it to `rlm()`, and after completion (or error), calls `observer.getEvents({ runId })` to get the flat event list for storage.

`analyze.ts` updates to work from events instead of trace entries. The mapping is direct:

| Old (TraceEntry) | New (RlmEvent) |
|------------------|----------------|
| `trace.length` | Count of `iteration:end` events for root invocation |
| `entry.code[0]` | `llm:response` event `.code` for that iteration |
| `entry.output` | `iteration:end` event `.output` for that iteration |
| `entry.error` | `iteration:end` event `.error` for that iteration |
| `entry.reasoning` | `llm:response` event `.reasoning` for that iteration |
| `entry.children` | `delegation:spawn/return/error` events with matching `parentId` |
| `entry.envSnapshot` | `sandbox:snapshot` event for that iteration |

The `RlmObserver` can also offer a convenience method like `toIterationSummaries(runId)` that groups events by iteration into a structure similar to the old `TraceEntry[]` — but this is an optional convenience, not required for the migration.

## Delegation validation failures

The sandbox `rlm` callback validates app names and model aliases before computing `childId` and calling `rlmInternal`. If validation fails (unknown app, unknown model, max depth), the promise rejects immediately. No `delegation:spawn` event fires — there was no spawn. These failures surface as sandbox errors in `iteration:end.output`, same as any other code error. This is correct: a bad `rlm()` call is a code error, not a delegation event.

`delegation:spawn` fires only after validation succeeds, with the computed `childId`. This means every `delegation:spawn` is followed by either `delegation:return` or `delegation:error`.

## Parallel delegation

When the model calls multiple `rlm()` in parallel (e.g., via `Promise.all`), the event stream interleaves child events by timestamp. Each event carries its own `invocationId` and `parentId`. Consumers group by invocationId for per-agent timelines, or use parentId to reconstruct the tree. No special handling needed — the flat timestamped stream handles concurrency naturally.

## Open questions

None remaining — ready for implementation planning.
