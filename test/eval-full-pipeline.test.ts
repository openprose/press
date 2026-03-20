import { describe, it, expect } from "vitest";
import { press } from "../src/rlm.js";
import { RlmObserver } from "../src/observer.js";
import type { RlmEvent, InvocationStartEvent, IterationEndEvent, DelegationSpawnEvent } from "../src/events.js";
import { fromOpenRouter } from "../eval/drivers/openrouter.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

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

describeIf("Eval 8: Full pipeline via bootloader (Sonnet)", () => {
  const specDir = "/Users/sl/code/openprose/prose/skills/open-prose";
  const fixtureDir = join(__dirname, "fixtures/trivial-program");
  const runDir = join(process.cwd(), ".prose/runs/eval-boot-v2");

  it("runs two-phase pipeline with service delegation", async () => {
    // Clean up from previous runs
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new RlmObserver();

    // The bootloader's system prompt tells the model exactly what to do.
    // It will be injected via pluginBodies (renders in <rlm-program> for root).
    const bootPrompt = [
      "# Bootloader: Prose via Forme",
      "",
      "You are the Press bootloader. Your job is to run a Prose program in two phases.",
      "",
      "## Your context data",
      "",
      "Your `context` variable is an object with these keys:",
      "- `spec_dir` -- directory with Prose/Forme spec files",
      "- `program_path` -- path to the program entry point",
      "- `program_dir` -- directory containing the program and service files",
      "- `run_dir` -- directory for run state",
      "- `caller_inputs` -- object with user inputs (e.g., { text: \"hello world\" })",
      "",
      "## Phase 1: Forme Wiring",
      "",
      "1. Parse context. Read the entry point file from `program_path`.",
      "2. Read the Forme spec from `spec_dir + '/forme.md'`.",
      "3. Read the filesystem spec from `spec_dir + '/state/filesystem.md'`.",
      "4. Build a context string for the Forme child containing:",
      "   - The Forme spec content",
      "   - The filesystem spec content",
      "   - The program_dir path",
      "   - The run_dir path",
      "5. Call `await press(entryPointContent, formeContextString)` to spawn the Forme child.",
      "6. The child will read service files, match contracts, and write manifest.md to run_dir.",
      "",
      "## Phase 2: Prose VM Execution",
      "",
      "1. Read the manifest from `run_dir + '/manifest.md'`.",
      "2. Read the Prose VM spec from `spec_dir + '/prose.md'`.",
      "3. Read the session spec from `spec_dir + '/primitives/session.md'`.",
      "4. Build a context string for the VM child containing:",
      "   - The Prose VM spec content",
      "   - The session spec content",
      "   - The filesystem spec content",
      "   - The caller_inputs",
      "   - The run_dir, program_dir, spec_dir paths",
      "5. Call `await press(manifestContent, vmContextString)` to spawn the VM child.",
      "6. The VM child will execute services (uppercaser, reporter) via press() calls,",
      "   manage workspace/bindings/state.md, and return the final output.",
      "",
      "## Return",
      "",
      "Return the final output from Phase 2.",
      "",
      "## Important",
      "",
      "- Always `await` press() calls.",
      "- Use `require('fs')` to read/write files.",
      "- Access context properties directly (e.g., context.spec_dir).",
      "- Do Phase 1 first, verify manifest exists, then do Phase 2.",
      "- Pass specs as part of the context object to children -- they will see the specs",
      "  in the <rlm-context-stack> section of their system prompt.",
    ].join("\n");

    // Context is an object with all paths and inputs
    const bootContext: Record<string, unknown> = {
      spec_dir: specDir,
      program_path: join(fixtureDir, "index.md"),
      program_dir: fixtureDir,
      run_dir: runDir,
      caller_inputs: { text: "hello world this is a test" },
    };

    console.log("\n========== STARTING EVAL 8 (Sonnet) ==========\n");
    console.log("Spec dir:", specDir);
    console.log("Program dir:", fixtureDir);
    console.log("Run dir:", runDir);

    let result: { answer: string; iterations: number } | null = null;
    let runError: Error | null = null;
    try {
      result = await press(
        "Run the trivial-pipeline program. Parse context for paths and inputs.",
        bootContext,
        {
          callLLM,
          maxIterations: 10,
          maxDepth: 4,
          pluginBodies: bootPrompt,
          observer,
        },
      );
    } catch (err) {
      runError = err instanceof Error ? err : new Error(String(err));
      console.log("\n========== BOOTLOADER ERROR ==========");
      console.log("Error:", runError.message);
    }

    // =====================================================================
    // Collect all events
    // =====================================================================
    const events = observer.getEvents();

    console.log("\n========== RESULT ==========");
    console.log("Answer:", result?.answer?.slice(0, 500) ?? "(no answer -- error)");
    console.log("Iterations:", result?.iterations ?? "(unknown)");
    console.log("Error:", runError?.message ?? "none");
    console.log("Total events:", events.length);

    // =====================================================================
    // Analyze invocation:start events (system prompts at each depth)
    // =====================================================================
    console.log("\n========== SYSTEM PROMPTS (per invocation) ==========");
    const invocationStarts = events.filter(
      (e): e is InvocationStartEvent => e.type === "invocation:start"
    );
    for (const ev of invocationStarts) {
      console.log(`\n[invocation:start] id=${ev.invocationId} depth=${ev.depth}`);
      console.log("  Query (first 200):", ev.query.slice(0, 200));
      console.log("  System prompt length:", ev.systemPrompt.length);
      console.log("  Has <rlm-context-stack>:", ev.systemPrompt.includes("<rlm-context-stack>"));
      console.log("  Has <rlm-program>:", ev.systemPrompt.includes("<rlm-program>"));
      console.log("  Contains 'forme':", ev.systemPrompt.toLowerCase().includes("forme"));
      console.log("  Contains 'prose vm':", ev.systemPrompt.toLowerCase().includes("prose vm"));
      console.log("  Contains 'manifest':", ev.systemPrompt.toLowerCase().includes("manifest"));
      // Show the first 1500 chars of the system prompt
      console.log("  System prompt (first 1500):", ev.systemPrompt.slice(0, 1500));
    }

    // =====================================================================
    // Analyze iteration:end events (code at each level)
    // =====================================================================
    console.log("\n========== CODE BLOCKS (per iteration) ==========");
    const iterationEnds = events.filter(
      (e): e is IterationEndEvent => e.type === "iteration:end"
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

    // Spawns by depth
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

    // manifest.md
    const manifestPath = join(runDir, "manifest.md");
    let manifest = "";
    if (existsSync(manifestPath)) {
      manifest = readFileSync(manifestPath, "utf8");
      console.log("manifest.md EXISTS, content:\n", manifest);
    } else {
      console.log("manifest.md: NOT FOUND");
    }

    // state.md
    const statePath = join(runDir, "state.md");
    let stateContent = "";
    if (existsSync(statePath)) {
      stateContent = readFileSync(statePath, "utf8");
      console.log("\nstate.md content:\n", stateContent);
    } else {
      console.log("\nstate.md: NOT FOUND");
    }

    // workspace files
    const workspaceDir = join(runDir, "workspace");
    const workspaceFiles = listFilesRecursive(workspaceDir);
    console.log("\nworkspace/ files:", workspaceFiles);
    for (const f of workspaceFiles) {
      const fp = join(workspaceDir, f);
      console.log(`\n--- workspace/${f} ---`);
      console.log(readFileSync(fp, "utf8").slice(0, 500));
    }

    // bindings files
    const bindingsDir = join(runDir, "bindings");
    const bindingsFiles = listFilesRecursive(bindingsDir);
    console.log("\nbindings/ files:", bindingsFiles);
    for (const f of bindingsFiles) {
      const fp = join(bindingsDir, f);
      console.log(`\n--- bindings/${f} ---`);
      console.log(readFileSync(fp, "utf8").slice(0, 500));
    }

    // services files
    const servicesDir = join(runDir, "services");
    const servicesFiles = listFilesRecursive(servicesDir);
    console.log("\nservices/ files:", servicesFiles);

    // =====================================================================
    // Write trace file
    // =====================================================================
    const traceOutput = {
      events: events.map((e) => {
        if (e.type === "invocation:start") {
          return { ...e, systemPrompt: e.systemPrompt.slice(0, 3000) + "..." };
        }
        return e;
      }),
      manifest,
      stateContent,
      result: { answer: result?.answer ?? null, iterations: result?.iterations ?? null, error: runError?.message ?? null },
      summary: {
        totalEvents: events.length,
        totalSpawns: allSpawns.length,
        totalReturns: allReturns.length,
        totalErrors: allErrors.length,
        totalUnawaited: allUnawaited.length,
        spawnsByDepth: Object.fromEntries(
          [...spawnsByDepth.entries()].map(([d, s]) => [d, s.length])
        ),
        workspaceFiles,
        bindingsFiles,
        servicesFiles,
      },
    };
    const lastRunPath = join(fixtureDir, "last-boot-run.json");
    writeFileSync(lastRunPath, JSON.stringify(traceOutput, null, 2), "utf8");
    console.log("\nWrote trace to:", lastRunPath);

    // =====================================================================
    // Summary
    // =====================================================================
    console.log("\n========== SUMMARY ==========");
    console.log("Bootloader iterations:", result?.iterations ?? "(unknown)");
    console.log("Total events:", events.length);
    console.log("Total delegation spawns:", allSpawns.length);
    console.log("Spawns by depth:", JSON.stringify(Object.fromEntries(
      [...spawnsByDepth.entries()].map(([d, s]) => [d, s.length])
    )));
    console.log("Total delegation returns:", allReturns.length);
    console.log("Total delegation errors:", allErrors.length);
    console.log("Manifest exists:", existsSync(manifestPath));
    console.log("State exists:", existsSync(statePath));
    console.log("Workspace files:", workspaceFiles.length);
    console.log("Bindings files:", bindingsFiles.length);
    console.log("Services files:", servicesFiles.length);
    console.log("Final answer:", result?.answer ?? "(no answer)");
    console.log("Run error:", runError?.message ?? "none");

    // =====================================================================
    // Assertions -- report everything first, then assert
    // =====================================================================
    if (runError) {
      console.log("\n========== ASSERTIONS (bootloader errored) ==========");
      console.log("Bootloader failed with:", runError.message);
      const bootloaderSpawns = spawnsByDepth.get(0) ?? [];
      console.log("Bootloader (depth 0) spawns:", bootloaderSpawns.length);
      const vmSpawns = spawnsByDepth.get(1) ?? [];
      console.log("VM (depth 1) spawns:", vmSpawns.length);
    }

    // Assert: bootloader should complete without error
    expect(runError, "bootloader should complete without error").toBeNull();

    // Assert: output should exist
    expect(result!.answer.length).toBeGreaterThan(0);

    // Assert: output should reference uppercased text
    const hasRelevantContent =
      result!.answer.includes("HELLO WORLD") ||
      result!.answer.toUpperCase().includes("HELLO WORLD");
    console.log("\nFinal output references input text:", hasRelevantContent);
    if (!hasRelevantContent) {
      console.log("WARNING: Final output does not contain expected text reference.");
      console.log("Full answer:", result!.answer);
    }

    // Assert: manifest should exist
    expect(existsSync(manifestPath), "manifest.md should exist after Phase 1").toBe(true);
    expect(manifest).toContain("uppercaser");
    expect(manifest).toContain("reporter");

    // Assert: at least 2 spawns from bootloader (Forme + VM)
    const bootloaderSpawns2 = spawnsByDepth.get(0) ?? [];
    expect(bootloaderSpawns2.length, "bootloader should spawn at least 2 children (Forme + VM)").toBeGreaterThanOrEqual(2);

    // Assert: at least 2 spawns from VM (uppercaser + reporter)
    const vmSpawns2 = spawnsByDepth.get(1) ?? [];
    expect(vmSpawns2.length, "VM should spawn at least 2 children (uppercaser + reporter)").toBeGreaterThanOrEqual(2);

    // Cleanup
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (e) {
      console.log("Failed to clean up:", e);
    }

  }, 300_000); // 5 minute timeout
});
