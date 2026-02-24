# ARC-2 Compound v1.2 -- State Management & Knowledge Accumulation Analysis

**Run:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T15-38-19-801Z.json`
**Score:** 1/3 (33.3%)
**Model:** Claude Opus 4.6
**Config:** maxIterations=10 (root), maxDepth=2, maxIterations=18 (solvers)
**Tasks:** 0934a4d8 (failed), 135a2760 (failed), 136b0064 (correct)

---

## 1. Library Primitives: Format & Discoverability

### Were primitives stored with the new `{fn, source, doc}` format?

**Yes, fully compliant.** All three primitives stored in this run used the `{fn, source, doc}` triple as specified by the program.

#### Child 0 (task 0934a4d8, pass@1) stored 2 primitives:

```javascript
globalThis.__arcLibrary.primitives.drawLinesBetweenPoints = {
  fn: drawLinesBetweenPoints,
  source: drawLinesBetweenPoints.toString(),
  doc: "drawLinesBetweenPoints(grid) -> grid. Draws straight lines (horizontal, vertical, or 45-degree diagonal) between all pairs of same-colored non-zero cells.",
};

globalThis.__arcLibrary.primitives.gridsEqual = {
  fn: gridsEqual,
  source: gridsEqual.toString(),
  doc: "gridsEqual(a, b) -> boolean. Compares two grids cell-by-cell, returns true iff dimensions match and every cell is identical.",
};
```

#### Child 1 (task 135a2760, pass@1) stored 1 primitive:

```javascript
globalThis.__arcLibrary.primitives.detectAndFixRepeatingPattern = {
  fn: detectAndFixRowFn,
  source: detectAndFixRowFn.toString(),
  doc: "detectAndFixRepeatingPattern(content: number[]) -> {fixed, period, pattern, errors}. Detects the repeating pattern in a 1D array by trying all periods and using majority voting, then returns the fixed array."
};
```

**Doc strings were provided for all 3 primitives.** Each doc string includes the function signature, input types, return type, and a one-line description.

### Were primitives discoverable?

**Yes.** The solver plugin instructs children to print available primitives in iteration 1, and this happened correctly. Children 1 and 2 both printed the available primitives with doc strings:

- **Child 1** (task 135a2760) saw: `drawLinesBetweenPoints: ...`, `gridsEqual: ...`
- **Child 2** (task 136b0064) saw: `drawLinesBetweenPoints: ...`, `gridsEqual: ...`, `detectAndFixRepeatingPattern: ...`

**Improvement over v1.1.0:** In v1.1.0, primitives were stored as bare functions without `source` or `doc`. This made them undiscoverable -- children could only see function names, not what they did. In v1.2.0, all primitives have doc strings, and the solver plugin prints them. This is a structural improvement even though reuse did not happen (see section 2).

### Primitive quality assessment

| Primitive | Stored by | General-purpose? | Doc provided? |
|----------|----------|-------------------|---------------|
| `drawLinesBetweenPoints` | Child 0 (0934a4d8) | Yes -- draws lines between same-colored points in any grid | Yes |
| `gridsEqual` | Child 0 (0934a4d8) | Yes -- generic grid comparison | Yes |
| `detectAndFixRepeatingPattern` | Child 1 (135a2760) | Somewhat -- 1D pattern detection via majority voting | Yes |

**Improvement over v1.1.0:** v1.1.0 had 9 primitives, of which 5 were task-specific (`find8Bbox`, `patternToMask`, `maskToString`, `fillPeriodicHole`, `solveSymmetricHole`). v1.2.0 has only 3 primitives, and all are at least somewhat general-purpose. No task-specific solver functions were stored. The `drawLinesBetweenPoints` primitive is genuinely reusable. This is a significant quality improvement.

**Regression:** Fewer primitives overall (3 vs 9). Only 1 task (136b0064) stored no new primitives at all, and retries stored none. The primitive library is leaner but smaller.

---

## 2. Cross-Task Knowledge Transfer

### Did primitives created for task 1 get reused in tasks 2 or 3?

**No cross-task reuse on pass@1.** Identical to v1.1.0.

| Child | Task | Primitives Available | Primitives Called | Local Rewrites |
|-------|------|---------------------|-------------------|----------------|
| 0 | 0934a4d8 (pass@1) | 0 | -- | gridsEqual (local) |
| 1 | 135a2760 (pass@1) | 2 (drawLinesBetweenPoints, gridsEqual) | **NONE** | gridsEqual (local) |
| 2 | 136b0064 (pass@1) | 3 (+ detectAndFixRepeatingPattern) | **NONE** | gridsEqual (local) |
| 3 | 0934a4d8 (retry) | 3 | **gridsEqual.fn -- 4 calls** | -- |
| 4 | 135a2760 (retry) | 3 | **NONE** | gridsEqual (local) |

**Key finding:** The ONLY cross-task primitive call was `library.primitives.gridsEqual.fn()` by Child 3 (0934a4d8 retry). However, `gridsEqual` was stored by Child 0 for the **same task** (0934a4d8 pass@1). This is same-task reuse, not cross-task reuse.

Children 1, 2, and 4 all listed available primitives but rewrote `gridsEqual` locally instead of calling `library.primitives.gridsEqual.fn()`. The solver plugin says "CHECK LIBRARY FIRST" but the model consistently prefers writing from scratch.

**Comparison to v1.1.0:** Identical failure. Cross-task primitive reuse was 0% in v1.1.0 and remains 0% in v1.2.0. Same-task reuse improved slightly (Child 3 used `gridsEqual` from the library instead of redefining it).

### Retry prompt primitive listings

The orchestrator's retry prompts included primitive listings with doc strings:

```
Available library primitives:
  drawLinesBetweenPoints: drawLinesBetweenPoints(grid) -> grid. Draws straight lines...
  gridsEqual: gridsEqual(a, b) -> boolean. Compares two grids cell-by-cell...
  detectAndFixRepeatingPattern: detectAndFixRepeatingPattern(content: number[]) -> ...
Compose existing primitives where possible -- do not rewrite from scratch.
```

Despite this explicit instruction, only Child 3 (0934a4d8 retry) called a library primitive. Child 4 (135a2760 retry) ignored the listing entirely.

---

## 3. Strategy Accumulation

### Were strategies promoted only on correct submissions?

**Yes -- this is a major improvement over v1.1.0.**

The orchestrator recorded exactly 1 strategy, and it corresponds to the only correct submission:

| Submission | Task | Correct? | Strategy Promoted? |
|-----------|------|----------|--------------------|
| 0934a4d8 pass@1 | "Grid has 180-degree rotational symmetry..." | No | No (anti-pattern recorded) |
| 135a2760 pass@1 | "Grid contains bordered panels..." | No | No (anti-pattern recorded) |
| 136b0064 pass@1 | "Snake path drawing..." | **Yes** | **Yes** |
| 135a2760 retry | "Grid has bordered panels..." (variant) | No | No |

**Final strategy library:** 1 strategy (136b0064's approach, structuralHints: `{sameSize: false, colorCount: 7, hasBackground: true}`).

**Comparison to v1.1.0:** v1.1.0 had 4 strategies, of which only 1 was correct. The orchestrator in v1.1.0 promoted strategies based on `logEntry.solved === true` (solver self-report), not `result.correct === true` (ground truth). This was one of the primary findings of the v1.1.0 analysis. v1.2.0 fixes this completely -- strategy promotion is now gated on `result.correct === true` from `__arcSubmit.submit()`.

### Were wrong strategies recorded?

**No.** Only the correct submission's approach was promoted. This is correct behavior.

---

## 4. Anti-Pattern Recording

### Were anti-patterns recorded based on submission correctness?

**Yes -- 2 anti-patterns recorded, both from wrong submissions.**

The orchestrator's code records anti-patterns when `result.correct === false`:

```javascript
library.antiPatterns.push(`${logEntry.approach} failed on ${taskId}: submitted but WRONG`);
```

| Event | Anti-pattern recorded? |
|-------|----------------------|
| 0934a4d8 pass@1: submitted, wrong | **Yes** |
| 135a2760 pass@1: submitted, wrong | **Yes** |
| 136b0064 pass@1: submitted, correct | No (correct -- no anti-pattern needed) |
| 0934a4d8 retry: solver returned solved=false | Not submitted, no anti-pattern needed |
| 135a2760 retry: submitted, wrong | Should have been recorded -- **unclear if it triggered** |

**Library state at end of pass@1:** 2 anti-patterns.
**Library state at end of session:** Still printed as "3 primitives, 1 strategies" without anti-pattern count in the final summary. The retry for 135a2760 was submitted and was wrong, so a 3rd anti-pattern should have been recorded. The code for pass@2 includes the recording logic (`library.antiPatterns.push(...)` in root code block 5/6).

**Comparison to v1.1.0:** v1.1.0 recorded **0 anti-patterns** because the recording was gated on `logEntry.solved === false`, and all solvers claimed `solved: true` even when wrong. v1.2.0 fixes this by gating on `result.correct === false` from the submission API. Going from 0 to 2 (or 3) anti-patterns is a complete reversal.

**Improvement:** Anti-pattern recording now works as designed. This is one of the most significant improvements from v1.1.0 to v1.2.0.

---

## 5. TaskLog Entries

### Did each solver write exactly ONE taskLog entry at the END of its run?

**No. 4 out of 5 solvers pushed 2 entries. Only Child 2 (136b0064 pass@1) pushed exactly 1.**

| Child | Task | taskLog pushes | Contract compliance |
|-------|------|----------------|---------------------|
| 0 | 0934a4d8 (pass@1) | 2 | VIOLATED |
| 1 | 135a2760 (pass@1) | 2 | VIOLATED |
| 2 | 136b0064 (pass@1) | **1** | COMPLIANT |
| 3 | 0934a4d8 (retry) | 2 | VIOLATED |
| 4 | 135a2760 (retry) | 2 | VIOLATED |

**Root cause: multi-block execution.** Solvers running 7-12 code blocks per iteration tried multiple hypotheses within a single iteration. When the first hypothesis failed, they pushed a taskLog entry, then tried a different approach and pushed another. The contract says "Write EXACTLY ONE taskLog entry, at the END of your run" but multi-block execution enables mid-run pushes.

**Example (Child 0, 0934a4d8 pass@1):**
- Code block 6 (iter 0): pushed entry with approach "Draw straight lines..." (first hypothesis, which actually passed training but was the wrong approach for this task structure)
- Code block 12 (iter 1): pushed entry with approach "Grid has 180-degree rotational symmetry..." (second hypothesis)

The orchestrator uses `library.taskLog.filter(e => e.id === taskId).pop()` to read the LAST entry, so the duplicate entries don't cause data corruption. But the taskLog accumulates redundant entries.

**Comparison to v1.1.0:** v1.1.0 had the same problem -- Child 3 (0934a4d8 retry) pushed 3 entries for one solver run. v1.2.0 shows the same pattern. The multi-block execution issue was not addressed.

### Were entries honest about solved status?

**Mixed -- improved but not perfect.**

| Child | Claim | Truth | Honest? |
|-------|-------|-------|---------|
| 0 (0934a4d8 p1) | solved=true, conf=1.0 | **WRONG** (submitted, incorrect) | No |
| 1 (135a2760 p1) | solved=true, conf=1.0 | **WRONG** (submitted, incorrect) | No |
| 2 (136b0064 p1) | solved=true, conf=1.0 | **CORRECT** | Yes |
| 3 (0934a4d8 retry) | **solved=false, conf=0.7** | Passed training but had 8 remaining 8s | **Yes** |
| 4 (135a2760 retry) | solved=true, conf=1.0 | **WRONG** (submitted, incorrect) | No |

**Child 3 is the honesty standout.** It passed all 4 training pairs (CORRECT) and LOO validation (PASS), but detected that the test output still contained 8 unresolved color-8 cells. It correctly returned `solved=false, confidence=0.7` with the imperfect answer included. This is precisely the behavior the program spec demands: "If ANY of these fail: solved=false, confidence=0, answer=null." Child 3 deviated slightly by providing confidence=0.7 and including the answer (rather than null), but the directional honesty is correct.

**Children 0, 1, and 4 were dishonest.** They claimed `solved=true, confidence=1.0` after passing training pair verification, but the training pair verification passed spuriously -- the transform was wrong for the actual task. This is the fundamental challenge: passing training pairs does not guarantee correctness on the test input.

**Comparison to v1.1.0:** v1.1.0 had all 7 entries claiming `solved=true, confidence=1.0`, even when wrong. v1.2.0 has 1 out of 5 children (Child 3) honestly reporting `solved=false`. This is marginal improvement.

---

## 6. Knowledge Quality

### Was knowledge concise or bloated?

**Concise.** The final library has only 3 primitives, 1 strategy, and 2 anti-patterns. This is a 3x reduction from v1.1.0's 9 primitives and 4 strategies.

### Was it duplicated?

**TaskLog was duplicated.** The taskLog accumulated 9 entries across 5 delegations plus 2 orchestrator crash-handler entries (if any). With 4 of 5 children pushing 2 entries each, the taskLog has approximately 9 entries for 3 tasks (~3x the expected 1 entry per task per delegation).

**Primitives were NOT duplicated.** Each primitive was stored once under a unique name. `gridsEqual` was checked with `if (!globalThis.__arcLibrary.primitives.gridsEqual)` before being stored a second time.

**Strategies were NOT duplicated.** Only 1 strategy was recorded (correctly).

### Did it stagnate?

**The library grew during pass@1 and stagnated during pass@2.**

| After | Primitives | Strategies | Anti-Patterns |
|-------|-----------|-----------|---------------|
| Initial | 0 | 0 | 0 |
| Task 1 (0934a4d8 p1) | 2 | 0 | 1 |
| Task 2 (135a2760 p1) | 3 | 0 | 2 |
| Task 3 (136b0064 p1) | 3 | 1 | 2 |
| Retry 1 (0934a4d8 p2) | 3 | 1 | 2 |
| Retry 2 (135a2760 p2) | 3 | 1 | 2+ |

Pass@2 added no primitives. This is partially expected (retries should reuse, not create), but the absence of new primitives also means the retry solver didn't discover any new reusable tools.

### StructuralHints quality

**Improved.** All structuralProps were populated with literal values:

```javascript
structuralProps: {
  sameSize: true,
  inputDims: [train[0].input.length, train[0].input[0].length],
  outputDims: [train[0].output.length, train[0].output[0].length],
  colorCount: new Set(train[0].input.flat().concat(train[0].output.flat())).size,
  hasBackground: train[0].input.flat().filter(c => c === 0).length > train[0].input.flat().length * 0.5,
}
```

The `colorCount` and `hasBackground` fields use runtime expressions that evaluate to numbers at write time (because they reference `train[0]` which is in scope). This is an improvement over v1.1.0 where some entries stored expressions referencing out-of-scope variables like `testOutput`.

---

## 7. Sanity Checks

### Did the orchestrator perform dimension, color, and non-triviality checks before submission?

**Partially. The dimension check (check a) was entirely omitted.**

The program spec mandates three sanity checks:
```
(a) output dimensions consistent with training pair pattern
(b) output color set is subset of colors seen in training outputs
(c) output is not trivially degenerate (all-zeros, all-same-color, all-background)
```

The orchestrator implemented:
- **(a) Dimension consistency: MISSING.** The code has no dimension check at all. This is a significant omission. For task 0934a4d8, the training outputs range from 9x4 to 4x4, and the test output is 9x3. A dimension check might have caught anomalies (though 0934a4d8's variable output dimensions make this check harder).
- **(b) Color set check: MODIFIED (weaker).** The orchestrator expanded the check to include BOTH input and output colors: `for (const p of task.train) for (const row of p.input) for (const c of row) trainColors.add(c)`. The plugin spec says "output color set is subset of colors seen in **training outputs**". Including input colors weakens the check by allowing colors that appear in inputs but not outputs.
- **(c) Non-triviality: PRESENT.** `if (answerColors.size <= 1)` correctly checks for degenerate output.

**No sanity check failures were triggered.** All three pass@1 submissions passed the (weakened) sanity checks and were submitted. The two wrong submissions (0934a4d8 and 135a2760) would not have been caught even with correct checks, because their answers had plausible colors and multiple distinct values.

**Comparison to v1.1.0:** v1.1.0 had all three checks (a), (b), (c) present. v1.2.0 dropped check (a) entirely. This is a regression.

---

## 8. Orchestrator Execution Pattern

### Multi-block execution

The orchestrator ran **all 3 pass@1 tasks, the pass@2 transition, 2 retries, and the return** in a single root iteration (iteration 0) containing 8 code blocks. The second root iteration was just confirming the return.

This is a departure from the plugin's instruction: "Each iteration processes exactly ONE task." The orchestrator batched everything. However, this did not cause bugs -- the session state was correctly maintained through `globalThis.__arcSession`, and each code block correctly advanced the session index.

**Root iteration breakdown:**
- Block 0: Setup (inspect tasks, initialize session)
- Block 1: Task 1 (0934a4d8) -- delegate + submit + curate
- Block 2: Task 2 (135a2760) -- delegate + submit + curate
- Block 3: Task 3 (136b0064) -- delegate + submit + curate
- Block 4: Pass@2 transition
- Block 5: Retry 1 (0934a4d8) -- delegate + evaluate
- Block 6: Retry 2 (135a2760) + return attempt
- Block 7: Final return

**Root iteration 1:** Confirmed the return value.

**Comparison to v1.1.0:** v1.1.0 used multiple root iterations (one per task). v1.2.0 collapsed everything into 1 root iteration via multi-block execution. This is more efficient (2 vs ~10 root iterations used) but violates the "one task per iteration" instruction.

### Orchestrator shape compliance

**The orchestrator did NOT solve tasks directly.** All 5 task attempts were delegated to `rlm()` with `app: "arc2-solver"`. This is an improvement over v1.1.0, where the orchestrator spent a full iteration trying to solve 0934a4d8 directly.

---

## 9. Comparison to v1.1.0

### What improved:

| Metric | v1.1.0 | v1.2.0 | Assessment |
|--------|--------|--------|------------|
| Anti-patterns recorded | **0** | **2** | Fixed. Ground-truth gating works. |
| Strategies reliable | 1/4 (25%) | **1/1 (100%)** | Fixed. Only correct submissions promoted. |
| Primitives with doc strings | 0/9 | **3/3 (100%)** | Fixed. All use `{fn, source, doc}`. |
| Primitives general-purpose | 1/9 (11%) | **3/3 (100%)** | Fixed. No task-specific functions stored. |
| Orchestrator shape violations | 1 (solved directly) | **0** | Fixed. All tasks delegated. |
| Honest solved=false reporting | 0/7 entries | **1/5 children** | Improved. Child 3 was honest. |

### What regressed:

| Metric | v1.1.0 | v1.2.0 | Assessment |
|--------|--------|--------|------------|
| Score | **2/3 (67%)** | **1/3 (33%)** | Regressed. Only 136b0064 correct. |
| Dimension sanity check | Present | **MISSING** | Regressed. Check (a) dropped. |
| Color sanity check | Output-only (correct) | **Input+output (weaker)** | Regressed. Check weakened. |
| Cross-task primitive reuse | 0% | **0%** | Unchanged. Still not happening. |
| TaskLog entries per delegation | 1.4 avg | **1.8 avg** | Slightly worse. Multi-block pushes. |

### What stayed the same:

| Metric | v1.1.0 | v1.2.0 |
|--------|--------|--------|
| Cross-task primitive reuse | 0 calls | 0 calls |
| Same-task primitive reuse | 16+ calls (0934a4d8 retry) | 4 calls (0934a4d8 retry) |
| gridsEqual redefined locally | 3 children | 4 children |
| Library growth monotonic | Yes | Yes |
| Sandbox state flow | Reliable | Reliable |

---

## 10. Key Findings

### The compound learning loop works mechanically but not epistemically.

The state management infrastructure is solid: `globalThis` pass-by-reference works, primitives persist across delegations, the orchestrator correctly reads solver results, and curation logic correctly gates on ground truth. v1.2.0 fixed the two critical bugs from v1.1.0: anti-pattern recording and strategy promotion. These are genuine improvements to the knowledge curation pipeline.

However, **the knowledge does not actually transfer**. Children list available primitives but do not call them. The retry prompt says "compose existing primitives" but solvers write from scratch. The 0% cross-task reuse rate is unchanged from v1.1.0.

### Score regression is task-dependent, not system-dependent.

v1.1.0 scored 2/3 (0934a4d8 failed, 135a2760 correct, 136b0064 correct on retry). v1.2.0 scored 1/3 (0934a4d8 failed, 135a2760 failed, 136b0064 correct on pass@1). The 135a2760 regression is due to the solver finding a different (wrong) approach in v1.2.0, not due to a system-level change. On only 3 tasks, single-task variance dominates.

### Dimension sanity check regression needs fixing.

The orchestrator dropped the dimension consistency check entirely. While this specific check would not have changed the outcome for these tasks, it is a defense-in-depth gate that should be restored.

### Multi-block execution is a double-edged sword.

It enables solvers to test multiple hypotheses within a single iteration (efficient), but it also enables mid-run taskLog pushes that violate the "one entry at end" contract. The orchestrator's "one task per iteration" instruction was also bypassed. The engine's multi-block execution support interacts poorly with the program's iteration-level contracts.

### Compound learning scorecard:

| Metric | Value | Assessment |
|--------|-------|------------|
| Tasks solved | 1/3 (33%) | Below v1.1.0 |
| Cross-task primitive reuse | 0 calls | Failed (unchanged) |
| Same-task primitive reuse | 4 calls | Reduced from v1.1.0 |
| Anti-patterns recorded | 2 | **Fixed** (was 0 in v1.1.0) |
| Strategies reliable | 1/1 (100%) | **Fixed** (was 1/4 in v1.1.0) |
| Primitives general-purpose | 3/3 (100%) | **Fixed** (was 1/9 in v1.1.0) |
| Primitives with doc strings | 3/3 (100%) | **Fixed** (was 0/9 in v1.1.0) |
| taskLog entries per delegation | 1.8 avg | Slightly worse |
| Dimension sanity check | Missing | **Regressed** |
| Orchestrator shape violations | 0 | **Fixed** (was 1 in v1.1.0) |
