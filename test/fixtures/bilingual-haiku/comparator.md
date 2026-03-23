---
name: comparator
kind: service
shape:
  self: [compare original and back-translated text, assess meaning drift]
  prohibited: [rewriting or improving any of the texts]
---

requires:
- original: the original English haiku
- translated: the haiku in the target language
- back_translated: the haiku translated back to English
- language: what language was used

ensures:
- report: a formatted comparison showing all three versions side-by-side, with an assessment of:
    - meaning preservation (what was kept)
    - meaning drift (what changed or was lost)
    - structural preservation (did the 5-7-5 structure survive translation?)
    - a drift score from 0 (identical) to 10 (completely different meaning)
