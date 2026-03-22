import { describe, it, expect } from "vitest";
import { pressRun } from "../src/press-boot.js";
import { PressObserver } from "../src/observer.js";
import type { InvocationStartEvent, IterationEndEvent, DelegationSpawnEvent } from "../src/events.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

/** Recursively list all files under a directory, returning relative paths. */
function listFilesRecursive(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full, base));
    } else {
      files.push(full.slice(base.length + 1));
    }
  }
  return files;
}

describeIf("Eval 8: Full pipeline via deterministic boot (Sonnet)", () => {
  const specDir = resolve(__dirname, "../../prose/skills/open-prose");
  const fixtureDir = join(__dirname, "fixtures/trivial-program");
  const runDir = join(process.cwd(), ".prose/runs/eval-boot-v3");

  it("runs two-phase pipeline with service delegation", async () => {
    // Clean up from previous runs
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new PressObserver();

    console.log("\n========== STARTING EVAL 8 v3 (deterministic boot) ==========\n");
    console.log("Spec dir:", specDir);
    console.log("Program dir:", fixtureDir);
    console.log("Run dir:", runDir);

    const result = await pressRun({
      callLLM,
      specDir,
      programPath: join(fixtureDir, "index.md"),
      programDir: fixtureDir,
      callerInputs: { text: "hello world this is a test" },
      runId: "eval-boot-v3",
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
    console.log("Answer:", result.answer?.slice(0, 500));
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
      const hasGlossary = ev.systemPrompt.includes("<press-runtime>");
      const hasFormeSpec = ev.systemPrompt.includes("<forme-spec>");
      const hasProseVmSpec = ev.systemPrompt.includes("<prose-vm-spec>");
      const hasRlmProgram = ev.systemPrompt.includes("<press-program>");
      console.log("  Has <press-runtime>:", hasGlossary);
      console.log("  Has <forme-spec>:", hasFormeSpec);
      console.log("  Has <prose-vm-spec>:", hasProseVmSpec);
      console.log("  Has <press-program>:", hasRlmProgram);
      console.log("  System prompt (first 1500):", ev.systemPrompt.slice(0, 1500));
    }

    // =====================================================================
    // Analyze iteration:end events (code at each level)
    // =====================================================================
    console.log("\n========== CODE BLOCKS (per iteration) ==========");
    const iterationEnds = events.filter(
      (e): e is IterationEndEvent => e.type === "iteration:end",
    );
    for (const ev of iterationEnds) {
      console.log(`\n[iteration:end] id=${ev.invocationId} depth=${ev.depth} iter=${ev.iteration} returned=${ev.returned}`);
      console.log("  Code:", (ev.code ?? "(no code)").slice(0, 800));
      if (ev.output) console.log("  Output:", ev.output.slice(0, 500));
      if (ev.error) console.log("  Error:", ev.error);
    }

    // =====================================================================
    // Analyze delegation events
    // =====================================================================
    console.log("\n========== DELEGATION EVENTS ==========");
    const allSpawns = events.filter((e): e is DelegationSpawnEvent => e.type === "delegation:spawn");
    const allReturns = events.filter(e => e.type === "delegation:return");
    const allErrors = events.filter(e => e.type === "delegation:error");
    const allUnawaited = events.filter(e => e.type === "delegation:unawaited");

    console.log("Total spawns:", allSpawns.length);
    console.log("Total returns:", allReturns.length);
    console.log("Total errors:", allErrors.length);
    console.log("Total unawaited:", allUnawaited.length);

    const spawnsByDepth = new Map<number, DelegationSpawnEvent[]>();
    for (const ev of allSpawns) {
      const list = spawnsByDepth.get(ev.depth) ?? [];
      list.push(ev);
      spawnsByDepth.set(ev.depth, list);
    }
    for (const [depth, spawns] of spawnsByDepth) {
      console.log(`\n  Depth ${depth} spawns (${spawns.length}):`);
      for (const s of spawns) {
        console.log(`    childId=${s.childId} query="${s.query.slice(0, 150)}"`);
        if (s.context) console.log(`    context (first 300)=${s.context.slice(0, 300)}`);
      }
    }

    for (const ev of allReturns) {
      if (ev.type === "delegation:return") {
        console.log(`\n  Return: childId=${ev.childId} answer="${ev.answer.slice(0, 300)}"`);
      }
    }

    for (const ev of allErrors) {
      if (ev.type === "delegation:error") {
        console.log(`\n  Error: childId=${ev.childId} error="${ev.error}"`);
      }
    }

    // =====================================================================
    // Inspect filesystem artifacts
    // =====================================================================
    console.log("\n========== FILESYSTEM ARTIFACTS ==========");

    const manifestPath = join(runDir, "manifest.md");
    if (existsSync(manifestPath)) {
      console.log("manifest.md EXISTS, content:\n", readFileSync(manifestPath, "utf8"));
    } else {
      console.log("manifest.md: NOT FOUND (was read by pressRun)");
    }

    const statePath = join(runDir, "state.md");
    if (existsSync(statePath)) {
      console.log("\nstate.md content:\n", readFileSync(statePath, "utf8"));
    } else {
      console.log("\nstate.md: NOT FOUND");
    }

    const workspaceDir = join(runDir, "workspace");
    const workspaceFiles = listFilesRecursive(workspaceDir);
    console.log("\nworkspace/ files:", workspaceFiles);
    for (const f of workspaceFiles) {
      const fp = join(workspaceDir, f);
      console.log(`\n--- workspace/${f} ---`);
      console.log(readFileSync(fp, "utf8").slice(0, 500));
    }

    const bindingsDir = join(runDir, "bindings");
    const bindingsFiles = listFilesRecursive(bindingsDir);
    console.log("\nbindings/ files:", bindingsFiles);
    for (const f of bindingsFiles) {
      const fp = join(bindingsDir, f);
      console.log(`\n--- bindings/${f} ---`);
      console.log(readFileSync(fp, "utf8").slice(0, 500));
    }

    const servicesDir = join(runDir, "services");
    const servicesFiles = listFilesRecursive(servicesDir);
    console.log("\nservices/ files:", servicesFiles);

    // =====================================================================
    // Write trace file
    // =====================================================================
    const traceOutput = {
      result: {
        answer: result.answer,
        manifest: result.manifest,
        formeIterations: result.phaseResults.forme.iterations,
        vmIterations: result.phaseResults.vm.iterations,
      },
      events: events.length,
      delegationSpawns: allSpawns.length,
      invocationStarts: invocationStarts.length,
      spawnsByDepth: Object.fromEntries(
        [...spawnsByDepth.entries()].map(([d, s]) => [d, s.length]),
      ),
      workspaceFiles,
      bindingsFiles,
      servicesFiles,
    };
    const lastRunPath = join(fixtureDir, "last-boot-run-v3.json");
    writeFileSync(lastRunPath, JSON.stringify(traceOutput, null, 2), "utf8");
    console.log("\nWrote trace to:", lastRunPath);

    // =====================================================================
    // Summary
    // =====================================================================
    console.log("\n========== SUMMARY ==========");
    console.log("Forme iterations:", result.phaseResults.forme.iterations);
    console.log("VM iterations:", result.phaseResults.vm.iterations);
    console.log("Total events:", events.length);
    console.log("Total delegation spawns:", allSpawns.length);
    console.log("Spawns by depth:", JSON.stringify(Object.fromEntries(
      [...spawnsByDepth.entries()].map(([d, s]) => [d, s.length]),
    )));
    console.log("Total delegation returns:", allReturns.length);
    console.log("Total delegation errors:", allErrors.length);
    console.log("Final answer:", result.answer);

    // =====================================================================
    // Assertions
    // =====================================================================
    expect(result.answer).toBeTruthy();

    // Output should reference uppercased text
    const hasRelevantContent =
      result.answer.includes("HELLO WORLD") ||
      result.answer.toUpperCase().includes("HELLO WORLD");
    console.log("\nFinal output references input text:", hasRelevantContent);
    if (!hasRelevantContent) {
      console.log("WARNING: Final output does not contain expected text reference.");
      console.log("Full answer:", result.answer);
    }

    // Manifest should contain service names
    expect(result.manifest).toBeTruthy();
    expect(result.manifest).toContain("uppercaser");
    expect(result.manifest).toContain("reporter");

    // Cleanup
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (e) {
      console.log("Failed to clean up:", e);
    }

  }, 300_000); // 5 minute timeout
});
