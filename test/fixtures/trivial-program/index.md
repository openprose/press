---
name: trivial-pipeline
kind: program
services: [uppercaser, reporter]
---

requires:
- text: a piece of text to process

ensures:
- report: a summary showing the uppercased text and its character count
