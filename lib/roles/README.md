---
purpose: Single-agent role guides — behavioral specifications for discrete cognitive functions an RLM instance can perform within a composite or program
related:
  - ../README.md
  - ../composites/README.md
  - ../../programs/README.md
glossary:
  Role: A named behavioral specification for a single RLM agent instance describing its purpose, inputs, outputs, and behavioral constraints
---

# lib/roles

Single-agent role guides for use in RLM programs and composites.

## Contents

- `classifier.md` — Classifies inputs into a fixed set of categories; returns structured label
- `critic.md` — Evaluates a proposed solution against criteria; returns scored feedback
- `extractor.md` — Extracts structured data from unstructured text; returns JSON
- `summarizer.md` — Condenses long content into a concise representation
- `verifier.md` — Checks a solution for correctness against known constraints or test cases
