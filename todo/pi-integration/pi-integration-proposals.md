# Pi Integration Proposals for node-rlm

Three architectural options for integrating Pi's capabilities (model routing, native tool use, context management, extensions) into node-rlm while preserving the RLM's core: shared VM sandbox, recursive delegation, program system, eval harness, and plugin system.

**Date**: 2026-02-24
**Branch**: feat/arc3-benchmark
**Pi codebase**: `~/code/trinity/pi-mono/` (v0.52.7)
**OpenClaw reference**: `~/code/trinity/openclaw/` (Pi v0.54.1)

---

## Table of Contents

1. [Background](#background)
2. [Option A: Pi-inside-RLM](#option-a-pi-inside-rlm)
3. [Option B: RLM-as-Pi-Extension](#option-b-rlm-as-pi-extension)
4. [Option C: RLM-as-Pi-Tool](#option-c-rlm-as-pi-tool)
5. [Comparison Matrix](#comparison-matrix)
6. [Decision Framework](#decision-framework)

---

## Background

### What We Want From Pi

- Model routing and provider abstraction (Anthropic, Google, OpenAI, Bedrock, Azure — all native, not just OpenRouter)
- Native tool-use protocol (eliminate `__TOOL_CALL__`/`__TOOL_RESULT__` marker convention)
- Context management (compaction for long sessions)
- Streaming and token usage tracking
- Extension model for additional capabilities
- Peripheral niceties (TUI, session persistence, OAuth, model cycling)

### What We Must Preserve From node-rlm

1. **`JsEnvironment` sandbox** — vm-based, acorn hoisting, shared across the entire delegation tree
2. **`rlm()` recursive delegation** — child agents with separate message histories, shared VM, invocation stack, context stores
3. **Program system** — root.md + component .md files, composition vocabulary, component catalogs
4. **Eval harness** — benchmarks (oolong, s-niah, arc, arc3), scoring, datasets, resumability
5. **Plugin system** — drivers, apps, profiles (markdown files concatenated into system prompts)

### Pi Architecture Summary

Pi is a mono-repo at `~/code/trinity/pi-mono/` with three relevant layers:

- **`@mariozechner/pi-ai`** — LLM abstraction. `streamSimple(model, context, options)` dispatches to registered providers (Anthropic Messages, OpenAI Responses, Google Generative AI, Bedrock, etc.). Provider-agnostic streaming.
- **`@mariozechner/pi-agent-core`** — `Agent` class + `agentLoop()`. Event-driven loop: stream response, execute tool calls, check for steering/follow-up, repeat. Replaceable `streamFn`, `convertToLlm`, `transformContext` hooks.
- **`@mariozechner/pi-coding-agent`** — Full SDK: `createAgentSession()`, tools (read/bash/edit/write), extensions, session management, compaction, TUI, three run modes (interactive/print/RPC).

Key integration seams:
1. `createAgentSession()` — SDK factory (how OpenClaw integrates)
2. `Agent` class — direct usage without the coding-agent layer
3. `agentLoop()` — raw loop functions returning event streams
4. `streamFn` — replaceable on Agent, controls LLM calls
5. `convertToLlm` / `transformContext` — hooks for message conversion and context manipulation

Notable: pi-mono already has `@mariozechner/pi-rlm` at `packages/rlm/` — an earlier, simpler RLM. node-rlm is a strict superset of its features.

---

## Option A: Pi-inside-RLM

### Architecture Overview

Import `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core` as npm dependencies into node-rlm. Create a Pi `Agent` instance per `rlmInternal()` invocation, each with a custom `execute_code` `AgentTool` that wraps the shared `JsEnvironment`. node-rlm retains its loop, sandbox, delegation, and programs. Pi replaces the LLM call layer and tool-use protocol.

```
                    node-rlm (preserved)

  eval/harness.ts  -->  rlm()
                         |
          +--------------+-------------+
          |  System prompt  | Plugin/   |
          |  builder        | Program   |
          |  (unchanged)    | system    |
          +--------+--------+           |
                   |                    |
          +--------v--------+           |
          |  Pi Integration |           |
          |  Layer (NEW)    |           |
          |                 |           |
          |  - Agent per    |           |
          |    rlmInternal()|           |
          |  - execute_code |           |
          |    as AgentTool |           |
          +--------+--------+           |
                   |                    |
          +--------v---------+          |
          | @mariozechner/   |          |
          | pi-ai            |          |
          |  streamSimple()  |          |
          |  Provider reg.   |          |
          +---------+--------+          |
                    |                   |
          +---------v--------+          |
          | @mariozechner/   |          |
          | pi-agent-core    |          |
          |  Agent class     |          |
          |  agentLoop()     |          |
          +------------------+          |
                                        |
          +------------------+          |
          | JsEnvironment    | (preserved)
          |  vm sandbox      |          |
          |  acorn hoisting  |          |
          +------------------+          |
```

The key insight: Pi's `Agent` is used **per invocation**, not as a singleton. Each `rlmInternal()` call creates its own Agent with its own `execute_code` tool instance, but all tools share the same `JsEnvironment`.

### Integration Strategy: The Agent Class

Of Pi's three seams — `createAgentSession()`, `Agent` class, `agentLoop()` — the **Agent class** is the right integration point:

- **Not `createAgentSession()`**: Designed for the Pi coding-agent experience. Loads ResourceLoader, SessionManager, SettingsManager, ModelRegistry, and file-system tools. node-rlm doesn't want any of this.
- **Not raw `agentLoop()`**: Pushes all state management onto node-rlm. The Agent class already wraps this cleanly.
- **The `Agent` class**: Message state management, `prompt()`/`continue()` to drive the loop, `subscribe()` for events, replaceable `streamFn`/`convertToLlm`/`transformContext`. No opinions about tools or system prompts.

### Mapping Current Abstractions

#### `CallLLM` -> Pi's streaming/model system

`CallLLM` is eliminated entirely. Pi's `Agent` takes a `Model<Api>` and calls `streamSimple()` internally.

```typescript
// Before: fromProviderModel("anthropic/claude-opus-4-6")
// After:
import { getModel } from "@mariozechner/pi-ai";
const model = getModel("anthropic", "claude-opus-4-6");
```

The `__TOOL_CALL__`/`__TOOL_RESULT__` marker convention (lines 442-463 of `rlm.ts`) is completely eliminated. Pi's `agentLoop()` natively handles tool calls via the `AgentTool` interface.

Model aliases: `RlmOptions.models` changes from `Record<string, { callLLM }>` to `Record<string, { model: Model<Api> }>`.

#### The iteration loop -> Pi's agent loop

Pi's loop runs until the model stops making tool calls. node-rlm's loop counts iterations.

Recommended hybrid approach: let Pi manage the LLM-call-and-tool-execution cycle (one "turn"), but node-rlm counts turns and enforces the iteration budget via `getFollowUpMessages` (injects iteration context) and `getSteeringMessages` (urgency/abort when budget exhausted).

#### `JsEnvironment` -> Pi tool (custom `execute_code` tool)

Clean mapping. Create an `AgentTool` implementation:

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

function createExecuteCodeTool(
  env: JsEnvironment,
  invocationStack: string[],
  invocationId: string,
  depth: number,
  onReturn: (value: unknown) => void,
): AgentTool {
  return {
    name: "execute_code",
    label: "Execute Code",
    description: "Execute JavaScript in a persistent Node.js REPL...",
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript code to execute" }),
    }),
    execute: async (toolCallId, params, signal) => {
      invocationStack.push(invocationId);
      env.set("__rlm", Object.freeze({ depth, ... }));
      try {
        const { output, error, returnValue } = await env.exec(params.code);
        if (returnValue !== undefined) onReturn(returnValue);
        let text = output || "(no output)";
        if (error) text += `\nERROR: ${error}`;
        return { content: [{ type: "text", text }], details: { returnValue, error } };
      } finally {
        invocationStack.pop();
      }
    },
  };
}
```

The same `JsEnvironment` instance is shared across all invocations. Each `rlmInternal()` creates its own tool instance that captures the correct invocationId/depth but points to the same `env`.

#### System prompt building -> unchanged

`buildSystemPrompt()` stays exactly as-is. Pi's Agent has `setSystemPrompt(v: string)` — just set it before calling `agent.prompt()`.

#### Plugin/program system -> unchanged

The plugin system produces strings; `buildSystemPrompt()` consumes strings; `Agent.setSystemPrompt()` accepts a string. Completely orthogonal to Pi.

#### `rlm()` delegation -> Agent-per-invocation

Each `rlmInternal()` invocation creates its own Pi `Agent` with its own system prompt, tool, and model. Parent Agent is paused (tool execution awaiting child result). Child Agent runs to completion, returns answer, control returns to parent.

```
Parent Agent.prompt("task")
  -> execute_code tool.execute()
     -> env.exec("await rlm('sub-task', data)")
        -> rlm() sandbox function
           -> rlmInternal() at depth+1
              -> Child Agent.prompt("sub-task")
                 -> execute_code tool.execute()
                    -> env.exec(child_code)
                 <-- child agent completes
              <-- rlmInternal returns RlmResult
           <-- rlm() returns answer string
        <-- env.exec() returns output
     <-- tool.execute() returns AgentToolResult
  <-- Parent agent continues
```

### What Changes

**Replaced entirely:**

| File | Replacement |
|------|-------------|
| `src/drivers/openrouter-compatible.ts` | `@mariozechner/pi-ai` provider registry + `streamSimple()` |
| `EXECUTE_CODE_TOOL` / `TOOL_CHOICE` constants | `AgentTool` interface with TypeBox schema |
| `eval/drivers/openrouter.ts` | Pi's `getModel("openrouter", modelId)` |

**Significantly adapted:**

| File | What changes |
|------|-------------|
| `src/rlm.ts` | `rlmInternal()` creates Pi Agent per invocation, uses `AgentTool` for execute_code. Outer rlm(), JsEnvironment setup, context store, invocation stack all stay. |
| `src/rlm.ts` types | `CallLLM` eliminated. `RlmOptions.callLLM` replaced with `Model<Api>`. |
| `eval/run.ts` | Model resolution via `getModel()` instead of `fromOpenRouter()`. |
| `eval/harness.ts` | Token counting from Pi's `AssistantMessage.usage` instead of character estimation. |

**Stays exactly as-is:** `environment.ts`, `plugins.ts`, all `plugins/` markdown, `eval/datasets/`, `eval/scoring.ts`, `eval/arc3-client.ts`.

### What We Gain

1. **Multi-provider support** — Anthropic, Google, OpenAI, Bedrock, Azure, OpenRouter, all via `getModel()`. Zero code changes to switch providers.
2. **Native tool-use protocol** — Eliminates `__TOOL_CALL__`/`__TOOL_RESULT__` marker convention. Structured `ToolCall` objects, proper `toolCallId` tracking.
3. **Streaming** — Token-by-token responses. Enables progress indicators, faster abort, future interactive UIs.
4. **Token usage and cost tracking** — Actual token counts from providers, replacing character-count estimation.
5. **Reasoning token abstraction** — Pi's `ThinkingLevel` maps to each provider's reasoning mechanism (Anthropic extended thinking, OpenAI reasoning effort, Google thinking).
6. **Retry logic with provider awareness** — Rate limit headers, retry-after, exponential backoff with jitter.
7. **Context management (future)** — Pi's `transformContext` hook enables compaction for long sessions.
8. **Codebase convergence** — Path to upstream innovations into `@mariozechner/pi-rlm`.

### What We Risk/Lose

1. **Dependency weight** — `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core` + `@sinclair/typebox`. Increases `node_modules`, creates version-lock with pi-mono.
2. **Iteration budget enforcement is awkward** — Pi's loop has no iteration concept. Must use follow-up/steering messages + abort. Needs prototyping.
3. **Message format mismatch** — Pi uses structured content arrays; node-rlm uses flat strings. `TraceEntry` format changes.
4. **`return()` mechanism is non-standard** — No Pi concept of "tool signals loop termination." Needs flag + abort or steering approach.
5. **Early return interception gets more complex** — First-iteration return rejection moves into tool handler logic.
6. **No-code response handling** — Pi exits loop when no tool calls. Must force tool use via `tool_choice` or follow-up messages.
7. **`tool_choice: required` + reasoning conflict** — Anthropic extended thinking is incompatible with forced tool choice. Pi may or may not handle this automatically.

### Migration Path

**Phase 0: Preparation** (no functional changes)
- Add `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@sinclair/typebox` as dependencies.
- Verify no conflicts with existing fetch-based drivers.

**Phase 1: Replace `CallLLM` with Pi's model system** (LLM layer swap)
- Create `src/drivers/pi-ai.ts` — a `CallLLM`-shaped adapter wrapping `streamSimple()`. (~50 lines, similar to `pi-rlm/src/drivers/pi-ai.ts`.)
- Update `eval/run.ts` to resolve models via `getModel()`.
- Run eval suite — identical results expected. Only the HTTP layer changes.

**Phase 2: Replace tool-call protocol with Pi's native tool use**
- Create `src/tools/execute-code.ts` — `AgentTool` wrapping `JsEnvironment.exec()`.
- Refactor `rlmInternal()` to create Pi `Agent` per invocation.
- Remove `__TOOL_CALL__`/`__TOOL_RESULT__` convention.
- Update `TraceEntry` for Pi's structured messages.

**Phase 3: Use Pi's Agent loop for multi-turn execution**
- Replace per-invocation for-loop with `agent.prompt()` + budget management via follow-up/steering messages.
- Implement `return()` detection via flag + abort.

**Phase 4: Leverage Pi's advanced features**
- Token-based context management (compaction for ARC-3 games).
- Actual token usage in eval harness.
- Streaming traces.
- Model-specific reasoning via `ThinkingLevel`.

**Phase 5 (optional): Converge with `@mariozechner/pi-rlm`**
- Port programs, context stores, eval harness into pi-mono.
- node-rlm becomes a thin wrapper.

### Open Questions

1. **Iteration budget**: Which enforcement approach (abort-based, single-turn-per-call, or follow-up-messages) works best? Needs prototyping against oolong benchmark.
2. **`return()` detection timing**: Cleanest way to prevent next LLM call after return — flag+steering, abort-from-tool, or special error?
3. **Nested streaming**: Can child Agent's `streamSimple()` safely run inside parent's awaited tool execution? (Expected: yes, JavaScript event loop handles this.)
4. **`convertToLlm` interaction**: Use Pi's `AgentMessage` throughout or bridge via adapter?
5. **Dependency strategy**: npm publish, git submodule, or workspace link for pi-mono packages?
6. **Forced `tool_choice`**: Works across all Pi providers? Conflict with reasoning tokens?
7. **Error propagation**: Pi's error path must construct `RlmError` with accumulated trace.

---

## Option B: RLM-as-Pi-Extension

### Architecture Overview

Invert the dependency. Pi is the outer shell and process host. RLM's unique capabilities — shared VM sandbox, recursive delegation, program system — are delivered as Pi extensions and a shared library package.

```
pi-mono/
  packages/
    rlm/                    # Existing (upgraded to node-rlm feature parity)
      src/
        environment.ts      # JsEnvironment (shared VM sandbox)
        rlm.ts              # Core rlm() function, delegation
        system-prompt.ts    # RLM system prompt builder
        plugins.ts          # Program loader
    rlm-extension/          # NEW: Pi extension package
      src/
        extension.ts        # ExtensionFactory entry point
        execute-code-tool.ts  # Pi tool wrapping JsEnvironment
        delegation.ts       # rlm() delegation managed outside Pi's loop
        program-loader.ts   # Loads root.md + components into system prompts
        eval-bridge.ts      # Eval harness integration
    coding-agent/           # Existing Pi coding agent (unchanged)
    agent/                  # Existing Pi agent core (unchanged)
    ai/                     # Existing Pi AI layer (unchanged)
```

Pi's `Agent` class runs the outer conversation loop. The RLM extension registers an `execute_code` tool, injects RLM system prompt sections via `before_agent_start`, and manages recursive delegation as a sub-system inside the sandbox.

### Responsibility Split

| Concern | Provider |
|---------|----------|
| Process lifecycle, TUI, session persistence | Pi (`AgentSession`, interactive mode) |
| Model routing, provider registry, API keys | Pi (`@mariozechner/pi-ai`, `ModelRegistry`) |
| Tool dispatch, tool call/result protocol | Pi (`agentLoop()`, `AgentTool` interface) |
| Context management, compaction | Pi (compaction system, `transformContext`) |
| Streaming, message management | Pi (`Agent`, `EventStream`) |
| JavaScript sandbox (VM, acorn hoisting) | RLM (`JsEnvironment`) |
| Recursive delegation (`rlm()` in sandbox) | RLM extension (delegation manager) |
| Program system (root.md, components) | RLM extension (program loader) |
| Eval harness | RLM (standalone, imports `rlm()` as library) |

### Extension Design

#### The `execute_code` Tool Extension

Maps cleanly to Pi's `ToolDefinition`. The extension owns the `JsEnvironment` lifetime — creates it at session start, same instance persists across all tool calls.

```typescript
export function createExecuteCodeTool(env: JsEnvironment) {
  return {
    name: "execute_code",
    label: "Execute Code",
    description: "Execute JavaScript in a persistent Node.js REPL...",
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript code to execute" }),
    }),
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const { output, error, returnValue } = await env.exec(params.code);
      let text = output || "(no output)";
      if (error) text += `\nERROR: ${error}`;
      return { content: [{ type: "text", text }], details: { returnValue, error } };
    },
  };
}
```

**Critical difference from Pi's bash tool**: Pi's bash spawns a child process per call (stateless). The `execute_code` tool wraps a persistent `JsEnvironment` (deeply stateful). Pi's tool interface is stateless per contract, but nothing prevents a stateful implementation — the extension owns the instance.

#### The Delegation Extension (The Hard Part)

**Recommended approach: Delegation as sandbox function.**

The extension injects `rlm()` into the `JsEnvironment`. When called:
1. `execute_code` tool is still running (awaiting `env.exec()`, which awaits `rlm()`).
2. `rlm()` calls `streamSimple()` directly from `@mariozechner/pi-ai`. It does NOT go through Pi's `Agent` or `agentLoop()`. Manages its own message history.
3. Child code executes in the same `JsEnvironment`.
4. From Pi's perspective, a single `execute_code` tool call took a long time.

**Why not nested Agent instances**: Pi's `Agent` class throws if you call `prompt()` while streaming. Nesting is not supported. And Pi's `SessionManager` assumes a single conversation — no tree of sessions.

```typescript
export function injectDelegation(env: JsEnvironment, opts: {
  getModel: () => Model<any>;
  getApiKey: (provider: string) => Promise<string | undefined>;
  maxDepth: number;
  maxIterations: number;
}) {
  async function rlmInternal(query, context, depth, ...): Promise<RlmResult> {
    const model = opts.getModel();
    const apiKey = await opts.getApiKey(model.provider);
    // Build RLM system prompt, manage own message history,
    // call streamSimple() directly, execute code in shared env
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const stream = streamSimple(model, { systemPrompt, messages, tools }, { apiKey });
      // ... collect response, exec code, check return ...
    }
  }
  env.set("rlm", (q, c, rlmOpts) => rlmInternal(q, c, depth + 1, ...));
}
```

#### The Program Loader Extension

Uses `before_agent_start` to completely replace Pi's system prompt:

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  const rlmPrompt = buildSystemPrompt({
    canDelegate: true, invocationId: "root", depth: 0, maxDepth: config.maxDepth,
    programContent: program?.rootAppBody, globalDocs: program?.globalDocs,
    modelTable: buildModelTable(config.models),
  });
  return { systemPrompt: rlmPrompt };
});
```

Also sets active tools: `pi.setActiveTools(["execute_code"])` — Pi's default tools (read, bash, edit, write) are irrelevant.

#### Eval Integration

The eval harness stays standalone. It imports `rlm()` from `@mariozechner/pi-rlm` and uses `streamSimple` for LLM calls. No Pi Agent, no Pi session, no Pi extension. The eval harness doesn't need TUI, session persistence, or compaction.

### The Shared VM Challenge

Pi's tool execution treats each call as isolated. `execute_code` breaks this assumption — variables from call N are visible in call N+1. **This is not actually a problem.** Pi's tool interface is stateless per contract, but nothing prevents a stateful implementation. The extension owns the `JsEnvironment`.

**Session resumability is the real issue.** Pi persists message history, but sandbox state is not captured. On resume, the sandbox is empty.

Mitigation options:
1. Accept the limitation (RLM sessions are ephemeral).
2. Snapshot/restore via `appendEntry()` and `session_start` handler.
3. Re-execute prior code blocks (fragile, slow).

### The Recursion Challenge

Child agents spawned by `rlm()` are invisible to Pi. They don't appear in `Agent._state.messages`. They don't trigger Pi events. From Pi's perspective, a single `execute_code` call takes a long time.

**Consequence: Children bypass Pi's infrastructure.** No compaction, no session persistence, no tool events, no extension hooks for child code execution.

**This is acceptable.** Children are lightweight, focused, short-lived. They need the shared sandbox and LLM access, not TUI or session persistence.

### System Prompt Integration

Pi's coding-agent prompt and RLM's prompt are **incompatible**. The RLM model is a REPL agent that writes JavaScript, not a coding agent that reads/edits files.

**Resolution: Full replacement.** The RLM extension uses `before_agent_start` to completely replace Pi's prompt with the RLM prompt structure (preamble, environment, context, rules, program).

### What Changes

**Rewritten:**

| Component | Detail |
|-----------|--------|
| `rlm()` LLM interface | `CallLLM` -> `streamSimple` from pi-ai. Handle tool-call messages natively. |
| Driver system | Delete `eval/drivers/openrouter.ts` and `plugins/drivers/`. Pi's provider registry replaces them. |
| Plugin profiles | Delete `plugins/profiles/`. Pi's `ModelRegistry` replaces them. |
| Message format | Rewrite to Pi's `Message` types. Eliminates `__TOOL_CALL__`/`__TOOL_RESULT__` markers. |

**Stays (used as library):** `JsEnvironment`, `buildSystemPrompt()`, `loadProgram()`, program files, eval harness, benchmarks, datasets, scoring.

### What We Gain

1. **Model routing and provider abstraction** — all Pi providers, zero new driver code.
2. **Native tool-use protocol** — structured tool calls, no marker hacks.
3. **TUI for interactive use** — rich terminal UI with streaming, model switching, session navigation. node-rlm currently has no interactive UI.
4. **Session persistence** — conversations saved to disk with branching, resumability.
5. **Context compaction** — summarize long conversations to stay within context windows.
6. **Extension ecosystem** — custom UI widgets, shortcuts, commands, additional tools.
7. **OAuth and API key management** — credential lifecycle including OAuth flows.

### What We Risk/Lose

1. **Child agent opacity** — children invisible to Pi. No streaming display during delegation. Mitigation: `onUpdate` callbacks for progress.
2. **Compaction doesn't understand delegation** — compaction summarizer will flatten delegation semantics. Mitigation: hook `session_before_compact` for custom summarization.
3. **Dual LLM call paths** — root via Agent, children via `streamSimple()` directly. API key resolution, retry logic, and cost tracking must work in both paths.
4. **Session resumability** — sandbox state lost on resume. Mitigation: snapshot/restore via `appendEntry`.
5. **`tool_choice: required` not supported** — Pi's `agentLoop` doesn't force specific tool use. Needs Pi core change or `streamFn` override.
6. **Iteration budget enforcement** — Pi has no concept. Must implement via `turn_end` hooks + abort.
7. **`return()` mechanism** — must stop Pi's loop from within a tool. Options: abort, strip tools, suppress tool result. Each has tradeoffs.

### Migration Path

**Phase 0: Extract `@mariozechner/pi-rlm` library** (1-2 days)
- Upgrade `pi-mono/packages/rlm/` to node-rlm feature parity: tool-use mode, program system, model aliases, context stores, trace metadata, reasoning tokens.

**Phase 1: Standalone extension with `execute_code` tool** (2-3 days)
- Create `packages/rlm-extension/`.
- Implement execute_code tool, `before_agent_start` system prompt replacement, session_start handler, basic iteration tracking.
- Deliverable: Pi as interactive RLM shell. No delegation yet.

**Phase 2: Delegation via sandbox** (3-5 days)
- Implement `rlm()` as sandbox function calling `streamSimple()` directly.
- Handle invocation stack, context stores, model alias resolution, child iteration loops, `return()` handling, `tool_choice` enforcement.

**Phase 3: Program loader** (1-2 days)
- Load root.md + component files, inject into system prompts, wire childApps to delegation.

**Phase 4: Eval harness adaptation** (1-2 days)
- Import from `@mariozechner/pi-rlm`, use `fromModel()`. Verify all benchmarks.

**Phase 5: Polish and feature parity** (2-3 days)
- Child progress streaming to TUI.
- Sandbox snapshot/restore.
- Custom compaction handler.
- Trace visualization.
- Slash commands, CLI flags.

**Total: 10-16 days**

### Open Questions

1. **Where does `@mariozechner/pi-rlm` live?** Recommendation: canonical in pi-mono, node-rlm hosts eval/benchmarks/programs and imports from it.
2. **Can Pi's `agentLoop` support `toolChoice`?** Small change to `streamAssistantResponse()`. Is a Pi core change acceptable?
3. **How should `return()` work at root level?** Abort (simplest, loses final summary), strip tools (cleanest), modify agentLoop (Pi core change), or instruction-based (fragile)?
4. **Should extensions support both interactive and eval modes?** Eval works fine standalone.
5. **`__TOOL_CALL__`/`__TOOL_RESULT__` elimination**: Requires updating `CallLLM` to return structured messages.
6. **Pi's default tools**: Hide when RLM extension is active? Or expose file access as sandbox globals for hybrid mode?
7. **Concurrency within delegation**: Parallel `rlm()` calls work today via invocation stack push/pop. Should port directly.

---

## Option C: RLM-as-Pi-Tool

### Architecture Overview

RLM runs as a **tool** within a Pi coding agent session. The Pi agent has access to standard tools (bash, read, edit, write) PLUS an `execute_rlm` tool that spawns an entire RLM delegation tree. Pi decides when to use RLM. The two systems are composed, not merged.

```
Pi Coding Agent (outer shell)
  |-- bash, read, edit, write, grep (standard tools)
  |-- execute_rlm (new tool)
        |
        +-- node-rlm rlm() function
              |-- JsEnvironment (shared VM sandbox)
              |-- recursive rlm() delegation
              |-- program system
              |-- CallLLM adapter (uses pi-ai)
```

### What It Preserves

**From Pi**: Agent loop, tools, extensions, session management, compaction, model registry, TUI, interactive mode, OAuth — everything. Pi is unchanged.

**From node-rlm**: The entire `rlm()` function, `JsEnvironment`, system prompt construction, program system, recursive delegation, invocation stack, context store, eval harness — everything. node-rlm is unchanged.

### What It Requires

~150 lines of new code, zero changes to either system.

**1. A Pi extension** that wraps `rlm()` as a tool:

```typescript
// rlm-tool-extension.ts (~100 lines)
import { Type } from "@sinclair/typebox";
import { rlm } from "node-rlm";

export const rlmExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "execute_rlm",
    label: "RLM",
    description: "Execute a recursive agent tree in a JavaScript sandbox.",
    parameters: Type.Object({
      query: Type.String(),
      context: Type.Optional(Type.String()),
      program: Type.Optional(Type.String()),
      maxIterations: Type.Optional(Type.Number()),
      maxDepth: Type.Optional(Type.Number()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const callLLM = piAiCallLLM(ctx.model, ctx.modelRegistry);
      const result = await rlm(params.query, params.context, {
        callLLM, maxIterations: params.maxIterations ?? 15,
        maxDepth: params.maxDepth ?? 3,
      });
      return {
        content: [{ type: "text", text: result.answer }],
        details: { iterations: result.iterations },
      };
    },
  });
};
```

**2. A `CallLLM` adapter** (~50 lines) converting Pi's `streamSimple()` to node-rlm's `CallLLM`. Two options:
- Use Pi's structured `AssistantMessage` to populate `code` and `toolUseId` directly (cleaner, native provider APIs).
- Use existing `openrouter-compatible.ts` driver, just swap HTTP for `streamSimple()`.

### Why This Is Distinct

Options A and B merge the systems — one absorbs the other. Option C keeps them separate and composes them through a standard tool interface. The integration point is Pi's `ToolDefinition`, not `CallLLM` (Option A) or `ExtensionFactory` (Option B).

### Tradeoffs

**Where Option C is better:**
- Lowest migration cost. No changes to either system.
- Both systems remain independent. node-rlm works standalone for eval/benchmarking. Pi works as coding agent. The tool bridges them.
- No architectural tension. Clear ownership boundaries.
- Fully reversible. Can add/remove freely.
- Incremental: start basic, add features (streaming trace updates, program loading) over time.

**Where Option C is worse:**
- **Opacity**: When `execute_rlm` runs, Pi sees "tool executing..." then a text result. No visibility into delegation tree, reasoning, or iterations.
- **No shared context**: RLM sandbox and Pi's file system are isolated. RLM agents can't read files; Pi agents can't inspect sandbox variables.
- **Double prompting cost**: Pi reasons about WHETHER to call RLM and WHAT to ask. Then RLM's root agent reasons about how to solve it. Extra LLM call that doesn't exist in A or B.
- **No session persistence**: RLM traces are not in Pi's session tree. History lost on resume.

### Migration Path

1. **Phase 0**: Create extension file, import `rlm`, register as Pi tool, write `CallLLM` adapter. Test with Pi session.
2. **Phase 1**: Add streaming updates via `onUpdate` callback (iteration progress, trace entries).
3. **Phase 2**: Add program support (load from `plugins/programs/`, expose as tool parameters).
4. **Phase 3**: Add extension hook for `context` events to inject RLM trace data into session history.
5. **Phase 4**: If tool boundary is too opaque, use that experience to commit to Option A or B.

### The Honest Assessment

Option C is architecturally conservative. It defers the deeper question of "how should recursive agent trees and coding agents coexist?" by putting a tool boundary between them. This is fine if the goal is pragmatic, but insufficient if the goal is a unified system.

---

## Comparison Matrix

| Dimension | A: Pi inside RLM | B: RLM as Pi Extension | C: RLM as Pi Tool |
|-----------|-------------------|------------------------|-------------------|
| Loop ownership | node-rlm's loop, Pi does LLM calls | Pi's loop (root), `streamSimple` (children) | Both loops, independent |
| node-rlm code changes | Moderate (driver + message layer) | Heavy (restructure as extensions) | None |
| Pi code changes | None | Minor (maybe `toolChoice`) | None |
| Migration effort | Medium, incremental | High, 10-16 days | Low, ~150 lines |
| Provider breadth | Full Pi providers | Full Pi providers | Full Pi providers (via adapter) |
| RLM features preserved | All | Most (friction at boundaries) | All |
| Pi features gained | Model routing, streaming, tokens | TUI, sessions, compaction, extensions, OAuth | Model routing (via adapter) |
| Child agent visibility | Full (same as today) | Root visible, children opaque to Pi | Entire RLM tree opaque to Pi |
| Eval harness | Works unchanged | Works unchanged (standalone) | Works unchanged |
| Reversibility | Moderate | Low | Full |
| Streaming visibility | Full | Root only in Pi TUI | None during RLM execution |
| Session persistence | None (as today) | Root conversation persisted | None for RLM traces |
| Independence | node-rlm is the shell | Pi is the shell | Both independent |

---

## Decision Framework

The right option depends on the actual goal:

### "I want Pi's provider ecosystem in node-rlm"
**-> Option A at Phase 1** (~50 line adapter). Keep node-rlm's loop, just swap the HTTP layer for `streamSimple()`. Minimum viable integration. You get multi-provider support with negligible risk.

### "I want Pi's model routing + native tool use, but keep RLM's loop and independence"
**-> Option A through Phases 2-3**. Native tool calls, multi-provider, streaming, token tracking — while keeping full control of iteration loop, delegation tree, and program system. Probably the sweet spot for near-term value.

### "I want a unified system where coding-agent and RLM workflows coexist"
**-> Option B**. Highest effort, but the only path to full Pi ecosystem benefits (TUI, session persistence, extensions). Accept the 10-16 day investment and the architectural tensions (child opacity, dual call paths, `return()` complexity).

### "I want to explore the integration before committing"
**-> Option C**. Write it in an afternoon, learn what the tool boundary feels like, use that experience to decide between A and B later. Zero risk, fully reversible.

### Non-exclusive paths

These options are not mutually exclusive in sequence:
- Start with **C** to validate the value proposition with minimal investment.
- Move to **A Phase 1** to get Pi's providers without changing node-rlm's architecture.
- Graduate to **A Phase 2-3** or **B** when the integration justifies deeper commitment.

Each step builds on the previous without wasted work.
