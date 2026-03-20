---
name: summarizer
kind: service
---

requires:
- word_count: a word count
- char_count: a character count
- line_count: a line count

ensures:
- summary: a formatted summary combining all three counts
