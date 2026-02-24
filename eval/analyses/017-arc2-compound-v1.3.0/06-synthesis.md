# Synthesis: Run 017 -- arc2-compound v1.3.0

**Date:** 2026-02-18
**Analysts:** 5 parallel analysis agents (trajectory, state/knowledge, program effectiveness, code patterns, v1.3.0 changes)
**Result file:** `eval/results/arc-compound_anthropic_claude-opus-4-6_2026-02-18T20-24-20-247Z.json`

---

## 1. Executive Summary

Run 017 scored **0** on a single-task ARC-2 compound session (task 0934a4d8, a 30x30 grid with bilateral symmetry and an 8-region fill). Two simultaneous changes were under test: the tool-call REPL driver (`src/drivers/anthropic-messages.ts`) to enforce single-block-per-iteration execution, and IoC program loading (`loadProgram()`) to cleanly separate `globalDocs` from per-agent `<rlm-program>`. The critical finding is that **the tool-call driver was never activated** -- `resolveCallLLM()` in `eval/run.ts` always routes through `fromOpenRouter()`, so Claude Opus 4.6 ran the text-block code path with unconstrained multi-block generation. This caused the orchestrator to cram its entire session (pass@1 + pass@2 + return) into a single 5-block iteration, and both solver children to write verification and `return()` in the same iteration -- hallucinating that verification passed when it clearly showed all training pairs WRONG. Both submissions were burned on false-positive `solved=true` reports. The IoC program loading, by contrast, **worked correctly**: `root.md` body became `globalDocs`, `orchestrator.md` became the root app, and `solver.md` resolved via `{ app: "arc2-solver" }`.

---

## 2. Cross-Analysis Findings

### Points of Agreement (All 5 Analyses)

Every analysis independently identified the same three compounding failures:

1. **Multi-block execution is the root cause.** Analyses 01, 02, 03, 04, and 05 all converge on this. The orchestrator emitted 5 code blocks in iteration 0. The pass@1 solver emitted 10 blocks across 2 iterations, and the pass@2 solver emitted 15+ blocks across 4 iterations. Without single-block enforcement, the model generates its entire plan before seeing any execution output.

2. **VERIFY-THEN-RETURN was violated by both solvers.** All 5 analyses document this independently. Analysis 01 traces the exact iteration (D1 iter 1, D2 iter 3-4). Analysis 02 shows the taskLog entries contained `solved: true` with `confidence: 1.0` despite all-WRONG verification. Analysis 03 maps the violation to the specific contract clause. Analysis 04 identifies it as "verbal reasoning with code" -- the return block's reasoning contradicts the verification output in the same iteration. Analysis 05 explains the mechanism: in the text-block path, all code blocks are committed before any execution occurs.

3. **IoC program loading worked.** Analyses 03 and 05 confirm that `{ app: "arc2-solver" }` resolved correctly, `globalDocs` were visible at child depth, and `&Library` pass-by-reference worked. The mechanical plumbing was sound.

### Points of Divergence

- **Analysis 03 (program effectiveness) emphasizes that the program is over-prescriptive in illustrative code.** The orchestrator program presents 5 sequential code sections (Setup, Main Loop, Pass@2 Transition, Pass@2 Retry, Return) that the model treated as a script to concatenate. Analysis 04 partially agrees but notes the code quality within each block was high -- the problem was the generation pattern, not the code content.

- **Analysis 04 (code patterns) uniquely identifies the coordinate algebra confusion.** The pass@2 solver found the correct pattern (hflip of source block at 180-rotated position) but confused `inp[sr+r][sc+outW-1-c]` with `inp[minR+r][C-1-(minC+c)]`. This is a secondary failure that would have mattered even with single-block enforcement. No other analysis digs into this specific bug.

- **Analysis 02 (state/knowledge) uniquely documents the `__arcSession` snapshot timeline.** It shows that the sandbox state mutations propagated correctly between orchestrator blocks and from parent to child. The shared-sandbox mechanism worked perfectly; the data flowing through it was poisoned by false `solved=true` reports.

### Emergent Pattern: Hallucinated Verification

The most striking pattern across analyses is what Analysis 01 calls "hallucinated verification" and Analysis 04 calls "verbal reasoning with code." Both solvers:

1. Wrote verification code that produced clear `WRONG` output (D1: 35.5% match; D2: 3/36 match)
2. Wrote a return block in the same response whose reasoning states "All training pairs CORRECT, LOO PASS confirmed"
3. Returned `solved: true, confidence: 1.0`

This is not a case of the solver ignoring output -- it is a case of the solver never *seeing* the output. In the text-block path, the model commits all blocks at generation time. The return block's reasoning was written before the verification block executed. The VERIFY-THEN-RETURN contract exists precisely to prevent this, but without single-block enforcement, the contract has no teeth.

---

## 3. Root Cause Chain

```
resolveCallLLM() always returns fromOpenRouter()
  -> anthropic/claude-opus-4-6 goes through text-block code path
    -> no single-block enforcement
      -> orchestrator generates 5 blocks in iteration 0
        -> block 1 delegates to solver (D1)
          -> D1 generates 10 blocks across 2 iters
            -> iter 1: 6 blocks of blind exploration (wrong 3x3 block hypothesis)
            -> iter 2: 4 blocks (find 8-region, test 180-rot, verify, return)
              -> verification output: "Training pair 0-3: WRONG", "LOO FAIL"
              -> return block (pre-committed): solved=true, confidence=1.0
          -> orchestrator reads logEntry.solved === true
            -> sanity check passes (color/non-triviality OK, dims not enforced)
              -> __arcSubmit.submit() -> correct=false
                -> submission 1 burned
        -> block 3 transitions to pass@2
        -> block 4 delegates to solver (D2)
          -> D2 generates 15+ blocks across 4 iters
            -> iter 1: wrong output format (30x30 not subgrid)
            -> iter 2: breakthrough brute-force search (correct pattern found)
            -> iter 3: coordinate algebra confusion (formula wrong)
            -> iter 4: verify (ALL WRONG) + return (solved=true) in same block
          -> orchestrator reads logEntry.solved === true
            -> __arcSubmit.submit() -> correct=false
              -> submission 2 burned, 0 remaining
        -> block 5 returns {"0934a4d8": false}
      -> score: 0
```

**Key evidence from the trace:**

- **Orchestrator iteration 0, `code` array:** Contains exactly 5 elements (lines 21-25 of the result JSON). This is the smoking gun for multi-block execution.
- **D1 solver iteration 1, output:** Contains `"Training pair 0: WRONG"` through `"Training pair 3: WRONG"` and `"All correct: false"` and `"LOO FAIL: held out pair 0"`. Yet the answer field is `{"solved":true,"confidence":1,...}`.
- **D2 solver iteration 3, output:** Contains `"P0 hmirror: 3/36"` and `"All correct: false"`. Yet the answer is again `{"solved":true,"confidence":1,...}`.
- **resolveCallLLM() (eval/run.ts lines 263-291):** The function has no `anthropic` branch. Both the `openrouter/` prefix path (line 284) and the fallback path (line 290) call `fromOpenRouter()`.
- **Unawaited rlm() warning:** The D1 solver trace output includes `"[ERROR] 1 rlm() call(s) were NOT awaited"`, an artifact of multi-block execution where code blocks interact incorrectly.

---

## 4. What Was Actually Tested

Despite the tool-call driver not being active, this run validates several aspects of the system:

### IoC Program Loading (Confirmed Working)

1. **`loadProgram("arc2-compound")` correctly parsed** `root.md` (kind: program), `orchestrator.md` (kind: program-node), and `solver.md` (kind: program-node).
2. **`root.md` body became `globalDocs`** -- visible at all depths. The solver child saw `__arcLibrary` state schemas and harness globals documentation. Evidence: both solvers printed `Library: 0 primitives, 0 strategies` on first iteration, which comes from the root.md documentation guiding them to check the library.
3. **`{ app: "arc2-solver" }` resolved correctly.** The orchestrator delegated with `rlm(query, undefined, { app: "arc2-solver", model: "intelligent", maxIterations: 18 })` and the solver received its program. Evidence: solver behavior matches `solver.md` template (prints data, checks primitives, runs verification, pushes taskLog entry).
4. **`childApps` registration worked.** The program loader registered under both `arc2-solver` (frontmatter name) and `solver` (filename). The orchestrator used `arc2-solver`, which resolved.

### Shared Sandbox State (Confirmed Working)

1. **`&Library` pass-by-reference works.** Solvers wrote to `__arcLibrary.taskLog`, and the orchestrator read it back via `library.taskLog.filter(e => e.id === taskId).pop()`. The data flow was mechanically correct.
2. **`__arcSession` state mutations propagated correctly.** The env snapshot timeline (Analysis 02) shows `currentIndex`, `pass`, `totalSubmissions`, and `failedTaskIds` mutating correctly between blocks and flowing from parent to child.
3. **`__arcCurrentTask` was set before each delegation** and visible to both solver children.

### Program Contract Adherence (Partial)

Contracts that were followed (even though the run failed):
- try-catch around every `rlm()` call
- Ground-truth-based anti-pattern recording (from `result.correct`, not `logEntry.solved`)
- Diagnostic retry briefs (pass@2 told D2 what D1 tried and why it failed)
- No composition collapse (orchestrator never analyzed grids directly)
- Exactly one taskLog entry per solver delegation
- Return format: `JSON.stringify(__arcSubmit.getResults())`

### Program Architecture (Validated)

The 2-tier orchestrator/solver architecture is appropriate for compound ARC sessions. The orchestrator's concerns (session lifecycle, submission decisions, library curation) are cleanly separated from the solver's concerns (pattern discovery, transform validation). The failure was not architectural -- it was a driver routing bug that prevented the execution model the programs assumed.

---

## 5. Concrete Next Steps

### P0: Wire the tool-call driver into the eval harness [BLOCKING]

**What:** Add an `anthropic` branch to `resolveCallLLM()` that uses `fromAnthropicMessages()` for `anthropic/*` model specs.

**File:** `eval/run.ts`, lines 263-291

**Change:**
```typescript
import { fromAnthropicMessages } from "../src/drivers/anthropic-messages.js";

function resolveCallLLM(spec: string, maxBlocksPerIteration?: number | null): { callLLM: CallLLM; displayName: string } {
    const parts = spec.split("/");
    if (parts.length < 2) { /* existing error handling */ }

    const provider = parts[0];

    // NEW: Anthropic Messages API direct path
    if (provider === "anthropic") {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            console.error("ANTHROPIC_API_KEY not set. Required for anthropic/* models.");
            process.exit(1);
        }
        const modelId = parts.slice(1).join("/");
        return {
            callLLM: fromAnthropicMessages({
                baseUrl: "https://api.anthropic.com/v1",
                apiKey,
                model: modelId,
                ...modelOverrides(spec),
            }),
            displayName: `${modelId} (anthropic-messages)`,
        };
    }

    // Existing OpenRouter paths...
    const apiKey = process.env.OPENROUTER_API_KEY;
    // ... rest unchanged
}
```

**Also update `buildModelAliases()`** to use `fromAnthropicMessages()` for the `intelligent` alias when the root model is `anthropic/*`. Currently, all model aliases go through `fromOpenRouter()`, which means child delegations with `{ model: "intelligent" }` would still use the text-block path even if the root model uses the tool-call path.

**Expected impact:** Mechanically eliminates multi-block execution. Each LLM response will contain exactly one `execute_code` tool call. The model must observe execution output before generating the next block. This directly prevents the VERIFY-THEN-RETURN violation, the session-cramming failure, and the hallucinated verification pattern.

### P1: Restructure orchestrator.md to a state-machine pattern

**What:** Replace the 5 sequential illustrative code sections with a single if/else state-machine template. The model cannot skip ahead because state transitions depend on sandbox mutations from the current block.

**File:** `plugins/programs/arc2-compound/orchestrator.md`

**Change:** Replace the "Setup", "Main Loop", "Pass@2 Transition", "Pass@2 Retry", and "Return" sections with a single "Each Iteration" section:

```javascript
// EACH ITERATION: Check state and do exactly ONE thing
const session = globalThis.__arcSession;
const taskIds = globalThis.__arcTaskIds;

if (!session) {
  // SETUP -- initialize session, stop here
} else if (session.pass === 1 && session.currentIndex < taskIds.length) {
  // PROCESS ONE TASK -- delegate, read result, sanity check, submit, curate, advance index
} else if (session.pass === 1 && session.currentIndex >= taskIds.length && session.failedTaskIds.length > 0) {
  // TRANSITION TO PASS@2 -- set pass=2, build retryIds, stop here
} else if (session.pass === 2 && session.retryIndex < session.retryIds.length) {
  // RETRY ONE TASK -- diagnostic brief, delegate, submit, advance retryIndex
} else {
  // RETURN -- __arcSubmit.getResults()
}
```

**Rationale:** Analysis 03 identifies that the 5-section sequential layout reads as "here is the complete program to execute." The if/else pattern makes each iteration structurally independent. Even without single-block enforcement, this reduces the chance of session cramming because the model sees it as a branching decision, not a sequential script.

**Expected impact:** Defense-in-depth against multi-block execution. Even if the tool-call driver is not used (e.g., when running via OpenRouter), the state-machine structure discourages generating all branches in one response.

### P2: Add `__verificationPassed` flag pattern to solver.md

**What:** Replace the current VERIFY-THEN-RETURN prose instruction with a structural pattern that makes premature return impossible even in multi-block scenarios.

**File:** `plugins/programs/arc2-compound/solver.md`

**Change:** In the "Self-Verification" section, add:

```javascript
// End of verification iteration:
globalThis.__verificationPassed = allCorrect && looPass;
console.log(`VERIFICATION: ${globalThis.__verificationPassed ? 'PASSED' : 'FAILED'}`);
// STOP. Do not write return() in this code block.
```

In the "Return" section, change to:

```javascript
// PRECONDITION: globalThis.__verificationPassed was set in a PREVIOUS iteration
const solved = globalThis.__verificationPassed === true;
const testOutput = solved ? transform(test[0].input) : null;
// ... taskLog entry with solved, then return()
```

Add to "Critical Rules":

```
11. **Default is solved=false.** The return block reads `globalThis.__verificationPassed`.
    If this variable is not `true`, you MUST return `{ solved: false, confidence: 0, answer: null }`.
    Never set solved=true in the return block itself.
```

**Expected impact:** Even if the solver writes verification and return in the same iteration, the return block reads `__verificationPassed` from the sandbox. Since the verification block sets this variable based on actual execution results (not the model's reasoning), a multi-block response would at least get the right `solved` value -- the flag would be `false` because verification actually failed.

### P3: Strengthen the orchestrator sanity check

**What:** The current sanity check only validates color sets and non-triviality. Add dimension validation against the 8-region (or more generally, against training pair patterns).

**File:** `plugins/programs/arc2-compound/orchestrator.md`, sanity check section

**Change:** Add after the existing checks:

```javascript
// (d) Dimension plausibility: answer dims should match at least one training output's dims
const trainDimSet = new Set(trainOutputs.map(o => `${o.length}x${o[0].length}`));
const answerDims = `${answer.length}x${answer[0].length}`;
if (trainDimSet.size > 0 && !trainDimSet.has(answerDims)) {
  // Check if the task has a variable-dimension pattern
  const testInput = task.test[0].input;
  // For 8-fill tasks: answer should match the 8-region dimensions
  const eightCells = [];
  for (let r = 0; r < testInput.length; r++)
    for (let c = 0; c < testInput[r].length; c++)
      if (testInput[r][c] === 8) eightCells.push([r, c]);
  if (eightCells.length > 0) {
    const minR = Math.min(...eightCells.map(p => p[0]));
    const maxR = Math.max(...eightCells.map(p => p[0]));
    const minC = Math.min(...eightCells.map(p => p[1]));
    const maxC = Math.max(...eightCells.map(p => p[1]));
    const expectedDims = `${maxR - minR + 1}x${maxC - minC + 1}`;
    if (answerDims !== expectedDims) {
      console.log(`SANITY FAIL: answer dims ${answerDims} != 8-region dims ${expectedDims}`);
      sanityOk = false;
    }
  }
}
```

**Expected impact:** This would have caught D2's 30x30 answer (when the 8-region is 9x3) and prevented submission 2 from being wasted. For D1's 9x3 answer (8-region is also 9x3), this check would have passed -- the solver got the dimensions right but the content wrong. Still, preserving the second submission for a genuine retry is strictly better.

### P4: Add formula-extraction code pattern to solver.md

**What:** Analysis 04 identifies that the pass@2 solver found the correct pattern via brute-force search (all 4 pairs matched with specific transforms from specific source positions) but then failed the algebraic simplification into a general formula. Add a "formula extraction" pattern to the solver's Exploration Approaches.

**File:** `plugins/programs/arc2-compound/solver.md`, "Exploration Approaches" section

**Change:** Add:

```
- **Formula extraction from search results:** When a brute-force search finds the answer but the
  formula is unclear, use per-cell reverse mapping. For each output cell, search the input for the
  source cell and log the coordinate delta. This reveals the exact mapping without algebraic derivation.
```

**Expected impact:** This is a nice-to-have that would help the solver translate brute-force discoveries into general formulas. Low priority because the primary fix (P0) would give the solver enough iterations to iterate toward the correct formula.

### P5: Reduce globalDocs size for the solver

**What:** Analysis 05 notes that `root.md` body contains 284 lines including composition principles (CURATION IS THE RETURN ON COMPOSITION, COLLAPSE IS THE DEFAULT FAILURE MODE) that are relevant to the orchestrator but not the leaf solver. These add unnecessary context to the solver's system prompt.

**File:** `plugins/programs/arc2-compound/root.md`

**Change:** Move the "Composition Principles" section from root.md body into the orchestrator.md node file. Keep only the following in root.md body (globalDocs):
- Components section (interface contracts -- useful for any agent to understand the system)
- Shared State section (`&Library` schema)
- Harness-Injected Globals section
- Invariants section

**Expected impact:** Reduces solver context by ~60 lines of prose. Minor impact on this run, but reduces noise in the solver's system prompt for multi-task sessions.

### P6: Store `gridsEqual` as a library primitive in solver.md examples

**What:** Both solver instances reimplemented `gridsEqual` from scratch (Analysis 02, Analysis 04). The solver program encourages storing reusable primitives but the illustrative code does not show `gridsEqual` being stored.

**File:** `plugins/programs/arc2-compound/solver.md`, "Library Integration" section

**Change:** Add after the `gridsEqual` implementation in the verification section:

```javascript
// Store gridsEqual for future tasks
if (!globalThis.__arcLibrary.primitives.gridsEqual) {
  globalThis.__arcLibrary.primitives.gridsEqual = {
    fn: gridsEqual,
    source: gridsEqual.toString(),
    doc: "Compare two grids cell-by-cell. Returns true iff dimensions match and every cell is identical.",
  };
}
```

**Expected impact:** In multi-task sessions, subsequent solvers inherit `gridsEqual` from the library instead of reimplementing. Saves 1-2 iterations per task and demonstrates the library accumulation pattern.

---

## 6. Re-run Plan

### Pre-run Checklist

1. Apply P0: Wire `fromAnthropicMessages()` into `resolveCallLLM()` in `eval/run.ts`
2. Apply P1: Restructure `orchestrator.md` to state-machine pattern
3. Apply P2: Add `__verificationPassed` flag pattern to `solver.md`
4. Verify `ANTHROPIC_API_KEY` is set in `.env`
5. Verify `fromAnthropicMessages` import resolves correctly

### Run Command

```bash
# Archive previous results
mv eval/results/arc-compound_anthropic_claude-opus-4-6_*.json eval/results/archive/

# v1.3.1 run: single task, tool-call driver active
npx tsx eval/run.ts \
  --benchmark arc-compound \
  --model anthropic/claude-opus-4-6 \
  --max-iterations 10 \
  --max-depth 2 \
  --max-tasks 1 \
  --program arc2-compound \
  --trace-full
```

**Parameters:**
- `--max-iterations 10`: Same budget as run 017 (orchestrator gets 10 iters)
- `--max-depth 2`: Orchestrator at depth 0, solver at depth 1 (same as run 017)
- `--max-tasks 1`: Single task (0934a4d8) for comparison with run 017
- `--program arc2-compound`: Uses IoC program loading (confirmed working)
- `--trace-full`: Enables `--trace-children --trace-snapshots --trace-actions` for full analysis

**Expected cost:** With single-block enforcement, each LLM call generates ~1-4K output tokens instead of ~8K multi-block responses. Expect 6-10 orchestrator iterations and 8-15 solver iterations per delegation. Roughly 30-50 LLM calls at ~$0.15-0.30/call = $5-15 total (vs. $5.80 for run 017 which burned its budget on fewer but larger calls).

### Follow-up Run (Multi-task)

If the single-task run validates the fix, run a multi-task session to test compound learning:

```bash
npx tsx eval/run.ts \
  --benchmark arc-compound \
  --model anthropic/claude-opus-4-6 \
  --max-iterations 100 \
  --max-depth 2 \
  --max-tasks 5 \
  --program arc2-compound \
  --trace-full
```

---

## 7. Success Criteria

### Structural Criteria (Must Pass)

| Criterion | Measurement | Pass Threshold |
|-----------|------------|----------------|
| Single-block enforcement active | Every `code` array in the trace has length 1 | 100% of iterations |
| Orchestrator uses multiple iterations | `results[0].iterations` | >= 4 (setup + task + pass@2 + return) |
| Solver uses multiple iterations | `children[N].iterations` | >= 5 per solver (explore + hypothesize + verify + return) |
| VERIFY-THEN-RETURN respected | Verification and return in separate iterations | 100% (no iteration has both `gridsEqual` and `return()` in the same `code[0]`) |
| Honest `solved` reporting | `logEntry.solved === false` when verification shows WRONG | 100% |

### Behavioral Criteria (Expected)

| Criterion | Measurement | Expected Range |
|-----------|------------|----------------|
| Orchestrator iteration usage | `results[0].iterations` / `maxIterations` | 40-80% (4-8 of 10) |
| Solver iteration usage | `children[N].iterations` / `maxIterations` | 40-90% (7-16 of 18) |
| Solver hypotheses tested | Distinct transform approaches per solver | >= 3 |
| Solver abandons failing hypotheses | After seeing pair 0 WRONG, tries different approach | Yes |
| Orchestrator curates after D1 | Anti-pattern recorded if D1 wrong | Yes |
| Diagnostic retry brief | D2 query references D1's approach | Yes |
| Library primitives stored | `gridsEqual` at minimum | >= 1 |

### Score Criteria

| Criterion | Expected |
|-----------|----------|
| Score on 0934a4d8 | Any score > 0 is a win over run 017. The task requires discovering bilateral reflection symmetry with axis 15.5 and computing the correct fill from the symmetric source region. A single-block solver with 18 iterations should be able to find this via brute-force source search (as D2 did in run 017, iter 2) and then extract the correct formula with additional iterations. |
| Submissions wasted | <= 1. If the solver returns `solved=false` when verification fails, the orchestrator should not submit. At most 1 submission should be wasted on a false positive. |

### What a Successful Run Looks Like

```
Orchestrator iter 0: Setup (initialize __arcSession)
Orchestrator iter 1: Pass@1 -- delegate to solver
  Solver iter 0: Read data, print grids, check library
  Solver iter 1: Structural analysis, find 8-region
  Solver iter 2: Hypothesis: test symmetry types
  Solver iter 3: Hypothesis: brute-force source search -> find correct source+transform
  Solver iter 4: Implement transform function
  Solver iter 5: Verify on all training pairs -> set __verificationPassed
  Solver iter 6: Read __verificationPassed -> return solved=true/false
Orchestrator iter 2: Read solver result, sanity check, submit (or defer)
Orchestrator iter 3: Pass@2 transition (if needed)
Orchestrator iter 4: Pass@2 retry (if needed)
Orchestrator iter 5: Return final results
```

The key difference from run 017: each iteration is one code block. The solver sees its verification output before deciding to return. The orchestrator sees each solver's result before deciding to submit or retry. The system iterates, observes, and reacts -- which is the entire point of the REPL loop.
