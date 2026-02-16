# Run 019 Analysis: ARC-3 v1.3.0 Orchestrator + Player Plugins

**Date:** 2026-02-16
**Run file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T05-16-02-689Z.json`
**Model:** claude-opus-4-6
**Plugins:** arc3-orchestrator v1.3.0 + arc3-player v1.3.0
**Config:** maxIterations=30, maxDepth=2, concurrency=5
**Score:** 0% (0/7 levels completed)
**Prior run (run-018, v1.2.0):** 0% (0/7 levels, 138 actions, $4.49)
**Prior run (run-017, v1.1.0):** 0% (0/7 levels, ~80+ actions, $4.42)
**Prior run (run-016, v1.0.0):** 0% (0/7 levels, 45 actions, $0.45)
**Prior best (run-015, no plugin):** 14.3% (1/7 levels, 18 actions on Level 1)
**Replay:** https://three.arcprize.org/scorecards/e762a719-7df6-4747-a709-7e2632eace7c

---

## 1. Run Summary

| Metric | run-015 (no plugin) | run-016 (v1.0.0) | run-017 (v1.1.0) | run-018 (v1.2.0) | run-019 (v1.3.0) |
|--------|---------------------|-------------------|-------------------|-------------------|-------------------|
| Score | 14.3% | 0% | 0% | 0% | 0% |
| Levels completed | 1/7 | 0/7 | 0/7 | 0/7 | 0/7 |
| Config | maxIter=30, depth=2 | maxIter=15, depth=2 | maxIter=30, depth=2 | maxIter=30, depth=2 | maxIter=30, depth=2 |
| Outer iterations used | ~15 | 15 (capped) | 30 (capped) | 30 (capped) | **6 (early return)** |
| Task status | -- | Failed | Failed | Failed | **Completed** |
| Total game actions | 57 | 45 | ~80+ (reset mid-run) | 138 | 154 |
| Actions by orchestrator | -- | ~10 | ~45 | ~43 | **0** |
| Actions by children | -- | ~35 | ~35 | ~95 | **154** |
| Final state | -- | NOT_FINISHED | NOT_FINISHED | GAME_OVER | GAME_OVER |
| Wall time | -- | -- | 1,023s (17 min) | 1,211s (20 min) | 1,086s (18 min) |
| Cost | -- | ~$0.45 | $4.42 | $4.49 | **$3.87** |
| Child delegations | 1 (ad-hoc) | 1 (wrong signature) | 2 (correct signature) | 3 (correct signature) | 2 (correct signature) |
| Child outcomes | Returned useful JSON | Timed out (no return) | Both timed out | All 3 timed out | Both timed out |
| arc3.start() calls | -- | 2 (double) | 2 (double) | 1 (correct) | 1 (correct) |
| Game reset by child | No | No | Yes (catastrophic) | No | No |
| Orchestrator called arc3.step() | -- | Yes | Yes | Yes (from iter 8) | **Never** |

**Bottom line:** v1.3.0 achieved two major structural milestones: (1) the orchestrator never called `arc3.step()` -- the prohibition held for the entire run, and (2) the orchestrator returned a value (task status = Completed) for the first time in the series. However, the score remained 0% because both children timed out without returning, burning 154 actions (all three lives) on Level 1. The child deadline guard at iteration 12 was not effective. The game ended in GAME_OVER before the orchestrator could attempt the escalation protocol's "skip to next level" step. Cost decreased to $3.87 (from $4.49) because only 6 outer iterations were used instead of 30.

---

## 2. v1.3.0 Changes Assessment

### Change 1: Deadline guard hardcoded at iteration 12 -- did children return?

**FAILED.** Both children consumed all 30 iterations without returning. The v1.3.0 player plugin requires this guard as "the literal first 4 lines of every code block":

```javascript
if (typeof __iterCount === 'undefined') __iterCount = 0;
__iterCount++;
if (__iterCount >= 12) {
  __level_result = { knowledge: __k || {}, actions: __actionsThisLevel || 0, completed: false };
  return("Emergency return at iter " + __iterCount);
}
```

The guard was lowered from the v1.2.0 threshold of `__maxIter - 2` (=18) to a hard 12. Despite this:
- Child 1 ran for 30 iterations and consumed ~97 actions
- Child 2 ran for 30 iterations and consumed ~57 actions

**Why it failed:** The most likely explanation is that the child model does not literally copy the guard into every code block. The instruction "This guard MUST be the literal first 4 lines of every code block. No exceptions." competes with the model's natural code generation patterns. Without child traces, we cannot confirm, but the evidence is unambiguous: the guard did not fire at iteration 12 for either child.

**Impact:** This remains the #1 blocker. If Child 1 had returned at iteration 12 with partial knowledge (~40 actions, some discoveries), the orchestrator would have received knowledge, curated it, and delegated Child 2 with better context. Instead, Child 1 burned 97 actions blind and Child 2 inherited nothing.

### Change 2: arc3.step() framed as "unavailable" -- did the orchestrator obey?

**WORKED.** The v1.3.0 orchestrator plugin reframed the prohibition from "You MUST NOT call arc3.step()" (normative) to "You do NOT have access to arc3.step(). Only child agents can call arc3.step()" (factual/declarative). This reframing was decisive:

- Iteration 0: Called `arc3.start()` and delegated (no `arc3.step()`)
- Iteration 1: Delegated again (no `arc3.step()`)
- Iteration 2: Delegated with reduced scope (no `arc3.step()`)
- Iteration 3: Observed grid via `arc3.observe()` (read-only, no actions)
- Iteration 4: Called `arc3.getScore()` (no `arc3.step()`)
- Iteration 5: Returned result (no `arc3.step()`)

The orchestrator's `arc3.step()` call count: **zero**. Compare:
- v1.0.0: Called `arc3.step()` from iteration 1
- v1.1.0: Called `arc3.step()` from iteration 3
- v1.2.0: Called `arc3.step()` from iteration 8

**Verdict: Fully successful.** The declarative framing ("you do not have access") was more effective than the normative framing ("you must not call"). This is a clean demonstration of prompt design influencing model behavior.

### Change 3: Escalation protocol -- was it followed?

**PARTIALLY FOLLOWED.** The v1.3.0 orchestrator plugin defines:

1. First failure: Re-delegate with minimal scope
2. Second failure: Skip this level. Delegate the NEXT level instead.
3. NEVER spend more than 2 delegation attempts on a single level.

What actually happened:
- First delegation (iter 0, 2nd code block): Child 1 timed out
- The orchestrator did NOT perform an explicit "first failure" retry with minimal scope between iterations 0 and 1. Instead, iteration 1 was a fresh full delegation (not a minimal retry).
- Second delegation (iter 2): Child 2 timed out with reduced scope prompt ("Explore by trying actions, observe changes")
- After the second timeout, the orchestrator observed the game state and discovered GAME_OVER.

The "skip to next level" step was never tested because the game ended (all lives lost) before the orchestrator could attempt it. The orchestrator did limit itself to 2 delegation attempts for Level 1, which is compliant with rule 3. But the escalation was not the clean 1-retry-then-skip pattern specified.

**Verdict: Partially compliant.** The 2-attempt cap was respected (by circumstance -- GAME_OVER intervened). The retry prompt was shorter but not the minimal "move in each direction once, diff, return" specified in the plugin. The skip-to-next-level step was never tested.

### Change 4: Character identification hint -- was it used?

**UNKNOWN.** The v1.3.0 player plugin added behavioral priority #8:

> "The player character is the largest multi-color object that moves. Do NOT assume the smallest or most visually distinctive object is the player. Test movement first: the entity that changes position when you take directional actions IS your character."

Without child traces, we cannot determine whether children read this hint or applied it. The children consumed 97 and 57 actions respectively without completing the level, suggesting they still struggled with fundamental mechanics. In v1.2.0, character misidentification was the root cause of the orchestrator's failed direct play. Whether children in v1.3.0 correctly identified the character remains unknown.

**Verdict: Cannot assess.** Child traces are needed.

### Change 5: Shorter retry prompts -- effective?

**PARTIALLY EFFECTIVE.** The v1.3.0 orchestrator plugin includes a shorter retry template:

```javascript
const retry = await rlm(
  `Explore level ${level}/7. Move in each direction once, diff the grid, return what you find. Return within 10 iterations.`,
  { app: "arc3-player", model: "intelligent", maxIterations: 15 }
);
```

The orchestrator's actual retry (iteration 2) used a somewhat different prompt:

```
Play level 1/7. Explore by trying actions, observe changes, solve the puzzle.
Prior knowledge: {...}. Write findings to __level_result. Return a brief summary of what you did.
```

This is shorter than v1.2.0's retries (which inlined maze layouts, color interpretations, and action mappings) but still longer than the template's minimal version. The orchestrator added `Prior knowledge: ${JSON.stringify(__knowledge || {})}` inline -- though this was just `{}` since no knowledge had been accumulated.

**Verdict: Marginal improvement.** The retry prompt was shorter than v1.2.0 but did not follow the minimal template exactly. Since the child still timed out, effectiveness is moot.

---

## 3. Delegation Analysis

### Children Spawned: 2

| Child | Spawned At | Prompt Style | maxIterations | Actions Consumed | Actions/Iteration | Returned? | Knowledge Back? |
|---|---|---|---|---|---|---|---|
| Child 1 | Iter 0 (2nd code block) | Full template | 25 | ~97 | ~3.2 | No (timeout at 30) | No |
| Child 2 | Iter 2 | Shorter/focused | 15 | ~57 | ~1.9 | No (timeout at 30) | No |

### Action Consumption Pattern

Child 1 consumed ~97 actions in 30 iterations (~3.2 actions per iteration). This is the highest per-child action rate in the series:

| Run | Child | Actions | Iterations | Actions/Iter |
|---|---|---|---|---|
| v1.0.0 | Child 1 | ~35 | 30 | ~1.2 |
| v1.1.0 | Child 1 | ~35 | 30 | ~1.2 |
| v1.2.0 | Child 1 | 24 | 30 | 0.8 |
| v1.2.0 | Child 2 | ~21 | 30 | 0.7 |
| v1.2.0 | Child 3 | ~50 | 30 | 1.7 |
| **v1.3.0** | **Child 1** | **~97** | **30** | **~3.2** |
| **v1.3.0** | **Child 2** | **~57** | **30** | **~1.9** |

Child 1's 3.2 actions per iteration suggests it was running multi-action loops within individual code blocks (e.g., "try all 4 directions" = 4 actions per block, or exploration loops with multiple `arc3.step()` calls). The v1.3.0 player plugin's discovery protocol instructs "Test each action exactly once" in iteration 1, which would be 4 actions. But 97 actions over 30 iterations means the child continued taking multiple actions per iteration well beyond the discovery phase.

The 40-action-per-level cap in the player plugin was clearly not enforced. Child 1 took ~97 actions (2.4x the cap). Child 2 took ~57 actions (1.4x the cap). Combined: 154 actions, nearly 4x what a single child should spend.

### Knowledge Flow: Zero (unchanged from v1.2.0)

No child returned `__level_result`. The knowledge curation blocks in the orchestrator never executed. The `__knowledge` object remained empty throughout the run. Cross-level knowledge transfer: none.

### Delegation Quality

The delegation pattern was cleaner than v1.2.0:
- Both used `app: "arc3-player"` (correct)
- Both set `__level_task` (correct)
- The orchestrator never inlined game-specific knowledge in the prompt (improvement over v1.2.0's third delegation which included extensive maze layout data)
- The retry was shorter-scoped (improvement over v1.2.0's increasingly verbose retries)

However, the double code block in iteration 0 was a problem: it caused Child 1 to spawn inside the initialization iteration, consuming most of the action budget before the orchestrator even began its delegation loop.

---

## 4. Knowledge Accumulation

Cross-referencing against the canonical rules discovery checklist. Since no child returned results and the orchestrator never played directly, knowledge accumulation was effectively zero. The orchestrator's post-mortem grid observation (iteration 3) provides the only data point.

| # | Canonical Discovery | v1.0.0 | v1.1.0 | v1.2.0 | v1.3.0 | Notes (v1.3.0) |
|---|---|:---:|:---:|:---:|:---:|---|
| 1 | Character identification | PARTIAL | **YES** | WRONG | UNKNOWN | No child trace. Orchestrator never attempted to identify. |
| 2 | Movement mechanics (5px, 4 dirs) | MISSED | **YES** | PARTIAL | UNKNOWN | No child trace. Children took actions but we cannot see what they learned. |
| 3 | Wall detection | MISSED | **YES** | **YES** | UNKNOWN | No child trace. |
| 4 | Fuel depletion | PARTIAL | PARTIAL | PARTIAL | MISSED | Orchestrator observed empty fuel bar (row 15 of downsampled grid = all 5s) but did not interpret it. |
| 5 | Fuel refill | MISSED | MISSED | MISSED | MISSED | -- |
| 6 | Lives counter | MISSED | MISSED | PARTIAL | MISSED | Game ended in GAME_OVER but orchestrator did not connect it to lives mechanic. |
| 7 | Pattern toggle | MISSED | PARTIAL | PARTIAL | MISSED | Orchestrator saw colors 0/1 in downsampled grid but did not investigate. |
| 8 | Color changer | MISSED | MISSED | MISSED | MISSED | -- |
| 9 | Goal icon identification | MISSED | PARTIAL | PARTIAL | MISSED | The downsampled grid shows the goal area but orchestrator did not analyze it. |
| 10 | Current pattern display (bottom-left HUD) | PARTIAL | **YES** | **YES** | MISSED | Bottom-left area visible in downsampled grid (row 14: `4994...`) but not interpreted. |
| 11 | Pattern matching requirement | MISSED | PARTIAL | MISSED | MISSED | -- |
| 12 | Strategic sequencing | MISSED | MISSED | MISSED | MISSED | -- |
| 13 | Fog of war (Level 7) | N/A | N/A | N/A | N/A | Never reached Level 7. |

**Effective discovery scores:**
- v1.0.0: 0 full, 3 partial = ~1.5 effective
- v1.1.0: 3 full, 4 partial = ~5.0 effective
- v1.2.0: 2 full, 4 partial = ~4.0 effective
- v1.3.0: 0 full, 0 partial = **~0.0 effective**

**v1.3.0 is a severe regression in observable game knowledge.** However, this is a misleading metric. v1.1.0 and v1.2.0 accumulated knowledge through the orchestrator's direct play (calling `arc3.step()` and analyzing results). v1.3.0's orchestrator correctly refrained from direct play, so all knowledge generation was delegated to children who timed out without returning. The children may have discovered substantial mechanics internally -- but since they never returned results, the knowledge is invisible.

**The real comparison should be: knowledge returned from children**, which is 0 across all four runs. The v1.1.0/v1.2.0 "knowledge" was generated by the orchestrator violating its role. v1.3.0 is the first honest measurement of the delegation architecture's actual knowledge transfer capability, and it is zero.

---

## 5. What Improved vs v1.2.0

### 1. Orchestrator never called arc3.step() (MAJOR)

The single most important structural improvement across all four runs. The declarative framing ("you do not have access") was decisively more effective than the normative framing ("you must not call"). The orchestrator stayed in its manager role from start to finish. This validates the approach of describing capability boundaries as facts rather than rules.

**Impact:** Isolates the problem cleanly. All 154 actions were child-generated. Debugging is now purely about child behavior, not orchestrator discipline.

### 2. Task status = Completed (MAJOR)

For the first time, the harness recorded the task as Completed rather than Failed. The orchestrator detected GAME_OVER, handled the scorecard 404 gracefully, and returned a JSON result. This demonstrates functional end-game handling and iteration budget conservation.

### 3. Fewer outer iterations (6 vs 30) (SIGNIFICANT)

The orchestrator used only 6 of 30 available iterations. It did not spin in an analysis loop or attempt direct play. When it discovered GAME_OVER, it returned immediately. This preserved wall time and cost.

### 4. Lower cost ($3.87 vs $4.49) (MODERATE)

13% cost reduction driven by fewer outer iterations. The cost could be further reduced by fixing child timeouts (each child that times out costs ~$1.50 in wasted tokens).

### 5. No grid analysis during active play (MINOR)

The orchestrator only analyzed the grid after discovering GAME_OVER (post-mortem), not during active gameplay. In v1.2.0, the orchestrator spent iterations 5-6 analyzing the grid while the game was still active, which violated the plugin rules and wasted iterations.

---

## 6. What Still Fails

### Failure 1: Children time out without returning (CRITICAL -- STILL #1 BLOCKER)

Two out of two children consumed all 30 iterations without returning. The deadline guard at iteration 12 was not effective. The action budget cap at 40 was not enforced. This is the same failure mode as v1.0.0, v1.1.0, and v1.2.0.

**Cross-run child return rate: 0 out of 8 total children across 4 runs.**

The v1.3.0 player plugin has arguably the strongest deadline guard design yet (hardcoded at 12, required as "literal first 4 lines of every code block"), and it still failed. The evidence strongly suggests that **prompt-based guards are fundamentally unreliable for controlling child return behavior**. The model does not literally copy the guard template into every code block, regardless of how emphatically the instruction is stated.

**Root cause diagnosis:** The problem is architectural, not prompt-based. The engine does not honor `maxIterations` in `rlm()` options (children get the parent's 30), and there is no harness-level mechanism to force child returns. Prompt instructions are suggestions that compete with the model's code generation tendencies.

### Failure 2: Children consume excessive actions (SEVERE)

Child 1 consumed ~97 actions -- the highest single-child action count in the series. The 40-action-per-level cap was not enforced. Combined, children burned 154 actions, exhausting all 3 lives on Level 1. If a child had respected the 40-action cap, the game would have survived for additional delegation attempts.

**Why this is worse than v1.2.0:** In v1.2.0, the orchestrator's direct play burned ~43 actions, but the orchestrator learned from those actions (discovered block mechanics, mapped walls). In v1.3.0, children burned 154 actions and returned nothing. Higher action cost, lower knowledge return.

### Failure 3: Double code block in iteration 0 (MODERATE)

The orchestrator emitted two code blocks in iteration 0 despite the plugin instruction "emit EXACTLY ONE block." This caused Child 1 to spawn inside the initialization iteration, consuming ~97 actions before the orchestrator entered its delegation loop. The double-block problem has been present in various forms since v1.0.0.

### Failure 4: Escalation protocol not fully tested (MINOR)

The game reached GAME_OVER before the orchestrator could test the "skip to next level" escalation step. We do not know if the orchestrator would have correctly skipped Level 1 and delegated Level 2 after two failures.

### Failure 5: Scorecard API returned 404 (MINOR)

The `arc3.getScore()` call failed with a 404 error. The orchestrator handled this gracefully by constructing a manual scorecard, but this is a fragile workaround. The root cause is unclear -- possibly the ARC-3 server does not generate scorecards for games with 0 completed levels.

---

## 7. Recommendations for v1.4.0

Prioritized by expected impact. All changes are plugin-only -- no harness changes.

### P0: Embed the deadline guard in the Iteration 0 setup code as a persistent mechanism

**Problem:** Asking the child to paste a guard at the top of every code block does not work. 0 out of 8 children across 4 runs have returned via the guard. The instruction-following approach is exhausted.

**Fix in `arc3-player.md`:** Instead of asking the child to paste a guard, make the Iteration 0 setup code DEFINE the guard as a persistent check that fires automatically:

```javascript
// In Iteration 0 setup (the code the child is most likely to copy):
__iterCount = 0;
__checkDeadline = function() {
  __iterCount++;
  if (__iterCount >= 10) {
    __level_result = { knowledge: __k || {}, actions: __actionsThisLevel || 0, completed: false };
    return true; // signal caller to return
  }
  return false;
};
```

Then instruct the child: "Start every code block with `if (__checkDeadline()) return('Deadline');`" -- a single short line is more likely to be copied than a 4-line block.

Additionally, make the Iteration 0 code end with an explicit plan:

```javascript
// PLAN: I have 10 iterations.
// Iter 0 (this): setup
// Iter 1: discovery (test each action, diff grid)
// Iter 2-8: play the level
// Iter 9: MUST return __level_result, even if incomplete
console.log("PLAN: 10 iterations. Discovery at 1, play 2-8, return by 9.");
```

### P1: Reduce child action budget to 25 (from 40) and enforce via API guard

**Problem:** Children take 57-97 actions per delegation, burning through lives. The 40-action cap is a prompt instruction that is not enforced.

**Fix in `arc3-player.md`:** Lower the cap to 25 and embed the check in the same single-line guard:

```javascript
__checkBudget = function() {
  if ((__actionsThisLevel || 0) > 25) {
    __level_result = { knowledge: __k || {}, actions: __actionsThisLevel, completed: false, reason: 'action_cap' };
    return true;
  }
  return false;
};
```

Instruct: "Start every code block with `if (__checkDeadline() || __checkBudget()) return('Budget/Deadline');`"

Also add a wrapper instruction around `arc3.step()`:

```javascript
// ALWAYS use this wrapper instead of calling arc3.step() directly:
async function step(action) {
  __actionsThisLevel = (__actionsThisLevel || 0) + 1;
  if (__actionsThisLevel > 25) {
    console.log("ACTION CAP REACHED. Returning immediately.");
    __level_result = { knowledge: __k || {}, actions: __actionsThisLevel, completed: false };
    return null; // signal to stop
  }
  return await arc3.step(action);
}
```

### P2: Fix the double code block problem in iteration 0

**Problem:** The orchestrator emits two code blocks in iteration 0 (setup + delegation) despite instructions to emit only one. This has occurred in 3 of 4 runs.

**Fix in `arc3-orchestrator.md`:** Make the instruction even more explicit and add a structural reason:

```markdown
### Iteration 0: Start the game

Emit EXACTLY ONE code block containing ONLY the initialization code below. Do NOT include delegation code. Do NOT include any other logic. The reason: the engine processes only the first code block per iteration, and you need to verify the game started before delegating.

After this block executes, you will see the output. In your NEXT response (iteration 1), begin delegation.
```

Alternatively, merge the start and first delegation into a single block with a conditional:

```javascript
if (typeof __knowledge === 'undefined') {
  const init = await arc3.start();
  __knowledge = { objectTypes: {}, mechanics: {}, rules: [], openQuestions: [] };
  __outerIter = 0;
  console.log("Game started. State:", init.state, "Levels:", init.levels_completed);
  console.log("NEXT ITERATION: Begin delegation. Do not delegate in this iteration.");
}
```

### P3: Make the orchestrator's escalation protocol more concrete with iteration mapping

**Problem:** The escalation protocol exists but the orchestrator does not follow it precisely. It does not distinguish "first failure retry" from "second delegation."

**Fix in `arc3-orchestrator.md`:** Map iterations to actions explicitly:

```markdown
### Iteration Plan (follow this exactly)

| Outer Iter | Action |
|---|---|
| 0 | arc3.start() -- nothing else |
| 1 | Delegate Level 1 (maxIterations: 25) |
| 2 | If child 1 failed: retry Level 1 with minimal scope (maxIterations: 15) |
| 3 | If child 2 failed: skip Level 1, delegate Level 2 |
| 4 | If child 3 failed: retry Level 2 with minimal scope |
| 5 | If child 4 failed: skip Level 2, delegate Level 3 |
| ... | Continue pattern: 2 attempts per level, then skip |
| 27 | Return scorecard regardless of progress |
```

### P4: Add a "return early if GAME_OVER detected" check to the player plugin

**Problem:** Children continue playing after the game has entered GAME_OVER state, wasting iterations and producing no useful output.

**Fix in `arc3-player.md`:** Add to the action wrapper:

```javascript
async function step(action) {
  __actionsThisLevel = (__actionsThisLevel || 0) + 1;
  const result = await arc3.step(action);
  if (result.state === 'GAME_OVER') {
    console.log("GAME OVER detected. Returning immediately.");
    __level_result = { knowledge: __k || {}, actions: __actionsThisLevel, completed: false, reason: 'game_over' };
    // Signal: do not take more actions
  }
  return result;
}
```

### P5: Structure the discovery protocol as a self-contained function call, not template code

**Problem:** The discovery protocol (test each action once, diff, record changes) is provided as template code that children may not copy. Making it a function defined in Iteration 0 increases the chance it will be called.

**Fix in `arc3-player.md`:** In the Iteration 0 setup, define a `discover()` function:

```javascript
__discover = async function() {
  const discoveries = [];
  const baseline = arc3.observe().frame[0];
  for (const action of [1, 2, 3, 4]) {
    const before = arc3.observe().frame[0];
    const result = await arc3.step(action);
    __actionsThisLevel++;
    const after = result.frame[0];
    const changes = diffGrids(before, after);
    const mazeChanges = changes.filter(c => c.r < 52);
    const hudChanges = changes.filter(c => c.r >= 52);
    discoveries.push({ action, maze: mazeChanges.length, hud: hudChanges.length,
      mazeEx: mazeChanges.slice(0, 10), state: result.state });
    console.log(`Action ${action}: ${mazeChanges.length} maze, ${hudChanges.length} HUD changes`);
    if (result.levels_completed > __startLevel) break;
  }
  return discoveries;
};
```

Then instruct: "In iteration 1, call `const disc = await __discover();` and analyze the results."

### P6: Request harness-level child iteration cap (HARNESS CHANGE -- out of scope but critical)

The `maxIterations` parameter in `rlm()` is not honored by the engine. Children always get the parent's 30 iterations. This is the root cause of the child timeout problem. If the engine capped children at 15 iterations (regardless of prompt-based guards), the children would be forced to return or time out quickly, conserving actions and wall time.

This is noted as out-of-scope (harness change) but should be the highest priority engineering task for the RLM framework.

---

## 8. Appendix

### A. Iteration Trace

| Iter | Agent | Code Blocks | Game Actions | Key Event |
|---|---|---|---|---|
| 0 | Orchestrator | 2 (only 1st intended) | 0 + ~97 (child) | `arc3.start()` executed. Second block spawned Child 1 which timed out after ~97 actions. |
| 1 | Orchestrator | 1 | 0 (child timed out) | Delegated Child 2 via standard template. Child timed out (no return). Actually no child spawned -- the rlm() call returned empty, meaning the engine error from iter 0's child consumed this iteration. |
| 2 | Orchestrator | 1 | ~57 (child) | Delegated with reduced scope (maxIterations: 15). Child 2 timed out after ~57 more actions (97 to 154 total). Game reached GAME_OVER during this child's run. |
| 3 | Orchestrator | 1 | 0 | Post-mortem. Observed state: GAME_OVER, 154 actions. Printed downsampled grid. |
| 4 | Orchestrator | 1 | 0 | Called `arc3.getScore()` -- 404 error. |
| 5 | Orchestrator | 1 | 0 | Constructed manual scorecard JSON. **Returned value.** Task = Completed. |

**Total game actions:** 154
**Total outer iterations:** 6 / 30
**Total children spawned:** 2
**Children that returned:** 0
**Orchestrator `arc3.step()` calls:** 0

### B. Canonical Discovery Comparison (v1.0.0 through v1.3.0)

| # | Discovery | v1.0.0 (run-016) | v1.1.0 (run-017) | v1.2.0 (run-018) | v1.3.0 (run-019) | Canonical Truth |
|---|---|:---:|:---:|:---:|:---:|---|
| 1 | Character ID | PARTIAL | **YES** | WRONG | UNKNOWN | 5x5 block, orange(12) top / blue(9) bottom |
| 2 | Movement mechanics | MISSED | **YES** | PARTIAL | UNKNOWN | 5px discrete steps, 4 cardinal directions |
| 3 | Wall detection | MISSED | **YES** | **YES** | UNKNOWN | Dark color walls block movement |
| 4 | Fuel depletion | PARTIAL | PARTIAL | PARTIAL | MISSED | Movement costs fuel, bar depletes per step |
| 5 | Fuel refill | MISSED | MISSED | MISSED | MISSED | Yellow box with dark center, refills completely |
| 6 | Lives counter | MISSED | MISSED | PARTIAL | MISSED | 3 red squares, lose one when fuel depletes |
| 7 | Pattern toggle | MISSED | PARTIAL | PARTIAL | MISSED | White cross, changes current pattern |
| 8 | Color changer | MISSED | MISSED | MISSED | MISSED | Rainbow box, changes pattern color |
| 9 | Goal icon | MISSED | PARTIAL | PARTIAL | MISSED | Framed icon in maze, reach it to complete level |
| 10 | Current pattern display | PARTIAL | **YES** | **YES** | MISSED | Bottom-left HUD, shows current pattern state |
| 11 | Pattern matching req | MISSED | PARTIAL | MISSED | MISSED | GateKeeper pattern must match goal icon |
| 12 | Strategic sequencing | MISSED | MISSED | MISSED | MISSED | Transform pattern, then navigate to goal |
| 13 | Fog of war (L7) | N/A | N/A | N/A | N/A | Only small region visible around character |

**Effective discovery scores (from orchestrator trace):**
- v1.0.0: 0 full, 3 partial = ~1.5
- v1.1.0: 3 full, 4 partial = ~5.0
- v1.2.0: 2 full, 4 partial = ~4.0
- v1.3.0: 0 full, 0 partial = ~0.0

**Important caveat:** v1.3.0's score of 0.0 reflects the orchestrator's observable knowledge, not total system knowledge. Children may have discovered mechanics internally but failed to return them. v1.1.0/v1.2.0 scores include knowledge from the orchestrator's rule-violating direct play. v1.3.0 is the first honest measure of knowledge transfer through the delegation architecture.

### C. Structural Progress Metrics (v1.0.0 through v1.3.0)

| Metric | v1.0.0 | v1.1.0 | v1.2.0 | v1.3.0 | Trend |
|---|---|---|---|---|---|
| Orchestrator respected arc3.step() ban | 0 iters | 2 iters | 7 iters | **30 iters (all)** | Fixed |
| Task status = Completed | No | No | No | **Yes** | Fixed |
| arc3.start() called exactly once | No (2x) | No (2x) | Yes | Yes | Stable |
| Children called arc3.start() | N/A | Yes (reset) | No | No | Stable |
| Children returned results | 0/1 | 0/2 | 0/3 | 0/2 | **No progress** |
| Knowledge transferred to orchestrator | 0 | 0 | 0 | 0 | **No progress** |
| Cost | $0.45 | $4.42 | $4.49 | $3.87 | Improving |
| Outer iterations wasted | 15 | 30 | 30 | 6 | Improving |

The structural progress is clear: orchestrator discipline is now solved (arc3.step() ban holds, task completes, iterations conserved). The remaining problem is entirely child-side: children do not return results, do not respect iteration guards, and do not respect action budgets. Solving the child return problem is the single gate between the current architecture and a functioning learning loop.

### D. Cost Efficiency Analysis

| Run | Cost | Children Spawned | Cost per Child | Useful Returns | Cost per Useful Return |
|---|---|---|---|---|---|
| v1.0.0 | $0.45 | 1 | $0.45 | 0 | N/A |
| v1.1.0 | $4.42 | 2 | $2.21 | 0 | N/A |
| v1.2.0 | $4.49 | 3 | $1.50 | 0 | N/A |
| v1.3.0 | $3.87 | 2 | $1.94 | 0 | N/A |

The cost per useful child return is undefined (division by zero) across all four runs. Until a child returns results, the delegation architecture generates zero ROI. The first child return -- even with partial knowledge and incomplete level -- would be the most significant milestone since run-015's 14.3% score.

### E. Action Budget Trend

| Run | Total Actions | By Orchestrator | By Children | Children Returned | Effective Actions (led to knowledge) |
|---|---|---|---|---|---|
| v1.0.0 | 45 | ~10 | ~35 | 0 | ~10 (orchestrator direct) |
| v1.1.0 | ~80 | ~45 | ~35 | 0 | ~45 (orchestrator direct) |
| v1.2.0 | 138 | ~43 | ~95 | 0 | ~43 (orchestrator direct) |
| v1.3.0 | 154 | 0 | 154 | 0 | **0** |

v1.3.0 has the highest total action count and the lowest effective action count. This paradox is explained by the structural shift: the orchestrator no longer compensates for child failures by playing directly. The system is now fully dependent on children to generate value, and children are generating none.

This is the correct architecture -- but it requires children to actually work. v1.4.0 must solve the child return problem or the delegation architecture will continue to underperform the no-plugin baseline (run-015: 14.3% with direct play).
