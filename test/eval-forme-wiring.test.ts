import { describe, it, expect } from "vitest";
import { press } from "../src/rlm.js";
import { PressObserver } from "../src/observer.js";
import type { PressEvent, InvocationStartEvent, IterationEndEvent } from "../src/events.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf("Eval 5: Forme wires a trivial program (live API)", () => {
  it("produces a valid manifest for a 2-service pipeline", async () => {
    const callLLM = fromOpenRouter("google/gemini-2.0-flash-001", apiKey!, {});
    const observer = new PressObserver();

    // Load specs
    const proseRepoSkills = "/Users/sl/code/openprose/prose/skills/open-prose";
    const formeSpec = readFileSync(join(proseRepoSkills, "forme.md"), "utf8");
    const filesystemSpec = readFileSync(join(proseRepoSkills, "state/filesystem.md"), "utf8");

    // Load the test program entry point
    const fixtureDir = join(__dirname, "fixtures/trivial-program");
    const entryPoint = readFileSync(join(fixtureDir, "index.md"), "utf8");

    // Ensure run directory exists
    const runDir = ".prose/runs/eval-forme-test";
    mkdirSync(runDir, { recursive: true });

    const programContent = [
      `<forme-spec>`,
      formeSpec,
      `</forme-spec>`,
      ``,
      `<filesystem-spec>`,
      filesystemSpec,
      `</filesystem-spec>`,
      ``,
      `<run-context>`,
      `Run ID: eval-forme-test`,
      `Run directory: .prose/runs/eval-forme-test/`,
      `Program directory: ${fixtureDir}/`,
      `Phase: 1 (Wiring)`,
      ``,
      `Your task: Wire this program. Read the entry point below, then resolve and`,
      `read each service file from disk using the program directory. Produce the`,
      `manifest per the Forme specification. Write it to the run directory.`,
      `Then RETURN a confirmation.`,
      `</run-context>`,
    ].join("\n");

    // Run Phase 1 with observer
    const result = await press(entryPoint, undefined, {
      callLLM,
      maxIterations: 10,
      maxDepth: 1,
      systemPrompt: programContent,
      observer,
    });

    // Collect all events
    const events = observer.getEvents();

    console.log("=== RESULT ===");
    console.log("Forme result:", result.answer);
    console.log("Iterations:", result.iterations);
    console.log("Total events captured:", events.length);

    // Log system prompts from invocation:start events
    console.log("\n=== SYSTEM PROMPTS ===");
    const invocationStarts = events.filter(
      (e): e is InvocationStartEvent => e.type === "invocation:start"
    );
    for (const ev of invocationStarts) {
      console.log(`\n[invocation:start] invocationId=${ev.invocationId} depth=${ev.depth}`);
      console.log("System prompt (first 500 chars):", ev.systemPrompt.slice(0, 500));
      console.log("Has XML tags:", ev.systemPrompt.includes("<") && ev.systemPrompt.includes(">"));
    }

    // Log code blocks from iteration:end events
    console.log("\n=== CODE BLOCKS (per iteration) ===");
    const iterationEnds = events.filter(
      (e): e is IterationEndEvent => e.type === "iteration:end"
    );
    for (const ev of iterationEnds) {
      console.log(`\n[iteration:end] iteration=${ev.iteration} returned=${ev.returned}`);
      console.log("Code:", ev.code ?? "(no code)");
      if (ev.output) console.log("Output:", ev.output.slice(0, 500));
      if (ev.error) console.log("Error:", ev.error);
    }

    // Read and log manifest
    const manifestPath = join(runDir, "manifest.md");
    console.log("\n=== MANIFEST ===");
    console.log("Manifest exists:", existsSync(manifestPath));

    let manifest = "";
    if (existsSync(manifestPath)) {
      manifest = readFileSync(manifestPath, "utf8");
      console.log("Manifest content:\n", manifest);
    }

    // Write full trace to last-run.json
    const traceOutput = {
      events: events.map((e) => {
        // Truncate systemPrompt in the JSON to keep file manageable
        if (e.type === "invocation:start") {
          return { ...e, systemPrompt: e.systemPrompt.slice(0, 2000) + "..." };
        }
        return e;
      }),
      manifest,
      result: { answer: result.answer, iterations: result.iterations },
    };
    const lastRunPath = join(fixtureDir, "last-run.json");
    writeFileSync(lastRunPath, JSON.stringify(traceOutput, null, 2), "utf8");
    console.log("\n=== TRACE ===");
    console.log("Wrote last-run.json to:", lastRunPath);

    // --- Assertions ---

    // Manifest file should exist
    expect(existsSync(manifestPath)).toBe(true);

    // Manifest should contain uppercaser and reporter (not counter)
    expect(manifest).toContain("uppercaser");
    expect(manifest).toContain("reporter");

    // Wiring checks: uppercaser.text should come from caller
    const lowerManifest = manifest.toLowerCase();
    expect(
      lowerManifest.includes("caller") ||
      lowerManifest.includes("binding") ||
      lowerManifest.includes("input") ||
      lowerManifest.includes("text")
    ).toBe(true);

    // Execution order should exist
    expect(
      lowerManifest.includes("execution") ||
      lowerManifest.includes("order") ||
      lowerManifest.includes("sequence") ||
      lowerManifest.includes("step")
    ).toBe(true);

    // Events should have been captured
    expect(events.length).toBeGreaterThan(0);
    expect(invocationStarts.length).toBeGreaterThan(0);
    expect(iterationEnds.length).toBeGreaterThan(0);

  }, 120_000);  // 2 minute timeout
});
