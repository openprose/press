# RLM Observability

An outside process should be able to observe a running RLM without modifying the RLM itself. The system is recursive — observation must work across the full delegation tree, not just the root.

## What needs to be observable

1. **Iteration stream** — Each REPL turn: iteration number, depth, invocation ID, console output, error, wall time.

2. **Delegation tree** — When a child is spawned (parent ID, child ID, query, model, budget) and when it returns (return value, iterations used, error).

3. **Sandbox state** — The shared environment as it evolves. Both compact summaries (key counters) and full snapshots (serialized globals).

4. **LLM calls** — Model, timing, input/output size, finish reason. Already partially exists via stderr.

5. **Lifecycle events** — Invocation start, return, error, timeout, max-iterations exhaustion.

## Constraints

- Near-zero overhead relative to LLM call latency.
- Works for both eval harness runs and programmatic API usage.
- The RLM engine emits events; the consumer decides what to do with them.
- Must propagate through recursive `rlm()` calls without explicit wiring at each call site.
- No opinions about storage, display, or transport — those are consumer concerns.
