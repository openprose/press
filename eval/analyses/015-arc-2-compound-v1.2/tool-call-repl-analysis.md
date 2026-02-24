# Tool-Call REPL Analysis: Should node-rlm Switch from Markdown Code Blocks to Tool Calls?

**Date:** 2026-02-18
**Author:** Architecture review (Claude Opus 4.6)
**Branch:** `feat/arc3-benchmark`
**Status:** Recommendation

---

## Executive Summary

**Recommendation: Yes, switch to tool calls.** The multi-block execution problem is a structural deficiency that cannot be fixed at the prompt level (4% compliance across two driver versions). Tool calls with `disable_parallel_tool_use: true` solve it mechanically. The change preserves the RLM's core identity ("while loop + model + sandbox"), requires roughly 80 lines of engine changes, and the key tenet violation is cosmetic, not substantive. However, this requires switching from the Chat Completions API to either the Anthropic Messages API or the Responses API, which is a bigger decision than the tool call change itself.

---

## 1. Why Does Multi-Block Execution Happen?

The multi-block problem has four reinforcing causes, not one:

### 1a. Training data patterns

Models are trained on markdown documentation, tutorials, and blog posts. These routinely contain sequences like "First, set up the data: ```js ... ``` Now, process it: ```js ... ``` Finally, verify: ```js ... ```". The model has seen millions of examples of multi-block-as-narrative. When it produces a response, it is completing a *document*, not issuing a *command*. This is the deepest cause: the code block is a **literary device** in the model's world, not an **action primitive**.

### 1b. The model completing a "thought"

A model's natural unit of work is the full reasoning arc: analyze, plan, execute, verify. When it writes code block 1 (execute), it already "knows" what it expects to see, so it writes code block 2 (verify) in the same breath. The model treats all blocks in a response as a single coherent thought -- it does not model the temporal gap between execution and observation because, from its perspective, there is no gap. It is generating tokens left-to-right, and the "output" it imagines between blocks is simply more tokens in the same sequence.

### 1c. The system prompt reinforces the pattern, despite trying not to

The system prompt at line 34 of `system-prompt.ts` says: "Write one ```javascript fenced block per response." The rules section at line 97 repeats: "One ```javascript block per response. Stop and wait for output." But the environment section itself contains multi-block examples: `repl-discipline.md` shows multiple code blocks in a single markdown document. More critically, the `<rlm-preamble>` describes the model as "a general-purpose computer" -- this framing invites the model to think in programs (which have multiple statements), not commands (which are atomic). The `one-block-per-iteration.md` driver plugin tries harder with fear-based framing ("extra blocks are DISCARDED"), but at v0.2.0 it still only achieves partial compliance because it is fighting the model's generative priors.

### 1d. Code blocks feel "lightweight"

This is the most subtle cause. A fenced code block is visually lightweight in the model's token stream -- it is just a fence delimiter, some code, and another fence delimiter. There is no structural signal that says "I am now committing an action that requires a response." Tool calls, by contrast, have a distinct structural form: a `tool_use` block with an `id`, a `name`, and an `input` object. This structural heaviness is a *feature*. It signals to the model (at the token level, not the semantic level) that it is making a discrete action. The model's training data associates tool calls with "one action, then wait for result." It associates code blocks with "part of a document."

### Why prompt-level fixes fail

The `one-block-per-iteration.md` driver and the `maxBlocksPerIteration` option (line 361 of `rlm.ts`) are both workarounds that fight the generative prior. Even with `maxBlocksPerIteration: 1`, the model still *writes* multiple blocks -- the engine just discards them. The model has already wasted tokens generating code that will never run, and its internal state includes assumptions about what those discarded blocks would have produced. The `stopAfterFirstBlock` streaming feature (line 80-135 of `openrouter-compatible.ts`) is cleverer -- it aborts the HTTP stream when a second fence is detected -- but this is still a hack that paper over the root cause. The model's *intention* to write multiple blocks is unchanged; you're just cutting it off.

**The root cause is that markdown code blocks are not action primitives in the model's world model. Tool calls are.**

---

## 2. Would Tool Calls Actually Prevent Multi-Block?

### 2a. With `disable_parallel_tool_use: true`: Yes, mechanically guaranteed

The Anthropic Messages API guarantees that with `disable_parallel_tool_use: true`, the response `content` array will contain at most one `tool_use` block. The model stops generating with `stop_reason: "tool_use"`. This is an API-level contract, not a prompt-level suggestion. The model physically cannot emit a second tool call because the API terminates generation after the first one.

### 2b. Would the model still write text + code outside the tool call?

Yes, and this is fine. The Anthropic Messages API response `content` array can contain `text` blocks before the `tool_use` block. This is visible in the example at line 267-280 of `openrouter-tool-calling-docs.md`:

```json
"content": [
  { "type": "text", "text": "Let me run that code for you." },
  { "type": "tool_use", "id": "toolu_abc123", "name": "execute_code", "input": { "code": "..." } }
]
```

This is actually *better* than the current setup. The model writes its reasoning as text, then its single action as a tool call. You get observable chain-of-thought (the `text` blocks) AND enforced single-action execution (the `tool_use` block). Currently, reasoning is mixed into the same text blob as code blocks, making it harder to parse.

### 2c. Would reasoning quality degrade?

No. The model still gets to write arbitrary text before the tool call. The text blocks in the `content` array serve the same function as the prose reasoning before a ```javascript block in the current system. The model's chain-of-thought is preserved.

### 2d. Would the model adapt naturally to "one action, then wait" pacing?

Yes. All major models (Claude, GPT-4, Gemini) are trained extensively on tool-call patterns. The "call a tool, observe the result, decide next action" loop is deeply embedded in their training. This is *more* natural for the model than "write one code block and stop" because tool-call-and-wait is a pattern the model has practiced, whereas single-code-block-and-stop is fighting the model's document-completion instincts.

### 2e. What about extended thinking / chain-of-thought?

If using Anthropic's native API, the model can use extended thinking (the `thinking` block type) before the tool call. This would give even richer observable reasoning. With OpenRouter, thinking blocks may or may not be surfaced depending on the proxy implementation, but the `text` blocks in the `content` array always work.

---

## 3. What Changes in the Engine?

### 3a. The `CallLLM` type signature

Currently (`src/rlm.ts`, line 4):
```typescript
export type CallLLM = (messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<string>;
```

This returns a plain string -- the model's text response. For tool calls, the return type needs to change. Two options:

**Option A: Minimal change -- still return a string**

The driver extracts the code from the tool call response and returns it as a string. The `CallLLM` contract stays the same. The engine doesn't know tool calls exist. The driver handles the API specifics.

Problem: This loses the reasoning text. The `TraceEntry.reasoning` field would be empty (or would need to be smuggled through separately).

**Option B: Richer return type**

```typescript
export type CallLLMResponse = {
  reasoning: string;       // text blocks concatenated
  code: string | null;     // tool call input.code, or null if no tool call
};

export type CallLLM = (
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  systemPrompt: string,
) => Promise<string | CallLLMResponse>;
```

The engine checks if the return is a string (backward compatible, existing behavior) or a `CallLLMResponse` (new tool-call behavior). This preserves backward compatibility while enabling the richer interface.

**Recommendation:** Option B. The `CallLLM` signature is the seam between the engine and the API driver. Keeping it minimal but extensible is correct.

### 3b. The LLM call itself

Currently, `fromOpenRouterCompatible` in `openrouter-compatible.ts` (line 137-261) makes a POST to `/chat/completions` with `messages` and returns `choices[0].message.content`.

For tool calls, a new driver (or a new mode in the existing driver) would:

1. POST to `/api/v1/messages` (Anthropic Messages API via OpenRouter) or use the Responses API
2. Include `tools: [{ name: "execute_code", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } }]`
3. Include `tool_choice: { type: "tool", name: "execute_code", disable_parallel_tool_use: true }`
4. Parse the response `content` array: concatenate `text` blocks as reasoning, extract the single `tool_use` block's `input.code` as code

### 3c. Code extraction: `extractCodeBlocks` disappears

Currently (`rlm.ts`, line 121-128):
```typescript
function extractCodeBlocks(text: string): string[] {
    const blocks: string[] = [];
    const regex = /```(?:javascript|js|repl)\n([\s\S]*?)```/g;
    for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
        blocks.push(match[1].trimEnd());
    }
    return blocks;
}
```

With tool calls, code extraction is trivial: `response.code` from the `CallLLMResponse`. The regex, the malformed-fence auto-fix (lines 350-357), the max-blocks-per-iteration logic (lines 361-368) -- all of this goes away. This is a significant simplification.

### 3d. The iteration loop

Currently, the inner loop at line 373-437 iterates over `codeBlocks` (an array). With tool calls, there is always exactly zero or one code block. The inner `for (const block of codeBlocks)` loop collapses to a simple `if (response.code)` branch. The combined output/error accumulation simplifies accordingly.

### 3e. Conversation history

Currently (line 461):
```typescript
messages.push({ role: "assistant", content: response });
messages.push({ role: "user", content: nextIterContext + outputMsg });
```

With the Anthropic Messages API, the conversation history format changes:

```typescript
// Assistant response (includes text + tool_use)
messages.push({
  role: "assistant",
  content: [
    { type: "text", text: reasoning },
    { type: "tool_use", id: toolUseId, name: "execute_code", input: { code } }
  ]
});

// Tool result
messages.push({
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: toolUseId, content: outputMsg }
  ]
});
```

This is a structural change to the message format. The engine currently uses `{ role: string; content: string }` messages. Tool calls require `content` to be either a string or an array of typed blocks. This is the messiest part of the migration.

**However**, this complexity can be encapsulated in the driver. The driver can accept the engine's simple messages and translate them into the API-specific format, and vice versa. The engine never needs to know about `tool_use` blocks if the driver handles the translation.

### 3f. `return()` detection

Currently, `return()` is detected via the `returnValue` property from `env.exec()` (line 418). This mechanism is completely independent of how code reaches the engine -- whether from a code block or a tool call, it still goes through `env.exec()` the same way. **No change needed.**

### 3g. Error handling

Currently, errors from `env.exec()` are captured in `execResult.error` (line 399-402). This is unchanged. Errors from the LLM call itself are caught at line 339-345. The new driver would handle API-level errors internally (retries, timeouts) and throw for unrecoverable failures, same as today.

### 3h. Streaming

The current streaming implementation (`stopAfterFirstBlock` in the driver) **becomes unnecessary**. With `disable_parallel_tool_use: true`, the model physically cannot emit a second tool call. There is nothing to abort early. Streaming can still be used for progressive display of the model's reasoning text, but it is no longer needed for correctness.

---

## 4. What About the System Prompt?

### 4a. Does the system prompt need to change?

Yes, but minimally. The key changes:

1. **Remove**: "Write one ```javascript fenced block per response" (line 34 of `system-prompt.ts`). The tool call mechanism enforces this; the prompt no longer needs to.

2. **Change**: The preamble should say the model has a single tool (`execute_code`) that runs JavaScript in a persistent sandbox. The model should understand it calls this tool to execute code.

3. **Keep**: Everything about the sandbox environment, `return()`, `rlm()`, `__rlm`, `__ctx`, etc. These are sandbox APIs, not code-delivery mechanisms.

4. **Remove**: The `<rlm-rules>` "One ```javascript block per response. Stop and wait for output." rule (line 97). Enforced by the API.

5. **Simplify**: The text-only response handling (lines 473-485) and malformed fence detection become unnecessary -- if the model doesn't call the tool, that's a no-code response, and the engine can nudge it to call the tool on the next turn.

### 4b. Should the tool description be minimal or detailed?

**Minimal.** The tool description should be something like:

```
Execute JavaScript code in a persistent Node.js REPL sandbox. Output from console.log() is returned. Call return(value) to terminate and produce your final answer.
```

The detailed sandbox documentation stays in the system prompt, not the tool description. The tool description should be just enough for the model to understand "this runs code and I see the output." The system prompt provides the full API surface.

### 4c. Does the model still understand it's in a REPL loop?

Yes. The system prompt still describes the persistent sandbox, the iteration budget, the `return()` contract. The only difference is that instead of writing code in a markdown block, the model writes it in a tool call. The conceptual model is the same: write code -> see output -> repeat.

### 4d. Driver plugins affected

- **`one-block-per-iteration.md`**: Becomes unnecessary. Delete or archive.
- **`no-tool-calls.md`**: Inverts entirely -- now tool calls ARE the mechanism. Delete or rewrite.
- **`repl-discipline.md`**: Still valid. The advice about batch-testing hypotheses in one code block is good regardless of delivery mechanism.

---

## 5. Impact on RLM Simplicity / Tenets

Let me examine each relevant tenet:

### "The RLM is an Intelligent Computer" -- Preserved

> "a while loop, a model, and a sandbox"

With tool calls, it is still a while loop (the iteration loop in `rlm.ts`), a model (the LLM), and a sandbox (`JsEnvironment`). The loop structure is unchanged. The model still writes JavaScript, the sandbox still executes it, the loop still continues until `return()`.

### "Trust the Model" -- Preserved

> "Push complexity into the model, not the engine."

Tool calls do not add engine complexity. They *remove* it: `extractCodeBlocks`, malformed-fence auto-fix, `maxBlocksPerIteration`, `stopAfterFirstBlock` streaming, text-only response nudges -- all of this engine-side complexity exists to compensate for the model writing multiple blocks. With tool calls, the model naturally produces one action per turn. The engine gets simpler.

### "The Sandbox IS the Tool" -- This is the contentious tenet

> "There is no tool use. There is no function calling."

This tenet explicitly rejects tool calls. Let me engage with it honestly.

The tenet's *intent* is that the model should not need a zoo of specialized tools (web search, file read, database query). It should have a single, general-purpose interface: a JavaScript sandbox. Everything the model needs to do, it does through code.

The proposed change *preserves this intent*. There is still exactly one tool: `execute_code`. It does exactly what the sandbox already does -- runs JavaScript. The tool is not a new capability; it is a new *delivery mechanism* for the same capability. The model still writes JavaScript. It still sees output. It still calls `return()`. The sandbox is still the only interface.

The tenet's *letter* says "There is no tool use." The proposed change uses tool use. This is a literal violation.

**My assessment**: The tenet conflates two concerns -- the *interface* (one general-purpose sandbox, not a zoo of tools) and the *delivery mechanism* (markdown code blocks). The interface concern is the important one. Using a tool call to deliver code to the same sandbox preserves the interface while fixing a real execution fidelity problem. The tenet should be updated to say something like: "There is one tool: the sandbox. The model writes JavaScript, and that is the only interface it needs." This preserves the spirit while acknowledging the delivery mechanism change.

### "Irreducible Core" -- Preserved

> "The engine is a single module. One runtime dependency: `acorn`."

The tool call change does not add dependencies. It changes the API call format in the driver and simplifies the engine. `acorn` is still the only runtime dependency.

### "Fail Loudly" -- Preserved

Errors are still surfaced. The `tool_result` can include `is_error: true` in the Anthropic Messages API, making error signaling even more explicit.

### "Explicit Termination" -- Preserved

`return()` is still the only way to end the loop. This is a sandbox-level contract that has nothing to do with the code delivery mechanism.

### Net assessment

One tenet is literally violated ("The Sandbox IS the Tool" says "There is no tool use"). But the violation is cosmetic: the spirit of the tenet (one general-purpose interface, not a tool zoo) is preserved. The engine gets simpler, not more complex. No other tenets are impacted.

---

## 6. Impact on Delegation (`rlm()`)

### 6a. Does `await rlm(...)` still work the same way?

Yes. `rlm()` is a sandbox function that calls `rlmInternal()` (line 492-585 of `rlm.ts`). `rlmInternal` calls `callLLM`, gets a response, extracts code, executes it. With tool calls, `rlmInternal` calls `callLLM`, gets a response with code already extracted, executes it. The sandbox-side `rlm()` function is unchanged.

### 6b. Does the child agent also use tool calls?

Yes. `rlmInternal` is recursive. If the parent's `callLLM` uses tool calls, so does the child's (unless the child uses a different `callLLMOverride` that doesn't). This is already handled: the `callLLMOverride` parameter (line 245) lets different model aliases use different drivers. A child using a model that doesn't support tool calls could use the old text-block driver, while the parent uses tool calls. This is an advantage of the `CallLLM` function-passing architecture.

### 6c. Any recursive complexity?

None beyond what already exists. The invocation stack, context store, and child trace management are all orthogonal to the code delivery mechanism.

---

## 7. API Surface Considerations

### 7a. Chat Completions API: NOT viable

From the scout agent's findings (section 4 of `openrouter-tool-calling-docs.md`):

> **There is NO `parallel_tool_calls` parameter in the Chat Completions API.** The model CAN return multiple tool calls in a single response, and there is no way to prevent this.

This is a dealbreaker. The Chat Completions API would replicate the exact same problem: the model pre-commits multiple tool calls in one response, all executing before any result is seen. We must use a different API surface.

### 7b. Anthropic Messages API: Best option

- `disable_parallel_tool_use: true` is a first-class API parameter
- `tool_choice: { type: "tool", name: "execute_code", disable_parallel_tool_use: true }` forces exactly one call to the named tool
- Response format is clean: `content` array with `text` and `tool_use` blocks
- Streaming is supported with distinct event types for text and tool use
- OpenRouter supports the Anthropic Messages API at `/api/v1/messages`

### 7c. Responses API: Also viable

- `parallel_tool_calls: false` + `max_tool_calls: 1` provides belt-and-suspenders
- OpenRouter supports the Responses API at `/api/v1/responses`
- More OpenAI-native feel, but less battle-tested on OpenRouter

### 7d. Cross-model compatibility

This is the real concern. The Anthropic Messages API is Anthropic-native. Using it means:

- **Claude models**: First-class support. This is the native API.
- **GPT-4 / o-series**: OpenRouter proxies them through the Messages API, but behavior may differ. The `disable_parallel_tool_use` parameter may not be honored by all models.
- **Gemini**: Already problematic (the `no-tool-calls.md` driver exists because Gemini hallucinates tool calls). Gemini through the Anthropic Messages API on OpenRouter is untested territory.
- **Open-source models**: Unlikely to support tool calls well through any API surface.

**Practical implication**: The tool call approach works best for Claude. For other models, the existing text-block approach (with `stopAfterFirstBlock` and `maxBlocksPerIteration` as fallbacks) may still be needed. The `CallLLM` function-passing architecture already supports this: different models can use different drivers.

### 7e. Driver architecture change

Currently, there is one driver: `openrouter-compatible.ts`, which uses the Chat Completions API. The migration requires:

1. A new driver (or new mode) for the Anthropic Messages API
2. The existing driver continues to work for models that don't support tool calls
3. The `fromProviderModel` factory chooses the right driver based on the model/provider

This is a natural extension of the existing architecture. The eval harness already passes `callLLM` functions around; different models getting different drivers is already the design.

---

## 8. The Minimal Change

The absolute minimum to get tool-call REPL working:

### Step 1: New driver function (~60 lines)

```typescript
export function fromAnthropicMessages(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
}): CallLLM {
  // POST to /messages with:
  //   tools: [{ name: "execute_code", input_schema: { ... } }]
  //   tool_choice: { type: "tool", name: "execute_code", disable_parallel_tool_use: true }
  // Parse response: concatenate text blocks as reasoning, extract tool_use.input.code
  // Return { reasoning, code } or just the code string
}
```

### Step 2: Engine changes in `rlm.ts` (~20 lines changed)

If `CallLLM` still returns a string (Option A from section 3a):

1. The driver returns the code from the tool call directly as the string
2. The engine wraps it in a synthetic ```javascript block so `extractCodeBlocks` still works
3. Everything else is unchanged

This is the laziest possible integration. It works but loses reasoning text.

If we want to preserve reasoning (Option B):

1. `CallLLM` returns `string | { reasoning: string; code: string | null }`
2. The engine checks the return type. If string: existing path. If object: skip `extractCodeBlocks`, use `response.code` directly
3. Store `response.reasoning` in `TraceEntry.reasoning`

### Step 3: System prompt tweaks (~5 lines)

No structural change to `buildSystemPrompt`. Just reword "Write one ```javascript fenced block per response" to something like "Use the execute_code tool to run JavaScript in your sandbox."

### Step 4: Tool definition in the request

The tool definition is sent with every API call. It is a static JSON object:

```json
{
  "name": "execute_code",
  "description": "Execute JavaScript in a persistent Node.js REPL. console.log() output is returned. Call return(value) to produce your final answer.",
  "input_schema": {
    "type": "object",
    "properties": {
      "code": { "type": "string", "description": "JavaScript code to execute" }
    },
    "required": ["code"]
  }
}
```

This is the "most minimally opinionated interface possible." One parameter: `code`. A string. Goes to the same sandbox. No structured API, no parameter schemas beyond the single string.

### Total change surface

- 1 new file: Anthropic Messages API driver (~100 lines)
- 1 modified file: `rlm.ts` (~20 lines changed, ~30 lines deleted)
- 1 modified file: `system-prompt.ts` (~5 lines changed)
- 1 modified file: `fromProviderModel` in the driver (~10 lines to route Anthropic models to the new driver)

This is a small, well-scoped change.

---

## 9. Risks and Downsides

### 9a. Token overhead

Tool call formatting adds tokens. The tool definition is sent with every request (~50 tokens). The `tool_use` block in the response has structural overhead (~20 tokens for the id, name, and JSON wrapper). The `tool_result` in the next turn has similar overhead. Estimate: ~100 extra tokens per iteration.

At Claude Opus 4.6 pricing (~$15/M input, $75/M output), 100 tokens per iteration across 15 iterations is ~$0.001 extra per run. Negligible.

### 9b. Latency

Tool call responses may have slightly higher latency due to constrained decoding (the model must produce valid JSON for the tool call input). In practice, this is ~100-200ms per call. Over 15 iterations, that's 1.5-3 seconds. Unlikely to be the bottleneck compared to actual generation time.

### 9c. Less explanatory text

There is a risk that with `tool_choice: { type: "tool", ... }`, the model writes less reasoning text and jumps straight to the tool call. This would reduce the observability of the model's thinking.

Mitigation: The system prompt can say "Think through your approach in text before calling execute_code." The `text` blocks in the `content` array would capture this reasoning. Alternatively, if the model skips reasoning text, the `TraceEntry.reasoning` field could be populated from the model's internal thinking (if extended thinking is enabled).

In practice, I expect this risk is low. Models trained on tool-call patterns routinely produce reasoning text before the tool call (this is how Claude Code itself works).

### 9d. Reduced quality for some tasks

Unlikely. The tool call approach executes the same code in the same sandbox. The only difference is that the model sees real output after every action instead of hallucinating output between actions. This should *improve* quality, not reduce it.

There is one edge case: tasks where the model benefits from writing multiple related code blocks as a single coherent plan (e.g., "define helper functions, then use them"). With tool calls, the model would need to put all of this in a single tool call, or define helpers in one call and use them in the next (which works fine since the sandbox is persistent). This is not a quality reduction; it's a pacing change.

### 9e. Models that don't support tool calls well

Gemini already hallucinates tool calls (hence `no-tool-calls.md`). Open-source models via Ollama/vLLM may not support tool calls reliably. For these models, the existing text-block driver should remain available as a fallback. The `CallLLM` function-passing architecture already supports this.

### 9f. Lock-in to Anthropic API format

Using the Anthropic Messages API means the tool call enforcement (`disable_parallel_tool_use`) only works for models that support this parameter. For models accessed through the Chat Completions API (which has no parallel_tool_calls control), tool calls would not solve the multi-block problem.

Mitigation: The Responses API also supports `parallel_tool_calls: false` + `max_tool_calls: 1`. A Responses API driver would work for OpenAI models. Between the two API surfaces, Claude and GPT-4 (the primary models) are covered.

### 9g. Conversation history format change

The current message format is `{ role: string; content: string }`. The Anthropic Messages API uses `{ role: string; content: string | ContentBlock[] }`. This changes how conversation history is constructed and stored.

Mitigation: Encapsulate this in the driver. The engine can continue to use simple string messages internally, and the driver can translate to/from the API-specific format. The `tool_use_id` management (matching tool calls to results) is the driver's responsibility, not the engine's.

---

## 10. Recommendation

### Do it. Here's the migration path.

**Phase 1: New Anthropic Messages driver (low risk, high value)**

1. Write `src/drivers/anthropic-messages.ts` implementing the Anthropic Messages API with tool calls and `disable_parallel_tool_use: true`
2. Return type: `{ reasoning: string; code: string | null }` (or adapt `CallLLM` to support this)
3. Test with Claude Opus 4.6 on the existing eval benchmarks
4. Wire into `fromProviderModel` for `openrouter/anthropic/*` models

**Phase 2: Engine simplification (medium risk, high value)**

1. Update `CallLLM` type to accept `string | { reasoning: string; code: string | null }` return
2. Simplify the iteration loop: if response has `.code`, use it directly; if string, use `extractCodeBlocks`
3. Remove `maxBlocksPerIteration` option (no longer needed with tool calls)
4. Remove `stopAfterFirstBlock` streaming (no longer needed)
5. Remove malformed-fence auto-fix
6. Update system prompt: remove "one block per response" language, add tool reference

**Phase 3: Eval validation (required before merge)**

1. Run the full eval suite (oolong, s-niah, arc, arc3) with the new driver
2. Compare scores to baseline (current text-block driver with same models)
3. Verify that multi-block hallucination is eliminated (check traces for multiple code blocks -- there should be zero)
4. Measure cost/latency delta

**Phase 4: Backward compatibility (keep both paths)**

1. The old Chat Completions driver remains for models that don't support tool calls
2. `fromProviderModel` routes based on provider: `openrouter/anthropic/*` gets tool calls, everything else gets text blocks
3. The `CallLLM` type's union return type ensures both paths work

### What NOT to do

- Do NOT switch API surfaces for all models at once. Start with Claude only.
- Do NOT remove the text-block code path. Keep it as a fallback.
- Do NOT make the tool definition configurable or multi-tool. One tool, one parameter, one string. That's the whole interface.
- Do NOT add `tool_choice: "auto"` or `tool_choice: "any"`. Always force the specific tool. The model's job is to write code; let it think in text before calling the tool, but it must always call the tool. A response without a tool call is wasted.

### On the tenet

Update "The Sandbox IS the Tool" to read:

> There is one tool: the sandbox. The model writes JavaScript, and that is the only interface it needs. `execute_code` in, output out, loop. Anything Node can do, the RLM can do.

This preserves the tenet's intent (one general-purpose interface, no tool zoo) while acknowledging the delivery mechanism.

---

## Appendix: Code Reference

| File | Lines | What it does |
|------|-------|--------------|
| `src/rlm.ts:4` | `CallLLM` type | Needs union return type |
| `src/rlm.ts:121-128` | `extractCodeBlocks` | Can be bypassed for tool-call responses |
| `src/rlm.ts:330-490` | `rlmInternal` iteration loop | Main modification target |
| `src/rlm.ts:347-357` | Malformed fence auto-fix | Can be removed |
| `src/rlm.ts:361-368` | `maxBlocksPerIteration` | Can be removed |
| `src/rlm.ts:373-437` | Inner code block loop | Collapses to single if-branch |
| `src/rlm.ts:461-486` | Conversation history construction | Format changes for tool results |
| `src/system-prompt.ts:34` | "Write one ```javascript fenced block" | Needs rewording |
| `src/system-prompt.ts:97` | "One ```javascript block per response" | Needs rewording |
| `src/drivers/openrouter-compatible.ts:80-135` | `stopAfterFirstBlock` streaming | Can be removed |
| `src/drivers/openrouter-compatible.ts:137-261` | `fromOpenRouterCompatible` | Remains for non-tool-call models |
| `plugins/drivers/one-block-per-iteration.md` | Prompt-level enforcement | Becomes unnecessary |
| `plugins/drivers/no-tool-calls.md` | Suppress hallucinated tool calls | Inverts; needs rewrite or deletion |
