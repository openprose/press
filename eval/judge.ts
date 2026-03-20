#!/usr/bin/env node

/**
 * eval/judge.ts — Trace digest + mechanical metrics for the backpressure judge.
 *
 * Reads a result file (with observer events) and a program definition,
 * produces a TraceDigest and mechanical metrics (RunIdentity, ShapeAdherence,
 * DelegationTree, ResourceUsage). These are the deterministic Tier 1 outputs
 * that the LLM judge (Step 2) consumes as structured context.
 *
 * Usage:
 *   npx tsx eval/judge.ts --result <path> --program <name>
 *   npx tsx eval/judge.ts --result <path> --program <name> --task <taskId>
 *
 * Exports:
 *   buildTraceDigest(events, program, resultMeta) -> TraceDigest
 *   extractMechanicalMetrics(events, program, resultMeta) -> MechanicalMetrics
 *   buildAdherenceReport(events, program, resultMeta) -> AdherenceReport
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProgram, parseFrontmatter } from "../src/plugins.js";

/** Minimal .env loader (same as eval/run.ts). */
function loadEnvFile(): void {
	const envPath = join(new URL(".", import.meta.url).pathname, "..", ".env");
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

loadEnvFile();
import type { ProgramDefinition } from "../src/plugins.js";
import type {
	RlmEvent,
	DelegationSpawnEvent,
	DelegationReturnEvent,
	DelegationErrorEvent,
	DelegationUnawaitedEvent,
	InvocationStartEvent,
	InvocationEndEvent,
	IterationEndEvent,
	LlmResponseEvent,
	RunStartEvent,
	RunEndEvent,
	TokenUsage,
} from "../src/events.js";
import type { BenchmarkResult, EvalResult } from "./types.js";
import { press } from "../src/rlm.js";
import { fromOpenRouter } from "./drivers/openrouter.js";

// ---------------------------------------------------------------------------
// Schema types (from PLAN.md)
// ---------------------------------------------------------------------------

export interface RunIdentity {
	model: string;
	benchmark: string;
	task_id: string;
	program: string;
	success: boolean;
	iterations_used: number;
	max_iterations: number;
	max_depth: number;
	depth_used: number;
}

export interface ShapeViolation {
	invocation_id: string;
	component: string;
	api_called: string;
	prohibited_by: string;
	iteration: number;
	code_excerpt: string;
	severity: "hard";
}

export interface CollapseEpisode {
	invocation_id: string;
	component: string;
	iterations_as_leaf: number;
	total_iterations: number;
	evidence: string[];
}

export interface ShapeAdherence {
	violations: ShapeViolation[];
	collapse_episodes: CollapseEpisode[];
}

export interface DelegationTreeNode {
	invocation_id: string;
	parent_id: string | null;
	component: string | null;
	depth: number;
	iterations_used: number;
	iterations_budget: number;
	delegations_spawned: number;
	delegations_errored: number;
	unawaited_delegations: number;
	outcome: "returned" | "error" | "timeout";
}

export interface DelegationTree {
	invocations: DelegationTreeNode[];
	topology: string;
}

export interface TokenCounts {
	prompt: number;
	completion: number;
	cache_read: number;
	cache_write: number;
}

export interface ComponentResourceUsage {
	tokens: { prompt: number; completion: number };
	llm_calls: number;
	iterations: number;
	invocation_count: number;
}

export interface ResourceUsage {
	total_tokens: TokenCounts;
	total_llm_calls: number;
	total_llm_duration_ms: number;
	total_iterations: number;
	by_component: Record<string, ComponentResourceUsage>;
	wasted_iterations: number;
	error_iterations: number;
}

export interface IterationDigest {
	number: number;
	code_summary: string;
	delegations: {
		child_component: string;
		brief_excerpt: string;
		outcome: "returned" | "error";
		child_iterations: number;
	}[];
	output_excerpt: string;
	error: string | null;
	returned: boolean;
}

export interface InvocationDigest {
	invocation_id: string;
	parent_id: string | null;
	component: string | null;
	depth: number;
	role: string | null;
	system_prompt?: string;
	iterations: IterationDigest[];
	prohibited_violations: string[];
	shape_warnings: string[];
}

export interface TraceDigest {
	run: RunIdentity;
	tree: DelegationTree;
	resources: ResourceUsage;
	invocations: InvocationDigest[];
	warnings: string[];
}

export interface MechanicalMetrics {
	run: RunIdentity;
	shape: ShapeAdherence;
	tree: DelegationTree;
	resources: ResourceUsage;
}

export interface AdherenceReport {
	digest: TraceDigest;
	metrics: MechanicalMetrics;
}

// ---------------------------------------------------------------------------
// Tier 2 types (LLM judgment)
// ---------------------------------------------------------------------------

export interface BriefDelegationAssessment {
	parent_component: string;
	child_component: string;
	invocation_id: string;
	brief_text: string;
	truncated: boolean;
	contains_facts_from_state: boolean;
	contains_action_instructions: boolean;
	contains_domain_interpretation: boolean;
	contains_tactical_advice: boolean;
	goal_present: boolean;
	contamination_severity: "none" | "mild" | "severe";
	notes: string;
}

export interface BriefAdherence {
	delegations: BriefDelegationAssessment[];
}

export interface CurationDelegationAssessment {
	parent_component: string;
	child_component: string;
	invocation_id: string;
	iteration_of_delegation: number;
	curation_present: boolean;
	observed_actions: string[];
	state_vars_changed: string[];
	notes: string;
}

export interface CurationAdherence {
	delegations: CurationDelegationAssessment[];
}

export interface ContractRequiresCheck {
	component: string;
	clause: string;
	satisfied: boolean | "unknown";
	evidence: string;
}

export interface ContractEnsuresCheck {
	component: string;
	clause: string;
	satisfied: boolean | "unknown";
	evidence: string;
}

export interface ContractInvariantCheck {
	component: string;
	clause: string;
	maintained: boolean | "unknown";
	violations: Array<{ iteration: number; description: string }>;
}

export interface ContractAdherence {
	requires: ContractRequiresCheck[];
	ensures: ContractEnsuresCheck[];
	invariants: ContractInvariantCheck[];
}

export interface Tier2Judgment {
	brief_adherence: BriefAdherence;
	curation_adherence: CurationAdherence;
	contract_adherence: ContractAdherence;
}

export interface JudgeReport {
	run: RunIdentity;
	mechanical: {
		shape: ShapeAdherence;
		tree: DelegationTree;
		resources: ResourceUsage;
	};
	judgment: Tier2Judgment;
	digest: TraceDigest;
}

// ---------------------------------------------------------------------------
// Result metadata passed into extraction functions
// ---------------------------------------------------------------------------

export interface ResultMeta {
	benchmark: string;
	model: string;
	program: string;
	taskId: string;
	score: number;
	iterations: number;
	maxIterations: number;
	maxDepth: number;
	error?: string;
}

// ---------------------------------------------------------------------------
// Program shape info extracted from frontmatter
// ---------------------------------------------------------------------------

interface NodeShape {
	name: string;
	role: string | null;
	prohibited: string[];
	api: string[];
	delegates: string[];
}

function extractNodeShapes(program: ProgramDefinition): Map<string, NodeShape> {
	const shapes = new Map<string, NodeShape>();

	// Parse the root app body (the orchestrator)
	const { frontmatter: rootFm } = parseFrontmatter(program.rootAppBody);
	if (rootFm.name) {
		shapes.set(String(rootFm.name), {
			name: String(rootFm.name),
			role: rootFm.role ? String(rootFm.role) : null,
			prohibited: toStringArray(rootFm.prohibited),
			api: toStringArray(rootFm.api),
			delegates: toStringArray(rootFm.delegates),
		});
	}

	// Parse child components
	for (const [key, content] of Object.entries(program.childComponents)) {
		const { frontmatter: fm } = parseFrontmatter(content);
		if (fm.name) {
			const name = String(fm.name);
			// Avoid duplicate entries (components registered under both short and full name)
			if (!shapes.has(name)) {
				shapes.set(name, {
					name,
					role: fm.role ? String(fm.role) : null,
					prohibited: toStringArray(fm.prohibited),
					api: toStringArray(fm.api),
					delegates: toStringArray(fm.delegates),
				});
			}
		}
	}

	return shapes;
}

function toStringArray(val: unknown): string[] {
	if (Array.isArray(val)) return val.map(String);
	if (typeof val === "string" && val.length > 0) return [val];
	return [];
}

// ---------------------------------------------------------------------------
// Truncation helpers
// ---------------------------------------------------------------------------

function truncate(s: string | null | undefined, maxLen: number): string {
	if (!s) return "";
	if (s.length <= maxLen) return s;
	return s.slice(0, maxLen) + "...";
}

// ---------------------------------------------------------------------------
// Event filtering helpers
// ---------------------------------------------------------------------------

function eventsOfType<T extends RlmEvent["type"]>(
	events: RlmEvent[],
	type: T,
): Extract<RlmEvent, { type: T }>[] {
	return events.filter((e) => e.type === type) as Extract<RlmEvent, { type: T }>[];
}

// ---------------------------------------------------------------------------
// Core extraction: RunIdentity
// ---------------------------------------------------------------------------

function extractRunIdentity(events: RlmEvent[], meta: ResultMeta): RunIdentity {
	const runStarts = eventsOfType(events, "run:start");
	const maxDepthUsed = events.reduce((max, e) => Math.max(max, e.depth), 0);

	// Prefer event data when available, fall back to metadata
	const maxIterations = runStarts.length > 0
		? runStarts[0].maxIterations
		: meta.maxIterations;
	const maxDepth = runStarts.length > 0
		? runStarts[0].maxDepth
		: meta.maxDepth;

	return {
		model: meta.model,
		benchmark: meta.benchmark,
		task_id: meta.taskId,
		program: meta.program,
		success: meta.score > 0 && !meta.error,
		iterations_used: meta.iterations,
		max_iterations: maxIterations,
		max_depth: maxDepth,
		depth_used: maxDepthUsed,
	};
}

// ---------------------------------------------------------------------------
// Core extraction: ShapeAdherence
// ---------------------------------------------------------------------------

function extractShapeAdherence(
	events: RlmEvent[],
	nodeShapes: Map<string, NodeShape>,
	invocationComponents: Map<string, string>,
): ShapeAdherence {
	const violations: ShapeViolation[] = [];
	const collapseMap = new Map<string, {
		component: string;
		iterationsAsLeaf: number;
		totalIterations: number;
		evidence: string[];
	}>();

	// Build a map of which APIs belong to which child components
	const childApiOwners = new Map<string, string>(); // api call -> component name
	for (const [, shape] of nodeShapes) {
		for (const api of shape.api) {
			childApiOwners.set(api, shape.name);
		}
	}

	const iterationEnds = eventsOfType(events, "iteration:end");

	for (const ev of iterationEnds) {
		const code = ev.code;
		if (!code) continue;

		const component = invocationComponents.get(ev.invocationId) ?? null;
		if (!component) continue;

		const shape = findShapeForComponent(component, nodeShapes);
		if (!shape) continue;

		// Check prohibited API violations
		for (const prohibited of shape.prohibited) {
			if (codeContainsApiCall(code, prohibited)) {
				const line = findLineContaining(code, prohibited);
				violations.push({
					invocation_id: ev.invocationId,
					component: shape.name,
					api_called: prohibited,
					prohibited_by: shape.name,
					iteration: ev.iteration,
					code_excerpt: truncate(line, 200),
					severity: "hard",
				});
			}
		}

		// Collapse detection: check if this component calls APIs owned by its children
		if (shape.delegates.length > 0) {
			for (const [api, owner] of childApiOwners) {
				// Skip if this API is in the component's own api list
				if (shape.api.includes(api)) continue;
				// Skip if the owner is not a delegate of this component
				const ownerShape = findShapeForComponent(owner, nodeShapes);
				if (!ownerShape) continue;
				// Check if the owner component is a potential delegate
				// Use fuzzy matching: "oha" matches "arc3-oha", "level-solver" matches "arc3-level-solver"
				const isDelegateChild = shape.delegates.some(
					(d) => d === owner || d === ownerShape.name ||
						ownerShape.name.endsWith(d) || d.endsWith(ownerShape.name),
				);
				if (!isDelegateChild) continue;

				if (codeContainsApiCall(code, api)) {
					const key = ev.invocationId;
					const existing = collapseMap.get(key);
					const line = findLineContaining(code, api);
					if (existing) {
						existing.iterationsAsLeaf++;
						if (!existing.evidence.includes(line)) {
							existing.evidence.push(truncate(line, 200));
						}
					} else {
						collapseMap.set(key, {
							component: shape.name,
							iterationsAsLeaf: 1,
							totalIterations: 0, // filled in later
							evidence: [truncate(line, 200)],
						});
					}
				}
			}
		}
	}

	// Fill in total iterations for collapse episodes
	const invocationIterCounts = new Map<string, number>();
	for (const ev of iterationEnds) {
		invocationIterCounts.set(
			ev.invocationId,
			Math.max(invocationIterCounts.get(ev.invocationId) ?? 0, ev.iteration),
		);
	}

	const collapse_episodes: CollapseEpisode[] = [];
	for (const [invId, data] of collapseMap) {
		collapse_episodes.push({
			invocation_id: invId,
			component: data.component,
			iterations_as_leaf: data.iterationsAsLeaf,
			total_iterations: invocationIterCounts.get(invId) ?? 0,
			evidence: data.evidence,
		});
	}

	return { violations, collapse_episodes };
}

function findShapeForComponent(
	component: string,
	nodeShapes: Map<string, NodeShape>,
): NodeShape | null {
	// Try exact match first
	if (nodeShapes.has(component)) return nodeShapes.get(component)!;
	// Try prefix match (e.g., "arc3-game-solver" matches for "game-solver")
	for (const [name, shape] of nodeShapes) {
		if (name.endsWith(component) || component.endsWith(name)) return shape;
	}
	return null;
}

function codeContainsApiCall(code: string, apiCall: string): boolean {
	// Match patterns like: arc3.step, arc3.step(, arc3.step(5)
	// Avoid matching in comments
	const lines = code.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		// Skip comment-only lines
		if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
		// Strip inline comments
		const noComment = trimmed.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
		// Escape dots in API name for regex
		const escaped = apiCall.replace(/\./g, "\\.");
		if (new RegExp(`\\b${escaped}\\b`).test(noComment)) return true;
	}
	return false;
}

function findLineContaining(code: string, pattern: string): string {
	const lines = code.split("\n");
	for (const line of lines) {
		if (line.includes(pattern)) return line.trim();
	}
	return "";
}

// ---------------------------------------------------------------------------
// Core extraction: DelegationTree
// ---------------------------------------------------------------------------

function extractDelegationTree(
	events: RlmEvent[],
	invocationComponents: Map<string, string>,
): DelegationTree {
	// Gather all invocation info
	const invStarts = new Map<string, InvocationStartEvent>();
	const invEnds = new Map<string, InvocationEndEvent>();
	const spawns: DelegationSpawnEvent[] = [];
	const returns = new Map<string, DelegationReturnEvent>();
	const errors = new Map<string, DelegationErrorEvent>();
	const unawaitedByInv = new Map<string, number>();

	for (const ev of events) {
		switch (ev.type) {
			case "invocation:start":
				invStarts.set(ev.invocationId, ev);
				break;
			case "invocation:end":
				invEnds.set(ev.invocationId, ev);
				break;
			case "delegation:spawn":
				spawns.push(ev);
				break;
			case "delegation:return":
				returns.set(ev.childId, ev);
				break;
			case "delegation:error":
				errors.set(ev.childId, ev);
				break;
			case "delegation:unawaited":
				unawaitedByInv.set(ev.invocationId, (unawaitedByInv.get(ev.invocationId) ?? 0) + ev.count);
				break;
		}
	}

	// Build parent->children map
	const childOf = new Map<string, string>(); // childId -> parentInvocationId
	const spawnsByParent = new Map<string, DelegationSpawnEvent[]>();
	for (const spawn of spawns) {
		childOf.set(spawn.childId, spawn.invocationId);
		const list = spawnsByParent.get(spawn.invocationId) ?? [];
		list.push(spawn);
		spawnsByParent.set(spawn.invocationId, list);
	}

	// All invocation IDs
	const allInvIds = new Set<string>();
	for (const ev of events) {
		allInvIds.add(ev.invocationId);
	}
	// Also add child IDs from spawns (they may have events under their own invocationId)
	for (const spawn of spawns) {
		allInvIds.add(spawn.childId);
	}

	const invocations: DelegationTreeNode[] = [];

	for (const invId of allInvIds) {
		const start = invStarts.get(invId);
		const end = invEnds.get(invId);
		const parentId = childOf.get(invId) ?? (start?.parentId ?? null);
		const component = invocationComponents.get(invId) ?? null;
		const depth = start?.depth ?? 0;

		// Find the spawn event for this invocation to get budget
		let iterationsBudget = 0;
		for (const spawn of spawns) {
			if (spawn.childId === invId && spawn.maxIterations) {
				iterationsBudget = spawn.maxIterations;
				break;
			}
		}
		// For root invocation, use run:start maxIterations
		if (!iterationsBudget) {
			const runStarts = eventsOfType(events, "run:start");
			if (runStarts.length > 0 && depth === 0) {
				iterationsBudget = runStarts[0].maxIterations;
			}
		}

		const childSpawns = spawnsByParent.get(invId) ?? [];
		const delegationsErrored = childSpawns.filter((s) => errors.has(s.childId)).length;
		const unawaited = unawaitedByInv.get(invId) ?? 0;

		let outcome: "returned" | "error" | "timeout" = "returned";
		if (end?.error) {
			outcome = end.error.includes("max iterations") ? "timeout" : "error";
		}

		invocations.push({
			invocation_id: invId,
			parent_id: parentId,
			component,
			depth,
			iterations_used: end?.iterations ?? 0,
			iterations_budget: iterationsBudget,
			delegations_spawned: childSpawns.length,
			delegations_errored: delegationsErrored,
			unawaited_delegations: unawaited,
			outcome,
		});
	}

	// Sort by depth then timestamp of first event
	const firstSeen = new Map<string, number>();
	for (const ev of events) {
		if (!firstSeen.has(ev.invocationId)) {
			firstSeen.set(ev.invocationId, ev.timestamp);
		}
	}
	invocations.sort((a, b) => {
		if (a.depth !== b.depth) return a.depth - b.depth;
		return (firstSeen.get(a.invocation_id) ?? 0) - (firstSeen.get(b.invocation_id) ?? 0);
	});

	// Build topology string
	const topology = buildTopologyString(invocations);

	return { invocations, topology };
}

function buildTopologyString(invocations: DelegationTreeNode[]): string {
	if (invocations.length === 0) return "(empty)";

	// Build adjacency: parent -> children with component names
	const children = new Map<string, string[]>();
	for (const inv of invocations) {
		if (inv.parent_id) {
			const parent = invocations.find((i) => i.invocation_id === inv.parent_id);
			const parentLabel = parent?.component ?? "root";
			const childLabel = inv.component ?? "unknown";
			const list = children.get(parentLabel) ?? [];
			if (!list.includes(childLabel)) {
				list.push(childLabel);
			}
			children.set(parentLabel, list);
		}
	}

	if (children.size === 0) {
		const root = invocations[0];
		return root.component ?? "root";
	}

	// Build tree string
	const parts: string[] = [];
	for (const [parent, kids] of children) {
		parts.push(`${parent} -> ${kids.join(", ")}`);
	}
	return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Core extraction: ResourceUsage
// ---------------------------------------------------------------------------

function extractResourceUsage(
	events: RlmEvent[],
	invocationComponents: Map<string, string>,
): ResourceUsage {
	const llmResponses = eventsOfType(events, "llm:response");
	const iterationEnds = eventsOfType(events, "iteration:end");

	const totalTokens: TokenCounts = { prompt: 0, completion: 0, cache_read: 0, cache_write: 0 };
	let totalLlmCalls = 0;
	let totalLlmDurationMs = 0;
	let missingUsageCount = 0;

	const byComponent = new Map<string, ComponentResourceUsage>();

	for (const ev of llmResponses) {
		totalLlmCalls++;
		totalLlmDurationMs += ev.duration;

		const usage = ev.usage;
		if (usage) {
			totalTokens.prompt += usage.promptTokens ?? 0;
			totalTokens.completion += usage.completionTokens ?? 0;
			totalTokens.cache_read += usage.cacheReadTokens ?? 0;
			totalTokens.cache_write += usage.cacheWriteTokens ?? 0;
		} else {
			missingUsageCount++;
		}

		// By-component aggregation
		const comp = invocationComponents.get(ev.invocationId) ?? "__root__";
		const existing = byComponent.get(comp) ?? {
			tokens: { prompt: 0, completion: 0 },
			llm_calls: 0,
			iterations: 0,
			invocation_count: 0,
		};
		existing.llm_calls++;
		if (usage) {
			existing.tokens.prompt += usage.promptTokens ?? 0;
			existing.tokens.completion += usage.completionTokens ?? 0;
		}
		byComponent.set(comp, existing);
	}

	// Count iterations per component and invocations per component
	const componentInvocations = new Map<string, Set<string>>();
	let wastedIterations = 0;
	let errorIterations = 0;

	for (const ev of iterationEnds) {
		const comp = invocationComponents.get(ev.invocationId) ?? "__root__";
		const existing = byComponent.get(comp) ?? {
			tokens: { prompt: 0, completion: 0 },
			llm_calls: 0,
			iterations: 0,
			invocation_count: 0,
		};
		existing.iterations++;
		byComponent.set(comp, existing);

		const invSet = componentInvocations.get(comp) ?? new Set();
		invSet.add(ev.invocationId);
		componentInvocations.set(comp, invSet);

		// Wasted: code was null or output was empty
		if (!ev.code || ev.output === "") {
			wastedIterations++;
		}
		// Error iterations
		if (ev.error) {
			errorIterations++;
		}
	}

	// Set invocation counts
	for (const [comp, invSet] of componentInvocations) {
		const existing = byComponent.get(comp);
		if (existing) {
			existing.invocation_count = invSet.size;
		}
	}

	const byComponentObj: Record<string, ComponentResourceUsage> = {};
	for (const [comp, usage] of byComponent) {
		byComponentObj[comp] = usage;
	}

	const warnings: string[] = [];
	if (missingUsageCount > 0) {
		warnings.push(`${missingUsageCount} llm:response events missing usage field`);
	}

	return {
		total_tokens: totalTokens,
		total_llm_calls: totalLlmCalls,
		total_llm_duration_ms: totalLlmDurationMs,
		total_iterations: iterationEnds.length,
		by_component: byComponentObj,
		wasted_iterations: wastedIterations,
		error_iterations: errorIterations,
	};
}

// ---------------------------------------------------------------------------
// Build invocation->component mapping from delegation:spawn events
// ---------------------------------------------------------------------------

function buildInvocationComponentMap(events: RlmEvent[]): Map<string, string> {
	const map = new Map<string, string>();

	// The root invocation gets its component from run:start or the first invocation:start
	const spawns = eventsOfType(events, "delegation:spawn");
	for (const spawn of spawns) {
		const comp = spawn.componentName ?? spawn.appName ?? null;
		if (comp && spawn.childId) {
			map.set(spawn.childId, comp);
		}
	}

	return map;
}

// ---------------------------------------------------------------------------
// Build the per-invocation trace digest
// ---------------------------------------------------------------------------

function buildInvocationDigests(
	events: RlmEvent[],
	nodeShapes: Map<string, NodeShape>,
	invocationComponents: Map<string, string>,
	shapeAdherence: ShapeAdherence,
): InvocationDigest[] {
	// Group events by invocationId
	const eventsByInv = new Map<string, RlmEvent[]>();
	for (const ev of events) {
		const list = eventsByInv.get(ev.invocationId) ?? [];
		list.push(ev);
		eventsByInv.set(ev.invocationId, list);
	}

	// Also include childIds from delegation:spawn (they have their own invocationId)
	const spawns = eventsOfType(events, "delegation:spawn");
	for (const spawn of spawns) {
		if (!eventsByInv.has(spawn.childId)) {
			eventsByInv.set(spawn.childId, []);
		}
	}

	const digests: InvocationDigest[] = [];

	for (const [invId, invEvents] of eventsByInv) {
		const invStart = invEvents.find((e) => e.type === "invocation:start") as InvocationStartEvent | undefined;
		const component = invocationComponents.get(invId) ?? null;
		const parentId = invStart?.parentId ?? null;
		const depth = invStart?.depth ?? invEvents[0]?.depth ?? 0;
		const systemPrompt = invStart?.systemPrompt ?? undefined;

		// Determine role from nodeShapes
		let role: string | null = null;
		if (component) {
			const shape = findShapeForComponent(component, nodeShapes);
			if (shape) role = shape.role;
		}

		// Build iteration digests
		const iterEnds = invEvents
			.filter((e) => e.type === "iteration:end") as IterationEndEvent[];
		iterEnds.sort((a, b) => a.iteration - b.iteration);

		// Collect delegation events for this invocation's iterations
		const delegationSpawns = invEvents
			.filter((e) => e.type === "delegation:spawn") as DelegationSpawnEvent[];
		const delegationReturns = eventsOfType(events, "delegation:return");
		const delegationErrors = eventsOfType(events, "delegation:error");

		// Map child delegations to the iteration they were spawned in
		// We'll approximate by matching timestamps: a spawn belongs to the most recent iteration:start
		const iterStartTimestamps = invEvents
			.filter((e) => e.type === "iteration:start")
			.sort((a, b) => a.timestamp - b.timestamp);

		function getIterationForTimestamp(ts: number): number {
			let iterNum = 1;
			for (const ist of iterStartTimestamps) {
				if (ist.type === "iteration:start" && ist.timestamp <= ts) {
					iterNum = ist.iteration;
				}
			}
			return iterNum;
		}

		const iterations: IterationDigest[] = [];

		for (const iterEnd of iterEnds) {
			// Find delegations spawned during this iteration
			const iterDelegations = delegationSpawns
				.filter((s) => getIterationForTimestamp(s.timestamp) === iterEnd.iteration)
				.map((spawn) => {
					const ret = delegationReturns.find((r) => r.childId === spawn.childId);
					const err = delegationErrors.find((e) => e.childId === spawn.childId);
					return {
						child_component: spawn.componentName ?? spawn.appName ?? "unknown",
						brief_excerpt: truncate(spawn.query, 300),
						outcome: (err ? "error" : "returned") as "returned" | "error",
						child_iterations: ret?.iterations ?? err?.iterations ?? 0,
					};
				});

			iterations.push({
				number: iterEnd.iteration,
				code_summary: truncate(iterEnd.code, 2000),
				delegations: iterDelegations,
				output_excerpt: truncate(iterEnd.output, 300),
				error: iterEnd.error,
				returned: iterEnd.returned,
			});
		}

		// Collect prohibited violations for this invocation
		const prohibited_violations = shapeAdherence.violations
			.filter((v) => v.invocation_id === invId)
			.map((v) => v.api_called);

		// Collect shape warnings (collapse episodes)
		const shape_warnings = shapeAdherence.collapse_episodes
			.filter((c) => c.invocation_id === invId)
			.flatMap((c) => c.evidence.map((e) => `called child-owned API: ${e}`));

		digests.push({
			invocation_id: invId,
			parent_id: parentId,
			component,
			depth,
			role,
			system_prompt: systemPrompt,
			iterations,
			prohibited_violations: [...new Set(prohibited_violations)],
			shape_warnings,
		});
	}

	// Sort by depth then timestamp
	const firstSeen = new Map<string, number>();
	for (const ev of events) {
		if (!firstSeen.has(ev.invocationId)) {
			firstSeen.set(ev.invocationId, ev.timestamp);
		}
	}
	digests.sort((a, b) => {
		if (a.depth !== b.depth) return a.depth - b.depth;
		return (firstSeen.get(a.invocation_id) ?? 0) - (firstSeen.get(b.invocation_id) ?? 0);
	});

	return digests;
}

// ---------------------------------------------------------------------------
// Collect warnings about missing data
// ---------------------------------------------------------------------------

function collectWarnings(events: RlmEvent[], resources: ResourceUsage): string[] {
	const warnings: string[] = [];

	if (events.length === 0) {
		warnings.push("No events in trace — result file may predate observer wiring");
		return warnings;
	}

	// Check for expected event types
	const types = new Set(events.map((e) => e.type));
	const expected: RlmEvent["type"][] = [
		"run:start", "run:end", "invocation:start", "invocation:end",
		"iteration:end", "llm:response",
	];
	for (const t of expected) {
		if (!types.has(t)) {
			warnings.push(`Missing expected event type: ${t}`);
		}
	}

	// Check for llm:response without usage
	const llmResponses = eventsOfType(events, "llm:response");
	const missingUsage = llmResponses.filter((e) => !e.usage).length;
	if (missingUsage > 0) {
		warnings.push(`${missingUsage}/${llmResponses.length} llm:response events missing usage field`);
	}

	// Check for delegation events without componentName
	const spawns = eventsOfType(events, "delegation:spawn");
	const missingComponent = spawns.filter((s) => !s.componentName && !s.appName).length;
	if (missingComponent > 0) {
		warnings.push(`${missingComponent}/${spawns.length} delegation:spawn events missing componentName`);
	}

	// Check for sandbox:snapshot events (useful but not required)
	if (!types.has("sandbox:snapshot")) {
		warnings.push("No sandbox:snapshot events — &-state diff analysis not available");
	}

	return warnings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildTraceDigest(
	events: RlmEvent[],
	program: ProgramDefinition,
	meta: ResultMeta,
): TraceDigest {
	const nodeShapes = extractNodeShapes(program);
	const invocationComponents = buildInvocationComponentMap(events);
	const run = extractRunIdentity(events, meta);
	const shape = extractShapeAdherence(events, nodeShapes, invocationComponents);
	const tree = extractDelegationTree(events, invocationComponents);
	const resources = extractResourceUsage(events, invocationComponents);
	const invocations = buildInvocationDigests(events, nodeShapes, invocationComponents, shape);
	const warnings = collectWarnings(events, resources);

	return { run, tree, resources, invocations, warnings };
}

export function extractMechanicalMetrics(
	events: RlmEvent[],
	program: ProgramDefinition,
	meta: ResultMeta,
): MechanicalMetrics {
	const nodeShapes = extractNodeShapes(program);
	const invocationComponents = buildInvocationComponentMap(events);
	const run = extractRunIdentity(events, meta);
	const shape = extractShapeAdherence(events, nodeShapes, invocationComponents);
	const tree = extractDelegationTree(events, invocationComponents);
	const resources = extractResourceUsage(events, invocationComponents);

	return { run, shape, tree, resources };
}

export function buildAdherenceReport(
	events: RlmEvent[],
	program: ProgramDefinition,
	meta: ResultMeta,
): AdherenceReport {
	const nodeShapes = extractNodeShapes(program);
	const invocationComponents = buildInvocationComponentMap(events);
	const run = extractRunIdentity(events, meta);
	const shape = extractShapeAdherence(events, nodeShapes, invocationComponents);
	const tree = extractDelegationTree(events, invocationComponents);
	const resources = extractResourceUsage(events, invocationComponents);
	const invocations = buildInvocationDigests(events, nodeShapes, invocationComponents, shape);
	const warnings = collectWarnings(events, resources);

	const digest: TraceDigest = { run, tree, resources, invocations, warnings };
	const metrics: MechanicalMetrics = { run, shape, tree, resources };

	return { digest, metrics };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface JudgeCliArgs {
	resultPath: string;
	program: string;
	taskId: string | null;
	judge: boolean;
	model: string;
	reasoning: string;
}

function parseJudgeArgs(argv: string[]): JudgeCliArgs {
	const args: Record<string, string> = {};
	const flags = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			printUsage();
		}
		if (arg === "--judge") {
			flags.add("judge");
		} else if (arg.startsWith("--") && i + 1 < argv.length) {
			args[arg.slice(2)] = argv[i + 1];
			i++;
		}
	}

	if (!args.result) {
		console.error("Error: --result <path> is required\n");
		printUsage();
	}
	if (!args.program) {
		console.error("Error: --program <name> is required\n");
		printUsage();
	}

	return {
		resultPath: args.result,
		program: args.program,
		taskId: args.task ?? null,
		judge: flags.has("judge"),
		model: args.model ?? "anthropic/claude-sonnet-4.5",
		reasoning: args.reasoning ?? "medium",
	};
}

function printUsage(): never {
	console.log(`eval/judge.ts — Trace digest + mechanical metrics + LLM judge

Usage: npx tsx eval/judge.ts --result <path> --program <name> [options]

Options:
  --result <path>      Path to result JSON file (required)
  --program <name>     Program name to load from programs/<name>/ (required)
  --task <taskId>      Process only this task (default: first task)
  --judge              Run the LLM judge (Tier 2) in addition to mechanical metrics
  --model <id>         Model for the LLM judge (default: anthropic/claude-sonnet-4.5)
  --reasoning <level>  Reasoning effort: high, medium, low (default: medium)
  --help               Show this help

Examples:
  # Mechanical metrics only (Tier 1):
  npx tsx eval/judge.ts --result eval/results/some_result.json --program arc3

  # Full judge (Tier 1 + Tier 2):
  npx tsx eval/judge.ts --result eval/results/some_result.json --program arc3 --judge

  # Full judge with specific model:
  npx tsx eval/judge.ts --result eval/results/some_result.json --program arc3 --judge --model anthropic/claude-opus-4-6
`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// LLM Judge orchestration (Step 2)
// ---------------------------------------------------------------------------

/**
 * Resolve the project root directory (where LANGUAGE.md and CONTAINER.md live).
 */
function getProjectRoot(): string {
	const thisFile = fileURLToPath(import.meta.url);
	return resolve(thisFile, "../..");
}

/**
 * Load spec documents (LANGUAGE.md, CONTAINER.md) from the project root.
 */
function loadSpecDocs(): Record<string, string> {
	const root = getProjectRoot();
	const specs: Record<string, string> = {};
	for (const filename of ["LANGUAGE.md", "CONTAINER.md"]) {
		try {
			specs[filename] = readFileSync(resolve(root, filename), "utf-8");
		} catch {
			console.error(`Warning: Could not load spec doc ${filename}`);
		}
	}
	return specs;
}

/**
 * Build the __programFiles sandbox global from a loaded program definition.
 * Includes the globalDocs (root.md body), orchestrator body, and all child components.
 */
function buildProgramFilesMap(program: ProgramDefinition): Record<string, string> {
	const files: Record<string, string> = {};

	// Include globalDocs labeled as root.md
	if (program.globalDocs) {
		files["root.md (globalDocs)"] = program.globalDocs;
	}

	// Include the orchestrator (rootAppBody includes frontmatter)
	if (program.rootAppBody) {
		// Infer filename from the root app name
		const rootName = program.rootApp || "orchestrator";
		files[`${rootName}.md`] = program.rootAppBody;
	}

	// Include all child components (keyed by name, includes frontmatter)
	// Deduplicate: childComponents may have both short and full names pointing to same content
	const seen = new Set<string>();
	for (const [name, content] of Object.entries(program.childComponents)) {
		if (seen.has(content)) continue;
		seen.add(content);
		files[`${name}.md`] = content;
	}

	return files;
}

/**
 * Run the LLM judge against a single task's adherence report.
 * Returns a JudgeReport combining Tier 1 (mechanical) and Tier 2 (judgment).
 */
async function runLLMJudge(
	report: AdherenceReport,
	judgedProgram: ProgramDefinition,
	modelId: string,
	reasoningEffort: string,
): Promise<JudgeReport> {
	// 1. Load the judge program
	console.error("Loading judge program...");
	const judgeProgram = await loadProgram("judge");
	console.error(`  Root app: ${judgeProgram.rootApp}`);
	console.error(`  Global docs: ${judgeProgram.globalDocs.length} chars`);

	// 2. Load spec documents
	console.error("Loading spec documents...");
	const specDocs = loadSpecDocs();
	for (const [name, content] of Object.entries(specDocs)) {
		console.error(`  ${name}: ${content.length} chars`);
	}

	// 3. Build program files map for the judged program
	const programFiles = buildProgramFilesMap(judgedProgram);
	console.error("Program files for judge context:");
	for (const [name, content] of Object.entries(programFiles)) {
		console.error(`  ${name}: ${content.length} chars`);
	}

	// 4. Set up sandbox globals
	const sandboxGlobals: Record<string, unknown> = {
		__traceDigest: report.digest,
		__mechanicalMetrics: report.metrics,
		__programFiles: programFiles,
		__specDocs: specDocs,
	};

	// 5. Set up callLLM driver
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error("Error: OPENROUTER_API_KEY not set. Required for --judge mode.");
		console.error("Set it in .env or as an environment variable.");
		process.exit(1);
	}

	const overrides: { reasoningEffort?: string } = {};
	if (reasoningEffort && reasoningEffort !== "none") {
		overrides.reasoningEffort = reasoningEffort;
	}
	const callLLM = fromOpenRouter(modelId, apiKey, overrides);
	console.error(`Using model: ${modelId} (reasoning: ${reasoningEffort})`);

	// 6. Build the query for the judge
	const query = [
		"Evaluate this RLM execution trace for adherence to its program.",
		"",
		"Read the sandbox globals: __traceDigest, __mechanicalMetrics, __programFiles, __specDocs.",
		"Cross-reference the trace against the program files.",
		"Produce a structured JSON report matching the Tier 2 schema from globalDocs.",
		"",
		`Run identity: ${report.digest.run.benchmark} / ${report.digest.run.task_id}`,
		`Program: ${report.digest.run.program}`,
		`Model: ${report.digest.run.model}`,
		`Success: ${report.digest.run.success}`,
		`Iterations: ${report.digest.run.iterations_used}/${report.digest.run.max_iterations}`,
		`Depth: ${report.digest.run.depth_used}/${report.digest.run.max_depth}`,
		`Invocations: ${report.digest.invocations.length}`,
		`Delegations: ${report.digest.invocations.reduce((sum, inv) => sum + inv.iterations.reduce((s, it) => s + it.delegations.length, 0), 0)}`,
		`Warnings: ${report.digest.warnings.length}`,
	].join("\n");

	// 7. Build pluginBodies: the evaluator IS the root node
	const pluginBodies = judgeProgram.rootAppBody;

	// 8. Call press()
	console.error("\nRunning LLM judge...");
	const startTime = Date.now();

	let judgeAnswer: string;
	try {
		const result = await press(query, undefined, {
			callLLM,
			maxIterations: 15,
			maxDepth: 1,
			pluginBodies,
			sandboxGlobals,
			globalDocs: judgeProgram.globalDocs,
			childComponents: judgeProgram.childComponents,
			reasoningEffort,
		});
		judgeAnswer = result.answer;
		console.error(`Judge completed in ${result.iterations} iterations (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(`Judge failed: ${errMsg}`);
		throw new Error(`LLM judge failed: ${errMsg}`);
	}

	// 9. Parse the judge's return value as JSON
	console.error("Parsing judge output...");
	let judgment: Tier2Judgment;
	try {
		// The judge may return JSON wrapped in markdown code fences; strip them
		let cleaned = judgeAnswer.trim();
		if (cleaned.startsWith("```json")) {
			cleaned = cleaned.slice(7);
		} else if (cleaned.startsWith("```")) {
			cleaned = cleaned.slice(3);
		}
		if (cleaned.endsWith("```")) {
			cleaned = cleaned.slice(0, -3);
		}
		cleaned = cleaned.trim();

		const parsed = JSON.parse(cleaned) as Tier2Judgment;

		// Validate structure
		if (!parsed.brief_adherence || !parsed.curation_adherence || !parsed.contract_adherence) {
			throw new Error("Missing required fields: brief_adherence, curation_adherence, contract_adherence");
		}

		judgment = parsed;
	} catch (parseErr) {
		console.error("Failed to parse judge output as JSON.");
		console.error("Raw output (first 2000 chars):");
		console.error(judgeAnswer.slice(0, 2000));
		throw new Error(`Failed to parse judge output: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
	}

	// 10. Merge Tier 1 + Tier 2 into combined report
	const judgeReport: JudgeReport = {
		run: report.metrics.run,
		mechanical: {
			shape: report.metrics.shape,
			tree: report.metrics.tree,
			resources: report.metrics.resources,
		},
		judgment,
		digest: report.digest,
	};

	return judgeReport;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseJudgeArgs(process.argv.slice(2));

	// Load result file
	console.error(`Loading result file: ${args.resultPath}`);
	let resultData: BenchmarkResult;
	try {
		const content = readFileSync(args.resultPath, "utf-8");
		resultData = JSON.parse(content) as BenchmarkResult;
	} catch (err) {
		console.error(`Failed to load result file: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}

	// Load program (the program being judged)
	console.error(`Loading program: ${args.program}`);
	let program: ProgramDefinition;
	try {
		program = await loadProgram(args.program);
	} catch (err) {
		console.error(`Failed to load program: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}

	// Filter results
	let results = resultData.results;
	if (args.taskId) {
		results = results.filter((r) => r.taskId === args.taskId);
		if (results.length === 0) {
			console.error(`No result found for task: ${args.taskId}`);
			console.error(`Available tasks: ${resultData.results.map((r) => r.taskId).join(", ")}`);
			process.exit(1);
		}
	}

	// For --judge mode, process only the first task (LLM judge is expensive)
	if (args.judge && results.length > 1) {
		console.error(`--judge mode: processing first task only (${results[0].taskId}). Use --task to select a specific task.`);
		results = [results[0]];
	}

	console.error(`Processing ${results.length} result(s)...`);

	if (args.judge) {
		// --judge mode: run Tier 1 + Tier 2
		const result = results[0];
		const events = result.events ?? [];
		const meta: ResultMeta = {
			benchmark: resultData.benchmark,
			model: resultData.model,
			program: args.program,
			taskId: result.taskId,
			score: result.score,
			iterations: result.iterations,
			maxIterations: resultData.config.maxIterations,
			maxDepth: resultData.config.maxDepth,
			error: result.error,
		};

		// Step 1: mechanical analysis
		console.error("\n--- Step 1: Mechanical analysis ---");
		const report = buildAdherenceReport(events, program, meta);
		if (report.digest.warnings.length > 0) {
			console.error(`\n  Warnings:`);
			for (const w of report.digest.warnings) {
				console.error(`    - ${w}`);
			}
		}

		// Step 2: LLM judge
		console.error("\n--- Step 2: LLM judge ---");
		const judgeReport = await runLLMJudge(report, program, args.model, args.reasoning);

		// Output combined report to stdout
		const judgeJson = JSON.stringify(judgeReport, null, 2);
		console.log(judgeJson);

		// Auto-save alongside the result file
		const judgePath = args.resultPath.replace(/\.json$/, ".judge.json");
		writeFileSync(judgePath, judgeJson);
		console.error(`Judge report saved to: ${judgePath}`);
	} else {
		// Original mode: mechanical metrics only
		const reports: Array<{ taskId: string; report: AdherenceReport }> = [];

		for (const result of results) {
			const events = result.events ?? [];
			const meta: ResultMeta = {
				benchmark: resultData.benchmark,
				model: resultData.model,
				program: args.program,
				taskId: result.taskId,
				score: result.score,
				iterations: result.iterations,
				maxIterations: resultData.config.maxIterations,
				maxDepth: resultData.config.maxDepth,
				error: result.error,
			};

			const report = buildAdherenceReport(events, program, meta);
			reports.push({ taskId: result.taskId, report });

			// Log warnings to stderr
			if (report.digest.warnings.length > 0) {
				console.error(`\n  [${result.taskId}] Warnings:`);
				for (const w of report.digest.warnings) {
					console.error(`    - ${w}`);
				}
			}
		}

		// Output JSON to stdout
		const output = reports.length === 1
			? reports[0].report
			: reports;

		console.log(JSON.stringify(output, null, 2));
	}
}

// Run CLI if executed directly
const isMain = process.argv[1]?.endsWith("judge.ts") ||
	process.argv[1]?.endsWith("judge.js");

if (isMain) {
	main().catch((err) => {
		console.error("\nFatal error:", err.message ?? err);
		if (err.stack) console.error(err.stack);
		process.exit(1);
	});
}
