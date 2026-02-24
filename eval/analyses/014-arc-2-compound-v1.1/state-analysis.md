# ARC-2 Compound v1.1 -- State Management & Knowledge Accumulation Analysis

**Run:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T12-02-47-768Z.json`
**Score:** 2/3 (66.7%)
**Model:** Claude Opus 4.6
**Config:** maxIterations=10 (root), maxDepth=2, maxIterations=18 (solvers)
**Tasks:** 0934a4d8 (failed), 135a2760 (correct), 136b0064 (correct on retry)

---

## 1. Environment Updates: globalThis State Read/Write

### Did agents successfully read/write globalThis state?

**Yes, comprehensively.** The shared sandbox state flow worked exactly as designed by the program spec.

#### Orchestrator writes (Root iter 0):

```
globalThis.__arcSession = {
  currentIndex: 0,
  pass: 1,
  submittedCorrect: 0,
  failedTaskIds: [],
  totalSubmissions: 0,
};
```

Before each delegation:

```
globalThis.__arcCurrentTask = taskId;
```

Both `__arcSession` and `__arcCurrentTask` were read correctly by every child solver.

#### Solver reads (every child, iter 0):

```
const taskId = globalThis.__arcCurrentTask;
const task = globalThis.__arcTasks[taskId];
const library = globalThis.__arcLibrary;
```

All five children (3 pass@1 + 2 pass@2) successfully read `__arcCurrentTask`, `__arcTasks`, and `__arcLibrary`. No child failed to locate the harness-injected globals.

#### Solver writes to `__arcLibrary`:

Every child solver wrote to `__arcLibrary.taskLog` and most stored live functions on `__arcLibrary.primitives`. The orchestrator confirmed each primitive after delegation:

```
Primitive confirmed: find8Bbox
Primitive confirmed: gridsEqual
```

This confirmation verifies the primitives are live callable functions on the shared sandbox, not serialized text.

#### `__arcSubmit` API:

The orchestrator correctly called `__arcSubmit.submit()`, `__arcSubmit.remaining()`, and `__arcSubmit.getResults()`. Solvers correctly refrained from calling these (respecting the `prohibited` constraint in their program-node frontmatter).

**Summary:** The `&Library` pass-by-reference pattern works. globalThis is a reliable shared memory bus between orchestrator and solvers. All 5 children and the orchestrator read/wrote the same `__arcLibrary` object with no isolation bugs.

---

## 2. Cross-Task Knowledge Sharing

### Did primitives stored by solver for task 1 get used by solver for task 2 or 3?

**Partially. Primitives were LISTED but not CALLED across tasks.** The only genuine cross-task primitive reuse occurred during pass@2 retries for the SAME task.

#### Evidence: Library growth across tasks

| After Task | Primitives | Strategies | Anti-Patterns |
|-----------|-----------|-----------|---------------|
| (initial) | 0 | 0 | 0 |
| Task 1 (0934a4d8) | 2: `find8Bbox`, `gridsEqual` | 1 | 0 |
| Task 2 (135a2760) | 5: + `find2DPeriodStrict`, `extractTile`, `repairContent` | 2 | 0 |
| Task 3 (136b0064) | 7: + `patternToMask`, `maskToString` | 3 | 0 |
| Retry 1 (0934a4d8) | 9: + `fillPeriodicHole`, `solveSymmetricHole` | 4 | 0 |
| Retry 2 (136b0064) | 9 (unchanged) | 4 | 0 |

#### Cross-task primitive listing vs calling

**Child 1 (task 135a2760, pass@1):**
- **Listed:** `Available primitives: find8Bbox, gridsEqual` (from Child 0)
- **Called from library:** ZERO calls to `library.primitives.find8Bbox` or `library.primitives.gridsEqual`
- **Redefined locally:** Wrote its own `function gridsEqual(a, b)` from scratch in 3 separate code blocks
- **Verdict:** Library check performed (as instructed), but solver chose to rewrite rather than reuse

**Child 2 (task 136b0064, pass@1):**
- **Listed:** `Available primitives: find8Bbox, gridsEqual, find2DPeriodStrict, extractTile, repairContent`
- **Called from library:** ZERO calls to any library primitive
- **Verdict:** Complete library bypass -- solver wrote everything from scratch

**Child 4 (task 136b0064, pass@2 retry):**
- **Listed:** All 9 primitives including `fillPeriodicHole`, `solveSymmetricHole`
- **Called from library:** ZERO calls to any library primitive
- **Verdict:** Despite having 9 available primitives and a retry prompt saying "Compose existing primitives where possible", the solver wrote everything from scratch

#### Same-task primitive reuse (the one success)

**Child 3 (task 0934a4d8, pass@2 retry):**
- **Called from library:** 16+ calls to `library.primitives.find8Bbox` and `library.primitives.gridsEqual`
- This is the ONLY child that actually called library primitives
- Both primitives were stored by Child 0 for the SAME task (0934a4d8)
- The retry prompt for this task mentioned the previous approach, and the solver naturally reached for the same task-specific utilities

**Conclusion:** Cross-task primitive reuse did NOT happen. The library primitives accumulated correctly, and solvers listed them, but no solver called a primitive that was stored by a solver for a different task. The only reuse was same-task (0934a4d8's `find8Bbox` and `gridsEqual` were reused in its own retry).

---

## 3. Knowledge Accumulation Quality

### Was the library concise?

**No -- it was bloated with task-specific functions masquerading as general primitives.**

#### Primitives stored:

| Primitive | Stored by | General-purpose? | Actually reused? |
|----------|----------|-------------------|-----------------|
| `find8Bbox` | Child 0 (0934a4d8) | **No** -- finds bounding box of color-8 cells specifically | Yes, by same-task retry |
| `gridsEqual` | Child 0 (0934a4d8) | **Yes** -- generic grid comparison | Yes, by same-task retry |
| `find2DPeriodStrict` | Child 1 (135a2760) | **Somewhat** -- finds 2D period in grid | Never reused |
| `extractTile` | Child 1 (135a2760) | **Somewhat** -- extracts repeating tile | Never reused |
| `repairContent` | Child 1 (135a2760) | **Somewhat** -- repairs tiled content | Never reused |
| `patternToMask` | Child 2 (136b0064) | **No** -- converts 3x3 pattern to binary mask | Never reused |
| `maskToString` | Child 2 (136b0064) | **No** -- converts mask to string key | Never reused |
| `fillPeriodicHole` | Child 3 (0934a4d8 retry) | **No** -- fills color-8 holes using periodicity | Never reused |
| `solveSymmetricHole` | Child 3 (0934a4d8 retry) | **No** -- complete task-specific solver | Never reused |

Only 1 out of 9 primitives (`gridsEqual`) is truly general-purpose. The solver plugin instructs: "DO NOT STORE TASK-SPECIFIC TRANSFORMS," yet `find8Bbox` (color-8 specific), `patternToMask` (3x3 block specific), and `solveSymmetricHole` (a complete solver function) violate this rule.

### Did strategies get recorded with useful structuralHints?

**Partially.** The structuralHints were populated but had two quality issues:

1. **Runtime expressions instead of values:** Several entries stored JavaScript expressions rather than resolved values:
   ```
   outputDims: [testOutput.length, testOutput[0].length]
   colorCount: new Set(testInp2.flat().concat(testOutput.flat())).size
   ```
   These evaluate to numbers at runtime but are meaningless when read later as structuralHints.

2. **Useful fields were present:** `sameSize`, `hasBackground`, and static `colorCount` values were correctly populated when the solver used literal values.

### Were antiPatterns useful?

**No antiPatterns were ever recorded.** All 7 taskLog entries claimed `solved: true`. Even when the actual submission was wrong (0934a4d8 pass@1 was incorrect), the solver still wrote `solved: true, confidence: 1.0`. The orchestrator's anti-pattern recording logic only triggers when `logEntry.solved === false`, so the anti-patterns array remained empty throughout the entire session.

This is a significant knowledge quality issue: the system has no mechanism to record failed approaches when the solver believes it succeeded.

---

## 4. Knowledge Stagnation

### Did the library stop growing?

**No -- the library grew at every task.** Primitive count increased from 0 to 9 across 5 delegations:

```
0 -> 2 -> 5 -> 7 -> 9 -> 9
```

The final delegation (Child 4, 136b0064 retry) added no new primitives, but this is the expected behavior -- it was a retry that succeeded without needing new utilities.

### Were there missed opportunities to store reusable primitives?

**Yes, several:**

1. **`floodFillFrom`** -- Child 0 (0934a4d8) wrote a correct flood-fill-from-cells function with barrier support. This is a classic ARC primitive (connected component analysis). It was NOT stored on the library.

2. **`countComponents`** -- Child 0 also wrote a connected components counter. Not stored.

3. **`diffGrids`** -- Multiple children wrote grid diff functions. None stored.

4. **`colorHistogram`** -- Multiple children computed color frequency distributions inline. Never abstracted or stored.

5. **`gridsEqual` was redefined 3 times** -- Child 1 wrote its own `gridsEqual` despite it being available on the library. If the solver had called `library.primitives.gridsEqual`, this would have been zero-cost. Instead, it rewrote the same 8-line function from scratch.

The solver plugin lists capabilities (`gridsEqual`, `diffGrids`, `findComponents`, `detectSymmetry`) that should be stored, but only `gridsEqual` actually made it to the library. The other capabilities were written inline and discarded.

---

## 5. Knowledge Duplication

### Were the same primitives or strategies recorded multiple times?

**Yes -- significant duplication in taskLog.**

#### taskLog duplication

The `taskLog` accumulated 7 entries across 5 delegations:

| Entry | Task ID | Source | Approach |
|-------|---------|--------|----------|
| 1 | 0934a4d8 | Child 0 (pass@1) | "Grid has 180 rotational symmetry..." |
| 2 | 135a2760 | Child 1 (pass@1) | "Pattern repair: Grid divided into panels..." |
| 3 | 136b0064 | Child 2 (pass@1) | "Block-based path drawing..." |
| 4 | 0934a4d8 | Child 3 (pass@2, iter 0) | "Grid has 2D translational periodicity..." |
| 5 | 0934a4d8 | Child 3 (pass@2, iter 1) | "Grid has 180 rotational symmetry with 8-colored hole..." |
| 6 | 0934a4d8 | Child 3 (pass@2, iter 4) | "Grid has dual-axis reflection symmetry..." |
| 7 | 136b0064 | Child 4 (pass@2) | "Block-based path drawing..." (variant) |

**Task 0934a4d8 has 4 entries.** Child 3 (the retry solver) pushed 3 separate taskLog entries during its own run -- one for each major hypothesis it tested. This violates the contract "Write to taskLog ALWAYS" which implies one entry per solver invocation, not one per hypothesis.

**Task 136b0064 has 2 entries** (one per pass), which is expected.

#### Strategy duplication

The orchestrator's curation code checks `library.strategies.find(s => s.approach === logEntry.approach)` for exact string match. Since each solver used a slightly different approach description, no deduplication occurred. The 4 strategies at end-of-run are:

1. "Grid has 180 rotational symmetry..." (0934a4d8 pass@1 -- wrong answer)
2. "Pattern repair: Grid divided into panels..." (135a2760 -- correct)
3. "Block-based path drawing..." (136b0064 pass@1 -- wrong answer)
4. "Grid has dual-axis reflection symmetry..." (0934a4d8 pass@2 -- failed sanity check)

**Strategies 1, 3, and 4 record approaches that produced WRONG answers.** The curation logic promotes a strategy whenever the solver returns `solved: true`, regardless of whether the submission was actually correct. This pollutes the strategy library with unreliable approaches.

### Was taskLog bloated?

**For 3 tasks: yes.** 7 entries for 3 tasks is 2.3x. In a 100-task session, if the retry solver continues to push 3 entries per attempt, the taskLog could grow to 300+ entries. The `find()` calls used to locate entries would still work (they find the first match), but the accumulated data provides misleading signal.

---

## 6. Curation Effectiveness

### Did the orchestrator's inline curation work?

**Partially. The mechanics worked; the signal quality was poor.**

#### What worked:

1. **Primitive confirmation:** After every delegation, the orchestrator confirmed stored primitives exist as live functions:
   ```
   Primitive confirmed: find8Bbox
   Primitive confirmed: gridsEqual
   ```
   This is a genuine quality gate -- it verifies the child actually stored callable code.

2. **Strategy recording:** New strategies were recorded after each task. The `structuralHints` and `taskIds` fields were populated.

3. **Library progress logging:** Every iteration printed library size, enabling at-a-glance progress tracking.

#### What failed:

1. **No anti-patterns recorded:** Because all solvers returned `solved: true` (even when wrong), the curation code never triggered anti-pattern recording. The `library.antiPatterns` array remained empty. This means the retry solver for pass@2 received NO information about what approaches to avoid from the library itself -- the only signal came from the orchestrator's retry prompt, which quoted the first taskLog entry.

2. **Strategy promotion of wrong answers:** The curation promoted strategies when `logEntry.solved === true`, not when the actual submission was correct. Strategies 1, 3, and 4 record approaches that failed on submission. Future tasks consulting these strategies would be misled.

3. **No primitive pruning or quality assessment:** The orchestrator confirmed primitives exist but never tested them. `find8Bbox` is task-specific (only useful for grids with color 8), but the library treats it as a general utility.

4. **The orchestrator solved a task directly:** In Root iteration 1, the orchestrator spent 10 code blocks analyzing the 0934a4d8 task data directly -- inspecting grids, finding symmetry axes, and constructing an answer. This violates its own shape declaration: `prohibited: [solving tasks directly]`. The orchestrator used its last submission on a self-computed answer that ultimately failed sanity checks (contained color 8, which wasn't in training outputs).

---

## 7. State at End of Run

### Final `__arcLibrary` state:

```
__arcLibrary = {
  primitives: {
    find8Bbox:          Function,   // stored by Child 0 (task-specific)
    gridsEqual:         Function,   // stored by Child 0 (general-purpose)
    find2DPeriodStrict: Function,   // stored by Child 1 (somewhat general)
    extractTile:        Function,   // stored by Child 1 (somewhat general)
    repairContent:      Function,   // stored by Child 1 (somewhat general)
    patternToMask:      Function,   // stored by Child 2 (task-specific)
    maskToString:       Function,   // stored by Child 2 (task-specific)
    fillPeriodicHole:   Function,   // stored by Child 3 (task-specific)
    solveSymmetricHole: Function,   // stored by Child 3 (task-specific solver!)
  },
  // 9 primitives total. 1 general-purpose, 3 somewhat general, 5 task-specific.

  strategies: [
    {
      approach: "Grid has 180° rotational symmetry...",
      structuralHints: { sameSize: false, inputDims: [30, 30], colorCount: 10, hasBackground: false },
      taskIds: ["0934a4d8"],
      successCount: 1     // NOTE: submission was WRONG
    },
    {
      approach: "Pattern repair: Grid divided into panels...",
      structuralHints: { sameSize: true, hasBackground: false },
      taskIds: ["135a2760"],
      successCount: 1     // submission was correct
    },
    {
      approach: "Block-based path drawing...",
      structuralHints: { sameSize: false, colorCount: 7, hasBackground: true },
      taskIds: ["136b0064"],
      successCount: 1     // NOTE: pass@1 submission was WRONG (pass@2 was correct, different approach)
    },
    {
      approach: "Grid has dual-axis reflection symmetry...",
      structuralHints: { sameSize: false, hasBackground: false },
      taskIds: ["0934a4d8"],
      successCount: 1     // NOTE: sanity check FAILED, never submitted
    },
  ],
  // 4 strategies. Only 1 (strategy 2) corresponds to a correct submission.

  antiPatterns: [],
  // EMPTY. No anti-patterns were ever recorded.

  taskLog: [
    // 7 entries total:
    // 4 entries for 0934a4d8 (1 pass@1 + 3 from retry solver)
    // 1 entry for 135a2760
    // 2 entries for 136b0064 (1 pass@1 + 1 pass@2)
    // All 7 entries have solved: true, confidence: 1.0
    // Only 2 of the corresponding submissions were actually correct
  ]
}
```

### Final `__arcSession` state:

```
__arcSession = {
  currentIndex: 3,
  pass: 2,
  submittedCorrect: 2,  // 135a2760 + 136b0064 (retry)
  failedTaskIds: ["0934a4d8", "136b0064"],
  totalSubmissions: 4,  // 0934a4d8 (wrong), 135a2760 (right), 136b0064 (wrong), 136b0064 retry (right)
  retryIds: ["0934a4d8", "136b0064"],
  retryIndex: 2,
}
```

---

## Key Findings

### What worked well:

1. **Shared sandbox state is reliable.** The `&Library` pass-by-reference pattern works exactly as designed. No serialization issues, no isolation bugs.
2. **Primitive confirmation is valuable.** The orchestrator's post-delegation check that primitives are live functions is a real quality gate.
3. **Library growth was monotonic.** No primitives were accidentally deleted or overwritten.
4. **Retry prompts were diagnostic.** The pass@2 retry solver for 136b0064 received the previous approach description and successfully tried a different approach, leading to a correct submission.

### What needs fixing:

1. **Cross-task primitive reuse did not happen.** Solvers listed available primitives but never called them for different tasks. The solver plugin says "CHECK LIBRARY FIRST" but the model prefers writing from scratch. This may require stronger contractual language or a different primitive format (e.g., include function signatures and docstrings in the listing).

2. **Anti-patterns never recorded.** Because solvers always claim `solved: true`, the orchestrator never learns what failed. Fix: the orchestrator should record anti-patterns when submission result is `correct: false`, not when `solver.solved === false`.

3. **Strategies record wrong answers.** Strategy promotion should be gated on `__arcSubmit.submit().correct === true`, not `logEntry.solved === true`. Currently, 3 of 4 strategies correspond to wrong or rejected submissions.

4. **taskLog is over-written within a single solver invocation.** Child 3 pushed 3 entries for the same task during one solver run. The contract should specify: push exactly once, at the end, reflecting the final state.

5. **structuralHints contain runtime expressions.** Some hints store JavaScript expressions like `new Set(testInp2.flat()...).size` instead of resolved numeric values. This makes them unreadable when the library is serialized or inspected.

6. **Task-specific functions pollute the primitive library.** 5 of 9 primitives are task-specific. The `find8Bbox` function only works for grids with color 8. `solveSymmetricHole` is a complete solver, not a reusable utility. Better primitive naming and the orchestrator rejecting overly specific primitives would help.

7. **The orchestrator violated its own shape constraint.** Root iteration 1 spent 10 code blocks trying to solve 0934a4d8 directly instead of delegating. This consumed 1 of the 10 root iterations on work that the solver should have done.

### Compound learning scorecard:

| Metric | Value | Assessment |
|--------|-------|------------|
| Tasks solved | 2/3 (67%) | Good for v1.1 |
| Cross-task primitive reuse | 0 calls | Failed |
| Same-task primitive reuse | 16+ calls | Worked (0934a4d8 retry) |
| Anti-patterns recorded | 0 | Failed |
| Strategies reliable | 1/4 (25%) | Poor |
| Primitives general-purpose | 1/9 (11%) | Poor |
| taskLog entries per task | 2.3 avg | Bloated |
| Orchestrator shape violations | 1 (Root iter 1) | Bad |
