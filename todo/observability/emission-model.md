# Emission Model

## Decision: In-process EventEmitter as the primitive

File-based (NDJSON) and socket-based (debugger) consumers are subscribers of an in-process emitter. The architecture is:

```
Engine → emit(event) → [FileWriter, SocketServer, Dashboard, Metrics, ...]
```

The emitter is the primitive. Everything else is a consumer pattern. This gives us:
- Zero overhead when no observer (`emit` is `undefined`, call sites skip with `emit?.()` or `if (emit)`)
- Typed event objects — no serialization until a consumer needs it
- Composable — attach multiple subscribers independently
- Natural foundation for both passive observation and future control plane

## Cross-cutting pattern: closure capture

The `rlm()` function in `rlm.ts` already creates a closure scope that `rlmInternal` and the sandbox `rlm` callback close over. This is how `opts`, `env`, `childTraceSlot`, `contextStore`, `invocationStack`, `pendingRlmCalls`, `activeDepth`, and `childCounter` are shared — none are passed as parameters to `rlmInternal`.

An `emit` function works the same way:

```typescript
export async function rlm(query, context, options) {
  // ... existing setup ...

  // undefined when no observer; a function when observer attached.
  // Call sites use emit?.() for cheap events, if (emit) { ... } for expensive ones (snapshots).
  const emit: ((event: RlmEvent) => void) | undefined = options.observer
    ? (event) => options.observer.emit(event)
    : undefined;

  async function rlmInternal(...) {
    emit?.({ type: "invocation:start", runId, invocationId, depth, query, ... });

    for (let iteration = 0; ...) {
      emit?.({ type: "iteration:start", runId, invocationId, iteration, ... });
      const response = await callLLM(...);
      emit?.({ type: "llm:response", runId, invocationId, iteration, ... });
      // ...
      emit?.({ type: "iteration:end", runId, invocationId, iteration, output, error, returned: false });
    }
  }

  // The sandbox rlm() callback also closes over emit:
  env.set("rlm", (q, c, rlmOpts) => {
    // ... validation (no events on failure — it's a code error) ...
    emit?.({ type: "delegation:spawn", runId, parentId, childId, query: q, ... });
    // ...
  });
}
```

No signature changes to `rlmInternal`. No parameter threading. The closure IS the cross-cutting mechanism.

For `CallLLM` observation (timing, token counts), emit directly at the call site inside `rlmInternal` rather than wrapping the function. `rlmInternal` already knows its own `invocationId`, `iteration`, and which `callLLM` function it's using (default, override, or model alias). Wrapping doesn't work because the wrapper wouldn't know the invocation context.

```typescript
// Inside rlmInternal, around the callLLM() call:
emit?.({ type: "llm:request", runId, invocationId, iteration, messageCount: messages.length });
const start = performance.now();
const response = await callLLM(messages, systemPrompt, opts);
emit?.({ type: "llm:response", runId, invocationId, iteration, durationMs: performance.now() - start, reasoning: response.reasoning, code: response.code, usage: response.usage });
```

`JsEnvironment` does not need modification — `rlmInternal` wraps every `env.exec()` call, so we emit before/after there without touching the environment class.

## Subtlety: event context in recursive calls

The `emit` closure captures the *outer* scope, but event context (which invocation? which iteration?) comes from the *inner* `rlmInternal` call. Since `rlmInternal` is recursive (children call it too), each recursive call has its own local `invocationId`, `iteration`, etc.

The `emit` function is shared, but the event data comes from each call site. This is the same pattern as `childTraceSlot.current` being swapped per-invocation. The emit *call sites* carry the context, not the emit function itself.

This means: every `emit()` call must explicitly include its invocation context. There is no ambient "current invocation" — the call site knows who it is and says so.
