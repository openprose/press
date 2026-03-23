---
purpose: Core Press runtime implementation — CLI entry point, REPL loop, plugin system, observability, model drivers, and system prompt construction; the executable heart of Press
related:
  - ../README.md
  - ./drivers/README.md
  - ../lib/README.md
  - ../test/README.md
  - ../eval/README.md
glossary:
  RLM: Recursive Language Model — an LLM running inside a Node.js REPL loop with recursive self-invocation capability
  REPL: Read-Eval-Print Loop — the sandboxed JavaScript execution environment the LLM writes code into
  Plugin: A JavaScript module injected into the RLM sandbox that extends available tools (e.g., recursion, file I/O)
  CallLLM: The function signature (messages, systemPrompt) => Promise<string> that all model drivers must implement
---

# src

Core implementation of the Press runtime.

## Contents

- `cli.ts` — Command-line entry point; parses flags and launches the RLM
- `rlm.ts` — Main REPL loop orchestrator; drives model turns, executes JS, handles depth/iteration limits
- `environment.ts` — Sandbox environment setup; installs plugins and acorn into the REPL context
- `plugins.ts` — Plugin registry and loader; each plugin extends the RLM's available tools
- `system-prompt.ts` — System prompt construction; assembles per-delegation prompts from role, plugins, and context
- `press-boot.ts` — Press boot sequence; initializes the Forme container and loads program specs
- `press-prompt.ts` — Press prompt construction; builds system prompts for Forme and VM phases
- `press-resolver.ts` — Press dependency resolver; wires service requires/ensures into a manifest
- `events.ts` — Event emission types for observability (turn start/end, tool calls, delegation)
- `eval-pipeline.ts` — Eval pipeline runner; executes Press programs against models and collects results
- `observer.ts` — Runtime observer; collects structured trajectory data for analysis
- `models.ts` — Model provider abstraction; wraps OpenRouter API calls
- `utils.ts` — Shared utility functions
- `index.ts` — Public exports for the src package
- `drivers/` — Low-level model driver implementations (OpenRouter-compatible adapter)
