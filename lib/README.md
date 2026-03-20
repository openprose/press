---
purpose: Reusable RLM composition patterns, control flows, role guides, and model driver profiles — a markdown-encoded standard library of building blocks for constructing multi-agent RLM programs
related:
  - ../README.md
  - ./composites/README.md
  - ./controls/README.md
  - ./drivers/README.md
  - ./profiles/README.md
  - ./roles/README.md
  - ../programs/README.md
  - ../src/README.md
  - ../../planning/guidance/rlms.md
glossary:
  Composite: A named multi-agent topology (e.g. observer-actor-arbiter) describing how multiple RLM instances collaborate
  Control: A flow control pattern (e.g. pipeline, map-reduce) describing how work is sequenced or distributed
  Role: A single-agent behavioral guide (e.g. critic, verifier) describing a specific cognitive function
  Profile: A configuration preset for a specific model, tuning temperature, context window, and behavior quirks
  Driver: A model-specific reliability patch injected as a plugin to compensate for model behavioral quirks
---

# lib

Library of reusable RLM patterns organized by abstraction level. All entries are markdown files loaded as `pluginBodies` into the RLM system prompt via the plugin loader (`src/plugins.ts`).

## Subdirectories

- `composites/` — Multi-agent topologies: 7 named patterns for how multiple RLM instances collaborate (OAA, ensemble-synthesizer, worker-critic, ratchet, witness, dialectic, proposer-adversary)
- `controls/` — Flow control patterns: 5 patterns for sequencing and distributing work (pipeline, map-reduce, gate, progressive-refinement, retry-with-learning)
- `drivers/` — Model-specific driver guides and behavioral integration notes (currently: gemini-3-flash)
- `profiles/` — Model configuration profiles mapping model name patterns to driver stacks; auto-detected by the CLI from `--model`
- `roles/` — Single-agent role guides: 5 discrete cognitive functions (classifier, critic, extractor, summarizer, verifier)

## How lib relates to programs

`lib/` contains generic, reusable patterns. `programs/` contains domain-specific compositions that assemble lib patterns into complete benchmark-solving architectures. Programs reference lib composites and roles in their agent system prompts.
