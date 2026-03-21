import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormePromptOptions {
  phase: "forme";
  runId: string;
  runDir: string;
  programDir: string;
  specDir: string;
  entryPoint: string;
}

export interface ProseVmPromptOptions {
  phase: "prose-vm";
  runId: string;
  runDir: string;
  specDir: string;
  manifest: string;
  callerInputs: Record<string, string>;
}

export interface ServicePromptOptions {
  phase: "service";
  runId: string;
  runDir: string;
  specDir: string;
  serviceName: string;
  serviceDefinition: string;
  inputs: Record<string, string>;
  workspace: string;
  outputs: string[];
  depth: number;
  parentId: string;
  iterationBudget: number;
}

export type PromptOptions =
  | FormePromptOptions
  | ProseVmPromptOptions
  | ServicePromptOptions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap content in an XML tag.
 */
function xmlWrap(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

/**
 * Load a spec file from the spec directory.
 * Returns the file contents as a string, or throws with a clear message
 * if the file cannot be read.
 */
function loadSpec(specDir: string, filename: string): string {
  const filePath = join(specDir, filename);
  try {
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(
      `Failed to load spec "${filename}" from ${specDir}: ${code === "ENOENT" ? "file not found" : (err as Error).message}`,
    );
  }
}

/**
 * Build the RLM preamble — the universal header that explains the REPL
 * environment. Includes depth/parent info for child invocations.
 */
function buildPreamble(opts?: {
  depth?: number;
  parentId?: string;
  iterationBudget?: number;
}): string {
  let preamble = `You are Press, an RLM (Recursive Language Model). You operate in a REPL loop:
you write JavaScript code, observe the output, and iterate until you call RETURN().

Your environment:
- You can write and execute JavaScript/Node.js code
- You have filesystem access via \`fs\` (require('fs'))
- You can make HTTP requests via \`fetch\`
- \`RETURN(value)\` ends your loop and returns the value
- \`press(name, options)\` spawns a child RLM loop
- \`console.log()\` prints output you can observe between iterations
- \`context\` contains your input data`;

  if (opts?.depth != null && opts.depth > 0) {
    preamble += `

Invocation context:
- Depth: ${opts.depth} (child of root)
- Parent: ${opts.parentId ?? "root orchestrator"}
- Iteration budget: ${opts.iterationBudget ?? 15}`;
  }

  preamble += `

Rules:
- Write code in \`\`\`repl fenced blocks
- One code block per iteration
- Observe the output before writing more code
- Call RETURN() when your task is complete`;

  return preamble;
}

/**
 * Build the run context section for any phase.
 */
function buildRunContext(options: PromptOptions): string {
  const lines: string[] = [];
  lines.push(`Run ID: ${options.runId}`);
  lines.push(`Run directory: ${options.runDir}`);

  if (options.phase === "forme") {
    lines.push(`Program directory: ${options.programDir}`);
    lines.push(`Phase: 1 (Wiring)`);
    lines.push("");
    lines.push(
      `Your task: Wire this program. Read the entry point provided in context, then`,
    );
    lines.push(
      `resolve and read each service file from disk following the Forme resolution`,
    );
    lines.push(
      `order (same directory as entry point, subdirectory, or registry). Produce the`,
    );
    lines.push(
      `manifest and copy source files into the run directory per the Forme specification.`,
    );
    lines.push("");
    lines.push(`After wiring is complete, RETURN a confirmation message.`);
  } else if (options.phase === "prose-vm") {
    lines.push(`Phase: 2 (Execution)`);
    lines.push("");

    const inputEntries = Object.entries(options.callerInputs);
    if (inputEntries.length > 0) {
      lines.push("Caller inputs:");
      for (const [name, value] of inputEntries) {
        lines.push(`- ${name}: ${JSON.stringify(value)}`);
      }
      lines.push("");
    }

    lines.push(
      `Your task: Execute this program per the Prose VM specification. Read the manifest`,
    );
    lines.push(
      `provided in \`context\`. Follow the execution order. For each service, call`,
    );
    lines.push(
      `press(serviceName, { inputs, workspace }) — Press will look up the service`,
    );
    lines.push(
      `definition and resolve input paths natively. Manage state.md, workspace/, and`,
    );
    lines.push(`bindings/ per the filesystem spec.`);
    lines.push("");
    lines.push(`When the program is complete, RETURN the final output.`);
  }
  // Service phase uses a different context format (buildServiceContext)

  return lines.join("\n");
}

/**
 * Build the service context section (inputs, workspace, outputs).
 */
function buildServiceContext(options: ServicePromptOptions): string {
  const lines: string[] = [];

  lines.push("## Your Inputs");
  lines.push("");
  lines.push("Your input data is available as `context.inputs`:");

  for (const [name, value] of Object.entries(options.inputs)) {
    lines.push(`- \`context.inputs.${name}\` — ${value}`);
  }

  lines.push("");
  lines.push("## Your Workspace");
  lines.push("");
  lines.push(`Write all your work to: ${options.workspace}`);

  lines.push("");
  lines.push("## Required Outputs");
  lines.push("");
  lines.push("When done, write these files to your workspace:");

  for (const output of options.outputs) {
    lines.push(
      `- ${output}: workspace/${options.serviceName}/${output}.md`,
    );
  }

  lines.push("");
  lines.push(
    "Then call RETURN with a confirmation message (not the full output).",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Runtime glossary
// ---------------------------------------------------------------------------

/**
 * Build the Press runtime translation glossary mapping Prose/Forme spec concepts to Press sandbox equivalents.
 * @returns XML-wrapped `<press-runtime>` glossary string.
 */
export function buildRuntimeGlossary(): string {
  return `<press-runtime>
## Runtime Translation: Prose Specs → Press Sandbox

The Prose and Forme specs were written for a generic execution environment.
In Press, the following mappings apply:

### Spawning Children

| Spec says | You do |
|-----------|--------|
| "Spawn a session via the Task tool" | \`await press(query, context)\` |
| "Spawn a subagent" | \`await press(query, context)\` |
| "Make multiple Task calls in a single response" | \`await Promise.all([press(...), press(...)])\` |
| "AskUserQuestion tool" | Not available. If input is missing, signal an error. |

### Passing Data

| Spec says | You do |
|-----------|--------|
| "Pass input file paths" | Pass values directly in context, or paths that Press auto-resolves |
| "The VM tracks pointers, not values" | In Press, small values may be passed inline via context |
| "Read from bindings/" | \`fs.readFileSync(path, 'utf8')\` or receive via context |
| "Write to workspace/" | \`fs.writeFileSync(path, content)\` |
| "Copy from workspace to bindings" | \`fs.copyFileSync(src, dst)\` after child returns |

### The press() Function

\`await press(query, context?, options?)\` spawns a child loop.
- Returns the value the child passed to \`return()\`
- Children access their data via the \`context\` variable
- The parent receives the return value from \`await press()\`

### File System

All filesystem operations the specs describe (mkdir, write, copy, append)
are performed by YOU using \`require('fs')\`. Press does not perform
filesystem operations on your behalf.

### What Applies Exactly As Written

- The Forme wiring algorithm (contract matching, dependency graph, manifest format)
- The execution order from the manifest
- The workspace/bindings directory structure
- state.md logging
- Error signaling via __error.md
- Contract evaluation (ensures, invariants, strategies)
</press-runtime>`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the complete system prompt for a given phase (forme, prose-vm, or service).
 * @param options - Phase-specific configuration including spec directory and run context.
 * @returns Assembled system prompt string with specs, glossary, and run context.
 */
export function buildPressPrompt(options: PromptOptions): string {
  const sections: string[] = [];

  switch (options.phase) {
    case "forme": {
      // RLM preamble (root depth)
      sections.push(buildPreamble());

      // Forme spec
      const formeSpec = loadSpec(options.specDir, "forme.md");
      sections.push(xmlWrap("forme-spec", formeSpec));

      // Filesystem spec
      const fsSpec = loadSpec(
        join(options.specDir, "state"),
        "filesystem.md",
      );
      sections.push(xmlWrap("filesystem-spec", fsSpec));

      // Runtime glossary (Prose spec → Press sandbox translation)
      sections.push(buildRuntimeGlossary());

      // Run context
      sections.push(xmlWrap("run-context", buildRunContext(options)));

      break;
    }

    case "prose-vm": {
      // RLM preamble (root depth)
      sections.push(buildPreamble());

      // Prose VM spec
      const proseSpec = loadSpec(options.specDir, "prose.md");
      sections.push(xmlWrap("prose-vm-spec", proseSpec));

      // Session spec
      const sessionSpec = loadSpec(
        join(options.specDir, "primitives"),
        "session.md",
      );
      sections.push(xmlWrap("session-spec", sessionSpec));

      // Filesystem spec
      const fsSpec = loadSpec(
        join(options.specDir, "state"),
        "filesystem.md",
      );
      sections.push(xmlWrap("filesystem-spec", fsSpec));

      // Runtime glossary (Prose spec → Press sandbox translation)
      sections.push(buildRuntimeGlossary());

      // Run context
      sections.push(xmlWrap("run-context", buildRunContext(options)));

      break;
    }

    case "service": {
      // RLM preamble (child variant with depth, parent, budget)
      sections.push(
        buildPreamble({
          depth: options.depth,
          parentId: options.parentId,
          iterationBudget: options.iterationBudget,
        }),
      );

      // Session spec
      const sessionSpec = loadSpec(
        join(options.specDir, "primitives"),
        "session.md",
      );
      sections.push(xmlWrap("session-spec", sessionSpec));

      // Service definition
      sections.push(
        xmlWrap("service-definition", options.serviceDefinition),
      );

      // Service context (inputs, workspace, outputs)
      sections.push(buildServiceContext(options));

      break;
    }
  }

  return sections.join("\n\n");
}
