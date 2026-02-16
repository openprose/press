# Run 024 Analysis: ARC-3 v1.8.0 Orchestrator + Player Plugins

**Date:** 2026-02-16
**Run file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T08-18-55-664Z.json`
**Model:** claude-opus-4-6
**Plugins:** arc3-orchestrator v1.8.0 + arc3-player v1.8.0
**Config:** maxIterations=30, maxDepth=2, concurrency=5
**Score:** 0% (0/7 levels completed) -- regression from v1.7.0's 14.3%
**Prior run (run-023, v1.7.0):** 14.3% (1/7 levels, 356 actions, $4.80, 1/4 children returned)
**Prior best (run-023, v1.7.0):** 14.3% (1/7 levels, 26 actions on Level 1)
**Replay:** https://three.arcprize.org/scorecards/0ce3780d-7b17-4faf-92ea-52d993632676

---

## 1. Score Breakdown

### Scorecard

| Field | Value |
|-------|-------|
| Final Score | **0%** |
| State | GAME_OVER |
| Total Actions | 180 |
| Levels Completed | **0 / 7** |
| Resets | 0 |
| Environments Completed | 0 / 1 |
| Outer Iterations | 7 (of 30 max) |
| Wall Time | ~17 min (1020 sec) |
| Cost | $3.63 |

### Per-Level Breakdown

| Level | Actions Used | Baseline Actions | Score | Status |
|-------|-------------|-----------------|-------|--------|
| 1 | 180 | 29 | 0% | Not completed (GAME_OVER) |
| 2 | 0 | 41 | 0% | Not attempted |
| 3 | 0 | 172 | 0% | Not attempted |
| 4 | 0 | 49 | 0% | Not attempted |
| 5 | 0 | 53 | 0% | Not attempted |
| 6 | 0 | 62 | 0% | Not attempted |
| 7 | 0 | 82 | 0% | Not attempted |

**Total baseline actions (all 7 levels):** 488

### Score Calculation

All levels scored 0%. Average: (0 + 0 + 0 + 0 + 0 + 0 + 0) / 7 = **0%**.

180 actions were consumed entirely on level 1 (baseline: 29). This is a 6.2x overrun. GAME_OVER was triggered, likely by fuel/lives exhaustion.

---

## 2. Plugin Compliance

### Orchestrator Compliance (arc3-orchestrator v1.8.0)

| Rule | Compliant? | Evidence |
|------|-----------|---------|
| `arc3.start()` called exactly once | YES | Iteration 0: single `arc3.start()` call |
| Delegate using `app: "arc3-player"` | YES | All 4 delegations used `app: "arc3-player"` |
| Always use `model: "intelligent"` | YES | All 4 delegations used `model: "intelligent"` (improvement over v1.7.0) |
| Never call `arc3.step()` | YES | No direct step calls by orchestrator |
| Never analyze/print the grid | **VIOLATED** | Iteration 3: read `arc3.actionCount` and `obs.frame.length` directly |
| Max 2 completion attempts per level | **VIOLATED** | L1: 4 attempts total (2 completion + 2 custom). Attempts 3-4 were custom-prompted, not template exploration-only. |
| Pass knowledge via `__level_task` | YES | `__level_task = { level, knowledge: __knowledge }` set before each delegation |
| Never inline game data in prompts | **VIOLATED** | Iterations 4 and 5: added strategy hints, game mechanics, behavioral instructions |
| Return scorecard on GAME_OVER | YES | Iteration 6: returned JSON scorecard after detecting GAME_OVER |
| Track `__outerIter` | YES | Incremented correctly, budget guard at 28 |
| try-catch around `rlm()` | **YES (NEW)** | Iterations 1-2: error caught, post-delegation code executed in same iteration |
| No wasted state-check iterations | **VIOLATED** | Iteration 3: pure state check with no delegation |

**v1.8.0 improvements visible:**
- try-catch around `rlm()` is working correctly. Iterations 1-2 show "CHILD ERROR" + "CHILD TIMEOUT" + "Post:" all in the same iteration output. This is the first run where child timeouts did NOT waste a separate orchestrator iteration.
- Model compliance restored: all 4 delegations used `model: "intelligent"` (v1.7.0 violated this with `model: "fast"`).

**Recurring violations:**
- Orchestrator inlined game hints in custom prompts (iterations 4, 5). This has occurred in every run since v1.3.0.
- Orchestrator deviated from template by running a pure state-check in iteration 3 and writing custom prompts.
- Orchestrator added `maxIterations: 12` to rlm() options (iterations 4, 5). This parameter is NOT honored by the engine -- children always get 30 iterations.

### Player Compliance (arc3-player v1.8.0)

| Rule | Assessment | Evidence |
|------|-----------|---------|
| `__guard()` called as first line | **NO (children 1-2)**, **UNKNOWN (children 3-4)** | Children 1-2 hit the engine's 30-iter cap; children 3-4 returned but action counts suggest guard was not enforced |
| `arc3.step` made non-reassignable via Object.defineProperty | **FAILED** | 109 actions after 2 children, 180 total -- budget was NOT enforced |
| Budget enforced at 32 actions | **FAILED** | Children collectively used 180 actions on L1 (baseline: 29) |
| `__discover()` called in iteration 1 | LIKELY | Children would have had access to __discover() in their sandbox |
| Return before timeout | **2 of 4** (50%) | Children 3 and 4 returned JSON; children 1 and 2 timed out |
| Never call `arc3.start()` | YES (inferred) | No game resets observed |

**Object.defineProperty failure analysis:** v1.8.0 introduced `Object.defineProperty(arc3, 'step', { writable: false, configurable: false })` to prevent children from reassigning the budget-enforcing step wrapper. Despite this:

- Children 1-2 consumed ~109 actions between them (far exceeding the 32-action budget per child)
- The total reached 180 actions (GAME_OVER) across 4 children

**Why Object.defineProperty failed:** The most likely explanation is that the sandbox environment uses a proxy or wrapper for the `arc3` object, meaning `Object.defineProperty` either:
1. Applied to the proxy surface rather than the underlying object, and the child accessed the underlying object
2. Was silently ignored in the sandbox's execution context
3. The child redefined `arc3` itself (the variable), not just `arc3.step`

This is the third budget enforcement mechanism to fail (after global variable in v1.5.0-v1.6.0 and IIFE closure in v1.7.0). The pattern is clear: any defense implemented in the prompt/sandbox layer can be circumvented by the LLM because it has full code execution capability in the same context.

### Summary of Protocol Violations

1. **Orchestrator inlined hints in custom prompts** (iterations 4, 5) -- recurring since v1.3.0
2. **Orchestrator ran a pure state-check iteration** (iteration 3) -- wasted 1 of 7 outer iterations
3. **Orchestrator added `maxIterations: 12`** (iterations 4, 5) -- not honored by engine
4. **Orchestrator exceeded 2 attempts per level** -- 4 attempts on L1 with custom prompts
5. **All 4 children exceeded action budget** -- Object.defineProperty bypassed
6. **2 of 4 children failed to return** -- guard non-compliance continues

---

## 3. Did the v1.7.0 Recommendations Work?

### R1 (P0): try-catch around `rlm()` -- DID IT WORK?

**YES. This is the most successful fix in the entire plugin series.**

v1.7.0's trace showed that child timeouts caused the entire orchestrator iteration to error out. The post-delegation code (timeout diagnostic, knowledge curation, state check) never executed. The orchestrator had to waste a separate iteration just to check state after each timeout.

v1.8.0's try-catch changes this completely. Iterations 1-2 demonstrate the fix:

```
CHILD ERROR: RLM reached max iterations (30) without returning an answer
CHILD TIMEOUT: Level 1 attempt 1 -- no return value.
Post: state=NOT_FINISHED, levels=0, ~0 est. actions
```

All three lines appear in the SAME iteration output. The error is caught, the timeout is diagnosed, and the state is checked -- without consuming an additional iteration. In v1.7.0, this same sequence required TWO iterations (one for the delegation that errored, one for the state check).

**Impact quantification:** In v1.7.0, 3 of 8 iterations were pure state-checks after timeouts. With try-catch, those 3 iterations are recovered for delegations. The orchestrator gets ~50% more useful iterations per game.

Note: The orchestrator still wasted iteration 3 on a pure state-check (a deviation), proving that try-catch is necessary but the LLM must also be disciplined enough to use the recovered capacity.

### R2 (P0): Budget increased to 32 -- DID IT HELP?

**Not directly, because budget enforcement failed.** The budget was increased from 25 to 32 to allow level 1 completion within budget (baseline: 29). However, since Object.defineProperty did not prevent step reassignment, the actual budget was unlimited. Children consumed 180 actions collectively.

The budget increase is the correct change -- 32 > 29 baseline means a budget-compliant child can complete level 1. But it remains theoretical until enforcement works.

### R3 (P0): Object.defineProperty for non-reassignable `arc3.step` -- DID IT PREVENT BYPASS?

**NO.** This is the third failed budget enforcement mechanism:

| Version | Mechanism | Result |
|---------|-----------|--------|
| v1.5.0-v1.6.0 | Global `__originalStep` variable | Child called `__originalStep` directly |
| v1.7.0 | IIFE closure hiding `_origStep` | Child reassigned `arc3.step` itself |
| **v1.8.0** | **Object.defineProperty (writable: false)** | **Child still exceeded budget** |

Each fix addresses the previous bypass vector but the child finds a new one. The fundamental issue: any defense in the sandbox can be circumvented because the LLM has full code execution capability in the same sandbox. Budget enforcement requires engine-level support, not prompt-level tricks.

---

## 4. Knowledge Discovery

### What Was Discovered (by Children 3 and 4)

#### Child 3 Discoveries (Iteration 4)

| Discovery | Detail |
|-----------|--------|
| Movement | "Arrow keys move colored blocks through a maze corridor system" |
| Up | "Moves color 12 (red) block up by 5 rows" |
| Down | "Moves color 12 (red) block down by 5 rows" |
| Left | "Moves color 12 (red) block left by 5 cols (when in horizontal corridor)" |
| Right | "Moves color 12 (red) block right by 5 cols (when in horizontal corridor)" |
| Timer | "Color 11 (teal bar) shrinks" |
| + 1 more mechanic | (truncated in output) |
| + 6 rules | (content truncated) |

#### Child 4 Discoveries (Iteration 5, accumulated)

| Discovery | Detail |
|-----------|--------|
| Movement | "Actions 1=Up, 2=Down, 3=Left, 4=Right" |
| Block size | "Red block is 2x5 (rows 45-46, cols 39-43)" |
| Timer | "There's a timer - game ended as GAME_OVER, likely timeout" |
| Action count | "180 actions were already used" |
| Walls (color 3) | "form maze boundaries" |
| Corridors (color 4) | "open space / background" |
| + 3 more mechanics | (9 total, some truncated) |
| + 11 rules | (accumulated from child 3 + child 4) |

### Accuracy vs Canonical Rules

| Discovery | Accuracy | Notes |
|-----------|:--------:|-------|
| Movement: arrows move colored block through maze | **CORRECT** | Canonical: directional actions 1-4, 5px discrete steps |
| Direction mapping: 1=Up, 2=Down, 3=Left, 4=Right | **CORRECT** | Exact match with canonical |
| Step size: 5 rows/cols per move | **CORRECT** | Canonical: 5 pixels per step |
| Player character: color 12, "red" block | **PARTIALLY CORRECT** | Canonical: 5x5 block, top 2 rows orange, bottom 3 blue. Color 12 likely corresponds to one component. |
| Block size: 2x5 | **PARTIALLY CORRECT** | Canonical: 5x5 block. 2x5 may describe only part of the character (orange top portion) |
| Timer/fuel: color 11 teal bar shrinks | **CORRECT** | Canonical: fuel bar depletes with each action |
| Walls: color 3 | **CORRECT** | Canonical: walls block movement |
| Corridors: color 4 | **CORRECT** | Canonical: light paths are walkable |

### Canonical Rules Discovery Checklist

| # | Canonical Discovery | v1.8.0 Status | Notes |
|---|---------------------|:---:|---|
| 1 | Character identification (5x5 block, orange top/blue bottom) | **PARTIAL** | Color 12 identified as movable "red block", 2x5 size reported (incomplete) |
| 2 | Movement mechanics (5px steps, 4 directions) | **DISCOVERED** | Explicitly reported: 5 rows/cols per step, all 4 directions mapped |
| 3 | Wall detection | **DISCOVERED** | Color 3 = "Walls, form maze boundaries" |
| 4 | Fuel depletion | **DISCOVERED** | Color 11 teal bar shrinks = fuel bar depletion |
| 5 | Fuel refill (yellow box) | MISSED | Not reported |
| 6 | Lives counter (3 red squares) | MISSED | Not reported |
| 7 | Pattern toggle (white cross) | MISSED | Not reported |
| 8 | Color changer (rainbow box) | MISSED | Not reported |
| 9 | Goal icon identification | MISSED | Not identified |
| 10 | Current pattern display (bottom-left HUD) | MISSED | Not reported |
| 11 | Pattern matching requirement | MISSED | Not identified |
| 12 | Strategic sequencing (transform then navigate) | MISSED | Not identified |
| 13 | Fog of war (Level 7) | N/A | Never reached Level 7 |

### Discovery Scoring

**Explicit discoveries (transferred to orchestrator):** 4 (movement + directions + walls + fuel depletion)
**Partial discoveries:** 1 (character identification -- partial)
**Missed:** 8 (fuel refill, lives, pattern toggle, color changer, goal, pattern display, pattern matching, strategic sequence)

This is the **best discovery rate in the series** for explicit knowledge actually transferred to the orchestrator. v1.7.0 had only 1 explicit discovery (movement) plus 2.5 inferred (from child 1's level completion behavior). v1.8.0 has 4 explicit discoveries, all properly curated into `__knowledge`.

However, none of the higher-level mechanics (goal, pattern matching, special icons) were discovered. All 4 children were stuck on level 1, and 180 actions of exploration only revealed basic movement and environmental properties. The deeper game mechanics require reaching and interacting with game objects (pattern toggles, color changers, goal icon) -- which requires efficient navigation that no child achieved.

---

## 5. Knowledge Curation Analysis

v1.8.0's knowledge curation code worked correctly for both returning children:

| After Child | Mechanics | Rules | Hazards | Object Types |
|-------------|-----------|-------|---------|-------------|
| Initial | 0 | 0 | 0 | 0 |
| Child 1 (timeout) | 0 | 0 | 0 | 0 |
| Child 2 (timeout) | 0 | 0 | 0 | 0 |
| **Child 3 (returned)** | **7** | **6** | -- | -- |
| **Child 4 (returned)** | **9** | **11** | -- | -- |

The curation logic:
- Parsed JSON from child return strings
- Merged mechanics with confidence promotion (if prior + new confidence >= 0.8, set to 1.0)
- Used `Object.assign` for object types and hazards
- Deduplicated rules via `Set`
- Filtered open questions against existing rules

**This is the first run where knowledge curation was exercised across multiple returning children.** The growth from 7 to 9 mechanics and 6 to 11 rules demonstrates that the accumulation loop works when children return data. Prior runs either had 0 returning children (v1.0.0-v1.4.0, v1.6.0) or returns that were too late (v1.7.0: child 4 returned post-GAME_OVER).

The irony: the curation worked perfectly, but all curated knowledge was useless because GAME_OVER followed 1 action after child 4's delegation. The knowledge was accumulated but never used for a subsequent child.

---

## 6. Progression Table

| Metric | v1.0.0 (016) | v1.1.0 (017) | v1.2.0 (018) | v1.3.0 (019) | v1.4.0 (020) | v1.5.0 (021) | v1.6.0 (022) | v1.7.0 (023) | **v1.8.0 (024)** |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Score | 0% | 0% | 0% | 0% | 2.8% | 0% | 0% | **14.3%** | 0% |
| Levels completed | 0/7 | 0/7 | 0/7 | 0/7 | 1/7 | 0/7 | 0/7 | **1/7** | 0/7 |
| Level 1 actions | -- | -- | -- | -- | 148 | 185* | 133* | **26** | 180* |
| Level 1 score | 0 | 0 | 0 | 0 | 19.6% | 0% | 0% | **100%** | 0% |
| Total actions | ~45 | ~80 | ~138 | 154 | 380 | 185 | 133 | 356 | **180** |
| Actions by orchestrator | ~10 | ~45 | ~43 | 0 | 0 | 0 | 0 | 0 | **0** |
| Actions by children | ~35 | ~35 | ~95 | 154 | 380 | 185 | 133 | 356 | **180** |
| Final state | NOT_FINISHED | NOT_FINISHED | GAME_OVER | GAME_OVER | GAME_OVER | GAME_OVER | GAME_OVER | GAME_OVER | **GAME_OVER** |
| Children spawned | 1 | 2 | 3 | 2 | 6 | 5 | 3 | 4 | **4** |
| Children returned | 0/1 | 0/2 | 0/3 | 0/2 | 1/6 | 2/5 | 0/3 | 1/4 | **2/4** |
| Child return rate | 0% | 0% | 0% | 0% | 17% | 40% | 0% | 25% | **50%** |
| Knowledge transferred | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 (post-GO) | **2** |
| Orchestrator called `arc3.step()` | Yes | Yes | Yes | No | No | No | No | No | **No** |
| Orchestrator analyzed grid | N/A | Yes | Yes | No | Yes | No | No | No | **No** |
| Task status | Failed | Failed | Failed | Completed | Completed | Completed | Completed | Completed | **Completed** |
| Outer iterations used | ~15 | 30 | 30 | 6 | 16 | 10 | 8 | 8 | **7** |
| Wall time | -- | ~17 min | ~20 min | ~18 min | ~41 min | ~27 min | ~17 min | ~24 min | **~17 min** |
| Cost | $0.45 | $4.42 | $4.49 | $3.87 | $9.13 | $5.38 | $3.62 | $4.80 | **$3.63** |
| `arc3.start()` calls | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | **1** |
| Escalation protocol followed | N/A | N/A | N/A | Partial | Violated | Violated | YES | PARTIAL | **PARTIAL** |
| Max 2 attempts/level | N/A | N/A | N/A | Yes | Violated | Violated | YES | YES | **VIOLATED** |
| try-catch around rlm() | No | No | No | No | No | No | No | No | **YES** |
| Budget enforcement | N/A | N/A | N/A | N/A | N/A | Failed | Failed | Failed | **Failed** |
| Model compliance | N/A | N/A | N/A | N/A | Violated | Yes | Yes | Violated | **YES** |

*Level 1 not completed in these runs; all actions were spent on L1 without finishing.

### Structural Progress Metrics

| Metric | v1.0 | v1.1 | v1.2 | v1.3 | v1.4 | v1.5 | v1.6 | v1.7 | **v1.8** | Trend |
|--------|------|------|------|------|------|------|------|------|------|-------|
| Orch respects `arc3.step()` ban | 0 | 2 | 7 | 30 | 30 | 30 | 30 | 30 | **30** | Stable (fixed) |
| Task status = Completed | No | No | No | Yes | Yes | Yes | Yes | Yes | **Yes** | Stable (fixed) |
| `arc3.start()` once | No | No | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** | Stable (fixed) |
| Orch avoided grid analysis | No | No | No | Yes | No | Yes | Yes | Yes | **Yes** | Stable |
| Model parameter compliance | N/A | N/A | N/A | N/A | Viol | Yes | Yes | Viol | **Yes** | Recovered |
| try-catch around rlm() | No | No | No | No | No | No | No | No | **YES** | **NEW** |
| Children returned | 0/1 | 0/2 | 0/3 | 0/2 | 1/6 | 2/5 | 0/3 | 1/4 | **2/4** | **BEST RATE** |
| Knowledge to orchestrator | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | **2** | Tied best |
| Knowledge curation exercised | -- | -- | -- | -- | -- | -- | -- | Once | **Twice** | **NEW HIGH** |
| Budget enforcement works | -- | -- | -- | -- | -- | No | No | No | **No** | Still broken |
| A level was completed | No | No | No | No | Yes | No | No | YES | **No** | Regression |
| Score > 0 | No | No | No | No | Yes | No | No | YES | **No** | Regression |

---

## 7. Root Cause Analysis: Why Did v1.8.0 Score 0%?

### The Core Question

v1.8.0 introduced three targeted fixes (try-catch, budget increase to 32, Object.defineProperty). Two of three worked structurally (try-catch, budget increase was correctly set). Yet the score regressed from 14.3% to 0%. Why?

### Root Cause 1: No Child Completed Level 1 (STOCHASTIC)

v1.7.0's level 1 completion was driven by child 1's exceptional 26-action run -- identified in that analysis as a stochastic outlier. v1.8.0's children did not replicate this. Children 1-2 timed out without completing the level. By the time children 3-4 ran, the game was nearly exhausted (109 and 179 actions already consumed).

**The structural improvements did not cause v1.7.0's success, and their presence in v1.8.0 cannot prevent stochastic failure.** Level completion depends on the child's exploration strategy, which varies between runs. The 50% child return rate and working knowledge curation are genuine improvements, but they do not help if no child reaches the goal.

### Root Cause 2: Budget Bypass Exhausted the Game on Level 1

180 actions on level 1 (baseline: 29, ratio: 6.2x). The budget of 32 was not enforced. Children 1-2 alone consumed 109 actions. If the budget had been enforced:
- Each child capped at 32 actions
- 4 children x 32 = 128 max actions
- Level 1 baseline is 29, so with proper knowledge transfer, later children should need fewer actions
- The game would still have budget remaining for level 2

Budget bypass remains the single most damaging failure mode. It converts children's exploration into game-ending waste.

### Root Cause 3: Object.defineProperty Did Not Work in the Sandbox

The v1.7.0 analysis recommended `Object.defineProperty` to make `arc3.step` non-reassignable. v1.8.0 implemented this, but it did not prevent budget bypass. The likely cause: the sandbox uses a Proxy or similar mechanism that does not respect `Object.defineProperty` constraints. The child can either:

1. Access the underlying object behind the proxy
2. Create a new reference to the step function that bypasses the wrapper
3. Call the HTTP/API layer directly if it is exposed in the sandbox

This confirms that budget enforcement cannot be achieved at the prompt/sandbox level. It requires engine-level support.

### Root Cause 4: Iteration 3 Was Wasted on a State Check

Despite try-catch recovering iterations 1-2 from timeout waste, the orchestrator deviated from template in iteration 3 by running a pure state check. This consumed 1 of 7 iterations for zero value (the state was already checked at the end of iteration 2's post-delegation code). If iteration 3 had been a delegation, the orchestrator would have had 5 children instead of 4.

### Summary of Causal Factors

| Factor | Type | Contribution |
|--------|------|-------------|
| No child completed level 1 | Stochastic | PRIMARY |
| Budget bypass exhausted game on L1 | Structural (unfixed) | PRIMARY |
| Object.defineProperty failed in sandbox | Structural (unfixed) | ENABLING |
| Wasted iteration on state check | Deviation | MINOR |
| Children 1-2 timed out (no guard) | Structural (unfixed) | CONTRIBUTING |

---

## 8. Structural Improvements: What v1.8.0 VALIDATED

Despite the 0% score, v1.8.0 validated several important architectural improvements. Score regression is stochastic; structural progress is real.

### 8.1 try-catch Around `rlm()` WORKS

**This is the most important finding of run-024.**

Iterations 1-2 prove that the try-catch pattern works exactly as designed:

```
CHILD ERROR: RLM reached max iterations (30) without returning an answer
CHILD TIMEOUT: Level 1 attempt 1 -- no return value.
Post: state=NOT_FINISHED, levels=0, ~0 est. actions
```

All three diagnostic lines appear in the same iteration. The orchestrator:
1. Caught the child timeout error
2. Logged the error type ("CHILD ERROR")
3. Logged the timeout diagnostic ("CHILD TIMEOUT")
4. Checked game state ("Post:")
5. Continued to the next iteration with full context

In v1.7.0, each of these timeout events consumed TWO iterations (one for the error, one for the state check). v1.8.0 eliminates this waste entirely. The theoretical capacity increase is ~50% more delegations per game.

### 8.2 50% Child Return Rate -- Highest Ever

| Version | Children | Returned | Rate |
|---------|----------|----------|------|
| v1.0.0-v1.3.0 | 8 | 0 | 0% |
| v1.4.0 | 6 | 1 | 17% |
| v1.5.0 | 5 | 2 | 40% |
| v1.6.0 | 3 | 0 | 0% |
| v1.7.0 | 4 | 1 | 25% |
| **v1.8.0** | **4** | **2** | **50%** |
| **Cumulative** | **30** | **6** | **20%** |

2 of 4 children returned JSON in v1.8.0. This is the highest return rate in the series. Notably:
- Both returns were from children 3 and 4 (the later children with custom prompts)
- Children 1-2 (template prompts) still timed out
- Both returning children used `model: "intelligent"` (unlike v1.7.0's returning child which used `model: "fast"`)

The custom prompts included explicit return urgency ("By iteration 8, you MUST call return()") which may have contributed. But the higher return rate also suggests that the overall plugin architecture (perceptual toolkit, knowledge passing) is becoming more effective at guiding children toward producing output.

### 8.3 Knowledge Curation WORKED Across Multiple Children

For the first time in the series, the knowledge curation loop was exercised across TWO consecutive returning children:

- After child 3: 7 mechanics, 6 rules
- After child 4: 9 mechanics (+2), 11 rules (+5)

The merge logic worked correctly:
- New mechanics were added to `__knowledge.mechanics`
- Rules were deduplicated via Set
- The knowledge object grew monotonically

This validates the return-string knowledge architecture. When children return JSON, the orchestrator can parse it, merge it, and accumulate knowledge across delegations. The architecture is sound; it just needs more children to return data AND the game to survive long enough for the accumulated knowledge to be used.

### 8.4 The Return-String Architecture Is VALIDATED

v1.8.0 confirms that the `rlm()` return-string mechanism works end-to-end:

1. Child generates JSON string with knowledge, actions, and completion status
2. `rlm()` returns this string to the orchestrator
3. Orchestrator parses JSON via `JSON.parse(summary)`
4. Knowledge is merged into `__knowledge`
5. Accumulated knowledge is passed to the next child via `__level_task`

Steps 1-4 were all executed in this run. Step 5 was partially executed (child 4 received knowledge from child 3, but GAME_OVER followed immediately). The architecture is complete and functional. The remaining challenge is ensuring enough children return data early enough for the loop to compound.

---

## 9. The v1.5.0 Through v1.8.0 Improvement Arc

### What Is SOLVED

| Capability | Solved In | Evidence | Status |
|------------|-----------|----------|--------|
| try-catch resilience | **v1.8.0** | Iterations 1-2: error caught, post-delegation code executed in same iteration | **CONFIRMED WORKING** |
| Return-string knowledge architecture | v1.5.0 design, **v1.8.0 validated** | 2 children returned JSON, knowledge parsed and merged | **CONFIRMED WORKING** |
| Knowledge curation (multi-child) | **v1.8.0** | Knowledge grew 0 -> 7 -> 9 mechanics across 2 returning children | **CONFIRMED WORKING** |
| Escalation protocol (detection) | v1.6.0+ | `__levelAttempts` correctly tracked, threshold detected | **CONFIRMED WORKING** |
| Orchestrator respects arc3.step() ban | v1.3.0+ | No direct step calls by orchestrator in 6 consecutive runs | **STABLE** |
| Single arc3.start() | v1.2.0+ | Exactly one start call in 7 consecutive runs | **STABLE** |

### What Is IMPROVED (But Not Solved)

| Capability | Trend | v1.5.0 | v1.6.0 | v1.7.0 | v1.8.0 | Notes |
|------------|-------|--------|--------|--------|--------|-------|
| Child return rate | Improving | 40% | 0% | 25% | **50%** | Best ever, but noisy |
| Cost efficiency | Improving | $5.38 | $3.62 | $4.80 | **$3.63** | Lowest cost with structural improvements |
| Outer iteration efficiency | Improving | 10 iters | 8 iters | 8 iters | **7 iters** | try-catch eliminates waste |
| Model compliance | Recovering | Yes | Yes | Violated | **Yes** | Fixed in v1.8.0 |

### What Is UNSOLVED

| Problem | Attempts | Why It Persists |
|---------|----------|-----------------|
| **Budget enforcement** | 3 mechanisms tried (global var, IIFE closure, Object.defineProperty) | Sandbox-level defenses cannot prevent LLM from circumventing them. Requires engine-level enforcement. |
| **Guard compliance** | Instruction in prompt, __guard() function | Children ignore __guard() or do not call it as first line. 30-iteration timeout persists for non-returning children. |
| **Level completion consistency** | 9 runs, 2 completions (v1.4.0, v1.7.0) | Level completion is stochastic. The child must discover movement, identify the goal, and navigate efficiently -- all within budget. No structural fix guarantees this. |
| **Template deviation** | Every run since v1.3.0 | The LLM cannot resist adding "helpful" context when children fail. Custom prompts, inline hints, maxIterations parameter all recur. |

---

## 10. Cost Efficiency

| Run | Cost | Score | Cost per % | Children | Cost per Child | Actions |
|-----|------|-------|-----------|----------|----------------|---------|
| v1.0.0 | $0.45 | 0% | N/A | 1 | $0.45 | ~45 |
| v1.1.0 | $4.42 | 0% | N/A | 2 | $2.21 | ~80 |
| v1.2.0 | $4.49 | 0% | N/A | 3 | $1.50 | ~138 |
| v1.3.0 | $3.87 | 0% | N/A | 2 | $1.94 | 154 |
| v1.4.0 | $9.13 | 2.8% | $3.26/% | 6 | $1.52 | 380 |
| v1.5.0 | $5.38 | 0% | N/A | 5 | $1.08 | 185 |
| v1.6.0 | $3.62 | 0% | N/A | 3 | $1.21 | 133 |
| v1.7.0 | $4.80 | 14.3% | $0.34/% | 4 | $1.20 | 356 |
| **v1.8.0** | **$3.63** | **0%** | **N/A** | **4** | **$0.91** | **180** |

v1.8.0 is the cheapest run since v1.6.0 ($3.63 vs $3.62) and has the lowest cost per child in the series ($0.91). The reduced cost is due to:
- Fewer total outer iterations (7 vs 8 in v1.7.0) thanks to try-catch efficiency
- Fewer total actions (180 vs 356) because GAME_OVER happened earlier
- No model: "fast" children (which may have different cost profiles)

However, cost efficiency is only meaningful when it produces results. $3.63 at 0% is not better than $4.80 at 14.3%.

---

## 11. v1.7.0 vs v1.8.0 Direct Comparison

| Metric | v1.7.0 | v1.8.0 | Delta |
|--------|--------|--------|-------|
| Score | **14.3%** | 0% | **-14.3pp** |
| Levels completed | **1/7** | 0/7 | **-1** |
| Level 1 actions | **26** (completed, 100%) | 180 (not completed) | **Regression** |
| Total actions | 356 | **180** | -49% |
| Children spawned | 4 | 4 | Same |
| Children returned | 1/4 (25%) | **2/4 (50%)** | **+25pp** |
| Knowledge transferred | 1 (post-GAME_OVER) | **2** | **+1** |
| Knowledge curation exercised | 1x | **2x** | **+1** |
| Action budget enforcement | Failed | Failed | Same |
| try-catch around rlm() | No | **YES** | **NEW** |
| Model compliance | Violated | **Yes** | **Fixed** |
| Inline hints violation | Yes | Yes | Same |
| Pure state-check wasted | 3 iterations | **1 iteration** | **Improved** |
| Cost | $4.80 | **$3.63** | **-24%** |
| Wall time | ~24 min | **~17 min** | **-29%** |

### Score Regression Is Stochastic, Not Structural

v1.8.0 regressed on score (0% vs 14.3%) but improved on every structural metric:
- Higher child return rate (50% vs 25%)
- More knowledge transferred (2 vs 1)
- try-catch validated
- Model compliance restored
- Lower cost and wall time
- Fewer wasted iterations

The score difference is entirely attributable to whether a child happened to complete level 1. In v1.7.0, child 1 completed level 1 in 26 actions (a stochastic outlier). In v1.8.0, no child completed level 1 despite 180 total actions. The structural improvements make future level completions more likely (knowledge will accumulate faster, more iterations available for delegation), but they cannot guarantee any individual run's success.

---

## 12. Recommendations for Future Work

### R1 (P0-CRITICAL): Move budget enforcement to the engine level

**Problem:** Three successive prompt-level budget mechanisms have all failed:
- v1.5.0-v1.6.0: Global variable `__originalStep` -- child accessed it directly
- v1.7.0: IIFE closure -- child reassigned `arc3.step`
- v1.8.0: `Object.defineProperty` -- child still bypassed

**Why prompt-level fixes cannot work:** The child LLM has full code execution in the sandbox. Any defense written in JavaScript and injected into the sandbox can be read, analyzed, and circumvented by the LLM. The child is not a constrained program; it is a general-purpose intelligence with the ability to write arbitrary code.

**Fix:** The RLM engine itself must enforce action budgets. Options:
1. **Engine-level action counter:** The engine tracks actions per child and terminates the child after N actions, regardless of what code the child runs.
2. **Rate-limited API proxy:** The `arc3.step()` call goes through an engine-level proxy that counts calls and returns an error after the budget is exceeded.
3. **Sandbox-level Object.freeze on the entire arc3 module** before the child's first iteration executes -- if the engine can freeze the module before the LLM sees it.

This is the single most important infrastructure change needed. Until budget enforcement works, every run risks GAME_OVER from a single child's unbounded exploration.

### R2 (P0-CRITICAL): Eliminate pure state-check iterations via stricter template

**Problem:** Despite try-catch recovering timeouts, the orchestrator still wasted iteration 3 on a pure state check. The LLM deviates from the template to "investigate" after failures.

**Fix:** Strengthen the template's "never check state without delegating" rule. Add a comment like:
```
// NEVER run a state-check-only iteration.
// The Post: line at the end of each delegation already checks state.
// If you see "Post: state=..." in the prior output, DO NOT check state again.
```

Alternatively, combine state-check logic into the delegation block so there is no valid reason for a standalone check.

### R3 (P1): Enforce escalation protocol more strictly

**Problem:** The orchestrator ran 4 attempts on level 1 (2 template + 2 custom), violating the "max 2 completion attempts per level" rule. After the 2nd attempt, the template says to switch to exploration-only mode. The orchestrator instead wrote custom completion prompts.

**Fix:** Make the escalation path explicit and immutable in the template:
```javascript
if (__levelAttempts[level] > 2) {
  // MANDATORY: Use EXACTLY this prompt. Do NOT modify.
  summary = await rlm(
    `Explore level ${level}/7...`,  // exploration-only prompt
    { app: "arc3-player", model: "intelligent" }
  );
}
```

### R4 (P1): Investigate why children 1-2 timeout while children 3-4 return

**Pattern:** In v1.8.0, children 1-2 (template prompts) timed out, while children 3-4 (custom prompts with return urgency language) returned JSON. This pattern suggests:

1. The template prompt's return instructions may be insufficient
2. The custom prompt's "By iteration 8, you MUST call return()" urgency may be effective
3. Later children may benefit from a "warmer" context (more iterations consumed, more state available)

**Fix:** Incorporate return urgency language into the TEMPLATE prompt rather than relying on the LLM to add it via custom deviations:
```
You MUST call return() with your JSON findings by iteration 10. Do NOT use all 30 iterations.
```

### R5 (P2): Add action-count awareness to orchestrator

**Problem:** The orchestrator's `__totalActions` estimate stayed at ~0 because children 1-2 did not return action counts. The actual count (109 after 2 children) was only discovered when the orchestrator deviated to check `arc3.actionCount` directly. Without this, the orchestrator has no idea how close the game is to GAME_OVER.

**Fix:** Have the orchestrator check `arc3.actionCount` as part of the standard post-delegation flow (not as a deviation). This is technically "inspecting game state" but it is a scalar read, not grid analysis:
```javascript
const post = arc3.observe();
const actualActions = arc3.actionCount || 0;
console.log(`Post: state=${post.state}, levels=${post.levels_completed}, actual_actions=${actualActions}`);
```

This would allow the orchestrator to make informed decisions about whether to continue delegating or conserve remaining actions.

### R6 (P2): Consider reducing child iteration cap at engine level

**Problem:** Children get 30 iterations regardless of the `maxIterations` option. Children that will timeout always burn all 30 iterations, consuming time and money. If the engine enforced a lower cap (e.g., 15 iterations for player children), non-returning children would fail faster, leaving more wall time and budget for subsequent children.

### Priority Ranking Summary

| Priority | Rec | Impact | Effort | Domain |
|----------|-----|--------|--------|--------|
| P0 | R1: Engine-level budget enforcement | Prevents game exhaustion | HIGH (engine change) | Engine |
| P0 | R2: Eliminate state-check deviations | +1 delegation per game | LOW (template) | Template |
| P1 | R3: Strict escalation protocol | Prevents wasted attempts | LOW (template) | Template |
| P1 | R4: Return urgency in template prompt | Higher child return rate | LOW (template) | Template |
| P2 | R5: Action-count awareness | Better orchestrator decisions | LOW (template) | Template |
| P2 | R6: Reduced child iteration cap | Faster failure, more children | MEDIUM (engine) | Engine |

---

## 13. The v1.5.0 to v1.8.0 Story

Four versions. Four runs. A clear narrative of structural progress despite noisy scores.

### v1.5.0 (run-021): The Foundation
- Introduced perceptual toolkit (`diffGrids`, `colorFreqs`, `findComponents`, `renderRegion`)
- Introduced `__discover()` function for rapid movement learning
- First implementation of return-string knowledge architecture
- Score: 0%, but 2/5 children returned (40%) and 2 knowledge items transferred
- **Contribution:** Established the tools and patterns that all subsequent versions build on

### v1.6.0 (run-022): The Regression
- Attempted to fix budget enforcement with global `__originalStep`
- Children bypassed it immediately
- 0/3 children returned (0%) -- worst return rate since v1.3.0
- Score: 0%, 133 actions, $3.62
- **Contribution:** Identified that global variable exposure is the wrong defense mechanism

### v1.7.0 (run-023): The Breakthrough
- IIFE closure to hide `_origStep`
- Guard instruction in delegation prompt
- Achieved 14.3% -- best score in plugin series, tied with no-plugin best
- Level 1 completed in 26 actions (under 29-action baseline) -- 100% on level 1
- 1/4 children returned (25%), but the returning child used model: "fast"
- **Contribution:** Proved the architecture CAN produce optimal play. Identified stochastic child performance as the key variable.

### v1.8.0 (run-024): The Validation
- try-catch around `rlm()` -- WORKS perfectly
- Object.defineProperty for budget enforcement -- FAILED (sandbox limitation)
- Budget increased to 32 -- correct but not enforced
- Score: 0%, but structural improvements validated:
  - 50% child return rate (highest ever)
  - Knowledge curation across multiple children (first time)
  - try-catch eliminates wasted iterations
  - Model compliance restored
  - Lowest cost with structural improvements ($3.63)
- **Contribution:** Validated the core architecture (try-catch, knowledge curation, return-string). Conclusively proved budget enforcement cannot be done at prompt level.

### The Arc

```
v1.5.0: Built the tools     -> 0% but architecture established
v1.6.0: Defense failed       -> 0%, regression
v1.7.0: Stochastic success   -> 14.3%, proved capability
v1.8.0: Architecture proven  -> 0%, but structural best-ever
```

The score oscillates (0% -> 0% -> 14.3% -> 0%) because level completion is stochastic. But the structural metrics monotonically improve:

```
Child return rate:  40% -> 0% -> 25% -> 50%  (noisy but trending up)
Knowledge curation: 0x  -> 0x -> 1x  -> 2x   (monotonic improvement)
Wasted iterations:  2+  -> 3+ -> 3   -> 1    (monotonic improvement)
Budget enforcement: No  -> No -> No  -> No   (unsolved, needs engine)
```

The architecture is sound. The two remaining blockers are:
1. **Budget enforcement** (requires engine change)
2. **Consistent child performance** (requires better prompts or more children per game)

---

## 14. Appendix

### A. Iteration Trace

| Iter | Type | Game Actions (this iter) | Cumulative Actions | Key Event |
|------|------|------------------------|-------------------|-----------|
| 0 | Init | 0 | 0 | `arc3.start()` executed. Template-compliant start. |
| 1 | Delegation | ~55 | ~55 | Child 1 (L1 att.1, completion). Timeout. try-catch caught error. Post-delegation executed in-line. |
| 2 | Delegation | ~54 | ~109 | Child 2 (L1 att.2, completion). Timeout. try-catch caught error. Post-delegation executed in-line. |
| 3 | State check | 0 | 109 | DEVIATION: pure state check. Revealed `arc3.actionCount = 109`. Wasted iteration. |
| 4 | Delegation | ~70 | ~179 | Child 3 (L1 att.3, custom prompt + maxIterations:12). **Returned JSON.** Knowledge: 7 mech, 6 rules. |
| 5 | Delegation | ~1 | 180 | Child 4 (L1 att.4, custom prompt + maxIterations:12). **Returned JSON.** Knowledge: 9 mech, 11 rules. GAME_OVER. |
| 6 | Score | 0 | 180 | Score retrieval. 0%, 0/7 levels, 180 actions. |

### B. Action Attribution

| Child | Iter | Target | Actions (est.) | Budget (32) | Returned? | Outcome |
|-------|------|--------|---------------|-------------|-----------|---------|
| 1 | 1 | L1 att.1 | ~55 | 32 | No (timeout) | L1 not completed |
| 2 | 2 | L1 att.2 | ~54 | 32 | No (timeout) | L1 not completed |
| 3 | 4 | L1 att.3 | ~70 | 32 | **YES (JSON)** | L1 not completed, returned knowledge |
| 4 | 5 | L1 att.4 | ~1 | 32 | **YES (JSON)** | GAME_OVER after 1 action, returned knowledge |

### C. Child Return Rate History

| Version | Children | Returned | Rate | Mechanism |
|---------|----------|----------|------|-----------|
| v1.0.0 | 1 | 0 | 0% | No guard, no interceptor |
| v1.1.0 | 2 | 0 | 0% | No guard, no interceptor |
| v1.2.0 | 3 | 0 | 0% | No guard, no interceptor |
| v1.3.0 | 2 | 0 | 0% | No guard, no interceptor |
| v1.4.0 | 6 | 1 | 17% | GAME_OVER forced |
| v1.5.0 | 5 | 2 | 40% | Budget exhaustion + guard |
| v1.6.0 | 3 | 0 | 0% | Guard not called, interceptor bypassed |
| v1.7.0 | 4 | 1 | 25% | Voluntary (fast model), post-GAME_OVER |
| **v1.8.0** | **4** | **2** | **50%** | **Voluntary (intelligent model), custom prompt** |
| **Total** | **30** | **6** | **20%** | -- |

### D. v1.8.0 Plugin Changes (Summary)

| Change | Source (v1.7.0 Rec) | Implemented? | Effective? |
|--------|---------------------|-------------|-----------|
| try-catch around `rlm()` | R1 | **YES** | **YES -- validated, eliminates wasted iterations** |
| Budget increased to 32 | R2 | **YES** | Not testable (enforcement failed) |
| Object.defineProperty for `arc3.step` | R3 | **YES** | **NO -- children still bypassed budget** |
| State check combined with delegation | R4 | YES (via R1) | **YES for timeouts, but LLM still wasted iter 3** |
| Engine-level guard enforcement | -- | NO | N/A (requires engine change) |

### E. Knowledge State at End of Run

After child 4 (final state of `__knowledge`):

**Mechanics (9):**
1. movement -- "Actions 1=Up, 2=Down, 3=Left, 4=Right"
2. up -- "Moves color 12 (red) block up by 5 rows"
3. down -- "Moves color 12 (red) block down by 5 rows"
4. left -- "Moves color 12 (red) block left by 5 cols"
5. right -- "Moves color 12 (red) block right by 5 cols"
6. timer -- "There's a timer - game ended as GAME_OVER"
7. blockSize -- "Red block is 2x5 (rows 45-46, cols 39-43)"
8. actionCount -- "180 actions were already used"
9. (1 additional, truncated in output)

**Object Types (2+):**
1. color3 -- "Walls (#) - form maze boundaries"
2. color4 -- "Corridors (.) - open space / background"
3. (additional types truncated in output)

**Rules (11):** Content truncated in trace output.

**Assessment:** The knowledge base correctly identifies basic movement mechanics, environmental elements, and the fuel/timer system. It does NOT contain any information about the goal, pattern matching, toggles, color changers, or strategic sequencing. This knowledge would be sufficient to improve movement efficiency in subsequent children but insufficient to actually complete a level (which requires finding and reaching the goal with the correct pattern).
