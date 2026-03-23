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

describeIf("Eval 13: Error handling and graceful degradation (Sonnet)", () => {
  const specDir = resolve(__dirname, "../../prose/skills/open-prose");
  const fixtureDir = join(__dirname, "fixtures/error-handling");

  // =========================================================================
  // Test A: Happy path — valid URL
  // =========================================================================
  it("happy path: fetches and summarizes a valid URL", async () => {
    const runDir = join(process.cwd(), ".prose/runs/eval-error-happy");
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new PressObserver();

    console.log("\n========== STARTING EVAL 13A: HAPPY PATH ==========\n");

    const startTime = Date.now();
    const result = await pressRun({
      callLLM,
      specDir,
      programPath: join(fixtureDir, "index.md"),
      programDir: fixtureDir,
      callerInputs: { url: "https://docs.astro.build/en/getting-started/" },
      runId: "eval-error-happy",
      runDir,
      maxIterations: 10,
      maxDepth: 3,
      observer,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const events = observer.getEvents();

    console.log("\n========== HAPPY PATH RESULT ==========");
    console.log("Answer:", result.answer?.slice(0, 500));
    console.log("Forme iterations:", result.phaseResults.forme.iterations);
    console.log("VM iterations:", result.phaseResults.vm.iterations);
    console.log("Total events:", events.length);
    console.log("Elapsed:", elapsed, "s");

    // --- Inspect filesystem ---
    const statePath = join(runDir, "state.md");
    let stateContent = "";
    if (existsSync(statePath)) {
      stateContent = readFileSync(statePath, "utf8");
      console.log("\nstate.md:\n", stateContent);
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

    // Check for __error.md
    const fetcherErrorPath = join(workspaceDir, "fetcher/__error.md");
    const hasError = existsSync(fetcherErrorPath);
    console.log("\nfetcher/__error.md exists:", hasError);

    // --- Delegation events ---
    const allSpawns = events.filter((e): e is DelegationSpawnEvent => e.type === "delegation:spawn");
    const spawnsByDepth = new Map<number, DelegationSpawnEvent[]>();
    for (const ev of allSpawns) {
      const list = spawnsByDepth.get(ev.depth) ?? [];
      list.push(ev);
      spawnsByDepth.set(ev.depth, list);
    }
    console.log("\nDelegation spawns:", allSpawns.length);
    console.log("Spawns by depth:", JSON.stringify(Object.fromEntries(
      [...spawnsByDepth.entries()].map(([d, s]) => [d, s.length]),
    )));

    // --- Write trace ---
    const traceOutput = {
      testCase: "happy-path",
      result: {
        answer: result.answer,
        manifest: result.manifest,
        formeIterations: result.phaseResults.forme.iterations,
        vmIterations: result.phaseResults.vm.iterations,
      },
      elapsed,
      events: events.length,
      delegationSpawns: allSpawns.length,
      workspaceFiles,
      stateContent,
    };
    writeFileSync(
      join(fixtureDir, "last-run-happy.json"),
      JSON.stringify(traceOutput, null, 2),
      "utf8",
    );

    // --- Assertions ---
    expect(result.answer).toBeTruthy();

    // Should contain a summary (non-empty, mentions Astro)
    const answerLower = result.answer.toLowerCase();
    const mentionsAstro = answerLower.includes("astro");
    console.log("\nMentions Astro:", mentionsAstro);
    if (!mentionsAstro) {
      console.log("WARNING: Answer does not mention Astro. Full answer:", result.answer);
    }

    // No __error.md in workspace
    expect(hasError).toBe(false);

    // state.md should have fetcher and summarizer success markers
    // (checking for ✓ marker next to service names)
    const hasFetcherSuccess = stateContent.includes("fetcher") && stateContent.includes("✓");
    const hasSummarizerSuccess = stateContent.includes("summarizer") && stateContent.includes("✓");
    console.log("state.md has fetcher ✓:", hasFetcherSuccess);
    console.log("state.md has summarizer ✓:", hasSummarizerSuccess);

    // Cleanup
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (e) {
      console.log("Failed to clean up:", e);
    }
  }, 300_000);

  // =========================================================================
  // Test B: Error path — invalid URL
  // =========================================================================
  it("error path: invalid URL triggers graceful degradation", async () => {
    const runDir = join(process.cwd(), ".prose/runs/eval-error-fail");
    rmSync(runDir, { recursive: true, force: true });

    const callLLM = fromOpenRouter("anthropic/claude-sonnet-4-6", apiKey!, {});
    const observer = new PressObserver();

    console.log("\n========== STARTING EVAL 13B: ERROR PATH ==========\n");

    const startTime = Date.now();
    const result = await pressRun({
      callLLM,
      specDir,
      programPath: join(fixtureDir, "index.md"),
      programDir: fixtureDir,
      callerInputs: { url: "https://this-domain-definitely-does-not-exist-xyz123.com/page" },
      runId: "eval-error-fail",
      runDir,
      maxIterations: 10,
      maxDepth: 3,
      observer,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const events = observer.getEvents();

    console.log("\n========== ERROR PATH RESULT ==========");
    console.log("Answer:", result.answer?.slice(0, 800));
    console.log("Forme iterations:", result.phaseResults.forme.iterations);
    console.log("VM iterations:", result.phaseResults.vm.iterations);
    console.log("Total events:", events.length);
    console.log("Elapsed:", elapsed, "s");

    // --- Inspect filesystem ---
    const statePath = join(runDir, "state.md");
    let stateContent = "";
    if (existsSync(statePath)) {
      stateContent = readFileSync(statePath, "utf8");
      console.log("\nstate.md:\n", stateContent);
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

    // Check for __error.md
    const fetcherErrorPath = join(workspaceDir, "fetcher/__error.md");
    const hasError = existsSync(fetcherErrorPath);
    console.log("\nfetcher/__error.md exists:", hasError);
    if (hasError) {
      console.log("__error.md content:\n", readFileSync(fetcherErrorPath, "utf8"));
    }

    // --- Delegation events ---
    const allSpawns = events.filter((e): e is DelegationSpawnEvent => e.type === "delegation:spawn");
    const allReturns = events.filter(e => e.type === "delegation:return");
    const allErrors = events.filter(e => e.type === "delegation:error");
    const spawnsByDepth = new Map<number, DelegationSpawnEvent[]>();
    for (const ev of allSpawns) {
      const list = spawnsByDepth.get(ev.depth) ?? [];
      list.push(ev);
      spawnsByDepth.set(ev.depth, list);
    }
    console.log("\nDelegation spawns:", allSpawns.length);
    console.log("Delegation returns:", allReturns.length);
    console.log("Delegation errors:", allErrors.length);
    console.log("Spawns by depth:", JSON.stringify(Object.fromEntries(
      [...spawnsByDepth.entries()].map(([d, s]) => [d, s.length]),
    )));

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

    // --- Write trace ---
    const traceOutput = {
      testCase: "error-path",
      result: {
        answer: result.answer,
        manifest: result.manifest,
        formeIterations: result.phaseResults.forme.iterations,
        vmIterations: result.phaseResults.vm.iterations,
      },
      elapsed,
      events: events.length,
      delegationSpawns: allSpawns.length,
      workspaceFiles,
      stateContent,
    };
    writeFileSync(
      join(fixtureDir, "last-run-error.json"),
      JSON.stringify(traceOutput, null, 2),
      "utf8",
    );

    // --- Assertions ---

    // 1. Program should NOT crash — it should return something
    expect(result.answer).toBeTruthy();
    console.log("\n✓ Program did not crash, produced output");

    // 2. Result should contain an error report (mentions the URL or suggests checking it)
    const answerLower = result.answer.toLowerCase();
    const mentionsUrl = result.answer.includes("this-domain-definitely-does-not-exist-xyz123") ||
      answerLower.includes("unreachable") ||
      answerLower.includes("error") ||
      answerLower.includes("could not") ||
      answerLower.includes("failed") ||
      answerLower.includes("unable");
    console.log("Answer references error/URL:", mentionsUrl);
    expect(mentionsUrl).toBe(true);

    // 3. state.md should have fetcher error marker (✗ unreachable), not success
    const hasFetcherError = stateContent.includes("fetcher") &&
      (stateContent.includes("✗") || stateContent.includes("error") || stateContent.includes("unreachable"));
    const hasFetcherSuccess = stateContent.includes("fetcher") && stateContent.includes("✓") &&
      !stateContent.includes("✗");
    console.log("state.md has fetcher error marker:", hasFetcherError);
    console.log("state.md has fetcher success (should be false):", hasFetcherSuccess);

    // 4. state.md should NOT have summarizer ✓ (it should be skipped)
    const hasSummarizerSuccess = stateContent.includes("summarizer") && stateContent.includes("✓");
    console.log("state.md has summarizer ✓ (should be false):", hasSummarizerSuccess);

    // --- Summary ---
    console.log("\n========== ERROR PATH SUMMARY ==========");
    console.log("Program crashed:", false);
    console.log("Fetcher wrote __error.md:", hasError);
    console.log("VM detected error and degraded:", mentionsUrl);
    console.log("Fetcher error in state.md:", hasFetcherError);
    console.log("Summarizer skipped:", !hasSummarizerSuccess);
    console.log("Final answer (first 500):", result.answer.slice(0, 500));

    // Cleanup
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (e) {
      console.log("Failed to clean up:", e);
    }
  }, 300_000);
});
