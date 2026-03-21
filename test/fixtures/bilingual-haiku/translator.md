---
name: translator
kind: service
shape:
  self: [translate text between languages preserving poetic structure]
  prohibited: [composing original content, evaluating translation quality]
---

requires:
- text: the text to translate
- source_language: the language of the input text
- target_language: the language to translate into

ensures:
- translation: the text translated into the target language, preserving line breaks and poetic structure where possible
