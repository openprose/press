import { describe, it, expect } from "vitest";
import { pressRun } from "../src/press-boot.js";
import { PressObserver } from "../src/observer.js";
import type { DelegationSpawnEvent } from "../src/events.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf("Eval 10: could-haiku end-to-end (Sonnet)", () => {
  const specDir = "/Users/sl/code/openprose/prose/skills/open-prose";
  const programDir = "/Users/sl/code/openprose/programs/could-haiku";
  const runDir = ".prose/runs/eval-could-haiku";

  it("runs full documentation diagnostic with 9 testers", async () => {
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new PressObserver();

    console.log("\n========== STARTING EVAL 10 (could-haiku end-to-end) ==========\n");
    console.log("Spec dir:", specDir);
    console.log("Program dir:", programDir);
    console.log("Run dir:", runDir);

    const result = await pressRun({
      callLLM,
      specDir,
      programPath: join(programDir, "index.md"),
      programDir,
      callerInputs: {
        url: "https://docs.astro.build/en/getting-started/",
        tool_name: "Astro",
        depth: "shallow",
      },
      runId: "eval-could-haiku",
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

    // Write trace (but keep it manageable — don't dump all events for 9+ invocations)
    const traceData = {
      result: {
        answer: result.answer?.slice(0, 2000),
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
        query: s.query?.slice(0, 100),
      })),
      manifest: result.manifest?.slice(0, 3000),
    };

    const trajDir = join(programDir, "trajectories/happy-path");
    mkdirSync(trajDir, { recursive: true });
    writeFileSync(
      join(trajDir, "last-eval-run.json"),
      JSON.stringify(traceData, null, 2)
    );

    // Log key metrics
    console.log("\n=== EVAL 10: could-haiku ===");
    console.log("Answer (first 500 chars):", result.answer?.slice(0, 500));
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
      console.log(`  depth ${s.depth}: ${s.query?.slice(0, 80)}`);
    }

    // Check for state.md
    const statePath = join(runDir, "state.md");
    if (existsSync(statePath)) {
      console.log("\nstate.md:", readFileSync(statePath, "utf8"));
    }

    // Assertions — loose, since this is a complex real-world program
    expect(result.answer).toBeTruthy();
    expect(result.answer.length).toBeGreaterThan(100); // should be a real report
    expect(result.manifest).toBeTruthy();
    expect(spawns.length).toBeGreaterThanOrEqual(2); // at least scraper + some testers
    expect(errors.length).toBe(0); // no delegation errors

    // Don't clean up — leave artifacts for inspection
    console.log("\nArtifacts preserved in:", runDir);

  }, 1_200_000); // 20 minute timeout
});
