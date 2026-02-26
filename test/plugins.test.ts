import { describe, expect, it } from "vitest";
import { parseFrontmatter, loadPlugins, loadProfile, detectProfile, loadStack } from "../src/plugins.js";

describe("parseFrontmatter", () => {
	it("extracts frontmatter and body", () => {
		const content = `---
name: test-plugin
kind: driver
version: 0.1.0
description: A test plugin
tags: [foo, bar]
---

## Body Content

This is the body.`;

		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter.name).toBe("test-plugin");
		expect(frontmatter.kind).toBe("driver");
		expect(frontmatter.version).toBe("0.1.0");
		expect(frontmatter.description).toBe("A test plugin");
		expect(frontmatter.tags).toEqual(["foo", "bar"]);
		expect(body).toContain("## Body Content");
		expect(body).toContain("This is the body.");
	});

	it("no frontmatter", () => {
		const content = "# Just a heading\n\nSome text.";
		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter).toEqual({});
		expect(body).toBe(content);
	});

	it("block-style YAML arrays", () => {
		const content = `---
name: test-profile
drivers:
  - driver-a
  - driver-b
  - driver-c
---

Body text.`;

		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.drivers).toEqual(["driver-a", "driver-b", "driver-c"]);
	});

	it("inline JSON arrays", () => {
		const content = `---
name: test
models: ["google/gemini*", "google/gemini-flash*"]
---

Body.`;

		const { frontmatter } = parseFrontmatter(content);
		expect(frontmatter.models).toEqual(["google/gemini*", "google/gemini-flash*"]);
	});
});

describe("loadPlugins", () => {
	it("loads and concatenates drivers", async () => {
		const result = await loadPlugins(["await-discipline", "return-format-discipline"], "drivers");
		expect(result).toContain("## Await Discipline");
		expect(result).toContain("## Return Format");
		expect(result).not.toContain("name: await-discipline");
		expect(result).not.toContain("kind: driver");
		expect(result).toContain("\n\n---\n\n");
	});

	it("loads apps", async () => {
		const result = await loadPlugins(["structured-data-aggregation"], "apps");
		expect(result).toContain("## Aggregation Protocol");
		expect(result).not.toContain("name: structured-data-aggregation");
		expect(result).not.toContain("kind: app");
	});
});

describe("loadProfile", () => {
	it("loads profile with drivers and model globs", async () => {
		const profile = await loadProfile("gemini-3-flash");
		expect(profile.drivers).toEqual([
			"await-discipline",
			"return-format-discipline",
			"verify-before-return",
		]);
		expect(profile.models).toEqual([
			"google/gemini-3-flash*",
			"google/gemini-3-flash-preview*",
		]);
	});
});

describe("detectProfile", () => {
	it("matches model to profile", async () => {
		const result = await detectProfile("google/gemini-3-flash-preview");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("gemini-3-flash");
		expect(result!.drivers).toContain("await-discipline");
		expect(result!.drivers).toContain("verify-before-return");
	});

	it("matches with provider prefix", async () => {
		const result = await detectProfile("openrouter/google/gemini-3-flash-preview");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("gemini-3-flash");
	});

	it("null when no match", async () => {
		const result = await detectProfile("anthropic/claude-sonnet-4-20250514");
		expect(result).toBeNull();
	});
});

describe("loadStack", () => {
	it("profile + use: drivers then app", async () => {
		const result = await loadStack({
			profile: "gemini-3-flash",
			use: "structured-data-aggregation",
		});
		expect(result).toContain("## Await Discipline");
		expect(result).toContain("## Verify Before Return");
		expect(result).toContain("## Aggregation Protocol");
		const driverPos = result.indexOf("## Await Discipline");
		const appPos = result.indexOf("## Aggregation Protocol");
		expect(driverPos).toBeLessThan(appPos);
	});

	it("profile + app (backwards compat): drivers then app", async () => {
		const result = await loadStack({
			profile: "gemini-3-flash",
			app: "structured-data-aggregation",
		});
		expect(result).toContain("## Await Discipline");
		expect(result).toContain("## Verify Before Return");
		expect(result).toContain("## Aggregation Protocol");
	});

	it("model auto-detection", async () => {
		const result = await loadStack({
			model: "openrouter/google/gemini-3-flash-preview",
		});
		expect(result).toContain("## Await Discipline");
		expect(result).toContain("## Return Format");
		expect(result).toContain("## Verify Before Return");
	});

	it("deduplicates drivers", async () => {
		const result = await loadStack({
			profile: "gemini-3-flash",
			use: "structured-data-aggregation",
			drivers: ["verify-before-return"],
		});
		const matches = result.match(/## Verify Before Return/g);
		expect(matches).toHaveLength(1);
	});

	it("use only", async () => {
		const result = await loadStack({
			use: "structured-data-aggregation",
		});
		expect(result).toContain("## Aggregation Protocol");
		expect(result).not.toContain("## Await Discipline");
	});

	it("app only (backwards compat)", async () => {
		const result = await loadStack({
			app: "structured-data-aggregation",
		});
		expect(result).toContain("## Aggregation Protocol");
		expect(result).not.toContain("## Await Discipline");
	});

	it("use wins over app when both provided", async () => {
		const result = await loadStack({
			use: "structured-data-aggregation",
			app: "nonexistent-should-be-ignored",
		});
		expect(result).toContain("## Aggregation Protocol");
	});

	it("empty when nothing specified", async () => {
		const result = await loadStack({});
		expect(result).toBe("");
	});

	it("empty when model unmatched", async () => {
		const result = await loadStack({
			model: "anthropic/claude-sonnet-4-20250514",
		});
		expect(result).toBe("");
	});
});
