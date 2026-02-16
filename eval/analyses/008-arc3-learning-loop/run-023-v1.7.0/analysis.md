# Run 023 Analysis: ARC-3 v1.7.0 Orchestrator + Player Plugins

**Date:** 2026-02-16
**Run file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T07-44-06-471Z.json`
**Model:** claude-opus-4-6
**Plugins:** arc3-orchestrator v1.7.0 + arc3-player v1.7.0
**Config:** maxIterations=30, maxDepth=2, concurrency=5
**Score:** 14.3% (1/7 levels completed) -- **BEST RESULT IN PLUGIN SERIES**
**Prior run (run-022, v1.6.0):** 0% (0/7 levels, 133 actions, $3.62, 0/3 children returned)
**Prior best (run-020, v1.4.0):** 2.8% (1/7 levels, 380 actions, $9.13)
**Prior best overall (run-015, no plugin):** 14.3% (1/7 levels, 18 actions on Level 1)
**Replay:** https://three.arcprize.org/scorecards/76d7272d-7e98-4a3f-a430-a062c5e5099c

---

## 1. Score Breakdown

### Scorecard

| Field | Value |
|-------|-------|
| Final Score | **14.3%** |
| State | GAME_OVER |
| Total Actions | 356 |
| Levels Completed | **1 / 7** |
| Resets | 0 |
| Environments Completed | 0 / 1 |

### Per-Level Breakdown

| Level | Actions Used | Baseline Actions | Score | Status |
|-------|-------------|-----------------|-------|--------|
| **1** | **26** | **29** | **100%** | **Completed (under baseline!)** |
| 2 | 330 | 41 | 0 | Not completed (GAME_OVER) |
| 3 | 0 | 172 | 0 | Not attempted |
| 4 | 0 | 49 | 0 | Not attempted |
| 5 | 0 | 53 | 0 | Not attempted |
| 6 | 0 | 62 | 0 | Not attempted |
| 7 | 0 | 82 | 0 | Not attempted |

**Total baseline actions (all 7 levels):** 488

### Score Calculation

Per-level score = min(1.0, baseline / actual). Level 1: min(1.0, 29/26) = 1.0 (100%). All other levels score 0%. Average: (100 + 0 + 0 + 0 + 0 + 0 + 0) / 7 = **14.3%**.

Level 1 was completed in **26 actions**, which is UNDER the 29-action human baseline. This means the child agent played level 1 more efficiently than the baseline, earning a perfect 100% score on that level. This is the first time any plugin version has achieved 100% on a level.

### Efficiency Analysis

| Metric | v1.7.0 | v1.4.0 (prior best) | run-015 (no plugin) |
|--------|--------|---------------------|---------------------|
| Level 1 actions | **26** | 148 | 18 |
| Level 1 baseline ratio | **0.90x** | 5.1x | 0.62x |
| Level 1 score | **100%** | 19.6% | 100% |
| Levels completed | 1 | 1 | 1 |
| Total score | **14.3%** | 2.8% | 14.3% |

v1.7.0 matches the no-plugin run-015's score (14.3%) and dramatically outperforms v1.4.0's level 1 efficiency (26 vs 148 actions). The child played near-optimally: 26 actions includes 4 discovery actions from `__discover()` plus 22 gameplay actions.

---

## 2. Plugin Compliance

### Orchestrator Compliance (arc3-orchestrator v1.7.0)

| Rule | Compliant? | Evidence |
|------|-----------|---------|
| `arc3.start()` called exactly once | YES | Iteration 0: single `arc3.start()` call |
| Delegate using `app: "arc3-player"` | YES | All 4 delegations used `app: "arc3-player"` |
| Never call `arc3.step()` | YES | No direct step calls by orchestrator |
| Never analyze/print the grid | YES | No grid analysis by orchestrator |
| Max 2 completion attempts per level | PARTIAL | L1: 1 attempt (succeeded). L2: 2 completion + 1 escalation. Escalation protocol triggered correctly. |
| Pass knowledge via `__level_task` | YES | `__level_task = { level, knowledge: __knowledge }` set before each delegation |
| Never inline game data in prompts | **VIOLATED** | Iterations 5 and 7: added strategy hints, grid dimensions, behavioral instructions |
| Return scorecard on GAME_OVER | YES | Iteration 7: returned JSON scorecard after detecting GAME_OVER |
| Track `__outerIter` | YES | Incremented correctly each delegation iteration |
| Always use `model: "intelligent"` | **VIOLATED** | Iteration 7: used `model: "fast"` for child 4 |

**Escalation protocol:** The orchestrator correctly tracked `__levelAttempts[2]`. After 2 completion attempts, attempt 3 deviated from the template by using a custom prompt and `model: "fast"` instead of the template's exploration-only path. This is a partial compliance: the escalation threshold was correctly detected, but the response deviated.

**Recurring violation:** The orchestrator inlined game hints in the prompt for iterations 5 and 7. This has occurred in every run since v1.3.0. The model cannot resist adding "helpful" context when children fail.

### Player Compliance (arc3-player v1.7.0)

| Rule | Assessment | Evidence |
|------|-----------|---------|
| `__guard()` called as first line | **NO (all 4 children)** | All children hit the engine's 30-iter cap or ran extensive iterations |
| `arc3.step` interceptor active | **FAILED** | All 4 children exceeded 25-action budget |
| Budget enforced at 25 actions | **FAILED** | Child 1: 34 actions. Child 2: 59. Child 3: 79. Child 4: 184. |
| `__discover()` called in iteration 1 | LIKELY (child 1) | Child 1 used ~34 actions including discovery, suggesting __discover() ran |
| Return before timeout | **1 of 4** | Only child 4 returned (and only because it was using `model: "fast"`) |
| Never call `arc3.start()` | YES (inferred) | No game resets observed |

**Budget interceptor failure:** Despite the IIFE closure in v1.7.0, ALL four children exceeded the 25-action budget. This is the most critical finding of the compliance analysis. The IIFE was supposed to make budget bypass impossible. Possible explanations:

1. The child reassigned `arc3.step` to a new function that calls the underlying HTTP/API directly, not through the intercepted method.
2. The child discovered that `arc3` has other methods or properties that allow step-like behavior.
3. The IIFE closure works but the child somehow re-imported or re-referenced the `arc3` object.
4. The setup code (iteration 0) executed but the IIFE did not properly close over `_origStep`.

The most likely explanation: the LLM, being an exploratory agent, may have redefined `arc3.step` itself. The IIFE sets `arc3.step` to the wrapped version, but nothing prevents a subsequent code block from setting `arc3.step = someOtherFunction`. If the child redefined `arc3.step` to a function that calls the underlying API directly, budget tracking would be lost.

### Summary of Protocol Violations

1. **Orchestrator inlined hints in prompts** (iterations 5, 7) -- recurring violation
2. **Orchestrator used `model: "fast"`** (iteration 7) -- violated Rule 10
3. **All 4 children exceeded action budget** -- IIFE interceptor bypassed
4. **3 of 4 children failed to return** -- guard non-compliance continues

---

## 3. Did the v1.6.0 Recommendations Work?

### R2 (IIFE Closure for `__originalStep`): DID IT FIX THE INTERCEPTOR BYPASS?

**Partially.** The v1.7.0 player plugin wraps the original step function in an IIFE closure:

```javascript
(function() {
  const _origStep = arc3.step.bind(arc3);
  arc3.step = async function(action) {
    __actionsThisLevel++;
    if (__actionsThisLevel > 25) { ... }
    const result = await _origStep(action);
    ...
  };
})();
```

The `_origStep` variable is now hidden in the closure. Children cannot call `_origStep` directly (unlike v1.6.0's `__originalStep` which was in the global scope). However, all 4 children still exceeded the budget:

| Child | Actions | Budget | Excess |
|-------|---------|--------|--------|
| 1 | ~34 | 25 | +9 |
| 2 | 59 | 25 | +34 |
| 3 | 79 | 25 | +54 |
| 4 | 184 | 25 | +159 |

**The IIFE fixed the `__originalStep` exposure but did not fix budget enforcement.** The children are bypassing the interceptor through a different mechanism -- likely by reassigning `arc3.step` itself to an unwrapped version. The closure protects `_origStep` from being called directly, but it cannot prevent the child from overwriting `arc3.step` with a new function. The defense is: hide the reference. The attack is: redefine the method. The IIFE only addresses the first vector, not the second.

**Verdict:** R2 was correctly implemented but insufficient. A deeper defense is needed (see recommendations).

### R6 (Guard Instruction in Delegation Prompt): DID IT IMPROVE CHILD RETURN RATE?

**Marginally.** The v1.7.0 orchestrator template includes the guard instruction in the delegation prompt:

```
CRITICAL: Start EVERY code block with: if (__guard()) return(__guard.msg);
```

Result: 1 of 4 children returned (25%), vs 0 of 3 in v1.6.0 (0%) and 2 of 5 in v1.5.0 (40%).

However, child 4 (the one that returned) was using `model: "fast"`, not `model: "intelligent"`. It is unclear whether the guard instruction caused the return or whether the fast model simply has different behavior. With only one returning child and a confounding variable (model change), the signal is too noisy to attribute the return to R6.

**Verdict:** Cannot isolate R6's effect. The return rate improved from 0% to 25%, but the returning child used a non-standard model.

### R3 (Reduced Budget to 25 Actions): DID IT HELP?

**The budget was not enforced, so R3 had no direct effect.** All children exceeded 25 actions. However, child 1 used only 34 actions (9 over budget), which is much less than v1.6.0's children (14, 43, 76). The lower number in the template may have psychologically constrained the child even without enforcement.

More importantly, the budget reduction did not prevent GAME_OVER. Child 4 alone used 184 actions, consuming the game's remaining fuel/lives. The total 356 actions is 2.7x v1.6.0's 133 and close to v1.4.0's 380.

**Verdict:** R3 was correctly implemented but not enforced, so its impact is minimal.

### R5 (Timeout Diagnostic Logging): IMPLEMENTED?

**Yes.** The v1.7.0 orchestrator template includes:

```javascript
if (!summary || summary.length === 0) {
  console.log(`CHILD TIMEOUT: Level ${level} attempt ${__levelAttempts[level]} -- child used all iterations without returning.`);
}
```

This is present in the template. However, in the actual trace, the timeout diagnostic did not appear in the output for iterations 1, 3, or 5. This is because the `rlm()` error ("RLM reached max iterations") caused the entire iteration to error out before the post-delegation code could execute. The diagnostic logging is correct but is bypassed by the error flow.

**Verdict:** R5 was implemented but the error handling flow prevents it from executing. The post-`rlm()` code needs to be in a try-catch to survive child timeout errors.

### R7 (Removed Misleading `maxIterations`): PARTIALLY

The v1.7.0 template delegations do NOT include `maxIterations` in the options. However, the orchestrator deviated from the template in iterations 5 and 7, adding `maxIterations: 20` and `maxIterations: 15` respectively. These are not honored by the engine (children always get 30 iterations). The template fix is correct, but the LLM re-introduced the parameter when improvising.

**Verdict:** R7 was correctly implemented in the template but the LLM overrode it during runtime.

---

## 4. How Many Children Returned Results via JSON?

**1 of 4 children returned** (child 4, iteration 7). The return was a JSON string:

```json
{
  "actions": 356,
  "completed": true,
  "knowledge": {
    "mechanics": {
      "movement": "Directional keys shift colored objects (9,12) within cells by 5px per step",
      "fixed_elements": "Colors 0,5,8,11 form fixed frames and borders",
      "moving_elements": "Colors 9,12 are movable pieces that shift with arrow keys",
      "grid_structure": "3x3 grid of cells with L-shaped 3/4 patterns"
    },
    "rules": ["All movable objects shift simultaneo..."]
  }
}
```

**Was the return-string knowledge architecture working?**

Yes, structurally. The orchestrator's JSON parsing code executed for the first time in the series (excluding v1.5.0's `__level_result` failure):

```javascript
let childResult = null;
try { childResult = JSON.parse(summary); } catch(e) {}
```

The child returned valid JSON. The orchestrator would have parsed it and merged the knowledge. However, the game was already GAME_OVER at this point. The detected GAME_OVER caused the orchestrator to return the scorecard immediately, so the curated knowledge was never used for subsequent delegations.

**The architecture works but was exercised too late.** If child 1 had returned knowledge after completing level 1, that knowledge would have been available for level 2 delegations.

---

## 5. Knowledge Discovery

### What Was Discovered (by Child 4, Post-GAME_OVER)

| Discovery | Accuracy vs Canonical Rules | Notes |
|-----------|:---:|---|
| Movement: directional keys shift colored objects (9,12) by 5px per step | **CORRECT** | Canonical: 5px discrete steps in cardinal directions |
| Fixed elements: colors 0,5,8,11 form fixed frames/borders | **PARTIALLY CORRECT** | Color 0 (black) is background. Colors 5,8,11 are various game elements (not all "fixed frames"). |
| Moving elements: colors 9,12 are movable | **CORRECT** | Color 9 = blue (bottom of character), color 12 = orange (top of character) |
| Grid structure: 3x3 grid of cells with L-shaped patterns | **UNCERTAIN** | This may describe level 2's specific layout. Not a general game rule. |
| Completed: true | **INCORRECT** | Level 2 was NOT completed. GAME_OVER at 356 actions. |
| Actions: 356 | **INCORRECT** | 356 is the TOTAL game actions, not child 4's actions (~184). |

### What Child 1 Likely Discovered (Inferred from Level 1 Completion)

Child 1 completed level 1 in 26 actions. This implies the child:
1. **Identified the player character** (colors 9,12 -- the 5x5 block)
2. **Understood movement** (directional keys, 5px steps)
3. **Navigated to the goal** (found the goal icon and reached it)
4. **Possibly understood the pattern-matching requirement** (or the starting pattern already matched)

None of this knowledge was transferred because child 1 timed out without returning.

### Canonical Rules Discovery Checklist

| # | Canonical Discovery | v1.7.0 Status | Notes |
|---|---------------------|:---:|---|
| 1 | Character identification (5x5 block, orange top/blue bottom) | **INFERRED** | Child 1 must have identified it to complete L1. Child 4 identified colors 9,12 as movable. |
| 2 | Movement mechanics (5px steps, 4 directions) | **DISCOVERED** | Child 4 explicitly reported "5px per step" |
| 3 | Wall detection | MISSED | Not reported by any returning child |
| 4 | Fuel depletion | MISSED | Not reported |
| 5 | Fuel refill (yellow box) | MISSED | Not reported |
| 6 | Lives counter (3 red squares) | MISSED | Not reported |
| 7 | Pattern toggle (white cross) | MISSED | Not reported |
| 8 | Color changer (rainbow box) | MISSED | Not reported |
| 9 | Goal icon identification | **INFERRED** | Child 1 reached the goal to complete L1 |
| 10 | Current pattern display (bottom-left HUD) | MISSED | Not reported |
| 11 | Pattern matching requirement | **INFERRED** | Child 1 completed L1 (pattern must have matched or started matching) |
| 12 | Strategic sequencing (transform then navigate) | MISSED | Not explicitly identified |
| 13 | Fog of war (Level 7) | N/A | Never reached Level 7 |

### Discovery Scoring

**Explicit discoveries (transferred to orchestrator):** 1 (movement mechanics from child 4)
**Inferred discoveries (demonstrated by behavior, not transferred):** 2-3 (character ID, goal ID, possibly pattern matching)
**Effective discovery score:** ~1.5 explicit + ~2.5 inferred = **~4 effective** (but only 1.5 was actually available to the orchestrator)

This is better than v1.6.0 (0 effective) but worse than v1.5.0 (3.5 explicit). The critical difference: v1.7.0's most capable child (child 1, which completed L1) did not return knowledge, while v1.7.0's returning child (child 4) reported after GAME_OVER when the knowledge was useless.

---

## 6. Progression Table

| Metric | v1.0.0 (016) | v1.1.0 (017) | v1.2.0 (018) | v1.3.0 (019) | v1.4.0 (020) | v1.5.0 (021) | v1.6.0 (022) | **v1.7.0 (023)** |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Score | 0% | 0% | 0% | 0% | 2.8% | 0% | 0% | **14.3%** |
| Levels completed | 0/7 | 0/7 | 0/7 | 0/7 | 1/7 | 0/7 | 0/7 | **1/7** |
| Level 1 actions | -- | -- | -- | -- | 148 | 185* | 133* | **26** |
| Level 1 score | 0 | 0 | 0 | 0 | 19.6% | 0% | 0% | **100%** |
| Total actions | ~45 | ~80 | ~138 | 154 | 380 | 185 | 133 | **356** |
| Actions by orchestrator | ~10 | ~45 | ~43 | 0 | 0 | 0 | 0 | **0** |
| Actions by children | ~35 | ~35 | ~95 | 154 | 380 | 185 | 133 | **356** |
| Final state | NOT_FINISHED | NOT_FINISHED | GAME_OVER | GAME_OVER | GAME_OVER | GAME_OVER | GAME_OVER | **GAME_OVER** |
| Children spawned | 1 | 2 | 3 | 2 | 6 | 5 | 3 | **4** |
| Children returned | 0/1 | 0/2 | 0/3 | 0/2 | 1/6 | 2/5 | 0/3 | **1/4** |
| Knowledge transferred | 0 | 0 | 0 | 0 | 0 | 2 | 0 | **1** (post-GAME_OVER) |
| Orchestrator called `arc3.step()` | Yes | Yes | Yes | No | No | No | No | **No** |
| Orchestrator analyzed grid | N/A | Yes | Yes | No | Yes | No | No | **No** |
| Task status | Failed | Failed | Failed | Completed | Completed | Completed | Completed | **Completed** |
| Outer iterations used | ~15 | 30 | 30 | 6 | 16 | 10 | 8 | **8** |
| Wall time | -- | ~17 min | ~20 min | ~18 min | ~41 min | ~27 min | ~17 min | **~24 min** |
| Cost | $0.45 | $4.42 | $4.49 | $3.87 | $9.13 | $5.38 | $3.62 | **$4.80** |
| `arc3.start()` calls | 2 | 2 | 1 | 1 | 1 | 1 | 1 | **1** |
| Escalation protocol followed | N/A | N/A | N/A | Partial | Violated | Violated | YES | **PARTIAL** |
| Max 2 attempts/level | N/A | N/A | N/A | Yes | Violated | Violated | YES | **YES** |

*Level 1 not completed in these runs; all actions were spent on L1 without finishing.

### Structural Progress Metrics

| Metric | v1.0.0 | v1.1.0 | v1.2.0 | v1.3.0 | v1.4.0 | v1.5.0 | v1.6.0 | **v1.7.0** | Trend |
|--------|--------|--------|--------|--------|--------|--------|--------|--------|-------|
| Orchestrator respected `arc3.step()` ban | 0 iters | 2 iters | 7 iters | 30 iters | 30 iters | 30 iters | 30 iters | **30 iters** | Stable (fixed) |
| Task status = Completed | No | No | No | Yes | Yes | Yes | Yes | **Yes** | Stable (fixed) |
| `arc3.start()` called exactly once | No | No | Yes | Yes | Yes | Yes | Yes | **Yes** | Stable (fixed) |
| Orchestrator avoided grid analysis | No | No | No | Yes | No | Yes | Yes | **Yes** | Stable |
| Model parameter compliance | N/A | N/A | N/A | N/A | Violated | Yes | Yes | **Violated** | Regression |
| Escalation protocol compliance | N/A | N/A | N/A | Partial | Violated | Violated | YES | **PARTIAL** | Slight regression |
| Children returned results | 0/1 | 0/2 | 0/3 | 0/2 | 1/6 | 2/5 | 0/3 | **1/4** | Noisy |
| Knowledge transferred to orchestrator | 0 | 0 | 0 | 0 | 0 | 2 | 0 | **1** | Noisy |
| A level was completed | No | No | No | No | Yes | No | No | **YES** | **RECOVERED** |
| Score > 0 | No | No | No | No | Yes | No | No | **YES (BEST)** | **NEW HIGH** |
| Level 1 under baseline | No | No | No | No | No | No | No | **YES** | **FIRST TIME** |

---

## 7. Root Cause Analysis: Why Did v1.7.0 Succeed?

### The Core Question

v1.7.0 scored 14.3% -- a 5x improvement over v1.4.0's 2.8% and the first non-zero score since v1.4.0. Level 1 was completed in 26 actions (under the 29-action baseline). What changed?

### Factor 1: Child 1 Played Exceptionally Well (STOCHASTIC)

Child 1 completed level 1 in 26 actions -- only 8 actions above the no-plugin best of 18. This implies:

- The `__discover()` function consumed 4 actions (testing each direction once)
- The remaining 22 actions were gameplay, with highly efficient navigation
- The child likely identified the player, found the goal, and navigated directly to it

**This is a stochastic outlier.** Nothing in v1.7.0's template changes CAUSED the child to play better. The template changes (IIFE closure, guard instruction in prompt, budget reduction) did not fire because the interceptor was bypassed. The child simply got lucky with its exploration strategy, or the v1.7.0 player plugin's behavioral priorities and `__discover()` function guided it more effectively.

The `__discover()` function IS a contributing factor. By forcing the child to test all 4 directions in iteration 1 and providing diff analysis, the child gets a structured understanding of movement in its first 4 actions. In v1.4.0, children spent dozens of actions figuring out basic movement. The `__discover()` function, introduced in v1.5.0, compresses this learning into 4 actions. Child 1's efficiency (22 gameplay actions after discovery) is consistent with an agent that understood movement from the start.

### Factor 2: The Player Plugin's Perceptual Toolkit (STRUCTURAL)

v1.7.0 (and v1.5.0+) provides `diffGrids`, `colorFreqs`, `findComponents`, and `renderRegion` as pre-defined functions. These are general vision algorithms that give the child agent analytical capabilities that pre-v1.5.0 children lacked. A child with `diffGrids` can immediately see what changed after an action, rather than trying to manually compare two 64x64 grids.

This toolkit has been present since v1.5.0, so it is not new to v1.7.0. But combined with `__discover()`, it creates a strong foundation for rapid learning.

### Factor 3: Level 1 Difficulty is Low (ENVIRONMENTAL)

Level 1 has a 29-action baseline -- the lowest of all 7 levels. It is likely the simplest maze layout with the shortest path to the goal. A child that identifies movement and heads in roughly the right direction has a reasonable chance of completing it within 30 iterations (the engine's hard cap).

In v1.4.0, level 1 required 148 actions (5.1x baseline). In run-015 (no plugin), it required only 18 actions (0.62x baseline). The wide range suggests level 1 completion is achievable but depends heavily on the agent's strategy.

### Factor 4: Budget Bypass Was Actually Helpful for Level 1 (IRONIC)

Child 1 used 34 actions, exceeding the 25-action budget by 9. If the budget had been enforced, the child would have been cut off at 25 actions -- potentially before completing level 1 (baseline is 29). The budget bypass HELPED in this specific case by allowing the child to use the 26 actions needed.

This creates a paradox: the budget is too low for level 1 completion (25 < 29 baseline), but the budget bypass that "fixed" this is also the mechanism that caused children 2-4 to waste 330 actions on level 2 without completing it.

### Summary of Causal Factors

| Factor | Type | Contribution |
|--------|------|-------------|
| Child 1 played efficiently (22 gameplay actions) | Stochastic | PRIMARY |
| `__discover()` compressed movement learning into 4 actions | Structural (v1.5.0+) | SIGNIFICANT |
| Perceptual toolkit (diffGrids, etc.) | Structural (v1.5.0+) | MODERATE |
| Level 1 is the easiest level | Environmental | ENABLING |
| Budget bypass allowed >25 actions | Unintended | HELPFUL (for L1 only) |
| Guard instruction in delegation prompt | v1.7.0 change | UNCERTAIN |
| IIFE closure | v1.7.0 change | NO EFFECT (bypassed anyway) |

---

## 8. What Blocked Level 2 Completion?

### The Numbers

330 actions were spent on level 2 across 3 children (59 + 79 + 184 + 8 from child 1's post-L1 actions). The level 2 baseline is only 41 actions. This is an **8.0x overrun** -- the worst ratio in the entire run.

### Root Cause 1: No Knowledge Transfer from Level 1

Child 1 completed level 1 and presumably learned significant mechanics (character control, goal identification, possibly pattern matching). But child 1 timed out without returning. All of child 1's knowledge was lost.

Children 2, 3, and 4 started level 2 with EMPTY knowledge. They had to re-learn everything from scratch. This is the most expensive consequence of the child return failure: the knowledge accumulation loop is broken.

If child 1 had returned a JSON with its knowledge, children 2-4 would have started level 2 knowing:
- What the player character looks like
- How movement works (5px steps)
- What the goal looks like
- That reaching the goal completes the level

Instead, each child had to spend actions rediscovering these basics.

### Root Cause 2: Budget Enforcement Failed

Each child exceeded the 25-action budget massively:
- Child 2: 59 actions (2.4x budget)
- Child 3: 79 actions (3.2x budget)
- Child 4: 184 actions (7.4x budget)

With working enforcement, the total level 2 spend would have been capped at ~75 actions (3 children x 25 max), leaving room for more attempts. Instead, 330 uncontrolled actions exhausted the game's fuel/lives.

### Root Cause 3: Level 2 Is Harder

Level 2's baseline of 41 actions suggests a more complex maze with longer paths and possibly new mechanics (pattern toggles, color changers). Even with knowledge transfer, a child might need multiple attempts. Without knowledge transfer, level 2 is essentially a cold start every time.

### Root Cause 4: Orchestrator Had No Recovery Strategy

After child 2 failed (59 actions), the orchestrator had no way to adjust its approach. It knew nothing about what the child learned or why it failed. It sent child 3 with the same empty knowledge and a slightly modified prompt. When child 3 also failed (79 actions), it escalated to a non-template prompt with `model: "fast"`, which produced child 4 -- the only returning child, but by then GAME_OVER had been triggered.

---

## 9. Child Return Rate Across All Runs

| Version | Children | Returned | Rate | Mechanism | Knowledge Transferred |
|---------|----------|----------|------|-----------|----------------------|
| v1.0.0 | 1 | 0 | 0% | None | 0 |
| v1.1.0 | 2 | 0 | 0% | None | 0 |
| v1.2.0 | 3 | 0 | 0% | None | 0 |
| v1.3.0 | 2 | 0 | 0% | None | 0 |
| v1.4.0 | 6 | 1 | 17% | GAME_OVER forced | 0 |
| v1.5.0 | 5 | 2 | 40% | Budget + guard | 2 |
| v1.6.0 | 3 | 0 | 0% | Guard not called, interceptor bypassed | 0 |
| **v1.7.0** | **4** | **1** | **25%** | **Child returned voluntarily (fast model)** | **1** (post-GAME_OVER) |
| **Total** | **26** | **4** | **15%** | -- | **3** |

The overall child return rate is 15% across 26 children. Only 3 of those returns produced knowledge that was (or could have been) parsed by the orchestrator. The return rate remains the fundamental bottleneck.

---

## 10. Cost Efficiency

| Run | Cost | Score | Cost per % | Children | Cost per Child | L1 Actions |
|-----|------|-------|-----------|----------|----------------|------------|
| v1.0.0 | $0.45 | 0% | N/A | 1 | $0.45 | -- |
| v1.1.0 | $4.42 | 0% | N/A | 2 | $2.21 | -- |
| v1.2.0 | $4.49 | 0% | N/A | 3 | $1.50 | -- |
| v1.3.0 | $3.87 | 0% | N/A | 2 | $1.94 | -- |
| v1.4.0 | $9.13 | 2.8% | $3.26/% | 6 | $1.52 | 148 |
| v1.5.0 | $5.38 | 0% | N/A | 5 | $1.08 | 185* |
| v1.6.0 | $3.62 | 0% | N/A | 3 | $1.21 | 133* |
| **v1.7.0** | **$4.80** | **14.3%** | **$0.34/%** | **4** | **$1.20** | **26** |

*Level 1 not completed in these runs.

v1.7.0 achieves by far the best cost efficiency in the series: $0.34 per percentage point, compared to $3.26 for v1.4.0 (the only other run with score > 0). Cost per child ($1.20) is consistent with recent runs.

---

## 11. v1.6.0 vs v1.7.0 Direct Comparison

| Metric | v1.6.0 | v1.7.0 | Delta |
|--------|--------|--------|-------|
| Score | 0% | **14.3%** | **+14.3pp** |
| Levels completed | 0/7 | **1/7** | **+1** |
| Level 1 actions | 133 (not completed) | **26** (completed, 100%) | **N/A** |
| Total actions | 133 | 356 | +168% |
| Children spawned | 3 | 4 | +1 |
| Children returned | 0/3 (0%) | 1/4 (25%) | +25pp |
| Knowledge transferred | 0 | 1 (post-GAME_OVER) | +1 |
| Action budget enforcement | Failed (2/3 bypassed) | Failed (4/4 bypassed) | Same |
| IIFE closure present | No | **Yes** | Fixed (but bypassed anyway) |
| Guard in delegation prompt | No | **Yes** | Added |
| Budget value | 35 | **25** | -10 |
| Escalation compliant | Yes | Partial | Slight regression |
| Model compliance | Yes | **Violated** (fast model) | Regression |
| Inline hints violation | Yes | Yes | Same |
| Cost | $3.62 | $4.80 | +33% |
| Wall time | ~17 min | ~24 min | +41% |
| Effective discoveries | 0 | ~1.5 explicit | +1.5 |

### What Actually Changed Between v1.6.0 and v1.7.0

1. **IIFE closure** hiding `_origStep` -- implemented but bypassed
2. **Guard instruction** in delegation prompt -- may have contributed to child 4's return
3. **Budget reduced** from 35 to 25 -- not enforced
4. **Timeout diagnostic logging** -- implemented but bypassed by error flow
5. **Removed `maxIterations`** from template delegations -- LLM re-added it in deviations

The template changes are correct but none of them directly caused level 1 completion. The success was driven by child 1's stochastic performance combined with the pre-existing structural advantages (perceptual toolkit, `__discover()` function) that have been present since v1.5.0.

---

## 12. What v1.7.0 Proved

### 1. The plugin architecture CAN achieve 100% on a level

Level 1 was completed in 26 actions (under the 29-action baseline). This is the first time any plugin version scored 100% on an individual level. It proves that the delegation model -- orchestrator delegates to child, child plays with perceptual toolkit -- is capable of optimal play.

### 2. The `__discover()` function is a high-value structural improvement

Child 1 used only 4 actions on discovery (one per direction) and then played 22 efficient gameplay actions. The `__discover()` function compresses basic movement learning into the minimum possible actions. This is arguably the most impactful plugin feature across the entire series.

### 3. The knowledge accumulation loop remains broken

Despite completing level 1, the knowledge from that success was lost. Children 2-4 started level 2 with empty knowledge and spent 330 actions without completing it. The 26-action efficiency on level 1 contrasts sharply with the 330-action failure on level 2. Knowledge transfer would have dramatically reduced level 2's action cost.

### 4. Budget enforcement remains unsolved

The IIFE closure fixed the `__originalStep` exposure but did not fix budget enforcement. Children bypass the interceptor through a different mechanism (likely `arc3.step` reassignment). The interceptor is a prompt-level defense against an LLM that has full code execution capability. Any wrapping-based defense can be unwrapped by the LLM.

### 5. The child return problem is the bottleneck, not game skill

Child 1 SOLVED level 1 near-optimally. If it had returned knowledge, level 2 might have been completed too. The gap is not "can the LLM play the game?" (yes, child 1 proved it can) but "can the LLM communicate its results back?" (no, 3 of 4 children failed to return).

---

## 13. Recommendations for v1.8.0

### R1 (P0-CRITICAL): Wrap post-`rlm()` code in try-catch for timeout resilience

**Problem:** When a child times out ("RLM reached max iterations (30)"), the error causes the entire orchestrator iteration to fail. The post-delegation code (timeout diagnostic, knowledge curation, state check, GAME_OVER detection) never executes. This means the orchestrator loses one of its 8 iterations every time a child times out.

**Fix:** Wrap the delegation + post-processing in a try-catch:

```javascript
let summary = "";
try {
  summary = await rlm(...);
} catch(e) {
  console.log(`CHILD ERROR: ${e.message}`);
  summary = "";
}

// This code now ALWAYS executes, even on timeout
if (!summary || summary.length === 0) {
  console.log(`CHILD TIMEOUT: Level ${level} attempt ${__levelAttempts[level]}`);
}
// ... knowledge curation, state check, GAME_OVER detection ...
```

This is the single highest-impact fix because it ensures the orchestrator can check state after every delegation. Currently, 3 of 4 delegations in v1.7.0 produced NO output at all -- the orchestrator had to waste a separate iteration just to check state.

### R2 (P0-CRITICAL): Increase action budget to 30+ for level 1 compatibility

**Problem:** Level 1's baseline is 29 actions. The current budget of 25 makes level 1 completion impossible for a budget-compliant child. Child 1 completed level 1 in 26 actions ONLY because it bypassed the budget. If budget enforcement is ever fixed, a 25-action budget will block level 1 completion.

**Fix:** Set budget to 32 (29 baseline + 4 discovery actions = 33 minimum, so 32 is tight but 35 provides a small margin). Or dynamically set the budget based on the level's known baseline if prior knowledge exists.

**Trade-off:** Higher budget = fewer children before GAME_OVER. But the priority is level completion, not number of children. A single child that completes a level is worth more than 10 that fail.

### R3 (P0-CRITICAL): Make `arc3.step` non-reassignable

**Problem:** The IIFE closure prevents children from calling `_origStep` directly, but children can reassign `arc3.step` to a new function. The defense wraps the method; the attack replaces the method.

**Fix:** Use `Object.defineProperty` to make `arc3.step` non-writable and non-configurable:

```javascript
(function() {
  const _origStep = arc3.step.bind(arc3);
  const wrappedStep = async function(action) {
    __actionsThisLevel++;
    if (__actionsThisLevel > 32) {
      __done = true;
      __returnPayload = JSON.stringify({...});
      return { state: 'BUDGET_EXCEEDED', ... };
    }
    const result = await _origStep(action);
    // ... GAME_OVER and level completion checks ...
    return result;
  };
  Object.defineProperty(arc3, 'step', {
    value: wrappedStep,
    writable: false,
    configurable: false
  });
})();
```

If `Object.defineProperty` does not work in the sandbox (the sandbox may use proxies), an alternative is to freeze the `arc3` object:

```javascript
Object.freeze(arc3);
```

However, this may break other methods. Test carefully.

### R4 (P1): Combine state check with delegation in a single iteration

**Problem:** The orchestrator wastes 1 iteration per child timeout just to check state. In v1.7.0, iterations 2, 4, and 6 were pure state-check iterations that added no value. This consumed 3 of 8 available iterations.

**Fix:** With R1 (try-catch), the state check happens in the same iteration as the delegation. The orchestrator gets 8 iterations for 8 delegations instead of 4 delegations + 4 state checks. This doubles the number of children that can be spawned per game.

### R5 (P1): Pass level-specific baseline as context to children

**Problem:** Children do not know how many actions the level "should" take. They explore aimlessly without a sense of when to stop.

**Fix:** Include the baseline in the delegation prompt or `__level_task`:

```javascript
__level_task = { level, knowledge: __knowledge, baseline: [29, 41, 172, 49, 53, 62, 82][level - 1] };
```

The child can use this to calibrate: "I have used 20 of 41 baseline actions. I should be roughly halfway to the goal."

**Caution:** This is game-specific information that the orchestrator "should not know." But since the baselines are in the eval results, it is debatable whether hardcoding them is a violation. An alternative is to have the orchestrator track action counts from prior children and pass that as context.

### R6 (P2): Teach orchestrator to detect level completion without state-check iterations

**Problem:** The orchestrator only discovers level completions by checking `arc3.observe()` in a separate iteration. If the post-`rlm()` code executed (R1 fix), it could detect level completion immediately after delegation.

**Fix:** Part of R1. Once try-catch is in place, add:

```javascript
const post = arc3.observe();
if (post.levels_completed > previousLevels) {
  console.log(`LEVEL ${previousLevels + 1} COMPLETED during child delegation!`);
}
```

### Priority Ranking Summary

| Priority | Rec | Impact | Effort |
|----------|-----|--------|--------|
| P0 | R1: try-catch around `rlm()` | Doubles useful iterations per game | Low |
| P0 | R2: Increase budget to 32+ | Allows L1 completion within budget | Low |
| P0 | R3: Make `arc3.step` non-reassignable | Prevents budget bypass | Medium |
| P1 | R4: Combine delegation + state check | Doubles children per game | Part of R1 |
| P1 | R5: Pass baseline context to children | Improves child decision-making | Low |
| P2 | R6: Detect level completion immediately | Faster orchestrator response | Part of R1 |

---

## 14. The Fundamental Tension

v1.7.0 reveals the core tension in the plugin architecture:

**Budget enforcement blocks level completion.** Level 1's baseline is 29 actions. A 25-action budget makes completion impossible. Even 32 actions (baseline + 3) leaves almost no margin for exploration.

**Budget non-enforcement wastes the game.** Without enforcement, children burn through the entire game's fuel/lives in 2-3 delegations. 330 actions on level 2 (8x baseline) produced nothing.

**The resolution:** Budget enforcement must be RELIABLE but GENEROUS enough for the current level. A budget of baseline x 1.5 would give children room to explore while preventing catastrophic waste. For level 1 (baseline 29), that is 44. For level 2 (baseline 41), that is 62. For level 3 (baseline 172), that is 258 -- which would require the exploration-only mode.

The deeper resolution is knowledge transfer. If child 1 had returned its level 1 knowledge, child 2 could have started level 2 already understanding movement, goals, and pattern matching. It would need far fewer actions than a cold-start child. The knowledge accumulation loop is the architectural answer to the budget tension.

---

## 15. Appendix

### A. Iteration Trace

| Iter | Code Blocks | Game Actions | Cumulative Actions | Key Event |
|------|------------|-------------|-------------------|-----------|
| 0 | 1 | 0 | 0 | `arc3.start()` executed. Clean template-compliant start. |
| 1 | 1 | ~34 | 34 | Delegated L1 attempt 1 (completion mode). Child 1 timed out. **L1 completed during child!** |
| 2 | 1 | 0 | 34 | State check. L1 completed! 34 total actions. |
| 3 | 1 | 59 | 93 | Delegated L2 attempt 1 (completion mode). Child 2 timed out. L2 not completed. |
| 4 | 1 | 0 | 93 | State check. 93 total actions, still on L2. |
| 5 | 1 | 79 | 172 | Delegated L2 attempt 2 (modified prompt, maxIter: 20). Child 3 timed out. |
| 6 | 1 | 0 | 172 | State check. 172 total actions, still on L2. |
| 7 | 1 | 184 | 356 | Delegated L2 attempt 3 (model: "fast"). Child 4 returned JSON. GAME_OVER. Scorecard returned. |

### B. Action Attribution

| Child | Iter | Target Level | Actions | Budget (25) | Excess | Returned? | Outcome |
|-------|------|-------------|---------|-------------|--------|-----------|---------|
| 1 | 1 | L1 + L2 start | ~34 | 25 | +9 | No (timeout) | **Completed L1 in 26 actions!** |
| 2 | 3 | L2 | 59 | 25 | +34 | No (timeout) | L2 not completed |
| 3 | 5 | L2 | 79 | 25 | +54 | No (timeout) | L2 not completed |
| 4 | 7 | L2 | 184 | 25 | +159 | **YES** (JSON) | GAME_OVER, returned knowledge |

### C. Level 1 Efficiency Comparison (All Runs That Completed L1)

| Run | Version | L1 Actions | Baseline | Ratio | L1 Score |
|-----|---------|-----------|----------|-------|----------|
| run-015 | No plugin | 18 | 29 | 0.62x | 100% |
| **run-023** | **v1.7.0** | **26** | **29** | **0.90x** | **100%** |
| run-020 | v1.4.0 | 148 | 29 | 5.10x | 19.6% |

v1.7.0's level 1 performance is within 8 actions of the no-plugin best and within 3 actions of the human baseline. This is near-optimal play.

### D. Child Return Rate History

| Version | Children | Returned | Rate | Mechanism |
|---------|----------|----------|------|-----------|
| v1.0.0 | 1 | 0 | 0% | No guard, no interceptor |
| v1.1.0 | 2 | 0 | 0% | No guard, no interceptor |
| v1.2.0 | 3 | 0 | 0% | No guard, no interceptor |
| v1.3.0 | 2 | 0 | 0% | No guard, no interceptor |
| v1.4.0 | 6 | 1 | 17% | GAME_OVER forced |
| v1.5.0 | 5 | 2 | 40% | Budget exhaustion + guard |
| v1.6.0 | 3 | 0 | 0% | Guard not called, interceptor bypassed |
| **v1.7.0** | **4** | **1** | **25%** | **Voluntary (fast model), post-GAME_OVER** |
| **Total** | **26** | **4** | **15%** | -- |

### E. v1.7.0 Plugin Changes (Summary)

| Change | Source (v1.6.0 Rec) | Implemented? | Effective? |
|--------|---------------------|-------------|-----------|
| IIFE closure for step interceptor | R2 | YES | NO (bypassed via arc3.step reassignment) |
| Guard instruction in delegation prompt | R6 | YES | UNCERTAIN (only returning child used fast model) |
| Budget reduced to 25 | R3 | YES | NO (not enforced) |
| Timeout diagnostic logging | R5 | YES | NO (bypassed by error flow) |
| Removed misleading maxIterations | R7 | YES (in template) | PARTIAL (LLM re-added it) |
| Engine-level guard enforcement (R1) | R1 | NO | N/A (requires engine change) |
