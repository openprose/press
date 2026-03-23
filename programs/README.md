---
purpose: RLM program definitions for benchmark solving — markdown-encoded agent architectures loaded as --app plugins into the eval harness, covering ARC-AGI-2 compound learning, ARC-AGI-3 interactive games, S-NIAH retrieval, and LLM-as-judge evaluation
related:
  - ../README.md
  - ./arc2-compound/README.md
  - ./arc3/README.md
  - ./could-haiku/
  - ./judge/README.md
  - ./s-niah/README.md
  - ../eval/README.md
  - ../lib/README.md
  - ../arc3-docs/README.md
  - ../../platform/test-harness/README.md
glossary:
  Program: A markdown file or directory defining the system prompt, role guide, and agent architecture for an RLM task — loaded via the --app flag
---

# programs

RLM program definitions used as `--app` plugins in benchmark evaluations.

## Subdirectories

- `arc2-compound/` — Compound learning orchestrator for ARC-AGI-2; runs all tasks in one session with cross-task learning
- `arc3/` — Multi-agent solver for ARC-AGI-3 interactive games
- `could-haiku/` — Documentation quality measurement instrument; spawns scrapers, tiered testers, synthesizer, and reporter
- `judge/` — LLM-as-judge evaluator for scoring RLM outputs
- `s-niah/` — Single Needle in a Haystack solver architecture
