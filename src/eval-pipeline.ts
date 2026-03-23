#!/usr/bin/env node
/**
 * eval-pipeline.ts — Deterministic eval pipeline orchestrator.
 *
 * Orchestrates eval batches with configurable concurrency.
 * Deterministic code handles running, indexing, token tracking.
 * LLM intelligence (researcher, judge, comparator) called via
 * pressRun() only when needed.
 *
 * Usage:
 *   npx tsx src/eval-pipeline.ts [options]
 *
 * Options:
 *   --spec <json>          Inline JSON eval spec (array of EvalConfig)
 *   --spec-file <path>     Path to JSON file with eval spec
 *   --tier <tier>          Eval tier: quick (3 cheap), standard (6 default), full (all)
 *   --auto                 Use the researcher to determine what to run
 *   --concurrency <n>      Max parallel eval runs (default: 3)
 *   --results-dir <path>   Where to store results (default: eval-results/)
 *   --judge                Run the judge on each result after completion
 *   --compare              Run the comparator across all results
 *   --budget <usd>         Cost budget for auto mode
 *   --spec-dir <path>      Path to Prose/Forme specs (default: ../prose/skills/open-prose)
 *   --model <id>           Override model for all evals (and researcher/judge/comparator)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pressRun } from "./press-boot.js";
import type { PressRunResult } from "./press-boot.js";
import { PressObserver } from "./observer.js";
import { generateRunId, formatDuration, loadEnvFile } from "./utils.js";
import type { PressEvent, TokenUsage } from "./events.js";
import type { CallLLM } from "./rlm.js";
import { fromOpenRouterCompatible } from "./drivers/openrouter-compatible.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalConfig {
	program: string;
	programPath: string;
	programDir: string;
	model: string;
	question: "Q1" | "Q2" | "Q3";
	callerInputs: Record<string, string>;
	maxIterations?: number;
	maxDepth?: number;
	timeoutMs?: number;
}

export interface EvalResult {
	config: EvalConfig;
	runId: string;
	status: "pass" | "fail" | "timeout" | "error";
	answer: string | null;
	manifest: string | null;
	iterations: { forme: number; vm: number };
	tokens: {
		inputTokens: number;
		cachedInputTokens: number;
		outputTokens: number;
	};
	events: PressEvent[];
	durationMs: number;
	error?: string;
}

export interface EvalBatchResult {
	timestamp: string;
	pressCommit: string;
	results: EvalResult[];
	totalTokens: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
	totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEvalRunId(): string {
	return `eval-${generateRunId()}`;
}

function makeCallLLM(model: string, apiKey: string): CallLLM {
	// Strip "openrouter/" prefix if present
	const modelId = model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;
	return fromOpenRouterCompatible({
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey,
		model: modelId,
	});
}

function extractTokens(events: PressEvent[]): { inputTokens: number; cachedInputTokens: number; outputTokens: number } {
	let inputTokens = 0;
	let cachedInputTokens = 0;
	let outputTokens = 0;

	for (const e of events) {
		if (e.type === "llm:response" && e.usage) {
			inputTokens += e.usage.promptTokens ?? 0;
			cachedInputTokens += e.usage.cacheReadTokens ?? 0;
			outputTokens += e.usage.completionTokens ?? 0;
		}
	}

	return { inputTokens, cachedInputTokens, outputTokens };
}

function getGitCommit(): string {
	try {
		return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
	} catch {
		return "unknown";
	}
}


// ---------------------------------------------------------------------------
// Eval tiers and specs
// ---------------------------------------------------------------------------

export type EvalTier = "quick" | "standard" | "full";

const PROJECT_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");

/** Quick tier: 3 cheap Sonnet evals (~$2, ~3 min). Used on every PR. */
const QUICK_EVAL_SPEC: EvalConfig[] = [
	{
		program: "trivial-pipeline",
		programPath: resolve(PROJECT_ROOT, "test/fixtures/trivial-program/index.md"),
		programDir: resolve(PROJECT_ROOT, "test/fixtures/trivial-program"),
		model: "anthropic/claude-sonnet-4.6",
		question: "Q2",
		callerInputs: { text: "hello world this is a test" },
	},
	{
		program: "parallel-analysis",
		programPath: resolve(PROJECT_ROOT, "test/fixtures/parallel-program/index.md"),
		programDir: resolve(PROJECT_ROOT, "test/fixtures/parallel-program"),
		model: "anthropic/claude-sonnet-4.6",
		question: "Q2",
		callerInputs: { text: "hello world\nthis is a test\nwith three lines" },
	},
	{
		program: "haiku-refiner",
		programPath: resolve(PROJECT_ROOT, "test/fixtures/worker-critic/index.md"),
		programDir: resolve(PROJECT_ROOT, "test/fixtures/worker-critic"),
		model: "anthropic/claude-sonnet-4.6",
		question: "Q2",
		callerInputs: { topic: "autumn rain" },
	},
];

/** Standard tier: all 6 current evals (~$4, ~5 min). */
const STANDARD_EVAL_SPEC: EvalConfig[] = [
	...QUICK_EVAL_SPEC,
	{
		program: "bilingual-haiku",
		programPath: resolve(PROJECT_ROOT, "test/fixtures/bilingual-haiku/index.md"),
		programDir: resolve(PROJECT_ROOT, "test/fixtures/bilingual-haiku"),
		model: "anthropic/claude-sonnet-4.6",
		question: "Q2",
		callerInputs: { topic: "autumn rain", language: "Japanese" },
	},
	{
		program: "error-handling",
		programPath: resolve(PROJECT_ROOT, "test/fixtures/error-handling/index.md"),
		programDir: resolve(PROJECT_ROOT, "test/fixtures/error-handling"),
		model: "anthropic/claude-sonnet-4.6",
		question: "Q2",
		callerInputs: { url: "https://this-domain-definitely-does-not-exist-xyz123.com/page" },
	},
	{
		program: "trivial-pipeline-flash",
		programPath: resolve(PROJECT_ROOT, "test/fixtures/trivial-program/index.md"),
		programDir: resolve(PROJECT_ROOT, "test/fixtures/trivial-program"),
		model: "google/gemini-3-flash-preview",
		question: "Q2",
		callerInputs: { text: "hello world this is a test" },
	},
];

/**
 * Full tier: standard + additional expensive evals.
 * TODO: Add could-haiku and other expensive evals when fixtures exist.
 */
const FULL_EVAL_SPEC: EvalConfig[] = [
	...STANDARD_EVAL_SPEC,
	// Future: could-haiku and other expensive/slow evals go here
];

const DEFAULT_EVAL_SPEC = STANDARD_EVAL_SPEC;

const TIER_SPECS: Record<EvalTier, EvalConfig[]> = {
	quick: QUICK_EVAL_SPEC,
	standard: STANDARD_EVAL_SPEC,
	full: FULL_EVAL_SPEC,
};

// ---------------------------------------------------------------------------
// Core: run a single eval
// ---------------------------------------------------------------------------

async function runSingleEval(
	config: EvalConfig,
	options: { specDir: string },
): Promise<EvalResult> {
	const runId = generateEvalRunId();
	const runDir = resolve(`.prose/runs/${runId}`);
	const observer = new PressObserver();
	const start = Date.now();

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error("OPENROUTER_API_KEY not set");
	}

	const callLLM = makeCallLLM(config.model, apiKey);
	const timeoutMs = config.timeoutMs ?? 300_000;

	try {
		const resultPromise = pressRun({
			callLLM,
			specDir: options.specDir,
			programPath: config.programPath,
			programDir: config.programDir,
			callerInputs: config.callerInputs,
			runId,
			runDir,
			maxIterations: config.maxIterations ?? 10,
			maxDepth: config.maxDepth ?? 3,
			observer,
		});

		// Race against timeout
		const result = await Promise.race([
			resultPromise,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout: eval exceeded time limit")), timeoutMs),
			),
		]);

		const events = observer.getEvents();
		const tokens = extractTokens(events);

		return {
			config,
			runId,
			status: "pass",
			answer: result.answer,
			manifest: result.manifest,
			iterations: {
				forme: result.phaseResults.forme.iterations,
				vm: result.phaseResults.vm.iterations,
			},
			tokens,
			events,
			durationMs: Date.now() - start,
		};
	} catch (err: unknown) {
		const events = observer.getEvents();
		const tokens = extractTokens(events);
		const message = err instanceof Error ? err.message : String(err);

		return {
			config,
			runId,
			status: message.includes("timeout") ? "timeout" : "error",
			answer: null,
			manifest: null,
			iterations: { forme: 0, vm: 0 },
			tokens,
			events,
			durationMs: Date.now() - start,
			error: message,
		};
	}
}

// ---------------------------------------------------------------------------
// Core: run eval batch with concurrency
// ---------------------------------------------------------------------------

async function runEvalBatch(
	configs: EvalConfig[],
	options: { concurrency: number; specDir: string; resultsDir: string },
): Promise<EvalResult[]> {
	const results: EvalResult[] = [];
	const queue = [...configs];
	const pool = new Set<Promise<void>>();

	const handleConfig = (config: EvalConfig): Promise<void> => {
		const p = (async () => {
			console.log(`  [start] ${config.program} (${config.model})`);
			const result = await runSingleEval(config, { specDir: options.specDir });
			results.push(result);

			const status = result.status === "pass" ? "PASS" : result.status.toUpperCase();
			const time = formatDuration(result.durationMs);
			const iters = `forme=${result.iterations.forme}, vm=${result.iterations.vm}`;
			const tok = `${result.tokens.inputTokens.toLocaleString()}in/${result.tokens.outputTokens.toLocaleString()}out`;
			console.log(`  [${status}] ${config.program} — ${time}, ${iters}, ${tok}`);
			if (result.error) {
				console.log(`         error: ${result.error.slice(0, 200)}`);
			}
		})().finally(() => {
			pool.delete(p);
		});
		return p;
	};

	for (const config of queue) {
		const p = handleConfig(config);
		pool.add(p);

		if (pool.size >= options.concurrency) {
			await Promise.race(pool);
		}
	}

	if (pool.size > 0) {
		await Promise.allSettled([...pool]);
	}

	return results;
}

// ---------------------------------------------------------------------------
// Step 3: Index results
// ---------------------------------------------------------------------------

function indexResults(batch: EvalBatchResult, resultsDir: string): void {
	const batchDir = join(resultsDir, batch.timestamp);
	mkdirSync(batchDir, { recursive: true });

	// Write batch summary
	const seen = new WeakSet();
	writeFileSync(join(batchDir, "batch.json"), JSON.stringify({
		timestamp: batch.timestamp,
		pressCommit: batch.pressCommit,
		totalTokens: batch.totalTokens,
		totalDurationMs: batch.totalDurationMs,
		results: batch.results.map(r => ({
			runId: r.runId,
			program: r.config.program,
			model: r.config.model,
			question: r.config.question,
			status: r.status,
			durationMs: r.durationMs,
			tokens: r.tokens,
			answer: r.answer?.slice(0, 500),
			iterations: r.iterations,
		})),
	}, null, 2));

	// Write individual result records
	for (const result of batch.results) {
		const resultDir = join(batchDir, result.runId);
		mkdirSync(resultDir, { recursive: true });

		writeFileSync(join(resultDir, "meta.json"), JSON.stringify({
			...result.config,
			runId: result.runId,
			status: result.status,
			durationMs: result.durationMs,
			tokens: result.tokens,
			answer: result.answer?.slice(0, 1000),
			iterations: result.iterations,
			error: result.error,
		}, null, 2));

		// Write events as JSONL (cycle-safe)
		const eventsFile = join(resultDir, "events.jsonl");
		const eventsSeen = new WeakSet();
		writeFileSync(eventsFile, result.events.map(e => {
			return JSON.stringify(e, (_key, value) => {
				if (typeof value === "object" && value !== null) {
					if (eventsSeen.has(value)) return "[circular]";
					eventsSeen.add(value);
				}
				return value;
			});
		}).join("\n"));

		// Write token attribution
		writeFileSync(join(resultDir, "tokens.json"), JSON.stringify(result.tokens, null, 2));
	}
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
	spec: EvalConfig[] | null;
	specFile: string | null;
	tier: EvalTier | null;
	auto: boolean;
	concurrency: number;
	resultsDir: string;
	judge: boolean;
	compare: boolean;
	budget: number | null;
	specDir: string;
	model: string;
	modelOverride: boolean;
}

function resolveSpecDir(): string {
	// Try sibling repo first (local dev), then ./prose/ (CI checkout)
	const siblingPath = resolve(PROJECT_ROOT, "..", "prose", "skills", "open-prose");
	if (existsSync(siblingPath)) return siblingPath;
	const ciPath = resolve(PROJECT_ROOT, "prose", "skills", "open-prose");
	if (existsSync(ciPath)) return ciPath;
	// Fall back to sibling path (will fail later with a clear error)
	return siblingPath;
}

function parseCliArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		spec: null,
		specFile: null,
		tier: null,
		auto: false,
		concurrency: 3,
		resultsDir: "eval-results",
		judge: false,
		compare: false,
		budget: null,
		specDir: resolveSpecDir(),
		model: "anthropic/claude-sonnet-4.6",
		modelOverride: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		}
		if (arg === "--auto") {
			opts.auto = true;
		} else if (arg === "--judge") {
			opts.judge = true;
		} else if (arg === "--compare") {
			opts.compare = true;
		} else if (arg === "--spec" && i + 1 < argv.length) {
			opts.spec = JSON.parse(argv[++i]);
		} else if (arg === "--spec-file" && i + 1 < argv.length) {
			opts.specFile = argv[++i];
		} else if (arg === "--tier" && i + 1 < argv.length) {
			const tier = argv[++i] as EvalTier;
			if (!["quick", "standard", "full"].includes(tier)) {
				console.error(`ERROR: Invalid tier "${tier}". Must be quick, standard, or full.`);
				process.exit(1);
			}
			opts.tier = tier;
		} else if (arg === "--concurrency" && i + 1 < argv.length) {
			opts.concurrency = parseInt(argv[++i], 10);
		} else if (arg === "--results-dir" && i + 1 < argv.length) {
			opts.resultsDir = argv[++i];
		} else if (arg === "--budget" && i + 1 < argv.length) {
			opts.budget = parseFloat(argv[++i]);
		} else if (arg === "--spec-dir" && i + 1 < argv.length) {
			opts.specDir = argv[++i];
		} else if (arg === "--model" && i + 1 < argv.length) {
			opts.model = argv[++i];
			opts.modelOverride = true;
		}
	}

	return opts;
}

function printUsage(): void {
	console.log(`Eval Pipeline — Deterministic eval orchestrator

Usage: npx tsx src/eval-pipeline.ts [options]

Options:
  --tier <tier>          Eval tier: quick (3 cheap), standard (6 default), full (all)
  --spec <json>          Inline JSON eval spec (array of EvalConfig)
  --spec-file <path>     Path to JSON file with eval spec
  --auto                 Use the researcher to determine what to run (default if no spec)
  --concurrency <n>      Max parallel eval runs (default: 3)
  --results-dir <path>   Where to store results (default: eval-results/)
  --judge                Run the judge on each result after completion
  --compare              Run the comparator across all results
  --budget <usd>         Cost budget for auto mode
  --spec-dir <path>      Path to Prose/Forme specs
  --model <id>           Override model for all evals

Tiers:
  quick      3 cheap Sonnet evals (trivial, parallel, haiku-refiner) — ~$2, ~3 min
  standard   All 6 current evals — ~$4, ~5 min (default)
  full       Standard + expensive evals — ~$6+, ~15 min

If no --tier, --spec, --spec-file, or --auto is provided, runs the standard tier.
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	loadEnvFile();

	const opts = parseCliArgs(process.argv.slice(2));

	console.log("Eval Pipeline");
	console.log("=============");
	console.log();
	console.log(`  Concurrency:   ${opts.concurrency}`);
	console.log(`  Results dir:   ${opts.resultsDir}`);
	console.log(`  Spec dir:      ${opts.specDir}`);
	console.log(`  Model:         ${opts.model}`);
	if (opts.judge) console.log(`  Judge:         enabled`);
	if (opts.compare) console.log(`  Compare:       enabled`);
	console.log();

	// Step 1: Determine what to run
	let configs: EvalConfig[];

	if (opts.spec) {
		configs = opts.spec;
		console.log(`Using inline spec: ${configs.length} eval(s)`);
	} else if (opts.specFile) {
		const content = readFileSync(opts.specFile, "utf-8");
		configs = JSON.parse(content);
		console.log(`Loaded spec from ${opts.specFile}: ${configs.length} eval(s)`);
	} else if (opts.auto) {
		// Auto mode: would call pressRun() with researcher program
		// For now, fall back to defaults
		console.log("Auto mode not yet implemented — using default spec");
		configs = DEFAULT_EVAL_SPEC;
	} else if (opts.tier) {
		configs = TIER_SPECS[opts.tier];
		console.log(`Using ${opts.tier} tier: ${configs.length} eval(s)`);
	} else {
		configs = DEFAULT_EVAL_SPEC;
		console.log(`Using default spec: ${configs.length} eval(s)`);
	}

	// Apply --model override to all configs if provided
	if (opts.modelOverride) {
		configs = configs.map(c => ({ ...c, model: opts.model }));
		console.log(`  Model override: ${opts.model}`);
	}

	console.log();
	for (const c of configs) {
		console.log(`  - ${c.program} (${c.model}) question=${c.question}`);
	}
	console.log();

	// Validate spec-dir exists
	if (!existsSync(opts.specDir)) {
		console.error(`ERROR: spec-dir does not exist: ${opts.specDir}`);
		console.error("Provide --spec-dir pointing to your Prose/Forme specs directory.");
		process.exit(1);
	}

	// Step 2: Run evals
	console.log("Running evals...");
	console.log();
	const batchStart = Date.now();

	const results = await runEvalBatch(configs, {
		concurrency: opts.concurrency,
		specDir: opts.specDir,
		resultsDir: opts.resultsDir,
	});

	const batchDurationMs = Date.now() - batchStart;

	// Aggregate tokens
	const totalTokens = {
		inputTokens: results.reduce((s, r) => s + r.tokens.inputTokens, 0),
		cachedInputTokens: results.reduce((s, r) => s + r.tokens.cachedInputTokens, 0),
		outputTokens: results.reduce((s, r) => s + r.tokens.outputTokens, 0),
	};

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const batch: EvalBatchResult = {
		timestamp,
		pressCommit: getGitCommit(),
		results,
		totalTokens,
		totalDurationMs: batchDurationMs,
	};

	// Step 3: Index results
	console.log();
	console.log("Indexing results...");
	mkdirSync(opts.resultsDir, { recursive: true });
	indexResults(batch, opts.resultsDir);
	console.log(`  Written to ${join(opts.resultsDir, timestamp)}/`);

	// Step 4: Judge (optional, placeholder)
	if (opts.judge) {
		console.log();
		console.log("Judge step not yet implemented — skipping.");
	}

	// Step 5: Compare (optional, placeholder)
	if (opts.compare) {
		console.log();
		console.log("Compare step not yet implemented — skipping.");
	}

	// Summary
	console.log();
	console.log("=".repeat(60));
	console.log("  EVAL PIPELINE RESULTS");
	console.log("=".repeat(60));
	console.log();

	const passed = results.filter(r => r.status === "pass").length;
	const failed = results.filter(r => r.status === "fail").length;
	const errored = results.filter(r => r.status === "error").length;
	const timedOut = results.filter(r => r.status === "timeout").length;

	console.log(`  Total evals:   ${results.length}`);
	console.log(`  Passed:        ${passed}`);
	if (failed > 0) console.log(`  Failed:        ${failed}`);
	if (errored > 0) console.log(`  Errors:        ${errored}`);
	if (timedOut > 0) console.log(`  Timeouts:      ${timedOut}`);
	console.log();
	console.log(`  Total time:    ${formatDuration(batchDurationMs)}`);
	console.log(`  Total tokens:  ${totalTokens.inputTokens.toLocaleString()}in/${totalTokens.outputTokens.toLocaleString()}out`);
	console.log(`  Cached input:  ${totalTokens.cachedInputTokens.toLocaleString()}`);
	console.log();

	for (const r of results) {
		const status = r.status === "pass" ? "PASS" : r.status.toUpperCase();
		const time = formatDuration(r.durationMs);
		const tok = `${r.tokens.inputTokens.toLocaleString()}in/${r.tokens.outputTokens.toLocaleString()}out`;
		console.log(`  [${status}] ${r.config.program} — ${time}, forme=${r.iterations.forme} vm=${r.iterations.vm}, ${tok}`);
		if (r.answer) {
			console.log(`         answer: ${r.answer.slice(0, 120)}${r.answer.length > 120 ? "..." : ""}`);
		}
		if (r.error) {
			console.log(`         error: ${r.error.slice(0, 120)}`);
		}
	}

	console.log();
	console.log(`  Results: ${join(opts.resultsDir, timestamp)}/`);
	console.log("=".repeat(60));

	// Exit with error code if any eval failed
	if (errored > 0 || timedOut > 0) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("\nFatal error:", err instanceof Error ? err.message : err);
	if (err instanceof Error && err.stack) {
		console.error(err.stack);
	}
	process.exit(1);
});
