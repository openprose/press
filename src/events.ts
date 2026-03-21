// --- Shared field shapes ---

interface BaseEvent {
	runId: string;
	timestamp: number;
	invocationId: string;
	parentId: string | null;
	depth: number;
}

export interface TokenUsage {
	promptTokens?: number;
	completionTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

// --- Bucket 1: Lifecycle ---

export interface RunStartEvent extends BaseEvent {
	type: "run:start";
	query: string;
	maxIterations: number;
	maxDepth: number;
	model?: string;
}

export interface RunEndEvent extends BaseEvent {
	type: "run:end";
	answer: string | null;
	error: string | null;
	iterations: number;
}

export interface InvocationStartEvent extends BaseEvent {
	type: "invocation:start";
	query: string;
	systemPrompt: string;
}

export interface InvocationEndEvent extends BaseEvent {
	type: "invocation:end";
	answer: string | null;
	error: string | null;
	iterations: number;
}

export interface IterationStartEvent extends BaseEvent {
	type: "iteration:start";
	iteration: number;
	budgetRemaining: number;
}

export interface IterationEndEvent extends BaseEvent {
	type: "iteration:end";
	iteration: number;
	code: string | null;
	output: string;
	error: string | null;
	returned: boolean;
}

// --- Bucket 2: LLM calls ---

export interface LlmRequestEvent extends BaseEvent {
	type: "llm:request";
	iteration: number;
	model?: string;
	messageCount: number;
	systemPromptLength: number;
}

export interface LlmResponseEvent extends BaseEvent {
	type: "llm:response";
	iteration: number;
	model?: string;
	duration: number;
	reasoning: string;
	code: string | null;
	hasToolUse: boolean;
	usage?: TokenUsage;
}

export interface LlmErrorEvent extends BaseEvent {
	type: "llm:error";
	iteration: number;
	error: string;
	duration: number;
}

// --- Bucket 3: Delegation ---

export interface DelegationSpawnEvent extends BaseEvent {
	type: "delegation:spawn";
	childId: string;
	query: string;
	context?: string;           // the context/data passed to the child
	modelAlias?: string;
	maxIterations?: number;
	componentName?: string;
	/** @deprecated Use componentName instead. */
	appName?: string;
}

export interface DelegationReturnEvent extends BaseEvent {
	type: "delegation:return";
	childId: string;
	answer: string;
	iterations: number;
}

export interface DelegationErrorEvent extends BaseEvent {
	type: "delegation:error";
	childId: string;
	error: string;
	iterations: number;
}

export interface DelegationUnawaitedEvent extends BaseEvent {
	type: "delegation:unawaited";
	count: number;
}

// --- Bucket 4: Sandbox state ---

export interface SandboxSnapshotEvent extends BaseEvent {
	type: "sandbox:snapshot";
	iteration: number;
	state: Record<string, unknown>;
}

// --- Discriminated union ---

export type PressEvent =
	| RunStartEvent
	| RunEndEvent
	| InvocationStartEvent
	| InvocationEndEvent
	| IterationStartEvent
	| IterationEndEvent
	| LlmRequestEvent
	| LlmResponseEvent
	| LlmErrorEvent
	| DelegationSpawnEvent
	| DelegationReturnEvent
	| DelegationErrorEvent
	| DelegationUnawaitedEvent
	| SandboxSnapshotEvent;

// --- Engine-facing sink ---

export interface PressEventSink {
	emit(event: PressEvent): void;
}
