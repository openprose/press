---
name: parallel-analysis
kind: program
services: [word-counter, char-counter, line-counter, summarizer]
---

requires:
- text: a piece of text to analyze

ensures:
- summary: a combined analysis showing word count, character count, and line count
