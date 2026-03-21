#!/usr/bin/env node
/**
 * eval-pipeline.ts — Deterministic eval pipeline orchestrator.
 *
 * Orchestrates eval batches with configurable concurrency.
 * Deterministic code handles running, indexing, cost tracking.
 * LLM intelligence (researcher, judge, comparator) called via
 * pressRun() only when needed.
 *
 * Usage:
 *   npx tsx src/eval-pipeline.ts [options]
 *
 * Options:
 *   --spec <json>          Inline JSON eval spec (array of EvalConfig)
 *   --spec-file <path>     Path to JSON file with eval spec
 *   --auto                 Use the researcher to determine what to run
 *   --concurrency <n>      Max parallel eval runs (default: 3)
 *   --results-dir <path>   Where to store results (default: eval-results/)
 *   --judge                Run the judge on each result after completion
 *   --compare              Run the comparator across all results
 *   --budget <usd>         Cost budget for auto mode
 *   --spec-dir <path>      Path to Prose/Forme specs (default: ../prose/skills/open-prose)
 *   --model <id>           Default model for researcher/judge/comparator
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pressRun } from "./press-boot.js";
import type { PressRunResult } from "./press-boot.js";
import { RlmObserver } from "./observer.js";
import type { RlmEvent, TokenUsage } from "./events.js";
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
	cost: {
		inputTokens: number;
		cachedInputTokens: number;
		outputTokens: number;
		estimatedUsd: number;
	};
	events: RlmEvent[];
	durationMs: number;
	error?: string;
}

export interface EvalBatchResult {
	timestamp: string;
	pressCommit: string;
	results: EvalResult[];
	totalCost: { inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedUsd: number };
	totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRunId(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10).replace(/-/g, "");
	const time = now.toISOString().slice(11, 19).replace(/:/g, "");
	const rand = Math.random().toString(36).slice(2, 8);
	return `eval-${date}-${time}-${rand}`;
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

function extractCost(events: RlmEvent[]): { inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedUsd: number } {
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

	// Rough cost estimate (Sonnet pricing as default)
	const estimatedUsd = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);

	return { inputTokens, cachedInputTokens, outputTokens, estimatedUsd: Math.round(estimatedUsd * 10000) / 10000 };
}

function getGitCommit(): string {
	try {
		return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
	} catch {
		return "unknown";
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

/** Minimal .env loader. */
function loadEnvFile(): void {
	const envPath = resolve(join(import.meta.url.replace("file://", ""), "..", "..", ".env"));
	try {
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			const value = trimmed.slice(eqIdx + 1).trim();
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	} catch {
		// File not found, continue
	}
}

// ---------------------------------------------------------------------------
// Default eval spec
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");

const DEFAULT_EVAL_SPEC: EvalConfig[] = [
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

// ---------------------------------------------------------------------------
// Core: run a single eval
// ---------------------------------------------------------------------------

async function runSingleEval(
	config: EvalConfig,
	options: { specDir: string },
): Promise<EvalResult> {
	const runId = generateRunId();
	const runDir = resolve(`.prose/runs/${runId}`);
	const observer = new RlmObserver();
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
		const cost = extractCost(events);

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
			cost,
			events,
			durationMs: Date.now() - start,
		};
	} catch (err: unknown) {
		const events = observer.getEvents();
		const cost = extractCost(events);
		const message = err instanceof Error ? err.message : String(err);

		return {
			config,
			runId,
			status: message.includes("timeout") ? "timeout" : "error",
			answer: null,
			manifest: null,
			iterations: { forme: 0, vm: 0 },
			cost,
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
			const cost = `$${result.cost.estimatedUsd.toFixed(4)}`;
			const time = formatDuration(result.durationMs);
			const iters = `forme=${result.iterations.forme}, vm=${result.iterations.vm}`;
			console.log(`  [${status}] ${config.program} — ${time}, ${iters}, ${cost}`);
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
		totalCost: batch.totalCost,
		totalDurationMs: batch.totalDurationMs,
		results: batch.results.map(r => ({
			runId: r.runId,
			program: r.config.program,
			model: r.config.model,
			question: r.config.question,
			status: r.status,
			durationMs: r.durationMs,
			cost: r.cost,
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
			cost: result.cost,
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

		// Write cost attribution
		writeFileSync(join(resultDir, "cost.json"), JSON.stringify(result.cost, null, 2));
	}
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
	spec: EvalConfig[] | null;
	specFile: string | null;
	auto: boolean;
	concurrency: number;
	resultsDir: string;
	judge: boolean;
	compare: boolean;
	budget: number | null;
	specDir: string;
	model: string;
}

function parseCliArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		spec: null,
		specFile: null,
		auto: false,
		concurrency: 3,
		resultsDir: "eval-results",
		judge: false,
		compare: false,
		budget: null,
		specDir: resolve(join(import.meta.url.replace("file://", ""), "..", "..", "..", "prose", "skills", "open-prose")),
		model: "anthropic/claude-sonnet-4.6",
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
		}
	}

	return opts;
}

function printUsage(): void {
	console.log(`Eval Pipeline — Deterministic eval orchestrator

Usage: npx tsx src/eval-pipeline.ts [options]

Options:
  --spec <json>          Inline JSON eval spec (array of EvalConfig)
  --spec-file <path>     Path to JSON file with eval spec
  --auto                 Use the researcher to determine what to run (default if no spec)
  --concurrency <n>      Max parallel eval runs (default: 3)
  --results-dir <path>   Where to store results (default: eval-results/)
  --judge                Run the judge on each result after completion
  --compare              Run the comparator across all results
  --budget <usd>         Cost budget for auto mode
  --spec-dir <path>      Path to Prose/Forme specs
  --model <id>           Default model for researcher/judge/comparator

If no --spec, --spec-file, or --auto is provided, runs the default spec
(trivial-pipeline, parallel-analysis, haiku-refiner).
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
	} else {
		configs = DEFAULT_EVAL_SPEC;
		console.log(`Using default spec: ${configs.length} eval(s)`);
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

	// Aggregate cost
	const totalCost = {
		inputTokens: results.reduce((s, r) => s + r.cost.inputTokens, 0),
		cachedInputTokens: results.reduce((s, r) => s + r.cost.cachedInputTokens, 0),
		outputTokens: results.reduce((s, r) => s + r.cost.outputTokens, 0),
		estimatedUsd: Math.round(results.reduce((s, r) => s + r.cost.estimatedUsd, 0) * 10000) / 10000,
	};

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const batch: EvalBatchResult = {
		timestamp,
		pressCommit: getGitCommit(),
		results,
		totalCost,
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
	console.log(`  Total cost:    $${totalCost.estimatedUsd.toFixed(4)}`);
	console.log(`  Input tokens:  ${totalCost.inputTokens.toLocaleString()}`);
	console.log(`  Output tokens: ${totalCost.outputTokens.toLocaleString()}`);
	console.log();

	for (const r of results) {
		const status = r.status === "pass" ? "PASS" : r.status.toUpperCase();
		const time = formatDuration(r.durationMs);
		const cost = `$${r.cost.estimatedUsd.toFixed(4)}`;
		console.log(`  [${status}] ${r.config.program} — ${time}, forme=${r.iterations.forme} vm=${r.iterations.vm}, ${cost}`);
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
