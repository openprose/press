import { describe, expect, it } from "vitest";
import type { CallLLM, CallLLMResponse } from "../src/rlm.js";
import { press } from "../src/rlm.js";
import type { PressEvent, PressEventSink, LlmResponseEvent } from "../src/events.js";
import { PressObserver } from "../src/observer.js";

function mockCallLLMWithUsage(responses: CallLLMResponse[]): CallLLM {
	let callIndex = 0;
	return async () => {
		if (callIndex >= responses.length) {
			throw new Error(`Unexpected call #${callIndex + 1}`);
		}
		return responses[callIndex++];
	};
}

function extractTokens(events: PressEvent[]): { inputTokens: number; cachedInputTokens: number; outputTokens: number } {
	let inputTokens = 0;
	let cachedInputTokens = 0;
	let outputTokens = 0;

	for (const e of events) {
		if (e.type === "llm:response" && e.usage) {
			inputTokens += e.usage.promptTokens ?? 0;
			cachedInputTokens += e.usage.cacheReadTokens ?? 0;
			outputTokens += e.usage.completionTokens ?? 0;
		}
	}

	return { inputTokens, cachedInputTokens, outputTokens };
}

describe("token tracking", () => {
	it("press() emits llm:response events with usage data", async () => {
		const observer = new PressObserver();
		const callLLM = mockCallLLMWithUsage([
			{
				reasoning: "",
				code: 'console.log("step 1")',
				toolUseId: "t1",
				usage: { promptTokens: 100, completionTokens: 50, cacheReadTokens: 20 },
			},
			{
				reasoning: "",
				code: 'return("done")',
				toolUseId: "t2",
				usage: { promptTokens: 200, completionTokens: 80, cacheReadTokens: 40 },
			},
		]);

		const result = await press("test query", undefined, {
			callLLM,
			observer,
		});

		expect(result.answer).toBe("done");

		const llmResponses = observer.getEvents({ type: "llm:response" }) as LlmResponseEvent[];
		expect(llmResponses.length).toBeGreaterThanOrEqual(2);

		// First response should carry usage
		expect(llmResponses[0].usage).toBeDefined();
		expect(llmResponses[0].usage!.promptTokens).toBe(100);
		expect(llmResponses[0].usage!.completionTokens).toBe(50);
		expect(llmResponses[0].usage!.cacheReadTokens).toBe(20);

		// Second response should carry usage
		expect(llmResponses[1].usage).toBeDefined();
		expect(llmResponses[1].usage!.promptTokens).toBe(200);
		expect(llmResponses[1].usage!.completionTokens).toBe(80);
	});

	it("extractTokens correctly sums token usage from events", async () => {
		const observer = new PressObserver();
		const callLLM = mockCallLLMWithUsage([
			{
				reasoning: "",
				code: 'console.log("a")',
				toolUseId: "t1",
				usage: { promptTokens: 100, completionTokens: 50, cacheReadTokens: 10 },
			},
			{
				reasoning: "",
				code: 'return("done")',
				toolUseId: "t2",
				usage: { promptTokens: 200, completionTokens: 80, cacheReadTokens: 30 },
			},
		]);

		await press("test", undefined, { callLLM, observer });

		const events = observer.getEvents();
		const cost = extractTokens(events);

		expect(cost.inputTokens).toBe(300);
		expect(cost.outputTokens).toBe(130);
		expect(cost.cachedInputTokens).toBe(40);
	});

	it("extractTokens returns zero when usage is missing", async () => {
		const observer = new PressObserver();
		const callLLM = mockCallLLMWithUsage([
			{ reasoning: "", code: 'return("done")', toolUseId: "t1" },
			{ reasoning: "", code: 'return("done")', toolUseId: "t2" },
		]);

		await press("test", undefined, { callLLM, observer });

		const events = observer.getEvents();
		const cost = extractTokens(events);

		expect(cost.inputTokens).toBe(0);
		expect(cost.outputTokens).toBe(0);
		expect(cost.cachedInputTokens).toBe(0);
	});
});
