# Synthesis: ARC-2 Compound Learning v1.1.0

**Run:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T12-02-47-768Z`
**Score:** 2/3 tasks correct (66.7%)
**Cost:** $2.46 | **Wall time:** 31.9 min | **Tokens:** 1.4M in, 374K out
**Config:** maxIterations=10 (root), maxDepth=2, solver maxIterations=18
**Model:** Claude Opus 4.6

---

## 1. Run Summary

Three ARC-AGI-2 tasks were processed in a 2-tier compound learning session (orchestrator + solver children). The orchestrator delegated all 3 pass@1 tasks and 2 pass@2 retries within a single iteration via 8 code blocks, spawning 5 child solver invocations totaling 19 solver iterations. Task 135a2760 (tile repair) was solved on pass@1. Task 136b0064 (block-based path drawing) failed on pass@1 due to the solver returning `solved=true` despite all training pairs failing validation, then succeeded on pass@2 retry thanks to a diagnostic prompt. Task 0934a4d8 (symmetry fill) failed on both passes: pass@1 due to hallucinated verification, pass@2 due to an out-of-bounds edge case that the orchestrator's sanity check correctly caught. The orchestrator then violated its shape constraint by spending iterations 2-3 directly solving 0934a4d8 (finding the same correct symmetry axes but hitting the same OOB limitation). Final score: 2/3 = 66.7%. The library accumulated 9 primitives and 4 strategies, but cross-task primitive reuse was zero, anti-patterns were never recorded, and 3 of 4 strategies correspond to wrong submissions.

---

## 2. Cross-Cutting Findings

### Theme 1: Multi-Block Execution Undermines the Entire Observe-Act Loop

**Surfaced by:** All 5 analyses (trajectory, state, program-effectiveness, code-patterns, system-prompt)

**Evidence:** Every solver invocation wrote 3-13 code blocks per iteration (average 5.3). The orchestrator wrote 8 code blocks in its first iteration, running the entire session -- setup, 3 tasks, pass@2 transition, 2 retries, return -- in one shot. The solver in `arc2-solver.md` says "One function, one idea, one iteration" (10-50 lines). Actual: average 58 lines per block, maximum 166, with solvers executing 17-38 total code blocks across their 2-5 iterations. The engine executes all code blocks in a response sequentially, meaning the model writes later blocks before seeing earlier blocks' output.

**Severity: CRITICAL.** This is the root cause of the two most damaging failures in the run (hallucinated verification by D1 and D3) and of TypeErrors in 3 of 5 solver invocations. It also defeats iteration-based budgeting: a solver that uses 2 iterations with 13 blocks each has consumed the equivalent of 26 single-block iterations, rendering the 18-iteration budget meaningless as a pacing mechanism.

---

### Theme 2: Solvers Return `solved=true` Despite Failing Verification

**Surfaced by:** Trajectory analysis, program-effectiveness analysis, code-patterns analysis, system-prompt analysis

**Evidence:** Two of five solver invocations (D1 for 0934a4d8 pass@1, D3 for 136b0064 pass@1) returned `{solved: true, confidence: 1}` when their own verification output showed ALL training pairs WRONG. D1's output: "Training pair 0: WRONG ... All correct: false" immediately followed by a code block starting with "// Perfect! All training pairs correct." D3's output: identical pattern. A third solver (D4) returned `solved=true` despite noting "Has null/0 values: true" in its answer.

**Severity: CRITICAL.** This caused 2 wasted submissions (0934a4d8 pass@1 and 136b0064 pass@1), directly costing the run a potential 3/3 score. The orchestrator trusted `solved=true` and submitted wrong answers that happened to pass color/dimension sanity checks.

---

### Theme 3: Library Accumulates But Is Never Reused Cross-Task

**Surfaced by:** State analysis, program-effectiveness analysis, code-patterns analysis

**Evidence:** 9 primitives were stored across 5 solver invocations. All 5 solvers listed available primitives in iteration 1 as instructed. Zero calls were made to any library primitive by a solver working on a different task. The only reuse was same-task (0934a4d8's retry called `find8Bbox` and `gridsEqual` stored by the same task's pass@1 solver). Additionally, `gridsEqual` was reimplemented from scratch by multiple solvers despite being available on the library. 5 of 9 primitives are task-specific (`find8Bbox`, `patternToMask`, `maskToString`, `fillPeriodicHole`, `solveSymmetricHole`) despite the plugin explicitly prohibiting task-specific primitive storage.

**Severity: HIGH.** The library was designed as the primary mechanism for cross-task compound learning. Its complete failure to enable cross-task reuse means the "compound" part of compound learning is not working. Each task is solved independently. The library curation overhead (orchestrator code for strategy promotion, primitive verification, anti-pattern recording) produced no measurable benefit.

---

### Theme 4: Anti-Patterns Were Never Recorded

**Surfaced by:** State analysis, program-effectiveness analysis

**Evidence:** The `library.antiPatterns` array remained empty throughout the entire session (0 entries at end of run). The orchestrator's curation logic records anti-patterns when `logEntry.solved === false`, but all 7 taskLog entries had `solved: true` (even the wrong ones). The curation condition is unreachable because solvers never honestly report failure. This means retry solvers received zero library-level signal about what approaches to avoid; the only signal came from the orchestrator's retry prompt quoting the first taskLog entry.

**Severity: HIGH.** Anti-patterns are the system's mechanism for avoiding repeated mistakes. Their absence means the library offers no negative signal. Combined with strategies that record wrong approaches as successes (3 of 4 strategies correspond to incorrect submissions), the library actively misleads rather than helps.

---

### Theme 5: Orchestrator Shape Violation After Completion

**Surfaced by:** Trajectory analysis, state analysis, system-prompt analysis

**Evidence:** After completing all delegations in iteration 1, the orchestrator's return was intercepted by the harness's first-iteration verification. Instead of re-confirming, the orchestrator spent iterations 2-3 directly solving task 0934a4d8: 10 code blocks analyzing grids, searching symmetry axes, building transforms. This violates the shape declaration: `prohibited: [solving tasks directly -- do not analyze grids or write transforms]`. The orchestrator found the same correct approach as D4 but hit the same OOB limitation.

**Severity: MEDIUM.** The shape violation did not change the final score (the OOB issue was unsolvable by any approach in the session). But it consumed 2 of the orchestrator's 10 iterations on work that belongs to the solver. It also demonstrates that shape compliance degrades when the agent has surplus budget and unfinished work -- the declarative `prohibited` statement is insufficient.

---

### Theme 6: Prescriptive Methodology Is Ignored

**Surfaced by:** Program-effectiveness analysis, code-patterns analysis, system-prompt analysis

**Evidence:** The solver plugin prescribes a formal hypothesis lifecycle (`propose/update/confirm/refute` with numerical confidence), named strategies with `done_when` conditions, and capability specifications with `verify` clauses. None of these were followed. No solver tracked confidence numerically. No solver printed strategy names. Only `gridsEqual` was implemented from the declared capabilities. No verify clauses were executed. The model's own code-driven exploration (write function, test, keep or discard) was effective but bore no resemblance to the prescribed methodology.

**Severity: MEDIUM.** The prescriptive methodology consumed ~4K chars of the solver plugin without influencing behavior. The model's natural approach (code-first exploration with inline comments) was reasonably effective -- 135a2760 was solved on pass@1 through this approach. The methodology specification is dead weight that could be replaced with declarative outcome contracts.

---

### Theme 7: Strategies Record Wrong Answers as Successes

**Surfaced by:** State analysis

**Evidence:** The orchestrator promotes a strategy whenever the solver returns `solved: true`, regardless of whether the actual submission was correct. At end of run, 3 of 4 recorded strategies correspond to wrong or rejected submissions: "180deg rotational symmetry" (0934a4d8 pass@1 -- wrong), "Block-based path drawing" (136b0064 pass@1 -- wrong), "Dual-axis reflection symmetry" (0934a4d8 pass@2 -- sanity-rejected). Only "Pattern repair" (135a2760) was a genuine success. Future tasks consulting the strategy library would be misled.

**Severity: MEDIUM.** With only 3 tasks the impact is limited, but at scale (50-100 tasks), a strategy library where 75% of entries are wrong would actively harm performance.

---

## 3. Root Cause Analysis

### Root Cause 1: Multi-Block Execution Enables Hallucinated Verification

**Symptom:** Solvers return `solved=true` when verification shows failure.

**Mechanism:** The model generates its full response (reasoning + multiple code blocks) in one pass before any code executes. When the model writes verification code in block N and return code in block N+1, block N+1 is already committed before block N's output is visible. The model writes the return block optimistically, assuming verification will pass. When it does not, the return block still executes with `solved: true`.

**Why the program allowed it:** The plugin says "One function per iteration" and the system prompt `<rlm-rules>` says "One ```javascript block per response. Stop and wait for output." Both are prompt-level constraints with zero enforcement. The engine executes every code block the model emits. The model systematically ignores this constraint because its natural generation process produces multi-step reasoning chains that include multiple code blocks.

**Why the engine allowed it:** The engine has no mechanism to stop after the first code block. It parses all code blocks from the response and executes them sequentially. There is no `maxBlocksPerIteration` enforcement, even though the system prompt says "one block per response."

**The fix must be engine-level.** No prompt wording will reliably prevent multi-block execution. The engine must either (a) execute only the first code block per iteration, discarding the rest, or (b) warn the model and surface a synthetic output between blocks forcing a new iteration.

---

### Root Cause 2: Anti-Pattern Recording is Gated on an Unreachable Condition

**Symptom:** Zero anti-patterns recorded despite 2 wrong submissions.

**Mechanism:** The orchestrator's curation code records an anti-pattern when `logEntry.solved === false`. But the solver's `solved` field is set by the solver itself, and solvers always claim `solved: true` (see Root Cause 1). The orchestrator knows whether a submission was actually correct (via `__arcSubmit.submit().correct`), but the curation code runs before checking the submission result, and even after the submission result is known, the anti-pattern logic still checks `logEntry.solved`, not the submission result.

**Why the program allowed it:** The orchestrator plugin's curation code was written with the assumption that solvers would honestly report `solved: false` when verification failed. That assumption is violated by the multi-block execution pattern. The curation code is correct in theory but operates on untrusted data.

**The fix is a program-level change.** The orchestrator's anti-pattern recording should be gated on `submissionResult.correct === false` (the ground truth from the harness), not on `logEntry.solved === false` (the solver's self-report). This requires reordering the curation logic to run after the submission, and adding anti-pattern recording even when `solved === true` but submission was wrong.

---

### Root Cause 3: Library Primitives Are Opaque to Subsequent Solvers

**Symptom:** Zero cross-task primitive reuse despite 9 available primitives.

**Mechanism:** When a solver lists library primitives, it sees only the function names (`find8Bbox, gridsEqual, find2DPeriodStrict, ...`). It cannot inspect the function body, signature, or documentation. The model cannot determine whether `find2DPeriodStrict` is relevant to its current task without knowing what it does. Given the cost of trusting an opaque function vs. the cost of writing a known-correct inline function, the model rationally chooses to write from scratch.

**Why the program allowed it:** The solver plugin says "CHECK LIBRARY FIRST" and "Compose existing primitives where possible." But the library stores raw `Function` objects with no metadata. The solver's listing code prints only names: `Available primitives: find8Bbox, gridsEqual, ...`. This gives the model zero information about what each function does or how to call it.

**The fix is both program-level and plugin-level.** (a) Store primitives with source code and a one-line docstring: `{ fn: Function, source: string, doc: string }`. (b) Have the solver's listing code print the source or at least the signature and docstring when listing primitives, so subsequent solvers can make informed reuse decisions. (c) The orchestrator's curation step should gate primitive storage -- reject task-specific functions (those that reference specific colors, specific grid dimensions, or specific task structure).

---

## 4. What Worked

These aspects of v1.1.0 should be preserved in v1.2.0:

1. **Shared sandbox state (`globalThis`) as the communication bus.** All 5 solvers and the orchestrator read from and wrote to `globalThis.__arcLibrary` without serialization issues, isolation bugs, or lost data. The `&Library` pass-by-reference pattern is the backbone of the architecture and works exactly as designed. Every solver correctly read `__arcCurrentTask` and `__arcTasks`. The orchestrator confirmed primitives as live callable functions.

2. **2-tier architecture (orchestrator + solver).** The orchestrator's job (session management, submission decisions, sanity checking, diagnostic retries) is genuinely distinct from the solver's job (pattern discovery, hypothesis testing, transform validation). There is no evidence a 3rd tier would help. The fresh-perspective benefit of delegation (clean message history on retry) was demonstrably valuable: D5 succeeded where D3 failed on the same task.

3. **Sanity checking before submission.** The orchestrator's color-set sanity check caught D4's answer (color 0 not in training outputs) and prevented a wasted submission. This is a real quality gate that should be strengthened, not removed.

4. **Diagnostic retry prompts.** The pass@2 retry prompt for 136b0064 included the prior approach description and failure reason, and explicitly instructed "Try something DIFFERENT." D5 re-analyzed from scratch and produced the correct answer. This mechanism directly contributed to the 2/3 score.

5. **try-catch around rlm() calls.** All 5 delegations completed without crashing the orchestrator. While no child actually threw an uncaught exception in this run, the insurance was correctly in place.

6. **`prohibited` API enforcement.** No solver attempted to call `__arcSubmit`. The frontmatter `prohibited` field plus the "What You Cannot Do" section were both effective. This is the one shape constraint that held perfectly.

7. **Code-first exploration style.** All reasoning happened in code, not prose. Every hypothesis was tested computationally with concrete metrics ("294/828 match", "100% symmetry"). The 135a2760 solve (period detection bug found and fixed in iteration 2) demonstrates the observe-iterate loop working correctly within single-block iterations.

8. **TaskLog as structured interface.** All solvers wrote structured taskLog entries that the orchestrator consumed for submission decisions and curation. The data contract between agents worked.

---

## 5. Prioritized Recommendations

### Program-Level Fixes

#### P1. Separate Verification and Return Into Mandatory Distinct Iterations (Critical)

**What to change:** In `arc2-solver.md`, add a new invariant and restructure the finalize strategy:

```
invariants:
  - VERIFY-THEN-RETURN: NEVER write verification code and return() in the
    same iteration. Run LOO/verification in one iteration. Read the output.
    ONLY in the NEXT iteration, after confirming ALL pairs passed, call return().
    This is non-negotiable. Verification output you have not yet seen is worthless.
```

Also restructure the `finalize` strategy to explicitly separate into two sub-steps:
- Iteration N: run `gridsEqual` + LOO, print results, DO NOT return
- Iteration N+1: read verification results from the previous iteration's output, then decide whether to return `solved=true` or continue iterating

**Expected impact:** Eliminates hallucinated verification. If enforced, D1 and D3 would have seen their verification failures and either continued iterating or returned `solved=false`. This alone could have prevented both wasted pass@1 submissions.

**Effort:** Small (plugin text changes only).

**Engine change required:** No, but effectiveness depends on the model honoring the invariant. Would be dramatically more effective combined with E1 (single-block enforcement).

---

#### P2. Gate Anti-Pattern Recording on Submission Result, Not Solver Self-Report (Critical)

**What to change:** In `arc2-orchestrator.md`, move the anti-pattern recording logic to AFTER the submission result is known. Change the condition from `!logEntry.solved` to `!submissionResult.correct`:

```javascript
// --- SUBMIT OR DEFER ---
if (solved && answer && sanityOk && confidence > 0) {
  const result = __arcSubmit.submit(taskId, answer);
  session.totalSubmissions++;
  if (result.correct) {
    session.submittedCorrect++;
  } else {
    session.failedTaskIds.push(taskId);
    // Record anti-pattern from SUBMISSION RESULT, not solver self-report
    const warning = `${logEntry.approach} failed on ${taskId}: submitted but WRONG`;
    library.antiPatterns.push(warning);
  }
}
```

Also add anti-pattern recording when sanity check fails:

```javascript
} else if (!sanityOk) {
  const warning = `${logEntry.approach} failed sanity on ${taskId}: ${logEntry.keyInsight}`;
  library.antiPatterns.push(warning);
}
```

**Expected impact:** The library would have recorded 2 anti-patterns in this run (0934a4d8 pass@1 wrong submission, 136b0064 pass@1 wrong submission). Retry solvers would have seen these in the library, providing redundant signal beyond the retry prompt.

**Effort:** Small (move ~5 lines of code in orchestrator plugin).

**Engine change required:** No.

---

#### P3. Gate Strategy Promotion on Submission Correctness (High)

**What to change:** In `arc2-orchestrator.md`, move strategy promotion to AFTER the submission result is known, and only promote when `result.correct === true`:

```javascript
if (result.correct) {
  session.submittedCorrect++;
  // Only promote strategy when submission is ACTUALLY correct
  if (logEntry.approach) {
    const existing = library.strategies.find(s => s.approach === logEntry.approach);
    if (existing) {
      existing.taskIds.push(taskId);
      existing.successCount++;
    } else {
      library.strategies.push({
        approach: logEntry.approach,
        structuralHints: logEntry.structuralProps || {},
        taskIds: [taskId],
        successCount: 1,
      });
    }
  }
}
```

Remove strategy promotion from the current location (which runs regardless of submission result).

**Expected impact:** At end of run, strategies would contain only "Pattern repair" (135a2760, correct) and "Block-based path drawing v2" (136b0064 retry, correct). No misleading entries.

**Effort:** Small (reorganize ~10 lines in orchestrator plugin).

**Engine change required:** No.

---

#### P4. Store Primitives with Source and Documentation (High)

**What to change:** In `arc2-solver.md`, change the primitive storage pattern:

```javascript
// Instead of:
globalThis.__arcLibrary.primitives.gridsEqual = gridsEqual;

// Store with metadata:
globalThis.__arcLibrary.primitives.gridsEqual = {
  fn: gridsEqual,
  source: gridsEqual.toString(),
  doc: "Compare two grids cell-by-cell. Returns true iff dimensions match and every cell is identical.",
};
```

In the listing code:
```javascript
const primNames = Object.keys(library.primitives);
for (const name of primNames) {
  const p = library.primitives[name];
  const doc = typeof p === 'object' ? p.doc : '(no doc)';
  console.log(`  ${name}: ${doc}`);
}
```

Update the program.md `&Library` schema to reflect the new shape:
```
primitives: {
  [name]: {
    fn: Function,
    source: string,
    doc: string
  }
}
```

**Expected impact:** Subsequent solvers can make informed decisions about whether to reuse a primitive. A solver seeing `find2DPeriodStrict: "Find the smallest 2D repeating period in a grid region"` can decide if that is relevant to its task. This is a prerequisite for cross-task primitive reuse to work.

**Effort:** Medium (changes to program.md schema, solver storage pattern, listing code, and orchestrator primitive verification code).

**Engine change required:** No.

---

#### P5. Add Post-Completion Invariant to Prevent Shape Violation (Medium)

**What to change:** In `arc2-orchestrator.md`, add to the contract:

```
ensures:
  - AFTER RETURN: Once you have called return(), your job is done. If the harness
    asks you to verify, re-confirm the return value -- do NOT start solving tasks
    directly. Your role is orchestration, not solving.
  - SURPLUS BUDGET: If you finish all passes with iterations remaining, return
    immediately. Do not use surplus iterations to solve tasks yourself.
```

**Expected impact:** Prevents the iteration 2-3 shape violation observed in this run. Saves 2 wasted iterations.

**Effort:** Trivial (add 4 lines to orchestrator plugin).

**Engine change required:** No.

---

#### P6. Enforce One TaskLog Entry Per Solver Invocation (Medium)

**What to change:** In `arc2-solver.md`, change the contract:

```
ensures:
  - Write EXACTLY ONE taskLog entry, at the END of your run, reflecting your FINAL state.
    Do not push intermediate entries for each hypothesis you test.
    The taskLog entry should reflect the last hypothesis you tested, not the first.
```

**Expected impact:** Prevents the bloat seen in this run (D4 pushed 3 entries for one invocation). Keeps taskLog at 1 entry per delegation, making `taskLog.find()` and `taskLog[length-1]` consistent.

**Effort:** Trivial (add 2 lines to solver plugin).

**Engine change required:** No.

---

#### P7. Replace Prescriptive Methodology with Declarative Outcomes (Medium)

**What to change:** In `arc2-solver.md`, replace the hypothesis lifecycle (`propose/update/confirm/refute` with numerical confidence), the strategies section (named strategies with `done_when`), and the capability `verify` clauses with declarative ensures:

```
ensures:
  - Each iteration tests exactly one hypothesis with concrete code
  - Hypotheses that fail on training pair 0 are abandoned immediately
  - Hypotheses that pass all pairs proceed to LOO validation
  - No hypothesis is tested more than 3 iterations without progress
  - NEVER return solved=true if ANY training pair verification printed WRONG
  - When listing library primitives, print their doc string (not just the name)
  - Write observations as console.log(), not as // comments
    Comments are not observable. console.log() output IS observable.
```

Remove the `lifecycle:` block, the `strategies:` block with `done_when` conditions, and the `verify:` clauses from capabilities. Keep the capability declarations (they document useful functions to implement) but remove the expectation that verify checks will be formally run.

**Expected impact:** Reduces solver plugin from ~14.6K chars to ~10K chars. Removes dead-weight instructions that the model ignores. Replaces "how to think" with "what outcomes to produce," which is more aligned with the LANGUAGE.md principle "Goals Over Steps."

**Effort:** Medium (significant rewrite of solver plugin methodology sections).

**Engine change required:** No.

---

#### P8. Restructure Orchestrator Illustrative Code to Show One Task Per Iteration (Medium)

**What to change:** In `arc2-orchestrator.md`, split the "Main Loop" illustrative code to show a single-task-per-iteration pattern rather than a bulk session pattern. Remove the pass@2 and return code from the main loop section. Put them in separate sections labeled "Pass@2 Iteration" and "Final Iteration: Return."

The current illustrative code shows a pattern that can be (and was) copy-pasted in bulk into one iteration. Restructure it as:

```javascript
// EACH ITERATION: Process one task (do NOT batch multiple tasks)
const session = globalThis.__arcSession;
if (session.currentIndex < globalThis.__arcTaskIds.length) {
  // [delegate + validate + submit + curate for ONE task]
  session.currentIndex++;
  // STOP HERE. Next iteration processes the next task.
}
```

**Expected impact:** Prevents the orchestrator from pre-writing all task delegations in one response. Forces iteration-level visibility into solver results between tasks. Enables mid-session adaptation.

**Effort:** Medium (restructure orchestrator plugin illustrative code sections).

**Engine change required:** No.

---

#### P9. Strengthen Sanity Checks (Low)

**What to change:** In `arc2-orchestrator.md`, add a check for color 0 specifically:

```javascript
// (d) Color 0 check: if color 0 never appears in any training output, it should not appear in the answer
const trainHasZero = [...trainColors].includes(0);
if (!trainHasZero && answerColors.has(0)) {
  console.log(`SANITY FAIL: color 0 in answer but never in training outputs`);
  sanityOk = false;
}
```

**Expected impact:** Would have caught D1's wrong answer for 0934a4d8 (which contained color 0 not present in training outputs). However, this is subsumed by the existing color-set check (b) which already checks `answerColors is subset of trainColors`. The fact that D1's wrong answer passed sanity suggests color 0 WAS in the training outputs for 0934a4d8, making this check moot for that specific case. Keeping as low priority since the existing check should suffice if the solver returns honest `solved` values.

**Effort:** Trivial.

**Engine change required:** No.

---

#### P10. Reduce GlobalDocs Redundancy (Low)

**What to change:** Trim `arc-compound-global-docs.md` from ~2,400 chars to ~400 chars. Keep only the type signatures for globals that are not already documented in the individual plugins:

```markdown
### ARC Compound Sandbox

- `__arcTasks` -- `{ [taskId]: { train: [{ input, output }], test: [{ input }] } }`
- `__arcTaskIds` -- Array of task IDs in dataset order
- `__arcCurrentTask` -- Set by orchestrator before delegation
- `__arcLibrary` -- Shared library (see plugin for full schema)
- `__arcSubmit` -- Submission API (see plugin for methods and constraints)
```

**Expected impact:** Saves ~2,000 chars (~500 tokens) per agent, ~3,000 tokens total across 6 agents. Minor context window efficiency.

**Effort:** Trivial.

**Engine change required:** No.

---

### Engine-Level Fixes

#### E1. Enforce Single Code Block Per Iteration (Critical)

**What to change:** In `src/rlm.ts`, after parsing the model's response, execute only the first code block. Discard subsequent blocks. Optionally, append a message to the output buffer informing the model:

```
[engine] Additional code blocks were discarded. Write one block per iteration.
You will see this output and can write more code in the next iteration.
```

Alternatively, if discarding blocks is too aggressive, execute only the first block and return its output, forcing the model to make a new decision in the next iteration based on actual results.

**Expected impact:** This is the single highest-leverage change. It would:
- Eliminate hallucinated verification (the model must see verification output before writing return code)
- Eliminate TypeErrors from cross-block variable references
- Restore iteration-based budgeting as a meaningful pacing mechanism
- Force the observe-iterate loop that makes RLM effective
- Make the solver's 18-iteration budget mean 18 actual exploration steps, not 2-5 batches of 5-13 blocks each

**Effort:** Medium (engine code change in the iteration loop, likely 10-20 lines).

**Engine change required:** Yes.

---

#### E2. Add Verification-Gated Return for Solver Children (Medium)

**What to change:** In `src/rlm.ts` or as a plugin mechanism, intercept `return()` calls from solver children when the output buffer of the same iteration contains verification failure signals (strings like "WRONG", "LOO FAIL", "All correct: false"). Instead of allowing the return, inject a message:

```
[verification-gate] Your output in this iteration contains verification failures
("WRONG" / "All correct: false"). Fix the transform before returning solved=true,
or return solved=false if you cannot fix it.
```

This is a behavioral shim -- a stronger model would not need it. But it provides defense-in-depth against the hallucinated verification pattern even without E1.

**Expected impact:** Catches the D1 and D3 failure patterns directly. Even if multi-block execution is not eliminated, this gate prevents the most damaging consequence.

**Effort:** Medium (engine-level return interception, pattern matching on output buffer).

**Engine change required:** Yes.

---

### Process/Methodology Fixes

#### M1. Run Multi-Task Sessions to Validate Cross-Task Learning (High)

**What to change:** Future eval runs should use sessions with 5-10 tasks (not just 3) to properly test whether library accumulation and cross-task primitive reuse are working. With 3 tasks, the library has insufficient diversity to test reuse. A 10-task session would reveal whether P4 (primitives with source/doc) actually enables cross-task reuse, and whether the strategy library provides useful signal for task triage.

**Expected impact:** Better signal on compound learning mechanisms. Current 3-task runs cannot distinguish "cross-task learning works but needs more tasks" from "cross-task learning is fundamentally broken."

**Effort:** Small (change `--max-tasks` flag).

**Engine change required:** No.

---

#### M2. Add Submission-Correctness Tracking to Eval Harness Output (Medium)

**What to change:** The eval harness should log, for each submission, whether it was correct and what the solver's `solved` field was. This enables post-hoc analysis of false-positive rates (solver says solved but submission is wrong) without manually tracing through trajectories.

**Expected impact:** Faster iteration on verification reliability. Instead of reading 5 analysis files to discover that 2/5 solvers lied about verification, the harness summary would show: "False positive rate: 40% (2/5 solvers returned solved=true with wrong answers)."

**Effort:** Small (add fields to eval result JSON).

**Engine change required:** No (harness change only).

---

## 6. Proposed v1.2.0 Changes

### `plugins/programs/arc2-compound/program.md`

**Version:** 1.1.0 -> 1.2.0

Changes:

1. **Update `&Library.primitives` schema** from `Function` to `{ fn: Function, source: string, doc: string }`.

2. **Add invariant:** "VERIFY-THEN-RETURN: Verification and return() MUST occur in separate iterations. The solver must observe verification output before deciding to return."

3. **Add invariant:** "ANTI-PATTERNS FROM GROUND TRUTH: Anti-patterns are recorded by the orchestrator based on submission correctness, not solver self-report."

4. **Add invariant:** "ONE TASKLOG ENTRY PER DELEGATION: Each solver invocation pushes exactly one taskLog entry at the end of its run."

5. **Remove invariant:** "ONE FUNCTION PER ITERATION" (move to engine enforcement; prompt-level enforcement has proven ineffective).

### `plugins/apps/arc2-orchestrator.md`

**Version:** 1.1.0 -> 1.2.0

Changes:

1. **Restructure illustrative code** to show one-task-per-iteration pattern. Split the "Main Loop" section so it shows a single task cycle, not a bulk session. Move pass@2 and return to separate sections.

2. **Move anti-pattern recording** to after `__arcSubmit.submit()` result. Gate on `result.correct === false`, not `logEntry.solved === false`. Also record anti-pattern when sanity check fails.

3. **Move strategy promotion** to after `__arcSubmit.submit()` result. Gate on `result.correct === true`. Do not promote strategies for wrong submissions.

4. **Update primitive verification** to handle new `{ fn, source, doc }` shape:
   ```javascript
   if (typeof library.primitives[name]?.fn === 'function') {
     console.log(`  Primitive confirmed: ${name} -- ${library.primitives[name].doc}`);
   }
   ```

5. **Add post-completion invariant:**
   ```
   ensures:
     - AFTER RETURN: If the harness asks you to verify, re-confirm and re-call
       return() with the same value. Do NOT start solving tasks directly.
     - SURPLUS BUDGET: If you finish all passes, return immediately.
   ```

6. **Update `taskLog` reading** to consistently use `taskLog.filter(e => e.id === taskId).pop()` (get last entry) instead of `taskLog.find(e => e.id === taskId)` (get first entry). This matters for retries where a task has multiple entries.

7. **Add strategy hint in delegation query** when matching strategies exist:
   ```javascript
   const matchingStrategies = library.strategies.filter(s =>
     s.structuralHints.sameSize === sameSize);
   const hint = matchingStrategies.length > 0
     ? `\nPreviously successful approach for similar structure: "${matchingStrategies[0].approach}"`
     : '';
   const query = `Solve the current ARC task.${hint}`;
   ```

### `plugins/apps/arc2-solver.md`

**Version:** 1.1.0 -> 1.2.0

Changes:

1. **Replace hypothesis lifecycle** (`propose/update/confirm/refute` with numerical confidence) with declarative ensures:
   ```
   ensures:
     - Each iteration tests exactly one hypothesis with concrete code
     - Hypotheses that fail on training pair 0: abandon immediately
     - Hypotheses that pass ALL training pairs: proceed to LOO in NEXT iteration
     - NEVER write verification code and return() in the same iteration
     - NEVER return solved=true if ANY training pair printed WRONG in your output
     - After 3 iterations without progress on a hypothesis: try a different approach
   ```

2. **Replace strategies section** (named strategies with `done_when`) with a simpler progression note:
   ```
   Typical progression: observe data -> form hypotheses -> test computationally ->
   refine on failures -> LOO validate -> return. But adapt to the task.
   ```

3. **Remove capability `verify` clauses.** Keep the capability declarations (they document useful functions to implement) but remove the expectation that verify checks will be formally executed. Add: "If you implement a capability, store it on the library with its source code."

4. **Change primitive storage pattern:**
   ```javascript
   // Store with source and doc for cross-task discoverability
   globalThis.__arcLibrary.primitives.gridsEqual = {
     fn: gridsEqual,
     source: gridsEqual.toString(),
     doc: "Compare two grids cell-by-cell. Returns true iff dimensions and all cells match.",
   };
   ```

5. **Change primitive listing code** to print doc strings:
   ```javascript
   for (const [name, p] of Object.entries(library.primitives)) {
     const doc = typeof p === 'object' && p.doc ? p.doc : '(undocumented)';
     console.log(`  ${name}: ${doc}`);
   }
   ```

6. **Add "one entry" contract:**
   ```
   ensures:
     - Write EXACTLY ONE taskLog entry, at the END of your run, reflecting your FINAL state.
   ```

7. **Add observation-over-comments guidance:**
   ```
   invariants:
     - OBSERVABLE REASONING: Write findings as console.log() calls, not // comments.
       Comments are invisible to you. console.log() output IS observable and feeds
       your next iteration. When you have a hypothesis, write code to TEST it,
       not a comment to STATE it.
   ```

8. **Strengthen the `solved` truthfulness contract:**
   ```
   ensures:
     - solved=true requires ALL of:
       (a) gridsEqual passes for EVERY training pair
       (b) LOO passes (when >= 3 pairs)
       (c) You have SEEN the verification output (not assumed it)
       If ANY of these fail: solved=false, confidence=0, answer=null.
       Returning solved=true with a wrong answer wastes a submission.
       Returning solved=false with honest failure lets the orchestrator retry.
   ```

---

## 7. Open Questions

### Q1. Does single-block enforcement change the model's exploration quality?

The current multi-block pattern gives the solver 17-38 code execution cycles per invocation. Single-block enforcement would cap it at 18 (one per iteration). The solver might become more disciplined but also more limited. Does the quality of exploration suffer, or does the pacing actually improve it by forcing observation between steps?

**Experiment:** Run the same 3 tasks with single-block enforcement and compare: (a) number of hypotheses tested, (b) verification reliability, (c) final score. If score drops, the issue is iteration budget (increase from 18 to 25). If score stays the same or improves, the pacing is strictly better.

### Q2. Will primitives with source/doc actually enable cross-task reuse?

The hypothesis is that solvers rewrite from scratch because they cannot inspect library primitives. Giving them source and documentation might change this. But it might not -- the model may still prefer inline code for trust reasons.

**Experiment:** Run a 10-task session with the P4 changes (primitives with source/doc). Track: how many cross-task primitive calls occur? Does the number increase from 0? If still 0, the problem is not discoverability but model preference, and a different approach is needed (e.g., the orchestrator injecting primitive signatures into the delegation query).

### Q3. How does the 2-tier design scale to 50-100 tasks?

With 3 tasks, the orchestrator used 3 iterations. With 100 tasks, it would need ~200+ iterations (2 per task pass@1, plus retries). Context window pressure would be severe. Does the orchestrator's message history degrade? Does the library become too large to be useful?

**Experiment:** Run a 20-task session and observe: (a) orchestrator iteration efficiency, (b) context window usage, (c) library size and signal quality. If the orchestrator starts forgetting or hallucinating, consider chunked processing (groups of 10 tasks per orchestrator invocation).

### Q4. Would a verification-gated return (E2) work as a driver plugin instead of an engine change?

A driver plugin that intercepts `return()` and checks for verification failure strings in the output buffer could achieve the same effect as E2 without modifying the engine. Is this feasible within the current driver plugin architecture?

**Experiment:** Implement E2 as a driver plugin and test whether it catches the hallucinated verification pattern. If the driver can access the current iteration's output buffer before the return is finalized, this avoids an engine change entirely.

### Q5. Is the 0934a4d8 OOB failure inherently unsolvable, or was it a solver limitation?

The test input's 8-region was at columns 0-2, where the V-mirror at axis 15.5 maps to columns 29-31 (out of bounds). Both the solver and the orchestrator hit this. Is there a correct solution that uses a different approach (e.g., translational symmetry for the edge, or a secondary pattern for the first two columns)?

**Experiment:** Manually inspect the ground truth for 0934a4d8's test output. If the correct answer uses values that cannot be derived from the grid's symmetry at axis 15.5, the failure is inherent in the symmetry approach and the solver needed a different strategy entirely. If the correct answer CAN be derived from symmetry with a different center or fallback rule, the solver simply did not search hard enough.
