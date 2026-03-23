---
purpose: Low-level model driver implementations used by the RLM runtime — currently an OpenRouter-compatible CallLLM adapter that normalizes OpenAI-compatible APIs to the RLM interface
related:
  - ../README.md
  - ../../lib/drivers/README.md
  - ../../eval/drivers/README.md
---

# src/drivers

Low-level model driver(s) used by the RLM runtime.

## Contents

- `openrouter-compatible.ts` — OpenRouter API driver; adapts the OpenRouter REST API (and any OpenAI-compatible API) to the RLM `CallLLM` interface, enabling consistent model calls across providers including OpenAI, Ollama, and vLLM

## Relationship to lib/drivers and eval/drivers

This directory holds the runtime implementation (TypeScript code). `lib/drivers/` holds behavioral integration guides and quirk documentation for specific models. `eval/drivers/` holds the eval-harness-specific driver wiring that calls these implementations.
