# ARC-3 Delegation Experiment: v0.1.0 / v0.2.0 / v0.3.0 Comparative Analysis

**Date:** 2026-02-15
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6 (all three runs)
**Runs:** run-008 (v0.1.0), run-009 (v0.2.0), run-010 (v0.3.0)

---

## 1. Executive Summary

Three versions of the ARC-3 delegation plugins have been tested against the same puzzle (ls20-cb3b57cc, 7 levels required for a win). The arc is one of rapid mechanical improvement followed by a plateau on a persistent protocol failure:

- **v0.1.0** (20 iters, Flash scout): Total failure. Double-execution bug spawned two useless scouts that consumed 42 game actions. Parent rediscovered mechanics independently but ran out of fuel before completing any level. Score: 0.
- **v0.2.0** (20 iters, Sonnet scout): Major leap. Single scout consumed only 7 actions and delivered a high-quality report. Parent completed level 1 at iter 13. Ran out of iterations on level 2 with 56 fuel remaining. Score: 0 (no `return()` call).
- **v0.3.0** (30 iters, Sonnet scout): Incremental improvement. Map-while-navigate pattern reduced dedicated mapping iterations (2 vs 5). Re-scouted on level 2. Completed level 1 at iter 17 but navigated into a dead-end on level 2. Score: 0 (no `return()` call).

**The core finding:** The delegation pipeline works. Scout quality is good. Navigation is functional. The #1 blocker is now the agent's persistent failure to call `return()` -- a protocol compliance problem that wastes all earned progress. Every version completes at least some meaningful work but reports a score of 0 because nothing is returned. Fixing `return()` is a prerequisite for any further progress to register.

**Secondary finding:** The bottleneck shifted across versions -- from resource depletion (v0.1.0) to iteration exhaustion (v0.2.0) to maze topology + protocol failure (v0.3.0). Each version solved the previous bottleneck, revealing the next layer. The next bottleneck after `return()` is likely multi-level maze adaptation: the agent can handle level 1 but struggles with the changed topology on level 2.

---

## 2. Version-by-Version Progression

| Metric | v0.1.0 (run-008) | v0.2.0 (run-009) | v0.3.0 (run-010) | Trend |
|--------|------------------|------------------|------------------|-------|
| **Iteration budget** | 20 | 20 | 30 | +50% in v0.3.0 |
| **Scout model** | Flash (Gemini) | Sonnet (orchestrator) | Sonnet (orchestrator) | Sonnet stable since v0.2.0 |
| **Scout count (L1)** | 2 (double-exec bug) | 1 | 1 | Fixed in v0.2.0 |
| **Scout actions (L1)** | 42 | 7 | 6 | Stable at ~7 |
| **Scout budget (plugin)** | unbounded | 20 actions | 15 actions | Tightening |
| **Scout report quality** | Low (discarded) | High (accepted) | High (accepted) | Stable |
| **Dedicated mapping iters** | 3 (iters 2-4) | 5 (iters 3-7) | 2 (iters 3, 9) | Map-while-navigate in v0.3.0 |
| **Level 1 completed** | No | Yes (iter 13) | Yes (iter 17) | Since v0.2.0 |
| **Level 1 iter cost** | N/A | 13 | 17 | v0.3.0 hit more walls |
| **Level 1 action cost** | N/A | 24 (7 scout + 17 parent) | 33 (6 scout + 27 parent) | v0.3.0 higher due to wall collisions |
| **Re-scout on L2** | N/A | No | Yes (D2, iter 21) | New in v0.3.0 |
| **D2 quality** | N/A | N/A | Low (incomplete) | Needs work |
| **Level 2 progress** | N/A | 5 iters, stuck | 10 iters, dead-end | More iterations, same wall |
| **Levels completed** | 0 | 1 | 1 | Plateau |
| **Fuel at timeout** | 0 | 56 (28 moves) | 44 (22 moves) | Not fuel-limited since v0.2.0 |
| **Called `return()`** | No | No | No | **PERSISTENT GAP** |
| **Failure mode** | Fuel depletion | Iteration exhaustion | Dead-end + no return | Shifts each version |
| **Wall time** | 255s | 336s | 515s | Growing with iters |
| **Token cost** | $0.63 | $0.77 | $1.46 | Growing with iters |
| **Input chars** | 686,024 | 845,491 | 1,689,979 | 2x jump in v0.3.0 |
| **Output chars** | 31,864 | 35,810 | 52,623 | Growing |
| **Score** | 0 | 0 | 0 | Stuck at 0 |

---

## 3. What v0.3.0 Improved Over v0.2.0

### 3.1 Map-While-Navigate: Did It Save Iterations?

**Yes, partially.** v0.2.0 spent 5 dedicated mapping iterations (iters 3-7) before the first navigation action at iter 7. v0.3.0 spent only 2 dedicated mapping iterations (iters 3 and 9) with navigation interleaved starting at iter 4 (DOWN x2, immediately testing the scout's claims).

| Phase | v0.2.0 iters | v0.3.0 iters | Savings |
|-------|-------------|-------------|---------|
| Delegation | 1 | 2 (parent started game first) | -1 |
| Verification | 1 | 1 | 0 |
| Dedicated mapping | 4 (iters 3-6) | 2 (iters 3, 9) | +2 |
| Navigation to marker | 3 (iters 7-9) | 4 (iters 6, 8, 10-11) | -1 |
| Navigation to room | 4 (iters 10-13) | 6 (iters 12-17) | -2 |
| **Total L1** | **13** | **17** | **-4** |

The paradox: v0.3.0 saved 2 mapping iterations but spent 4 more on navigation (more wall collisions). The net effect was worse: 17 iterations to complete level 1 vs 13 in v0.2.0. The map-while-navigate pattern did reduce upfront mapping but the agent paid for it in reactive wall collisions:
- Iter 4: DOWN x2 both blocked (wall at r50) -- 2 wasted actions
- Iter 8: LEFT x3 all blocked (wall at c30-33) -- 3 wasted actions
- Iter 13: UP x4 blocked (wrong corridor alignment) -- 4 wasted actions

v0.2.0's thorough upfront mapping actually prevented these collisions. The lesson: map-while-navigate works best when the agent maps the *immediate path ahead* before each move, not just moves blindly and checks afterward.

### 3.2 Re-Scouting: Did D2 Help with Level 2?

**Partially.** Re-scouting on level transition was a sound strategic decision (recommended in the v0.2.0 analysis, implemented in v0.3.0 plugin). However, execution was poor:

- D2 used 8 game actions (consuming fuel) but returned a report marked "INCOMPLETE -- ran out of scout action budget"
- D2 moved the entity from c29-33 to c34-38 (a permanent shared-state mutation) without mapping the critical corridor connections
- D2 did not discover the wide open area at r5-14 (the key crossover) or the dead-end at c39-43
- The parent still needed 4 mapping iterations (iters 22-25) after D2 to understand the level 2 layout

**Net value of D2:** Negative. It consumed 8 actions (16 fuel) and 1 parent iteration, produced minimal intelligence, and moved the entity without improving its position. The parent's own scanning (iters 22-25) was more productive.

**Root cause:** D2's iteration budget (maxIterations: 8) was too tight for a new maze, and the scout plugin does not have a "quick re-map" mode that skips mechanic discovery (already known) and focuses on corridor scanning.

### 3.3 Iteration Budget (30 vs 20): Was More Headroom Useful?

**Yes, it was necessary, but not sufficient.** The extra 10 iterations (20 -> 30) allowed:
- Level 1 completion at iter 17 (would have timed out at 20 in v0.2.0's L1 pace)
- Re-scouting (iter 21)
- 4 iterations of level 2 maze mapping (iters 22-25)
- 4 iterations of level 2 navigation attempts (iters 26-29)
- 1 final diagnostic iteration (iter 30)

Without the extra 10 iterations, v0.3.0 would have timed out at iter 20 -- mid-level-2-reconnaissance, similar to v0.2.0. The extra headroom was used productively (re-scouting + mapping + navigation) but was still insufficient to complete level 2.

### 3.4 Scout Budget Tightening (15 vs 20): Did It Help?

**Marginal.** The v0.3.0 scout plugin reduced the action budget from 20 to 15. D1 used only 6 actions (vs 7 in v0.2.0) -- a 1-action improvement. The tighter budget did not meaningfully change scout behavior since Sonnet was already conservative. D2, however, hit the budget ceiling and returned an incomplete report, suggesting that 15 may be too tight for re-scouting a changed maze.

---

## 4. What v0.3.0 Got Worse

### 4.1 Level 1 Action Cost: 33 vs 24

v0.3.0 used 33 game actions for level 1 compared to v0.2.0's 24 -- a 38% increase. The breakdown:

| Phase | v0.2.0 actions | v0.3.0 actions | Difference |
|-------|---------------|---------------|-----------|
| Scout | 7 | 6 | -1 |
| Blocked moves (wasted fuel) | ~2 | ~9 | +7 |
| Productive navigation | 15 | 18 | +3 |
| **Total** | **24** | **33** | **+9** |

The main cost was 9 wasted blocked moves (each costing 2 fuel) vs ~2 in v0.2.0. The map-while-navigate approach backfired: by reducing upfront mapping, the agent discovered walls reactively by hitting them. Each collision costs fuel but yields no progress.

### 4.2 Re-Scouting Was Wasteful

D2 consumed 8 game actions (16 fuel) + 1 parent iteration and returned an incomplete report. The parent then did its own mapping anyway (4 iterations). Total cost of re-scouting: 1 parent iter + 8 game actions + entity mutation (moved to c34-38). Value delivered: minimal.

### 4.3 Cost Nearly Doubled: $0.77 -> $1.46

| Cost metric | v0.2.0 | v0.3.0 | Ratio |
|------------|--------|--------|-------|
| Dollar cost | $0.77 | $1.46 | 1.9x |
| Input chars | 845,491 | 1,689,979 | 2.0x |
| Output chars | 35,810 | 52,623 | 1.5x |
| Wall time | 336s | 515s | 1.5x |

The cost nearly doubled, primarily driven by 50% more iterations (20 -> 30) compounded by growing context length. The input character count doubled because each iteration adds to the conversation history, and more iterations means more accumulated context. Cost per level completed remained infinite (0 score).

### 4.4 Dead-End Navigation Error

At iter 26, the agent moved RIGHT from c34-38 to c39-43 without first checking upward access from that position. The corridor scan from iter 25 showed that the narrow vertical corridor (c34-38, r17-24) was the only way up to the wide crossover at r5-14. From c39-43, walls at r20-24 blocked upward escape and walls at c44+ blocked rightward escape. The entity was stuck in a pocket with only LEFT as an exit.

The correct route (derivable from the agent's own scan data at iter 25) was: stay at c34-38, go UP through the narrow corridor to r10-14, then RIGHT across the wide open area (continuous c19-53 at r5-14), then DOWN on the right side toward the marker at r46-48, c50-52. The agent had this data but failed to synthesize it into a route before moving.

---

## 5. The Persistent `return()` Problem

This is the single most important issue. All three versions score 0 despite v0.2.0 and v0.3.0 completing level 1.

### 5.1 All Three Versions Fail to Call `return()`

| Version | Iters used | Progress | `return()` called? | Score |
|---------|-----------|----------|-------------------|-------|
| v0.1.0 | 20/20 | 0 levels | No | 0 |
| v0.2.0 | 20/20 | 1 level | No | 0 |
| v0.3.0 | 30/30 | 1 level | No | 0 |

The pattern is identical: the agent uses all available iterations, never feels "done," and times out without submitting results. The engine error message is consistent: "RLM reached max iterations (N) without returning an answer."

### 5.2 The Plugin Explicitly Instructs `return()` -- Why Didn't the Agent Obey?

The v0.3.0 `arc3-delegation-test.md` plugin contains strong language:

> **Critical Rules**
> 1. **ALWAYS call `return()` before your last 2 iterations.** If you have used 18+ of your iterations, IMMEDIATELY return partial results. Do not wait for the game to finish. A partial result is infinitely better than no result.

And later:

> **Step 5: Return Results (BEFORE TIMEOUT)**
> **You MUST call `return()` before running out of iterations.** Check your iteration count and return early if needed.

Despite this explicit instruction, the agent never called `return()`. Possible reasons:

1. **The agent does not track its iteration count.** The `__rlm` object (injected into the sandbox as `__rlm.iteration` and `__rlm.maxIterations`) is available but the agent never reads it. No trace entry shows `__rlm.iteration` being accessed. The plugin says "check your iteration count" but does not show how (`console.log(__rlm.iteration, __rlm.maxIterations)`).

2. **Goal fixation overrides protocol compliance.** The agent is deeply focused on solving the maze and treats each iteration as "one more chance to make progress." The `return()` instruction is in the plugin prose but competes with the immediate cognitive load of maze navigation. In the final iterations (28-30), the agent is diagnosing the dead-end, not thinking about its remaining iteration budget.

3. **The code examples in the plugin are sequential, not conditional.** The plugin shows `return()` as "Step 5" -- implying it comes after navigation is complete. The agent follows the sequential pattern: "first navigate, then return." Since navigation never completes, `return()` is never reached. What the plugin needs is a *per-iteration* check, not a sequential step.

4. **No engine-level reminder.** The system prompt tells the agent about `__rlm.iteration` and `__rlm.maxIterations`, but there is no per-iteration system message saying "You have used 28 of 30 iterations. Call return() NOW." The information exists passively in the sandbox but is never actively surfaced.

### 5.3 Raw Trace Analysis: Did the Agent Attempt `return()`?

Examining the v0.3.0 raw trace (30 iterations):
- **Zero instances** of the string `return(` in any code block
- **Zero instances** of `__rlm` being accessed
- **Zero instances** of `arc3.getScore()` being called
- The agent's final iteration (30) is purely diagnostic: it checks all four directions from the stuck position and observes "above=wall, below=open, left=open, right=wall." It does not acknowledge that it is on its last iteration.

The agent did not even attempt to call `return()`. It was fully absorbed in maze navigation until the engine killed it.

### 5.4 Is the Problem That the Agent Doesn't Know Its Iteration Count?

**Yes, in practice.** The `__rlm` object exposes `iteration` and `maxIterations`, so the information is technically available. But:
- The agent must proactively check it (e.g., `if (__rlm.iteration >= __rlm.maxIterations - 2) return(...)`)
- The plugin prose says "check your iteration count" but the code examples do not include this check
- At no point in the 30-iteration trace does the agent access `__rlm`
- The system prompt mentions `__rlm` once in the Environment section, but it is easily lost in the growing context (1.7M chars by the end)

The iteration count is available but not salient. It is buried in a passive sandbox variable rather than actively presented to the agent.

### 5.5 What Would the Score Have Been If `return()` Was Called at Iter 28?

At iteration 28, the game state is:
- `levels_completed`: 1
- `state`: NOT_FINISHED
- `actions_used`: 61
- `fuel_remaining`: 44 (22 moves)
- Scorecard via `arc3.getScore()`: would return `{ score: X, total_levels: 7 }`

The `arc3Score` function computes: `score / total_levels`. For 1 level completed out of 7:
- The ARC-3 API scorecard's `score` field is the sum of per-level efficiency ratios: `baseline_actions / actual_actions` for each completed level
- For level 1 completed with 33 total actions, the efficiency depends on the baseline (optimal solution). If the baseline is ~10 actions, the ratio is `10/33 = 0.30`
- Final score: `0.30 / 7 = 0.043` (4.3%)

Even 4.3% is infinitely better than 0%. And the scoring function caps at 1.0, so there is no risk of over-reporting.

If the scoring function also accepted `levelsCompleted` directly (which it currently does not), 1/7 = 14.3%.

### 5.6 Recommendations to Force `return()`

Listed in order from most reliable to least reliable:

**1. Engine-level auto-return on timeout (MOST RELIABLE)**
When the RLM hits `maxIterations` for an ARC-3 task, the engine should automatically call `arc3.getScore()` and record the result as the answer. This requires zero agent cooperation.
- *Effort:* Medium (engine code change in `src/rlm.ts`)
- *Reliability:* 100% -- does not depend on agent behavior
- *Downside:* Only works for ARC-3 tasks (or tasks with a known scoring API)

**2. Engine-level "last iteration" system message injection**
On iteration `maxIterations - 2`, inject a system message: "WARNING: You have 2 iterations remaining. You MUST call return() with your results NOW. Call `const score = await arc3.getScore(); return(JSON.stringify(score));` immediately." This is active prompting, not passive documentation.
- *Effort:* Medium (engine code change)
- *Reliability:* High (~80-90%) -- the agent can still ignore system messages, but an urgent warning is much harder to ignore than prose documentation
- *Downside:* Requires per-task-type message templates

**3. Plugin prose: add iteration check to EVERY code example**
Instead of `return()` appearing only in "Step 5," add an iteration guard to every code block in the plugin:

```javascript
// At the START of every code block:
if (__rlm.iteration >= __rlm.maxIterations - 2) {
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}
```

- *Effort:* Low (plugin prose change)
- *Reliability:* Medium (~50%) -- the agent may copy the pattern or may not. It treats code examples as suggestions, not mandates.
- *Downside:* Clutters the plugin. The agent may strip the guard when adapting the code.

**4. Plugin prose: stronger language (current approach, proven insufficient)**
The v0.3.0 plugin already says "ALWAYS call return() before your last 2 iterations" in bold. This did not work. Stronger language alone is unlikely to help.
- *Reliability:* Low (~10%) -- three consecutive failures demonstrate this.

**Recommendation:** Implement option 1 (auto-return) as the primary fix and option 2 (system message injection) as a belt-and-suspenders measure. Option 3 is a good low-effort supplement.

---

## 6. Scoring Analysis

### 6.1 How `arc3Score` Works

From `/Users/sl/code/trinity/node-rlm/eval/scoring.ts` (lines 287-299):

```typescript
export function arc3Score(predicted: string, _expected: string | string[]): number {
    try {
        const data = JSON.parse(predicted);
        if (typeof data.score === "number" && typeof data.total_levels === "number") {
            return data.total_levels > 0
                ? Math.min(1, data.score / data.total_levels)
                : 0;
        }
        return 0;
    } catch {
        return 0;
    }
}
```

**Input format:** The function expects `predicted` to be a JSON string containing `{ score: number, total_levels: number }`. This is the ARC-3 API scorecard format returned by `arc3.getScore()`.

**Scoring formula:** `min(1, score / total_levels)` where `score` is the sum of per-level efficiency ratios and `total_levels` is the total number of levels in the puzzle.

**Failure modes:**
- If `predicted` is empty string: `JSON.parse("")` throws, catch returns 0
- If `predicted` is not valid JSON: catch returns 0
- If JSON lacks `score` or `total_levels`: returns 0
- If `total_levels` is 0: returns 0

### 6.2 What Would Various Return Values Score?

| Return value | Score | Notes |
|-------------|-------|-------|
| `""` (empty, current) | 0 | `JSON.parse` throws |
| `{"levelsCompleted": 1}` | 0 | Missing `score` and `total_levels` |
| `{"levelsCompleted": 1, "score": {"score": 0.3, "total_levels": 7}}` | 0 | `score` is an object, not a number |
| `{"score": 0.3, "total_levels": 7}` | 0.043 | Correct format. 0.3/7 = 0.043 |
| `{"score": 1.0, "total_levels": 7}` | 0.143 | 1 perfect level out of 7 |
| `{"score": 7.0, "total_levels": 7}` | 1.0 | All 7 levels, perfect efficiency |

### 6.3 Does the ARC-3 API Scorecard Include Per-Level Efficiency?

The scorecard's `score` field is the sum of per-level ratios: `sum(baseline_actions_i / actual_actions_i)` for each completed level. So yes, it inherently captures per-level efficiency. A level completed in fewer actions scores higher. The maximum `score` for N completed levels is N (if every level is solved in exactly the baseline number of actions).

### 6.4 The Nested Return Problem

If the agent returned `{"levelsCompleted": 1, "score": {"score": 0.3, "total_levels": 7}}`, the scoring function would check `typeof data.score === "number"` -- but `data.score` is an object, not a number, so it would return 0. The agent must return the scorecard at the top level, not nested inside another object. The plugin's code example handles this correctly:

```javascript
const score = await arc3.getScore();
return(JSON.stringify(score));
```

This returns the scorecard directly. The risk is the agent wrapping it in an outer object.

---

## 7. Bottleneck Analysis

### 7.1 Bottleneck Progression

| Version | Primary bottleneck | Category | Evidence |
|---------|-------------------|----------|----------|
| v0.1.0 | Fuel depletion | Resource | 0 fuel at timeout, 0 levels completed |
| v0.2.0 | Iteration exhaustion | Cognitive | 56 fuel remaining, 1 level, hit iter limit |
| v0.3.0 | Maze topology + no return | Cognitive + Protocol | 44 fuel, 1 level, entity in dead-end, no return() |

Each version solved the previous bottleneck:
- v0.2.0 fixed fuel depletion by reducing scout actions (42 -> 7) and navigating incrementally
- v0.3.0 partially addressed iteration exhaustion by increasing budget (20 -> 30) and adding map-while-navigate

But each solution revealed the next bottleneck:
- Fixing fuel revealed that the agent runs out of iterations before fuel
- Adding iterations revealed that the agent cannot efficiently navigate changed mazes on level 2, and never reports progress

### 7.2 What's the Next Bottleneck If `return()` Is Fixed?

If `return()` is fixed (score becomes nonzero), the next bottleneck is **multi-level maze adaptation**. Both v0.2.0 and v0.3.0 completed level 1 but failed on level 2 due to:

1. **Topology surprise:** The maze changes between levels -- walls shift, markers move, corridors rearrange. The agent's level 1 knowledge is partially obsolete.
2. **Entity teleportation:** On level transition, the first DOWN teleports the entity ~30 rows (from r10-11 to r40-41). The agent wastes 6-7 moves before understanding the new position.
3. **Route planning failure:** The agent has corridor scan data but fails to synthesize it into a viable route before moving. In v0.3.0, this led to a dead-end.
4. **Corridor alignment constraints:** The entity is 5 pixels wide and moves in 5-pixel steps. Only corridors exactly 5 pixels wide (or wider) are passable, and only when the entity's column position is precisely aligned. This creates strict alignment requirements that the agent discovers reactively.

After `return()`, the priority stack becomes:
1. Level 2 topology adaptation (re-mapping strategy)
2. Route planning before execution (prevent dead-ends)
3. Corridor alignment awareness (prevent wasted wall collisions)
4. Eventually: scaling to levels 3-7

### 7.3 Iteration Budget Projections

Based on observed data, the per-level iteration cost is:

| Phase | Level 1 (observed avg) | Level N (estimated) |
|-------|----------------------|---------------------|
| Delegation / re-scout | 2 | 1-2 |
| Verification + mapping | 2-3 | 2-3 |
| Navigation | 5-7 | 5-7 |
| Level transition | 1 | 1 |
| Buffer (wall collisions, diagnosis) | 2-3 | 2-3 |
| **Total per level** | **12-16** | **11-16** |

For the 7-level puzzle:
- Minimum budget: 7 * 11 = 77 iterations (perfect play)
- Realistic budget: 7 * 14 = 98 iterations (with buffer)
- Current budget: 30 iterations (enough for ~2 levels)

At $1.46 for 30 iterations, scaling to 100 iterations would cost roughly $4-5 per run. This may require re-evaluating the cost/performance tradeoff.

---

## 8. Recommendations for v0.4.0

### 8.1 Fix `return()` (CRITICAL PRIORITY)

| Aspect | Detail |
|--------|--------|
| **What to change** | Engine: auto-return scorecard on timeout for ARC-3 tasks |
| **Specific change** | In `src/rlm.ts`, when `MaxIterationsError` is caught for an ARC-3 task, call `arc3.getScore()` from the sandbox and record the JSON as the answer |
| **Backup** | Also inject a system message at iteration `maxIterations - 2`: "You have 2 iterations left. Call `return(JSON.stringify(await arc3.getScore()))` NOW." |
| **Plugin supplement** | Add `if (__rlm.iteration >= __rlm.maxIterations - 2) { return(JSON.stringify(await arc3.getScore())); }` to the top of every code example in the plugin |
| **Expected impact** | Converts 0% scores to 4-15% scores immediately (based on 1 level completed out of 7) |
| **Effort** | Medium (engine change: ~2 hours; plugin change: ~15 minutes) |

### 8.2 Fix Level 2 Re-Scouting (HIGH PRIORITY)

| Aspect | Detail |
|--------|--------|
| **What to change** | Scout plugin: add a "quick re-map" mode for level transitions |
| **Specific change** | When the scout receives a prompt mentioning "level transition" or "maze has changed," skip Phase 1 (mechanic probing -- already known) and go straight to Phase 3 (board mapping). Render the full grid with `renderRegion()` and identify corridor connections. Budget: 3-5 actions max for re-mapping (mainly observations, minimal movement). |
| **Plugin change** | Add to `arc3-scout.md`: "If the game is already in progress and mechanics are known (re-scouting after a level transition), skip mechanic probing. Focus entirely on: (1) render full grid, (2) find new marker position, (3) map corridor connections, (4) identify which columns have continuous vertical paths. Use at most 5 actions." |
| **Parent plugin change** | Update `arc3-delegation-test.md` Step 4 to pass known mechanics in the delegation prompt: "Mechanics are already known: entity=color 12, fuel=color 11 (-2/action), movement=5px/step. Focus on mapping the NEW corridor layout." |
| **Expected impact** | D2 returns a complete corridor map instead of "INCOMPLETE." Parent saves 3-4 mapping iterations. |
| **Effort** | Low (plugin prose changes: ~30 minutes) |

### 8.3 Add Route Planning Before Execution (HIGH PRIORITY)

| Aspect | Detail |
|--------|--------|
| **What to change** | Plugin: add explicit route-planning step before navigation sequences |
| **Specific change** | After corridor scanning, before moving, the agent should compute the full path as a sequence of (direction, steps) tuples. Validate that each segment has a clear corridor. Do not move until the route is validated. |
| **Plugin language** | "After mapping corridors, PLAN YOUR ROUTE before moving. For each segment, verify: (1) the destination columns have a continuous vertical path in the scan data, (2) the destination rows have a continuous horizontal path. If you cannot verify a segment, scan that area first. NEVER move RIGHT/LEFT into unverified corridor widths." |
| **Expected impact** | Prevents the dead-end at c39-43 (v0.3.0 iter 26). The scan data showed c34-38 was the only corridor up -- the agent should have gone UP before RIGHT. |
| **Effort** | Low (plugin prose: ~15 minutes) |

### 8.4 Increase Iteration Budget to 40-50 (MEDIUM PRIORITY)

| Aspect | Detail |
|--------|--------|
| **What to change** | CLI flag: `--maxIterations 45` for ARC-3 tasks |
| **Rationale** | 30 iterations allows ~2 levels. 45 allows ~3. Combined with efficiency improvements from 8.2 and 8.3, this may enable 3-4 level completions. |
| **Expected impact** | More levels completed, proportionally higher scores |
| **Cost impact** | ~$2.20 per run (from $1.46 at 30 iters) |
| **Effort** | Trivial (CLI flag change) |

### 8.5 Reduce Wall Collisions via Upfront Path Validation (MEDIUM PRIORITY)

| Aspect | Detail |
|--------|--------|
| **What to change** | Plugin: rebalance map-while-navigate to include path validation |
| **Specific change** | Before each move, check the destination area in the current grid. If `grid[destRow][destCol] === 4` (wall color), skip that direction. This can be done in the same code block as the `arc3.step()` call. |
| **Plugin language** | "Before calling `arc3.step(action)`, check the grid: if the destination area (entity position + 5px in that direction) contains wall color (4), skip that action. Blocked moves still cost fuel." |
| **Expected impact** | Eliminates ~9 wasted blocked moves per level (saving 18 fuel per level and 2-3 iterations of diagnosis) |
| **Effort** | Low (plugin code example change) |

### 8.6 Level Transition Protocol (MEDIUM PRIORITY)

| Aspect | Detail |
|--------|--------|
| **What to change** | Plugin: add explicit level-transition handling |
| **Specific change** | Add guidance: "After `levels_completed` increases: (1) Expect entity teleportation -- do NOT assume your position. Immediately check `getEntityPosition()`. (2) Do NOT try any directions blindly -- first re-map. (3) Find the new marker position. (4) Re-scout if budget allows. (5) The maze topology is completely different -- do not reuse level 1 routes." |
| **Expected impact** | Prevents the 6-7 wasted moves after level transition (v0.3.0 iter 19, v0.2.0 iter 15) |
| **Effort** | Low (plugin prose) |

### 8.7 Context Window Management (LOW PRIORITY, LONG-TERM)

| Aspect | Detail |
|--------|--------|
| **Problem** | Input chars grew from 845K (v0.2.0, 20 iters) to 1.69M (v0.3.0, 30 iters). At 50 iterations, this could reach 2.8M chars, approaching context limits. |
| **What to change** | Engine: implement conversation summarization or sliding window for long-running interactive tasks |
| **Expected impact** | Maintains reasoning quality as iteration count grows; may also reduce per-iteration cost |
| **Effort** | High (engine architecture change) |

### Priority Summary

| # | Recommendation | Priority | Effort | Expected Score Impact |
|---|---------------|----------|--------|----------------------|
| 1 | Fix `return()` (engine auto-return) | CRITICAL | Medium | 0% -> 4-15% |
| 2 | Fix level 2 re-scouting | HIGH | Low | +1-2 levels per run |
| 3 | Add route planning | HIGH | Low | Prevent dead-ends |
| 4 | Increase iter budget to 45 | MEDIUM | Trivial | +1 level per run |
| 5 | Path validation before moves | MEDIUM | Low | Save 18 fuel/level |
| 6 | Level transition protocol | MEDIUM | Low | Save 6-7 moves/transition |
| 7 | Context window management | LOW | High | Long-term quality |

---

## 9. Broader Lessons

### 9.1 Delegation Economics: When Is It Worth the Overhead?

Three runs provide clear data on delegation ROI:

| Version | Delegation cost | Value delivered | Parent savings | ROI |
|---------|----------------|----------------|----------------|-----|
| v0.1.0 | 1 iter + 42 actions | Zero (discarded) | -10 iters (parent rediscovered everything) | **-infinity** |
| v0.2.0 | 1 iter + 7 actions | High (accepted, verified) | +9 iters (eliminated discovery phase) | **+9x** |
| v0.3.0 D1 | 2 iters + 6 actions | High (accepted, verified) | +8 iters (eliminated discovery phase) | **+4x** |
| v0.3.0 D2 | 1 iter + 8 actions | Low (incomplete report) | +0 iters (parent mapped anyway) | **-1x** |

**Key insight: delegation ROI is bimodal.** A good delegation delivers outsized returns (4-9x iteration savings). A bad delegation is not just neutral -- it is actively harmful because it consumes shared resources irreversibly and wastes parent iterations. There is no middle ground where "mediocre" delegation is "somewhat helpful."

**The break-even rule:** Delegation is worth the overhead when the scout saves more than 2 parent iterations (the fixed coordination cost of 1 delegation + 1 verification). The scout must produce information the parent would otherwise spend 3+ iterations discovering independently. For the ARC-3 domain, initial scouting clears this bar easily (saves ~10 iterations of mechanic discovery). Re-scouting on level transitions is borderline (saves 3-4 iterations if the report is complete, costs 1-2 if incomplete).

**The shared-state tax:** Since the `arc3` client is shared and mutable, every scout action permanently changes the game state. Scout actions that do not generate useful information are pure waste -- they consume fuel and move the entity to potentially worse positions. This creates a quality threshold: the scout must be good enough to generate value proportional to its state mutations.

### 9.2 Plugin Prose as a Control Mechanism: What Sticks, What Doesn't?

Three versions of plugin prose provide a natural experiment in what the agent obeys:

| Instruction | Compliance | Evidence |
|------------|-----------|----------|
| "Delegate scouting at the start" | HIGH | All versions delegate in iter 1-2 |
| "Verify scout claims before acting" | HIGH | v0.2.0 and v0.3.0 verify in the next iter |
| "Navigate incrementally, check after each step" | HIGH | Agent consistently checks position |
| "Use Sonnet (orchestrator) for scout model" | HIGH | Followed in v0.2.0 and v0.3.0 |
| "Stay within N game actions" (scout budget) | MEDIUM | D1 stays within budget; D2 hits ceiling |
| "Re-scout on level transition" | MEDIUM | v0.3.0 re-scouts (new behavior) |
| "Map while navigating" | LOW-MEDIUM | Agent reduces dedicated mapping but still maps separately |
| "ALWAYS call return() before last 2 iterations" | **ZERO** | Never obeyed across 3 versions |
| "Check iteration count" | **ZERO** | `__rlm` never accessed |

**Pattern:** The agent reliably follows *action* instructions ("delegate," "verify," "navigate") but ignores *meta-cognitive* instructions ("monitor your iteration count," "return before timeout"). Action instructions specify what to do next in the game loop. Meta-cognitive instructions require the agent to step outside the game loop and reason about its own execution lifecycle -- something that competes with (and loses to) the immediate task.

**Implication:** Plugin prose is effective for shaping *strategy* (how to play) but ineffective for enforcing *protocol* (when to stop). Protocol enforcement must be done at the engine level, where it cannot be overridden by task focus.

### 9.3 Scout Quality and Parent Performance

The relationship between scout quality and parent performance follows a step function, not a gradient:

```
Scout quality:    LOW (Flash/v0.1.0)  -->  HIGH (Sonnet/v0.2.0+)
Parent discovery:  10 iterations       -->  1 iteration
Parent navigation: 6 iterations        -->  12 iterations
Levels completed:  0                   -->  1
```

Below the quality threshold, the scout is useless (v0.1.0: discarded). Above the threshold, the scout eliminates entire parent phases. There is no observed "medium quality" regime where the scout is "partially helpful." This suggests that scout model capability is a binary gate, not a dial.

Once above the quality threshold, further scout improvements have diminishing returns. The v0.3.0 D1 was marginally better than v0.2.0 D1 (6 vs 7 actions, same report quality), but this made no meaningful difference to parent performance. The investment should go into scout reliability (ensuring the threshold is always met) rather than scout excellence.

For re-scouting (D2), the quality threshold is different: the scout needs to map corridors, not discover mechanics. The v0.3.0 D2 fell below this threshold (incomplete report). This suggests that re-scouting needs a different plugin mode, not just the same scout with a tighter budget.

### 9.4 Iteration Budget Planning for Multi-Level Interactive Tasks

The three runs reveal a fundamental tension in budget planning:

| Approach | Budget | Outcome |
|----------|--------|---------|
| Tight (v0.1.0/v0.2.0: 20) | Insufficient for 2 levels | Agent runs out mid-level-2 |
| Moderate (v0.3.0: 30) | Barely sufficient for 1.5 levels | Agent completes L1, attempts L2 but dead-ends |
| Projected (45) | Sufficient for ~3 levels | ~3 levels with efficiency improvements |
| Required (100) | Full game (7 levels) | Prohibitively expensive at current cost rates |

**The budget paradox:** More iterations enable more progress, but each additional iteration adds to the context window, increasing per-iteration cost and potentially degrading reasoning quality. The cost scaling is superlinear: 30 iterations costs $1.46 (50% more than 20 iterations' $0.77, not 50%). At 100 iterations, the cost could be $6-8 per run.

**Practical conclusion:** With current architecture, completing all 7 levels in a single run is likely impractical. The most realistic path is:
1. Fix `return()` to capture partial credit (immediate impact)
2. Maximize levels per run with efficiency improvements (re-scouting, route planning)
3. Accept 2-3 levels per run as a realistic ceiling at reasonable cost
4. Explore architectural changes (context summarization, checkpoint/restore) for scaling beyond 3 levels

**The real metric is score per dollar.** Currently: $0/dollar. With `return()` fixed and 2 levels completed: ~$0.05-0.10 per dollar. The highest-leverage investment is not in playing better -- it is in reporting what has already been achieved.
