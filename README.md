# Press

The runtime for [Prose](https://github.com/openprose/prose) programs. An LLM in a Node.js REPL loop that can call anything, including itself.

## Overview

Press (`@openprose/press`) puts a language model inside a persistent Node.js sandbox. The model writes JavaScript, observes the output, and loops until it calls `return()`. Any invocation can spawn a child via `await press(query, context?)` — a separate message history and iteration budget sharing the same sandbox. This is not a chatbot with tools bolted on; it is a general-purpose computer that runs programs written in Prose.

Only runtime dependency is `acorn` (JS parser). Models route through OpenRouter by default; other OpenAI-compatible APIs are supported via `--base-url`.

## Structure

- `src/` — Core runtime: REPL loop (`rlm.ts`), sandbox (`environment.ts`), plugin loader (`plugins.ts`), system prompt construction, CLI entry point, and OpenRouter-compatible driver
- `lib/` — Markdown-encoded standard library of reusable patterns: multi-agent composites (observer-actor-arbiter, worker-critic, ratchet, dialectic…), flow controls (pipeline, map-reduce, gate…), single-agent roles (critic, verifier, extractor…), and model-specific driver profiles
- `eval/` — Benchmark harness for OOLONG, ARC-AGI-2, ARC-AGI-3, and S-NIAH; includes scoring, analysis tooling, and 18 numbered run analyses documenting experimental history
- `programs/` — Domain-specific agent architectures loaded as components: ARC-AGI-2 compound learning, ARC-AGI-3 game solver, S-NIAH retrieval, and LLM-as-judge evaluator
- `arc3-docs/` — ARC-AGI-3 platform documentation: REST API reference, agent quickstart, game catalog, and benchmarking methodology
- `arcgentica/` — Reference Python implementation achieving 85.28% on ARC-AGI-2 with Claude Opus 4.6 (nested git repo)
- `test/` — Vitest unit and integration tests
- `docs/` — Trajectory format specs, eval data notes, and ARC-AGI-3 canonical rules

## Getting Started

Requires Node.js ≥ 20.

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

Run a query:

```bash
npx tsx src/cli.ts --query "What is the capital of France?"
```

Run tests (no API key needed):

```bash
npm test
```

End-to-end tests run automatically when `OPENROUTER_API_KEY` is set, and are skipped otherwise.

## CLI

```bash
npx press --query "What is the capital of France?"
npx press --query "Summarize this file" --context-file ./data.txt
npx press --query "Find all TODO comments" --context-dir ./src/
npx press --query "Analyze this data" --model openai/gpt-4o
npx press --query "Hello" --model custom/my-model --base-url http://localhost:11434/v1
```

| Flag                    | Default                                    | Description                                               |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `--query <text>`        | (required)                                 | The question or task                                      |
| `--context-file <path>` | --                                         | Load context from a file                                  |
| `--context-dir <path>`  | --                                         | Load context from a directory (concatenates all files)    |
| `--model <provider/id>` | `openrouter/google/gemini-3-flash-preview` | Model in `provider/model-id` format                       |
| `--base-url <url>`      | --                                         | Custom API base URL (for Ollama, vLLM, etc.)              |
| `--max-iterations <n>`  | 15                                         | Maximum REPL loop iterations (root)                       |
| `--max-depth <n>`       | 3                                          | Maximum recursion depth; agents at maxDepth cannot call `press()` |
| `--model-alias <spec>`  | --                                         | Add or override a named model alias (repeatable)          |

### Model aliases

Three default aliases are always available:

| Alias          | Tags                    | Model              | Description             |
| -------------- | ----------------------- | ------------------ | ----------------------- |
| `fast`         | fast, cheap             | Gemini 3 Flash     | Fast and cheap          |
| `orchestrator` | orchestrator, medium    | Claude Sonnet 4.5  | Balanced orchestration  |
| `intelligent`  | intelligent, expensive  | Claude Opus 4.6    | Highest capability      |

Use `--model-alias` to add new aliases or override the defaults. Format: `alias=provider/model[:tag1,tag2,...]`. The agent sees an "Available Models" table in its system prompt and can delegate with `await press("subtask", data, { model: "fast" })`.

### Providers

The CLI routes models by the first path segment:

- `openrouter/*` — OpenRouter API (`OPENROUTER_API_KEY`)
- `openai/*` — OpenAI API (`OPENAI_API_KEY`)
- `custom/*` — requires `--base-url` and the relevant env var

## Programmatic API

```typescript
import { press, DEFAULT_MODEL_ALIASES } from "@openprose/press";
import { fromProviderModel } from "@openprose/press/drivers/openrouter-compatible";

const callLLM = fromProviderModel("openrouter/google/gemini-3-flash-preview");
const result = await press("What is 2 + 2?", undefined, {
  callLLM,
  maxIterations: 15,
  maxDepth: 3,
});

console.log(result.answer);     // "4"
console.log(result.iterations); // number of REPL turns used
```

### `press(query, context?, options)`

Returns `RlmResult`: `{ answer, iterations }`.

Throws `RlmMaxIterationsError` if the iteration budget is exhausted.

### Options

| Option          | Type      | Default    | Description                                                  |
| --------------- | --------- | ---------- | ------------------------------------------------------------ |
| `callLLM`       | `CallLLM` | (required) | `(messages, systemPrompt) => Promise<string>`                |
| `maxIterations` | `number`  | 15         | REPL loop budget for the root agent                          |
| `maxDepth`      | `number`  | 3          | Recursion depth limit                                        |
| `pluginBodies`  | `string`  | --         | Extra prompt text appended to the root agent's system prompt |
| `models`        | `Record<string, ModelEntry>` | -- | Named model aliases for child delegation |
| `globalDocs`    | `string`  | --         | Documentation appended to every agent's system prompt at every depth |

### Sandbox globals

| Symbol                                          | Description                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `context`                                       | Task data (reads `__ctx.local.context`, falling back to `__ctx.shared.data`).                                           |
| `console.log()`                                 | Output visible to the model between iterations.                                                                         |
| `return(value)`                                 | Ends the loop and sets the final answer. First-iteration returns are intercepted for verification.                      |
| `await press(query, context?, { systemPrompt?, model?, maxIterations? })` | Spawn a child agent. Shared sandbox, own message history. Must be awaited. |
| `__rlm`                                         | Read-only delegation context: `depth`, `maxDepth`, `iteration`, `maxIterations`, `lineage`, `invocationId`, `parentId`. |
| `__ctx.shared.data`                             | Root context (frozen, readable by all depths).                                                                          |
| `__ctx.local`                                   | This invocation's writable workspace.                                                                                   |
| `__ctx.readLocal(id)`                           | Read-only view of another invocation's local store.                                                                     |
| `require()`                                     | Node.js built-in modules only.                                                                                          |

## Plugins

Plugins are markdown files concatenated into the agent's system prompt. Two kinds:

- **Drivers** (`lib/drivers/`) — Model-specific reliability patches (e.g., enforce await discipline, verify-before-return). Stack multiple per run.
- **Profiles** (`lib/profiles/`) — Named bundles of drivers for a model family. Auto-detected from `--model` when no `--profile` is given.

```typescript
import { loadStack } from "@openprose/press/plugins";
const pluginBodies = await loadStack({
  model: "openrouter/google/gemini-3-flash-preview", // auto-detects profile
});
```

## Benchmarks

### OOLONG (long-context aggregation, 50 tasks)

| Run | Model | Score | Notes |
|-----|-------|-------|-------|
| 1 | Gemini 3 Flash | 5.1% | Baseline, no plugins |
| 2 | Gemini 3 Flash | 20.0% | First plugin suite |
| 3 | Gemini 3 Flash | 50.7% | maxDepth=1, prompt rewrite |
| 4 | Gemini 3 Flash | 58.0% | Scorer fixes, penultimate warning |
| 6 | Gemini 3 Flash | 58.4% | Per-delegation systemPrompt arch |

Key findings: `maxDepth=1` outperforms deeper delegation on aggregation tasks (deeper recursion loses context and wastes tokens). Plugin suites provide large initial gains with diminishing returns beyond ~6 drivers.

### Running evals

```bash
# S-NIAH (synthetic, no download needed)
npx tsx eval/run.ts --benchmark s-niah --model anthropic/claude-sonnet-4-20250514 --max-tasks 5

# OOLONG (requires one-time dataset download)
npx tsx eval/download.ts
npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-sonnet-4-20250514 --max-tasks 5

# ARC-AGI-2
npx tsx eval/download.ts --dataset arc
npx tsx eval/run.ts --benchmark arc --model anthropic/claude-opus-4-6 \
  --max-iterations 25 --max-depth 2 --concurrency 10

# ARC-AGI-3 (API-based, set ARC3_API_KEY)
npx tsx eval/run.ts --benchmark arc3 --model anthropic/claude-opus-4-6 \
  --game ls20 --max-iterations 25 --max-depth 2
```

See [eval/README.md](eval/README.md) for the full set of options, plugin configuration, and result analysis.

## See Also

- [Prose](https://github.com/openprose/prose) — The programming language Press executes
- [arcgentica](arcgentica/) — Python reference implementation; 85.28% on ARC-AGI-2 with Claude Opus 4.6
- [arc3-docs](arc3-docs/) — ARC-AGI-3 platform documentation and API reference
- [TENETS.md](TENETS.md) — Design principles
- [OBSERVABILITY.md](OBSERVABILITY.md) — Structured event model for tracing runs

## License

MIT
