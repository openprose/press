import { describe, expect, it } from "vitest";
import { buildModelTable, buildSystemPrompt } from "../src/system-prompt.js";

const BASE_OPTS = {
	canDelegate: true,
	invocationId: "root",
	parentId: null,
	depth: 0,
	maxDepth: 3,
	maxIterations: 10,
	lineage: ["test query"],
};

describe("buildSystemPrompt", () => {
	it("4 mandatory XML sections", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("<rlm-preamble>");
		expect(result).toContain("</rlm-preamble>");
		expect(result).toContain("<rlm-environment>");
		expect(result).toContain("</rlm-environment>");
		expect(result).toContain("<rlm-context>");
		expect(result).toContain("</rlm-context>");
		expect(result).toContain("<rlm-rules>");
		expect(result).toContain("</rlm-rules>");
	});

	it("omits <rlm-program> when no programContent", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).not.toContain("<rlm-program>");
		expect(result).not.toContain("</rlm-program>");
	});

	it("<rlm-program> when programContent provided", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, programContent: "## My Plugin\nDo things." });
		expect(result).toContain("<rlm-program>");
		expect(result).toContain("## My Plugin");
		expect(result).toContain("Do things.");
		expect(result).toContain("</rlm-program>");
	});

	it("rlm() docs when canDelegate", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: true });
		expect(result).toContain("await rlm(query, context?, options?)");
		expect(result).toContain("Must be awaited");
	});

	it("no rlm() docs when !canDelegate", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: false });
		expect(result).not.toContain("await rlm(query, context?, options?)");
	});

	it("globalDocs when provided", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, globalDocs: "The `foo` global does X." });
		expect(result).toContain("## Sandbox Globals");
		expect(result).toContain("The `foo` global does X.");
	});

	it("no globalDocs when omitted", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).not.toContain("## Sandbox Globals");
	});

	it("modelTable when canDelegate", () => {
		const table = buildModelTable({ fast: { tags: ["speed"], description: "A fast model" } });
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: true, modelTable: table });
		expect(result).toContain("## Available Models");
		expect(result).toContain("fast");
	});

	it("no modelTable when !canDelegate", () => {
		const table = buildModelTable({ fast: { tags: ["speed"], description: "A fast model" } });
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: false, modelTable: table });
		expect(result).not.toContain("## Available Models");
	});

	it("context: root at depth 0", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("You are the root orchestrator.");
		expect(result).toContain('Agent "root"');
		expect(result).toContain("depth 0 of 3");
	});

	it("context: child at depth > 0", () => {
		const result = buildSystemPrompt({
			...BASE_OPTS,
			invocationId: "d1-c0",
			parentId: "root",
			depth: 1,
		});
		expect(result).toContain('Parent: "root"');
		expect(result).toContain('Agent "d1-c0"');
		expect(result).toContain("depth 1 of 3");
	});

	it("preamble: contracts, state schemas, shape", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("Contracts");
		expect(result).toContain("ensures:");
		expect(result).toContain("State schemas");
		expect(result).toContain("Shape declarations");
		expect(result).toContain("prohibited");
	});

	it("environment: return, console.log, require", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("return(value)");
		expect(result).toContain("console.log()");
		expect(result).toContain("require()");
	});

	it("rules: one block, await, verify", () => {
		const result = buildSystemPrompt(BASE_OPTS);
		expect(result).toContain("One execute_code tool call per response");
		expect(result).toContain("await");
		expect(result).toContain("verifying via");
	});

	it("delegation possible when canDelegate", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: true, depth: 0 });
		expect(result).toContain("You can delegate to child RLMs at depth 1.");
	});

	it("cannot delegate when !canDelegate", () => {
		const result = buildSystemPrompt({ ...BASE_OPTS, canDelegate: false, depth: 3, maxDepth: 3 });
		expect(result).toContain("maximum delegation depth and cannot spawn child agents");
	});

	it("truncates long lineage", () => {
		const longQuery = "x".repeat(300);
		const result = buildSystemPrompt({ ...BASE_OPTS, depth: 1, parentId: "root", lineage: [longQuery, "child query"] });
		expect(result).toContain("...");
		expect(result).not.toContain(longQuery);
	});
});

describe("buildModelTable", () => {
	it("renders markdown table", () => {
		const models = {
			fast: { tags: ["speed", "cheap"], description: "A fast model for simple tasks" },
			smart: { tags: ["reasoning"], description: "A powerful model for complex tasks" },
		};

		const result = buildModelTable(models);

		expect(result).toContain("## Available Models");
		expect(result).toContain("| Alias | Tags | Description |");
		expect(result).toContain("|-------|------|-------------|");
		expect(result).toContain("| fast | speed, cheap | A fast model for simple tasks |");
		expect(result).toContain("| smart | reasoning | A powerful model for complex tasks |");
		expect(result).toContain('{ model: "fast" }');
	});

	it("empty when undefined", () => {
		expect(buildModelTable(undefined)).toBe("");
	});

	it("empty when empty object", () => {
		expect(buildModelTable({})).toBe("");
	});

	it("dash for missing tags/description", () => {
		const models = {
			basic: {},
		};

		const result = buildModelTable(models);

		expect(result).toContain("| basic | - | - |");
	});
});
