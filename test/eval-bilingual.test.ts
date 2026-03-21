import { describe, it, expect } from "vitest";
import { pressRun } from "../src/press-boot.js";
import { RlmObserver } from "../src/observer.js";
import type { DelegationSpawnEvent } from "../src/events.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf("Eval 12: bilingual-haiku (service reuse, sequential composition)", () => {
  const specDir = "/Users/sl/code/openprose/prose/skills/open-prose";
  const programDir = join(__dirname, "fixtures/bilingual-haiku");
  const runDir = ".prose/runs/eval-bilingual-haiku";

  it("composes haiku, translates round-trip, assesses drift", async () => {
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new RlmObserver();

    console.log("\n========== STARTING EVAL 12 (bilingual-haiku) ==========\n");
    console.log("Spec dir:", specDir);
    console.log("Program dir:", programDir);
    console.log("Run dir:", runDir);

    const result = await pressRun({
      callLLM,
      specDir,
      programPath: join(programDir, "index.md"),
      programDir,
      callerInputs: {
        topic: "autumn rain",
        language: "Japanese",
      },
      runId: "eval-bilingual-haiku",
      runDir,
      maxIterations: 10,
      maxDepth: 3,
      observer,
    });

    const events = observer.getEvents();

    // Collect metrics
    const spawns = events.filter((e): e is DelegationSpawnEvent => e.type === "delegation:spawn");
    const returns = events.filter(e => e.type === "delegation:return");
    const errors = events.filter(e => e.type === "delegation:error");
    const invStarts = events.filter(e => e.type === "invocation:start");

    // Write trace
    const traceData = {
      result: {
        answer: result.answer?.slice(0, 3000),
        formeIterations: result.phaseResults.forme.iterations,
        vmIterations: result.phaseResults.vm.iterations,
      },
      metrics: {
        totalEvents: events.length,
        delegationSpawns: spawns.length,
        delegationReturns: returns.length,
        delegationErrors: errors.length,
        invocations: invStarts.length,
        maxDepth: Math.max(...events.map(e => e.depth)),
      },
      spawns: spawns.map(s => ({
        depth: s.depth,
        childId: s.childId,
        query: s.query?.slice(0, 200),
      })),
      manifest: result.manifest?.slice(0, 3000),
    };

    const traceDir = join(programDir);
    writeFileSync(
      join(traceDir, "last-run.json"),
      JSON.stringify(traceData, null, 2)
    );

    // Log key metrics
    console.log("\n=== EVAL 12: bilingual-haiku ===");
    console.log("Answer (first 1000 chars):", result.answer?.slice(0, 1000));
    console.log("\nForme iterations:", result.phaseResults.forme.iterations);
    console.log("VM iterations:", result.phaseResults.vm.iterations);
    console.log("Total events:", events.length);
    console.log("Delegation spawns:", spawns.length);
    console.log("Delegation returns:", returns.length);
    console.log("Delegation errors:", errors.length);
    console.log("Total invocations:", invStarts.length);

    // Log spawn details
    console.log("\nSpawns:");
    for (const s of spawns) {
      console.log(`  depth ${s.depth}: ${s.query?.slice(0, 120)}`);
    }

    // Log manifest
    console.log("\nManifest (first 1500 chars):", result.manifest?.slice(0, 1500));

    // --- Assertions ---

    // Result should be a real report
    expect(result.answer).toBeTruthy();
    expect(result.answer.length).toBeGreaterThan(50);

    // Manifest was produced
    expect(result.manifest).toBeTruthy();

    // Result should contain the original haiku (or reference to it)
    // and mention Japanese / drift / preservation
    const lowerAnswer = result.answer.toLowerCase();
    expect(
      lowerAnswer.includes("japanese") ||
      lowerAnswer.includes("日本") ||
      lowerAnswer.includes("translation")
    ).toBe(true);

    expect(
      lowerAnswer.includes("drift") ||
      lowerAnswer.includes("preserv") ||
      lowerAnswer.includes("meaning")
    ).toBe(true);

    // At least 4 delegation spawns: composer + translator×2 + comparator
    expect(spawns.length).toBeGreaterThanOrEqual(4);

    // No delegation errors
    expect(errors.length).toBe(0);

    console.log("\nArtifacts preserved in:", runDir);
    console.log("Trace written to:", join(traceDir, "last-run.json"));

  }, 300_000); // 5 minute timeout
});
