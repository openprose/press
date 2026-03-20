export const EXECUTE_CODE_TOOL = {
  type: "function" as const,
  function: {
    name: "execute_code",
    description:
      "Execute JavaScript in a persistent Node.js REPL. console.log() output is returned. Call return(value) to produce your final answer.",
    parameters: {
      type: "object" as const,
      properties: {
        code: { type: "string" as const, description: "JavaScript code to execute" },
      },
      required: ["code"],
    },
  },
};

export const TOOL_CHOICE = {
  type: "function" as const,
  function: { name: "execute_code" },
};

export interface ContextFrameInput {
  depth: number;
  data: Record<string, unknown> | string | undefined;
  label?: string;
}

export type ContextLayoutMode = "mirror" | "cache-efficient";

export interface BuildSystemPromptOptions {
  canDelegate: boolean;
  invocationId: string;
  parentId: string | null;
  depth: number;
  maxDepth: number;
  maxIterations: number;
  lineage: readonly string[];
  programContent?: string;
  globalDocs?: string;
  modelTable?: string;
  availableComponents?: string[];
  /** Pre-rendered context stack section to include in the prompt. */
  contextStackContent?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    canDelegate,
    invocationId,
    parentId,
    depth,
    maxDepth,
    maxIterations,
    lineage,
    programContent,
    globalDocs,
    modelTable,
    availableComponents,
    contextStackContent,
  } = options;

  const sections: string[] = [];

  // 1. Preamble
  sections.push(`<rlm-preamble>
You are an RLM -- a Recursive Language Model. You are a general-purpose computer: a while loop, a language model, and a JavaScript sandbox. You run programs by reading prose and writing code.

You write JavaScript using the execute_code tool. Each response produces one tool call. You see the output. Repeat until you call \`return(answer)\`.

Trust yourself. The engine is minimal by design; you handle ambiguity, error recovery, planning, and judgment. If your program prescribes composition patterns, treat them as a starting vocabulary -- ground decisions in observable state and adapt when the situation calls for it. Multi-polarity is structural error correction: two agents with distinct roles catch errors a single agent rationalizes away.
</rlm-preamble>`);

  // 2. Environment
  let envBody = `- \`context\` -- task data from your caller. Each agent has its own.
- \`console.log()\` -- observe results between iterations.
- \`return(value)\` -- terminate and return your answer. Only call after verifying via console.log.
- \`require()\` -- Node.js built-in modules only.`;

  if (canDelegate) {
    envBody += `
- \`await press(query, context?, options?)\` -- delegate to a child RLM. Options: \`{ systemPrompt?, model?, maxIterations?, use? }\`.
  - \`use\` loads a named component for the child. \`model\` selects an alias (see Available Models). \`maxIterations\` caps the child's budget.
  - **Must be awaited.** Unawaited calls are silently lost.
  - Delegation depth is finite -- check \`__rlm.depth < __rlm.maxDepth\`.
`;
  }

  envBody += `
- \`__rlm\` (read-only) -- delegation metadata: \`{ depth, maxDepth, iteration, maxIterations, lineage, invocationId, parentId }\`
- \`__ctx.shared.data\` -- the root context, readable at any depth (frozen).
- \`__ctx.stack.frames\` -- read-only array of ancestor context frames (\`{ depth, data, label }\`). Index 0 = root.
- \`__ctx.stack.depth\` -- current delegation depth.
- Variables persist across iterations. Code from earlier iterations is still in scope.

The sandbox is persistent and shared. All agents in the delegation tree execute in the same JavaScript VM. Variables set before \`press()\` are readable by the child. Variables set by the child are readable after it returns. Convention: prefix shared state with \`__\` (double underscore).`;

  if (globalDocs) {
    envBody += `\n\n## Sandbox Globals\n\n${globalDocs}`;
  }

  if (canDelegate && modelTable) {
    envBody += modelTable;
  }

  sections.push(`<rlm-environment>\n${envBody}\n</rlm-environment>`);

  // 3. Context
  const rootTask =
    lineage[0].length > 200 ? lineage[0].substring(0, 200) + "..." : lineage[0];
  const roleDesc =
    depth === 0
      ? "You are the root orchestrator."
      : `Parent: "${parentId}". Root task: "${rootTask}"`;
  const delegationDesc = canDelegate
    ? `You can delegate to child RLMs at depth ${depth + 1}.`
    : "You are at maximum delegation depth and cannot spawn child agents.";

  const remainingDepth = maxDepth - depth - 1;
  const depthBudgetDesc =
    remainingDepth > 0
      ? `Remaining delegation depth: ${remainingDepth} level(s) below you.`
      : depth < maxDepth
        ? "Your children will be at maximum depth (leaves, cannot delegate further)."
        : "";

  const componentsDesc = canDelegate && availableComponents && availableComponents.length > 0
    ? `\nAvailable components: ${availableComponents.join(", ")}`
    : "";

  sections.push(`<rlm-context>
Agent "${invocationId}" -- depth ${depth} of ${maxDepth} (0-indexed).
${roleDesc}
Iteration budget: ${maxIterations} iterations.
${delegationDesc}${depthBudgetDesc ? "\n" + depthBudgetDesc : ""}${componentsDesc}
</rlm-context>`);

  // 3b. Context stack
  if (contextStackContent) {
    sections.push(`<rlm-context-stack>\n${contextStackContent}\n</rlm-context-stack>`);
  }

  // 4. Rules
  let rulesBody = `- One execute_code tool call per response. Stop and wait for output.
- \`return(value)\` only after verifying via \`console.log()\`.
- Always \`await\` press() calls -- unawaited calls are silently lost.
- Each iteration must produce observable progress. Write code, observe, adapt.
- Errors are surfaced, not swallowed. Read them and adapt.
- Never return a value you have not first logged and confirmed in output.`;

  if (canDelegate) {
    rulesBody += `
- Construct delegation briefs from &-state, not from your own analysis.
- Curate after every delegation return. Delegation without curation has zero value.
- prohibited is a shape violation. Calling a prohibited API means you collapsed into your child's role.
- Skipping a coordinator (direct composition) means inheriting its responsibilities.`;
  }

  sections.push(`<rlm-rules>\n${rulesBody}\n</rlm-rules>`);

  // 5. Program
  if (programContent) {
    const constructsPreamble = `Your program below uses structured prose constructs:
- Contracts (ensures/requires): satisfy all postconditions and preconditions.
- State schemas: &Name lives in the sandbox as __camelCase. Read/write directly.
- Shape (shape/prohibited): what you do directly vs. delegate. prohibited = must NOT call.
- Strategies: prioritized options with trigger conditions. Select based on current state.
- Capabilities: function specs with verify checks. You implement them; run the checks.
- Component catalogs: requires from caller / produces for caller. Check before delegating.
- Implementation code is illustrative. Write better code if you can.

`;
    sections.push(`<rlm-program>\n${constructsPreamble}${programContent}\n</rlm-program>`);
  }

  return sections.join("\n\n");
}

const MAX_FRAME_CHARS = 5000;

function renderFrameData(data: Record<string, unknown> | string | undefined): string {
  if (data === undefined) return "(no data)";
  if (typeof data === "string") {
    if (data.length > MAX_FRAME_CHARS) {
      return data.substring(0, MAX_FRAME_CHARS) + `\n[truncated: ${data.length - MAX_FRAME_CHARS} chars omitted]`;
    }
    return data;
  }
  const rendered = JSON.stringify(data, null, 2);
  if (rendered.length > MAX_FRAME_CHARS) {
    return rendered.substring(0, MAX_FRAME_CHARS) + `\n[truncated: ${rendered.length - MAX_FRAME_CHARS} chars omitted]`;
  }
  return rendered;
}

function renderFrame(frame: ContextFrameInput): string {
  const labelAttr = frame.label ? ` label="${frame.label}"` : "";
  return `<context depth="${frame.depth}"${labelAttr}>\n${renderFrameData(frame.data)}\n</context>`;
}

export function renderContextStack(
  frames: readonly ContextFrameInput[],
  layout: ContextLayoutMode = "mirror",
): string {
  if (frames.length === 0) return "";

  const sections: string[] = [];

  if (layout === "cache-efficient") {
    // Oldest first, simple append order
    for (const frame of frames) {
      sections.push(renderFrame(frame));
    }
  } else {
    // Mirror mode: current at top, ancestors in middle (deepest first), current at bottom
    const current = frames[frames.length - 1];
    const ancestors = frames.slice(0, -1);

    sections.push(renderFrame(current));

    // Ancestors from deepest to shallowest (reverse order)
    for (let i = ancestors.length - 1; i >= 0; i--) {
      sections.push(renderFrame(ancestors[i]));
    }

    // If there are ancestors, repeat them shallowest to deepest, then current again
    if (ancestors.length > 0) {
      for (const ancestor of ancestors) {
        sections.push(renderFrame(ancestor));
      }
      sections.push(renderFrame(current));
    }
  }

  return sections.join("\n");
}

export function buildModelTable(
  models?: Record<string, { tags?: string[]; description?: string }>,
): string {
  if (!models || Object.keys(models).length === 0) return "";

  const aliases = Object.keys(models).sort();
  const rows = aliases.map((alias) => {
    const { tags, description } = models[alias];
    const tagsStr = tags && tags.length > 0 ? tags.join(", ") : "-";
    const descStr = description || "-";
    return `| ${alias} | ${tagsStr} | ${descStr} |`;
  });

  return (
    `\n\n## Available Models\n\n` +
    `When delegating with \`press()\`, you can select a model by alias:\n\n` +
    `| Alias | Tags | Description |\n` +
    `|-------|------|-------------|\n` +
    rows.join("\n") +
    `\n\nUsage: \`await press("query", context, { model: "fast" })\`\n` +
    `Default (no model specified): uses the same model as the current agent.`
  );
}
