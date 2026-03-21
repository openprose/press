---
name: composer
kind: service
shape:
  self: [compose haiku following 5-7-5 syllable structure]
  prohibited: [translation]
---

requires:
- topic: the subject for the haiku

ensures:
- haiku: a haiku (three lines, 5-7-5 syllable structure) about the given topic
