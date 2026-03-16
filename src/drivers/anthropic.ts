import type { CallLLM, CallLLMOptions, CallLLMResponse } from "../rlm.js";
import { EXECUTE_CODE_TOOL } from "../system-prompt.js";

interface AnthropicTextBlock {
	type: "text";
	text: string;
}

interface AnthropicThinkingBlock {
	type: "thinking";
	thinking: string;
}

interface AnthropicToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input?: { code?: string };
}

interface AnthropicMessage {
	role: "user" | "assistant";
	content: string | Array<Record<string, unknown>>;
}

interface AnthropicMessagesResponse {
	content: Array<AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock | Record<string, unknown>>;
	stop_reason?: string;
	error?: { message: string; type?: string };
}

export interface AnthropicOptions {
	baseUrl?: string;
	apiKey: string;
	model: string;
	timeoutMs?: number;
	maxRetries?: number;
	maxTokens?: number;
	reasoningEffort?: string;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 16384;
const BASE_DELAY_MS = 1000;
const ANTHROPIC_VERSION = "2023-06-01";

function anthropicTool() {
	return {
		name: EXECUTE_CODE_TOOL.function.name,
		description: EXECUTE_CODE_TOOL.function.description,
		input_schema: EXECUTE_CODE_TOOL.function.parameters,
	};
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function translateMessages(
	engineMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }>,
): AnthropicMessage[] {
	const result: AnthropicMessage[] = [];

	for (const msg of engineMessages) {
		if (msg.role === "assistant" && msg.content.startsWith("__TOOL_CALL__\n")) {
			const parts = msg.content.split("\n__CODE__\n");
			const header = parts[0];
			const code = parts[1] ?? "";
			const headerLines = header.split("\n");
			const toolUseId = headerLines[1];
			const reasoning = headerLines.slice(2).join("\n");
			const content: Array<Record<string, unknown>> = [];

			if (reasoning) {
				content.push({ type: "text", text: reasoning });
			}

			content.push({
				type: "tool_use",
				id: toolUseId,
				name: EXECUTE_CODE_TOOL.function.name,
				input: { code },
			});

			result.push({
				role: "assistant",
				content,
			});
		} else if (msg.role === "user" && msg.content.startsWith("__TOOL_RESULT__\n")) {
			const lines = msg.content.split("\n");
			const toolUseId = lines[1];
			const content = lines.slice(2).join("\n");

			result.push({
				role: "user",
				content: [{
					type: "tool_result",
					tool_use_id: toolUseId,
					content,
				}],
			});
		} else {
			result.push({
				role: msg.role as "user" | "assistant",
				content: msg.content,
			});
		}
	}

	return result;
}

export function fromAnthropic(options: AnthropicOptions): CallLLM {
	const {
		baseUrl = DEFAULT_BASE_URL,
		apiKey,
		model,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxRetries = DEFAULT_MAX_RETRIES,
		maxTokens = DEFAULT_MAX_TOKENS,
	} = options;

	const endpoint = `${baseUrl.replace(/\/+$/, "")}/messages`;
	let callCount = 0;

	return async (messages, systemPrompt, _callOptions?: CallLLMOptions) => {
		const anthropicMessages = translateMessages(messages);
		const callId = ++callCount;
		const inputChars = anthropicMessages.reduce((sum, message) => {
			if (typeof message.content === "string") return sum + message.content.length;
			return sum + JSON.stringify(message.content).length;
		}, systemPrompt.length);

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const t0 = Date.now();
			const abortController = new AbortController();
			const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

			let response: Response;
			try {
				response = await fetch(endpoint, {
					signal: abortController.signal,
					method: "POST",
					headers: {
						"x-api-key": apiKey,
						"anthropic-version": ANTHROPIC_VERSION,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						model,
						max_tokens: maxTokens,
						system: systemPrompt,
						messages: anthropicMessages,
						tools: [anthropicTool()],
						tool_choice: {
							type: "tool",
							name: EXECUTE_CODE_TOOL.function.name,
						},
					}),
				});
			} catch (error) {
				clearTimeout(timeoutId);
				if (error instanceof Error && error.name === "AbortError") {
					throw new Error(`${model}: request timed out after ${timeoutMs}ms`);
				}
				throw error;
			}

			if (!response.ok) {
				clearTimeout(timeoutId);
				const text = await response.text();
				const status = response.status;

				if ((status === 429 || status >= 500) && attempt < maxRetries) {
					const delay = BASE_DELAY_MS * 2 ** attempt;
					console.error(`[${model}] HTTP ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
					await sleep(delay);
					continue;
				}

				throw new Error(`${model} API error (${status}): ${text}`);
			}

			clearTimeout(timeoutId);
			const data = (await response.json()) as AnthropicMessagesResponse;

			if (data.error) {
				throw new Error(`${model} error: ${data.error.message}`);
			}

			const reasoningParts: string[] = [];
			let toolUseId: string | undefined;
			let code: string | null = null;

			for (const block of data.content ?? []) {
				if (block.type === "text" && typeof block.text === "string") {
					reasoningParts.push(block.text);
				}
				if (block.type === "thinking" && typeof block.thinking === "string") {
					reasoningParts.push(block.thinking);
				}
				if (
					block.type === "tool_use"
					&& typeof block.id === "string"
					&& block.name === EXECUTE_CODE_TOOL.function.name
				) {
					toolUseId = block.id;
					const input = block.input;
					code = input && typeof input === "object" && "code" in input && typeof input.code === "string"
						? input.code
						: null;
				}
			}

			const reasoning = reasoningParts.join("\n\n");
			const elapsed = Date.now() - t0;
			const outChars = reasoning.length + (code?.length ?? 0);
			console.error(
				`[${model} #${callId}] ${elapsed}ms, in=${inputChars}c, out=${outChars}c, finish=${data.stop_reason}`,
			);

			const result: CallLLMResponse = { reasoning, code };
			if (toolUseId) {
				result.toolUseId = toolUseId;
			}
			return result;
		}

		throw new Error(`${model}: exhausted all retries`);
	};
}
