import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromAnthropic } from "../src/drivers/anthropic.js";
import { fromProviderModel } from "../src/drivers/openrouter-compatible.js";

function mockAnthropicToolUseResponse(options: {
	reasoning?: string;
	code?: string;
	toolUseId?: string;
	stopReason?: string;
}) {
	const content: Array<Record<string, unknown>> = [];
	if (options.reasoning) {
		content.push({ type: "text", text: options.reasoning });
	}
	if (options.code !== undefined) {
		content.push({
			type: "tool_use",
			id: options.toolUseId ?? "toolu_test123",
			name: "execute_code",
			input: { code: options.code },
		});
	}
	return {
		content,
		stop_reason: options.stopReason ?? "tool_use",
	};
}

describe("provider routing", () => {
	let originalFetch: typeof globalThis.fetch;
	let originalAnthropicApiKey: string | undefined;
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
		mockFetch = vi.fn();
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalAnthropicApiKey === undefined) {
			delete process.env.ANTHROPIC_API_KEY;
		} else {
			process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
		}
	});

	function setupMockResponse(body: unknown, status = 200) {
		mockFetch.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
			text: async () => JSON.stringify(body),
		});
	}

	it("Anthropic driver sends Messages API tool payload", async () => {
		setupMockResponse(mockAnthropicToolUseResponse({ code: 'console.log("hello")' }));

		const callLLM = fromAnthropic({
			apiKey: "test-key",
			model: "claude-sonnet-4-6",
		});
		await callLLM([{ role: "user", content: "test" }], "system prompt");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.anthropic.com/v1/messages");

		const body = JSON.parse(init.body);
		expect(body.model).toBe("claude-sonnet-4-6");
		expect(body.system).toBe("system prompt");
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].name).toBe("execute_code");
		expect(body.tools[0].input_schema.properties.code.type).toBe("string");
		expect(body.tool_choice).toEqual({ type: "tool", name: "execute_code" });
	});

	it("Anthropic driver parses text and tool_use blocks", async () => {
		setupMockResponse(mockAnthropicToolUseResponse({
			reasoning: "Let me compute that.",
			code: 'return("done");',
			toolUseId: "toolu_abc123",
		}));

		const callLLM = fromAnthropic({
			apiKey: "test-key",
			model: "claude-sonnet-4-6",
		});
		const result = await callLLM([{ role: "user", content: "Run some code" }], "system");

		expect(result.reasoning).toBe("Let me compute that.");
		expect(result.code).toBe('return("done");');
		expect(result.toolUseId).toBe("toolu_abc123");
	});

	it("fromProviderModel routes anthropic/* through the Anthropic driver", async () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		setupMockResponse(mockAnthropicToolUseResponse({ code: "1+1" }));

		const callLLM = fromProviderModel("anthropic/claude-sonnet-4-6");
		await callLLM([{ role: "user", content: "test" }], "system");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
	});
});
