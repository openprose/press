#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evalDir = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(evalDir, "results");
const outputDir = join(evalDir, "trajectory-analysis");
const inputDir = join(outputDir, "input");
const tasksDir = join(inputDir, "tasks");

function fail(message) {
	console.error(`[prepare-trajectory-analysis] ${message}`);
	process.exit(1);
}

function latestResultFile() {
	let best = null;
	for (const entry of readdirSync(resultsDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const fullPath = join(resultsDir, entry.name);
		const mtimeMs = statSync(fullPath).mtimeMs;
		if (!best || mtimeMs > best.mtimeMs) {
			best = { fullPath, mtimeMs };
		}
	}
	if (!best) {
		fail(`No .json result files found in ${resultsDir}`);
	}
	return best.fullPath;
}

function inferAnswerType(result, benchmark) {
	const metadataAnswerType = result?.metadata?.answerType;
	if (typeof metadataAnswerType === "string" && metadataAnswerType.length > 0) {
		return metadataAnswerType;
	}

	if (benchmark === "arc" || benchmark === "arc3" || benchmark === "arc-compound") {
		return "ANSWER_TYPE.GRID";
	}

	const expected = Array.isArray(result.expected) ? result.expected[0] : result.expected;
	if (typeof expected === "string" && /^-?\d+(?:\.\d+)?$/.test(expected.trim())) {
		return "ANSWER_TYPE.NUMERIC";
	}

	return "ANSWER_TYPE.TEXT";
}

function classifyOutcome(score, error) {
	if (score === 1) return "perfect";
	if (score > 0) return "partial";
	if (error) return "wrong/timeout/error";
	return "wrong/timeout/error";
}

function sanitizeTaskId(taskId) {
	return String(taskId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function round(value) {
	return Math.round(value * 10000) / 10000;
}

const sourceFile = latestResultFile();
const raw = readFileSync(sourceFile, "utf8");
let data;

try {
	data = JSON.parse(raw);
} catch (error) {
	fail(`Failed to parse ${basename(sourceFile)}: ${error instanceof Error ? error.message : String(error)}`);
}

if (!data || typeof data !== "object") fail("Parsed result is not an object");
if (!Array.isArray(data.results)) fail("Result file is missing a results array");
if (!data.benchmark || !data.model || !data.timestamp) {
	fail("Result file is missing benchmark, model, or timestamp metadata");
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(tasksDir, { recursive: true });

const summaries = data.results.map((result, index) => {
	if (!result || typeof result !== "object") {
		fail(`results[${index}] is not an object`);
	}
	if (typeof result.taskId !== "string" || result.taskId.length === 0) {
		fail(`results[${index}] is missing taskId`);
	}
	if (!Array.isArray(result.trace)) {
		fail(`results[${index}] (${result.taskId}) is missing trace[]; refusing to continue without raw traces`);
	}
	if (typeof result.score !== "number") {
		fail(`results[${index}] (${result.taskId}) is missing numeric score`);
	}

	const taskId = result.taskId;
	const safeTaskId = sanitizeTaskId(taskId);
	const answerType = inferAnswerType(result, data.benchmark);
	const iterations = typeof result.iterations === "number" ? result.iterations : result.trace.length;
	const outcome = classifyOutcome(result.score, result.error);
	const relativeTaskDir = `input/tasks/${safeTaskId}`;
	const taskDir = join(tasksDir, safeTaskId);
	const iterationsDir = join(taskDir, "iterations");
	mkdirSync(iterationsDir, { recursive: true });

	const summaryPayload = {
		benchmark: data.benchmark,
		model: data.model,
		timestamp: data.timestamp,
		config: data.config ?? null,
		taskId,
		answerType,
		outcome,
		score: result.score,
		iterations,
		wallTimeMs: result.wallTimeMs ?? null,
		answer: result.answer ?? null,
		expected: result.expected ?? null,
		error: result.error ?? null,
		charCount: result.charCount ?? null,
		metadata: result.metadata ?? null,
	};

	writeFileSync(join(taskDir, "summary.json"), `${JSON.stringify(summaryPayload, null, 2)}\n`);

	const iterationFiles = result.trace.map((entry, traceIndex) => {
		const relativeIterationFile = `${relativeTaskDir}/iterations/${String(traceIndex + 1).padStart(2, "0")}.json`;
		const iterationFile = join(iterationsDir, `${String(traceIndex + 1).padStart(2, "0")}.json`);
		writeFileSync(iterationFile, `${JSON.stringify(entry, null, 2)}\n`);
		return relativeIterationFile;
	});

	return {
		taskId,
		answerType,
		outcome,
		score: result.score,
		iterations,
		wallTimeMs: result.wallTimeMs ?? null,
		error: result.error ?? null,
		taskDir: relativeTaskDir,
		summaryFile: `${relativeTaskDir}/summary.json`,
		iterationFiles,
	};
});

const sample = summaries.map(({ taskId, answerType, outcome, score, iterations }) => ({
	taskId,
	answerType,
	outcome,
	score,
	iterations,
}));

const aggregate = data.aggregate ?? {};
const meta = {
	benchmark: data.benchmark,
	model: data.model,
	timestamp: data.timestamp,
	sampleSize: summaries.length,
	meanScore: typeof aggregate.meanScore === "number" ? aggregate.meanScore : round(sample.reduce((sum, entry) => sum + entry.score, 0) / Math.max(sample.length, 1)),
	medianScore: aggregate.medianScore ?? null,
	stdScore: aggregate.stdScore ?? null,
	totalWallTimeMs: aggregate.totalWallTimeMs ?? null,
	config: data.config ?? null,
	sourceResultFile: basename(sourceFile),
};

const manifest = {
	benchmark: data.benchmark,
	model: data.model,
	timestamp: data.timestamp,
	sourceResultFile: basename(sourceFile),
	totalTasks: summaries.length,
	config: data.config ?? null,
	tasks: summaries,
};

writeFileSync(join(outputDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
writeFileSync(join(outputDir, "sample.json"), `${JSON.stringify(sample, null, 2)}\n`);
writeFileSync(join(inputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const largestTask = summaries
	.map((summary) => {
		const bytes = summary.iterationFiles
			.map((relativePath) => statSync(join(outputDir, relativePath)).size)
			.reduce((sum, size) => sum + size, 0);
		return { taskId: summary.taskId, bytes };
	})
	.sort((a, b) => b.bytes - a.bytes)[0];

console.log(`[prepare-trajectory-analysis] source: ${basename(sourceFile)}`);
console.log(`[prepare-trajectory-analysis] tasks: ${summaries.length}`);
console.log(`[prepare-trajectory-analysis] sample: ${join(outputDir, "sample.json")}`);
console.log(`[prepare-trajectory-analysis] manifest: ${join(inputDir, "manifest.json")}`);
if (largestTask) {
	console.log(`[prepare-trajectory-analysis] largest task payload: ${largestTask.taskId} (${largestTask.bytes} bytes across iterations)`);
}
