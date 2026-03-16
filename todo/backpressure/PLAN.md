# Backpressure Implementation Plan

How we build the post-hoc judge, starting small and iterating from evidence.

## Background

### What this is

The judge is a post-hoc evaluation system. It takes a completed execution trace (observer events) and the program files that governed the run, and produces a structured adherence assessment. No engine changes required. See BACKPRESSURE.md for the full vision; this plan describes the minimal path to a working system.

### Key design decisions

**No scores.** The schema produces structured findings (lists of violations, contract checks, classified briefs), not 0..1 scalars. A shape score of 0.7 tells you nothing. A list of 3 violations with severity, component, and event references tells you exactly what to fix. If scalar comparison is needed downstream, compute it from the structured data.

**Three tiers of analysis.** Some adherence checks are mechanical (extractable from the event trace without LLM judgment) and some require interpretation. Starting with mechanical gives a deterministic baseline before introducing the judge's own reliability as a variable.

- **Tier 1 (mechanical):** Extractable from events + program frontmatter. Deterministic. Free.
- **Tier 2 (structured judgment):** LLM interprets trace data against a bounded rubric. Structured output.
- **Tier 3 (open judgment):** LLM reasons about what should have happened. Most valuable, noisiest. Deferred.

**Single node first.** The BACKPRESSURE.md design has 5 specialist judges. We start with 1. Multi-polarity adds value when the monologue rationalizes -- we need evidence of rationalization before adding structural tension.

**Trace digest as interface.** The LLM judge does not consume raw events. A mechanical preprocessor condenses events into a per-invocation summary. This controls context size and ensures the judge sees a consistent input format regardless of trace length.

### Which adherence dimensions produce actionable signal

Ranked by "would you actually change the program based on this":

1. **Shape violations** -- coordinator calls prohibited API directly. Binary, concrete. Action: strengthen prohibition language or restructure the node.
2. **Brief quality** -- parent dumps frame analysis instead of state facts. The #1 failure mode. Action: rewrite delegation discipline, add brief templates, tighten ensures.
3. **Curation presence** -- parent ignores child's return. Action: make given: blocks more concrete, add ensures about post-delegation state changes.
4. **Budget usage** -- model exhausts iterations without returning. Action: adjust budgets or add termination invariants.
5. **Contract satisfaction** -- ensures/requires not met. Action: rewrite the contract (distinguish "model couldn't" from "poorly specified").

Dimensions 1-4 are the focus. Dimension 5 is included but expected to be noisy initially.

### Infrastructure seams

The judge connects to the existing system at these points:

- **Input:** `EvalResult.events` (array of `RlmEvent` from the observer, saved in result JSON files). The harness (`eval/harness.ts`) creates an `RlmObserver` per task and attaches `observer.getEvents()` to every result. Existing result files predate this wiring and have empty events.

- **Event types** (defined in `src/events.ts`): All events share `{ runId, timestamp, invocationId, parentId, depth }`. Key types for the judge:
  - `iteration:end` -- has `code`, `output`, `error`, `returned` fields. The code field is where prohibited API violations are detectable.
  - `delegation:spawn` -- has `childId`, `query` (the brief text), `componentName`, `maxIterations`. The query field is where brief quality is assessed.
  - `delegation:return` / `delegation:error` -- has `childId`, `answer`/`error`, `iterations`.
  - `invocation:start` / `invocation:end` -- has `query`, `systemPrompt` / `answer`, `error`, `iterations`.
  - `llm:response` -- has `duration`, `usage` (token counts), `reasoning`, `code`.
  - `sandbox:snapshot` -- has `state` (deep copy of sandbox globals). Use for detecting &-state changes pre/post delegation.

- **Program loading:** `loadProgram(name)` in `src/plugins.ts` reads `programs/{name}/` and returns `{ globalDocs, rootApp, rootAppBody, childComponents }`. The node frontmatter contains `prohibited`, `delegates`, `api`, `state` fields that define the shape contract.

- **Observer utilities:** `observer.getTree(runId)` reconstructs the delegation tree from events. Returns `{ invocationId, children: TreeNode[] }`.

- **Result files:** Saved as JSON in `eval/results/`. Structure: `{ benchmark, model, config, timestamp, results: EvalResult[], aggregate }`. Each `EvalResult` has `{ taskId, answer, expected, score, iterations, wallTimeMs, events, metadata }`.

### Missing information warnings

When the trace digest encounters expected-but-absent data (e.g., `llm:response` events without `usage` fields, `sandbox:snapshot` events missing expected &-state variables), it should emit structured warnings. These feed back to OBSERVABILITY.md improvements but are a separate effort from the judge itself. The digest should still produce output with whatever data is available.

---

## Step 0: Get a trace ✓ COMPLETE

Run a small arc3 eval (1 task) to produce a result file with populated observer events. The harness already wires `RlmObserver` and saves `events` on every `EvalResult` -- existing result files just predate this wiring.

```bash
npx tsx eval/run.ts --benchmark arc3 --game ls20 --model anthropic/claude-opus-4-6 \
  --max-iterations 30 --max-depth 3 --max-tasks 1 --program arc3
```

**Exit criterion:** A result JSON with a non-empty `events` array. Inspect the events to confirm the key types are present: `iteration:end` with code, `delegation:spawn` with query, `llm:response` with usage. This is the raw material for everything that follows.

**Result:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-26T21-48-08-707Z.json` (122KB, 69 events). Task failed (terminated). Key event types present: `iteration:end` with code, `delegation:spawn` with query. `llm:response` present but all 10 missing `usage` field (openrouter doesn't return token counts in this path). No `sandbox:snapshot` events.

---

## Step 1: Trace digest + mechanical extraction ✓ COMPLETE

Implemented in `eval/judge.ts` (~1090 lines). Reads a result file and produces two things.

### 1a. Trace digest

Condenses the raw event stream into a per-invocation summary the LLM judge can consume without drowning in context. The digest is the **interface** between the mechanical layer and the LLM judge.

```
TraceDigest {
  run: RunIdentity                    -- from Step 1b
  tree: DelegationTree                -- from Step 1b
  resources: ResourceUsage            -- from Step 1b

  invocations: [{
    invocation_id: string
    parent_id: string | null
    component: string | null          -- from delegation:spawn.componentName
    depth: number
    role: string | null               -- from program frontmatter if component is known

    iterations: [{
      number: number
      code_summary: string            -- first ~500 chars of code, or full if short
      delegations: [{                 -- delegation:spawn events in this iteration
        child_component: string
        brief_excerpt: string         -- first ~300 chars of query
        outcome: "returned" | "error"
        child_iterations: number
      }]
      output_excerpt: string          -- first ~300 chars of output
      error: string | null
      returned: boolean
    }]

    -- per-invocation mechanical flags
    prohibited_violations: string[]   -- specific API calls found in code
    shape_warnings: string[]          -- e.g., "called arc3.observe (listed under child's api)"
  }]

  warnings: string[]                  -- missing data warnings
}
```

### 1b. Mechanical metrics (Tier 1)

RunIdentity, ShapeAdherence (prohibited violations + collapse detection), DelegationTree (topology, budgets, unawaited counts), ResourceUsage (tokens by component, wasted/error iterations). See type definitions in `eval/judge.ts` lines 44-164 for full schemas.

### Exported API

```typescript
// eval/judge.ts exports:
buildTraceDigest(events: RlmEvent[], program: ProgramDefinition, meta: ResultMeta) -> TraceDigest
extractMechanicalMetrics(events: RlmEvent[], program: ProgramDefinition, meta: ResultMeta) -> MechanicalMetrics
buildAdherenceReport(events: RlmEvent[], program: ProgramDefinition, meta: ResultMeta) -> AdherenceReport  // { digest, metrics }
```

CLI: `npx tsx eval/judge.ts --result <path> --program <name> [--task <taskId>]`

### Key implementation details

- Loads program via `loadProgram()` from `src/plugins.ts`, uses `parseFrontmatter()` to extract `prohibited`, `delegates`, `api` fields per node
- Fuzzy component matching handles naming mismatch between program frontmatter (`arc3-level-solver`) and delegation events (`level-solver`) via suffix matching
- Prohibited violation detection: scans `iteration:end` code line-by-line, skipping comments, using word-boundary regex matching
- Collapse detection: checks if a delegating component calls APIs owned by its children (from `api` field in child frontmatter)
- Truncation: code at 500 chars, briefs/output at 300 chars
- Warnings emitted for: missing events, missing `usage` fields on `llm:response`, missing `componentName` on `delegation:spawn`, missing `sandbox:snapshot` events

### Findings from the Step 0 trace

Running against the real trace produced actionable signal:

- **Topology:** root → level-solver only. The level-solver never delegated to `oha` (depth 1, never reached depth 2).
- **Zero prohibited violations** — model respected shape.
- **1 unawaited delegation** in level-solver (wasted API call).
- **Level-solver terminated** after 6 iterations (budget was 18) — the parent's task was terminated, killing the child.
- **Brief contamination visible in digest:** The game-solver → level-solver brief contains frame analysis ("This appears to be a maze/navigation puzzle", "Background is color 4", "There appears to be a player entity around rows 31-33"). This is exactly the contamination pattern the Step 2 judge should flag — parent dumping its own interpretation instead of &-state facts.
- **No token usage data** — openrouter doesn't return token counts; all `llm:response` events had null `usage`.
- **No sandbox:snapshot events** — &-state diff analysis unavailable. This limits curation assessment.
- **2 wasted iterations, 3 error iterations** out of 12 total.

---

## Step 2: Single-node LLM judge

Two parts: (a) the judge program in `programs/judge/`, (b) the orchestration wiring in `eval/judge.ts`.

### 2a. Judge program

```
programs/judge/
  root.md          -- globalDocs: evaluation principles, Tier 2 schema, rubrics
  evaluator.md     -- single orchestrator node: reads context, produces structured report
```

This is a standard RLM program. It follows the same conventions as `programs/arc3/` — `root.md` has `kind: program` frontmatter and its body becomes `globalDocs` visible to all nodes. `evaluator.md` is a component with frontmatter defining its contract.

**What root.md contains (globalDocs):**

- The Tier 2 schema definitions (BriefAdherence, CurationAdherence, ContractAdherence) — see schemas below
- Evaluation principles:
  - Assess what the model DID against what the program SAYS, not against what a perfect agent would do
  - The judge's job is to find actionable deviations — things that would change the program
  - Be specific: cite invocation IDs, iteration numbers, and quote relevant text
- Brief quality rubric:
  - Good brief: facts from &-state variables, a goal, open questions. Grounds the child in observable state.
  - Bad brief: action instructions ("navigate to X"), domain interpretation ("this is a maze"), tactical advice ("try moving right"). These contaminate the child's observation cycle.
  - Contamination severity: "none" (facts only), "mild" (some interpretation mixed with facts), "severe" (primarily instructions/interpretation)
- Curation rubric:
  - Present: parent code after `await rlm()` reads the return value, updates &-state, promotes/demotes knowledge, extracts findings
  - Absent: parent ignores the return, or delegation is the last thing in the iteration with no post-processing
  - Note: without `sandbox:snapshot` events, curation assessment relies on reading the parent's code in subsequent iterations
- Contract checking rubric:
  - For each `requires` clause: is there evidence the precondition was true when the component was invoked?
  - For each `ensures` clause: is there evidence the postcondition was satisfied when the component returned?
  - For each invariant: was it maintained across all iterations? Cite specific violations.
  - Use "unknown" when trace evidence is insufficient — don't guess

**What evaluator.md contains:**

Frontmatter: `name`, `role: evaluator`, `api` (sandbox globals it reads), contract (`requires` the digest and program files to be present, `ensures` it produces valid JSON matching the schema).

Body: instructions for reading the trace digest, cross-referencing with program files, and producing each section of the report. Key instruction: **read the full brief text for each delegation, not just the excerpt** — the digest truncates briefs to 300 chars, but the full text may be available in the `delegation:spawn` events if injected. (In practice the digest excerpt may be all that's available; the judge should note when it can't fully assess a truncated brief.)

### Tier 2 schemas (what the evaluator produces)

**BriefAdherence:**
```
BriefAdherence {
  delegations: [{
    parent_component: string
    child_component: string
    brief_text: string               -- the full or truncated brief
    contains_facts_from_state: boolean
    contains_action_instructions: boolean
    contains_tactical_advice: boolean
    goal_present: boolean
    contamination_severity: "none" | "mild" | "severe"
    notes: string
  }]
}
```

**CurationAdherence:**
```
CurationAdherence {
  delegations: [{
    parent_component: string
    child_component: string
    curation_present: boolean
    observed_actions: string[]        -- what the parent did with the return
    state_vars_changed: string[]      -- which &-state vars changed (from sandbox:snapshot diff)
    notes: string
  }]
}
```

**ContractAdherence:**
```
ContractAdherence {
  requires: [{
    component: string
    clause: string
    satisfied: boolean | "unknown"
    evidence: string
  }]

  ensures: [{
    component: string
    clause: string
    satisfied: boolean | "unknown"
    evidence: string
  }]

  invariants: [{
    component: string
    clause: string
    maintained: boolean | "unknown"
    violations: [{ iteration: number, description: string }]
  }]
}
```

### 2b. Orchestration wiring in eval/judge.ts

The existing `eval/judge.ts` needs to be extended with a `--judge` flag (or made the default behavior) that:

```
eval/judge.ts --result <path> --program <name> [--judge]

1. Load result JSON, extract events for the target task
2. Load program files via loadProgram(name) — the program being JUDGED
3. Run Step 1: buildAdherenceReport() produces { digest, metrics }
4. Load the judge program via loadProgram("judge")
5. Set up sandbox globals for the judge:
   - __traceDigest = digest           (the condensed event summary)
   - __mechanicalMetrics = metrics    (Tier 1 deterministic findings)
   - __programFiles = { ... }         (full content of the judged program's root.md + node .md files)
   - __specDocs = { ... }             (LANGUAGE.md, CONTAINER.md content — for rubric context)
6. Call rlm() with the judge program, maxIterations ~15
7. Parse the evaluator's return value as structured JSON
8. Merge Tier 1 (mechanical) + Tier 2 (judgment) into final report
9. Output to stdout (or save as <result_basename>.judge.json)
```

The key wiring detail: the judge is itself an RLM program. It uses `rlm()` from `src/rlm.ts`, the same function that runs arc3 programs. The sandbox globals are the mechanism for injecting context — the judge's code reads `__traceDigest`, `__programFiles`, etc. just like arc3 code reads `arc3.observe()`.

**Sandbox injection pattern:** Look at how `eval/harness.ts` sets up sandbox globals for benchmarks (e.g., `sandbox.arc3 = ...`). The judge needs similar setup but with its own globals. The harness uses `vm.createContext()` — the judge orchestrator needs to do the same, or use `rlm()`'s existing `sandbox` option if one exists. Check `src/rlm.ts` for the `sandbox` or `context` option on `rlm()`.

**Loading spec documents:** Read `LANGUAGE.md` and `CONTAINER.md` from the project root. These are static — load once, inject into sandbox.

**Loading program files for the judged program:** The `loadProgram()` return includes `rootAppBody` and `childComponents`. The judge needs the raw markdown content of each node file, including frontmatter. Use `program.rootAppBody` for the root node and `Object.entries(program.childComponents)` for child nodes.

**Model selection:** The judge should use the same model resolution as the eval harness. Accept `--model` flag, default to a capable model. The judge benefits from a strong model since it needs to assess brief quality and contract satisfaction.

**Exit criterion:** The judge produces a report that tells us something actionable about the arc3 program. At least one finding we'd change the program over. If the report is noise, the schema or digest needs adjustment before going further.

**Concrete test case from Step 1 findings:** The brief from game-solver → level-solver in the Step 0 trace contains clear contamination: "This appears to be a maze/navigation puzzle on a 64x64 grid" and "Background is color 4" and "There appears to be a player entity around rows 31-33, cols 19-21". The judge should flag this as `contamination_severity: "severe"` — the parent interpreted the frame and injected tactical analysis instead of passing &-state facts. If the judge doesn't catch this, the rubric needs work.

---

## Step 3: Iterate

Run the judge against multiple traces. Read the output. Answer:

1. Which fields are consistently populated with useful signal?
2. Which fields are noise or "unknown"?
3. Is the trace digest the right granularity? Too much? Too little?
4. Does the single evaluator rationalize its own assessments? (If yes: time for multi-polar expansion.)
5. What did the judge miss that a human reviewer catches?
6. Are there events we expected but don't have? (Feed back to OBSERVABILITY.md.)

Adjust the schema, the digest format, and the judge program from evidence. This is the learning loop -- the whole point of starting small.

---

## What success looks like

After Step 3, we have:
- A concrete report format validated against real traces
- A working judge program that eats its own dogfood (RLM program judging RLM programs)
- Evidence about which adherence dimensions produce actionable signal
- A foundation to build the deferred components on (see DEFERRED.md)
