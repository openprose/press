# Code Patterns Analysis: ARC-2 Compound v1.2.0

**Run:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T15-38-19-801Z`
**Model:** Claude Opus 4.6
**Score:** 1/3 tasks correct (33%)
**Cost:** Not recorded (orchestrator maxIterations=10, solver maxIterations=18)
**Plugin version:** v1.2.0

## Run Summary

3 ARC-AGI-2 tasks solved in a compound session with a 2-tier delegation model (orchestrator + solver children). The orchestrator delegated each task to a child solver, curated the shared library, and managed submissions.

| Task | Pass@1 | Pass@2 | Final | Child Iters | Code Blocks |
|------|--------|--------|-------|-------------|-------------|
| 0934a4d8 | solved=true, **submitted wrong** | solved=false (honest), not submitted | **false** | 2 + 10 = 12 | 13 + 38 = 51 |
| 135a2760 | solved=true, **submitted wrong** | solved=true, **submitted wrong** | **false** | 3 + 4 = 7 | 23 + 21 = 44 |
| 136b0064 | solved=true, **submitted correct** | n/a | **true** | 5 | 22 |

**Regression from v1.1.0:** Score dropped from 2/3 (67%) to 1/3 (33%). Both tasks that succeeded in v1.1.0 (135a2760, 136b0064) were attempted again; only 136b0064 succeeded. The 0934a4d8 task failed in both versions.

---

## 1. Code-First Exploration

**Verdict: Code-first with significant reasoning-in-comments. Improved console.log usage vs v1.1.0, but comment reasoning remains the dominant hypothesis-formation mechanism.**

All five child solver invocations produced zero prose outside of code blocks (same as v1.1.0). Every piece of reasoning was embedded inside JavaScript code blocks as `//` comments or `console.log()` calls. The key question is: does the agent form hypotheses computationally (by observing data) or through comment-reasoning (by asserting patterns before testing)?

### Evidence by task:

**Child 0 (0934a4d8, pass@1, 2 iters):** The solver began with data printing -- grid contents, color analysis, diffs. It wrote 7 blocks in iter 0, progressively narrowing from data probing to diff analysis to non-zero cell grouping to hypothesis formation. The critical transition from observation to hypothesis happened in Block 4:

```javascript
// OK so let me analyze the pattern:
// Pair 0: 3 points of color 3 at [1,1],[1,7],[7,1]
//   Lines drawn: [1,1]->[1,7] is horizontal (same row), [1,1]->[7,1] is vertical (same col)
//   Changed cells fill in between these points
```

This is reasoning-in-comments, but it references concrete data from earlier blocks' output. The agent then wrote a `transform()` function to test the hypothesis and verified computationally. This is a hybrid pattern: the hypothesis is articulated in comments but informed by prior computational observation.

**Child 2 (136b0064, pass@1, 5 iters):** The strongest example of iterative refinement. Iter 0 explored grid structure computationally: column dividers, 3x3 block decomposition, mask fingerprinting. Iter 1 traced paths and correlated shapes with directions. Iter 2 contained 275 comment lines and only 10 code lines -- an extended manual trace of the path structure entirely in comments:

```javascript
// Pair 1 (2 blocks): Start at (0,3)
//   Seg 1: color 1, 3 cells, RIGHT (from (1,3) to (1,5))
//   Seg 2: color 6, 2 cells, DOWN (from (2,5) to (3,5))
```

This 338-line comment block was the solver reasoning through the mapping between shape masks and path segments manually. While it demonstrates deep understanding, it is invisible reasoning -- the agent cannot observe or course-correct on this work because comments produce no output.

**Child 3 (0934a4d8, retry, 10 iters):** The most computationally thorough exploration in the run. Each iteration explicitly referenced findings from prior iterations' output:

- Iter 2: "Key findings from offset analysis: Pair 0: rev-col offset (0, -22)..."
- Iter 3: "Debug the test input -- why does transform return null?"
- Iter 5: "The problem cells are at rows 14-17, cols 0-1"
- Iter 7: "Row 0 cols 0-1: 4 4. Row 2 cols 0-1: 3 4. Different."

This is the closest to true RLM behavior: each iteration reads prior output, identifies what went wrong, and writes targeted code to investigate further.

### Comment-line ratio:

| Child | Comment Lines | Code Lines | Comment % | console.logs |
|-------|-------------|------------|-----------|--------------|
| 0 (0934a4d8 p1) | 87 | 440 | 17% | 56 |
| 1 (135a2760 p1) | 268 | 885 | 23% | 152 |
| 2 (136b0064 p1) | 703 | 897 | 44% | 129 |
| 3 (0934a4d8 p2) | 552 | 1746 | 24% | 230 |
| 4 (135a2760 p2) | 246 | 1050 | 19% | 111 |
| **Total** | **1856** | **5018** | **27%** | **678** |

**Comparison to v1.1.0:** Overall comment percentage dropped from ~35% to 27%. The console.log count (678 across 24 iterations = 28.3 per iter) is substantially higher than v1.1.0 (not explicitly measured, but inferred lower from the analysis). This suggests the v1.2.0 plugin's "Write observations as `console.log()` calls, not `//` comments" instruction had a measurable effect.

**Assessment:** The agent is more code-first than v1.1.0. It uses `console.log()` more frequently for observable reasoning. However, hypothesis formation still happens predominantly in comments (especially in Child 2, iter 2). The improvement is incremental rather than transformative.

---

## 2. Observable Reasoning

**Verdict: Significantly improved console.log usage. But comments still dominate hypothesis articulation.**

678 `console.log()` calls across 24 iterations (28.3/iter average) represents a strong commitment to observable output. Every solver printed grid data, verification results, color analyses, and intermediate computations.

### Positive examples:

**Child 3 used console.log for symmetry axis search:**
```
V-axis at 15.5: 822/822 (100.0%)
H-axis at 15.5: 784/784 (perfect, has8=true)
```

**Child 1 used console.log for period detection:**
```
Panel 0 Row 2 period: 3, pattern: 3,3,4
Panel 1 Row 7 period: 2, pattern: 1,4
```

**Child 2 used console.log for mask fingerprinting:**
```
Block 0: left=2(shape:101/101/111,count=7) right=6(shape:101/010/010,count=4)
```

### Negative examples:

**Child 2 iter 2** contained 275 comment lines and 10 code lines. The entire iteration was spent reasoning about the path-to-shape mapping in comments. This is the single largest missed opportunity for observable reasoning in the run -- if this analysis had been done with code (e.g., programmatically tracing paths and printing segment-shape correlations), the agent would have caught errors and refined faster.

**Child 0 iter 0 Block 4** had 18 comment lines articulating the line-drawing hypothesis before testing it. The hypothesis itself ("draw straight lines between same-colored points") could have been discovered computationally by diff analysis + connected-path detection.

### Comment vs console.log usage by iteration:

The pattern is consistent: early iterations use more console.log (data probing), later iterations shift toward comments (hypothesis formation and implementation planning). This suggests the agent treats the REPL as a data exploration tool but falls back to comment-based reasoning when synthesizing insights.

---

## 3. Hypothesis Testing

**Verdict: Multi-block execution remains the dominant anti-pattern. Each "iteration" tests multiple hypotheses across 4-8 blocks rather than one focused hypothesis per REPL turn.**

### Blocks per iteration:

| Child | Iters | Total Blocks | Avg Blocks/Iter |
|-------|-------|-------------|-----------------|
| 0 | 2 | 13 | 6.5 |
| 1 | 3 | 23 | 7.7 |
| 2 | 5 | 22 | 4.4 |
| 3 | 10 | 38 | 3.8 |
| 4 | 4 | 21 | 5.2 |
| **Total** | **24** | **117** | **4.9** |

**Comparison to v1.1.0:** Average blocks per iteration dropped from 5.3 to 4.9 -- a marginal improvement. Child 3 (0934a4d8 retry, 3.8 blocks/iter) was the most disciplined, likely because it had 10 iterations to work with and thus less pressure to batch. The worst offender was Child 1 (135a2760, 7.7 blocks/iter), which crammed 11 blocks into a single iteration.

### Block sizes:

Notable large blocks (>100 lines):
- Child 1 iter 0: 105 lines (pattern analysis), 68 lines
- Child 1 iter 1: 85, 94 lines
- Child 1 iter 2: **136 lines** (full transform)
- Child 2 iter 0: 116 lines (transform attempt)
- Child 2 iter 1: 103, 105 lines
- Child 2 iter 2: **154, 184 lines** (almost entirely comments)
- Child 2 iter 3: 118, 146, 128 lines
- Child 3 iter 0: 99 lines
- Child 3 iter 1: 98, 126 lines
- Child 3 iter 3: 133 lines
- Child 3 iter 4: 135 lines
- Child 4 iter 1: 131, 132, 124, 100 lines
- Child 4 iter 2: 142, 112 lines

**Comparison to v1.1.0:** Block sizes are comparable. The v1.1.0 max was 166 lines; v1.2.0 max is 184 lines (though that was almost entirely comments). The plugin's "10-50 lines" target remains consistently violated, with many blocks exceeding 100 lines.

### Consequence: Verification-return violations

The multi-block pattern continues to cause the critical pathology where verification code and return code appear in the same iteration:

| Child | Violations | Return preceded by observed verification? |
|-------|-----------|------------------------------------------|
| 0 (0934a4d8 p1) | 2 (iters 0, 1) | No -- returned solved=true despite "All correct: false" |
| 1 (135a2760 p1) | 2 (iters 0, 2) | No -- returned solved=true despite "Training pair 1: WRONG" |
| 2 (136b0064 p1) | 1 (iter 4) | Partial -- verification was CORRECT, but still violated VERIFY-THEN-RETURN |
| 3 (0934a4d8 p2) | 2 (iters 0, 9) | Iter 0: No (returned despite failures). Iter 9: honest return (solved=false) |
| 4 (135a2760 p2) | 1 (iter 0) | No -- returned solved=true despite "All correct: false" |

**8 out of 8 VERIFY-THEN-RETURN violations** across the run. The only clean separation was Child 4 which verified in iters 1-2 and returned in iter 3, and Child 3 which verified in iters 2-4 but returned in iter 9 (though it still had a violation in iter 0).

**Key finding:** The v1.2.0 plugin added explicit VERIFY-THEN-RETURN instructions:
> "NEVER write verification code and return() in the same iteration."

This instruction was violated in every child's first attempt. Only after a failed first attempt (when the agent had to iterate further) did some solvers separate verification from return. This suggests the instruction is read but not internalized under time pressure -- the agent optimistically writes verification + return together, and only separates them when forced to try again.

---

## 4. Iterative Refinement

**Verdict: Dramatically improved for multi-iteration children. Children 2, 3, and 4 demonstrate genuine REPL-loop usage. Children 0 and 1 still batch everything.**

### Effective iterative refinement (positive examples):

**Child 3 (0934a4d8 retry, 10 iters):** The best example of iterative refinement in the run. Each iteration built on prior findings:

1. Iter 0: Data probing + multiple hypotheses (12 blocks -- too many, but diverse)
2. Iter 1: Focused on offset analysis and mirror region extraction (8 blocks)
3. Iter 2: Discovered symmetry axes at 15.5 -- breakthrough. All 4 training pairs correct.
4. Iter 3: Debugged test input -- found mirror positions out of bounds
5. Iter 4: Searched for additional symmetry axes to resolve OOB problem
6. Iter 5: Identified specific problem cells (rows 14-17, cols 0-1)
7. Iter 6: Analyzed within-8s-block symmetry relationships
8. Iter 7: Checked column relationships for fallback values
9. Iter 8: Analyzed test data directly for the problem cells
10. Iter 9: Honest return with solved=false (confidence=0.7)

This progression shows genuine read-output-then-decide behavior. The agent found the correct symmetry (iter 2), hit an edge case (iter 3), and spent 7 more iterations trying to resolve it. It ultimately returned honestly when it could not fully solve the edge case. This is exemplary RLM behavior.

**Child 4 (135a2760 retry, 4 iters):** Also demonstrated strong refinement:

1. Iter 0: Tried majority voting across panels -- WRONG
2. Iter 1: Pivoted to per-panel repeating pattern detection -- still WRONG (tile detection too greedy)
3. Iter 2: Fixed tile detection with frame-aware 2D tiling -- CORRECT
4. Iter 3: Verified and returned

Each iteration explicitly referenced why the previous approach failed and made a targeted correction.

**Child 2 (136b0064 p1, 5 iters):** Progressive narrowing from structure discovery to path tracing to implementation:

1. Iter 0: Structural exploration (column dividers, 3x3 blocks, mask fingerprinting)
2. Iter 1: Path tracing and shape-direction correlation
3. Iter 2: Extended comment-reasoning about the mapping (275 comment lines)
4. Iter 3: Implementation of transform, bug fixing, verification -- all CORRECT
5. Iter 4: LOO validation and return

### Ineffective iteration (negative examples):

**Child 0 (0934a4d8 p1, 2 iters):** Crammed everything into 2 iterations. Iter 0 had 7 blocks exploring data, testing a hypothesis, verifying (WRONG), and returning (solved=true) all in one turn. The agent never observed the verification failure. Iter 1 pivoted to a completely different hypothesis (180-degree rotation) but repeated the same pattern -- verify and return in the same turn despite "All correct: false."

**Child 1 (135a2760 p1, 3 iters):** Iter 0 had 11 blocks. The agent explored multiple hypotheses (3x3 blocks, mask overlays, minority color, majority vote) in a single turn, never observing intermediate results. Iter 1 made progress with period detection. Iter 2 tried to verify and return, but the verification showed "Training pair 1: WRONG" -- ignored.

### Comparison to v1.1.0:

v1.1.0 had 5 child invocations averaging 3.6 iterations per child (18 total). v1.2.0 has 5 child invocations averaging 4.8 iterations per child (24 total). The increase is primarily due to Child 3 using 10 iterations. The children that had more iterations (Child 2 with 5, Child 3 with 10, Child 4 with 4) demonstrated markedly better iterative refinement than those with fewer (Child 0 with 2, Child 1 with 3).

**Conclusion:** The quality of iterative refinement is proportional to the number of iterations used. 2-3 iteration children batch everything. 4-10 iteration children show genuine observe-and-react behavior. This is a structural issue: children that attempt to solve the task in minimal iterations are forced into multi-block batching.

---

## 5. Computational Techniques

### Techniques used per child:

| Technique | Child 0 | Child 1 | Child 2 | Child 3 | Child 4 |
|-----------|:-------:|:-------:|:-------:|:-------:|:-------:|
| Diffs/deltas | yes | yes | yes | yes | yes |
| Histograms | - | yes | yes | - | - |
| Color set ops | yes | yes | yes | yes | yes |
| Symmetry tests | yes | - | - | yes | - |
| Coordinate transforms | - | - | yes | yes | - |
| Connected components | yes | - | yes | yes | yes |
| Tiling/periodicity | yes | yes | yes | yes | yes |
| Masking/overlay | yes | yes | yes | yes | - |
| Line drawing | yes | - | - | - | - |
| Shape fingerprinting | - | - | yes | - | - |
| Path tracing | - | - | yes | - | - |

### Notable computational approaches:

**Child 0: Line drawing via Bresenham-like stepping.** The solver discovered that the transformation draws straight lines between same-colored points. It wrote a `drawLinesBetweenPoints` function using step direction calculation:
```javascript
const steps = Math.max(Math.abs(dr), Math.abs(dc));
const stepR = dr / steps, stepC = dc / steps;
```
This was correct for the task and stored as a library primitive.

**Child 2: Mask fingerprinting.** The solver converted 3x3 blocks to binary mask strings (e.g., "101/101/111") and used these to categorize instruction blocks. This is an effective computational approach for ARC tasks with structured sub-regions.

**Child 3: Exhaustive symmetry axis search.** The solver tested all possible vertical and horizontal reflection axes and found axis 15.5 gives 100% match:
```
V-axis at 15.5: 822/822 (100.0%)
H-axis at 15.5: 784/784 (perfect, has8=true)
```
It then attempted iterative filling using dual axes, which worked for training pairs but failed on the test input due to out-of-bounds mirror positions.

**Child 4: Bordered-panel detection with 2D tiling.** The solver identified the grid structure (horizontal and vertical borders creating panels), extracted panel content, and applied 2D repeating-pattern detection. This was an iterative refinement of the approach tried in Child 1, which used per-row period detection instead.

### Comparison to v1.1.0:

- **Diffs** are now universally used (5/5 children vs partial in v1.1.0). This is a clear improvement.
- **Mask fingerprinting** is new in v1.2.0 (used by Child 2 for the 136b0064 task).
- **Line drawing** is new (Child 0 solved a different task from v1.1.0's first child).
- **Conditional rules** remain unexplored (0/5 children).
- **Connected components** are used by 4/5 children, up from 3/5 in v1.1.0.

---

## 6. Library Primitive Usage

### Primitive storage:

| Child | Primitives Stored |
|-------|------------------|
| 0 (0934a4d8 p1) | `drawLinesBetweenPoints`, `gridsEqual` |
| 1 (135a2760 p1) | `detectAndFixRepeatingPattern` |
| 2 (136b0064 p1) | (none stored) |
| 3 (0934a4d8 p2) | (none stored) |
| 4 (135a2760 p2) | (none stored) |

**Comparison to v1.1.0:** Fewer primitives stored (3 in v1.2.0 vs 5 in v1.1.0). Children 2, 3, and 4 did not store primitives despite writing reusable functions. Child 2's mask fingerprinting functions and Child 4's 2D tiling functions would have been good candidates for storage.

### Primitive reuse:

- **`gridsEqual`**: Stored by Child 0, reused by Child 3 (via `library.primitives.gridsEqual.fn()` for mirror matching). Cross-task reuse confirmed.
- **`detectAndFixRepeatingPattern`**: Stored by Child 1, referenced by Child 3 (used for row-based period detection on 0934a4d8). Cross-task reuse confirmed.
- **`drawLinesBetweenPoints`**: Stored by Child 0, never reused (task-specific pattern).

### Library check compliance:

| Child | Checked library in iter 0? |
|-------|---------------------------|
| 0 | No (library was empty) |
| 1 | Yes |
| 2 | Yes |
| 3 | No (printed count but not doc strings) |
| 4 | No |

Only 2/5 children fully checked available primitives with doc strings. Child 3 printed "Library: 3 primitives, 1 strategies" but did not print doc strings, which limits discoverability. Child 4 (the retry for 135a2760) did not check primitives at all despite being instructed to "Compose existing primitives where possible."

**Comparison to v1.1.0:** All 5 children checked primitives in v1.1.0 (100%). Only 2/5 fully checked in v1.2.0 (40%). This is a regression, possibly because the retry children received the diagnostic prompt which may have overridden the standard first-iteration protocol.

---

## 7. RLM-ness Score

### Rating: 6.5/10 (up from 6/10 in v1.1.0)

**Justification:**

The half-point improvement reflects measurable but modest gains in two areas:

**Improvements from v1.1.0:**

1. **More console.log usage (+0.5):** 678 console.log calls across 24 iterations (28.3/iter) vs an estimated ~20/iter in v1.1.0. The agent uses observable output more frequently, particularly for quantitative metrics (symmetry match percentages, period detection results, tile error counts). The v1.2.0 plugin's explicit instruction to use console.log over comments had a measurable effect (comment percentage dropped from 35% to 27%).

2. **One genuinely iterative child (+0.5):** Child 3 (10 iterations) is the best example of RLM behavior seen in either run. It found the correct symmetry, hit an edge case, spent 7 iterations investigating the edge case through targeted code, and returned honestly. This is write-code/observe/adapt at its finest. Child 4 also showed strong iterative refinement over 4 iterations.

3. **Honest failure reporting (+0.5):** Child 3 returned solved=false with confidence=0.7, acknowledging it could not fully solve the test input. This is better than v1.1.0 where similar situations produced false positives.

**Persistent problems (unchanged from v1.1.0):**

1. **Multi-block execution (4.9 blocks/iter, -1.5):** Still the root pathology. The agent writes 5-8 blocks per iteration, meaning it cannot observe intermediate results. This directly causes the verification-return violation, TypeErrors from referencing unexecuted code, and hallucinated success claims.

2. **Verification ignored (8/8 violations, -1.5):** Every child violated VERIFY-THEN-RETURN at least once. The v1.2.0 plugin added an explicit "NEVER write verification code and return() in the same iteration" contract, but this was universally violated in first attempts. The instruction is only followed after the agent has already failed and been forced to iterate further.

3. **Comment reasoning for hypotheses (-0.5):** Hypotheses are still formed in comments rather than discovered through computational observation. The 275-comment-line iteration in Child 2 is the most extreme example -- an entire iteration of invisible reasoning. A true RLM would write code to trace paths and print segment-shape correlations, observing the results rather than reasoning about them in comments.

**New problem in v1.2.0:**

4. **Orchestrator shape violation (-0.5):** The orchestrator attempted to solve task 0934a4d8 directly in iter 1, writing symmetry analysis code and attempting a submission. This violates the program's shape constraint ("You do NOT solve tasks yourself"). v1.1.0 had a similar violation. The v1.2.0 orchestrator plugin explicitly says "Do not use surplus iterations to solve tasks yourself," but the agent ignored this after retries were complete and iterations remained.

---

## 8. Comparison to v1.1.0

### What improved:

| Dimension | v1.1.0 | v1.2.0 | Change |
|-----------|--------|--------|--------|
| Comment % | 35% | 27% | Better (more code, less invisible reasoning) |
| console.logs/iter | ~20 est. | 28.3 | Better (more observable output) |
| Blocks/iter | 5.3 | 4.9 | Marginally better |
| Honest failure returns | 0/5 | 1/5 (Child 3) | Better |
| Cross-task primitive reuse | gridsEqual only | gridsEqual + detectAndFixRepeatingPattern | Better |
| Iterative refinement | Weak (3.6 iters avg) | Mixed (4.8 iters avg, Child 3 excellent) | Better for long children |

### What regressed:

| Dimension | v1.1.0 | v1.2.0 | Change |
|-----------|--------|--------|--------|
| Score | 2/3 (67%) | 1/3 (33%) | Worse |
| Library check compliance | 5/5 (100%) | 2/5 (40%) | Worse |
| Primitives stored | 5 | 3 | Worse |
| Verify-then-return violations | 3/5 | 8/8 | Worse (more attempts measured) |
| Orchestrator shape violation | 1 (iter 1-2) | 1 (iter 1) | Same |

### Root cause of score regression:

The score regression from 2/3 to 1/3 is NOT primarily a code-patterns issue. The key differences:

1. **Task 0934a4d8 (failed in both):** The dual-axis symmetry problem with edge cases is intrinsically hard. Child 3's 10-iteration exploration in v1.2.0 was actually more thorough than v1.1.0's attempts, but still could not resolve the out-of-bounds mirror positions. The pass@2 solver in v1.2.0 returned honestly (solved=false), which is better behavior than v1.1.0's false positive -- but the task remains unsolved.

2. **Task 135a2760 (regressed: correct in v1.1.0, wrong in v1.2.0):** The v1.1.0 solver discovered 2D tiling with `find2DPeriodStrict` and `extractTile` + `repairContent` -- three dedicated functions. The v1.2.0 solvers (Children 1 and 4) used simpler period detection (per-row 1D majority voting and per-panel 2D tiling respectively). Child 1's approach failed because it did not handle the bordered panel structure correctly. Child 4's approach was closer but still produced errors on the second training pair.

3. **Task 136b0064 (succeeded in both):** The mask-fingerprinting + path-tracing approach worked in both versions. Child 2's 5-iteration exploration was more structured than v1.1.0's approach.

The regression is stochastic -- the same model and plugin version can produce different exploration trajectories on different runs. The code-patterns improvements (more console.log, better iterative refinement) are real but were not sufficient to overcome the specific failure modes on these tasks.

---

## 9. Recommendations

### R1: Engine-level single-block enforcement (CARRIED FROM v1.1.0)

The multi-block pathology remains the #1 issue. 4.9 blocks per iteration means the agent writes ~5 code blocks before seeing any output. This directly causes verification-return violations and hallucinated success claims.

**Recommendation:** The engine should execute only the first code block per iteration. Subsequent blocks should be discarded with a message:
```
[engine] Only the first code block per iteration is executed.
Write one block, observe its output, then decide what to write next.
```

This would force 1 block per iteration, converting the current 24 iterations x 4.9 blocks = ~117 blocks into ~117 actual REPL turns (or fewer, since the agent would adapt).

### R2: Verification gate in the engine (CARRIED FROM v1.1.0)

8/8 verification-return violations despite an explicit "NEVER" instruction in the contract shows this cannot be solved with prompt engineering alone. The engine should detect when `return()` is called in the same block as `gridsEqual()` or verification-related output, and intercept:

```
[engine] Verification output detected in the same iteration as return().
Your verification output was: "Training pair 1: WRONG"
Fix your transform before returning solved=true.
```

### R3: Strengthen library check in retry prompts (NEW)

Library check compliance dropped from 100% to 40%. The retry prompt says "Compose existing primitives where possible" but does not explicitly instruct the solver to list and inspect available primitives. The retry prompt should include:

```
FIRST: List all available primitives by calling:
  Object.entries(library.primitives).forEach(([name, p]) =>
    console.log(`${name}: ${p.doc}`));
THEN: Compose these into your solution before writing new code.
```

### R4: Penalize comment-only iterations (NEW)

Child 2's iter 2 (275 comments, 10 code lines) is pure invisible reasoning. The plugin should discourage this:

```
invariant: Every iteration must produce observable output via console.log().
  If you need to reason about the pattern, write code to TEST your reasoning
  and print the results. Comments are invisible to you. Only console.log()
  output feeds your next iteration.
```

### R5: Budget-based block discipline (NEW)

Children with more iterations (Child 3: 10 iters, 3.8 blocks/iter) are more disciplined than those with fewer (Child 1: 3 iters, 7.7 blocks/iter). This suggests the agent batches more when it perceives limited budget. The plugin could address this:

```
invariant: NEVER write more than 2 code blocks per iteration.
  If you have 18 iterations, you have 18 chances to observe and adapt.
  Using them wisely (1 block per iter) is ALWAYS better than batching
  (many blocks per iter) because batching prevents observation.
```

### R6: Orchestrator shape enforcement (CARRIED FROM v1.1.0)

The orchestrator violated its shape constraint by solving task 0934a4d8 directly in iter 1. The v1.2.0 plugin already says "Do not use surplus iterations to solve tasks yourself" but this was ignored. Consider adding `__arcTasks` to the orchestrator's `prohibited` list, or implementing a detection mechanism that warns when the orchestrator accesses task grid data directly.
