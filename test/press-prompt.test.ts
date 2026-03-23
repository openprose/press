import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildPressPrompt,
	buildRuntimeGlossary,
	type FormePromptOptions,
	type ProseVmPromptOptions,
	type ServicePromptOptions,
} from "../src/press-prompt.js";

// ---------------------------------------------------------------------------
// Temp spec directory setup
// ---------------------------------------------------------------------------

let specDir: string;

beforeAll(() => {
	specDir = mkdtempSync(join(tmpdir(), "press-prompt-test-"));
	mkdirSync(join(specDir, "state"), { recursive: true });
	mkdirSync(join(specDir, "primitives"), { recursive: true });

	writeFileSync(join(specDir, "forme.md"), "fake forme spec content");
	writeFileSync(join(specDir, "prose.md"), "fake prose vm spec content");
	writeFileSync(join(specDir, "state", "filesystem.md"), "fake filesystem spec content");
	writeFileSync(join(specDir, "primitives", "session.md"), "fake session spec content");
});

afterAll(() => {
	rmSync(specDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Shared option builders
// ---------------------------------------------------------------------------

function formeOpts(overrides?: Partial<FormePromptOptions>): FormePromptOptions {
	return {
		phase: "forme",
		runId: "run-001",
		runDir: "/tmp/runs/run-001",
		programDir: "/tmp/programs/my-prog",
		specDir,
		entryPoint: "main.md",
		...overrides,
	};
}

function proseVmOpts(overrides?: Partial<ProseVmPromptOptions>): ProseVmPromptOptions {
	return {
		phase: "prose-vm",
		runId: "run-002",
		runDir: "/tmp/runs/run-002",
		specDir,
		manifest: "manifest.json",
		callerInputs: { topic: "testing", lang: "en" },
		...overrides,
	};
}

function serviceOpts(overrides?: Partial<ServicePromptOptions>): ServicePromptOptions {
	return {
		phase: "service",
		runId: "run-003",
		runDir: "/tmp/runs/run-003",
		specDir,
		serviceName: "summarizer",
		serviceDefinition: "You summarize documents.",
		inputs: { doc: "path/to/doc.md", style: "concise" },
		workspace: "/tmp/runs/run-003/workspace/summarizer",
		outputs: ["summary", "keywords"],
		depth: 1,
		parentId: "run-002",
		iterationBudget: 10,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// XML Wrapping
// ---------------------------------------------------------------------------

describe("XML wrapping", () => {
	it("forme phase wraps specs in <forme-spec> and <filesystem-spec>", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("<forme-spec>");
		expect(result).toContain("</forme-spec>");
		expect(result).toContain("<filesystem-spec>");
		expect(result).toContain("</filesystem-spec>");
	});

	it("prose-vm phase wraps specs in <prose-vm-spec>, <session-spec>, <filesystem-spec>", () => {
		const result = buildPressPrompt(proseVmOpts());
		expect(result).toContain("<prose-vm-spec>");
		expect(result).toContain("</prose-vm-spec>");
		expect(result).toContain("<session-spec>");
		expect(result).toContain("</session-spec>");
		expect(result).toContain("<filesystem-spec>");
		expect(result).toContain("</filesystem-spec>");
	});

	it("service phase wraps in <session-spec> and <service-definition>", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).toContain("<session-spec>");
		expect(result).toContain("</session-spec>");
		expect(result).toContain("<service-definition>");
		expect(result).toContain("</service-definition>");
	});

	it("all tags are properly closed", () => {
		const forme = buildPressPrompt(formeOpts());
		const prose = buildPressPrompt(proseVmOpts());
		const service = buildPressPrompt(serviceOpts());

		for (const [result, tags] of [
			[forme, ["forme-spec", "filesystem-spec", "run-context"]],
			[prose, ["prose-vm-spec", "session-spec", "filesystem-spec", "run-context"]],
			[service, ["session-spec", "service-definition"]],
		] as const) {
			for (const tag of tags) {
				expect(result).toContain(`<${tag}>`);
				expect(result).toContain(`</${tag}>`);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Forme Phase Prompt
// ---------------------------------------------------------------------------

describe("Forme phase prompt", () => {
	it("contains the RLM preamble", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("Press");
		expect(result).toContain("REPL loop");
		expect(result).toContain("RETURN()");
	});

	it("contains <run-context> with run ID, program directory, Phase: 1 (Wiring)", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("<run-context>");
		expect(result).toContain("run-001");
		expect(result).toContain("/tmp/programs/my-prog");
		expect(result).toContain("Phase: 1 (Wiring)");
	});

	it("does NOT contain prose-vm-spec or session-spec", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).not.toContain("<prose-vm-spec>");
		expect(result).not.toContain("<session-spec>");
	});
});

// ---------------------------------------------------------------------------
// Prose VM Phase Prompt
// ---------------------------------------------------------------------------

describe("Prose VM phase prompt", () => {
	it("contains <prose-vm-spec>, <session-spec>, and <filesystem-spec>", () => {
		const result = buildPressPrompt(proseVmOpts());
		expect(result).toContain("<prose-vm-spec>");
		expect(result).toContain("<session-spec>");
		expect(result).toContain("<filesystem-spec>");
	});

	it("contains caller inputs in run context", () => {
		const result = buildPressPrompt(proseVmOpts());
		expect(result).toContain("Caller inputs:");
		expect(result).toContain("topic");
		expect(result).toContain("testing");
		expect(result).toContain("lang");
	});

	it("does NOT contain forme-spec", () => {
		const result = buildPressPrompt(proseVmOpts());
		expect(result).not.toContain("<forme-spec>");
	});
});

// ---------------------------------------------------------------------------
// Service Phase Prompt
// ---------------------------------------------------------------------------

describe("Service phase prompt", () => {
	it("contains <service-definition> with the service content", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).toContain("<service-definition>");
		expect(result).toContain("You summarize documents.");
		expect(result).toContain("</service-definition>");
	});

	it("lists context.inputs.* entries for each input", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).toContain("context.inputs.doc");
		expect(result).toContain("context.inputs.style");
	});

	it("lists workspace path", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).toContain("/tmp/runs/run-003/workspace/summarizer");
	});

	it("lists required outputs", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).toContain("summary");
		expect(result).toContain("keywords");
	});

	it("contains child invocation context (depth, parent, budget)", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).toContain("Depth: 1");
		expect(result).toContain("Parent: run-002");
		expect(result).toContain("Iteration budget: 10");
	});

	it("does NOT contain forme-spec or prose-vm-spec", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).not.toContain("<forme-spec>");
		expect(result).not.toContain("<prose-vm-spec>");
	});
});

// ---------------------------------------------------------------------------
// Spec Loading
// ---------------------------------------------------------------------------

describe("Spec loading", () => {
	it("loads spec files from the specDir path", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("fake forme spec content");
		expect(result).toContain("fake filesystem spec content");
	});

	it("throws clear error when spec file is missing", () => {
		const badDir = mkdtempSync(join(tmpdir(), "press-prompt-bad-"));
		try {
			expect(() => buildPressPrompt(formeOpts({ specDir: badDir }))).toThrow(
				/Failed to load spec "forme.md".*file not found/,
			);
		} finally {
			rmSync(badDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Preamble
// ---------------------------------------------------------------------------

describe("Preamble", () => {
	it("mentions press(name, options) as sandbox global", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("press(");
		expect(result).not.toMatch(/`rlm\(\)`/);
	});

	it("mentions RETURN(value), console.log(), context", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("RETURN(");
		expect(result).toContain("console.log()");
		expect(result).toContain("context");
	});

	it("for child invocations: includes depth, parent ID, iteration budget", () => {
		const result = buildPressPrompt(serviceOpts({ depth: 2, parentId: "parent-abc", iterationBudget: 5 }));
		expect(result).toContain("Depth: 2");
		expect(result).toContain("Parent: parent-abc");
		expect(result).toContain("Iteration budget: 5");
	});
});

// ---------------------------------------------------------------------------
// Runtime Glossary
// ---------------------------------------------------------------------------

describe("Runtime glossary", () => {
	it("forme phase prompts contain <press-runtime>", () => {
		const result = buildPressPrompt(formeOpts());
		expect(result).toContain("<press-runtime>");
		expect(result).toContain("</press-runtime>");
	});

	it("prose-vm phase prompts contain <press-runtime>", () => {
		const result = buildPressPrompt(proseVmOpts());
		expect(result).toContain("<press-runtime>");
		expect(result).toContain("</press-runtime>");
	});

	it("service phase prompts do NOT contain <press-runtime>", () => {
		const result = buildPressPrompt(serviceOpts());
		expect(result).not.toContain("<press-runtime>");
	});

	it("glossary contains key mappings: Task tool, press(), Promise.all, AskUserQuestion", () => {
		const glossary = buildRuntimeGlossary();
		expect(glossary).toContain("Task tool");
		expect(glossary).toContain("press(");
		expect(glossary).toContain("Promise.all");
		expect(glossary).toContain("AskUserQuestion");
	});
});
