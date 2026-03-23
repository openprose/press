---
name: writer
kind: service
shape:
  self: [compose haiku, incorporate feedback]
  prohibited: [evaluating syllable count — that is the critic's job]
---

requires:
- topic: the subject for the haiku
- feedback: (optional) critic's feedback on a previous draft
- previous_draft: (optional) the draft that was rejected

ensures:
- draft: a haiku (three lines, aiming for 5-7-5 syllable structure)

strategies:
- when feedback provided: address each specific point the critic raised
- when no feedback: write a fresh haiku inspired by the topic
