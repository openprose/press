---
name: critic
kind: service
shape:
  self: [count syllables, evaluate thematic coherence, decide accept/reject]
  prohibited: [rewriting the haiku — only evaluate and provide feedback]
---

requires:
- draft: a haiku to evaluate
- attempt: which attempt number this is

ensures:
- accepted: boolean — does this haiku pass review?
- feedback: (if rejected) specific, actionable feedback on what to fix
- syllable_count: the syllable count for each line (e.g., [5, 7, 5])
- quality_notes: brief notes on thematic quality

strategies:
- when attempt >= 3: be more lenient — accept if syllable count is close (±1) and theme is coherent
- when attempt == 1: be strict — require exact 5-7-5 and strong thematic connection
