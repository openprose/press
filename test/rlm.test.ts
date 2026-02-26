import { describe, expect, it } from "vitest";
import { type CallLLM, type CallLLMResponse, rlm } from "../src/rlm.js";

function mockToolCallLLM(responses: CallLLMResponse[]): CallLLM {
	let callIndex = 0;
	return async (_messages, _systemPrompt) => {
		if (callIndex >= responses.length) {
			throw new Error(`Unexpected call #${callIndex + 1}, only ${responses.length} responses defined`);
		}
		return responses[callIndex++];
	};
}

function tc(code: string, toolUseId = "t"): CallLLMResponse {
	return { reasoning: "", code, toolUseId };
}

describe("rlm", () => {
	it("simple return", async () => {
		const callLLM = mockToolCallLLM([tc('return "hello"', "t1"), tc('return "hello"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("hello");
		expect(result.iterations).toBe(2);
	});

	it("multi-iteration", async () => {
		const callLLM = mockToolCallLLM([tc('console.log("thinking...")', "t1"), tc('return "done"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("done");
		expect(result.iterations).toBe(2);
	});

	it("no-code turn followed by code", async () => {
		const callLLM = mockToolCallLLM([
			{ reasoning: "Let me think about this...", code: null, toolUseId: "t1" },
			tc('return "answer"', "t2"),
		]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("answer");
		expect(result.iterations).toBe(2);
	});

	it("error recovery", async () => {
		const callLLM = mockToolCallLLM([tc('throw new Error("oops")', "t1"), tc('return "recovered"', "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("recovered");
		expect(result.iterations).toBe(2);
	});

	it("max iterations throws", async () => {
		const callLLM = mockToolCallLLM([
			tc('console.log("loop 1")', "t1"),
			tc('console.log("loop 2")', "t2"),
			tc('console.log("loop 3")', "t3"),
		]);
		await expect(rlm("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
	});

	it("context accessible as variable", async () => {
		const callLLM = mockToolCallLLM([tc("return context", "t1"), tc("return context", "t2")]);
		const result = await rlm("test query", "my context data", { callLLM });
		expect(result.answer).toBe("my context data");
	});

	it("return stringifies non-strings", async () => {
		const callLLM = mockToolCallLLM([tc("return 42", "t1"), tc("return 42", "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
	});

	it("bare assignment persists across iterations", async () => {
		const callLLM = mockToolCallLLM([tc("x = 42", "t1"), tc("return x", "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("rlm(): child returns to parent", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'result = await rlm("child query")\nreturn result', toolUseId: "tp" };
		};

		const result = await rlm("parent query", undefined, { callLLM });
		expect(result.answer).toBe("child answer");
	});

	it("child at max depth: REPL without delegation", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";

			if (userMsg === "parent query") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		const result = await rlm("parent query", undefined, { callLLM, maxDepth: 1 });
		expect(result.answer).toBe("child answer");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("console.log");
		expect(childPrompt).toContain("return(value)");
		expect(childPrompt).toContain("maximum delegation depth");
	});

	it("rlm() at max depth rejects", async () => {
		const callLLM: CallLLM = async (messages) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent query") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'const r = await rlm("grandchild")\nreturn r', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		// maxDepth=1: root(0) can delegate, child(1) cannot
		await expect(rlm("parent query", undefined, {
			callLLM,
			maxDepth: 1,
			maxIterations: 2,
		})).rejects.toThrow("max iterations");
	});

	it("let/const persists across iterations", async () => {
		const callLLM = mockToolCallLLM([tc("let x = 42", "t1"), tc("return x", "t2")]);
		const result = await rlm("test query", undefined, { callLLM });
		expect(result.answer).toBe("42");
		expect(result.iterations).toBe(2);
	});

	it("output fed back as tool result", async () => {
		let secondCallMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'console.log("hello world")', toolUseId: "t1" };
			}
			secondCallMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};

		await rlm("test query", undefined, { callLLM });

		expect(secondCallMessages).toBeDefined();
		const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
		expect(lastMsg.content).toContain("hello world");
		expect(lastMsg.role).toBe("user");
	});

	it("__rlm: root depth 0, correct lineage", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'console.log(JSON.stringify(__rlm))', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};

		await rlm("my query", undefined, {
			callLLM,
			maxDepth: 3,
			maxIterations: 10,
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		const parsed = JSON.parse(toolResult!.content.split("\n").find((l) => l.startsWith("{"))!);
		expect(parsed.depth).toBe(0);
		expect(parsed.maxDepth).toBe(3);
		expect(parsed.maxIterations).toBe(10);
		expect(parsed.lineage).toEqual(["my query"]);
	});

	it("__rlm: child depth 1, parent in lineage", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'console.log(JSON.stringify(__rlm))\nreturn "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		const result = await rlm("parent task", undefined, { callLLM, maxDepth: 3 });

		expect(result.answer).toBe("child done");
	});

	it("__rlm: iteration increments", async () => {
		let lastMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			lastMessages = [...messages];
			if (callIndex <= 2) {
				return { reasoning: "", code: 'console.log("iter=" + __rlm.iteration)', toolUseId: `t${callIndex}` };
			}
			return { reasoning: "", code: 'console.log("iter=" + __rlm.iteration)\nreturn "done"', toolUseId: `t${callIndex}` };
		};

		await rlm("test", undefined, { callLLM });
		const allOutput = lastMessages!
			.filter(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"))
			.map(m => m.content)
			.join("\n");
		const iters = allOutput.match(/iter=(\d+)/g)!.map((m) => Number(m.split("=")[1]));
		expect(iters).toEqual([0, 1]);
	});

	it("__rlm: frozen", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: '__rlm.depth = 99\nconsole.log("depth=" + __rlm.depth)', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};
		await rlm("test", undefined, { callLLM });
		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		// In sloppy mode, assignment silently fails; depth stays 0
		expect(toolResult!.content).toContain("depth=0");
	});

	it("__rlm: lineage frozen", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'try { __rlm.lineage.push("hacked") } catch(e) { console.log("lineage frozen: " + e.message) }', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "done"', toolUseId: "t2" };
		};
		await rlm("test", undefined, { callLLM });
		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("lineage frozen:");
	});

	it("context: child isolation", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child query") {
				return { reasoning: "", code: 'console.log("child sees: " + context)\nreturn context', toolUseId: "tc" };
			}
			// Parent: first call spawns child with different context, second verifies parent context
			if (messages.length <= 1) {
				return { reasoning: "", code: 'const childResult = await rlm("child query", "child context")\nconsole.log("parent still sees: " + context)', toolUseId: "tp1" };
			}
			return { reasoning: "", code: "return context", toolUseId: "tp2" };
		};

		const result = await rlm("parent query", "parent context", { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("parent context");
	});

	it("unawaited rlm() auto-awaited", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "fire and forget") {
				return { reasoning: "", code: 'return "child"', toolUseId: "tc" };
			}
			if (messages.length <= 1) {
				return { reasoning: "", code: 'rlm("fire and forget")\nconsole.log("continued")', toolUseId: "tp1" };
			}
			const lastMsg = messages[messages.length - 1]?.content || "";
			if (lastMsg.includes("ERROR")) {
				return { reasoning: "", code: 'return "saw warning"', toolUseId: "tp2" };
			}
			return { reasoning: "", code: 'return "no warning"', toolUseId: "tp3" };
		};

		const result = await rlm("test", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("no warning");
	});

	it("parallel rlm() via Promise.all", async () => {
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "task A") {
				return { reasoning: "", code: 'return "result A"', toolUseId: "ta" };
			}
			if (userMsg === "task B") {
				return { reasoning: "", code: 'return "result B"', toolUseId: "tb" };
			}
			return { reasoning: "", code: 'const [a, b] = await Promise.all([rlm("task A"), rlm("task B")])\nreturn a + " + " + b', toolUseId: "tp" };
		};

		const result = await rlm("parent", undefined, { callLLM, maxDepth: 3 });
		expect(result.answer).toBe("result A + result B");
	});

	it("pluginBodies: in root prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, {
			callLLM,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(capturedSystemPrompt).toContain("## My Plugin");
		expect(capturedSystemPrompt).toContain("Do special things.");
	});

	it("pluginBodies: absent when undefined", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("<rlm-program>");
	});

	it("pluginBodies: not in child prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).not.toContain("## My Plugin");
		expect(childPrompt).not.toContain("Do special things.");
	});

	it("pluginBodies: not in max-depth child", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent task") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			pluginBodies: "## My Plugin\nDo special things.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).not.toContain("## My Plugin");
		expect(childPrompt).not.toContain("Do special things.");
	});

	it("model selection: child uses specified model", async () => {
		let fastModelCalled = false;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "hello") {
				return { reasoning: "", code: 'return "FAST_MODEL response"', toolUseId: "td" };
			}
			return { reasoning: "", code: 'result = await rlm("hello", undefined, { model: "fast" })\nreturn result', toolUseId: "tp" };
		};

		const fastCallLLM: CallLLM = async (_messages, _systemPrompt) => {
			fastModelCalled = true;
			return { reasoning: "", code: 'return "FAST_MODEL response"', toolUseId: "tf" };
		};

		const result = await rlm("parent query", undefined, {
			callLLM: defaultCallLLM,
			maxDepth: 3,
			models: {
				fast: { callLLM: fastCallLLM, tags: ["speed"], description: "A fast model" },
			},
		});

		expect(fastModelCalled).toBe(true);
		expect(result.answer).toBe("FAST_MODEL response");
	});

	it("model selection: invalid alias errors", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const defaultCallLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'result = await rlm("hello", undefined, { model: "nonexistent" })\nreturn result', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		await rlm("test", undefined, {
			callLLM: defaultCallLLM,
			maxDepth: 3,
			models: {
				fast: { callLLM: defaultCallLLM },
			},
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("Unknown model alias");
	});

	it("sandboxGlobals: accessible from agent code", async () => {
		const mockObj = { greet: (name: string) => "hello " + name };
		const callLLM = mockToolCallLLM([
			tc('return myApi.greet("world")', "t1"),
			tc('return myApi.greet("world")', "t2"),
		]);
		const result = await rlm("test query", undefined, {
			callLLM,
			sandboxGlobals: { myApi: mockObj },
		});
		expect(result.answer).toBe("hello world");
	});

	it("globalDocs: in root prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, {
			callLLM,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(capturedSystemPrompt).toContain("## Sandbox Globals");
		expect(capturedSystemPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: in child prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		expect(systemPrompts[1]).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: in child prompt with customSystemPrompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { systemPrompt: "You are a helper." })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a helper.");
		expect(childPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs: in max-depth child prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "parent task") {
				return { reasoning: "", code: 'const r = await rlm("sub query")\nreturn r', toolUseId: "tp" };
			}
			if (userMsg === "sub query") {
				return { reasoning: "", code: 'return "child answer"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'return "unexpected"', toolUseId: "tx" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 1,
			globalDocs: "The `myApi` global provides X and Y.",
		});

		expect(systemPrompts[0]).toContain("The `myApi` global provides X and Y.");
		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("The `myApi` global provides X and Y.");
	});

	it("globalDocs + sandboxGlobals: child uses documented global", async () => {
		const mockApi = { greet: (name: string) => "hello " + name };
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			const userMsg = messages[0]?.content || "";
			if (userMsg === "greet world") {
				// Child agent -- verify globalDocs is in prompt and use the global
				if (!systemPrompt.includes("myApi.greet")) {
					return { reasoning: "", code: 'return "FAIL: no globalDocs"', toolUseId: "tc" };
				}
				return { reasoning: "", code: 'return myApi.greet("world")', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("greet world")\nreturn r', toolUseId: "tp" };
		};

		const result = await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			sandboxGlobals: { myApi: mockApi },
			globalDocs: "`myApi.greet(name)` -- returns a greeting string.",
		});

		expect(result.answer).toBe("hello world");
	});

	it("globalDocs: absent when not provided", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, { callLLM });

		expect(capturedSystemPrompt).not.toContain("## Sandbox Globals");
	});

	it("use: child receives component prompt", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { use: "test-component" })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-component": "You are a test component.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test component.");
		expect(childPrompt).toContain("Do test things.");
		expect(childPrompt).toContain("<rlm-environment>");
	});

	it("app: child receives component prompt (backwards compat)", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { app: "test-app" })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-app": "You are a test app.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test app.");
		expect(childPrompt).toContain("Do test things.");
		expect(childPrompt).toContain("<rlm-environment>");
	});

	it("use: unknown name errors with list", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'const r = await rlm("child task", undefined, { use: "nonexistent" })\nreturn r', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		await rlm("test", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-component": "body1", "other-component": "body2" },
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("Unknown component");
		expect(toolResult!.content).toContain("test-component");
		expect(toolResult!.content).toContain("other-component");
	});

	it("app: unknown name errors with list (backwards compat)", async () => {
		let capturedMessages: Array<{ role: string; content: string }> | undefined;
		let callIndex = 0;
		const callLLM: CallLLM = async (messages, _systemPrompt) => {
			callIndex++;
			if (callIndex === 1) {
				return { reasoning: "", code: 'const r = await rlm("child task", undefined, { app: "nonexistent" })\nreturn r', toolUseId: "t1" };
			}
			capturedMessages = [...messages];
			return { reasoning: "", code: 'return "saw error"', toolUseId: "t2" };
		};

		await rlm("test", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-app": "body1", "other-app": "body2" },
		});

		const toolResult = capturedMessages!.find(m => m.role === "user" && m.content.includes("__TOOL_RESULT__"));
		expect(toolResult!.content).toContain("Unknown component");
		expect(toolResult!.content).toContain("test-app");
		expect(toolResult!.content).toContain("other-app");
	});

	it("use + systemPrompt concatenated", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { use: "test-component", systemPrompt: "Extra instructions." })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "test-component": "You are a test component.\n\nDo test things." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("You are a test component.");
		expect(childPrompt).toContain("Do test things.");
		expect(childPrompt).toContain("Extra instructions.");
	});

	it("use wins over app when both provided", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { use: "correct-component", app: "wrong-component" })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childComponents: { "correct-component": "Correct body.", "wrong-component": "Wrong body." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("Correct body.");
		expect(childPrompt).not.toContain("Wrong body.");
	});

	it("childApps backwards compat: populates childComponents", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task", undefined, { use: "legacy-app" })\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			childApps: { "legacy-app": "Legacy body." },
		});

		const childPrompt = systemPrompts[1];
		expect(childPrompt).toContain("Legacy body.");
	});

	it("childComponents: not in root prompt", async () => {
		let capturedSystemPrompt = "";
		const callLLM: CallLLM = async (_messages, systemPrompt) => {
			capturedSystemPrompt = systemPrompt;
			return { reasoning: "", code: 'return "done"', toolUseId: "t" };
		};

		await rlm("test", undefined, {
			callLLM,
			childComponents: { "test-component": "You are a test component.\n\nDo test things." },
		});

		expect(capturedSystemPrompt).not.toContain("You are a test component.");
		expect(capturedSystemPrompt).not.toContain("Do test things.");
	});

	it("pluginBodies root-only, globalDocs everywhere", async () => {
		const systemPrompts: string[] = [];
		const callLLM: CallLLM = async (messages, systemPrompt) => {
			systemPrompts.push(systemPrompt);
			const userMsg = messages[0]?.content || "";
			if (userMsg === "child task") {
				return { reasoning: "", code: 'return "child done"', toolUseId: "tc" };
			}
			return { reasoning: "", code: 'const r = await rlm("child task")\nreturn r', toolUseId: "tp" };
		};

		await rlm("parent task", undefined, {
			callLLM,
			maxDepth: 3,
			pluginBodies: "## My Plugin\nRoot-only strategy.",
			globalDocs: "The `myApi` global provides X.",
		});

		expect(systemPrompts[0]).toContain("## My Plugin");
		expect(systemPrompts[0]).toContain("The `myApi` global provides X.");

		expect(systemPrompts[1]).not.toContain("## My Plugin");
		expect(systemPrompts[1]).toContain("The `myApi` global provides X.");
	});

	describe("tool-call specifics", () => {
		it("null code triggers warning", async () => {
			let secondCallMessages: Array<{ role: string; content: string }> | undefined;
			let callIndex = 0;
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "Let me think about this.", code: null, toolUseId: "t1" };
				}
				secondCallMessages = [...messages];
				return { reasoning: "Now returning.", code: 'return "done"', toolUseId: "t2" };
			};

			await rlm("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const lastMsg = secondCallMessages![secondCallMessages!.length - 1];
			expect(lastMsg.content).toContain("[WARNING] No code was executed");
		});

		it("__TOOL_CALL__ / __TOOL_RESULT__ markers", async () => {
			let secondCallMessages: Array<{ role: string; content: string }> | undefined;
			let callIndex = 0;
			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "Step one.", code: 'console.log("hello")', toolUseId: "tool-123" };
				}
				secondCallMessages = [...messages];
				return { reasoning: "Done.", code: 'return "done"', toolUseId: "tool-456" };
			};

			await rlm("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const assistantMsg = secondCallMessages!.find(m => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"));
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.content).toContain("tool-123");
			expect(assistantMsg!.content).toContain("Step one.");
			expect(assistantMsg!.content).toContain("__CODE__");
			expect(assistantMsg!.content).toContain('console.log("hello")');

			const toolResultMsg = secondCallMessages!.find(m => m.role === "user" && m.content.startsWith("__TOOL_RESULT__"));
			expect(toolResultMsg).toBeDefined();
			expect(toolResultMsg!.content).toContain("tool-123");
			expect(toolResultMsg!.content).toContain("hello");
		});

		it("max iterations throws", async () => {
			const callLLM = mockToolCallLLM([
				{ reasoning: "Step 1.", code: 'console.log("loop 1")', toolUseId: "t1" },
				{ reasoning: "Step 2.", code: 'console.log("loop 2")', toolUseId: "t2" },
				{ reasoning: "Step 3.", code: 'console.log("loop 3")', toolUseId: "t3" },
			]);
			await expect(rlm("test query", undefined, { callLLM, maxIterations: 3 })).rejects.toThrow("max iterations");
		});
	});

	describe("reasoning details round-trip", () => {
		it("reasoningDetails round-trip", async () => {
			const mockDetails = [
				{ type: "reasoning.text", id: "rd_abc123", format: "anthropic-claude-v1", index: 0, text: "I'm thinking about this..." },
			];
			let secondCallMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }> | undefined;
			let callIndex = 0;

			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return {
						reasoning: "I'm thinking about this...",
						code: 'console.log("step 1")',
						toolUseId: "t1",
						reasoningDetails: mockDetails,
					};
				}
				secondCallMessages = [...messages];
				return { reasoning: "Done.", code: 'return "done"', toolUseId: "t2" };
			};

			await rlm("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			// Find the assistant message with __TOOL_CALL__ marker
			const assistantMsg = secondCallMessages!.find(
				(m) => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"),
			);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.meta).toBeDefined();
			expect(assistantMsg!.meta!.reasoningDetails).toEqual(mockDetails);
		});

		it("no reasoningDetails: no meta", async () => {
			let secondCallMessages: Array<{ role: string; content: string; meta?: Record<string, unknown> }> | undefined;
			let callIndex = 0;

			const callLLM: CallLLM = async (messages, _systemPrompt) => {
				callIndex++;
				if (callIndex === 1) {
					return { reasoning: "Step one.", code: 'console.log("hello")', toolUseId: "t1" };
				}
				secondCallMessages = [...messages];
				return { reasoning: "Done.", code: 'return "done"', toolUseId: "t2" };
			};

			await rlm("test query", undefined, { callLLM });

			expect(secondCallMessages).toBeDefined();
			const assistantMsg = secondCallMessages!.find(
				(m) => m.role === "assistant" && m.content.startsWith("__TOOL_CALL__"),
			);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg!.meta).toBeUndefined();
		});
	});
});
