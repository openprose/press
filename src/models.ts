export interface ModelAliasDefinition {
	modelId: string;
	tags: string[];
	description: string;
}

export const DEFAULT_MODEL_ALIASES: Record<string, ModelAliasDefinition> = {
	fast: {
		modelId: "openrouter/google/gemini-3-flash-preview",
		tags: ["fast", "cheap"],
		description: "Gemini 3 Flash — 1M context, low cost, low latency",
	},
	orchestrator: {
		modelId: "openrouter/anthropic/claude-sonnet-4.5",
		tags: ["orchestrator", "medium"],
		description: "Claude Sonnet 4.5 — 200k context, mid cost, mid latency",
	},
	intelligent: {
		modelId: "openrouter/anthropic/claude-opus-4-6",
		tags: ["intelligent", "expensive"],
		description: "Claude Opus 4.6 — 200k context, high cost, high latency",
	},
};
