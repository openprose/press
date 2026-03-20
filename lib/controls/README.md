---
purpose: Flow control patterns for RLM programs — 5 patterns describing how work is sequenced, distributed, gated, or retried across single or multiple agents; complements composites (topology) with execution flow
related:
  - ../README.md
  - ../composites/README.md
  - ../roles/README.md
  - ../../programs/README.md
---

# lib/controls

Flow control patterns used to structure RLM program execution.

## Contents

- `pipeline.md` — Sequential stage pipeline: output of each stage feeds the next
- `map-reduce.md` — Parallel fan-out across inputs followed by aggregation
- `gate.md` — Conditional branching: proceed only if a quality or validity threshold is met
- `progressive-refinement.md` — Iterative solution improvement with expanding scope each round
- `retry-with-learning.md` — Retry loop that accumulates failure context to guide subsequent attempts
