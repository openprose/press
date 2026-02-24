# Program Effectiveness Analysis: Run 017 (arc2-compound v1.3.0)

## Summary

Score: 0/1. Orchestrator used 2 of 10 iterations. Pass@1 solver used 2 iterations (18 budget). Pass@2 retry solver used 4 iterations (18 budget). Both solvers returned `solved: true` with wrong answers. The orchestrator submitted both, burning both submissions. The programs suffered from **three compounding failures**: (1) multi-block execution collapsed the orchestrator's iteration structure, (2) solvers violated the VERIFY-THEN-RETURN invariant, and (3) the solver's sameSize structural heuristic was applied to a non-sameSize task (9x4 output vs 30x30 input), confusing the second solver's initial framing.

---

## 1. Orchestrator Program Effectiveness

### What Worked

The orchestrator program (`orchestrator.md`) achieved remarkable fidelity in one dimension: the orchestrator **faithfully copied** the program's illustrative code. Iteration 1 reproduced the Setup, Main Loop, Pass@2 Transition, Pass@2 Retry, and Return sections nearly verbatim from the program. This is strong evidence that the code-heavy program format works as a template.

Specific clauses followed:
- **"try-catch around every rlm() call"** (contract `ensures` item 3): Both pass@1 and pass@2 delegations were wrapped in try-catch.
- **"Sanity check before submission"** (contract `ensures` item 2): Dimension, color, and non-triviality checks were implemented.
- **"Diagnostic retries"** (contract `ensures` items 4-5): The pass@2 retry prompt included previous approach and failure reason.
- **"Ground-truth curation"** (contract `ensures` items 5-6): Anti-pattern was recorded from `result.correct === false`, not solver self-report.
- **"Return format"** (Critical Rule 8): Used `return(JSON.stringify(__arcSubmit.getResults()))`.

### What Failed: Multi-Block Execution

The **catastrophic failure** was that the orchestrator generated **5 code blocks in a single iteration** (iteration 1):
1. Setup (session init)
2. Main Loop (task delegation + submission + curation)
3. Pass@2 Transition
4. Pass@2 Retry (second delegation)
5. Final Return

This directly violated the program's core structural instruction:

> **"Each iteration processes exactly ONE task."** (Main Loop section)
> **"One task per iteration."** (Critical Rule 1)
> **"STOP HERE. Next iteration processes the next task."** (comment in Main Loop code)

The program says "STOP" three separate times in the illustrative code, once per section. But the orchestrator concatenated all sections into one massive generation. This is a **multi-block execution** failure mode: the engine extracted and ran all 5 code blocks sequentially within a single iteration.

**Consequence**: The entire session -- setup, pass@1 delegation, pass@1 submission, pass@2 transition, pass@2 delegation, pass@2 submission, and return -- all happened in iteration 1. Iteration 2 was only used because the engine intercepted the first `return()` for verification (the "early return intercepted" mechanism).

### Why Multi-Block Happened

The orchestrator program is structured as a **sequential recipe**: Setup, then Main Loop, then Pass@2 Transition, then Pass@2 Retry, then Return. Each section has illustrative code. The model read this as "here is the complete program to execute" and generated all sections in one response.

The "STOP HERE" comments are embedded **inside** the illustrative code blocks, not as top-level program instructions. The model generates its response before any code is executed, so it cannot observe the state change from one section and decide to stop. It committed to the full plan at generation time.

### Specific Contract Violations

1. **"Each iteration processes exactly ONE task"** -- violated. Both pass@1 and pass@2 happened in the same iteration.
2. **"AFTER RETURN: Once you have called return(), your job is done"** -- the return was attempted mid-iteration, intercepted by the engine's first-iteration verification, and the model had to re-confirm in iteration 2.
3. **"Log progress"** (Critical Rule 9) -- progress was logged, but all within a single iteration, making it impossible to course-correct between tasks.

### Iteration Budget

The orchestrator was given 10 iterations. With 1 task, the expected budget was ~4 iterations (1 setup + 1 pass@1 + 1 pass@2 transition + 1 pass@2 retry + 1 return). Instead, it used 2 (1 for everything + 1 for verification re-confirmation). The 8 unused iterations represent lost opportunity for the orchestrator to react to intermediate results.

---

## 2. Solver Program Effectiveness

### Pass@1 Solver (2 iterations, 18 budget)

**Iteration 1**: The solver followed the "Read the Environment First" section faithfully. It printed task data, library state, and structural analysis. This is exactly what the program prescribes. However, it also generated 5 additional code blocks within the same iteration, exploring block decomposition, overlay, color analysis, and minority color hypotheses. These were **reasonable exploratory steps** that follow the program's "Exploration Approaches" guidance.

**Critical Failure -- VERIFY-THEN-RETURN violation**: In iteration 2, the solver:
1. Discovered the 8s region (correct)
2. Tested 180-degree rotational symmetry (found ~35% match -- clearly failing)
3. Tested horizontal, vertical mirrors (also failing)
4. Despite seeing 180-rot was only 35.5% match, wrote verification code for 180-rot approach
5. Verification output clearly showed **"Training pair 0: WRONG"** through **"Training pair 3: WRONG"**
6. **In the same code block**, wrote `return(JSON.stringify({ solved: true, confidence: 1.0, answer: testOutput }))` and pushed a taskLog entry with `solved: true`

The solver program explicitly prohibits this in multiple places:

> **"VERIFY-THEN-RETURN: NEVER write verification code and return() in the same iteration."** (contract `ensures` item 3)
> **"Hypotheses that fail on training pair 0: abandon immediately"** (contract `ensures` item 2)
> **"solved=true requires ALL of: (a) gridsEqual passes for EVERY training pair (you have SEEN the output)"** (contract `ensures` item 4)
> **"Returning solved=true with a wrong answer wastes a submission."** (contract `ensures` item 4)
> **"If ANY of these fail: solved=false, confidence=0, answer=null."** (contract `ensures` item 4)

The solver SAW "Training pair 0: WRONG" in its own output, yet still returned `solved: true`. This is because the verification and return were in the **same code block** -- the return was already committed in the generated code before the output was observed. This is precisely the scenario the VERIFY-THEN-RETURN rule was designed to prevent.

Additionally, this was a multi-block execution: the solver generated 4+ code blocks in iteration 2 (8-region discovery, symmetry testing, verification + return all together).

### Pass@2 Retry Solver (4 iterations, 18 budget)

The retry solver received the diagnostic brief prescribed by the orchestrator program:
> `"A previous attempt tried "180-degree rotational symmetry fill" and failed..."`

**What worked**:
- The solver correctly avoided the 180-rot approach (following the "try something DIFFERENT" instruction)
- It conducted a systematic search of symmetry types and found that the "best flipped copy" approach works with 100% accuracy for each training pair
- It discovered that the source position is always the point-symmetric counterpart of the 8-region
- By iteration 3, it identified that `hflip` from same-row mirror position works for ALL pairs

**What failed -- Same VERIFY-THEN-RETURN violation**:
- In iteration 1, it ran verification that showed ALL pairs WRONG (the horizontal mirror approach on the full grid was incorrect), then in the same response block wrote `return(JSON.stringify({ solved: true }))`. The engine caught this via "early return intercepted", showing the return contained a 30x30 grid (wrong dimensions -- should be just the 8-region).
- The solver was confused about the output format: it returned the entire 30x30 grid with 8s replaced, instead of just the 8-region subgrid. This confusion stemmed from it initially treating the task as `sameSize: true` (30x30 -> 30x30), when actually the output is much smaller (9x4, 4x5, etc.).
- By iteration 3-4, it discovered that `out[r][c] = inp[minR+r][C-1-(minC+c)]` does NOT work (only 3/36 correct), contradicting its earlier claim. The `hflip` from [14,3] works because it is `inp[14+r][3+outW-1-c]`, which is NOT the same as `inp[r][C-1-c]`. The solver confused these two formulations.
- In its final iteration (4), it STILL returned `solved: true` after seeing verification failures. The last output shows "Training pair 0: WRONG" through "Training pair 3: WRONG", yet the return included `solved: true, confidence: 1.0`.

**Root cause**: The solver found the correct source region and transform (`hflip` from the horizontally mirrored bounding box) but failed to translate this into a correct general formula. The correct formula is:
```
sourceStartCol = C - 1 - maxC  // mirror the 8-region's column range
out[r][c] = inp[minR+r][sourceStartCol + outW - 1 - c]  // hflip within source
```
But the solver kept trying `inp[minR+r][C-1-(minC+c)]`, which is a different mapping. It never resolved this discrepancy despite having all the pieces.

---

## 3. Program Conflicts and Confusion

### root.md (globalDocs) vs solver.md

The root.md component catalog declares the solver as:
```
role: leaf
produces for caller:
  - &Library.taskLog entry: { solved, confidence, answer, approach, keyInsight, structuralProps, newPrimitives }
  - return string: JSON { solved, confidence, answer }
```

The solver program's contract says:
```
ensures:
  - solved=true requires ALL of:
      (a) gridsEqual passes for EVERY training pair (you have SEEN the output)
      (b) LOO passes when >= 3 pairs (you have SEEN the output)
      (c) You confirmed (a) and (b) in a PREVIOUS iteration's output
      If ANY of these fail: solved=false, confidence=0, answer=null.
```

These are consistent. The solver violated its own contract, not due to conflicting instructions, but due to multi-block execution preventing it from observing verification output before committing to return.

### Multi-Block Execution as Systemic Issue

Both the orchestrator and both solver instances suffered from generating multiple code blocks per iteration. This is the **single most damaging pattern** in this run. The programs' "STOP HERE" / "separate iteration" instructions were ignored because:

1. The model generates its entire response (including all code blocks) before any code is executed
2. "Do X in the next iteration" instructions have no enforcement mechanism
3. The illustrative code sections read as a sequential script to be concatenated

This is not a conflict between programs -- it is a conflict between the **program's assumption** (that each code block is a separate iteration) and the **engine's behavior** (that all code blocks in a single response are executed sequentially in one iteration).

### Sanity Check: Dimensions Passed When They Should Not Have

The orchestrator's sanity check passed the pass@1 solver's answer despite the dimension mismatch:
```
Answer dims: 9x3, train output dims: 9x4,4x5,3x7,4x4
```

The check only fails when train dimensions are uniform AND the answer differs. Since training outputs have varying dimensions (9x4, 4x5, 3x7, 4x4), the check was inconclusive -- it did not reject the 9x3 answer. This is a gap in the sanity check logic: for non-sameSize tasks where training outputs vary, the check should at minimum verify that the answer dimensions match the expected output dimensions for this specific test input (which would require knowing the 8-region dimensions).

---

## 4. Component Catalog in root.md: Helpful or Confusing?

The component catalog was **not referenced** by either the orchestrator or the solver in their generated code. Neither agent quoted the `requires from caller`, `produces for caller`, or `does NOT produce` fields. The orchestrator followed the catalog's API boundaries (never calling grid analysis functions), but this was because `orchestrator.md` explicitly prohibits it, not because of the catalog.

The catalog's most useful function -- as a **readable interface contract** -- was wasted because this run had only 1 task and 2 tiers. There was no composition decision to make: the orchestrator always delegates to the solver.

The `Shared State` section documenting `__arcLibrary` schema was partially useful: both agents initialized and wrote to the library correctly. The `Submission Strategy` section was followed (pass@1 then pass@2).

**Verdict**: The catalog is neutral for this run. It did not confuse the agents, but it did not add value either. Its benefits would emerge in multi-task runs where strategy matching and library curation accumulate.

---

## 5. Contracts, Invariants, and Illustrative Code: Followed vs Ignored

### Followed

| Program Clause | Evidence |
|---|---|
| orchestrator `ensures: try-catch around every rlm() call` | Both delegations wrapped in try-catch |
| orchestrator `ensures: SANITY CHECK before every submission` | Color and non-triviality checks ran |
| orchestrator `ensures: ANTI-PATTERNS FROM GROUND TRUTH` | Anti-pattern recorded from `result.correct === false` |
| orchestrator `ensures: Return __arcSubmit.getResults()` | Final return used correct format |
| solver `requires: __arcCurrentTask is set` | Solver read from `globalThis.__arcCurrentTask` |
| solver "Read the Environment First" section | Both solvers printed task data first |
| solver "One taskLog entry at the END" | Each solver pushed exactly one entry |
| root.md `SANDBOX IS SHARED` invariant | All state passed through globalThis |
| root.md `2 SUBMISSIONS PER TASK` | Orchestrator managed submissions correctly |

### Ignored

| Program Clause | Evidence |
|---|---|
| orchestrator "One task per iteration" | All tasks + both passes in 1 iteration |
| orchestrator "STOP HERE" (x3) | Not honored -- multi-block execution |
| solver `VERIFY-THEN-RETURN: NEVER write verification code and return() in the same iteration` | Both solvers verified and returned in the same code block generation |
| solver `solved=true requires ALL of: (a) gridsEqual passes for EVERY training pair (you have SEEN the output)` | Pass@1 solver returned solved=true after seeing "Training pair 0: WRONG" through "Training pair 3: WRONG" |
| solver `If ANY of these fail: solved=false, confidence=0, answer=null` | Both solvers returned solved=true with wrong answers |
| solver `Hypotheses that fail on training pair 0: abandon immediately` | Pass@1 solver saw 180-rot was 35.5% match but still ran verification on it |
| solver "After 3 iterations without progress on a hypothesis: try a different approach" | Not applicable (solvers used too few iterations) |
| solver "Check library primitives BEFORE writing from scratch" | No primitives existed, so technically followed |
| root.md `LEAVE-ONE-OUT BEFORE SUBMIT` | Pass@1 solver ran LOO but it failed; still returned solved=true |
| root.md `VERIFY-THEN-RETURN` invariant | Same as solver contract -- violated by both solvers |

### Illustrative Code

The orchestrator's illustrative code sections (Setup, Main Loop, Pass@2, Return) were followed almost **too** faithfully. The model treated them as a script to execute rather than as templates for iteration-by-iteration behavior. The solver's illustrative code (gridsEqual, LOO, verification) was copied correctly at the function level.

---

## 6. Specific Program Changes to Improve Behavior

### P1: Restructure orchestrator.md to prevent multi-block execution

**Problem**: The orchestrator program contains sequential code sections that the model concatenates into a single response.

**Change**: Remove the multi-section illustrative code. Replace with a **single iteration template** that uses an explicit state machine:

```javascript
// EACH ITERATION: Check state and do ONE thing
const session = globalThis.__arcSession;
if (!session) {
  // SETUP
  ...
  // DO NOT continue. STOP HERE.
} else if (session.pass === 1 && session.currentIndex < taskIds.length) {
  // PROCESS ONE TASK
  ...
  // DO NOT continue. STOP HERE.
} else if (session.pass === 1 && session.currentIndex >= taskIds.length) {
  // TRANSITION TO PASS@2
  ...
  // DO NOT continue. STOP HERE.
} else if (session.pass === 2 && session.retryIndex < session.retryIds.length) {
  // RETRY ONE TASK
  ...
  // DO NOT continue. STOP HERE.
} else {
  // RETURN
  ...
}
```

This makes each iteration a **single code block** with an if/else chain. The model cannot skip ahead because the state transitions depend on sandbox mutations from the current block.

### P2: Add a hard structural directive against multi-block execution

**Add to both orchestrator.md and solver.md, before any illustrative code**:

```
## Critical Structural Rule

You MUST generate exactly ONE code block per iteration. NEVER generate
multiple code blocks in a single response. If you need to do multiple
things, put them in a single code block. If you need to wait for output
before deciding what to do next, STOP after the current code block.

The illustrative code sections below show what to do in DIFFERENT iterations,
not what to do in a single iteration. Each section is a separate iteration.
```

### P3: Make VERIFY-THEN-RETURN structurally enforceable in solver.md

**Problem**: The solver generates verification code and return() in the same response, so it cannot observe verification output before committing to return.

**Change**: Replace the "Return" section with a **conditional return pattern**:

```javascript
// In verification iteration:
globalThis.__verificationPassed = allCorrect && looPass;
console.log(`VERIFICATION: ${__verificationPassed ? 'PASSED' : 'FAILED'}`);
// STOP HERE. DO NOT write return() in this code block.
```

```javascript
// In return iteration (NEXT iteration after verification):
if (globalThis.__verificationPassed) {
  // ... taskLog + return
} else {
  // ... taskLog with solved=false + return
}
```

Also add a **hard prohibition** at the top of the solver program:

```
## Absolute Prohibition

You MUST NOT write `return()` in any code block that also contains
gridsEqual, verification, or hypothesis testing code. Return ONLY
appears in a code block that reads __verificationPassed or equivalent.
```

### P4: Fix the sanity check for variable-dimension tasks

**In orchestrator.md**, the sanity check should also verify dimensions match the 8-region size:

```javascript
// Additional sanity check for 8-fill tasks
const eightCells = [];
for (let r = 0; r < task.test[0].input.length; r++)
  for (let c = 0; c < task.test[0].input[0].length; c++)
    if (task.test[0].input[r][c] === 8) eightCells.push([r,c]);
if (eightCells.length > 0) {
  const minR = Math.min(...eightCells.map(p=>p[0]));
  const maxR = Math.max(...eightCells.map(p=>p[0]));
  const minC = Math.min(...eightCells.map(p=>p[1]));
  const maxC = Math.max(...eightCells.map(p=>p[1]));
  const expectedH = maxR-minR+1, expectedW = maxC-minC+1;
  if (answer.length !== expectedH || answer[0].length !== expectedW) {
    console.log(`SANITY FAIL: answer dims ${answer.length}x${answer[0].length} != 8-region dims ${expectedH}x${expectedW}`);
    sanityOk = false;
  }
}
```

This is task-specific. For a general-purpose program, the sanity check should compare answer dimensions against test input dimensions when training pairs have varying output sizes.

### P5: Reduce solver illustrative code volume

The solver program contains ~300 lines of illustrative code. This encourages the model to emit all of it at once. Reduce to **concise patterns** with explicit iteration boundaries:

```
Iteration 1: Print data, check library, structural analysis.
Iteration 2-N: One hypothesis per iteration. Test it. Abandon if pair 0 fails.
Iteration N+1: Verification (gridsEqual + LOO). Set __verificationPassed.
Iteration N+2: Read __verificationPassed. If true: taskLog + return. If false: taskLog + return with solved=false.
```

### P6: Add solved=false as the default in the return template

Change the solver's return template to default to `solved: false` and only set `true` if an explicit flag was set in a **previous** iteration:

```javascript
// Default to false. Only override if verification flag is set.
const solved = globalThis.__verificationPassed === true;
```

This prevents the common failure mode where the solver optimistically returns `solved: true` without having observed verification results.

---

## 7. Is the 2-Tier Architecture Right?

Yes, for this task type. The orchestrator/solver separation is well-suited to ARC-2 compound learning:

- **Orchestrator** manages cross-task state (library, submissions, retry strategy) -- these are concerns the solver should not have.
- **Solver** focuses on single-task hypothesis-driven exploration -- it should not worry about submission budgets or strategy promotion.

The 2-tier architecture was not the problem in this run. The problems were:
1. Multi-block execution collapsing the iteration structure
2. Solver returning dishonest `solved` status
3. Only 1 task in the dataset, removing the compound learning benefit entirely

For multi-task runs, the 2-tier architecture would show its value through library accumulation and diagnostic retries. With 1 task, the overhead of the orchestrator is wasted -- a single flat agent could do the same work.

**Recommendation**: Keep the 2-tier architecture for multi-task runs. For single-task evaluation, consider a flag to skip the orchestrator and run the solver directly.

---

## 8. Guidance Level: Over-Prescriptive or Under-Prescriptive?

### Over-Prescriptive

The orchestrator program is **too prescriptive** in its illustrative code. It provides complete, executable JavaScript for every phase of the session lifecycle. This encourages the model to concatenate and emit all of it at once, rather than making iteration-by-iteration decisions. The program should provide **decision logic** (what to check, what to decide) rather than **execution scripts** (full code to run).

The solver's capability declarations (`gridsEqual`, `diffGrids`, `findComponents`, `detectSymmetry`) were appropriately non-prescriptive -- they declare specs, not implementations.

### Under-Prescriptive

The programs are **under-prescriptive** about multi-block execution. The prohibition is stated in prose ("One task per iteration", "STOP HERE") but not structurally enforced. The model does not treat prose prohibitions as hard constraints when it has already committed to generating a full response.

The VERIFY-THEN-RETURN invariant is stated clearly and repeatedly, but it lacks structural teeth. The solver should be given a pattern that makes premature return() structurally impossible (e.g., the `__verificationPassed` flag approach).

### Balance Assessment

The programs are at a **reasonable guidance level** in aggregate, but the guidance is in the wrong form. Too much executable code (which gets concatenated), not enough structural constraints (which prevent failure modes). The key insight is:

> **Illustrative code is normative, not declarative.** The model follows it as a script. If the script contains 5 sections, the model emits all 5. The program should instead declare the state machine and let the model implement one transition per iteration.

---

## Appendix: Iteration Timeline

### Orchestrator (2 iterations / 10 budget)

```
iter 1  DELEGATE+SUBMIT+DELEGATE+SUBMIT+RETURN  [D1][D2]
  Multi-block: 5 code blocks in one iteration
  D1: pass@1 solver (2 iters, solved=true WRONG, submitted -> incorrect)
  D2: pass@2 solver (4 iters, solved=true WRONG, submitted -> incorrect)
  return() intercepted by early-return verification
iter 2  RETURN
  Re-confirmed return value: {"0934a4d8": false}
```

### Pass@1 Solver (2 iterations / 18 budget)

```
iter 1  EXPLORE:parse + EXPLORE:structure (6 code blocks)
  Read data, block analysis, overlay, color analysis, minority hypothesis
iter 2  EXPLORE:hyp-test + EXTRACT:implement + VERIFY + RETURN (4 code blocks)
  Found 8-region, tested 180-rot (35% match!), verified -> ALL WRONG
  STILL returned solved=true with wrong 9x3 answer
```

### Pass@2 Retry Solver (4 iterations / 18 budget)

```
iter 1  EXPLORE:parse + EXPLORE:hyp-test (5 code blocks)
  Re-examined data, tested symmetries, found hflip works for pair 0
  Confused sameSize=true (30x30 output) vs actual subgrid output
  Returned 30x30 grid -> early return intercepted
iter 2  EXPLORE:diagnose (4 code blocks)
  Realized output is subgrid not full grid
  Tested various symmetries, found best-flipped-copy works
iter 3  EXPLORE:hyp-test + VERIFY (4 code blocks)
  Found hflip/vflip/180rot all work from different source positions
  Discovered positions are symmetric about grid center
  Tried inp[minR+r][C-1-(minC+c)] -> FAILED (3/36)
iter 4  EXPLORE:hyp-test + VERIFY + RETURN (3 code blocks)
  Refined formula, verified -> ALL WRONG
  STILL returned solved=true
```
