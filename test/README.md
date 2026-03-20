---
purpose: Vitest test suite for the RLM core runtime — unit tests for REPL loop, observer, system prompt, plugins, environment, and end-to-end execution
related:
  - ../README.md
  - ../src/README.md
---

# test

Vitest test suite for the node-rlm runtime. Run with `npx vitest` or `npx vitest run`.

## Contents

- `rlm.test.ts` — Core REPL loop tests: iteration limits, depth limits, return behavior, error handling
- `observer.test.ts` — Observer tests: trajectory recording, event emission, structured output
- `system-prompt.test.ts` — System prompt construction tests: plugin injection, role composition
- `plugins.test.ts` — Plugin registry tests: loading, sandboxing, API surface
- `environment.test.ts` — Sandbox environment tests: acorn integration, REPL context setup
- `e2e.test.ts` — End-to-end tests: full RLM sessions against mock model responses
- `eval-openrouter-routing.test.ts` — OpenRouter driver routing and model alias resolution tests
