/**
 * press-boot.ts — Deterministic two-phase bootloader for Prose programs.
 *
 * Sequences Forme (wiring) then Prose VM (execution) as two separate
 * press() calls. No LLM call for the bootloader itself — just code.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { press } from "./rlm.js";
import { buildPressPrompt } from "./press-prompt.js";
import type { CallLLM, RlmResult } from "./rlm.js";
import type { RlmEventSink } from "./events.js";

export interface PressRunOptions {
  callLLM: CallLLM;
  specDir: string;          // directory containing prose.md, forme.md, etc.
  programPath: string;      // path to the program entry point (.md file)
  programDir: string;       // directory containing the program and service files
  callerInputs: Record<string, string>;  // user inputs
  runId?: string;           // optional run ID (auto-generated if not provided)
  runDir?: string;          // optional run directory (derived from runId if not provided)
  maxIterations?: number;   // iteration budget per phase (default 15)
  maxDepth?: number;        // delegation depth per phase (default 3)
  observer?: RlmEventSink;  // optional event observer
}

export interface PressRunResult {
  answer: string;
  manifest: string | null;
  phaseResults: {
    forme: { answer: string; iterations: number };
    vm: { answer: string; iterations: number };
  };
}

export async function pressRun(options: PressRunOptions): Promise<PressRunResult> {
  const {
    callLLM,
    specDir,
    programPath,
    programDir,
    callerInputs,
    maxIterations = 15,
    maxDepth = 3,
    observer,
  } = options;

  const runId = options.runId || generateRunId();
  const runDir = options.runDir || `.prose/runs/${runId}`;

  // --- Phase 1: Forme (wiring) ---

  // Read the entry point
  const entryPoint = readFileSync(programPath, "utf8");

  // Build the Forme system prompt using buildPressPrompt().
  // This replaces the default system prompt entirely with <forme-spec>,
  // <filesystem-spec>, <press-runtime> glossary, and <run-context>.
  const formePrompt = buildPressPrompt({
    phase: "forme",
    runId,
    runDir,
    programDir,
    specDir,
    entryPoint,
  });

  // Run Phase 1 — the model becomes the Forme container.
  // Context provides paths so the model can resolve files.
  const formeResult: RlmResult = await press(
    entryPoint,  // query: the program entry point
    {
      program_dir: programDir,
      run_dir: runDir,
      run_id: runId,
    },
    {
      callLLM,
      maxIterations,
      maxDepth: 1,  // Forme doesn't need deep delegation
      systemPrompt: formePrompt,
      observer,
    },
  );

  // Read the manifest (produced by the Forme model)
  const manifestPath = join(runDir, "manifest.md");
  let manifest: string | null = null;
  if (existsSync(manifestPath)) {
    manifest = readFileSync(manifestPath, "utf8");
  }

  if (!manifest) {
    throw new Error(
      `Forme phase did not produce a manifest at ${manifestPath}. ` +
      `Forme returned: ${formeResult.answer}`,
    );
  }

  // --- Phase 2: Prose VM (execution) ---

  // Build the VM system prompt.
  const vmPrompt = buildPressPrompt({
    phase: "prose-vm",
    runId,
    runDir,
    specDir,
    manifest,
    callerInputs,
  });

  // Run Phase 2 — the model becomes the Prose VM.
  const vmResult: RlmResult = await press(
    manifest,  // query: the manifest
    {
      caller_inputs: callerInputs,
      run_dir: runDir,
      program_dir: programDir,
      spec_dir: specDir,
    },
    {
      callLLM,
      maxIterations,
      maxDepth,  // VM needs depth for service delegation
      systemPrompt: vmPrompt,
      observer,
    },
  );

  return {
    answer: vmResult.answer,
    manifest,
    phaseResults: {
      forme: { answer: formeResult.answer, iterations: formeResult.iterations },
      vm: { answer: vmResult.answer, iterations: vmResult.iterations },
    },
  };
}

function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}-${time}-${rand}`;
}
