/**
 * Shared utility functions used across Press CLI, eval pipeline, and boot.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Generate a timestamped run ID with random suffix. */
export function generateRunId(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10).replace(/-/g, "");
	const time = now.toISOString().slice(11, 19).replace(/:/g, "");
	const rand = Math.random().toString(36).slice(2, 8);
	return `${date}-${time}-${rand}`;
}

/** Format a duration in milliseconds to a human-readable string. */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

/** Format a number with locale-aware thousand separators. */
export function formatNumber(n: number): string {
	return n.toLocaleString();
}

/**
 * Load environment variables from a .env file.
 * Does not overwrite existing env vars. Handles quoted values.
 * @param dir - Directory containing .env file (defaults to cwd).
 */
export function loadEnvFile(dir?: string): void {
	const envPath = resolve(dir ?? process.cwd(), ".env");
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
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
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
