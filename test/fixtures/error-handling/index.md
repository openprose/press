---
name: resilient-lookup
kind: program
services: [fetcher, summarizer]
---

# Resilient Lookup

Fetch content from a URL and summarize it. If the URL is unreachable,
produce an error report instead of failing entirely.

requires:
- url: a URL to fetch content from

ensures:
- summary: a concise summary of the content at the URL
- if url is unreachable: error_report explaining what went wrong, including the URL that failed and a suggestion to check the URL or try again later

errors:
- unreachable: the URL could not be fetched

### Execution

let content = call fetcher
  url: url

let summary = call summarizer
  content: content

return summary
