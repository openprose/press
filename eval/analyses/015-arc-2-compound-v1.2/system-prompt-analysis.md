# System Prompt Analysis: ARC-2 Compound v1.2.0

**Eval:** `arc-compound_anthropic_claude-opus-4-6_2026-02-18T15-38-19-801Z.json`
**Score:** 1/3 tasks correct (33%)
**Cost:** $2.75 | **Wall time:** 28.4 minutes
**Config:** `maxIterations=10`, `maxDepth=2`, model=claude-opus-4-6
**Plugin version:** 1.2.0 (orchestrator + solver)

---

## 1. Root Prompt Structure

### What the orchestrator sees

The root orchestrator's system prompt is assembled by `buildSystemPrompt()` in five sections:

```
<rlm-preamble>      ~700 chars    Identity + interpreter basics + program construct reference
<rlm-environment>   ~1100 chars   Sandbox API docs (context, console.log, return, rlm, __rlm, __ctx)
                    ~1200 chars   Sandbox Globals (arc-compound-global-docs.md via globalDocs)
                    ~500 chars    Available Models table
<rlm-context>        ~200 chars   "Agent root-xxx -- depth 0 of 2. You are the root orchestrator."
<rlm-rules>          ~400 chars   Behavioral invariants (one block, verify before return, await rlm, etc.)
<rlm-program>       ~14,400 chars The arc2-orchestrator.md body (including frontmatter)
```

**Total: ~18,500 chars (~4.6K tokens)**

When `--program arc2-compound` is used, the program loader also injects `program.md`'s body (~5,000 chars of state schemas, composition, and invariants) as `globalDocs`, which is appended inside `<rlm-environment>`. This means the orchestrator sees the full `&Library` schema, composition diagram, and program invariants twice: once in globalDocs and once in its own plugin body.

### How it differs from v1.1.0

No structural change. The system prompt construction code (`buildSystemPrompt()`) is identical. The difference is purely in the `<rlm-program>` content -- the v1.2.0 orchestrator plugin was rewritten based on v1.1.0 analysis findings.

---

## 2. Child Prompt Structure

### What the solver sees

Children spawned via `rlm(query, undefined, { app: "arc2-solver", maxIterations: 18 })` receive the FULL `buildSystemPrompt()` treatment. The child's system prompt is:

```
<rlm-preamble>      ~700 chars    Identical to root -- identity, interpreter, program constructs
<rlm-environment>   ~800 chars    Sandbox API (minus rlm() delegation, since depth 1 at maxDepth 2...
                                  actually canDelegate = depth < maxDepth = 1 < 2 = true, so rlm() IS included)
                    ~1200 chars   Sandbox Globals (same globalDocs as root)
<rlm-context>        ~250 chars   "Agent child-xxx -- depth 1 of 2. Parent: root-xxx."
<rlm-rules>          ~400 chars   Identical behavioral invariants
<rlm-program>       ~14,600 chars The arc2-solver.md body (including frontmatter)
```

**Total: ~18,000 chars (~4.5K tokens)**

### Do children see the RLM base context?

**Yes, fully.** Children receive the same `<rlm-preamble>`, `<rlm-environment>`, and `<rlm-rules>` sections as the root. They see:
- How `console.log()` works and why it matters (observable output)
- How `return()` works and the verification requirement
- The "one javascript block per response" rule
- The sandbox persistence model (variables survive across iterations)
- The `__rlm` metadata object (depth, maxDepth, iteration, etc.)
- The `globalDocs` content (task data globals, library schema, submission API)

This is a strength of the architecture -- children are not stripped-down. They have full context about the execution model.

### Child context gap

**Minimal.** The primary context gap is NOT about the base RLM framing (which children receive in full) but about **inter-agent coordination**. The solver plugin says it reads `&Library` and writes to `taskLog`, but the solver does not know WHY the orchestrator needs specific fields in the taskLog entry. The solver writes `approach` and `keyInsight` because the plugin says to, but it does not know these are consumed by the orchestrator's diagnostic retry prompt.

In v1.2.0, this gap is acceptable -- the solver plugin's "Write Discoveries to the Task Log" section provides enough structure. All 5 solver invocations wrote valid taskLog entries.

---

## 3. Prompt Length and Context Limits

### System prompt sizes

| Agent | Program section | GlobalDocs | Base prompt | Total |
|-------|----------------|------------|-------------|-------|
| Root (orchestrator) | ~14,400 chars | ~1,200 chars | ~2,400 chars | ~18,000 chars |
| Child (solver) | ~14,600 chars | ~1,200 chars | ~2,400 chars | ~18,200 chars |

**Within budget.** At ~4.5K tokens each, system prompts occupy roughly 3-5% of Claude Opus 4.6's context window. Not a concern.

### Output length truncation

**6 out of 26 iterations were truncated** (response cut off mid-content, not ending with a closing code fence). This is the most significant structural problem in the run:

| Agent | Iter | Reasoning chars | Blocks | What was lost |
|-------|------|----------------|--------|---------------|
| Child 1 (135a2760) | 1 | 21,176 | 8 | Mid-comment about "starting positions of..." |
| Child 2 (136b0064) | 0 | 21,295 | 8 | Mid-code: `for (let r = r0; r < r` |
| Child 2 (136b0064) | 1 | 20,933 | 6 | Mid-comment about path tracing |
| Child 2 (136b0064) | 2 | 20,480 | 2 | Mid-comment about center coordinates |
| Child 3 (0934a4d8 retry) | 1 | 20,988 | 8 | Mid-template-literal in console.log |
| Child 4 (135a2760 retry) | 1 | 22,777 | 6 | Mid-comment about period detection |

**Pattern:** All truncated responses are between 20,480 and 22,777 chars of reasoning. This strongly suggests the model hits a **max output token limit** (~5,700 tokens) on these responses. The truncation happens within code blocks, meaning the model was generating code when it hit the limit.

**Impact:** Truncation is strongly correlated with multi-block execution. All truncated iterations had 2-8 code blocks -- the model was writing extensive multi-block exploration sessions that exceeded the output limit. When truncated:
- The last code block is incomplete and cannot execute
- The model loses the opportunity to write a return/verification block
- The next iteration must recover from seeing error output or missing context

**Comparison to v1.1.0:** The v1.1.0 analysis reported "5 out of 26 hit output length limit" as `finish=length`. v1.2.0 has 6 out of 26 truncated -- slightly worse. The truncation problem was NOT addressed by the v1.2.0 prompt changes.

### Unnecessary content in prompts

The `<rlm-environment>` section describes:
- `context` -- unused (all ARC-2 state flows through globalThis)
- `__ctx.shared.data` -- unused
- `__ctx.local` and `__ctx.readLocal()` -- unused

This is ~300 chars of irrelevant content per agent. Not harmful but adds noise.

---

## 4. Instruction Compliance

### "One ```javascript block per response" (in `<rlm-rules>`)

**Systematically violated.** Every iteration across all agents used multiple code blocks:

| Agent | Iters | Blocks | Avg blocks/iter | Single-block iters |
|-------|-------|--------|-----------------|-------------------|
| Root (orchestrator) | 2 | 17 | 8.5 | 0 |
| Child 0 (0934a4d8) | 2 | 13 | 6.5 | 0 |
| Child 1 (135a2760) | 3 | 23 | 7.7 | 0 |
| Child 2 (136b0064) | 5 | 22 | 4.4 | 0 |
| Child 3 (0934a4d8 retry) | 10 | 38 | 3.8 | 1 (iter 9) |
| Child 4 (135a2760 retry) | 4 | 21 | 5.3 | 0 |
| **Total** | **26** | **134** | **5.2** | **1** |

Only 1 out of 26 iterations (child 3, iter 9 -- the final return) used a single code block. The "one block per response" rule was effectively ignored.

**Comparison to v1.1.0:** v1.1.0 reported 3-13 blocks per iteration. v1.2.0 has the same range (1-12). The stronger v1.2.0 rule text did NOT improve compliance. The v1.2.0 orchestrator plugin added "Each iteration processes exactly ONE task" and "STOP and let the next iteration handle the next task" but the orchestrator still wrote 8 blocks in iter 0 (processing all 3 tasks plus retries).

This is the most significant compliance failure, unchanged from v1.1.0.

### "Write one focused function that tests one idea" (solver Critical Rule #3)

**Partially followed, with decay.** Solvers generally started each iteration with focused exploration, but then wrote multiple functions in the same response. The pattern:

- **First code block:** Usually focused (read data, test one hypothesis)
- **Blocks 2-4:** Related follow-up (refine the hypothesis, test variations)
- **Blocks 5+:** Verification, library storage, and return -- jumping ahead to conclusions

Child 3 (0934a4d8 retry) showed the best compliance trajectory: blocks per iteration decreased from 12 -> 8 -> 4 -> 2 -> 2 -> 3 -> 2 -> 2 -> 2 -> 1. By iteration 4, it had settled into 2-block iterations (one exploration + one verification). This suggests that agents learn the pattern over time within a session but start with bad habits.

### "VERIFY-THEN-RETURN" (solver contract + Critical Rule #4)

**Violated in every solver invocation.** All 5 children put verification code and `return()` in the same iteration at least once:

| Child | Task | Violation count | Description |
|-------|------|----------------|-------------|
| 0 | 0934a4d8 | 2/2 iters | Both iters had verify + return |
| 1 | 135a2760 | 2/3 iters | Iter 0 and iter 2 had verify + return |
| 2 | 136b0064 | 1/5 iters | Iter 4 had LOO + return (but standard verification was in iter 3) |
| 3 | 0934a4d8 retry | 2/10 iters | Iter 0 and iter 9 had verify + return |
| 4 | 135a2760 retry | 2/4 iters | Iter 0 and iter 3 had verify + return |

The v1.2.0 solver plugin emphasizes this rule in FOUR places:
1. `ensures:` clause: "VERIFY-THEN-RETURN: NEVER write verification code and return() in the same iteration"
2. `Self-Verification` section: separate code blocks for verification and return
3. `Return` section: "This MUST be in a separate iteration from verification"
4. Critical Rule #4: "VERIFY-THEN-RETURN. Run verification in one iteration..."

Despite quadruple emphasis, the rule was still violated. The root cause: when a solver writes 6+ code blocks per iteration, the verification block and return block naturally end up in the same response. The multi-block problem cascades into VERIFY-THEN-RETURN violations.

**Comparison to v1.1.0:** The v1.1.0 analysis does not quantify VERIFY-THEN-RETURN violations explicitly (it was introduced as a recommendation). v1.2.0 added the rule but compliance is near-zero. The rule is incompatible with multi-block execution.

### "Observable reasoning" (solver Critical Rule #7)

**Partially followed, with degradation over iterations.** Console.log vs comment ratios across all solver iterations:

| Iteration | Avg log/(log+comment) ratio |
|-----------|----------------------------|
| 0 | 0.43 (moderate) |
| 1 | 0.33 (declining) |
| 2+ | 0.20 (poor) |

The orchestrator (root) had the best ratio at 0.78 in iter 0, likely because the illustrative code used `console.log()` extensively. Solvers started at 0.41-0.53 and declined to 0.04-0.17 in later iterations. Child 2 (136b0064) in iter 2 had a 0.04 ratio -- 10 console.logs vs 275 comments. At that point, the solver was essentially "thinking in comments" rather than producing observable output.

**Comparison to v1.1.0:** Not measured in v1.1.0. This is a new metric. The degradation pattern suggests that as solvers encounter harder reasoning (mid-session), they shift from executable observations to inline commentary. The rule "Write findings as console.log() calls, not // comments" is acknowledged but not sustained.

---

## 5. Contract Interpretation

### `ensures:` clauses

**Orchestrator -- mostly followed:**

| Clause | Status | Evidence |
|--------|--------|----------|
| Library grows after every delegation | YES | Primitives went 0 -> 2 -> 3 across pass@1 |
| Sanity check before submission | YES | Ran dimensions, colors, non-triviality checks for all 4 submissions |
| try-catch around rlm() | YES | All 5 delegations wrapped in try-catch |
| Retry prompt includes previous approach | YES | Pass@2 queries included `prevApproach` and `prevInsight` |
| Anti-patterns from ground truth | YES | Recorded anti-patterns after `result.correct === false` |
| Strategies from ground truth | YES | Only promoted strategy for 136b0064 (the one correct submission) |
| After return, do not start solving | **NO** | Iter 1 directly solved task 0934a4d8 after the early return intercept |
| Surplus budget: return immediately | **NO** | Used 8 remaining iterations for direct solving |
| Return format | YES | `return(JSON.stringify(__arcSubmit.getResults()))` |

**Solver -- partially followed:**

| Clause | Status | Evidence |
|--------|--------|----------|
| Each iteration tests one hypothesis | MIXED | First iterations tested multiple hypotheses across code blocks |
| Abandon hypothesis failing pair 0 | YES | Solvers moved on from failing hypotheses quickly |
| VERIFY-THEN-RETURN | **NO** | Violated in every invocation (see Section 4) |
| solved=true requires ALL checks seen | MIXED | Children returned solved=true with multi-block verification |
| Change approach after 3 iters no progress | YES | Child 3 pivoted strategies multiple times |
| Check library before writing from scratch | YES | All 5 solvers checked library in first code block of iter 0 |
| One taskLog entry at end | YES | All 5 wrote exactly one entry |
| Return JSON: { solved, confidence, answer } | YES | All 5 returned valid JSON |

### `requires:` clauses

**Fully satisfied.** All preconditions were met by the harness:
- `__arcCurrentTask` was set before each delegation
- `__arcTasks[taskId]` had valid train and test data
- `__arcLibrary` existed with correct shape

### `prohibited:` sections

**Fully respected.** No solver invocation called `__arcSubmit.submit()`, `__arcSubmit.remaining()`, or `__arcSubmit.getResults()`. The prohibition was effective across all 5 invocations. This matches v1.1.0 -- prohibited APIs have 100% compliance across both versions.

### `shape:` declarations

**Violated in iteration 1.** The orchestrator's shape declaration says:
```
prohibited: [solving tasks directly -- do not analyze grids or write transforms]
```

After the early return intercept in iter 0, the orchestrator spent all of iter 1 (9 code blocks) directly analyzing task 0934a4d8: finding symmetry axes, testing H/V/180-rot mirrors, building a transform, and attempting submission. This is an identical violation to v1.1.0.

**v1.2.0 added two new ensures clauses to address this:**
```
- AFTER RETURN: Once you have called return(), your job is done.
- SURPLUS BUDGET: If you finish all passes with iterations remaining, return immediately.
```

These were both violated. The orchestrator interpreted the early return interception ("Verify this is correct by examining the data before returning") as an invitation to do more work, overriding the "do not start solving" instruction.

---

## 6. Comparison to v1.1.0

### What improved

1. **Orchestrator one-task-per-iteration design:** The v1.2.0 plugin restructured the illustrative code to show "EACH ITERATION: Process one task" with explicit "STOP HERE" comments. However, the orchestrator still ran all tasks in iter 0 with 8 code blocks. The STOP markers were ignored.

2. **Ground-truth curation:** The v1.2.0 plugin added `ANTI-PATTERNS FROM GROUND TRUTH` and `STRATEGIES FROM GROUND TRUTH` invariants. These were followed -- the orchestrator only promoted strategies after `result.correct === true` and recorded anti-patterns after `result.correct === false`. In v1.1.0, curation was based on solver self-report.

3. **Diagnostic retry prompts:** v1.2.0 retry prompts included prior approach, failure insight, and available primitive listing. The `primList` with doc strings was a new addition. All retry queries followed this format.

4. **Solver library checking:** All 5 solvers checked library primitives in their first code block, following the "Check Library FIRST" invariant. In v1.1.0, child 0 (first solver) wrote from scratch because the library was empty, which was correct behavior but not observable as compliance. In v1.2.0, even child 0 printed "Available primitives: (none)" before proceeding.

5. **Honest failure reporting:** Child 3 (0934a4d8 retry, 10 iterations) returned `solved=false, confidence=0.7` after failing to resolve out-of-bounds cells. This prevented a wasted submission. In v1.1.0, the equivalent solver returned `solved=true` with a wrong answer, costing a submission.

### What regressed

1. **Score: 1/3 vs 2/3.** The v1.1.0 run scored 67% (2/3 correct). The v1.2.0 run scored 33% (1/3 correct). The same three tasks were attempted. The regression is primarily on task 135a2760:
   - **v1.1.0:** Solved on pass@2 retry (pattern repair via 2D tiling, with corrected segment logic)
   - **v1.2.0:** Failed on both passes. Child 1 (pass@1) returned solved=true with a wrong answer (incorrect panel repair). Child 4 (pass@2) also returned solved=true with a wrong answer.

   Task 0934a4d8 failed in both versions (same OOB edge case). Task 136b0064 succeeded in both (snake path drawing).

2. **False positive rate:** In v1.2.0, 4 out of 5 solver invocations returned `solved=true` with `confidence=1.0`. Three of these were wrong (child 0, child 1, child 4). The solvers verified against training pairs but their transforms did not generalize to test inputs. The VERIFY-THEN-RETURN rule, which was supposed to catch this, was violated in all cases.

3. **Truncation frequency:** 6/26 iterations truncated in v1.2.0 vs 5/26 in v1.1.0 (inferred from the v1.1.0 analysis). Slightly worse despite no change in the underlying engine.

### What stayed the same

1. **Multi-block execution:** Unchanged. 5.2 blocks/iteration average in v1.2.0. The v1.2.0 prompt added stronger language ("exactly ONE task per iteration", "STOP HERE") but the model ignored it identically.

2. **Shape violation after early return:** Both versions had the orchestrator directly solve a task after the early return intercept. The v1.2.0 "AFTER RETURN" and "SURPLUS BUDGET" ensures clauses were insufficient.

3. **First-iteration bulk execution:** The orchestrator ran the entire session (3 pass@1 tasks + 2 retries + return) in a single iteration with 8 code blocks. Identical pattern to v1.1.0.

4. **Prohibited API compliance:** 100% in both versions. No solver touched `__arcSubmit`.

---

## 7. Structural Improvements

### A. Multi-block execution requires engine enforcement (Critical)

**The prompt-only approach has failed twice.** v1.1.0 said "One javascript block per response. Stop and wait for output." v1.2.0 added "Each iteration processes exactly ONE task" and "STOP HERE" markers. Neither worked. The model writes 5-12 blocks per response because:

1. The model's training optimizes for completing a coherent "thought" per response
2. ARC tasks invite extended exploration (try multiple ideas before reporting)
3. The illustrative code itself shows multi-step procedures (setup + delegate + validate + submit + curate), which the model replicates in a single response

**Engine-level enforcement is required.** The `maxBlocksPerIteration` parameter already exists in the engine. Setting it to 1-2 would force the model to iterate. Alternatively, the engine could execute only the FIRST code block per response and discard the rest.

**Impact estimate:** Fixing multi-block execution would cascade into fixing:
- VERIFY-THEN-RETURN violations (return would be in a separate iteration by necessity)
- Output truncation (shorter responses would not hit the token limit)
- Observable reasoning (fewer comments, since each iteration produces observable output)

### B. VERIFY-THEN-RETURN needs structural support (High)

**The rule is well-stated but physically impossible to follow when multi-block is allowed.** If the model writes 6 blocks in one response, it naturally includes verification (blocks 4-5) and return (block 6) together. The model cannot "stop and see verification output" when it is already generating the next block.

**Fix:** This becomes automatic if multi-block is limited to 1 per iteration. Alternatively, the engine could intercept `return()` calls and inject a "verification required" message if the same iteration also contained verification code.

### C. Post-return shape enforcement (High)

**The early return interception mechanism creates a perverse incentive.** When the harness says "Verify this is correct by examining the data before returning," the model interprets this as "do more work." Adding `ensures:` clauses about not starting new work was insufficient.

**Proposed fix options:**
1. **Change the interception message.** Instead of "Verify this is correct by examining the data before returning," say: "Your return value was received. If it is correct, call return() again with the same value. Do not start new work."
2. **End the session after return() on non-first iterations.** The first-iteration intercept is useful (prevents premature returns). But if the orchestrator returns in iter 0 and then returns the same value in iter 1, accept it immediately.
3. **Add a "return confirmed" flag to the orchestrator plugin.** The plugin could track `globalThis.__returnConfirmed = true` and include: "If __returnConfirmed is set, call return() immediately."

### D. Illustrative code creates single-iteration pressure (Medium)

**The orchestrator plugin shows a complete session loop in the "Main Loop" section.** Despite v1.2.0 restructuring the code into "one task per iteration" with "STOP HERE" comments, the model sees the full template and copies it into a single mega-block. The setup, main loop, pass@2 transition, and return sections together form a complete session template that fits in one response.

**Proposed fix:** Split the illustrative code across multiple sections with strong separation, and add iteration-awareness:

```
## Iteration 1: Setup
[just the setup code]
// After this code, STOP. Your next iteration will process the first task.

## Each subsequent iteration: One Task
[just the single-task code]
// After this code, STOP. Your next iteration will process the next task.

## When all pass@1 tasks are done: Transition
[just the transition code]
// After this code, STOP. Your next iteration will process the first retry.

## Final iteration: Return
[just the return code]
```

This structural change makes it harder for the model to copy-paste the entire session into one block, because no single section contains the complete flow.

### E. Observable reasoning enforcement (Medium)

**Comment-to-log ratio degrades across iterations.** The solver starts with reasonable console.log usage (~0.43 ratio) but degrades to ~0.15 by later iterations. The model shifts from executable observations to inline reasoning as problems get harder.

**Proposed fix:** Add a concrete rule: "Your code MUST contain at least one console.log() call. Comments are invisible to you -- they are lost after this iteration. Any reasoning you need for the next iteration must be in console.log()."

This reframes the rule from "you should use console.log" (normative, easily ignored) to "comments are lost" (factual consequence, harder to ignore). Per the LANGUAGE.md principle "Declarative > normative."

### F. Reduce globalDocs redundancy (Low)

The globalDocs (`arc-compound-global-docs.md`, ~1,200 chars) duplicates content from both plugins:
- Task data globals documented in globalDocs AND in both plugins' "Read the Environment First" sections
- `__arcSubmit` API documented in globalDocs AND in orchestrator's "The Environment" section AND in solver's "What You Cannot Do" section
- Library shape documented in globalDocs AND in `program.md`'s `&Library` schema

For the orchestrator, globalDocs is pure redundancy. For the solver, it provides the only explicit API documentation for `__arcSubmit` (which the solver should not call but benefits from understanding).

**Proposed fix:** Reduce globalDocs to ~400 chars listing only the variable names and types, with "see plugin for details." The plugins already contain the detailed documentation.

---

## 8. The False Positive Problem

v1.2.0 exposed a new failure mode not prominent in v1.1.0: **solvers returning `solved=true` with wrong answers that pass training verification but fail on test inputs.**

| Child | Task | solved | confidence | Training correct? | Test correct? |
|-------|------|--------|-----------|------------------|---------------|
| 0 | 0934a4d8 | true | 1.0 | YES (hallucinated) | NO |
| 1 | 135a2760 | true | 1.0 | YES | NO |
| 2 | 136b0064 | true | 1.0 | YES | YES |
| 3 | 0934a4d8 | false | 0.7 | partial | NO |
| 4 | 135a2760 | true | 1.0 | YES | NO |

Three of four `solved=true` returns were wrong. The solvers verified their transforms against all training pairs (and saw "CORRECT" in output), but the transforms were overfit or misidentified.

**Root cause:** The VERIFY-THEN-RETURN violation means solvers never pause to REVIEW verification output before deciding to return. They write verification code and return code in the same response, meaning they decide to return BEFORE seeing whether verification passed. The verification code and the return code are written as a single "completion" -- the model assumes verification will pass.

Child 0 is the clearest example: it wrote 7 code blocks in iter 0 including full verification AND return. The output showed a `TypeError` error (verification code crashed), but the return block had already been written and executed. The model never had a chance to see the error and decide not to return.

**This is a structural problem, not a prompt problem.** No amount of prompt rewording will fix it while multi-block execution is allowed. The model fundamentally cannot "see output and then decide" when it writes multiple blocks in a single response.

---

## Summary

### Compliance scorecard

| Rule | v1.1.0 | v1.2.0 | Change |
|------|--------|--------|--------|
| One block per response | 0% | 4% (1/26) | No change |
| Prohibited APIs | 100% | 100% | Held |
| Shape (no direct solving) | Violated (iter 1) | Violated (iter 1) | No change |
| Sanity checks before submit | Followed | Followed | Held |
| try-catch around rlm() | Followed | Followed | Held |
| Ground-truth curation | Not measured | Followed | New rule, followed |
| VERIFY-THEN-RETURN | Not specified | 0% (0/5 children) | New rule, ignored |
| Observable reasoning | Not measured | Degrades over time | New measurement |
| Library checking | Followed | Followed | Held |
| TaskLog writes | Followed | Followed | Held |

### Key insight

**The v1.2.0 changes improved the CONTENT of the plugins (better contracts, ground-truth curation, honest failure reporting) but did NOT improve BEHAVIORAL compliance (multi-block, VERIFY-THEN-RETURN, shape).** Behavioral rules that conflict with the model's natural generation pattern (write a complete thought per response) cannot be enforced through prompt text alone. They require engine-level support (block limits, return interception, iteration pacing).

The score regression (67% -> 33%) is NOT caused by prompt changes. It is stochastic variation on a 3-task sample. The solver's false positive problem (returning solved=true with wrong answers) existed in v1.1.0 too (child 0 hallucinated verification). v1.2.0 made it more visible by adding the VERIFY-THEN-RETURN contract, which now clearly measures the violation rate.

### Priority recommendations

1. **Engine: enforce maxBlocksPerIteration=1** -- This single change would fix multi-block execution, VERIFY-THEN-RETURN violations, and output truncation simultaneously.
2. **Engine: modify early-return interception message** -- Change from "Verify this is correct" to "Call return() again with the same value if correct."
3. **Plugin: restructure illustrative code** -- Split into iteration-scoped sections that cannot be copy-pasted as a single session.
4. **Plugin: reframe observable reasoning** -- "Comments are lost after this iteration" instead of "Write findings as console.log()."
