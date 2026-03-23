---
name: summarizer
kind: service
shape:
  self: [summarize text content]
  prohibited: [fetching URLs]
---

requires:
- content: text content to summarize

ensures:
- summary: a 2-3 sentence summary of the content
