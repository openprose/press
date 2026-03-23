---
purpose: LLM-as-judge evaluation program — scores RLM outputs against rubrics for qualitative benchmark assessment
related:
  - ../README.md
  - ../../eval/README.md
---

# programs/judge

RLM program implementing LLM-as-judge evaluation.

Used to assess RLM trajectories and outputs on benchmarks where exact-match scoring is insufficient — applying a rubric-based evaluation via a separate RLM judge session.

## Contents

- `root.md` — Judge agent system prompt; scores a given trajectory or answer against evaluation criteria
- `evaluator.md` — Evaluator role: applies the scoring rubric and returns structured judgment
