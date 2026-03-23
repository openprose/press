---
purpose: Model-specific reliability drivers and behavioral guides — 22 markdown-encoded patches injected as plugins to compensate for model quirks, enforce discipline, and guide solving strategies
related:
  - ../README.md
  - ../profiles/README.md
  - ../../src/drivers/README.md
---

# lib/drivers

Reliability drivers and behavioral guides injected as plugins into RLM sessions. Each driver is a markdown file loaded into the system prompt to patch model behavior.

## Contents

- `algorithmic-analysis.md` — Algorithmic analysis driver for structured problem decomposition
- `arc-helper-library.md` — ARC-specific helper library injection for grid manipulation primitives
- `arc-solve-process.md` — Step-by-step ARC solving process guide
- `await-discipline.md` — Enforces await on all async calls to prevent silent failures
- `context-discipline.md` — Context window management and token budget awareness
- `deadline-return.md` — Forces early RETURN when approaching iteration limits
- `exploration-budget.md` — Allocates iteration budget between exploration and exploitation
- `gemini-3-flash.md` — Behavioral notes, quirks, and recommended settings for Gemini 3 Flash via OpenRouter
- `hypothesis-budget.md` — Limits hypothesis generation to prevent unbounded exploration
- `json-stringify-return.md` — Enforces JSON.stringify on RETURN values for structured output
- `no-arc-delegation.md` — Prevents recursive delegation on ARC tasks (solves locally)
- `output-sanity-check.md` — Post-solution validation before returning
- `overlap-testing.md` — Tests for overlapping patterns in multi-part solutions
- `parallel-decomposition.md` — Guides parallel decomposition of independent subtasks
- `question-first.md` — Enforces reading and understanding the question before solving
- `repl-discipline.md` — REPL usage patterns and anti-patterns
- `return-format-discipline.md` — Enforces consistent return value formatting
- `shared-context-delegation.md` — Context sharing protocol for parent-child delegation
- `targeted-recursion.md` — Guides when and how to use recursive press() calls
- `test-input-inspection.md` — Enforces inspection of test inputs before solving
- `verify-all-examples.md` — Requires verification against all provided examples
- `verify-before-return.md` — Mandatory verification step before RETURN
