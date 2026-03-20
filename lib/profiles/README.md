---
purpose: Model configuration profiles — YAML-frontmatter markdown files that map model name glob patterns to driver stacks; auto-detected by the eval CLI from the --model flag to load the correct reliability patch set
related:
  - ../README.md
  - ../drivers/README.md
  - ../../eval/README.md
  - ../../src/README.md
---

# lib/profiles

Model configuration profiles for RLM programs.

Each profile uses YAML frontmatter to declare `models` glob patterns and a list of `drivers` to load. The plugin loader (`src/plugins.ts`) matches the runtime model string against all profiles and auto-selects the matching stack.

## Contents

- `gemini-3-flash.md` — Profile for Google Gemini 3 Flash via OpenRouter; maps `*/gemini-3-flash*` patterns to the gemini-3-flash driver stack (5 reliability drivers)
