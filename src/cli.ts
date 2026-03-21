#!/usr/bin/env node

/**
 * Press CLI — Runtime for Prose programs.
 *
 * Usage:
 *   press run <program.md> [--key value ...]
 *   press --version
 *   press --help
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pressRun } from "./press-boot.js";
import { RlmObserver } from "./observer.js";
import { fromOpenRouterCompatible } from "./drivers/openrouter-compatible.js";
import type { RlmEvent, TokenUsage } from "./events.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");

const RESERVED_FLAGS = new Set([
	"model",
	"max-iterations",
	"max-depth",
	"spec-dir",
	"run-id",
	"verbose",
]);

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_MAX_ITERATIONS = 15;
const DEFAULT_MAX_DEPTH = 3;

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------

function loadEnvFile(): void {
	const envPath = resolve(process.cwd(), ".env");
	try {
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let value = trimmed.slice(eqIdx + 1).trim();
			// Strip surrounding quotes
			if ((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	} catch {
		// File not found, continue
	}
}

// ---------------------------------------------------------------------------
// Help / version
// ---------------------------------------------------------------------------

function printHelp(): void {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"));
	console.log(`Press v${pkg.version} — Runtime for Prose programs

Usage:
  press run <program.md> [--key value ...]    Run a Prose program
  press --version                              Show version
  press --help                                 Show this help

Options:
  --model <id>            Model (default: $PRESS_MODEL or ${DEFAULT_MODEL})
  --max-iterations <n>    Iteration budget per phase (default: ${DEFAULT_MAX_ITERATIONS})
  --max-depth <n>         Delegation depth (default: ${DEFAULT_MAX_DEPTH})
  --spec-dir <path>       Path to Prose/Forme specs
  --run-id <id>           Custom run ID
  --verbose               Show per-iteration progress on stderr

Environment:
  OPENROUTER_API_KEY      Required. API key for model access.
  PRESS_MODEL             Default model (overridden by --model)
  PRESS_SPEC_DIR          Default spec directory (overridden by --spec-dir)

Examples:
  press run my-program/index.md --text "hello world"
  press run programs/could-haiku/index.md --url "https://docs.astro.build" --depth shallow`);
}

function printVersion(): void {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"));
	console.log(pkg.version);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
	programPath: string;
	programDir: string;
	callerInputs: Record<string, string>;
	model: string;
	maxIterations: number;
	maxDepth: number;
	specDir: string;
	runId?: string;
	verbose: boolean;
}

function parseRunArgs(argv: string[]): ParsedArgs {
	// First positional arg is the program path
	if (argv.length === 0 || argv[0].startsWith("--")) {
		console.error("Error: missing program path. Usage: press run <program.md> [--key value ...]");
		process.exit(1);
	}

	const rawProgramPath = argv[0];
	const programPath = resolve(rawProgramPath);
	const programDir = dirname(programPath);

	if (!existsSync(programPath)) {
		console.error(`Error: program file not found: ${programPath}`);
		process.exit(1);
	}

	// Parse remaining args
	const callerInputs: Record<string, string> = {};
	let model = process.env.PRESS_MODEL || DEFAULT_MODEL;
	let maxIterations = DEFAULT_MAX_ITERATIONS;
	let maxDepth = DEFAULT_MAX_DEPTH;
	let specDir = process.env.PRESS_SPEC_DIR || resolve(PACKAGE_ROOT, "..", "prose", "skills", "open-prose");
	let runId: string | undefined;
	let verbose = false;

	const rest = argv.slice(1);

	// Check for -- separator
	const dashDashIdx = rest.indexOf("--");
	let flagArgs: string[];
	let extraArgs: string[];

	if (dashDashIdx !== -1) {
		flagArgs = rest.slice(0, dashDashIdx);
		extraArgs = rest.slice(dashDashIdx + 1);
	} else {
		flagArgs = rest;
		extraArgs = [];
	}

	// Parse --key value pairs from flagArgs
	for (let i = 0; i < flagArgs.length; i++) {
		const arg = flagArgs[i];
		if (!arg.startsWith("--")) {
			console.error(`Error: unexpected positional argument: ${arg}`);
			process.exit(1);
		}

		const key = arg.slice(2);

		if (key === "verbose") {
			verbose = true;
			continue;
		}

		if (i + 1 >= flagArgs.length) {
			console.error(`Error: missing value for --${key}`);
			process.exit(1);
		}

		const value = flagArgs[++i];

		if (key === "model") {
			model = value;
		} else if (key === "max-iterations") {
			maxIterations = parseInt(value, 10);
			if (isNaN(maxIterations) || maxIterations <= 0) {
				console.error("Error: --max-iterations must be a positive integer");
				process.exit(1);
			}
		} else if (key === "max-depth") {
			maxDepth = parseInt(value, 10);
			if (isNaN(maxDepth) || maxDepth <= 0) {
				console.error("Error: --max-depth must be a positive integer");
				process.exit(1);
			}
		} else if (key === "spec-dir") {
			specDir = resolve(value);
		} else if (key === "run-id") {
			runId = value;
		} else {
			// User input
			callerInputs[key] = value;
		}
	}

	// Parse extra args after --
	for (let i = 0; i < extraArgs.length; i++) {
		const arg = extraArgs[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			if (i + 1 >= extraArgs.length) {
				console.error(`Error: missing value for --${key}`);
				process.exit(1);
			}
			callerInputs[key] = extraArgs[++i];
		} else {
			console.error(`Error: unexpected positional argument after --: ${arg}`);
			process.exit(1);
		}
	}

	return {
		programPath,
		programDir,
		callerInputs,
		model,
		maxIterations,
		maxDepth,
		specDir,
		runId,
		verbose,
	};
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

function extractTokens(events: RlmEvent[]): {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
} {
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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

function formatNumber(n: number): string {
	return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	loadEnvFile();

	const argv = process.argv.slice(2);

	// Handle top-level flags
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		process.exit(0);
	}

	if (argv[0] === "--version" || argv[0] === "-V") {
		printVersion();
		process.exit(0);
	}

	// Expect a subcommand
	const command = argv[0];
	if (command !== "run") {
		console.error(`Error: unknown command "${command}". Run "press --help" for usage.`);
		process.exit(1);
	}

	// Parse run args
	const args = parseRunArgs(argv.slice(1));

	// Validate API key
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error(
			"Error: OPENROUTER_API_KEY is not set.\n\n" +
			"Set it in your environment or in a .env file in the current directory:\n" +
			"  export OPENROUTER_API_KEY=sk-or-...\n" +
			"  # or\n" +
			"  echo 'OPENROUTER_API_KEY=sk-or-...' >> .env",
		);
		process.exit(1);
	}

	// Validate spec-dir
	if (!existsSync(args.specDir)) {
		console.error(
			`Error: spec directory not found: ${args.specDir}\n\n` +
			"Set --spec-dir or PRESS_SPEC_DIR to the path containing prose.md, forme.md, etc.",
		);
		process.exit(1);
	}

	// Strip "openrouter/" prefix if present (model IDs go directly to OpenRouter)
	const modelId = args.model.startsWith("openrouter/")
		? args.model.slice("openrouter/".length)
		: args.model;

	// Create the LLM driver
	const callLLM = fromOpenRouterCompatible({
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey,
		model: modelId,
	});

	// Set up observer
	const observer = new RlmObserver();

	// Verbose progress on stderr
	if (args.verbose) {
		observer.on("iteration:end", (event) => {
			process.stderr.write(
				`  [iter ${event.iteration}] ${event.returned ? "returned" : "continuing"}${event.error ? ` (error: ${event.error})` : ""}\n`,
			);
		});
	}

	// Print startup info to stderr
	const relProgram = argv.slice(1).find((a) => !a.startsWith("--")) ?? args.programPath;
	process.stderr.write(`Press: Running ${relProgram}\n`);

	const start = Date.now();

	try {
		const result = await pressRun({
			callLLM,
			specDir: args.specDir,
			programPath: args.programPath,
			programDir: args.programDir,
			callerInputs: args.callerInputs,
			runId: args.runId,
			maxIterations: args.maxIterations,
			maxDepth: args.maxDepth,
			observer,
		});

		const elapsed = Date.now() - start;
		const events = observer.getEvents();
		const tokens = extractTokens(events);

		// Final output to stdout
		process.stdout.write(result.answer);
		// Ensure trailing newline
		if (!result.answer.endsWith("\n")) {
			process.stdout.write("\n");
		}

		// Summary to stderr
		const formeIters = result.phaseResults.forme.iterations;
		const vmIters = result.phaseResults.vm.iterations;

		process.stderr.write(`Phase 1 (Forme): ${formeIters} iterations, ${formatDuration(elapsed)}\n`);
		process.stderr.write(`Phase 2 (VM): ${vmIters} iterations, ${formatDuration(elapsed)}\n`);
		process.stderr.write(
			`Tokens: ${formatNumber(tokens.inputTokens)}in / ${formatNumber(tokens.outputTokens)}out` +
			(tokens.cachedInputTokens > 0 ? ` (cached: ${formatNumber(tokens.cachedInputTokens)})` : "") +
			"\n",
		);
		process.stderr.write(`Total: ${formatDuration(elapsed)}\n`);

		process.exit(0);
	} catch (err: unknown) {
		const elapsed = Date.now() - start;
		const message = err instanceof Error ? err.message : String(err);

		process.stderr.write(`\nError after ${formatDuration(elapsed)}: ${message}\n`);

		// Print token summary even on failure
		const events = observer.getEvents();
		const tokens = extractTokens(events);
		if (tokens.inputTokens > 0 || tokens.outputTokens > 0) {
			process.stderr.write(
				`Tokens: ${formatNumber(tokens.inputTokens)}in / ${formatNumber(tokens.outputTokens)}out\n`,
			);
		}

		process.exit(1);
	}
}

main().catch((err) => {
	console.error("Fatal:", err instanceof Error ? err.message : err);
	process.exit(1);
});
