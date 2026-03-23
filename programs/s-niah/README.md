---
purpose: S-NIAH solver program — RLM architecture for Single Needle in a Haystack long-context retrieval tasks
related:
  - ../README.md
  - ../../eval/README.md
---

# programs/s-niah

RLM program for solving S-NIAH (Single Needle in a Haystack) benchmark tasks.

S-NIAH tests the ability to retrieve a specific fact ("needle") embedded within a long document ("haystack") at various context lengths up to the model's maximum context window.

## Contents

- `root.md` — Root agent system prompt; receives the haystack and needle query, returns the extracted answer
- `coordinator.md` — Coordinator role for multi-agent chunking strategies at large context lengths
- `searcher.md` — Searcher role: scans a document chunk for the target needle
