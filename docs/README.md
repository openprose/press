---
purpose: Internal RLM documentation — trajectory formats, evaluation data conventions, ARC-AGI-3 canonical scoring rules, and observability protocols; reference material for eval harness developers and analysts
related:
  - ../README.md
  - ../eval/README.md
  - ../arc3-docs/README.md
  - ../src/README.md
glossary:
  Trajectory: A structured record of one RLM session — all turns, code blocks, tool calls, results, and metadata
---

# docs

Internal documentation for the node-rlm project.

## Contents

- `TRAJECTORY_FORMAT.md` — Schema for RLM trajectory JSON files (general benchmarks)
- `TRAJECTORY_FORMAT_ARC3.md` — Trajectory schema extended for ARC-AGI-3 interactive game sessions
- `EVAL_DATA.md` — Conventions for benchmark data organization, naming, and storage in `eval/data/`
- `ARC3_CANONICAL_RULES.md` — Authoritative rules for ARC-AGI-3 game evaluation and scoring
- `TRIGGERING_EVALS.md` — How to trigger and monitor eval runs from the CLI and CI
