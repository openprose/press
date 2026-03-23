# Press Container Implementation

This document describes how Press implements the two-phase execution model for Prose programs. It covers prompt assembly, input resolution, and how Press loads the Forme and Prose VM specs. The canonical specs themselves live at [github.com/openprose/prose](https://github.com/openprose/prose) — this document describes the runtime machinery, not the specs.

---

## Prompt Assembly

Press builds system prompts natively using XML tags. Each phase gets a different prompt assembled from spec files, context data, and a universal RLM preamble. The prompt builder lives in `src/press-prompt.ts`.

### Structure

Every system prompt follows this pattern:

```
1. RLM preamble (universal REPL rules)
2. Phase-specific spec(s) wrapped in XML tags
3. Run context (phase-specific task description)
```

### XML Wrapping

Specs are loaded from disk and wrapped in descriptive XML tags. This gives the model clear boundaries between different sections of the prompt:

```xml
<forme-spec>
{contents of forme.md}
</forme-spec>

<filesystem-spec>
{contents of state/filesystem.md}
</filesystem-spec>

<run-context>
Run ID: 20260317-143052-a7b3c9
Run directory: .prose/runs/20260317-143052-a7b3c9
Program directory: ./my-program/
Phase: 1 (Wiring)
...
</run-context>
```

The model sees the full spec text inside each tag. Press does not summarize, excerpt, or transform the specs — it loads them verbatim. The intelligence is in the model reading the spec; Press just delivers it.

### The RLM Preamble

Every prompt starts with the same preamble that explains the REPL environment:

- What Press is (an RLM runtime)
- Available globals (`press()`, `RETURN()`, `console.log()`, `context`)
- Code format rules (` ```repl ` fenced blocks, one per iteration)
- For child invocations: depth, parent ID, and iteration budget

---

## Phase 1: Wiring (Forme)

When Press detects a multi-component program (`kind: program` with a `services` list), it runs Phase 1.

### Prompt contents

| Section | XML tag | Source file |
|---------|---------|-------------|
| Forme spec | `<forme-spec>` | `forme.md` from spec directory |
| Filesystem spec | `<filesystem-spec>` | `state/filesystem.md` from spec directory |
| Run context | `<run-context>` | Generated: run ID, run dir, program dir, task description |

### What the model does

The model embodies the Forme Container as described in the spec. It:

1. Reads the program entry point from disk
2. Resolves each service file (same directory, subdirectory, or registry)
3. Extracts contracts (`requires`, `ensures`, `errors`, `invariants`, `strategies`)
4. Auto-wires dependencies by matching `requires` to `ensures`
5. Copies source files into `services/` in the run directory
6. Writes `manifest.md`
7. Calls `RETURN()` with a confirmation message

Press provides the REPL loop and filesystem access. The model does all wiring logic. Forme resolves its own service files — Press does not copy or resolve component files on behalf of the model.

---

## Phase 2: Execution (Prose VM)

After Phase 1 produces a manifest (or immediately for single-component programs), Press runs Phase 2.

### Prompt contents

| Section | XML tag | Source file |
|---------|---------|-------------|
| Prose VM spec | `<prose-vm-spec>` | `prose.md` from spec directory |
| Session spec | `<session-spec>` | `primitives/session.md` from spec directory |
| Filesystem spec | `<filesystem-spec>` | `state/filesystem.md` from spec directory |
| Run context | `<run-context>` | Generated: run ID, run dir, caller inputs, task description |

### What the model does

The model embodies the Prose VM as described in the spec. It:

1. Reads the manifest
2. Binds caller inputs to `bindings/caller/`
3. Walks the execution order
4. For each service, calls `press(serviceName, { inputs, workspace })`
5. Manages `state.md`, `workspace/`, and `bindings/` per the filesystem spec
6. Copies declared outputs from workspace to bindings (the return mechanism)
7. Calls `RETURN()` with the final program output

The model copies files; Press copies nothing. The workspace-to-bindings copy is the model writing code in the REPL, not Press infrastructure.

---

## Service Invocation (Child Loops)

When the Phase 2 model calls `press(name, { inputs, workspace })`, Press builds a child prompt.

### Prompt contents

| Section | XML tag | Source file |
|---------|---------|-------------|
| Session spec | `<session-spec>` | `primitives/session.md` from spec directory |
| Service definition | `<service-definition>` | `services/{name}.md` from run directory |
| Service context | *(plain text)* | Generated: resolved inputs, workspace, required outputs |

### What is different from root prompts

- No Forme or Prose VM spec — the child does not need the global picture
- Includes depth, parent ID, and iteration budget in the preamble
- Inputs are resolved (file content, not paths) and listed in the service context
- Output requirements are parsed from the service definition's `ensures` section

---

## The Resolver

The resolver (`src/press-resolver.ts`) implements pass-by-reference input resolution. When the model calls `press()`, the resolver processes the call before the child loop starts.

### Path Detection

A value is treated as a file path if:
- It contains `/` AND ends with `.md`
- It does NOT start with `http://` or `https://`

Everything else passes through as a literal value.

```
"bindings/caller/question.md"  → file path → read from disk
"academic"                      → literal   → passed as-is
"https://example.com/doc.md"   → URL        → passed as-is (not resolved)
```

### Content Resolution

When a file path is detected:

1. Read the file from disk
2. If the file uses the caller-input envelope format (contains `kind: input` header above a `---` separator), strip the header and return only the content payload
3. Otherwise, return the full file content

### Batch Resolution

Array inputs have each element resolved independently. This allows passing multiple file paths in a single input.

### Service Definition Loading

The resolver loads the service definition from `services/{name}.md` in the run directory. This is the file that Phase 1 (Forme) copied there during wiring.

### Output Parsing

The resolver parses the `ensures:` section of the service definition to extract output names. These names tell the child what files to write to its workspace.

### Full Resolution Pipeline

```
press("researcher", { inputs: { topic: "bindings/caller/question.md" } })

  1. Load services/researcher.md           → service definition
  2. Resolve inputs:
     topic: "bindings/caller/question.md"  → read file → "What is quantum computing?"
  3. Parse ensures from definition          → ["findings", "sources"]
  4. Determine workspace path               → .prose/runs/{id}/workspace/researcher/
  5. Return everything needed for child prompt
```

---

## Prompt Builder API

The prompt builder (`src/press-prompt.ts`) exposes a single function:

```typescript
buildPressPrompt(options: PromptOptions): string
```

Where `PromptOptions` is a discriminated union on `phase`:

| Phase | Options | Produces |
|-------|---------|----------|
| `"forme"` | runId, runDir, programDir, specDir, entryPoint | Phase 1 wiring prompt |
| `"prose-vm"` | runId, runDir, specDir, manifest, callerInputs | Phase 2 execution prompt |
| `"service"` | runId, runDir, specDir, serviceName, serviceDefinition, inputs, workspace, outputs, depth, parentId, iterationBudget | Child service prompt |

Each phase assembles different sections but follows the same pattern: preamble, specs in XML tags, context.

---

## What Press Does vs. What the Model Does

| Responsibility | Press | Model |
|---------------|-------|-------|
| Build system prompts | Yes — loads specs, wraps in XML | No |
| Run the REPL loop | Yes — send, extract, execute, observe | No |
| Resolve input paths to content | Yes — read files on `press()` call | No |
| Load service definitions | Yes — from `services/{name}.md` | No |
| Parse `ensures` output names | Yes — from service definition | No |
| Wire dependencies (Phase 1) | No | Yes — reads Forme spec, decides wiring |
| Execute services (Phase 2) | No | Yes — reads Prose VM spec, calls `press()` |
| Copy files between workspace and bindings | No | Yes — writes code in REPL |
| Evaluate contracts | No | Yes — reads specs, applies judgment |
| Select composition strategy | No | Yes — reads specs, observes state |

Press is the loop. The model is the intelligence.

---

## Drivers and Profiles

Press uses model-specific **drivers** to handle API differences between LLM providers. Drivers normalize:

- Request/response format
- Streaming behavior
- Token counting
- Code block extraction patterns

Drivers are a reliability mechanism, not a core architectural concern. They ensure the REPL loop works consistently regardless of which model is behind it. The Prose and Forme specs — loaded verbatim into the prompt — are the primary source of truth for what the model should do.
