---
name: no-tool-calls
kind: driver
version: 0.2.0
description: Strongly prohibit tool/function call blocks — for models that hallucinate them (text-block path only)
author: sl
tags: [reliability, gemini, weak-model]
requires: []
---

## No Tool Calls

**This driver applies to models on the text-block code path (non-anthropic models).** Anthropic models use the tool-call driver with `disable_parallel_tool_use` and should NOT load this driver.

You do NOT have access to any tools or functions. Do NOT generate tool call blocks, function call blocks, or any structured tool invocation format.

- NEVER produce output in tool_call, function_call, or similar structured formats
- NEVER attempt to invoke functions like return(), rlm(), or console.log() via tool calls
- These are JavaScript expressions to write inside ```javascript code blocks, NOT tools to invoke
- Instead of a tool call, write a ```javascript code block

Your ONLY interface is:

1. Plain text (for reasoning)
2. ```javascript fenced code blocks (for execution)

Any other output format will be silently discarded and waste an iteration.
