---
name: bilingual-haiku
kind: program
services: [composer, translator, comparator]
---

# Bilingual Haiku

Compose a haiku in English, translate it to another language, translate it back,
and assess how much meaning was preserved through the round-trip.

requires:
- topic: the subject for the haiku
- language: target language for translation (e.g., "Japanese", "French", "Spanish")

ensures:
- report: a comparison showing the original haiku, the translation, the back-translation, and an assessment of meaning drift

### Execution

let haiku = call composer
  topic: topic

let translated = call translator
  text: haiku
  source_language: "English"
  target_language: language

let back_translated = call translator
  text: translated
  source_language: language
  target_language: "English"

let report = call comparator
  original: haiku
  translated: translated
  back_translated: back_translated
  language: language

return report
