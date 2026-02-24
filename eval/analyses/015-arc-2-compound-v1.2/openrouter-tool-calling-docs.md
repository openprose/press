# OpenRouter Tool Calling API Documentation

Extracted from the OpenRouter OpenAPI spec (`openrouter.json`). Covers all three API surfaces:
1. **Chat Completions API** (`/chat/completions`) -- OpenAI-compatible
2. **Anthropic Messages API** (`/messages`) -- Anthropic-native
3. **Responses API** (`/responses`) -- OpenAI Responses format

---

## 1. Chat Completions API (OpenAI-compatible)

### 1.1 Tool Definition (Request)

Schema: `ToolDefinitionJson`

```json
{
  "type": "function",
  "function": {
    "name": "execute_code",          // string, maxLength: 64, REQUIRED
    "description": "Run JavaScript", // string, optional
    "parameters": {                  // object (JSON Schema), optional
      "type": "object",
      "properties": {
        "code": { "type": "string" }
      },
      "required": ["code"]
    },
    "strict": true                   // boolean | null, optional
  }
}
```

Required fields: `type` ("function"), `function.name`.

### 1.2 tool_choice (Request)

Schema: `ToolChoiceOption` -- one of:

| Value | Type | Meaning |
|-------|------|---------|
| `"none"` | string | Model will NOT call any tool |
| `"auto"` | string | Model decides whether to call a tool |
| `"required"` | string | Model MUST call at least one tool |
| `{ "type": "function", "function": { "name": "execute_code" } }` | object (`NamedToolChoice`) | Model MUST call this specific tool |

**CRITICAL: There is NO `parallel_tool_calls` parameter in the Chat Completions API.** The `ChatGenerationParams` schema defines `tool_choice` and `tools` but does NOT include `parallel_tool_calls`. This means there is no way to disable parallel tool calls via the Chat Completions endpoint on OpenRouter.

### 1.3 Assistant Response with Tool Calls

Schema: `AssistantMessage` includes:

```json
{
  "role": "assistant",
  "content": null,               // string | array | null
  "tool_calls": [                // array of ChatMessageToolCall
    {
      "id": "call_abc123",       // string, REQUIRED
      "type": "function",        // const "function", REQUIRED
      "function": {
        "name": "execute_code",  // string, REQUIRED
        "arguments": "{\"code\":\"console.log('hello')\"}"  // string (JSON), REQUIRED
      }
    }
  ]
}
```

Schema: `ChatMessageToolCall`
- Required: `id`, `type` (const "function"), `function` (with `name` and `arguments`)

**CRITICAL: `tool_calls` is an ARRAY.** The model CAN return multiple tool calls in a single response. There is nothing in the Chat Completions schema to prevent this.

### 1.4 Finish Reason

Schema: `ChatCompletionFinishReason`:
```
enum: ["tool_calls", "stop", "length", "content_filter", "error"]
```

When the model wants to call tools, `finish_reason` will be `"tool_calls"`.

### 1.5 Tool Result (Sending back to API)

Schema: `ToolResponseMessage`:

```json
{
  "role": "tool",                    // const "tool", REQUIRED
  "content": "result string",        // string | array of content items, REQUIRED
  "tool_call_id": "call_abc123"      // string, REQUIRED -- must match the tool call's id
}
```

Required: `role`, `content`, `tool_call_id`.

### 1.6 Streaming Tool Calls

Schema: `ChatStreamingMessageToolCall`:

```json
{
  "index": 0,                  // number, REQUIRED -- identifies which tool call in the array
  "id": "call_abc123",         // string, optional (present in first chunk)
  "type": "function",          // const "function", optional
  "function": {
    "name": "execute_code",    // string, optional (present in first chunk)
    "arguments": "{\"co"       // string, streamed incrementally
  }
}
```

The `index` field is required and distinguishes between parallel tool calls during streaming. Each chunk's `delta.tool_calls` array can contain partial argument strings for one or more tool calls, identified by `index`.

### 1.7 Full Chat Completions Request Example

```json
{
  "model": "anthropic/claude-opus-4-6",
  "messages": [
    { "role": "user", "content": "Run some code for me" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "execute_code",
        "description": "Execute JavaScript code in a sandbox",
        "parameters": {
          "type": "object",
          "properties": {
            "code": { "type": "string", "description": "JavaScript code to execute" }
          },
          "required": ["code"]
        }
      }
    }
  ],
  "tool_choice": "required"
}
```

### 1.8 Full Chat Completions Response Example

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "execute_code",
              "arguments": "{\"code\":\"console.log('hello')\"}"
            }
          }
        ]
      }
    }
  ]
}
```

---

## 2. Anthropic Messages API

### 2.1 Tool Definition (Request)

The Anthropic API supports multiple tool types in the `tools` array:

#### Custom Tool
```json
{
  "name": "execute_code",         // string, REQUIRED
  "description": "Run JavaScript", // string, optional
  "input_schema": {                // object, REQUIRED
    "type": "object",              // REQUIRED (must be "object")
    "properties": {
      "code": { "type": "string" }
    },
    "required": ["code"]
  },
  "type": "custom",               // optional, enum: ["custom"]
  "cache_control": {               // optional
    "type": "ephemeral",
    "ttl": "5m"                    // enum: ["5m", "1h"]
  }
}
```

Required: `name`, `input_schema` (with `type: "object"`).

#### Built-in Tools
```json
// Bash tool
{ "type": "bash_20250124", "name": "bash" }

// Text editor tool
{ "type": "text_editor_20250124", "name": "str_replace_editor" }

// Web search tool
{
  "type": "web_search_20250305",
  "name": "web_search",
  "allowed_domains": ["example.com"],   // optional
  "blocked_domains": ["bad.com"],       // optional
  "max_uses": 5                         // optional
}
```

### 2.2 tool_choice (Request)

The Anthropic tool_choice is an object with a `type` field, NOT a plain string:

| Value | Schema | Meaning |
|-------|--------|---------|
| `{ "type": "auto" }` | object | Model decides whether to call a tool |
| `{ "type": "any" }` | object | Model MUST call at least one tool |
| `{ "type": "none" }` | object | Model will NOT call any tool |
| `{ "type": "tool", "name": "execute_code" }` | object | Model MUST call this specific tool |

**CRITICAL: `disable_parallel_tool_use` field.** The `auto`, `any`, and `tool` variants all support:

```json
{
  "type": "auto",
  "disable_parallel_tool_use": true   // boolean, optional
}
```

```json
{
  "type": "any",
  "disable_parallel_tool_use": true   // boolean, optional
}
```

```json
{
  "type": "tool",
  "name": "execute_code",
  "disable_parallel_tool_use": true   // boolean, optional
}
```

**This is the key mechanism to force exactly ONE tool call per response.** Setting `disable_parallel_tool_use: true` tells the model to make at most one tool call per turn.

### 2.3 Assistant Response with Tool Use

The response `content` array can contain `tool_use` blocks (among other block types):

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Let me run that code for you.",
      "citations": null
    },
    {
      "type": "tool_use",
      "id": "toolu_abc123",          // string, REQUIRED
      "name": "execute_code",        // string, REQUIRED
      "input": {                     // any (nullable) -- the parsed arguments
        "code": "console.log('hello')"
      }
    }
  ],
  "model": "claude-opus-4-6-20250929",
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": { ... }
}
```

**CRITICAL: `content` is an ARRAY.** Without `disable_parallel_tool_use`, the model CAN return multiple `tool_use` blocks in a single response.

### 2.4 stop_reason

```
enum: ["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal"]
```

When the model wants to call tools, `stop_reason` will be `"tool_use"`.

### 2.5 Tool Result (Sending back to API)

Tool results are sent as content blocks in a `user` message:

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_abc123",    // string, REQUIRED -- matches tool_use.id
      "content": "Execution result: hello",  // string | array of content blocks
      "is_error": false,                 // boolean, optional
      "cache_control": {                 // optional
        "type": "ephemeral"
      }
    }
  ]
}
```

Required: `type`, `tool_use_id`. Content can be a string or an array of text/image blocks.

### 2.6 Full Anthropic Request Example

```json
{
  "model": "anthropic/claude-opus-4-6",
  "max_tokens": 4096,
  "messages": [
    {
      "role": "user",
      "content": "Run some code for me"
    }
  ],
  "tools": [
    {
      "name": "execute_code",
      "description": "Execute JavaScript code in a sandbox",
      "input_schema": {
        "type": "object",
        "properties": {
          "code": { "type": "string" }
        },
        "required": ["code"]
      }
    }
  ],
  "tool_choice": {
    "type": "tool",
    "name": "execute_code",
    "disable_parallel_tool_use": true
  }
}
```

---

## 3. Responses API (OpenAI Responses format)

### 3.1 Tool Definition (Request)

Schema: `OpenResponsesFunctionTool`:

```json
{
  "type": "function",                  // enum: ["function"], REQUIRED
  "name": "execute_code",             // string, REQUIRED
  "description": "Run JavaScript",    // string, nullable, optional
  "strict": true,                     // boolean, nullable, optional
  "parameters": {                     // object, nullable, REQUIRED
    "type": "object",
    "properties": {
      "code": { "type": "string" }
    },
    "required": ["code"]
  }
}
```

Required: `type`, `name`, `parameters`.

Also supports web search tools (`web_search_preview`, `web_search_preview_2025_03_11`, `web_search`, `web_search_2025_08_26`).

### 3.2 tool_choice (Request)

Schema: `OpenAIResponsesToolChoice` -- one of:

| Value | Meaning |
|-------|---------|
| `"auto"` | Model decides whether to call a tool |
| `"none"` | Model will NOT call any tool |
| `"required"` | Model MUST call at least one tool |
| `{ "type": "function", "name": "execute_code" }` | Force a specific function |
| `{ "type": "web_search_preview" }` | Force web search |

### 3.3 parallel_tool_calls (Request)

```json
{
  "parallel_tool_calls": false    // boolean, nullable
}
```

**Default is `true`** (visible in all response examples: `"parallel_tool_calls": true`).

Setting `parallel_tool_calls: false` should disable parallel tool calling.

### 3.4 max_tool_calls (Request)

```json
{
  "max_tool_calls": 1    // integer, nullable
}
```

This is a Responses API-specific parameter. It limits the total number of tool calls the model can make. **Setting this to 1 would cap the model at exactly one tool call per response.**

### 3.5 Response with Function Calls

The response `output` is an array that can contain multiple item types:

```json
{
  "id": "resp-abc123",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "function_call",       // discriminator
      "id": "call-abc123",           // string
      "name": "execute_code",        // string, REQUIRED
      "arguments": "{\"code\":\"console.log('hello')\"}", // string (JSON), REQUIRED
      "call_id": "call-abc123",      // string, REQUIRED
      "status": "completed"          // enum: ["in_progress", "completed", "incomplete"]
    }
  ],
  "output_text": "",
  "tools": [...],
  "tool_choice": "auto",
  "parallel_tool_calls": true
}
```

Schema: `OutputItemFunctionCall` / `ResponsesOutputItemFunctionCall`
- Required: `type`, `name`, `arguments`, `call_id`
- `output` is an ARRAY, so multiple `function_call` items are possible

### 3.6 Function Call Output (Sending results back)

Schema: `OpenResponsesFunctionCallOutput`:

```json
{
  "type": "function_call_output",    // REQUIRED
  "call_id": "call-abc123",         // string, REQUIRED -- matches function_call.call_id
  "output": "{\"result\":\"hello\"}", // string, REQUIRED
  "id": "output-abc123",            // string, nullable, optional
  "status": "completed"             // enum: ["in_progress", "completed", "incomplete"]
}
```

This is included in the `input` array when sending the next request.

### 3.7 Streaming Events

Two events for function call argument streaming:

**Delta event** (`response.function_call_arguments.delta`):
```json
{
  "type": "response.function_call_arguments.delta",
  "item_id": "item-1",
  "output_index": 0,
  "delta": "{\"city\": \"San",
  "sequence_number": 4
}
```

**Done event** (`response.function_call_arguments.done`):
```json
{
  "type": "response.function_call_arguments.done",
  "item_id": "item-1",
  "output_index": 0,
  "name": "get_weather",
  "arguments": "{\"city\": \"San Francisco\", \"units\": \"celsius\"}",
  "sequence_number": 6
}
```

The `output_index` field differentiates between multiple parallel function calls in the output array.

### 3.8 Full Responses API Request Example

From the OpenAPI spec example:
```json
{
  "model": "anthropic/claude-4.5-sonnet-20250929",
  "input": [
    {
      "type": "message",
      "content": "Hello, how are you?",
      "role": "user"
    }
  ],
  "temperature": 0.7,
  "top_p": 0.9,
  "tools": [
    {
      "type": "function",
      "name": "get_current_weather",
      "description": "Get the current weather in a given location",
      "parameters": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        }
      }
    }
  ],
  "parallel_tool_calls": false,
  "max_tool_calls": 1
}
```

---

## 4. Critical Analysis: Can Multiple Tool Calls Be Prevented?

### Summary Table

| API | Can model make multiple tool calls? | Parameter to limit? | Can force exactly 1? |
|-----|--------------------------------------|---------------------|----------------------|
| Chat Completions | YES -- `tool_calls` is an array | NO `parallel_tool_calls` param | NO -- `"required"` still allows multiple |
| Anthropic Messages | YES -- `content` can have multiple `tool_use` blocks | `disable_parallel_tool_use: true` | YES |
| Responses API | YES -- `output` can have multiple `function_call` items | `parallel_tool_calls: false` AND `max_tool_calls: 1` | YES |

### Detailed Findings

#### Chat Completions API -- NO WAY TO PREVENT MULTIPLE TOOL CALLS

The `ChatGenerationParams` schema has `tool_choice` and `tools` but **does NOT include `parallel_tool_calls`**. Even though `parallel_tool_calls` appears in the `Parameter` enum (line 10142, suggesting it's a known model parameter), it is not present in the Chat Completions request body schema.

- `tool_choice: "required"` forces the model to call at least one tool, but does not cap it at one.
- `tool_choice: { "type": "function", "function": { "name": "X" } }` forces a specific function, but the model could still theoretically return multiple calls to that function (the `tool_calls` array has no maxItems constraint).

#### Anthropic Messages API -- YES, via `disable_parallel_tool_use`

The Anthropic `tool_choice` object supports `disable_parallel_tool_use: true` on the `auto`, `any`, and `tool` variants. This is the cleanest mechanism:

```json
{
  "tool_choice": {
    "type": "tool",
    "name": "execute_code",
    "disable_parallel_tool_use": true
  }
}
```

This forces exactly one call to `execute_code` per response.

#### Responses API -- YES, via `parallel_tool_calls` + `max_tool_calls`

Two independent controls:
1. `"parallel_tool_calls": false` -- disables parallel tool calling (default is `true`)
2. `"max_tool_calls": 1` -- hard cap on total tool calls per response

Using both provides belt-and-suspenders protection.

---

## 5. Implications for RLM Multi-Block Problem

### The Core Question

> Would switching from markdown code blocks to tool calls prevent a model from "pre-committing" multiple actions in a single response?

### Answer: It depends on the API surface.

**If using Chat Completions API**: Tool calls **do NOT solve the problem**. The model can still return multiple `tool_calls` in one response, and there is no `parallel_tool_calls` parameter available. The model could emit 5 tool calls in one shot, all pre-committed before any executes -- exactly the same problem as multiple code blocks.

**If using Anthropic Messages API**: Tool calls **CAN solve the problem** by using:
```json
"tool_choice": { "type": "tool", "name": "execute_code", "disable_parallel_tool_use": true }
```
This forces the model to emit exactly one `tool_use` block, then stop with `stop_reason: "tool_use"`. You execute it, send the result back as a `tool_result`, and the model gets to see the result before deciding its next action.

**If using Responses API**: Tool calls **CAN solve the problem** by using:
```json
"parallel_tool_calls": false,
"max_tool_calls": 1
```

### Recommendation

To fix the multi-block execution problem, the RLM system should use either:

1. **Anthropic Messages API** with `tool_choice: { type: "tool", name: "execute_code", disable_parallel_tool_use: true }` -- native, cleanest
2. **Responses API** with `parallel_tool_calls: false` + `max_tool_calls: 1` -- also works

The Chat Completions API is **not sufficient** for this use case unless OpenRouter starts honoring `parallel_tool_calls` on that endpoint.

---

## 6. ToolCallStatus Enum (All APIs)

Used in Responses API to track tool call lifecycle:

```
enum: ["in_progress", "completed", "incomplete"]
```

---

## 7. Parameter Support by Model

The OpenRouter spec lists supported parameters per model. The `Parameter` enum includes:
```
"tools", "tool_choice", "parallel_tool_calls"
```

This means `parallel_tool_calls` is a recognized parameter across models, even though the Chat Completions schema doesn't include it as a top-level field. It's possible OpenRouter passes it through when present, but the schema doesn't formally define it for Chat Completions.
