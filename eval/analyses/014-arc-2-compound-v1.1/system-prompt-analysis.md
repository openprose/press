# System Prompt Analysis: ARC-2 Compound v1.1.0

**Eval:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T12-02-47-768Z.json`
**Score:** 2/3 tasks correct (67%)
**Cost:** $2.46 | **Wall time:** 31.9 minutes
**Config:** `maxIterations=10`, `maxDepth=2`, model=claude-opus-4-6

---

## 1. Orchestrator Orientation

### Did the orchestrator understand its role?

**Yes, initially.** The orchestrator's first iteration (iter 0) demonstrated strong orientation. It immediately followed the plugin's setup pattern, initialized `__arcSession`, inspected all tasks, and began the delegation loop. The code closely mirrors the illustrative code in `arc2-orchestrator.md`:

```javascript
// Orchestrator iter 0, block 0 (setup - closely follows plugin spec)
const taskIds = globalThis.__arcTaskIds;
console.log(`Compound session: ${taskIds.length} tasks to solve`);
globalThis.__arcSession = {
  currentIndex: 0,
  pass: 1,
  submittedCorrect: 0,
  failedTaskIds: [],
  totalSubmissions: 0,
};
```

The orchestrator then ran the entire session -- all 3 pass@1 tasks, the pass@2 transition, and both retries -- in a single iteration (iter 0) via 8 code blocks. It delegated correctly with `{ app: "arc2-solver", maxIterations: 18 }`, used try-catch around `rlm()` calls, ran sanity checks, performed inline curation, and used diagnostic retry prompts. All of these behaviors were specified in the plugin.

### Did it follow the shape declaration?

**No. Shape was violated in iteration 1.** After completing the full session in iter 0, the orchestrator received the "early return intercepted" message (the harness's first-iteration return verification). Instead of re-confirming the return value, it began directly solving task `0934a4d8`:

```javascript
// Root iter 1, block 0 -- SHAPE VIOLATION: orchestrator analyzes grids directly
const remaining = __arcSubmit.remaining('0934a4d8');
const task = globalThis.__arcTasks['0934a4d8'];
console.log('Training pair 0:');
task.train[0].input.forEach((row, i) => console.log(`  ${i}: ${row.join('')}`));
```

Root iteration 1 contained **10 code blocks** of direct grid analysis: examining training pairs, searching for symmetry axes, testing reflections, computing transforms. This is precisely what the shape declaration prohibits:

```
shape:
  prohibited: [solving tasks directly -- do not analyze grids or write transforms]
```

The orchestrator found the correct symmetry structure (axis at 15.5 with 100% match on all training pairs) but then failed to produce a correct test output in iter 2 due to out-of-bounds cells it could not fill. It ended up not submitting, and the final score stayed at 2/3.

### Was the illustrative code helpful or did the agent deviate?

The illustrative code was **extremely effective for iteration 0**. The orchestrator copied the structure almost verbatim -- setup, main loop, pass@2 transition, retry logic, and return. The key adaptations were:

1. **Combining all operations into single blocks.** The plugin says "combine all operations in a single code block per task" and the orchestrator did this, running setup + 3 tasks + retries in one iteration.
2. **Renaming variables per-task.** Since the orchestrator processed 3 tasks in one iteration, it renamed `logEntry` to `logEntry2`, `logEntry3` for subsequent tasks to avoid redeclaration errors. This is an LLM-standard workaround for persistent sandbox scope.
3. **Using `taskLog.find()` instead of array indexing.** The plugin uses `taskLog[taskLog.length - 1]` but the orchestrator used `.find(e => e.id === taskId)`, which is more robust when multiple entries exist.

The deviation from the shape in iter 1 was not caused by bad illustrative code -- it was caused by the orchestrator having 9 remaining iterations and seeing an unsolved task it "knew" it could help with. The shape declaration alone was insufficient to prevent this.

### Root cause of shape violation

The orchestrator had **only 3 tasks** and completed them efficiently in 1 iteration. With 9 remaining iterations, the model gravitated toward the path of least resistance: directly solving the remaining failed task. The plugin says "do not analyze grids or write transforms" but the model's general capability made this tempting.

**Key insight:** Shape compliance degrades when the agent has surplus budget and unfinished work. The declarative "prohibited" statement works when the agent has other work to delegate to, but when the only remaining work IS the prohibited work, the model ignores the constraint.

---

## 2. Solver Orientation

### Did the solver understand its role?

**Yes.** All 5 solver invocations immediately read from `globalThis`, printed task data, checked library primitives, and began hypothesis-driven exploration. The first code block of every solver closely followed the plugin's "Read the Environment First" section:

```javascript
// Child 0 (0934a4d8), iter 0, block 0 -- follows plugin spec exactly
const taskId = globalThis.__arcCurrentTask;
const task = globalThis.__arcTasks[taskId];
const library = globalThis.__arcLibrary;
const train = task.train;
const test = task.test;

console.log(`Task: ${taskId}`);
console.log(`Training pairs: ${train.length}, Test inputs: ${test.length}`);
console.log(`Library: ${Object.keys(library.primitives).length} primitives`);
```

### Did solvers know about prohibited APIs?

**Yes, implicitly.** No solver attempted to call `__arcSubmit.submit()`, `__arcSubmit.remaining()`, or `__arcSubmit.getResults()`. The prohibition was respected across all 5 invocations. The frontmatter `prohibited: [__arcSubmit.submit, __arcSubmit.remaining, __arcSubmit.getResults]` and the explicit "What You Cannot Do" section were both effective.

### Did solvers understand the hypothesis lifecycle?

**Partially.** The solvers explored hypotheses systematically -- testing flood fill, symmetry, component analysis -- but they did NOT use the formal lifecycle declared in the plugin. No solver tracked confidence numerically, and no solver used the `propose/update/confirm/refute` operations explicitly. Instead, they used inline comments:

```javascript
// Hypothesis: One color acts as a "boundary/barrier" and the other color flood-fills
// into the zero regions. Let me check which zeros get filled.
```

The hypothesis lifecycle in the plugin was too formal for the task structure. The solver's natural behavior (write a function, test it, keep or discard) was effective but did not match the structured `lifecycle:` specification.

### Did solvers use capabilities?

**Partially.** Solvers implemented `gridsEqual` (the plugin's first capability) and stored it on `__arcLibrary.primitives`. They did NOT implement `diffGrids`, `findComponents`, or `detectSymmetry` from the capabilities section. Instead, they wrote equivalent ad-hoc functions inline. The `verify` clauses were not executed for ad-hoc functions.

Child 0 stored 2 primitives (`find8Bbox`, `gridsEqual`). Child 1 stored 3 (`find2DPeriodStrict`, `extractTile`, `repairContent`). Child 2 stored 2 (`patternToMask`, `maskToString`). The library grew across tasks as intended.

### Did solvers use strategies correctly?

**Roughly.** Solvers followed the "observe first, then test hypotheses" pattern without formally referencing the strategy list. None used the strategy names from the plugin (`"observe"`, `"test_hypothesis"`, `"refine"`, `"finalize"`). The natural behavior tracked the spirit of the strategies but not the letter.

### Did solvers access globalThis state correctly?

**Yes.** All solvers correctly read `__arcCurrentTask`, `__arcTasks`, and `__arcLibrary` from `globalThis`. All solvers wrote back to `__arcLibrary.taskLog` before returning. The `&Library` state schema was followed -- solvers wrote `taskLog` entries with `id`, `solved`, `confidence`, `approach`, `keyInsight`, `answer`, `structuralProps`, and `newPrimitives` fields matching the schema.

### Multi-block execution problem

Every solver used **multiple code blocks per iteration**. Child 0 wrote 13 blocks in iter 0, Child 1 wrote 12, Child 3 wrote 10-13 blocks in some iterations. This is the `multi-block-execution` pattern documented in the trajectory format vocabulary. The errors observed (`TypeError: Cannot read properties of undefined (reading '0')`) were caused by later code blocks referencing variables that were defined conditionally in earlier blocks.

The plugin says "One function per iteration" and the system prompt says "One javascript block per response. Stop and wait for output." The model systematically violated this rule -- writing an entire exploration session (observe, form hypothesis, test, analyze, test again...) as multiple code blocks in a single response.

This is the **most significant prompt compliance failure** in the run. The "one block per response" rule in `<rlm-rules>` was insufficient to prevent it.

---

## 3. System Prompt Structure

### Current structure

The system prompt follows this hierarchy for all agents (root and children):

```
<rlm-preamble>      ~700 chars    Identity + interpreter basics
<rlm-environment>    ~1000 chars   Sandbox API + globalDocs (~2400 chars)
<rlm-context>        ~200 chars    Agent position (depth, parent, budget)
<rlm-rules>          ~400 chars    Behavioral invariants
<rlm-program>        ~14K chars    Plugin body (orchestrator or solver)
```

**Total:** ~19K chars (~4.8K tokens) for each agent.

### Did children receive appropriate context?

**Yes.** Children received the FULL `buildSystemPrompt()` -- identical `<rlm-preamble>`, `<rlm-environment>`, `<rlm-context>`, and `<rlm-rules>` sections, plus the solver app body as `<rlm-program>`. The `globalDocs` (sandbox globals documentation) was also injected at all depths.

This is a significant improvement over the ARC-3 architecture (which the user mentioned uses a "minimal buildChildRepl() environment section"). In this run, children had full context about the sandbox, delegation metadata (`__rlm`), shared context (`__ctx`), and all documented globals. There was **no evidence of children being confused about sandbox mechanics**.

### Did the structure cause any confusion?

**No confusion observed about structure.** The layered system prompt (preamble -> environment -> context -> rules -> program) was cleanly separated. The XML tags (`<rlm-preamble>`, `<rlm-environment>`, etc.) provided clear section boundaries.

One minor issue: the `<rlm-environment>` section describes generic sandbox globals (`context`, `__ctx.shared.data`, `require()`) that are **not used** by the ARC-2 compound benchmark. The solvers never accessed `context` (it was undefined), and `__ctx.shared.data` was irrelevant since all state flows through `globalThis` variables. This is ~300 chars of unhelpful content in every system prompt.

---

## 4. Plugin as System Prompt

### Was the v1.1.0 format effective?

**Highly effective for orchestration, moderately effective for solving.**

#### What was followed:

1. **Shape declarations (orchestrator):** Followed for the first iteration. The orchestrator delegated correctly before reverting to direct solving.
2. **Contract ensures clauses:** Sanity checks (dimensions, colors, non-triviality) were followed precisely. try-catch around `rlm()` was followed. Diagnostic retry prompts with prior approach info were followed.
3. **Environment section:** Both agents correctly used `globalThis` variables documented in this section.
4. **Setup and Main Loop illustrative code:** The orchestrator followed these sections nearly verbatim.
5. **Return protocol:** Solvers returned `JSON.stringify({ solved, confidence, answer })` as specified.
6. **TaskLog writes:** All 5 solvers wrote to `__arcLibrary.taskLog` before returning, even when failing.
7. **Prohibited APIs:** Respected by both agents.
8. **Leave-one-out validation:** Solvers attempted LOO when >= 3 training pairs existed.

#### What was ignored:

1. **"One function per iteration"** -- Systematically violated. Every solver wrote 3-13 functions per iteration.
2. **Hypothesis lifecycle formal structure** -- Solvers used informal hypothesis tracking instead of the `propose/update/confirm/refute` lifecycle.
3. **Strategy names and transitions** -- Solvers did not use named strategies or check `done_when` conditions.
4. **Capability specifications** -- Only `gridsEqual` was implemented from the declared capabilities. Others were written ad-hoc without `verify` checks.
5. **"Check library primitives BEFORE writing from scratch"** -- Child 0 wrote its own flood fill, BFS, grid comparison, etc. from scratch despite the plugin saying to check first. (The library was empty for child 0, so this was correct behavior.)
6. **Budget management** -- The "if stuck by iteration 15, log discoveries and return" heuristic was irrelevant since most solvers finished in 2-5 iterations.

#### Format assessment

The v1.1.0 format works best for **procedural coordination** (the orchestrator's session loop) and worst for **cognitive methodology** (the solver's hypothesis lifecycle). The orchestrator's illustrative code blocks were followed almost verbatim because they define a concrete procedure. The solver's hypothesis lifecycle, strategies, and capabilities were largely ignored because they define an abstract methodology that the model's own reasoning superseded.

**The plugin format's strength is declaring contracts and interfaces. Its weakness is prescribing methodology.**

---

## 5. GlobalDocs Effectiveness

### Content

The `arc-compound-global-docs.md` (2,417 chars) documents:
- Task data globals (`__arcTasks`, `__arcTaskIds`, `__arcCurrentTask`)
- Shared library (`__arcLibrary` shape: primitives, strategies, antiPatterns, taskLog)
- Submission API (`__arcSubmit.submit`, `__arcSubmit.remaining`, `__arcSubmit.getResults`)
- Submission strategy (pass@1 / pass@2 advice)
- Return protocol (`return(JSON.stringify(__arcSubmit.getResults()))`)

### Was it helpful?

**Yes, but with significant redundancy.** The globalDocs duplicates content from both the orchestrator and solver plugins:

1. **`__arcSubmit` API** is documented in globalDocs AND in the orchestrator's "The Environment" section AND in the solver's "What You Cannot Do" section. Three places.
2. **`__arcLibrary` shape** is documented in globalDocs AND in `program.md`'s "&Library" schema (if program mode was used) AND in the orchestrator's "The Environment" section.
3. **Task data globals** are documented in globalDocs AND in `program.md`'s "Harness-Injected Globals" AND in both plugins.
4. **Return protocol** appears in globalDocs AND in the orchestrator plugin's "Return" section.

The globalDocs was most useful for the **solver**, which does not have its own documentation of `__arcTasks` or `__arcCurrentTask`. The solver plugin says "Read the Environment First" and shows code that accesses these globals, but the globalDocs provides the formal type signatures.

For the **orchestrator**, the globalDocs was pure redundancy -- every global is already documented in the orchestrator plugin's "The Environment" section.

### Redundancy cost

At ~2,400 chars, the globalDocs adds ~600 tokens to every agent's system prompt. Since 5 children + 1 root = 6 agents, this is ~3,600 tokens of total globalDocs content, of which roughly half is redundant with the plugin content. The redundancy is not harmful per se (repetition can reinforce understanding), but it contributes to prompt length without adding information.

---

## 6. First-Iteration Behavior

### Orchestrator (root, iter 0)

**Orientation: Immediate and effective.** The orchestrator's first response contained 8 code blocks that executed the entire session:

1. **Block 0:** Setup -- inspect tasks, initialize `__arcSession`
2. **Blocks 1-3:** Delegate + submit + curate for tasks 1-3 (pass@1)
3. **Block 4:** Pass@2 transition + first retry delegation
4. **Block 5:** Remaining retry delegations (while loop)
5. **Block 6:** Final results summary
6. **Block 7:** `return(JSON.stringify(...))`

The orchestrator wasted zero iterations on orientation. It went straight from system prompt to full execution. This is a direct result of the highly procedural illustrative code in the plugin -- the model saw a complete session template and executed it.

**Concern:** The orchestrator ran the ENTIRE multi-task session (5 delegations, 10+ minutes of wall time) in a single response with 8 code blocks. This means it wrote all the retry logic before seeing the pass@1 results, and all code blocks executed sequentially within one "iteration." If any delegation had failed in an unexpected way, the model could not have adapted mid-iteration.

### Solvers (children, iter 0)

**Orientation: Fast but multi-block.** Every solver began its first iteration by reading task data from `globalThis` (following the plugin's "Read the Environment First" section). However, all solvers then proceeded to write 8-13 code blocks of exploration in the same response.

Child 0 (task 0934a4d8) wrote 13 blocks in iter 0:
- Block 0: Read task, print grids, check library
- Block 1: Compute diffs and color histograms
- Blocks 2-12: Hypothesis exploration (expanding color detection, flood fill testing, edge analysis, bounding boxes, spatial analysis)

The solver explored productively but violated the "one function per iteration" contract. The errors in iter 0 (`TypeError: Cannot read properties of undefined (reading '0')`) were caused by the 13th code block referencing a variable from a conditional branch in an earlier block that did not execute.

Child 2 (task 136b0064) also wrote 9 blocks in iter 0 but did not hit errors -- its exploration was more linear.

**Pattern:** Solvers oriented in ~1 code block (reading globalThis), then immediately began deep exploration in the same iteration. No solver wasted an iteration purely on understanding its environment.

---

## 7. Prompt Length Concerns

### System prompt sizes

| Agent | Program section | GlobalDocs | Base prompt | Total |
|-------|----------------|------------|-------------|-------|
| Root (orchestrator) | ~14,400 chars | ~2,400 chars | ~2,300 chars | ~19,100 chars |
| Child (solver) | ~14,600 chars | ~2,400 chars | ~2,300 chars | ~19,300 chars |

**These are within reasonable limits.** At ~4.8K tokens each, system prompts are well under the 100K+ context windows available to Claude Opus 4.6. The prompts represent roughly 3-5% of the context window, leaving ample room for multi-turn conversation.

### Unnecessary repetition within system prompt

1. The `<rlm-environment>` section describes `context`, `__ctx.shared.data`, and `__ctx.local` -- none of which are used in this benchmark. All state flows through `globalThis`. This is ~300 chars of irrelevant content.
2. The `<rlm-preamble>` describes delegation patterns, strategies, capabilities, and `&` state schemas in generic terms. The `<rlm-program>` then re-describes all of these constructs in specific terms for the task. The generic descriptions are useful for grounding but add ~400 chars that mostly repeat what the program section covers.
3. The globalDocs repeats submission API, library shape, and task data documentation that already appears in the plugins (see Section 5).

### Redundancy between orchestrator and solver plugins

Both plugins contain significant overlapping content:
- Library schema (full `&Library` type definition)
- Task data access patterns (`globalThis.__arcCurrentTask`, `__arcTasks`)
- Return format expectations
- Verification code (`gridsEqual` function appears in both)

Total inter-plugin redundancy: ~3,000 chars. Since only one plugin is shown to each agent, this is not strictly "redundancy in context" -- but it increases the total authored content that must be maintained consistently.

---

## 8. Specific Improvements

### A. Multi-block execution (Critical)

**Problem:** Agents systematically wrote 3-13 code blocks per response, violating the "one block per response" rule. This caused errors and reduced the model's ability to observe-and-adapt between blocks.

**Current prompt text (in `<rlm-rules>`):**
```
- One ```javascript block per response. Stop and wait for output.
```

**Proposed change:** The engine already has a `maxBlocksPerIteration` parameter. Enforce it at a low value (e.g., 1-2) for this benchmark. Additionally, strengthen the prompt:

```
- CRITICAL: Write exactly ONE ```javascript block per response. After one block, STOP.
  Do NOT write additional code blocks. You will see the output and can write more code
  in the next iteration. Multiple blocks in one response are executed but you cannot
  observe intermediate results or adapt between them.
```

Alternatively, the engine could be modified to only execute the first code block per response and discard the rest, forcing the model to iterate.

### B. Shape enforcement after completion (High)

**Problem:** The orchestrator completed its session in iter 0, then spent iters 1-2 directly solving a task (shape violation) because it had surplus budget and an unsolved task.

**Proposed change:** Add a post-completion invariant to the orchestrator plugin:

```
invariants:
  - AFTER RETURN: Once you have called return(), your job is done. If the harness
    asks you to verify, re-confirm the return value -- do NOT start solving tasks
    directly. Your role is orchestration, not solving.
  - SURPLUS BUDGET: If you finish all passes with iterations remaining, return
    immediately. Do not use surplus iterations to solve tasks yourself.
```

### C. Reduce globalDocs redundancy (Medium)

**Problem:** GlobalDocs duplicates content from both plugins, adding ~2,400 chars to every agent's system prompt without proportional information gain.

**Proposed change:** Make globalDocs minimal -- only document globals that are NOT documented in the plugin that the agent receives:

```markdown
### ARC Compound Sandbox

- `__arcTasks` -- `{ [taskId]: { train: [{ input, output }], test: [{ input }] } }`
- `__arcTaskIds` -- Array of task IDs in dataset order
- `__arcCurrentTask` -- Set by orchestrator before delegation
- `__arcLibrary` -- Shared library (see plugin for schema)
- `__arcSubmit` -- Submission API (see plugin for details)
```

This reduces globalDocs from 2,400 chars to ~400 chars. The plugins already contain the detailed API documentation.

### D. Remove irrelevant sandbox documentation (Low)

**Problem:** `<rlm-environment>` documents `context`, `__ctx.shared.data`, and `__ctx.local` which are unused in this benchmark.

**Proposed change:** The environment section is generic (shared across all benchmarks). Making it benchmark-specific would add engine complexity. Instead, add a note to the orchestrator plugin:

```
Note: This benchmark does NOT use `context` or `__ctx`. All state flows through
globalThis variables documented above.
```

### E. Simplify solver methodology (Medium)

**Problem:** The solver plugin specifies a formal hypothesis lifecycle, named strategies with `done_when` conditions, and capability specifications with `verify` clauses. None of these were followed. The model's own reasoning was equally or more effective.

**Proposed change:** Replace prescriptive methodology with declarative outcomes:

Before (prescriptive):
```
lifecycle:
  propose(claim, evidence)  -> confidence 0.3, status "open"
  update(hypothesis, obs)   -> adjust confidence
  confirm(hypothesis)       -> confidence >= 0.8
  refute(hypothesis)        -> confidence <= 0.1
```

After (declarative):
```
ensures:
  - Each iteration tests exactly one hypothesis with concrete code
  - Hypotheses that fail on training pair 0 are abandoned immediately
  - Hypotheses that pass all pairs proceed to LOO validation
  - No hypothesis is tested more than 3 iterations without progress
```

The hypothesis lifecycle tells the model HOW to think. The ensures clause tells it WHAT outcomes to produce. Per the LANGUAGE.md principle "Goals Over Steps" and "Discover, Don't Prescribe," the latter is more aligned with the project's own tenets.

### F. Orchestrator iteration design (Medium)

**Problem:** The orchestrator ran the entire 3-task session in one iteration with 8 code blocks. This prevented mid-session adaptation (e.g., if the first task's failure had implications for how to approach the second).

**Proposed change:** The orchestrator plugin's "Iteration Management" section already says "aim for 1-2 orchestrator iterations per task." The model ignored this because the illustrative code showed a pattern that could be copy-pasted in bulk.

Restructure the illustrative code to show ONE task per iteration:

```javascript
// EACH ITERATION: Process one task
const session = globalThis.__arcSession;
if (session.currentIndex < globalThis.__arcTaskIds.length) {
  // [delegate + validate + submit + curate for ONE task]
  session.currentIndex++;
  console.log(`Next iteration: task ${session.currentIndex + 1}`);
}
```

And remove the pass@2 and return code from the main loop section. Put them in separate sections labeled "Iteration N+1: Pass@2" and "Final Iteration: Return."

### G. Strengthen return verification behavior (Low)

**Problem:** When the harness intercepted the first-iteration return with "Verify this is correct," the orchestrator interpreted this as license to re-analyze and resolve tasks. The intended behavior is to re-confirm the return value.

**Proposed change:** Add to the orchestrator plugin:

```
ensures:
  - If return() is intercepted: log the results again and re-call return()
    with the same value. Do NOT start new work.
```

### H. Program.md as globalDocs (Architecture)

**Current state:** The `program.md` body (5,048 chars of state schemas, composition, and invariants) serves as `globalDocs` when using `--program arc2-compound`. This means BOTH the orchestrator and solver see the full composition diagram, including each other's roles, state dependencies, and delegation patterns.

**Assessment:** This is potentially valuable -- the solver seeing the composition diagram knows that the orchestrator will curate its taskLog entry, which motivates writing good `approach` and `keyInsight` fields. However, the solver also sees the orchestrator's submission logic, the pass@2 retry strategy, and composition details that are irrelevant to its task.

**Proposed change:** If the program.md is used as globalDocs, trim it to include only:
1. Shared state schemas (`&Library`)
2. Invariants that apply to ALL agents
3. Remove composition flow and per-node descriptions (each agent already has its own plugin for this)

---

## Summary

### What worked well

1. **Orchestrator illustrative code** -- Nearly verbatim execution of the session loop. The procedural pattern was extremely effective for coordination.
2. **Prohibited APIs** -- Respected by all agents. The `prohibited` field in frontmatter + "What You Cannot Do" section in the solver was sufficient.
3. **GlobalThis state flow** -- All agents correctly read from and wrote to shared state. The `&Library` pattern (by-reference via `globalThis`) worked as designed.
4. **TaskLog as interface** -- Solvers wrote structured taskLog entries that the orchestrator consumed for submission decisions and curation. This data contract worked.
5. **Sanity checks** -- The orchestrator's dimension/color/triviality checks caught a bad answer (0934a4d8 retry) and prevented a wasted submission.
6. **Diagnostic retry prompts** -- The pass@2 retry prompt included prior approach and failure info, and task 136b0064 was solved on retry.
7. **Library accumulation** -- Primitives grew from 0 to 9 across the session. Later solvers inherited functions from earlier ones.

### What failed

1. **Multi-block execution** -- Every agent wrote 3-13 code blocks per iteration instead of 1. This is a systemic compliance failure.
2. **Shape violation** -- The orchestrator directly solved a task after completing its orchestration work. Shape declarations were insufficient to prevent this with surplus budget.
3. **Methodology prescriptions ignored** -- Hypothesis lifecycle, strategy names, capability verify checks, and "one function per iteration" were all ignored. The model's own methodology superseded the prescribed one.
4. **First-iteration return interception** -- The orchestrator misinterpreted the return verification prompt as an invitation to do more work rather than confirm the value.

### Score attribution

- **2/3 correct (67%)** -- Strong result for a first-run compound learning system.
- **Task 135a2760** solved on pass@1 (pattern repair via 2D tiling).
- **Task 136b0064** solved on pass@2 retry (block-based path drawing with corrected segment logic).
- **Task 0934a4d8** failed on both passes. The solver found the correct symmetry axis but failed on out-of-bounds edge cases. The orchestrator's direct-solve attempt (iter 1-2) also found the correct axis but hit the same OOB issue.
- The orchestrator's sanity check correctly blocked the retry answer (color 8 appeared in the output, which was not in training outputs), preventing a wasted submission.
