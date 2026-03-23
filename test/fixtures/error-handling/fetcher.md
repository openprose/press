---
name: fetcher
kind: service
shape:
  self: [fetch URL content, extract text]
  prohibited: [summarizing content — that is the summarizer's job]
---

requires:
- url: a URL to fetch

ensures:
- content: the text content of the page

errors:
- unreachable: the URL could not be fetched or returned a non-200 status
