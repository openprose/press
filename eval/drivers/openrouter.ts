/**
 * Thin wrapper over fromOpenRouterCompatible that hardcodes the OpenRouter
 * base URL. Kept as a separate module so eval/run.ts and tests can import a
 * concise factory without repeating the base URL, and so tests can mock fetch
 * against a stable import path (see test/eval-openrouter-routing.test.ts).
 */
import type { CallLLM } from "../../src/rlm.js";
import { fromOpenRouterCompatible } from "../../src/drivers/openrouter-compatible.js";

export function fromOpenRouter(model: string, apiKey: string, opts?: { maxTokens?: number; timeoutMs?: number; reasoningEffort?: string }): CallLLM {
	return fromOpenRouterCompatible({
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey,
		model,
		maxTokens: opts?.maxTokens,
		timeoutMs: opts?.timeoutMs,
		reasoningEffort: opts?.reasoningEffort,
	});
}
