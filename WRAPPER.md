# Wrapper Mode

Press today is a self-contained RLM: a while loop, a model, and a JavaScript sandbox. This document specifies a second execution mode -- **wrapper mode** -- where Press orchestrates external coding agent harnesses (Claude Code, opencode, Cursor, Cline, etc.) instead of driving the LLM directly.

The wrapper keeps everything above the execution layer: Prose programs, contracts, Forme wiring, delegation trees, the filesystem conventions. It replaces the sandbox with a harness adapter that launches a real coding agent for each service invocation.

---

## Why

Press programs declare *what* to produce, not *how*. Today "how" means "write JavaScript in a sandbox." But the most capable coding agents -- Claude Code, opencode, pi -- already have rich tool surfaces: file editing, shell execution, test runners, git, LSP, web search. Wrapper mode lets Prose programs target those surfaces directly.

The bet: a Prose program executed by Claude Code (with its full tool palette) will outperform the same program executed in a bare REPL, because the inner agent can do things the sandbox cannot -- run tests, refactor code, interact with real systems.

---

## What Changes

| Layer | Current (sandbox mode) | Wrapper mode |
|-------|----------------------|--------------|
| Outer loop | `rlm.ts` while loop calling LLM API | Same loop, but dispatches to harness adapter |
| Inner executor | `JsEnvironment` (Node.js VM) | External process (Claude Code, opencode, etc.) |
| Tool surface | `execute_code` only | Whatever the harness provides natively |
| Shared state | JavaScript variables in shared VM | Filesystem (workspace directories) |
| Delegation | `press()` function in sandbox | Press spawns a new harness process per service |
| RETURN | `RETURN(value)` JS function | Agent writes output files and exits |
| System prompt | `buildSystemPrompt()` → LLM API | Injected via convention file (CLAUDE.md, OPENCODE.md, etc.) |
| Observability | Per-iteration sandbox snapshots | Service-level: inputs, outputs, timing, exit status |

## What Stays the Same

- **Prose programs.** Markdown files with `requires`/`ensures` contracts. Unchanged.
- **Forme wiring.** Read contracts, match outputs to inputs, topological sort, write manifest. Could become deterministic (no LLM needed) with stricter contract syntax.
- **Delegation tree.** Parent services delegate to children. Press manages the tree.
- **Workspace conventions.** `.prose/runs/{runId}/`, `services/`, `workspace/`, `bindings/`.
- **Drivers.** Behavioral shims in `lib/drivers/*.md` -- injected into the harness's convention file instead of the API system prompt.
- **Budget and depth limits.** `maxIterations` and `maxDepth` still govern the delegation tree.

---

## Filesystem as Shared State

The JavaScript sandbox is gone. All inter-service coordination happens through the filesystem.

### Workspace layout

```
.prose/runs/{runId}/
  manifest.md                         # Wired execution plan
  services/
    {serviceName}.md                  # Service definitions (copied from program)
  workspace/
    {serviceName}/
      input/                          # Inputs written by Press before launch
        {inputName}.md                # One file per requires entry
      output/                         # Outputs written by agent during execution
        {outputName}.md               # One file per ensures entry
      work/                           # Scratch space for the agent
  bindings/
    caller/                           # Original caller inputs
      {inputName}.md
    {serviceName}/                    # Resolved outputs from completed services
      {outputName}.md
```

### Contract

1. **Before launch:** Press writes each resolved input to `workspace/{service}/input/{name}.md`.
2. **During execution:** The agent works freely in `workspace/{service}/work/`. It reads inputs from `input/`, writes outputs to `output/`.
3. **On completion:** Press reads `workspace/{service}/output/` and copies results to `bindings/{service}/` for downstream consumers.
4. **Wiring:** When service B `requires` something that service A `ensures`, Press copies `bindings/A/{output}.md` to `workspace/B/input/{input}.md` before launching B.

No shared heap. No variable shadowing. No cross-process coordination. The filesystem is the only interface.

---

## Harness Adapters

A harness adapter is a function that knows how to launch and wait for a specific coding agent. Each adapter implements the same interface:

```typescript
interface HarnessAdapter {
  name: string;

  /** Launch the agent and return when it exits. */
  run(options: HarnessRunOptions): Promise<HarnessResult>;
}

interface HarnessRunOptions {
  /** Absolute path to the service workspace directory. */
  workspace: string;

  /** The service definition (markdown content). */
  serviceDefinition: string;

  /** The task description derived from the service contract. */
  task: string;

  /** Behavioral drivers to inject (markdown content). */
  drivers: string[];

  /** Press metadata for the invocation. */
  meta: {
    runId: string;
    invocationId: string;
    depth: number;
    maxDepth: number;
    parentId: string | null;
    lineage: string[];
  };

  /** Iteration/time budget hints. */
  budget: {
    maxIterations?: number;
    timeoutMs?: number;
  };
}

interface HarnessResult {
  /** Whether the agent exited cleanly. */
  ok: boolean;

  /** Which output files were written. */
  outputs: string[];

  /** Wall-clock duration in ms. */
  durationMs: number;

  /** Optional: token usage if the harness reports it. */
  usage?: { inputTokens: number; outputTokens: number };

  /** Error message if not ok. */
  error?: string;
}
```

### Claude Code adapter

1. Create a temporary `CLAUDE.md` in the workspace directory containing:
   - The service definition and contract
   - Resolved Press metadata (depth, lineage, budget)
   - Behavioral drivers
   - Instructions: "Read inputs from `input/`. Write outputs to `output/`. When done, exit."
2. Launch: `claude --print --system-prompt "..." --allowedTools "..." <task>` (or use `--append-system-prompt` to layer on top of defaults)
3. Working directory: `workspace/{service}/work/`
4. Wait for process exit.
5. Read `output/` directory for results.

### opencode adapter

1. Write `OPENCODE.md` to workspace with equivalent content.
2. Launch opencode in non-interactive mode with the task.
3. Same workspace/input/output convention.
4. Wait for exit, read outputs.

### Generic adapter (any CLI agent)

For agents without convention-file support:
1. Compose a task prompt that embeds the contract and instructions inline.
2. Launch the agent with the task as its initial prompt.
3. Same workspace convention.

---

## Prompt Injection Strategy

The system prompt injected into each harness contains two layers:

### Layer 1: Press context (always injected)

```markdown
# Press Service Invocation

You are executing a service within a Press program.

## Your contract
{serviceDefinition}

## Your inputs
Read your inputs from the `input/` directory in your working directory.
Each file corresponds to a `requires` entry in your contract.

## Your outputs
Write your outputs to the `output/` directory in your working directory.
Each file corresponds to an `ensures` entry in your contract.
When all outputs are written, you are done.

## Metadata
- Run: {runId}
- Service: {serviceName}
- Depth: {depth}/{maxDepth}
- Parent: {parentId}
- Lineage: {lineage}
```

### Layer 2: Behavioral drivers (selectively injected)

Drivers from `lib/drivers/*.md` are appended based on the program's configuration. These are the same drivers used in sandbox mode -- they are behavioral instructions, not sandbox-specific.

Examples that transfer directly:
- `verify-before-return.md` -- "Verify your outputs before finishing"
- `context-discipline.md` -- "Parse input data once, reference by variable/file"
- `deadline-return.md` -- "Return the best answer you have when approaching budget"

Examples that need adaptation:
- `repl-discipline.md` -- References REPL iteration patterns (sandbox-specific)
- `shared-context-delegation.md` -- References shared VM variables (replaced by filesystem)
- `await-discipline.md` -- References `await press()` (replaced by subprocess lifecycle)

---

## The Return Mechanism

In sandbox mode, agents call `RETURN(value)`. In wrapper mode, completion is signaled by the agent exiting cleanly after writing its output files.

Press detects completion by:
1. **Process exit.** The harness process terminates.
2. **Output verification.** Press checks that all `ensures` entries have corresponding files in `output/`.
3. **Partial completion.** If some outputs are missing, Press can either fail the service or retry with a prompt that says which outputs are still needed.

There is no explicit `RETURN()` call. The filesystem *is* the return value.

### Why not inject a tool?

MCP tools could provide a `press_return` tool, but:
- Not all harnesses support MCP.
- File-based completion works universally.
- It is simpler to verify and debug.
- The filesystem convention is already how Press programs think about state.

---

## Execution Flow

```
pressRun(program, callerInputs, { mode: "wrapper", harness: "claude-code" })
  │
  ├── Phase 1: Forme wiring
  │   ├── Read program contracts
  │   ├── Match ensures → requires across services
  │   ├── Topological sort
  │   └── Write manifest.md
  │
  ├── Write caller inputs to bindings/caller/
  │
  └── Phase 2: Execute manifest
      │
      ├── For each service in execution order:
      │   ├── Resolve inputs: copy from bindings/ to workspace/{service}/input/
      │   ├── Select harness adapter
      │   ├── Compose injected prompt (contract + drivers + metadata)
      │   ├── Launch harness subprocess
      │   ├── Wait for exit
      │   ├── Verify outputs in workspace/{service}/output/
      │   └── Copy outputs to bindings/{service}/
      │
      ├── Parallel services: launch concurrently, wait for all
      │
      └── Read final outputs from bindings/ → return to caller
```

### Parallel execution

Services with no dependency between them can run concurrently. Press launches multiple harness processes in parallel and waits for all to complete. This replaces `Promise.all([press(...), press(...)])` from sandbox mode.

The Forme phase already produces a dependency graph. Independent services are those with no path between them in the graph.

---

## Forme Phase: Toward Deterministic Wiring

In sandbox mode, the Forme phase uses an LLM to read contracts and build the manifest. This works because contracts are written in natural language and matching requires judgment.

In wrapper mode, Forme can optionally be **deterministic** -- pure code, no LLM:

1. Parse all service `.md` files in the program directory.
2. Extract `requires` and `ensures` entries from each.
3. Match by name: service B `requires: analysis` is satisfied by service A `ensures: analysis`.
4. Topological sort the resulting dependency graph.
5. Write `manifest.md`.

This works when contract names are unambiguous. For fuzzy matching (e.g., `requires: documentation` satisfied by `ensures: analysis`), the LLM Forme phase is still available as a fallback.

---

## Observability

Wrapper mode trades iteration-level granularity for service-level observability.

### What we keep
- `run:start` / `run:end` -- program-level lifecycle
- `invocation:start` / `invocation:end` -- per-service lifecycle
- `delegation:spawn` / `delegation:return` / `delegation:error` -- delegation events
- Token usage (if the harness reports it)
- Wall-clock timing per service

### What we lose
- `iteration:start` / `iteration:end` -- the inner agent's iterations are opaque
- `sandbox:snapshot` -- no shared VM to snapshot
- `llm:request` / `llm:response` -- API calls happen inside the harness

### What we gain
- Real-world artifacts: git commits, test results, file diffs
- The agent's own trace (Claude Code produces conversation logs; opencode has its own observability)
- Filesystem diff: `workspace/{service}/` before vs. after is itself a trace

### Event model

```typescript
// New events for wrapper mode
type WrapperEvent =
  | { type: "harness:launch"; service: string; harness: string; workspace: string }
  | { type: "harness:exit"; service: string; ok: boolean; durationMs: number; outputs: string[] }
  | { type: "harness:error"; service: string; error: string }
  | { type: "wiring:start"; services: string[] }
  | { type: "wiring:end"; manifest: string; deterministic: boolean };
```

---

## Open Questions

### 1. Sub-delegation

Can a service delegate to child services? In sandbox mode, this is natural -- `press()` is recursive. In wrapper mode, it would mean the inner agent launches *another* harness process. Options:

- **No sub-delegation in v1.** Services are leaf nodes. Only the root orchestrator delegates.
- **Press as MCP server.** Expose `press()` as an MCP tool that the inner agent can call. This creates a callback from the harness back to Press.
- **File-based delegation request.** The agent writes a `delegate.json` to request a sub-delegation. Press watches for it, runs the child, writes results back. Polling-based but universal.

### 2. Streaming vs. batch

Does Press watch the harness in real-time or just wait for it to finish? Real-time watching could enable:
- Progress reporting
- Budget enforcement (kill the process if it is taking too long)
- Intermediate state inspection

For v1, batch (wait for exit) is simpler and sufficient.

### 3. Harness-specific capabilities

Some harnesses have capabilities others lack. Claude Code can run tests; opencode might not have the same tool surface. Should the Forme phase consider harness capabilities when wiring? Probably not in v1 -- treat all harnesses as equivalent general-purpose agents.

### 4. Error recovery and retry

When a service fails (missing outputs, non-zero exit), options:
- Retry with the same harness and a diagnostic prompt ("Previous attempt failed because: {error}. Missing outputs: {list}.")
- Retry with a different harness.
- Fail the entire program.

Retry with diagnostic prompt is the natural first choice -- it mirrors how sandbox mode handles errors (feed the error back into the loop).

### 5. Cost attribution

Token usage inside external harnesses may be hard to attribute precisely. Claude Code may not expose per-request token counts. We may only get wall-clock time and a total token count (if that). This is acceptable for v1 -- service-level cost tracking is sufficient.
