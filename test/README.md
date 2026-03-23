---
purpose: Vitest test suite for the Press runtime — unit tests for REPL loop, observer, system prompt, plugins, environment, end-to-end execution, Press program evaluation, and token tracking
related:
  - ../README.md
  - ../src/README.md
---

# test

Vitest test suite for the Press runtime. Run with `npx vitest` or `npx vitest run`.

## Contents

- `rlm.test.ts` — Core REPL loop tests: iteration limits, depth limits, return behavior, error handling
- `observer.test.ts` — Observer tests: trajectory recording, event emission, structured output
- `system-prompt.test.ts` — System prompt construction tests: plugin injection, role composition
- `plugins.test.ts` — Plugin registry tests: loading, sandboxing, API surface
- `environment.test.ts` — Sandbox environment tests: acorn integration, REPL context setup
- `e2e.test.ts` — End-to-end tests: full RLM sessions against mock model responses
- `eval-openrouter-routing.test.ts` — OpenRouter driver routing and model alias resolution tests
- `eval-bilingual.test.ts` — Bilingual haiku program evaluation tests
- `eval-could-haiku.test.ts` — could-haiku program evaluation tests
- `eval-error-handling.test.ts` — Error handling program evaluation tests
- `eval-forme-wiring.test.ts` — Forme wiring phase evaluation tests
- `eval-full-pipeline.test.ts` — Full pipeline (forme + VM) evaluation tests
- `eval-parallel.test.ts` — Parallel program execution evaluation tests
- `eval-press-smoke.test.ts` — Press runtime smoke tests
- `eval-worker-critic.test.ts` — Worker-critic composite evaluation tests
- `press-prompt.test.ts` — Press prompt construction and template tests
- `press-resolver.test.ts` — Press resolver dependency wiring tests
- `token-tracking.test.ts` — Token usage tracking and reporting tests
- `fixtures/` — Test fixture programs (bilingual-haiku, error-handling, parallel-program, trivial-program, worker-critic)
