---
purpose: Dataset loader modules for each benchmark — parse raw data files or generate synthetic tasks for the eval harness
related:
  - ../README.md
  - ../data/README.md
---

# eval/datasets

Dataset loader and generator modules consumed by the eval harness (`harness.ts`).

## Contents

- `s-niah.ts` — Synthetic S-NIAH task generator; creates needle-in-haystack tasks at configurable context lengths
- `oolong.ts` — OOLONG dataset loader; reads trec_coarse tasks from `eval/data/oolong/`
- `arc.ts` — ARC-AGI-2 dataset loader; reads evaluation tasks from `eval/data/arc/`
- `arc3.ts` — ARC-AGI-3 task loader; fetches available games via the ARC-AGI-3 REST API
