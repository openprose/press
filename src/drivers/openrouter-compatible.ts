// OpenAI chat-completions driver (tool-call mode).

import type { CallLLM, CallLLMOptions, CallLLMResponse } from "../rlm.js";
import { EXECUTE_CODE_TOOL, TOOL_CHOICE } from "../system-prompt.js";

interface ChatMessage {
	role: string;
	content: string | null;
	reasoning?: string | null;
	reasoning_details?: Array<Record<string, unknown>> | null;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

interface ChatCompletionResponse {
	choices: Array<{
		message: {
			content: string | null;
			reasoning?: string | null;
			reasoning_details?: Array<Record<string, unknown>> | null;
			tool_calls?: Array<{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}>;
		};
		finish_reason?: string;
		native_finish_reason?: string;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
	error?: { message: string; code?: number };
}

export interface OpenRouterCompatibleOptions {
	/** e.g. "https://openrouter.ai/api/v1", "https://api.openai.com/v1" */
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutMs?: number;
	maxRetries?: number;
	maxTokens?: number;
	reasoningEffort?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 16384;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate the engine's flat message array into OpenAI chat completions format.
 * Recognizes __TOOL_CALL__ / __TOOL_RESULT__ markers to reconstruct tool_calls
 * and tool-role messages.
 */
export function translateMessages(
	engineMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }>,
): ChatMessage[] {
	const result: ChatMessage[] = [];

	for (const msg of engineMessages) {
		if (msg.role === "assistant" && msg.content.startsWith("__TOOL_CALL__\n")) {
			// Reconstruct assistant message with content + tool_calls
			const parts = msg.content.split("\n__CODE__\n");
			const header = parts[0]; // "__TOOL_CALL__\n<id>\n<reasoning>"
			const code = parts[1] ?? "";
			const headerLines = header.split("\n");
			const toolUseId = headerLines[1];
			const reasoning = headerLines.slice(2).join("\n");

			const chatMsg: ChatMessage = {
				role: "assistant",
				content: reasoning || null,
				tool_calls: [{
					id: toolUseId,
					type: "function",
					function: {
						name: "execute_code",
						arguments: JSON.stringify({ code }),
					},
				}],
			};

			// Attach reasoning details for round-trip if present
			if (msg.meta?.reasoningDetails) {
				chatMsg.reasoning_details = msg.meta.reasoningDetails as Array<Record<string, unknown>>;
			}

			result.push(chatMsg);
		} else if (msg.role === "user" && msg.content.startsWith("__TOOL_RESULT__\n")) {
			// Reconstruct tool result message
			const lines = msg.content.split("\n");
			const toolUseId = lines[1];
			const content = lines.slice(2).join("\n");

			result.push({
				role: "tool",
				content,
				tool_call_id: toolUseId,
			});
		} else {
			// Plain text message (initial user query)
			result.push({ role: msg.role, content: msg.content });
		}
	}

	return result;
}

export function fromOpenRouterCompatible(options: OpenRouterCompatibleOptions): CallLLM {
	const {
		baseUrl,
		apiKey,
		model,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxRetries = DEFAULT_MAX_RETRIES,
		maxTokens = DEFAULT_MAX_TOKENS,
		reasoningEffort: defaultReasoningEffort,
	} = options;

	const base = baseUrl.replace(/\/+$/, "");
	const endpoint = `${base}/chat/completions`;

	let callCount = 0;

	return async (messages, systemPrompt, callOptions?: CallLLMOptions) => {
		const chatMessages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...translateMessages(messages),
		];
		const callId = ++callCount;
		const inputChars = chatMessages.reduce((n, m) => n + (m.content?.length ?? 0), 0);

		// Per-call reasoning effort overrides the default from options
		const effort = callOptions?.reasoningEffort ?? defaultReasoningEffort;

		const useReasoning = !!(effort && effort !== "none");

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const t0 = Date.now();

			const reqBody: Record<string, unknown> = {
				model,
				messages: chatMessages,
				max_tokens: maxTokens,
				tools: [EXECUTE_CODE_TOOL],
				// Anthropic extended thinking is incompatible with forced tool_choice.
				// When reasoning is enabled, fall back to "auto" so the API accepts it.
				tool_choice: useReasoning ? "auto" : TOOL_CHOICE,
				parallel_tool_calls: false,
			};

			// Add reasoning tokens request if effort is specified.
			// Always include `enabled: true` — required by Claude 4.6+ adaptive thinking.
			// The `effort` field is additive for models that support it; ignored by others.
			if (useReasoning) {
				reqBody.reasoning = { enabled: true, effort };
			}

			const abortController = new AbortController();
			const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

			let response: Response;
			try {
				response = await fetch(endpoint, {
					signal: abortController.signal,
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(reqBody),
				});
			} catch (err) {
				clearTimeout(timeoutId);
				if (err instanceof Error && err.name === "AbortError") {
					throw new Error(`${model}: request timed out after ${timeoutMs}ms`);
				}
				throw err;
			}

			if (!response.ok) {
				clearTimeout(timeoutId);
				const text = await response.text();
				const status = response.status;

				if ((status === 429 || status >= 500) && attempt < maxRetries) {
					const delay = BASE_DELAY_MS * 2 ** attempt;
					if (process.env.PRESS_DEBUG) console.error(`[${model}] HTTP ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
					await sleep(delay);
					continue;
				}

				throw new Error(`${model} API error (${status}): ${text}`);
			}

			clearTimeout(timeoutId);
			const data = (await response.json()) as ChatCompletionResponse;

			if (data.error) {
				const code = data.error.code ?? 0;
				if ((code === 429 || code >= 500) && attempt < maxRetries) {
					const delay = BASE_DELAY_MS * 2 ** attempt;
					if (process.env.PRESS_DEBUG) console.error(`[${model}] error ${code}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
					await sleep(delay);
					continue;
				}
				throw new Error(`${model} error: ${data.error.message}`);
			}

			if (!data.choices || data.choices.length === 0) {
				throw new Error(`${model} returned no choices`);
			}

			const choice = data.choices[0];
			const reasoning = choice.message.reasoning
				?? choice.message.content
				?? "";
			const reasoningDetails = choice.message.reasoning_details ?? null;
			let code: string | null = null;
			let toolUseId: string | null = null;

			const toolCall = choice.message.tool_calls?.[0];
			if (toolCall && toolCall.function.name === "execute_code") {
				toolUseId = toolCall.id;
				try {
					const args = JSON.parse(toolCall.function.arguments);
					code = args.code ?? null;
				} catch {
					code = null;
				}
			}

			const elapsed = Date.now() - t0;
			const outChars = reasoning.length + (code?.length ?? 0);
			if (process.env.PRESS_DEBUG) console.error(
				`[${model} #${callId}] ${elapsed}ms, in=${inputChars}c, out=${outChars}c, finish=${choice.finish_reason}`,
			);

			const result: CallLLMResponse = { reasoning, code };
			if (toolUseId) {
				result.toolUseId = toolUseId;
			}
			if (reasoningDetails) {
				result.reasoningDetails = reasoningDetails;
			}
			if (data.usage) {
				result.usage = {
					promptTokens: data.usage.prompt_tokens ?? 0,
					completionTokens: data.usage.completion_tokens ?? 0,
					cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
					cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
				};
			}
			return result;
		}

		throw new Error(`${model}: exhausted all retries`);
	};
}

interface ProviderConfig {
	baseUrl: string;
	envVar: string;
}

const KNOWN_PROVIDERS: Record<string, ProviderConfig> = {
	openrouter: {
		baseUrl: "https://openrouter.ai/api/v1",
		envVar: "OPENROUTER_API_KEY",
	},
	openai: {
		baseUrl: "https://api.openai.com/v1",
		envVar: "OPENAI_API_KEY",
	},
};

export function fromProviderModel(
	providerSlashModel: string,
	options?: { apiKey?: string; baseUrl?: string; timeoutMs?: number; reasoningEffort?: string },
): CallLLM {
	const slashIdx = providerSlashModel.indexOf("/");
	if (slashIdx === -1) {
		throw new Error(
			`fromProviderModel: expected "provider/model" format, got "${providerSlashModel}"`,
		);
	}

	const provider = providerSlashModel.slice(0, slashIdx);
	const model = providerSlashModel.slice(slashIdx + 1);

	if (!model) {
		throw new Error(
			`fromProviderModel: empty model in "${providerSlashModel}"`,
		);
	}

	const known = KNOWN_PROVIDERS[provider];

	let baseUrl: string;
	let apiKey: string;

	if (known) {
		baseUrl = options?.baseUrl ?? known.baseUrl;
		apiKey = options?.apiKey ?? process.env[known.envVar] ?? "";
		if (!apiKey) {
			throw new Error(
				`fromProviderModel: no API key for provider "${provider}". ` +
				`Set ${known.envVar} or pass options.apiKey.`,
			);
		}
	} else {
		baseUrl = options?.baseUrl ?? "";
		apiKey = options?.apiKey ?? "";
		if (!baseUrl || !apiKey) {
			throw new Error(
				`fromProviderModel: unknown provider "${provider}". ` +
				`You must pass both options.baseUrl and options.apiKey.`,
			);
		}
	}

	return fromOpenRouterCompatible({
		baseUrl,
		apiKey,
		model,
		timeoutMs: options?.timeoutMs,
		reasoningEffort: options?.reasoningEffort,
	});
}
