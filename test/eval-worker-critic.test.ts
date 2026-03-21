import { describe, it, expect } from "vitest";
import { pressRun } from "../src/press-boot.js";
import { PressObserver } from "../src/observer.js";
import type {
  InvocationStartEvent,
  IterationEndEvent,
  DelegationSpawnEvent,
  DelegationReturnEvent,
} from "../src/events.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf("Eval 11: worker-critic loop (iterative refinement)", () => {
  const specDir = "/Users/sl/code/openprose/prose/skills/open-prose";
  const fixtureDir = join(__dirname, "fixtures/worker-critic");
  const runDir = join(process.cwd(), ".prose/runs/eval-worker-critic");

  it("runs writer-critic loop with iterative feedback", async () => {
    // Clean up from previous runs
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new PressObserver();

    console.log("\n========== STARTING EVAL 11 (worker-critic loop) ==========\n");
    console.log("Spec dir:", specDir);
    console.log("Fixture dir:", fixtureDir);
    console.log("Run dir:", runDir);

    const result = await pressRun({
      callLLM,
      specDir,
      programPath: join(fixtureDir, "index.md"),
      programDir: fixtureDir,
      callerInputs: { topic: "autumn rain" },
      runId: "eval-worker-critic",
      runDir,
      maxIterations: 10,
      maxDepth: 3,
      observer,
    });

    // =====================================================================
    // Collect all events
    // =====================================================================
    const events = observer.getEvents();

    console.log("\n========== RESULT ==========");
    console.log("Answer:", result.answer);
    console.log("Forme iterations:", result.phaseResults.forme.iterations);
    console.log("VM iterations:", result.phaseResults.vm.iterations);
    console.log("Total events:", events.length);

    // =====================================================================
    // Analyze invocation:start events (system prompts at each depth)
    // =====================================================================
    console.log("\n========== SYSTEM PROMPTS (per invocation) ==========");
    const invocationStarts = events.filter(
      (e): e is InvocationStartEvent => e.type === "invocation:start",
    );
    for (const ev of invocationStarts) {
      console.log(`\n[invocation:start] id=${ev.invocationId} depth=${ev.depth}`);
      console.log("  Query (first 200):", ev.query.slice(0, 200));
      console.log("  System prompt length:", ev.systemPrompt.length);
    }

    // =====================================================================
    // Analyze iteration:end events (code the VM wrote)
    // =====================================================================
    console.log("\n========== CODE BLOCKS (per iteration) ==========");
    const iterationEnds = events.filter(
      (e): e is IterationEndEvent => e.type === "iteration:end",
    );
    for (const ev of iterationEnds) {
      console.log(`\n[iteration:end] id=${ev.invocationId} depth=${ev.depth} iter=${ev.iteration} returned=${ev.returned}`);
      console.log("  Code:", (ev.code ?? "(no code)").slice(0, 1200));
      if (ev.output) console.log("  Output:", ev.output.slice(0, 500));
      if (ev.error) console.log("  Error:", ev.error);
    }

    // =====================================================================
    // Analyze delegation events
    // =====================================================================
    console.log("\n========== DELEGATION EVENTS ==========");
    const allSpawns = events.filter((e): e is DelegationSpawnEvent => e.type === "delegation:spawn");
    const allReturns = events.filter((e): e is DelegationReturnEvent => e.type === "delegation:return");
    const allErrors = events.filter(e => e.type === "delegation:error");

    console.log("Total spawns:", allSpawns.length);
    console.log("Total returns:", allReturns.length);
    console.log("Total errors:", allErrors.length);

    // Categorize spawns by service name (look for "writer" or "critic" in query)
    const writerSpawns = allSpawns.filter(s =>
      s.query.toLowerCase().includes("writer") || s.query.toLowerCase().includes("compose haiku"),
    );
    const criticSpawns = allSpawns.filter(s =>
      s.query.toLowerCase().includes("critic") || s.query.toLowerCase().includes("evaluate") || s.query.toLowerCase().includes("syllable"),
    );

    console.log("\nWriter invocations:", writerSpawns.length);
    console.log("Critic invocations:", criticSpawns.length);

    // Log spawn details
    for (const s of allSpawns) {
      console.log(`\n  Spawn: depth=${s.depth} childId=${s.childId}`);
      console.log(`    Query (first 200): ${s.query.slice(0, 200)}`);
    }

    // Log return details
    for (const ev of allReturns) {
      console.log(`\n  Return: childId=${ev.childId}`);
      console.log(`    Answer (first 500): ${ev.answer.slice(0, 500)}`);
    }

    // Log errors
    for (const ev of allErrors) {
      if (ev.type === "delegation:error") {
        console.log(`\n  Error: childId=${ev.childId} error="${ev.error}"`);
      }
    }

    // =====================================================================
    // Check filesystem artifacts
    // =====================================================================
    console.log("\n========== FILESYSTEM ARTIFACTS ==========");

    const manifestPath = join(runDir, "manifest.md");
    if (existsSync(manifestPath)) {
      const manifest = readFileSync(manifestPath, "utf8");
      console.log("manifest.md EXISTS, length:", manifest.length);
      console.log("manifest.md content:\n", manifest);
    }

    const statePath = join(runDir, "state.md");
    if (existsSync(statePath)) {
      console.log("\nstate.md content:\n", readFileSync(statePath, "utf8"));
    }

    // =====================================================================
    // Write trace file
    // =====================================================================
    const traceData = {
      result: {
        answer: result.answer,
        formeIterations: result.phaseResults.forme.iterations,
        vmIterations: result.phaseResults.vm.iterations,
      },
      metrics: {
        totalEvents: events.length,
        delegationSpawns: allSpawns.length,
        delegationReturns: allReturns.length,
        delegationErrors: allErrors.length,
        invocations: invocationStarts.length,
        writerSpawns: writerSpawns.length,
        criticSpawns: criticSpawns.length,
      },
      spawns: allSpawns.map(s => ({
        depth: s.depth,
        childId: s.childId,
        query: s.query?.slice(0, 300),
      })),
      returns: allReturns.map(r => ({
        childId: r.childId,
        answer: r.answer?.slice(0, 500),
      })),
      manifest: result.manifest?.slice(0, 3000),
      vmCode: iterationEnds
        .filter(e => e.depth === 0)
        .map(e => ({
          iteration: e.iteration,
          code: e.code?.slice(0, 2000),
          output: e.output?.slice(0, 500),
        })),
    };

    const lastRunPath = join(fixtureDir, "last-run.json");
    writeFileSync(lastRunPath, JSON.stringify(traceData, null, 2), "utf8");
    console.log("\nWrote trace to:", lastRunPath);

    // =====================================================================
    // Summary
    // =====================================================================
    console.log("\n========== SUMMARY ==========");
    console.log("Forme iterations:", result.phaseResults.forme.iterations);
    console.log("VM iterations:", result.phaseResults.vm.iterations);
    console.log("Total events:", events.length);
    console.log("Total delegation spawns:", allSpawns.length);
    console.log("Writer spawns:", writerSpawns.length);
    console.log("Critic spawns:", criticSpawns.length);
    console.log("Delegation errors:", allErrors.length);
    console.log("Final answer:", result.answer);

    // =====================================================================
    // Assertions
    // =====================================================================

    // Result should be non-empty
    expect(result.answer).toBeTruthy();

    // Result should contain a haiku (multi-line text)
    const answerLower = result.answer.toLowerCase();
    const hasHaikuContent =
      result.answer.includes("\n") ||
      answerLower.includes("haiku") ||
      answerLower.includes("autumn") ||
      answerLower.includes("rain");
    expect(hasHaikuContent).toBe(true);

    // Manifest should exist and reference both services
    expect(result.manifest).toBeTruthy();
    expect(result.manifest).toContain("writer");
    expect(result.manifest).toContain("critic");

    // At least 2 delegation spawns (1 writer + 1 critic minimum)
    expect(allSpawns.length).toBeGreaterThanOrEqual(2);

    // No delegation errors
    expect(allErrors.length).toBe(0);

    // Cleanup
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (e) {
      console.log("Failed to clean up:", e);
    }

  }, 300_000); // 5 minute timeout
});
