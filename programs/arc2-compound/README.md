---
purpose: ARC-AGI-2 compound learning program — a single long-context session that attempts all tasks sequentially, accumulating cross-task pattern knowledge
related:
  - ../README.md
  - ../../eval/README.md
  - ../../arc3-docs/README.md
---

# programs/arc2-compound

RLM program for ARC-AGI-2 compound learning evaluation.

Unlike per-task isolation, this program runs all ARC-AGI-2 tasks in a single RLM session, allowing the model to discover and apply cross-task patterns across the full evaluation set.

## Contents

- `root.md` — Root agent system prompt and task dispatch orchestration
- `orchestrator.md` — Orchestrator role: manages task sequencing, tracks learned patterns, delegates to solver
- `solver.md` — Solver role: implements grid transformation logic for individual tasks
