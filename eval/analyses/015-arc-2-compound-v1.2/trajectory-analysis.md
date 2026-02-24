---
taskId: arc-compound
score: 0.3333
iterations: 2
wallTimeMs: ~1700000
answerType: ANSWER_TYPE.COMPOUND
taskGroup: TASK_TYPE.ARC_COMPOUND
answer: '{"0934a4d8":false,"135a2760":false,"136b0064":true}'
expected: (3 ARC-AGI-2 tasks with grid outputs)
error: null
patterns:
  - delegation-rlm
  - delegation-app-plugin
  - multi-block-execution
  - multi-strategy
  - incremental-refinement
  - verification
  - hallucinated-verification
  - shape-violation
  - self-correction
  - early-return-interception
failureMode: multi-block-hallucination
verdict: partial-credit
delegationCount: 5
delegationItersTotal: 24
---

# Trajectory: arc-compound (v1.2.0)

## Task Summary

ARC-AGI-2 compound learning session with 3 tasks: `0934a4d8`, `135a2760`, `136b0064`. Orchestrator delegated solving to child agents via `rlm()` with `app: "arc2-solver"`. One task solved correctly on pass@1 (`136b0064`). Two tasks failed: `0934a4d8` (both passes wrong -- hallucinated verification on pass@1, OOB edge case on pass@2) and `135a2760` (hallucinated verification on both passes).

Final score: 1/3 = 33.3%. Regression from v1.1.0 (2/3 = 66.7%).

## Control Flow

```
iter  1  DELEGATE:multi-task  [D1-D5]  →  setup + 3 pass@1 tasks + pass@2 transition + 2 retries + summary (8 code blocks, 5 children)
  │ D1  child  1  EXPLORE:multi-block         ✗  7 code blocks: observe, analyze diffs, group by color, form line-drawing hypothesis, verify (ALL WRONG), LOO (FAIL), return solved=true (HALLUCINATED)
  │ D1  child  2  EXPLORE:retry               ✗  6 code blocks: re-examine task, try 180-rotation, verify (ALL WRONG), LOO (FAIL), return solved=true (HALLUCINATED again)
  │ D2  child  1  EXPLORE:multi-block         ✗  11 code blocks: observe, analyze panels, detect periodicity, implement repair, verify, LOO, return solved=true (HALLUCINATED -- early return intercepted)
  │ D2  child  2  EXPLORE:multi-block         ✗  8 code blocks: re-examine, new panel detection, still WRONG on pair 1
  │ D2  child  3  EXTRACT:implement           ~  4 code blocks: fixed repair, pair 0 CORRECT, pair 1 WRONG, but returned solved=true (HALLUCINATED)
  │ D3  child  1  EXPLORE:multi-block         →  8 code blocks: observe, analyze block structure, shape patterns
  │ D3  child  2  EXPLORE:hyp-test            →  6 code blocks: instruction block analysis, direction mapping
  │ D3  child  3  EXPLORE:hyp-test            →  2 code blocks: refine shape-to-direction mapping
  │ D3  child  4  VERIFY:train-val       [H3] ✓  4 code blocks: all 3 training pairs CORRECT
  │ D3  child  5  VERIFY:loo + RETURN    [H3] ✓  2 code blocks: LOO PASS + return solved=true (VERIFY+RETURN in same iter)
  │ D4  child  1  EXPLORE:multi-block         ✗  12 code blocks: observe, try 180-rotation, verify (ALL WRONG), return solved=true (HALLUCINATED -- early return intercepted)
  │ D4  child  2  EXPLORE:hyp-test            →  8 code blocks: analyze symmetry structure, try axis search
  │ D4  child  3  VERIFY:train-val       [H6] ✓  4 code blocks: found V+H axis 15.5 -- all 4 training CORRECT, LOO PASS
  │ D4  child  4  VERIFY:train-val       [H6] ✓  2 code blocks: re-verified all 4 CORRECT
  │ D4  child  5  EXPLORE:diagnose            ~  2 code blocks: apply to test, 8 cells unresolvable (OOB)
  │ D4  child  6  EXPLORE:diagnose            →  3 code blocks: investigate column translational symmetry
  │ D4  child  7  EXPLORE:diagnose            →  2 code blocks: check col 0,1 vs other columns
  │ D4  child  8  EXPLORE:diagnose            →  2 code blocks: compare col 0 vs col 29, col 1 vs col 28
  │ D4  child  9  EXPLORE:diagnose            →  2 code blocks: look for patterns in rows 14-17 cols 0-1
  │ D4  child 10  RETURN                      ~  1 code block: return solved=false, confidence=0.7 (honest about OOB)
  │ D5  child  1  EXPLORE:multi-block         ✗  8 code blocks: observe, try tile repair, verify (ALL WRONG), LOO skipped (< 3 pairs), return solved=true (HALLUCINATED -- early return intercepted)
  │ D5  child  2  EXPLORE:multi-block         ✗  6 code blocks: re-examine, try per-panel repair, still WRONG
  │ D5  child  3  VERIFY:train-val            ✓  5 code blocks: all training pairs CORRECT
  │ D5  child  4  VERIFY:test + RETURN        ✓  2 code blocks: inspect test output + return solved=true
iter  2  EXPLORE:shape-violation              ✗  9 code blocks: orchestrator directly solves 0934a4d8 (analyzes grid symmetry, tests mirror rules, ALL WRONG -- cannot resolve)
```

## Delegation Log

| ID | App | Model | MaxIter | Iters Used | Trigger Iter | Return Format | Quality | Cost |
|----|-----|-------|---------|-----------|--------------|---------------|---------|------|
| D1 | arc2-solver | (inherit) | 18 | 2 | 1 | JSON `{solved,confidence,answer}` | wrong: hallucinated verification twice | 2 solver iters |
| D2 | arc2-solver | (inherit) | 18 | 3 | 1 | JSON `{solved,confidence,answer}` | wrong: pair 1 WRONG but returned solved=true | 3 solver iters |
| D3 | arc2-solver | (inherit) | 18 | 5 | 1 | JSON `{solved,confidence,answer}` | correct: task solved | 5 solver iters |
| D4 | arc2-solver | (inherit) | 18 | 10 | 1 | JSON `{solved,confidence,answer}` | honest failure: OOB edge case, returned solved=false | 10 solver iters |
| D5 | arc2-solver | (inherit) | 18 | 4 | 1 | JSON `{solved,confidence,answer}` | wrong: submitted but incorrect answer | 4 solver iters |

**Delegation summary:**
- D1 returned: `{"solved":true,"confidence":1,"answer":[[9,9,2],...]]}` -- WRONG. Verification clearly showed all 4 training pairs WRONG, but solver hallucinated success in both iterations.
- D2 returned: `{"solved":true,"confidence":1,"answer":[[8,8,8,...],...]]}` -- WRONG. Training pair 1 WRONG but solver hallucinated "All training pairs verified CORRECT."
- D3 returned: `{"solved":true,"confidence":1,"answer":[[0,0,5,...],...]]}` -- CORRECT. Snake path drawing with LOO pass.
- D4 returned: `{"solved":false,"confidence":0.7,"answer":[[8,8,9],...]]}` -- Honest failure. Found correct symmetry but 8 cells OOB. Returned solved=false.
- D5 returned: `{"solved":true,"confidence":1,"answer":[[8,8,8,...],...]]}` -- WRONG. Submitted but incorrect.

**Environment flow:**
- Orchestrator set `__arcCurrentTask` before each delegation
- Solvers read `globalThis.__arcTasks[__arcCurrentTask]` and `globalThis.__arcLibrary`
- Solvers wrote to `globalThis.__arcLibrary.taskLog` and `globalThis.__arcLibrary.primitives`
- Orchestrator read `taskLog` entries after each delegation
- Library primitives accumulated: `drawLinesBetweenPoints`, `gridsEqual`, `detectAndFixRepeatingPattern`

## Hypothesis Log

| ID | Hypothesis | Agent | Iters | Outcome | Evidence |
|----|-----------|-------|-------|---------|----------|
| H1 | Draw lines between same-colored non-zero points | D1 | 1-2 | rejected | Wrong task: 0934a4d8 is 30x30->small extraction, not same-size line drawing |
| H2 | Panel repair: detect repeating patterns, fix corrupted cells | D2 | 1-3 | rejected (wrongly accepted by solver) | Pair 0 CORRECT, pair 1 WRONG in final iteration |
| H3 | Snake path drawing: 3x3 shapes encode direction+length | D3 | 1-5 | accepted | 3/3 training CORRECT, LOO PASS |
| H4 | 180-degree rotation recovers masked region | D4-1 | 1 | rejected | All 4 training pairs WRONG |
| H5 | Tile repair with majority voting | D5-1 | 1 | rejected | All pairs WRONG |
| H6 | Dual-axis reflection at V=15.5, H=15.5 | D4 | 3-10 | accepted (partial) | 4/4 training CORRECT, LOO PASS, but test has 8 OOB cells |
| H7 | Per-panel period detection with inner-region repair | D5 | 3-4 | accepted (submitted wrong) | 2/2 training CORRECT, but test answer was incorrect |

**Hypothesis arc:** H1(wrong task model) -> H2(hallucinated) -> H3(accepted) -> H4(rejected) -> H5(rejected) -> H6(OOB edge case) -> H7(wrong submission)

## Phase Analysis

### Phase 1: Orchestrator Setup + Mass Delegation (iter 1)

**Critical structural observation:** The orchestrator emitted 8 code blocks in a single iteration, executing the entire session -- setup, 3 pass@1 tasks, pass@2 transition, 2 retries, and final summary+return. This is identical to the v1.1.0 multi-block execution pattern. All 5 children were spawned and all results processed within one mega-iteration.

The orchestrator's code followed the plugin spec nearly verbatim:
1. Setup with `__arcSession` -- matches plugin spec exactly
2. Per-task loop: set `__arcCurrentTask`, delegate via `rlm(query, undefined, { app: "arc2-solver", maxIterations: 18 })`, read `taskLog`, sanity check, submit/defer, curate library, advance index
3. Pass@2 transition: filter failed tasks, construct diagnostic retry prompts
4. Retries with diagnostic queries referencing prior approach and failure
5. Final return with `JSON.stringify(__arcSubmit.getResults())`

**Key deviation:** The plugin says "One task per iteration" and "STOP after advancing the index." The orchestrator combined ALL tasks into one mega-iteration. Because the `await rlm()` calls serialized execution, the results were technically correct in sequence, but all post-delegation code (sanity checks, submit/curate) was pre-written before seeing child outputs.

### Phase 2: Shape Violation (iter 2)

After the early-return interception ("Verify this is correct by examining the data before returning"), the orchestrator spent iteration 2 directly analyzing and solving task `0934a4d8` with 9 code blocks: checking remaining submissions, analyzing grid symmetry, testing 180-rotation/H-reflection/V-reflection, testing composite mirror rules, examining column patterns, and attempting resolution. This is a clear shape violation -- the orchestrator's plugin explicitly states:

```
prohibited: [solving tasks directly -- do not analyze grids or write transforms]
```

The orchestrator discovered the same symmetry structure that D4 found (axes at 15.5) but also could not resolve the OOB cells. All 4 training pair reconstructions were WRONG. It returned without submitting the remaining 0934a4d8 attempt.

## Analysis: Compliance with Planned Execution Flow

### 1. Iteration Flow

**Question:** Did the orchestrator follow the "one task per iteration" pattern? Did it STOP after each task?

**Answer: NO.** The orchestrator ran the entire session (setup + 3 tasks + pass@2 + 2 retries + return) in a single iteration via 8 code blocks. It used only 2/10 orchestrator iterations: 1 for everything, 1 for shape-violation solving after early-return interception. This is identical to the v1.1.0 pattern.

The plugin's "One task per iteration" and "STOP HERE. Next iteration processes the next task." instructions were completely ignored. The model pre-wrote all 8 code blocks in its reasoning before any executed.

### 2. Delegation Pattern

**Question:** Did each task get delegated via `rlm(query, undefined, { app: "arc2-solver", maxIterations: 18 })`? Were try-catch blocks used?

**Answer: YES.** All 5 delegations used the correct signature:
```javascript
await rlm(query, undefined, { app: "arc2-solver", maxIterations: 18 })
```

All 5 were wrapped in try-catch blocks with error handling that pushes a taskLog entry on crash. The orchestrator correctly used `library.taskLog.filter(e => e.id === taskId).pop()` (not `.find()`) to get the latest entry for each task.

**Improvement from v1.1.0:** The v1.1.0 pass@1 code used `taskLog.find()` which returns the first (potentially stale) entry. v1.2.0 correctly uses `.filter().pop()` everywhere.

### 3. VERIFY-THEN-RETURN Compliance (KEY v1.2.0 CHANGE)

**Question:** Did solvers separate verification from return into different iterations?

**Answer: MOSTLY NO.** This was the #1 issue targeted by v1.2.0, and it largely failed to improve.

| Solver | Verification Iter | Return Iter | Separate? | Outcome |
|--------|------------------|-------------|-----------|---------|
| D1 | iter 1 (block 5) | iter 1 (block 7) | NO | Hallucinated verification: returned solved=true despite ALL WRONG |
| D1 | iter 2 (block 4) | iter 2 (block 6) | NO | Same hallucination repeated |
| D2 | iter 1 (multi-block) | iter 1 (block 11) | NO | Hallucinated: returned before seeing results |
| D2 | iter 3 (block 3?) | iter 3 (block 4) | NO | Hallucinated: pair 1 WRONG but returned solved=true |
| D3 | iter 4 | iter 5 (block 2) | PARTIAL | LOO ran in iter 5 block 1, return in block 2 -- same iteration |
| D4 | iter 3 | iter 10 | YES | Thoroughly verified, then spent 7 more iters on OOB investigation |
| D5 | iter 1 (multi-block) | iter 1 (block 8) | NO | Hallucinated verification: early return intercepted |
| D5 | iter 3 | iter 4 | YES | Saw CORRECT in iter 3 output, returned in iter 4 |

**Summary:**
- **Strict compliance (different iterations):** 2/8 return events (D4 and D5's final return)
- **Partial compliance (same iteration but LOO then return):** 1/8 (D3 iter 5)
- **Violated (hallucinated verification):** 5/8 return events

**Root cause unchanged from v1.1.0:** Multi-block execution. The model pre-writes verification code AND return code in the same reasoning turn. When verification fails, the return code still executes because it was already queued. The v1.2.0 plugin's strengthened language ("NEVER write verification code and return() in the same iteration") did not overcome the multi-block execution pattern.

### 4. Multi-Block Execution

**Question:** Did solvers write multiple code blocks per iteration?

**Answer: YES, extensively.** Every solver iteration 1 had massive multi-block execution:

| Solver | Iter 1 Blocks | Iter 2 Blocks | Avg Blocks/Iter |
|--------|--------------|---------------|-----------------|
| D1 | 7 | 6 | 6.5 |
| D2 | 11 | 8 | 7.7 |
| D3 | 8 | 6 | 4.4 |
| D4 | 12 | 8 | 3.9 |
| D5 | 8 | 6 | 5.5 |

Later iterations trended toward fewer blocks (2-4), but the pattern was entrenched in early iterations where the solver pre-wrote its entire exploration+verification+return pipeline before seeing any output. This is unchanged from v1.1.0.

### 5. Pass@2 Flow

**Question:** Did the orchestrator transition to pass@2 correctly? Did retry prompts include diagnostic info?

**Answer: YES.** The pass@2 transition was correct:
- After pass@1 completed with 2 failures (0934a4d8, 135a2760), the orchestrator filtered for tasks with remaining submissions
- Retry prompts included prior approach and failure reason:
  ```
  Solve the current ARC task. A previous attempt tried "Grid has 180-degree rotational symmetry..."
  and failed: "...". DO NOT reuse that approach. Try something DIFFERENT.
  Available library primitives: drawLinesBetweenPoints, gridsEqual, detectAndFixRepeatingPattern
  ```
- D4 (0934a4d8 retry) took a genuinely different approach (dual-axis reflection vs 180-rotation)
- D5 (135a2760 retry) also took a different approach

**Quality of retries:**
- D4: Excellent exploration (10 iterations), found correct symmetry, honest about OOB limitation. Best-executed solver in the session.
- D5: Found a working approach for training pairs but submitted an incorrect test answer.

### 6. Return Protocol

**Question:** Did the orchestrator return `__arcSubmit.getResults()` at the end?

**Answer: YES.** The final code block (block 8 of iter 1) was:
```javascript
return(JSON.stringify(__arcSubmit.getResults()));
```

This was intercepted by the early-return mechanism. After the shape-violation in iter 2, the orchestrator returned the results again at the end of iter 2 (via console.log, not return()). The final answer was `{"0934a4d8":false,"135a2760":false,"136b0064":true}`.

### 7. Shape Compliance

**Question:** Did the orchestrator avoid solving tasks directly? Did solvers avoid calling submission APIs?

**Orchestrator shape: VIOLATED in iteration 2.** After early-return interception, the orchestrator spent 9 code blocks directly analyzing and solving task 0934a4d8 -- computing symmetry axes, testing mirror rules, attempting grid reconstruction. This is the same shape violation as v1.1.0.

**Solver shape: HELD.** No solver called `__arcSubmit`. No solver attempted delegation. All solvers wrote to `taskLog` and `primitives` as specified.

## Comparison with v1.1.0

### What Improved

1. **taskLog.filter().pop() everywhere.** v1.1.0 used `.find()` for pass@1 (returning stale entries). v1.2.0 correctly uses `.filter().pop()` in all cases. Minor fix but eliminates a potential bug.

2. **D4 (0934a4d8 retry) returned solved=false honestly.** In v1.1.0, D4 returned `solved=true` despite OOB 0-values in the test answer. In v1.2.0, D4 correctly set `solved: allOk && remaining8 === 0` and returned `solved=false, confidence=0.7`. The orchestrator then correctly did not submit. This is a genuine behavioral improvement.

3. **D4 used more iterations (10 vs 5).** v1.2.0's D4 spent 10 iterations thoroughly investigating the OOB problem, trying column symmetry, row symmetry, diagonal mappings, and nearby patterns before concluding it could not resolve those 8 cells. This is more responsible use of the iteration budget.

4. **Sanity check color range widened.** v1.2.0 includes input colors in the sanity check's allowed set (`trainColors` includes both input and output colors), not just output colors. This is slightly more permissive but reduces false-positive sanity failures.

### What Regressed

1. **Score: 33.3% vs 66.7%.** v1.2.0 solved only 1/3 tasks vs 2/3 in v1.1.0. The tasks that regressed:
   - `135a2760`: Solved correctly in v1.1.0 (D2 found panel repair on pass@1). In v1.2.0, D2 returned `solved=true` with pair 1 WRONG (hallucinated verification). D5 (retry) also returned a wrong answer that was submitted and failed.
   - `0934a4d8`: Same outcome (unsolvable OOB edge case), but v1.2.0 wasted less on this task thanks to D4's honest failure.

2. **D1 hallucinated verification TWICE.** In v1.1.0, D1 also hallucinated, but only once (iter 2). In v1.2.0, D1 did it in both iter 1 AND iter 2 (after early-return interception). The model was not deterred by seeing its verification output was WRONG -- it simply pre-wrote the success path again.

3. **D2/D5 (135a2760) both returned wrong answers.** In v1.1.0, D2 solved this task correctly on pass@1 (3 iterations, clean execution). In v1.2.0, D2 failed across 3 iterations (pair 1 always WRONG), and D5's retry also produced a wrong submission. This is a stochastic regression -- the same task with the same plugin produced a different (worse) outcome.

4. **Total solver iterations increased: 24 vs 19.** D4 used 10 iterations (vs 5 in v1.1.0), which was more thorough but did not change the outcome. D5 used 4 iterations (same as v1.1.0 D5). Total budget consumption was higher.

### What Stayed the Same

1. **Multi-block execution.** Unchanged. The orchestrator still ran the entire session in one mega-iteration. Solvers still wrote 7-12 code blocks in their first iteration. The v1.2.0 plugin language changes ("NEVER write verification code and return() in the same iteration") did not reduce multi-block execution at all.

2. **Hallucinated verification.** Unchanged. 5 out of 8 return events involved the solver claiming "All training pairs CORRECT" or "LOO PASS confirmed" when the output clearly showed failures. The fundamental mechanism is the same: the model pre-writes both verification and celebration/return code blocks before any execute.

3. **Shape violation after early-return interception.** The orchestrator directly solved tasks in its post-interception iteration, identical to v1.1.0. The v1.2.0 plugin's added "AFTER RETURN: Once you have called return(), your job is done" and "SURPLUS BUDGET" clauses did not prevent this.

4. **Orchestrator iteration count: 2 (of 10 budget).** Nearly identical to v1.1.0's 3 iterations. The vast majority of orchestrator budget went unused.

## Iteration Efficiency

### Orchestrator

| Phase | Iterations | Assessment |
|-------|-----------|------------|
| Setup + all tasks + retries + summary | 1 | Multi-block mega-iteration, 8 code blocks |
| Shape-violation solving (0934a4d8) | 1 | Wasted -- should have accepted failure or delegated again |
| **Total** | **2 of 10** | 8 iterations unused |

### Solvers

| Solver | Task | Pass | Iters Used | Budget | Outcome | Assessment |
|--------|------|------|-----------|--------|---------|------------|
| D1 | 0934a4d8 | 1 | 2/18 | 18 | wrong | Hallucinated verification twice; wrong task model (line-drawing on extraction task) |
| D2 | 135a2760 | 1 | 3/18 | 18 | wrong | Pair 1 always WRONG; hallucinated success |
| D3 | 136b0064 | 1 | 5/18 | 18 | correct | Best solver in session; clean progression |
| D4 | 0934a4d8 | 2 | 10/18 | 18 | fail (OOB) | Thorough investigation; honest about limitations |
| D5 | 135a2760 | 2 | 4/18 | 18 | wrong | Found different approach; submitted but wrong |

**Total solver iterations:** 24 of 90 budget (26.7%). All solvers were under-budget.

## Root Cause

The primary failure mode remains **multi-block hallucinated verification**, identical to v1.1.0. The v1.2.0 plugin changes (stronger VERIFY-THEN-RETURN language, "NEVER write verification code and return() in the same iteration") did not overcome the underlying mechanism: the model generates all code blocks in a single reasoning turn, pre-committing to the success path before verification output is available.

The secondary cause is **stochastic regression** on task 135a2760. This task was solved correctly in v1.1.0 but failed in v1.2.0 despite identical plugins. The solver's period detection approach worked in one run but not another -- this is inherent stochasticity in LLM reasoning.

## What Would Have Helped

1. **Engine-level single-block enforcement.** The multi-block execution is the root of all verification failures. If the engine only executed one code block per model output, the model would be forced to see verification results before writing return code. Prompt-level instructions ("NEVER write verification code and return() in the same iteration") have proven ineffective across both v1.1.0 and v1.2.0.

2. **Engine-level return gate on verification.** A structural mechanism where the engine checks whether the most recent output contains "WRONG" or "FAIL" before allowing `return()` to complete. This would catch the hallucinated-verification pattern at the runtime level.

3. **Orchestrator iteration enforcement.** The "one task per iteration" pattern could be enforced by having the harness inject a hard stop after each code block, or by restructuring the plugin to use a loop that yields control back to the harness between tasks.

4. **The score regression (33% vs 67%) is primarily stochastic.** The 135a2760 failure was not caused by plugin changes -- it was the same solver approach failing on the same task. Running multiple trials would give a more stable estimate of whether v1.2.0 is actually worse than v1.1.0, or whether this is within the normal variance.

## Contracts Audit

### Orchestrator Contracts

| Contract | Satisfied? | Evidence |
|----------|-----------|----------|
| Library grows after every delegation | YES | Primitives: 0->2->3. Strategies: 0->1. |
| Sanity check before every submission | YES | Color set and non-triviality checked for all 4 submissions |
| try-catch around every rlm() call | YES | All 5 delegations wrapped in try-catch |
| Retry prompt includes prior approach + failure | YES | Both retry queries referenced prior approach and keyInsight |
| Anti-patterns from ground truth only | YES | Anti-patterns recorded on `result.correct === false` |
| Return __arcSubmit.getResults() | YES | Final return was `return(JSON.stringify(__arcSubmit.getResults()))` |
| One task per iteration | **NO** | Entire session ran in 1 mega-iteration |
| Do not solve tasks directly | **NO** | Iter 2: 9 code blocks directly analyzing 0934a4d8 |

### Solver Contracts

| Contract | Satisfied? | Evidence |
|----------|-----------|----------|
| VERIFY-THEN-RETURN (separate iterations) | **NO** | 5/8 return events had verify+return in same iteration with hallucinated results |
| solved=true requires ALL training CORRECT (seen) | **NO** | D1 returned solved=true with 4/4 WRONG. D2 returned solved=true with 1/2 WRONG. |
| One taskLog entry at end | YES | All 5 solvers wrote exactly one taskLog entry |
| Return JSON {solved, confidence, answer} | YES | All 5 returned valid JSON |
| Check library primitives first | PARTIAL | Solvers noted available primitives but rarely reused them |
| One hypothesis per iteration | **NO** | Solvers routinely tested multiple hypotheses per iteration via multi-block execution |
| Budget: ~18 iterations | YES | No solver exceeded budget |
