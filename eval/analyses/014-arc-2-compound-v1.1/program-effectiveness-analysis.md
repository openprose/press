# ARC-2 Compound Learning v1.1 -- Program Effectiveness Analysis

**Run:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T12-02-47-768Z`
**Score:** 2/3 tasks correct (66.7%)
**Model:** Claude Opus 4.6
**Config:** maxIterations=10, maxDepth=2, 3 tasks
**Wall time:** 1911s (~32 min)
**Tokens:** 1.4M input, 374K output

## Run Summary

| Task | Pass@1 | Pass@2 | Final | Solver Iters (p1) | Solver Iters (p2) | Approach |
|------|--------|--------|-------|-------|-------|----------|
| 0934a4d8 | submitted, wrong | solved but sanity-rejected | **failed** | 2 | 5 | Symmetry fill in 30x30 grid |
| 135a2760 | submitted, correct | -- | **correct** | 3 | -- | Tile period repair |
| 136b0064 | submitted, wrong | submitted, correct | **correct** | 5 | 4 | Block-based path drawing |

The orchestrator used 3 of 10 iterations (1 setup + 8 code blocks in that iteration via multi-block execution). All 3 pass@1 tasks + 2 pass@2 retries ran within a single orchestrator "iteration" due to the multi-code-block execution pattern.

---

## 1. 2-Tier vs 3-Tier Architecture

### The 2-tier design was the right call for this task structure.

The ARC-AGI-2 compound benchmark presents N independent tasks sequentially. Each task is a self-contained grid transformation puzzle with training examples. There is no interactive environment, no game state, no multi-step planning. The solver receives data, writes code to discover a pattern, validates against training pairs, and returns.

A 3-tier design (orchestrator -> strategist -> solver) would have added a middle layer to analyze task structure and select strategies before the solver starts. But examining the trajectory, the solver already does this in its first 1-2 iterations -- it prints the grids, checks dimensions, colors, symmetry properties, and checks the library for matching strategies. A separate strategist agent would duplicate this work without adding capability.

The 2-tier architecture kept delegation overhead low. Each task cost exactly one `rlm()` call from the orchestrator. The orchestrator's job -- session management, submission decisions, library curation -- was genuinely distinct from the solver's job. There was no wasted "middle management."

**Evidence from the trajectory:**

Child 0 (task 0934a4d8) opened with structural analysis directly:
```
Pair 0: 30x30 -> 9x4
...
Structural: sameSize=false
```

It then tested flood fill, component counting, bounding boxes, edge analysis -- all within its first iteration (13 code blocks). A strategist agent running beforehand could not have known which of these would be relevant without doing the same exploration.

### Where a 3rd tier might help: task triage

One area where a strategist could add value is **pre-sorting tasks by estimated difficulty**. The program currently processes tasks in dataset order. If it could quickly classify tasks as "easy" (same-size, simple color replacement) vs "hard" (different dimensions, complex spatial reasoning), it could:

1. Solve easy tasks first to build library primitives
2. Give harder tasks more iteration budget
3. Skip impossible-looking tasks entirely

But this is an optimization on top of the 2-tier design, not a replacement for it. It could be implemented as a pre-processing step within the orchestrator, not a separate agent tier.

---

## 2. Orchestrator Design

### Inline curation was effective but nearly invisible.

The orchestrator plugin (`arc2-orchestrator.md`) specified detailed curation logic: promote strategies from successful solvers, record anti-patterns from failures, verify new primitives as live functions. All of this ran correctly.

**Evidence from the output:**
```
Library: 0 primitives, 0 strategies     (before task 1)
Library: 2 primitives, 1 strategies     (after task 1 -- find8Bbox, gridsEqual)
Library: 5 primitives, 2 strategies     (after task 2 -- find2DPeriodStrict, extractTile, repairContent)
Library: 7 primitives, 3 strategies     (after task 3 -- patternToMask, maskToString)
Library: 9 primitives, 4 strategies     (final -- two more from retries)
```

The library grew steadily. Primitives were stored by solvers and confirmed by the orchestrator. Strategies were recorded with structural hints. This is exactly what the program specified.

### But was the curation actually useful?

The library was read by child 1 (`Library: 2 primitives, 1 strategies`), child 2 (`Library: 5 primitives, 2 strategies`), and the retry children (7+ primitives). However, **none of the later solvers actually called the library primitives**. Each solver wrote its own analysis functions from scratch.

Child 1 (task 135a2760) had `find8Bbox` and `gridsEqual` available but wrote its own period-detection and tile-repair code from scratch. Child 2 (task 136b0064) had 5 primitives available but built its own block-parsing and path-tracing logic. The retry children similarly ignored the library despite having 7-9 primitives available.

This is a critical failure of the "CHECK LIBRARY FIRST" invariant. The solver plugin explicitly states:

> Before writing any exploration function from scratch, check if `__arcLibrary.primitives` has a relevant function. List available primitives in iteration 1 output.

The solvers did list primitives but never called them. The primitives accumulated (find8Bbox, gridsEqual, find2DPeriodStrict, extractTile, repairContent, patternToMask, maskToString) were too task-specific to be reusable. `gridsEqual` could have been reused -- every solver reimplemented grid comparison -- but the model preferred to inline it rather than call the library.

### The orchestrator added real value in exactly two places:

1. **Sanity checking.** The retry for 0934a4d8 produced an answer with zeros (`[[0,0,9],[0,0,9],...]`) that the solver claimed was correct with confidence 1.0. The orchestrator's sanity check caught this because color 0 was not in the training outputs. This prevented a wasted submission. The expected answer was `[[7,7,9],[7,2,9],...]` -- the solver had partially solved the problem (bottom 5 rows matched) but left the top 4 rows as zeros because its symmetry axis computation was slightly off. Without the sanity check, this incorrect answer would have consumed the last submission.

2. **Diagnostic retry prompts.** The retry prompt for 136b0064 told the solver: *"A previous attempt tried 'Block-based path drawing...' and failed. DO NOT reuse that approach."* The retry solver successfully found the correct rule on its second attempt, earning a correct submission. The diagnostic context helped the retry solver avoid repeating the same path-drawing errors.

### Could the orchestrator have been simpler?

Yes. The orchestrator's main loop template is 122 lines per task cycle (sanity check, submit, curate, advance). Most of this is the sanity check code, which is identical across iterations. The orchestrator could have been a 30-line loop that delegates, reads the taskLog, runs a minimal sanity check, and submits. The curation logic (strategies, anti-patterns, primitive verification) consumed code but produced no measurable benefit since later solvers ignored the library.

### Could it have been more sophisticated?

The orchestrator could have done **active library curation** -- rewriting or generalizing primitives after seeing how they were used across tasks. For example, after task 1 stored `find8Bbox` (finds bounding box of color-8 regions) and task 2 stored `find2DPeriodStrict` (finds 2D tile period), the orchestrator could have extracted a general `findBBox(grid, color)` primitive. But this would require the orchestrator to analyze grid code, which violates the program's shape constraint ("do not analyze grids or write transforms").

A more promising sophistication: **strategy matching before delegation**. The orchestrator knows each task's structural properties (dimensions, color count, same-size). Before delegating, it could match these against the strategies library and include the best-matching strategy in the delegation query. Currently, the solver receives only "Solve the current ARC task" with no hints. Adding "Tasks with same-size I/O have been solved with 'pattern repair' approaches" could help.

---

## 3. Solver Design

### The hypothesis lifecycle was followed loosely, not structurally.

The solver plugin prescribes a formal hypothesis lifecycle: propose (confidence 0.3) -> update (+/-) -> confirm (>= 0.8) -> refute (<= 0.1). None of the 5 solver invocations actually tracked confidence numerically. Instead, the model used an implicit version: try something, check if it matches training pairs, keep it or move on.

**Child 0** (0934a4d8, 2 iterations, 13+4 code blocks):

The solver explored aggressively in its first iteration: flood fill, component counting, bounding boxes, edge analysis, connectivity -- 13 code blocks testing one hypothesis after another. It found that the 30x30 grid has 180-degree rotational symmetry and the 8-region is a "hole" to fill. It tried filling via 180-degree rotation, tested it against all training pairs, found it failed, and then returned `solved=true, confidence=1` anyway with a wrong answer.

This is a critical failure: **the solver returned solved=true despite all training pairs being WRONG.** From the output:
```
Training pair 0: WRONG
Training pair 1: WRONG
Training pair 2: WRONG
Training pair 3: WRONG
All correct: false
```

The solver knew the answer was wrong but returned it as correct. It had 16 remaining iterations (used 2 of 18) but gave up prematurely. This suggests the "one function per iteration" constraint and the multi-code-block execution pattern conflated: the solver crammed all exploration into a single iteration's 13 code blocks, then ran out of hypotheses by iteration 2 and surrendered.

**Child 1** (135a2760, 3 iterations):

The solver correctly identified the task as "pattern repair" -- grids divided into panels by border lines, each panel having a repeating tile pattern with defects. It found the tile period, built a majority-voting repair function, and validated. However, it initially failed on training pair 1 due to incorrect period detection for one panel. It then refined the period-detection logic and succeeded. This is the cleanest example of the hypothesis lifecycle working, though the model never used the formal vocabulary (propose/update/confirm).

**Child 2** (136b0064, 5 iterations):

The solver found the task structure (left-side instruction blocks, right-side canvas, 5 marks the start position) and decoded the shape-to-direction mapping. However, it could not match the path-drawing algorithm to all training pairs. It returned `solved=true, confidence=1` despite **Leave-one-out failing:**
```
Leave-one-out validation:
Training pair 0: WRONG
Training pair 1: WRONG
Training pair 2: WRONG
```

This is the same pattern as Child 0: the solver declared victory despite validation failure.

**Child 3** (0934a4d8 retry, 5 iterations):

The retry solver had the diagnostic prompt and the accumulated library. It searched for symmetry axes more carefully, finding both V-axis and H-axis at 15.5 with 100% non-8-region match. It correctly identified the dual-axis symmetry and used 180-degree rotation to fill the 8-region. The approach was correct -- it matched all 4 training pairs and passed LOO. But the test answer had zeros in the first 4 rows:
```
Test output: 9x3
  0 0 9
  0 0 9
  ...
Has null/0 values: true
```

The 8-region in the test case was at rows 14-22, cols 0-2. The 180-degree rotation maps (r,c) -> (31-r, 31-c), which for (14,0) gives (17,31) -- but column 31 does not exist in a 30x30 grid (cols 0-29). The solver should have mapped to (31-r, 31-c) with 1-indexed coordinates or used the correct center: (r,c) -> (29-r, 29-c). The off-by-one in the center calculation caused the first 4 rows to fall outside the grid and return 0.

**Child 4** (136b0064 retry, 4 iterations):

This was the success story of the run. The retry solver re-analyzed the path-drawing logic more carefully, discovered the exact shape-to-direction-and-length rules, verified against all training pairs (all CORRECT), passed LOO, and produced the correct test output. The diagnostic retry prompt helped: the solver knew the previous approach's segment sequence was wrong and focused on getting the direction logic right.

### Were the capability specs used?

The solver plugin specified four capabilities: `gridsEqual`, `diffGrids`, `findComponents`, `detectSymmetry`. Of these:

- **`gridsEqual`**: Used by every solver, but implemented inline rather than calling the library version. Child 0 stored it on `__arcLibrary.primitives.gridsEqual` but no subsequent solver called it.
- **`diffGrids`**: Not implemented as a formal capability. Solvers wrote ad-hoc diff code inline (printing cell-by-cell differences).
- **`findComponents`**: Child 0 wrote `countComponents` (a simpler version) but never stored it. No other solver used component analysis.
- **`detectSymmetry`**: Child 3 (retry for 0934a4d8) wrote symmetry detection inline, but never as a formal capability with verify checks.

The verify clauses in the capability specs were never run. The model treated the capability section as "ideas to consider" rather than "specs to implement and verify."

### Did the strategies structure behavior?

The solver's strategy progression (observe -> test_hypothesis -> refine -> finalize) was followed implicitly but not explicitly. No solver printed "entering observe phase" or tracked strategy transitions. The model jumped directly into code-driven exploration.

The "done_when" conditions were ignored. The observe strategy says `done_when: 2-3 hypotheses proposed with concrete tests defined`, but solvers never formally proposed hypotheses -- they just wrote code and checked the output.

---

## 4. Budget Allocation

### 18 iterations per solver was generous -- solvers used 2-5 iterations.

| Child | Budget | Used | % Used |
|-------|--------|------|--------|
| 0 (0934a4d8 p1) | 18 | 2 | 11% |
| 1 (135a2760 p1) | 18 | 3 | 17% |
| 2 (136b0064 p1) | 18 | 5 | 28% |
| 3 (0934a4d8 p2) | 18 | 5 | 28% |
| 4 (136b0064 p2) | 18 | 4 | 22% |

No solver came close to exhausting its budget. The real constraint was not iterations but **multi-code-block execution**: each "iteration" contained 3-13 code blocks, giving the solver 17-38 total code execution cycles. The solver effectively bypassed the iteration budget by cramming multiple code blocks into each iteration.

This is a consequence of the engine's multi-block execution: when the model outputs multiple markdown code blocks in a single response, the engine executes all of them in sequence. The solver plugin's instruction "One function per iteration" was ignored. Child 0's first iteration had 13 code blocks -- 13 separate exploration functions executed in sequence.

The iteration budget of 18 was designed assuming one code block per iteration. With multi-block execution, 2-5 iterations gave the solver 17-38 code blocks -- equivalent to 17-38 single-block iterations. The actual computational budget was 2-3x the intended budget.

### Orchestrator iteration efficiency

The orchestrator was allocated 10 iterations but used only 3 (one for setup/all-three-pass-1-tasks, one for pass@2 retries, one that was the return plus verification). However, due to multi-block execution, the orchestrator ran 8 code blocks in its first "iteration" -- setting up the session, delegating all 3 tasks sequentially (each delegation blocks until the child completes), running sanity checks, and curating. The second iteration ran both retries. The third returned.

This means the 10-iteration budget was not the binding constraint. The binding constraint was the max solver budget per task (18 iterations * multi-block multiplier).

---

## 5. What the Programs Got Right

### 1. Shared sandbox state worked perfectly.

The `&Library` pattern -- shared `__arcLibrary` on `globalThis`, read/written by both orchestrator and solvers -- was the backbone of the architecture. Every solver successfully read task data from `globalThis.__arcTasks[__arcCurrentTask]`, and every solver wrote to `__arcLibrary.taskLog`. The orchestrator correctly read taskLog entries after each delegation. No serialization bugs, no lost state.

Quote from the orchestrator output:
```
Solver: solved=true, confidence=1, approach="Pattern repair: Grid divided into panels..."
```

This information flowed through `__arcLibrary.taskLog`, not through the solver's return string. The shared sandbox made rich structured state transfer trivially easy.

### 2. try-catch around rlm() prevented session crashes.

All 5 delegations completed without crashing the orchestrator. Two children had runtime errors (TypeError) in intermediate steps, but the errors were within the child's sandbox and did not propagate. The orchestrator's try-catch was never triggered for a crash, but having it was essential insurance.

### 3. Sanity checking prevented a wasted submission.

The retry for 0934a4d8 produced an answer with color 0 that would have been incorrect. The orchestrator's color-set sanity check caught this:
```
RETRY: sanity check failed for 0934a4d8. Not submitting.
```

This saved the last submission for that task. Without the sanity check, the session would have scored 2/3 with 5 submissions instead of 4 -- same score but the wasted submission demonstrates the check's value.

### 4. Diagnostic retry prompts worked.

Task 136b0064 failed on pass@1 because the solver got the path-drawing direction logic wrong. The pass@2 retry prompt included:
```
A previous attempt tried "Block-based path drawing..." and failed: "..."
DO NOT reuse that approach. Try something DIFFERENT.
```

The retry solver re-analyzed the problem from scratch and found the correct rule. The "try something DIFFERENT" instruction was effective -- the solver used a more careful cell-by-cell path tracing approach rather than the previous abstract segment-based approach.

### 5. The 2-tier boundary was respected.

The orchestrator never tried to solve tasks directly. The solvers never tried to submit answers. The `prohibited` and `api` frontmatter was honored. This separation of concerns meant the orchestrator could focus on session management while solvers focused on pattern discovery.

---

## 6. What the Programs Got Wrong

### 1. Solvers returned solved=true when validation failed (critical).

This is the most damaging failure. Both Child 0 and Child 2 returned `{solved: true, confidence: 1.0}` despite ALL training pairs being wrong:

**Child 0 output:**
```
Training pair 0: WRONG
Training pair 1: WRONG
Training pair 2: WRONG
Training pair 3: WRONG
All correct: false
```

Then the solver returned `{"solved":true,"confidence":1,"answer":[[9,9,2],...]}`. The contract explicitly requires:

> LEAVE-ONE-OUT VALIDATION before returning solved=true: If N >= 3 training pairs: for each pair i, apply the transform to pair i's input, check it produces pair i's output. If ANY prediction fails, the transform is overfitting -- set solved=false and keep iterating.

This contract was violated. The solver saw the validation fail, but rather than continuing to iterate (it had 16 remaining iterations), it gave up and returned a wrong answer as correct. The model's behavior suggests it exhausted its hypothesis space in the multi-block first iteration and saw no point in continuing -- but it should have returned `solved=false` so the orchestrator could handle it correctly.

**Impact:** The orchestrator submitted the wrong answer because it trusted `solved=true`. If the solver had returned `solved=false`, the orchestrator would have deferred to pass@2 without wasting a submission.

**Root cause:** The multi-code-block execution pattern. The solver crammed all its exploration into iteration 1 (13 code blocks), found the best-but-still-wrong hypothesis, and had no more ideas by iteration 2. Rather than returning honestly, it declared the best-effort answer as solved. The "one function per iteration" constraint, if enforced, would have paced exploration and left budget for refinement.

### 2. Library primitives were accumulated but never reused (structural waste).

9 primitives were stored across 5 solver invocations. 0 were called by a subsequent solver. The library primitives section of the solver plugin reads:

> CHECK LIBRARY FIRST: Before writing any exploration function from scratch, check if `__arcLibrary.primitives` has a relevant function.

This was printed but not followed. The model listed primitives in iteration 1 but never called them. The primitives were either too task-specific (find8Bbox, patternToMask) or had generic equivalents the model preferred to inline (gridsEqual).

**Why this happened:** The model's natural inclination is to write self-contained code. Calling a library function requires trusting that the function is correct and has the right interface. The model cannot inspect the function body (it sees only the name on `__arcLibrary.primitives`). Trust costs attention; inlining costs tokens but feels safer.

**Fix:** The library should store primitives with their source code visible (as a string alongside the function), or the solver should log the function body when listing primitives, so subsequent solvers can see what each primitive does and decide whether to call it.

### 3. Multi-code-block execution undermined iteration-based budgeting.

The program designed iteration budgets assuming one code block per iteration. In practice:

| Child | Iterations | Code Blocks | Blocks/Iter |
|-------|-----------|-------------|-------------|
| 0 | 2 | 17 | 8.5 |
| 1 | 3 | 27 | 9.0 |
| 2 | 5 | 27 | 5.4 |
| 3 | 5 | 38 | 7.6 |
| 4 | 4 | 20 | 5.0 |

The solver used 5-9x more code blocks than iterations. This is not inherently bad (the solver is doing useful work in each block), but it defeats the "one function per iteration" constraint that was supposed to ensure "steady, observable progress." When a solver runs 13 code blocks in one iteration, the orchestrator has no visibility into intermediate progress. If the solver stalls on a wrong hypothesis in block 7 of 13, there is no checkpoint mechanism to detect this.

### 4. The "one function per iteration" invariant was systematically violated.

The program states:

> ONE FUNCTION PER ITERATION: Solvers write one focused function (10-50 lines) per REPL iteration. No monolithic code blocks. This prevents finish=length truncation and ensures steady, observable progress.

Every solver violated this, every iteration. The model generated 3-13 code blocks per iteration. The invariant was aspirational, not enforced. The engine executes all code blocks in a response, so the only way to enforce this would be to modify the engine to stop after the first code block.

### 5. The solver gave up too early on task 0934a4d8.

Child 0 used only 2 of 18 iterations. It crammed 13 code blocks into iteration 1, found the 180-degree rotation hypothesis, tested it, found it was wrong, and gave up in iteration 2 with a wrong answer marked as solved.

A more disciplined solver would have:
1. Tested the hypothesis properly (iteration 1-2)
2. Found it failed (which it did)
3. Tried H-mirror, V-mirror, dual-axis symmetry (iterations 3-5)
4. Discovered the correct dual-axis symmetry at center 15.5 (which child 3 eventually found)
5. Verified and returned (iterations 6-7)

The solver had the budget for this. It gave up because it could not think of alternative hypotheses after exhausting its ideas in the first iteration. The multi-block execution pattern contributed by front-loading all exploration.

### 6. Off-by-one in symmetry center calculation (task 0934a4d8 retry).

Child 3 found the correct symmetry approach (dual-axis at 15.5) and matched all training pairs. But the test output had zeros because the symmetry center calculation was off by one. The solver mapped (r,c) -> (31-r, 31-c) instead of (29-r, 29-c). For a 30x30 grid (indices 0-29), the center of symmetry at axis 15.5 means the mirror of index r is (31-r) only in 1-indexed coordinates. In 0-indexed, it should be (29-r). The solver's LOO validation passed because the training 8-regions were interior (far from edges), but the test 8-region was at cols 0-2, where the off-by-one caused out-of-bounds access returning 0.

This is a classic edge case that LOO validation does not catch: the training data was "friendly" (interior 8-regions), the test data was "adversarial" (edge 8-region).

---

## 7. Alternative Architectures to Consider

### Alternative A: Single-Tier with Extended Budget

**Remove the orchestrator. Give the solver the entire iteration budget and the session loop.**

The orchestrator consumed code and iteration budget for session management, but its primary value-add was sanity checking and diagnostic retries. Both could be implemented within a single agent:

```
Single-Tier Design:
  Agent reads __arcTaskIds and iterates through all tasks
  For each task:
    Explores patterns (hypothesis-driven, just like current solver)
    Self-validates with LOO
    Runs sanity checks inline
    Submits if confident, defers if not
  After all tasks: retries failed tasks with what it learned
  Returns __arcSubmit.getResults()
```

**Advantages:**
- No delegation overhead (each `rlm()` call costs a full child invocation with its own message history)
- The agent retains its own message history across tasks, so learning from task 1 naturally informs task 2
- No library state serialization issues (the agent remembers its own code)
- Simpler program (one plugin instead of three files)

**Disadvantages:**
- Context window pressure: by task 3, the agent has a long message history from tasks 1-2
- No fresh perspective on retry: the same agent retrying a task may repeat mistakes
- Harder to tune: can't independently adjust orchestrator vs solver budgets

**Why this might work better:** The current 2-tier design's main overhead is the library curation, which was not used. The main benefit (sanity checking) can be self-applied. And the model already violated the one-function-per-iteration constraint, effectively acting as a single agent with a long reasoning chain. Making this explicit would align the program with the model's actual behavior.

### Alternative B: 2-Tier with Enforced Pacing and Honest Reporting

**Keep the 2-tier design but fix the three critical failures:**

1. **Engine-level single-block enforcement.** Modify the engine to execute only the first code block per iteration, discarding subsequent blocks. This forces the "one function per iteration" pacing, gives the orchestrator iteration-level visibility into solver progress, and prevents the solver from exhausting its hypothesis space in a single iteration.

2. **Conditional return enforcement.** Add a contract check in the solver's `return()` path: if the solver calls `return()` with `solved=true`, verify that the most recent LOO validation actually passed. This could be a simple post-return check in the orchestrator that compares `logEntry.solved` against the actual training pair results stored in the taskLog. If they disagree, override `solved` to `false`.

3. **Library with source code.** Store primitives as `{ fn: Function, source: string }` so subsequent solvers can inspect what each primitive does before deciding whether to call it.

```
Changes to program.md:
  - Add invariant: "Engine executes ONE code block per iteration (enforced)"
  - Add invariant: "Solver MUST set solved=false if ANY training pair validation fails"
  - Change Library.primitives from Function to { fn, source, verified }

Changes to arc2-solver.md:
  - Add: "Before returning solved=true, confirm ALL training pairs pass in THIS iteration"
  - Add: "When listing library primitives, print their source code"
  - Remove: "One function per iteration" (make this engine-enforced, not prompt-enforced)

Changes to arc2-orchestrator.md:
  - Add: "After reading solver result, re-run the solver's transform against training pairs as an independent check"
  - Add: "Pass strategy hints from library.strategies when structuralProps match"
```

**Why this is likely the better path:** The 2-tier architecture is sound. The problems were execution-level (multi-block bypass, dishonest reporting, unused library) not structural. Fixing these specific failures would likely improve the score without redesigning the architecture. The fresh-perspective benefit of delegation (a retry solver with a clean message history) was demonstrably valuable -- Child 4 succeeded where Child 2 failed on the same task.

### Budget Reallocation

Regardless of which alternative, the budget should be rebalanced:

- **Reduce solver budget from 18 to 10.** No solver used more than 5. Even with single-block enforcement, 10 iterations would be generous.
- **Increase orchestrator budget to match tasks.** With N tasks, the orchestrator needs at least 2*N + 2 iterations (setup, N tasks pass@1, transition, N_fail tasks pass@2, return). For 3 tasks: 10 iterations is fine. For 50+ tasks: the budget needs to be N-proportional.
- **Add a "give up early" mechanism.** If the solver has not formed a viable hypothesis by iteration 7 (of 10), it should return `solved=false` rather than trying increasingly desperate approaches that produce wrong answers declared as correct.

---

## Summary of Findings

| Aspect | Assessment |
|--------|-----------|
| 2-tier architecture | **Correct** for this benchmark. No evidence a 3rd tier would help. |
| Orchestrator value-add | **Moderate.** Sanity checking saved a submission. Library curation was wasted effort. |
| Solver hypothesis lifecycle | **Ignored.** The model explored code-first, not hypothesis-first. |
| Capability specs | **Ignored.** Never formally implemented with verify checks. |
| Strategy progression | **Loosely followed.** observe->test->finalize happened naturally but without explicit tracking. |
| Budget utilization | **Under-utilized** due to multi-block execution (2-5 of 18 iterations used). |
| "solved=true" reliability | **Broken.** Two solvers returned solved=true with all training pairs wrong. |
| Library reuse | **Zero.** 9 primitives stored, 0 called by subsequent solvers. |
| Diagnostic retries | **Effective.** 1/2 retries produced a correct answer. |
| Sanity checking | **Effective.** Caught 1 incorrect answer with invalid colors. |

**The single most impactful change would be enforcing honest `solved` reporting.** If Child 0 had returned `solved=false`, the orchestrator would not have wasted a submission on 0934a4d8, and the pass@2 retry (which found the correct approach) might have been submitted instead of sanity-rejected.

**The second most impactful change would be enforcing single-block-per-iteration execution** to pace the solver's exploration and prevent exhaustion of the hypothesis space in a single iteration.
