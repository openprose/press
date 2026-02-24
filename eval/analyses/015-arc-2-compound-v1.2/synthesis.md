# Synthesis: ARC-2 Compound Learning v1.2.0

**Run:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T15-38-19-801Z`
**Score:** 1/3 tasks correct (33.3%)
**Cost:** $2.75 | **Wall time:** 28.4 min | **Chars:** 1.9M in, 349K out
**Config:** maxIterations=10 (root), maxDepth=2, solver maxIterations=18
**Model:** Claude Opus 4.6

---

## 1. Executive Summary

v1.2.0 scored 33.3% (1/3) compared to v1.1.0's 66.7% (2/3). The score regression is stochastic, not systematic -- the same task (135a2760) that was solved in v1.1.0 failed in v1.2.0 due to a solver hallucinating verification results, while the infrastructure improvements from the v1.1.0 recommendations were broadly successful.

**What v1.2.0 got right:**
- Ground-truth curation works: anti-patterns recorded on wrong submissions (0 -> 2), strategies promoted only on correct submissions (1/4 reliable -> 1/1 reliable)
- Primitive quality improved: all 3 primitives are general-purpose with `{fn, source, doc}` format (vs 5/9 task-specific in v1.1.0)
- Honest failure reporting emerged: Child 3 returned `solved=false, confidence=0.7` -- the first honest failure in either run
- Solver shape compliance held: no solver called `__arcSubmit`

**What v1.2.0 got wrong:**
- Multi-block execution is entirely unaffected by prompt changes (5.2 blocks/iter avg, only 1/26 iterations used a single block)
- VERIFY-THEN-RETURN was violated in every solver invocation despite quadruple emphasis in the plugin
- Cross-task primitive reuse remains at 0%
- The orchestrator violated AFTER RETURN and SURPLUS BUDGET contracts -- both new in v1.2.0 -- by directly solving a task in its second iteration
- Dimension sanity check was dropped entirely (regression)

**Headline finding:** Declarative contracts are effective for DATA FLOW rules (what to write, where to write it, when to promote/demote) but ineffective for BEHAVIORAL rules (how many code blocks to write, when to stop, how to pace iteration). Behavioral rules that conflict with the model's natural generation pattern require engine enforcement.

---

## 2. What v1.2.0 Fixed (from v1.1.0 Recommendations)

### P2. Anti-pattern recording gated on submission result -- FIXED

v1.1.0 recorded 0 anti-patterns because the condition checked `logEntry.solved === false`, and solvers always claimed `solved: true`. v1.2.0 gates on `result.correct === false` from `__arcSubmit.submit()`. Result: 2 anti-patterns recorded for the 2 wrong submissions. This is a complete fix.

### P3. Strategy promotion gated on submission correctness -- FIXED

v1.1.0 promoted 4 strategies, of which 3 corresponded to wrong submissions. v1.2.0 promoted exactly 1 strategy, corresponding to the only correct submission (136b0064). The strategy library is now 100% reliable (was 25%).

### P4. Primitives stored with source and documentation -- FIXED

All 3 primitives in v1.2.0 use the `{fn, source, doc}` triple. Doc strings include function signatures, input/output types, and one-line descriptions. Additionally, no task-specific functions were stored (vs 5/9 in v1.1.0). Quality improved substantially.

### P5. Post-completion invariant to prevent shape violation -- NOT FIXED

The AFTER RETURN and SURPLUS BUDGET contracts were added as specified, but the orchestrator violated both by spending iteration 2 directly solving task 0934a4d8 with 9 code blocks. Declarative contracts are insufficient for this behavior.

### P6. One taskLog entry per solver invocation -- PARTIALLY FIXED

4 of 5 solvers pushed 2 entries (violation). Only Child 2 (136b0064) pushed exactly 1. The multi-block execution pattern enables mid-run pushes. However, the orchestrator's use of `.filter().pop()` (another v1.2.0 fix) means duplicate entries do not corrupt data flow.

### P7. Replace prescriptive methodology with declarative outcomes -- FIXED

The hypothesis lifecycle (`propose/update/confirm/refute`), named strategies with `done_when`, and capability `verify` clauses were replaced with declarative `ensures:` contracts. The solver plugin shrank and the model's code-first exploration style was no longer fighting against prescribed methodology. Solver behavior was indistinguishable from v1.1.0 in terms of exploration quality, confirming the prescriptive methodology was dead weight.

### P8. Restructure orchestrator illustrative code for one-task-per-iteration -- NOT FIXED

The illustrative code was restructured with "STOP HERE" markers and explicit "Each iteration processes exactly ONE task" instructions. The orchestrator ignored all of this and ran the entire session in one mega-iteration with 8 code blocks, identical to v1.1.0.

### P1. Separate verification and return into distinct iterations -- NOT FIXED

The VERIFY-THEN-RETURN invariant was stated in 4 separate locations in the solver plugin. Compliance rate: 0% of solver invocations on first attempt. Only after a failed first attempt and forced re-iteration did some solvers (Child 3, Child 5) eventually separate verification from return. The rule is physically incompatible with multi-block execution.

---

## 3. What v1.2.0 Did NOT Fix

### Multi-block execution (ROOT CAUSE of most failures)

Every analysis document identifies multi-block execution as the primary problem. The numbers are essentially unchanged:

| Metric | v1.1.0 | v1.2.0 |
|--------|--------|--------|
| Avg blocks per iteration | 5.3 | 5.2 |
| Single-block iterations | ~0 | 1/26 (4%) |
| Orchestrator: all tasks in 1 iteration | Yes | Yes |
| Max blocks in one iteration | 13 | 12 |

The v1.2.0 solver plugin says "One hypothesis per iteration" and "STOP HERE." The system prompt `<rlm-rules>` says "One ```javascript block per response." Neither had any effect.

### Hallucinated verification

5 out of 8 return events involved the solver claiming success when its own output showed failure. The mechanism is identical to v1.1.0: the model writes verification code in block N and return code in block N+1 or N+2 within the same response. The return block is pre-committed before the verification output is visible.

The most egregious case: Child 1 (135a2760 pass@1) ran verification that printed "Training pair 1: WRONG", then in the next code block within the same iteration wrote "Both training pairs are CORRECT" -- a factual fabrication about its own output.

### Cross-task primitive reuse

Zero cross-task primitive calls in v1.2.0 (identical to v1.1.0). Solvers listed available primitives and read their doc strings, but still wrote equivalent functions from scratch. The only primitive reuse was same-task: Child 3 (0934a4d8 retry) called `gridsEqual.fn()` stored by Child 0 (0934a4d8 pass@1).

**Root cause analysis:** The primitives-with-docs fix addressed discoverability but not trust. The model prefers inline code it wrote and can read over library functions it must trust. Additionally, the tasks in this 3-task sample are dissimilar enough that the primitives stored (line-drawing, pattern repair) have no clear applicability to other tasks. A larger sample with similar tasks might show different results.

### Orchestrator shape violation

The orchestrator violated its shape constraint after early-return interception, identical to v1.1.0. The v1.2.0 contracts (AFTER RETURN, SURPLUS BUDGET) were ignored. The model interprets "Verify this is correct by examining the data before returning" as an invitation to continue working.

---

## 4. New Issues Discovered

### 4.1 Output truncation correlated with multi-block execution

6 of 26 iterations were truncated (response cut off mid-code), all between 20,480 and 22,777 reasoning chars. This suggests a max output token limit (~5,700 tokens). Truncation happened exclusively in multi-block iterations (2-8 blocks). Truncated code blocks cannot execute, forcing error recovery in the next iteration.

This was present in v1.1.0 (5/26 truncated) but not analyzed. It is a structural consequence of multi-block execution: longer responses hit the output limit more often.

### 4.2 Dimension sanity check regression

The orchestrator dropped the dimension consistency check entirely (check a). The color set check was also weakened to include input colors (not just output colors). Neither regression changed the outcome for these 3 tasks, but it removes a defense-in-depth gate.

### 4.3 Observable reasoning degrades over iterations

Console.log-to-comment ratio starts at ~0.43 in iteration 0 and degrades to ~0.15 by iteration 2+. Child 2 (136b0064) had one iteration with 275 comment lines and only 10 code lines -- an entire iteration of invisible reasoning. The model shifts from executable observation to comment-based reasoning as problems get harder.

### 4.4 Library check compliance dropped

5/5 solvers checked library primitives in v1.1.0. Only 2/5 fully checked in v1.2.0 (40%). The retry prompts may override the standard first-iteration protocol by focusing the solver on the diagnostic context rather than library inspection.

### 4.5 False positives that pass training verification

A new failure mode became prominent: solvers returning `solved=true` with transforms that pass ALL training pairs but produce wrong test outputs. Children 0 and 4 both verified their transforms as correct on training data (legitimately), but the transforms were overfit or coincidental. This is fundamentally different from hallucinated verification (where the model ignores WRONG output) -- here the verification genuinely passes, but the transform does not generalize.

---

## 5. Root Cause Analysis: Why the Score Regressed

### The regression is stochastic, not systematic.

The score difference (2/3 -> 1/3) comes entirely from task 135a2760:
- **v1.1.0:** Solved correctly on pass@1 (3 iterations, clean 2D tiling approach)
- **v1.2.0:** Failed on both passes (solver hallucinated verification on pass@1, retry produced 69-cell-different answer on pass@2)

Task 0934a4d8 failed identically in both versions (OOB edge case). Task 136b0064 succeeded in both (actually improved: solved on pass@1 in v1.2.0 vs pass@2 in v1.1.0).

### Evidence that the regression is NOT caused by plugin changes:

1. The 135a2760 failure was caused by a solver fabricating "Both training pairs are CORRECT" when its output showed "Training pair 1: WRONG." This is a multi-block hallucination -- the same pathology present in v1.1.0. The v1.2.0 plugin changes did not introduce this failure; they attempted (and failed) to prevent it.

2. The VERIFY-THEN-RETURN rule, which was supposed to prevent this, was violated because of multi-block execution -- a problem the v1.2.0 plugin changes cannot address.

3. The 136b0064 improvement (pass@1 instead of pass@2) suggests the solver plugin is at least as effective as v1.1.0 for tasks the model can solve.

### What a larger sample would tell us:

On a 3-task sample, a single task flip changes the score by 33 percentage points. The 95% confidence interval for "true solve rate" given 1/3 observed is approximately 2%-70% (Wilson interval). Similarly, 2/3 observed gives approximately 30%-98%. The confidence intervals overlap massively. We cannot conclude that v1.2.0 is worse than v1.1.0 from this data.

**Recommendation:** Run 10-20 task sessions to get a stable score estimate. The infrastructure improvements in v1.2.0 (ground-truth curation, honest failure reporting, better primitives) are real and should improve performance at scale even if this 3-task sample shows a regression.

---

## 6. The Multi-Block Execution Problem

This is the single most important issue identified across both v1.1.0 and v1.2.0. All 5 analysis documents independently identify it as the root cause of the most damaging failures.

### What the 5 analyses say:

**Trajectory analysis:** "The v1.2.0 plugin language changes ('NEVER write verification code and return() in the same iteration') did not reduce multi-block execution at all." The orchestrator ran the entire session in 1 mega-iteration. 5/8 return events had hallucinated verification.

**State analysis:** "Multi-block execution enables mid-run taskLog pushes that violate the 'one entry at end' contract." 4/5 solvers pushed 2 taskLog entries. The orchestrator's "one task per iteration" instruction was bypassed.

**Program-effectiveness analysis:** "The contracts were well-designed. Their failure is not a design problem but an enforcement problem: declarative contracts work only when the model complies, and multi-block execution creates opportunities for non-compliance."

**Code-patterns analysis:** "4.9 blocks/iter means the agent writes ~5 code blocks before seeing any output." Children with more iterations (Child 3: 10 iters, 3.8 blocks/iter) were more disciplined than those with fewer (Child 1: 3 iters, 7.7 blocks/iter). Blocks per iteration decreased within longer runs (Child 3 went from 12 blocks in iter 0 to 1-2 blocks by iter 9).

**System-prompt analysis:** "The prompt-only approach has failed twice." v1.1.0 and v1.2.0 both added stronger single-block language. Neither worked. 6/26 iterations were truncated because multi-block responses exceeded the output token limit.

### Why prompt-level fixes cannot work:

1. **The model generates its full response before any code executes.** When the model writes blocks 1-8, it has already committed to the content of block 8 before block 1 runs. Verification output from block 5 cannot influence the return code in block 7.

2. **The model's training optimizes for completing coherent thoughts.** An ARC solver's "natural" thought is: analyze data, form hypothesis, test hypothesis, verify, return. This maps to 5+ code blocks in one response. Asking the model to stop after one block fights its training.

3. **Illustrative code creates templates.** The orchestrator plugin shows a complete task cycle (delegate + validate + submit + curate). The model copies this as a single response. Splitting the illustrative code into sections helps marginally (v1.2.0 tried this) but does not overcome the model's preference for complete thoughts.

4. **Two versions of this experiment have now confirmed the same result.** The v1.1.0 system prompt said "One block per response." The v1.2.0 plugin said "NEVER write verification and return in the same iteration" in 4 separate locations, "Each iteration processes exactly ONE task," and "STOP HERE." Compliance: 4% (1/26 iterations used a single block). This is not an issue of emphasis or wording.

### Options for addressing multi-block execution:

#### Engine-level (E)

**E1. Execute only the first code block per iteration (maxBlocksPerIteration=1).**
The engine parses the model's response, executes the first `javascript` code block, discards the rest, and appends a message: "[engine] Additional code blocks were discarded. Write one block per iteration. You will see this output next turn."

- Pros: Completely eliminates the problem. Forces genuine observe-iterate behavior. Prevents hallucinated verification, output truncation, and iteration budget inflation. The system-prompt analysis notes the `maxBlocksPerIteration` parameter may already exist in the engine.
- Cons: The solver's effective throughput drops (currently ~5 blocks per iteration). Would need to increase solver maxIterations from 18 to ~30 to compensate. May degrade quality if the model cannot maintain coherent multi-step exploration across many short iterations.

**E2. Verification-gated return.**
The engine intercepts `return()` calls and checks whether the current iteration's output buffer contains failure signals ("WRONG", "FAIL", "All correct: false"). If so, the return is blocked and a message is injected: "[engine] Verification failures detected in this iteration. Fix the issue or return solved=false."

- Pros: Catches the most damaging consequence (hallucinated verification -> wrong submission) without changing multi-block execution.
- Cons: Does not fix the underlying multi-block problem. Heuristic string matching may produce false positives/negatives. Does not help with the orchestrator's multi-task-per-iteration issue.

**E3. Modified early-return interception message.**
Change the first-iteration return interception from "Verify this is correct by examining the data before returning" to "Your return value was received. Call return() again with the same value to confirm, or call return() with a different value to change it. Do not start new work."

- Pros: May prevent the post-return shape violation (orchestrator solving tasks directly after return intercept).
- Cons: Only addresses one specific behavior. Low effort but narrow impact.

#### Prompt-level (P)

**P-STOP. Remove all illustrative code from the orchestrator plugin.**
Replace the complete session template with a state-machine description: "Read `__arcSession.currentIndex`. If < taskIds.length, process that one task. Else if pass === 1, transition to pass@2. Else if retryIndex < retryIds.length, process that one retry. Else return." No illustrative code at all.

- Pros: Removes the template the model copies into a single mega-block. Forces the model to write its own code per iteration, which may naturally be shorter.
- Cons: The model may write worse code without templates. The orchestrator's code quality in v1.1.0 and v1.2.0 was high specifically because it followed the template closely.

**P-BUDGET. Add explicit block budget to the solver plugin.**
"NEVER write more than 2 code blocks per iteration. You have 18 iterations. Use them: 1 block to explore, 1 block to verify. This is ALWAYS better than batching because batching prevents observation."

- Pros: Directly addresses the block count. The code-patterns analysis shows that children with more iterations are naturally more disciplined (Child 3: 3.8 blocks/iter vs Child 1: 7.7).
- Cons: Has already been tried in weaker form ("one hypothesis per iteration") and failed. Explicit block counting may be slightly more effective but has the same fundamental problem: the model generates all blocks before any execute.

**P-COMMENTS. Reframe observable reasoning as loss prevention.**
"Comments are LOST after this iteration. They do not feed your next iteration. Only console.log() output persists. Any reasoning you need to remember must be printed, not commented."

- Pros: Reframes the rule from normative ("you should") to consequential ("you will lose"). The LANGUAGE.md principle "Declarative > normative" suggests this framing is more effective.
- Cons: May reduce the model's ability to organize its thoughts. Comments serve as planning/structuring mechanisms even if they are invisible.

#### Harness-level (H)

**H1. Run solver with maxBlocksPerIteration=1 as a harness parameter.**
If the engine supports `maxBlocksPerIteration`, the harness can pass it without any engine code changes.

- Pros: Simplest possible fix if the parameter already exists.
- Cons: Requires verifying the engine supports this parameter. May need solver maxIterations increase.

**H2. Increase solver maxIterations to 30.**
Compensate for single-block enforcement by giving solvers more iterations.

- Pros: Ensures the solver has enough turns for genuine exploration. Child 3 used 10/18 iterations in v1.2.0 -- with single-block enforcement, it might need 30+.
- Cons: Increases cost per task. May not be needed if the model adapts to single-block pacing (writing more focused, efficient blocks).

---

## 7. Prioritized Recommendations for v1.3.0

### Program/Plugin Changes (P)

| ID | Priority | Effort | Impact | Description |
|----|----------|--------|--------|-------------|
| P1 | 1 | Medium | High | **Remove orchestrator illustrative code; replace with state-machine spec.** The complete session template is copied into one mega-block. Replace with a declarative state machine: "Read session state. Process the ONE item indicated by current state. Advance state. Stop." Include only the delegation call and curation logic for a single task, not the full loop. |
| P2 | 1 | Low | Medium | **Restructure solver return protocol.** Add: "When your transform passes ALL training pairs, your job for this iteration is DONE. Print 'VERIFICATION PASSED' and stop. Do NOT write return() code. In your NEXT iteration, write ONLY the return block." Frame as two mandatory steps with a hard boundary. |
| P3 | 2 | Low | Medium | **Reframe observable reasoning as loss prevention.** Replace "Write findings as console.log()" with: "Comments are LOST after this iteration. They do not persist. Only console.log() output feeds your next iteration. Any reasoning you need must be printed." |
| P4 | 2 | Low | Medium | **Add explicit block budget.** Add to solver invariants: "NEVER write more than 2 code blocks per iteration. You have 18 iterations -- use them. One block to explore, then STOP. One block to verify, then STOP. Batching 6 blocks prevents you from seeing intermediate results." |
| P5 | 2 | Low | Low | **Restore dimension sanity check.** The orchestrator dropped check (a) in v1.2.0. Add it back with explicit code showing dimension consistency validation. Also revert the color check to output-only (remove input colors from the allowed set). |
| P6 | 3 | Low | Medium | **Add orchestrator spot-check of solver answers.** After reading `logEntry.answer`, the orchestrator compares it against one training pair using `gridsEqual`. This is validation, not solving. If the answer fails the spot-check, override `solved` to false and defer to retry. |
| P7 | 3 | Low | Low | **Strengthen library check in retry prompts.** Add explicit instruction to retry prompt: "FIRST: List all available primitives. THEN: Compose these before writing new code." The retry prompt currently says "Compose existing primitives" but solvers skip the listing step. |
| P8 | 4 | Low | Low | **Reduce globalDocs redundancy.** Trim from ~1,200 to ~400 chars. Keep only variable names and types. The plugins already contain detailed documentation. Saves ~500 tokens per agent. |

### Engine Changes (E)

| ID | Priority | Effort | Impact | Description |
|----|----------|--------|--------|-------------|
| E1 | 1 | Medium | Critical | **Enforce maxBlocksPerIteration=1.** Execute only the first code block per response. Discard rest with a message. This single change cascades into fixing: VERIFY-THEN-RETURN violations, output truncation, orchestrator batching, hallucinated verification, and iteration budget inflation. Increase solver maxIterations to 25-30 to compensate. |
| E2 | 2 | Medium | High | **Verification-gated return.** Intercept `return()` when the current iteration's output contains "WRONG" or "FAIL". Inject a message forcing the model to address the failure. Defense-in-depth behind E1. |
| E3 | 3 | Low | Medium | **Modified early-return interception message.** Change to: "Call return() again with the same value to confirm. Do not start new work." Prevents the post-return shape violation. |

### Harness Changes (H)

| ID | Priority | Effort | Impact | Description |
|----|----------|--------|--------|-------------|
| H1 | 1 | Low | Critical | **Pass maxBlocksPerIteration=1 to the engine.** If the parameter exists, this requires zero engine code changes -- just a harness config update. |
| H2 | 2 | Low | Medium | **Increase solver maxIterations to 30.** Compensate for single-block enforcement. Cost impact: moderate (longer solver runs) but offset by reduced waste from multi-block hallucination. |
| H3 | 3 | Low | High | **Run 10-task sessions.** The 3-task sample is too small to distinguish signal from noise. A single task flip changes the score by 33pp. Running 10+ tasks would give stable compound-learning metrics and test cross-task primitive reuse properly. |

---

## 8. v1.3.0 Changelog (Proposed)

Focus on program-level changes only (P items). Engine changes (E1-E3) and harness changes (H1-H3) are tracked separately.

### `plugins/programs/arc2-compound/program.md`

**Version:** 1.2.0 -> 1.3.0

1. **Add invariant: BLOCK DISCIPLINE.** Each agent writes at most 2 code blocks per iteration. Verification and return MUST be in separate iterations.

2. **Add invariant: OBSERVABLE REASONING.** Comments are lost after each iteration. Only console.log() output persists across iterations. Reasoning that needs to carry forward must be printed.

3. **Add invariant: SPOT-CHECK BEFORE SUBMIT.** The orchestrator independently verifies the solver's answer against at least one training pair before submitting.

### `plugins/apps/arc2-orchestrator.md`

**Version:** 1.2.0 -> 1.3.0

1. **Replace the "Main Loop" illustrative code with a state-machine description.** Remove the complete single-task code template. Replace with:

```
## Iteration Logic

Read `globalThis.__arcSession` to determine what to do this iteration:

  - If `pass === 1` and `currentIndex < taskIds.length`: process ONE task (delegate, validate, submit, curate, advance index). Then STOP.
  - If `pass === 1` and `currentIndex >= taskIds.length`: transition to pass@2. Then STOP.
  - If `pass === 2` and `retryIndex < retryIds.length`: process ONE retry. Then STOP.
  - If `pass === 2` and retries done: return results.

Each case is ONE iteration. Write ONE code block per iteration. Do NOT combine cases.
```

2. **Add spot-check after reading solver result.** Before submitting, compare the solver's `logEntry.answer` against one training pair using `gridsEqual`:

```javascript
// SPOT-CHECK: Do NOT trust logEntry.solved at face value
if (solved && answer) {
  const pair0out = task.train[0].output;
  const pair0predicted = /* apply solver's transform to train[0].input */;
  // Since we don't have the transform function, compare answer dimensions to test input:
  // At minimum, re-derive whether answer is plausible
}
```

Note: Full spot-checking requires the solver to store its transform function on the library (not just the test output). This is a structural limitation. The minimal version: check that `answer` dimensions match the expected test output dimensions, and that training pair 0 was genuinely verified.

3. **Restore dimension sanity check (check a).** Add back:

```javascript
// (a) Dimension consistency
const testInput = task.test[0].input;
const expectedDims = sameSize
  ? `${testInput.length}x${testInput[0].length}`
  : uniqueTrainDims[0]; // if all training outputs have same dims
if (sameSize && answerDims !== `${testInput.length}x${testInput[0].length}`) {
  console.log(`SANITY FAIL: dimensions ${answerDims} differ from test input ${testInput.length}x${testInput[0].length}`);
  sanityOk = false;
}
```

4. **Revert color check to output-only.** Remove input colors from the allowed set:

```javascript
// (b) Color set: answer colors must be subset of TRAINING OUTPUT colors (not input)
const trainColors = new Set();
for (const o of trainOutputs) for (const row of o) for (const c of row) trainColors.add(c);
```

5. **Strengthen retry prompt library check.** Add to the retry query template:

```javascript
const retryQuery = `Solve the current ARC task. ...
FIRST: List all available primitives by running:
  Object.entries(library.primitives).forEach(([name, p]) => console.log(name + ': ' + p.doc));
THEN: Compose these into your solution before writing new code from scratch.`;
```

### `plugins/apps/arc2-solver.md`

**Version:** 1.2.0 -> 1.3.0

1. **Add block discipline invariant:**

```
invariants:
  - BLOCK DISCIPLINE: Write at most 2 code blocks per iteration.
    You have 18+ iterations. Use them wisely:
    - 1 block to explore/test (observe output, then STOP)
    - 1 block to verify/return (in a SEPARATE iteration from the test)
    Batching 6 blocks in one iteration prevents you from seeing intermediate
    results. You CANNOT course-correct on output you have not seen.
```

2. **Reframe observable reasoning:**

Replace:
```
  - OBSERVABLE REASONING: Write findings as console.log() calls, not // comments.
    Comments are invisible to you. console.log() output IS observable and feeds
    your next iteration.
```

With:
```
  - OBSERVABLE REASONING: Comments are LOST after this iteration. They do not
    persist to your next iteration. Only console.log() output carries forward.
    Any reasoning you need to remember -- hypotheses, measurements, coordinates,
    insights -- MUST be in console.log() calls, not // comments.
    A 200-line comment block is 200 lines of work you cannot use next iteration.
```

3. **Restructure the return protocol to be two mandatory steps:**

Replace the current "Return" section with:

```
## Step 1: Verify (its own iteration)

After your transform passes all training pairs, print the results and STOP.
Do NOT write return() in this iteration. Your job is DONE for this iteration.

```javascript
// Run verification, print results, and STOP
let allCorrect = true;
for (let i = 0; i < train.length; i++) {
  const predicted = transform(train[i].input);
  const correct = gridsEqual(predicted, expected);
  console.log(`Training pair ${i}: ${correct ? 'CORRECT' : 'WRONG'}`);
  if (!correct) allCorrect = false;
}

if (allCorrect && train.length >= 3) {
  // Run LOO
  const looPass = leaveOneOutValidation(transform, train);
  console.log(`LOO: ${looPass ? 'PASS' : 'FAIL'}`);
}

console.log('VERIFICATION COMPLETE. If all passed, write return in NEXT iteration.');
// DO NOT write return() here. STOP. Wait for next iteration.
```

## Step 2: Return (NEXT iteration, after seeing verification output)

PRECONDITION: In the PREVIOUS iteration's output, you saw "CORRECT" for every
training pair and "LOO: PASS" (if applicable). If you did NOT see these, do
NOT return solved=true.

```javascript
// Only write this AFTER seeing verification pass in previous output
const testOutput = transform(test[0].input);
globalThis.__arcLibrary.taskLog.push({ ... });
return(JSON.stringify({ solved: true, confidence: 1, answer: testOutput }));
```
```

4. **Add store-transform-on-library instruction:**

```
  - STORE YOUR TRANSFORM: When verification passes, store the transform function
    on the library so the orchestrator can spot-check:

    globalThis.__arcLibrary.primitives[`solve_${taskId}`] = {
      fn: transform,
      source: transform.toString(),
      doc: `Transform for ${taskId}: ${approachDescription}`,
    };
```

This enables the orchestrator spot-check (P6) and preserves the transform for potential reuse in retries.

---

## Appendix: Consolidated Metrics

### v1.1.0 vs v1.2.0 Comparison

| Metric | v1.1.0 | v1.2.0 | Direction |
|--------|--------|--------|-----------|
| Score | 2/3 (67%) | 1/3 (33%) | Regressed (stochastic) |
| Anti-patterns recorded | 0 | 2 | Improved |
| Strategies reliable | 1/4 (25%) | 1/1 (100%) | Improved |
| Primitives with docs | 0/9 | 3/3 (100%) | Improved |
| Primitives general-purpose | 1/9 (11%) | 3/3 (100%) | Improved |
| Cross-task primitive reuse | 0% | 0% | Unchanged |
| Orchestrator shape violations | 1 | 1 | Unchanged |
| Honest solved=false | 0/7 | 1/5 | Improved |
| Avg blocks/iter | 5.3 | 5.2 | Unchanged |
| Output truncations | 5/26 | 6/26 | Unchanged |
| VERIFY-THEN-RETURN compliance | N/A | 0% first-attempt | Failed |
| Solver iters used (avg) | 3.6 | 4.8 | Improved |
| Cost | $2.46 | $2.75 | Slightly higher |
| Wall time | 31.9 min | 28.4 min | Slightly faster |

### What the data says about v1.3.0 priorities

The improvements in v1.2.0 (ground-truth curation, primitive quality, honest failure) are real infrastructure gains that will compound over larger task sets. The score regression is noise on a 3-task sample.

The one change that would have the largest impact on score is **single-block enforcement** (E1/H1). In this specific run:
- Child 1 (135a2760 pass@1) would not have been able to fabricate "Both training pairs are CORRECT" because it would have seen "Training pair 1: WRONG" before writing any return code
- The 135a2760 wrong submission would have been avoided, saving a submission attempt
- With an honest `solved=false`, the orchestrator would have retried on pass@2 with diagnostic context -- and the retry solver (Child 4) did find a closer approach

Conservative estimate: single-block enforcement would have changed the 135a2760 outcome from "both passes wrong" to "at least one honest failure, possibly a correct retry," potentially bringing the score to 2/3 or 3/3.

The second highest-impact change is **orchestrator spot-checking** (P6). If the orchestrator had independently verified Child 1's answer against training pair 1, it would have found the mismatch and deferred to retry instead of submitting a wrong answer.

Everything else (observable reasoning, block budgets, library check strengthening) is incremental improvement on an architecture that is fundamentally sound but hamstrung by the multi-block execution problem.
