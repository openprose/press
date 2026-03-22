# Press

Press executes programs written in Markdown. You define services with input/output contracts, and an LLM wires and runs them -- reading the contracts, building a dependency graph, and spawning child loops to execute each service. Programs get better automatically as models improve, because they declare *what* to produce, not *how* to produce it.

Press is an RLM (Recursive Language Model) -- a system where an LLM operates in a persistent REPL loop, writing and executing code until it completes a task. The model can recursively invoke itself via `press()` for subtasks.

```bash
npm install -g @openprose/press
```

## What Press Can Do: could-haiku

[could-haiku](https://github.com/openprose/programs/tree/main/could-haiku) is a documentation quality measurement instrument. It spawns 4 service types across 14 instances:

1. **scraper** -- fetches and parses the documentation site
2. **tester** (x9, parallel) -- 3 agents at each of 3 capability tiers (haiku, sonnet, opus) independently attempt to understand and use the tool from its docs alone
3. **synthesizer** -- cross-references results across tiers to identify clarity, complexity, and ambiguity patterns
4. **reporter** -- produces a diagnostic with per-section scores and recommendations

The program runs 9 testers in parallel, fans results into a synthesizer, and produces a structured report. Total execution: ~9 minutes, ~2M tokens. No glue code -- just Markdown files with contracts.

## The Simplest Possible Program

Here is the mechanics. A two-service program that uppercases text and reports on it:

**index.md**
```markdown
---
name: trivial-pipeline
kind: program
services: [uppercaser, reporter]
---

requires:
- text: a piece of text to process

ensures:
- report: a summary showing the uppercased text and its character count
```

**uppercaser.md**
```markdown
---
name: uppercaser
kind: service
---

requires:
- text: a piece of text

ensures:
- uppercased: the text converted to all uppercase
```

**reporter.md**
```markdown
---
name: reporter
kind: service
---

requires:
- uppercased: uppercased text to report on

ensures:
- report: a summary showing the uppercased text and its character count
```

Run it:

```bash
press run ./my-program/index.md --text "hello world"
```

Press reads the contracts, wires `uppercaser.ensures.uppercased` to `reporter.requires.uppercased`, spawns each service as an LLM session, and returns the report. No glue code. The model satisfies the contracts.

Prose programs default to declarative contracts -- the model decides how to satisfy them. Authors who need more control can specify explicit wiring (Level 2) or step-by-step execution blocks (Level 3) for determinism.

## What Press Is For

Press is designed for complex, multi-agent analytical and generative tasks where the overhead of the two-phase pipeline is amortized across many services.

**Good fit:**
- Documentation analysis with multiple independent evaluators (could-haiku)
- Research pipelines with scraping, analysis, and synthesis stages
- Content generation with iterative refinement (worker-critic loops)
- Any task where you'd otherwise write 200+ lines of LLM orchestration code

**Not a good fit:**
- Simple, single-step LLM calls (use your model's API directly)
- Tasks requiring sub-second latency
- Deterministic pipelines where the output must be identical every run (though explicit execution blocks give you more control)

**Typical costs:**
- Simple 2-service program: ~50K tokens, ~60 seconds
- Medium 4-service program: ~100K tokens, ~2 minutes
- Complex 14-service program (could-haiku): ~2M tokens, ~9 minutes

## How Is This Different?

Most agent frameworks orchestrate LLM calls -- you write code that chains prompts together. Press gives the LLM a sandbox and lets it write programs. The model reads your contracts, decides how to satisfy them, and writes JavaScript to do so.

The key difference: **Press programs improve when you swap in a smarter model, without changing any code.** A more capable model satisfies the same contracts more efficiently. Your programs are assets that appreciate with model capability.

Press also has no tool-calling, no function schemas, no API wrappers. The model's only tool is a JavaScript sandbox with `press()` for recursion and `RETURN()` for completion. One runtime dependency (`acorn`).

## How It Works

Press runs Prose programs in two phases:

1. **Forme (wiring)** -- The LLM reads the program's contracts, builds a dependency graph, and writes a `manifest.md`. This is the Forme container phase: auto-wiring `requires` against `ensures`.

2. **Prose VM (execution)** -- The LLM reads the manifest and walks the execution order. For each service, it calls `press("serviceName", { inputs, workspace })`, which spawns a child REPL loop with the service definition and resolved inputs.

Key design decisions:

- **The model IS the CPU.** Press builds system prompts and runs the sandbox. The LLM reads specs and writes code. Press is the computer; the model is the intelligence.
- **Services communicate via filesystem.** Each service gets a workspace directory. Outputs are written to files, then copied to the parent's bindings. State is managed on disk, not in memory.
- **`press()` for delegation, `RETURN()` to complete.** Two primitives. `press("researcher", { inputs })` spawns a child session. `RETURN(value)` ends the current loop. `console.log()` observes. `context` holds input data.
- **Pass by reference, resolve on entry.** The VM passes file paths to children. Press resolves them to content when building the child's system prompt. Children see values, not paths.

## What Press Does vs What the Model Does

| Action | Who |
|---|---|
| Build system prompt for each phase (load specs, wrap in XML) | Press |
| Run the REPL loop (call LLM, extract code, execute, observe) | Press |
| Resolve input paths to content for child press() calls | Press |
| Execute code blocks in sandbox | Press |
| **Everything below: the model** | |
| Read service files, parse contracts, wire dependencies | Model |
| Write manifest with dependency graph | Model |
| Create directory structure, manage state.md | Model |
| Decide when to call press() and with what arguments | Model |
| Decide when to use Promise.all for parallelism | Model |
| Copy files from workspace to bindings | Model |
| Evaluate contract satisfaction, handle errors | Model |

## Eval Results

| Program | Model | Status | Time | Tokens |
|---|---|---|---|---|
| trivial-pipeline | Sonnet 4.6 | PASS | 64s | 50K |
| parallel-analysis | Sonnet 4.6 | PASS | 65s | 58K |
| haiku-refiner | Sonnet 4.6 | PASS | 157s | 89K |
| bilingual-haiku | Sonnet 4.6 | PASS | 196s | 97K |
| error-handling | Sonnet 4.6 | PASS | 101s | 68K |
| could-haiku | Sonnet 4.6 | PASS | 544s | ~2M |

## Quick Start (Use Press)

Requires Node.js >= 20.

```bash
npm install -g @openprose/press
export OPENROUTER_API_KEY="your-key"
press run your-program/index.md --text "hello world"
```

## Development (Contribute to Press)

```bash
git clone https://github.com/openprose/press.git
cd press
npm install
```

Copy the example env file and add your API key:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY
```

Run tests (no API key needed):

```bash
npm test
```

## Programmatic API

```typescript
import { pressRun } from "@openprose/press";

const result = await pressRun({
  callLLM,
  specDir: "./prose-specs",
  programPath: "./my-program/index.md",
  programDir: "./my-program",
  callerInputs: { text: "hello world" },
});

console.log(result.answer);
console.log(result.phaseResults.forme.iterations); // Forme iterations used
console.log(result.phaseResults.vm.iterations);     // VM iterations used
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `callLLM` | `CallLLM` | (required) | `(messages, systemPrompt) => Promise<string>` |
| `specDir` | `string` | (required) | Directory containing `prose.md`, `forme.md`, etc. |
| `programPath` | `string` | (required) | Path to the program entry point (`.md` file) |
| `programDir` | `string` | (required) | Directory containing the program and service files |
| `callerInputs` | `Record<string, string>` | (required) | User inputs matching the program's `requires` |
| `maxIterations` | `number` | 15 | Iteration budget per phase |
| `maxDepth` | `number` | 3 | Delegation depth limit |

## Eval Pipeline

Run the eval suite:

```bash
npx tsx src/eval-pipeline.ts
```

This runs all programs in the default spec against Sonnet 4.6, tracks tokens and timing, and writes results to `eval-results/`. Use `--concurrency` to control parallelism, `--spec-file` for custom specs.

## Architecture: Relationship to OpenProse

Think of it like the Java ecosystem: **Prose** is the language, **Forme** is Spring (the wiring framework), **Press** is the JVM (the computer that runs it).

- **Press** is the runtime (this repo). MIT licensed.
- **Prose** is the programming language. Programs are Markdown files with contracts.
- **Forme** is the wiring framework. It reads contracts and produces a manifest.
- The language and specs live at [github.com/openprose/prose](https://github.com/openprose/prose).

## See Also

- [LANGUAGE.md](LANGUAGE.md) -- Press runtime documentation
- [CONTAINER.md](CONTAINER.md) -- Container and execution model
- [TENETS.md](TENETS.md) -- Design principles
- [Prose](https://github.com/openprose/prose) -- The programming language Press executes

## License

MIT
