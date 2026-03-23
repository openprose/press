# Press Runtime

Press is an RLM (Recursive Language Model) runtime purpose-built for executing Prose programs. It implements the REPL loop, the sandbox environment, and the `press()` delegation primitive. Press does not define the Prose language or the Forme container framework — those are canonical specs maintained at [github.com/openprose/prose](https://github.com/openprose/prose). This document describes what Press does at runtime.

## Core Principle

Press is the loop, nothing more. The intelligence is in the model. The specifications are in the prompt. Press builds system prompts, runs sandbox code, observes output, and iterates. Everything else — wiring decisions, execution strategy, file management, contract evaluation — is the model reading specs and writing code.

---

## The REPL Loop

Press operates as a REPL (Read-Eval-Print Loop) that iterates until the model calls `RETURN()`:

```
1. Build system prompt (XML-wrapped specs, phase-specific context)
2. Send prompt + conversation history to the LLM
3. LLM responds with text and/or a ```repl fenced code block
4. Press extracts the code block
5. Press executes the code in a sandboxed environment
6. Press captures the output (console.log, return values, errors)
7. Press appends the output as an observation to the conversation
8. If RETURN() was called → exit loop, return the value
9. Otherwise → go to step 2
```

One code block per iteration. The model observes output before writing more code. The loop continues until `RETURN()` is called or the iteration budget is exhausted.

---

## Sandbox Globals

Every Press sandbox exposes these globals:

| Global | Purpose |
|--------|---------|
| `press(name, options)` | Spawn a child RLM loop for a named service |
| `RETURN(value)` | End the current loop and return a value to the caller |
| `console.log(...)` | Print output the model can observe between iterations |
| `context` | Object containing input data for the current invocation |
| `fs` (via `require`) | Node.js filesystem access |
| `fetch` | HTTP request capability |

### `press(serviceName, { inputs, workspace })`

The primary delegation primitive. It takes a **service name** — not an instruction or a brief. Press handles everything else:

1. **Looks up the service definition** from `services/{name}.md` in the run directory
2. **Resolves inputs** — file paths are read from disk; literal values pass through unchanged
3. **Parses the `ensures` section** to determine expected outputs
4. **Builds a child system prompt** with the service definition and resolved inputs
5. **Starts a new REPL loop** for the child

```javascript
// The model writes this in a ```repl block:
const result = await press("researcher", {
  inputs: {
    topic: "bindings/caller/question.md",   // path → resolved to file content
    style: "academic"                        // literal → passed as-is
  },
  workspace: ".prose/runs/{id}/workspace/researcher/"
});
```

The child receives resolved values in `context.inputs` — it never sees file paths, only content. This is pass-by-reference with resolution on entry.

### `RETURN(value)`

Ends the current REPL loop. The value is returned to the parent (or to the CLI if this is the root invocation). A child service typically returns a confirmation message, not the full output — output files are written to the workspace.

### `context`

Contains input data for the current invocation:

- **Root invocation (Phase 2):** `context` holds the manifest content and caller inputs
- **Child invocation (service):** `context.inputs` holds resolved input values keyed by name

---

## Two-Phase Execution

Press runs Prose programs in two phases. Each phase loads a different spec into the system prompt and gives the model a different role:

| Phase | Spec loaded | Model's role | Input | Output |
|-------|-------------|--------------|-------|--------|
| **Phase 1: Wiring** | `forme.md` | Forme Container | Component `.md` files | `manifest.md` |
| **Phase 2: Execution** | `prose.md` | Prose VM | `manifest.md` | Program output |

### Phase 1 — Wiring (Forme)

Press loads the Forme spec into the system prompt. The model reads the program entry point, resolves service files from disk, auto-wires dependencies by matching `requires` against `ensures`, and writes a `manifest.md` to the run directory. The model also copies source files into `services/`. Press provides the REPL loop and filesystem access; the model does all the wiring logic.

### Phase 2 — Execution (Prose VM)

Press loads the Prose VM spec into the system prompt. The model reads the manifest, binds caller inputs, and walks the execution order. For each service, the model calls `press(serviceName, { inputs, workspace })`. Press spawns a child REPL loop with the service definition and resolved inputs. The model manages `state.md`, `workspace/`, and `bindings/` per the filesystem spec.

### Single-component programs

For programs without a `services` list (no wiring needed), Phase 1 is skipped. The `.md` file is both the program and the sole service.

---

## Service Invocation

When the Phase 2 model calls `press("researcher", { inputs, workspace })`, Press:

1. Loads `services/researcher.md` from the run directory
2. Detects which input values are file paths (contain `/` and end in `.md`) and reads their content from disk
3. Parses `ensures:` from the service definition to determine expected output names
4. Builds a system prompt with:
   - The RLM preamble (REPL rules, depth info, iteration budget)
   - The session spec (from `primitives/session.md`)
   - The service definition (wrapped in `<service-definition>`)
   - The service context (resolved inputs, workspace path, required outputs)
5. Starts a child REPL loop

The child model sees its resolved inputs in `context.inputs`, its workspace path, and its output requirements. It does not see the manifest, other services, or the dependency graph.

---

## Depth and Budget

Child invocations include depth and budget information in their system prompt:

```
Invocation context:
- Depth: 1 (child of root)
- Parent: root orchestrator
- Iteration budget: 15
```

The iteration budget limits how many REPL cycles the child can use. This prevents runaway loops and encourages focused execution.

---

## Drivers and Profiles

Press supports model-specific **drivers** that handle the differences between LLM providers (API format, streaming, token counting). Drivers are a reliability mechanism — they normalize the interface so the REPL loop works consistently across models.

Drivers are secondary to the Prose and Forme specs. The specs define what the model should do; the driver ensures Press can talk to the model correctly.

---

## What Press Is Not

- **Not a language spec.** The Prose language (contracts, services, requires/ensures, strategies, invariants) is defined in the [Prose spec](https://github.com/openprose/prose). Press executes programs written in that language.
- **Not a container spec.** The Forme container framework (auto-wiring, dependency resolution, manifest format) is defined in the [Forme spec](https://github.com/openprose/prose). Press loads that spec into the prompt and lets the model be the container.
- **Not an orchestrator.** Press does not make wiring decisions, select composition strategies, or evaluate contracts. The model does all of that. Press provides the loop.
