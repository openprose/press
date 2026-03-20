---
purpose: Eval-specific LLM call drivers — adapters that connect the eval harness to model provider APIs
related:
  - ../README.md
  - ../../src/drivers/README.md
  - ../../lib/drivers/README.md
---

# eval/drivers

Model API drivers used by the eval harness to make LLM calls.

## Contents

- `openrouter.ts` — OpenRouter `CallLLM` driver; routes all model calls through the OpenRouter API using `OPENROUTER_API_KEY`
