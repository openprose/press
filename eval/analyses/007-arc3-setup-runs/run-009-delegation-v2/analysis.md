# ARC-3 Delegation Experiment: v0.1.0 vs v0.2.0 Comparative Analysis

**Date:** 2026-02-15
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6 (both runs)
**Iterations:** 20 (both runs)

---

## 1. Executive Summary

The v0.2.0 delegation plugins represent a substantial improvement over v0.1.0 across every dimension of the delegation pipeline: the scout model upgrade from Flash to Sonnet produced a high-quality report with correct entity identification, measured fuel mechanics, and exact bounding boxes (vs. vague descriptions and entity misidentification); the `maxBlocksPerIteration: 1` fix eliminated the double-execution bug that spawned two redundant scouts; scout resource consumption dropped from 42 game actions to 7 (a 6x improvement); and the parent successfully leveraged the scout report rather than discarding it, completing level 1 -- the first level completion in this experiment series. However, the overall score remains 0% because the agent timed out at 20 iterations without calling `return()`, and the scoring function requires a parsed scorecard JSON with `score` and `total_levels` fields that only the ARC-3 API provides upon game completion. The failure mode shifted from **fuel depletion** (v0.1.0: 0 fuel remaining, 0 levels) to **iteration exhaustion** (v0.2.0: 56 fuel remaining, 1 level completed), revealing that the new bottleneck is cognitive budget, not resource budget.

---

## 2. What Improved (with evidence)

### 2.1 Scout Model Quality: Flash vs Sonnet

**v0.1.0 (Flash):**
- D1 returned: `controlledEntity: "Color 1 (Blue) - small 2-pixel object"` -- **wrong**. Color 1 is the stationary marker, not the controlled entity.
- D2 returned: `controlledEntity: "A cluster of pixels (likely color 12 or 9)"` -- vague but closer. No bounding box, no pixel count, no measurement of movement distance.
- Neither scout discovered the fuel mechanic (color 11 depleting 2px/action).
- Neither provided exact positions or bounding boxes.

**v0.2.0 (Sonnet):**
- Single scout returned: `controlledEntity: { color: 12, boundingBox: { rMin: 40, rMax: 41, cMin: 44, cMax: 48 }, pixelCount: 10, movementPerAction: { up: "5 rows up", down: "5 rows down", left: "5 cols left", right: "5 cols right" } }` -- **all correct**.
- `resourceMeter: { color: 11, pixelsPerAction: -2, currentCount: 70, initialCount: 84 }` -- **correct**. Flash missed this entirely.
- `stationaryEntity: { color: 1, position: [32-33, 20-21], note: "does NOT move" }` -- **correct**. Flash confused this with the player.
- 5 hypotheses, all high confidence, all correct (except the naive path suggestion).

**Evidence:** Parent at v0.1.0 iter 2: "The scout reports weren't very successful - 0 levels completed and the findings are vague." Parent at v0.2.0 iter 2: "Excellent! The scout report is very detailed. Let me parse it and verify the claims."

### 2.2 Scout Resource Efficiency: 42 vs 7 Actions

| Metric | v0.1.0 | v0.2.0 | Ratio |
|--------|--------|--------|-------|
| Number of scouts spawned | 2 (double-exec bug) | 1 | 2x |
| Total scout game actions | 42 | 7 | 6x |
| Scout iterations consumed | 12 (6+6) | ~7 | 1.7x |
| Fuel consumed by scouts | ~42px (uncertain, pre-transition) | 14px (84 -> 70) | 3x |

The v0.2.0 scout plugin included an explicit 20-action budget instruction ("Stay within 20 game actions -- the parent needs the remaining budget") and structured its phases around action counting. The scout used 7 of its 20-action budget and stopped. The v0.1.0 scout had no action budget -- its instructions said "You have a generous budget but don't waste it" -- and it consumed all available actions across 6 iterations per scout.

### 2.3 Double-Execution Fix

**v0.1.0:** The model emitted two identical `rlm()` code blocks in a single reasoning step (visible in the raw trace at iter 1, where `code` is an array of length 2 with identical content). Both were executed, spawning two sequential scouts (D1 and D2) that together consumed 42 actions on the shared game state.

**v0.2.0:** Only one code block was emitted and executed per iteration. The trajectory confirms `delegationCount: 1` (vs 2 in v0.1.0). This was likely fixed by `maxBlocksPerIteration: 1` in the engine configuration, though the v0.2.0 delegation plugin also structured its code examples as single blocks.

### 2.4 Parent's Use of Scout Data: Discarded vs Verified

**v0.1.0:** Parent explicitly ignored both scout reports. At iter 2, it observed the game state from scratch, spending iters 2-4 (3 iterations) on visual analysis that the scouts should have provided. It then spent iters 5-12 (8 iterations) independently rediscovering the game mechanics.

**v0.2.0:** Parent parsed the scout report as JSON at iter 2. It programmatically verified: entity position at [40-41, 44-48] confirmed, goal position at [61-62, 56-63] confirmed, fuel at 70px confirmed. The parent used the scout's entity color (12) throughout navigation via `getEntityPosition(g, 12)`, a function defined in response to the scout report.

**Impact on iteration budget:** v0.1.0 spent 11 iterations (iters 2-12) on discovery. v0.2.0 spent 1 iteration (iter 2) on verification, saving 10 parent iterations.

### 2.5 Navigation Strategy: Bulk vs Incremental

**v0.1.0 (iter 16):** Executed a single bulk command: "D1 L15 U15" -- 31 actions in one code block. The block overshot by 6 rows (arrived at [25-26] instead of [32-33]). With only 4 fuel pixels remaining, correction was impossible.

**v0.2.0 (iters 7-13):** Navigated incrementally, checking entity position after each step. Iter 7: LEFT x2 (confirmed position tracking). Iter 8: UP x3 + LEFT x3 (6 actions with intermediate checks). Iter 9: DOWN x1 (touched marker, observed it disappear). Each step verified the entity position before deciding the next move.

**Impact:** Incremental navigation prevented overshoot and enabled the parent to observe game state changes (marker disappearance, room state changes) that informed subsequent decisions. This directly enabled level 1 completion.

### 2.6 Level Completion: 0 vs 1

**v0.1.0:** Zero levels completed. The block never reached the player position, and the true level-completion mechanic (touch color 1 marker, then enter upper room) was never discovered.

**v0.2.0:** Level 1 completed at iter 13 (UP x2 from rows 20-21 to 10-11 in the upper room). The agent discovered the two-phase mechanic: (1) navigate entity to color 1 marker to absorb it (iter 9), then (2) navigate entity to the upper room (iter 13). This was accomplished with 24 total game actions (7 scout + 17 parent).

### 2.7 Fuel Management

**v0.1.0:** Fuel hit 0 at iter 18. The agent had no awareness of fuel as a constraint until iter 11 (breakthrough), and by then most fuel was already consumed by scouts (42 actions pre-transition) and exploration. The final navigation attempt consumed 33 actions (31 bulk + 2 correction), depleting remaining fuel.

**v0.2.0:** Fuel at timeout was 56px (28 moves remaining). The agent tracked fuel throughout: 70 (post-scout) -> 66 (iter 7) -> 54 (iter 8) -> 52 (iter 9) -> 38 (iter 13, level 1 complete) -> 72 (level refuel) -> 56 (iter 18). The game's fuel refuel on level transition (38 -> 72) was a pleasant surprise.

### 2.8 Hypothesis Efficiency

| Metric | v0.1.0 | v0.2.0 |
|--------|--------|--------|
| Hypotheses tested | 4 | 4 |
| Hypotheses rejected | 1 | 1 |
| Breakthrough iteration | 11 | 9 |
| Iters on rejected hypotheses | 2 | 3 |
| Iters wasted | 2 (context loss) | 3 (level 2 walls) |

Both runs tested 4 hypotheses and rejected 1. However, v0.2.0 reached its breakthrough 2 iterations earlier (iter 9 vs 11) because the scout report eliminated the initial discovery phase. The v0.2.0 wasted iterations (3) were all on level 2 -- a qualitatively different problem that only arises because level 1 was already solved.

---

## 3. What Got Worse or Stayed the Same

### 3.1 Score: Still 0%

Both runs scored 0%. The score did not improve despite v0.2.0 completing level 1. This is a scoring gap (analyzed in Section 5), not a performance regression.

### 3.2 Wall Time: 255s -> 336s (+32%)

v0.2.0 took 81 seconds longer. This is attributable to:
- More useful work (actually navigating, completing a level, attempting level 2)
- Sonnet scout taking longer than Flash scouts
- More iterations of actual game interaction rather than early exhaustion

This is not a regression -- the agent was doing more productive work per second.

### 3.3 Token Cost: $0.63 -> $0.77 (+22%)

| Metric | v0.1.0 | v0.2.0 |
|--------|--------|--------|
| Total input chars | 686,024 | 845,491 |
| Total output chars | 31,864 | 35,810 |
| Estimated cost | $0.63 | $0.77 |

The cost increase is modest and reflects the longer productive run. Cost per level completed: v0.1.0 = infinity (0 levels), v0.2.0 = $0.77 (1 level). On a per-level basis, v0.2.0 is infinitely more cost-effective.

### 3.4 Mapping Overhead: 5 Dedicated Iterations

The parent spent iters 3-6 (4 iterations) on systematic grid mapping before beginning navigation at iter 7. In v0.1.0, the parent spent iters 2-4 (3 iterations) on mapping -- but then needed iters 5-12 for mechanic discovery. In v0.2.0, the scout report eliminated mechanic discovery, but the parent compensated by doing more thorough mapping. Whether 4 mapping iterations is excessive is debatable:
- The scout's naive path suggestion (RIGHT 2 + DOWN 4) was wrong because it ignored walls.
- The parent needed to discover the wall at cols 30-33 (rows 30-39) to plan a correct route.
- The upper room entrance width was critical (cols 34-38, exactly 5 wide) -- missing this would have caused wall-blocked moves.

However, some mapping could have been deferred. For example, iters 4 (bottom rows) and 5 (middle rows) could have been done on-the-fly during navigation. This would have freed 2-3 iterations for level 2.

### 3.5 Iteration Budget: Still 20

Both runs used exactly 20 iterations and timed out without calling `return()`. The budget was unchanged between experiments, and in both cases proved insufficient.

### 3.6 No `return()` Call

Neither run called `return()` before timeout. The v0.2.0 plugin includes a "Step 4: Return Results" section with explicit code, but the agent never reached that phase. The iteration exhaustion at iter 20 happened mid-exploration (level 2 maze analysis), so the agent had no opportunity to return partial results.

---

## 4. New Bottleneck Analysis

### 4.1 Iteration Budget Breakdown

**v0.2.0 iterations by phase:**

| Phase | Iterations | Actions | Description |
|-------|-----------|---------|-------------|
| Delegation | 1 | 7 (scout) | Scout explored, returned report |
| Verification | 1 | 0 | Parsed/verified scout claims |
| Mapping | 4 (iters 3-6) | 0 | Full grid visualization |
| Level 1 navigation | 7 (iters 7-13) | 17 | Navigate to marker, then to room |
| Level 2 state check | 1 (iter 14) | 0 | Observe new level state |
| Level 2 attempt | 4 (iters 15-18) | 22 | Navigate, hit walls, discover changes |
| Exhausted | 2 (iters 19-20) | 0 | No trace (timeout) |

**Summary: 6 iterations overhead, 7 for level 1, 5 for level 2 (incomplete), 2 lost to timeout.**

### 4.2 Mapping Cost Analysis

The 4 mapping iterations (iters 3-6) consumed 20% of the total iteration budget without any game actions. Could mapping be cheaper?

**Map-while-navigate strategy:** Instead of 4 dedicated mapping iterations, the agent could have:
1. Verified the scout report (iter 2, unchanged)
2. Moved LEFT toward the marker while observing the grid along the path (iter 3 = move + map)
3. Continued navigating while filling in the map (iters 4-5)

This could compress mapping + navigation into ~5 iterations instead of 4 + 7 = 11. Estimated savings: 2-3 iterations.

**Counter-argument:** The agent discovered the wall at cols 30-33 during mapping. If it had navigated blindly LEFT, it would have hit the wall and wasted moves (as v0.1.0 did at iters 13-14). Pre-mapping prevented this.

**Verdict:** A hybrid approach -- map the immediate path, navigate, then map more as needed -- would save ~2 iterations while preserving the wall-avoidance benefit.

### 4.3 Level 2 Re-delegation Opportunity

The agent spent iters 14-18 (5 iterations) struggling with level 2's changed maze topology. The first DOWN at iter 15 caused an unexpected jump (entity went from rows 10-11 to rows 40-41 in one step), and then 6 consecutive actions were blocked by walls. The agent didn't know the new layout.

**Re-delegation would have helped:** After level 1 completion at iter 13, the parent could have spawned a second scout to explore the level 2 maze. With 72 fuel and a changed maze, a Sonnet scout could map the new layout in 7-10 actions and return the topology. The parent would then navigate efficiently.

**Cost:** 1 parent iteration + ~7 scout iterations.
**Benefit:** The parent would know the level 2 wall layout, marker position ([47,50],[48,51] -- discovered only at iter 18), and corridor structure before navigating. This would have prevented the 6 wasted wall-blocked moves at iter 15.

### 4.4 Is 20 Iterations Fundamentally Too Tight?

**Minimum iterations per level (estimated from data):**

| Phase | Level 1 (observed) | Level N (estimated) |
|-------|-------------------|---------------------|
| Delegation/verification | 2 | 1 (re-delegate) |
| Mapping | 2-4 | 1-2 (scout maps) |
| Navigation | 5-7 | 5-7 |
| Level transition observation | 1 | 1 |
| **Total** | **10-14** | **8-11** |

For a game with N levels, the minimum budget is approximately: `14 + (N-1) * 10` iterations.
- 2 levels: 24 iterations minimum
- 3 levels: 34 iterations minimum
- 4 levels: 44 iterations minimum

At 20 iterations, the budget allows at most 1 level with ~6 iterations of slack, or 2 levels with zero slack and perfect play. This is indeed too tight for multi-level games.

### 4.5 Iteration-Fuel Tradeoff

An interesting dynamic emerged: the constraint shifted from fuel to iterations. At timeout, the agent had 56 fuel pixels (28 moves) -- enough for ~3-4 more levels of navigation. The cognitive overhead of understanding each level's topology is the actual bottleneck.

---

## 5. Scoring Gap

### 5.1 How `arc3Score` Works

From `/Users/sl/code/trinity/node-rlm/eval/scoring.ts`:

```typescript
export function arc3Score(predicted: string, _expected: string | string[]): number {
    const data = JSON.parse(predicted);
    if (typeof data.score === "number" && typeof data.total_levels === "number") {
        return data.total_levels > 0
            ? Math.min(1, data.score / data.total_levels)
            : 0;
    }
    return 0;
}
```

The scoring function expects the agent's `return()` value to be a JSON string containing `{ score: number, total_levels: number }` -- this is the ARC-3 API scorecard format. The score is `score / total_levels`, capped at 1.

### 5.2 Why the Score Is 0

The agent never called `return()`. Both runs hit `maxIterations=20` with `answer: ""`. Since the predicted string is empty, `JSON.parse("")` throws, the catch returns 0.

Even if the agent had returned the game's current state, it would need to call `arc3.getScore()` (or equivalent API) to obtain the scorecard JSON. Returning `{ status: "NOT_FINISHED", levelsCompleted: 1 }` would also score 0 because it lacks the `score` and `total_levels` fields.

### 5.3 What If the Agent Had Returned at Iter 13?

At iter 13, level 1 was just completed. If the agent had immediately called `return()` with the scorecard, the score would have been:
- `score` = sum of per-level efficiency ratios (baseline_actions / actual_actions)
- `total_levels` = total levels in the game (likely 3-5)
- For 1 completed level with 24 actions (7 scout + 17 parent), the ratio depends on the baseline (optimal number of actions for the level)

Even with 1 level completed, the score would be `efficiency_ratio / total_levels`. If the game has 4 levels and the efficiency ratio for level 1 is 0.5, the final score would be 0.5/4 = 0.125 (12.5%). This is much better than 0%.

### 5.4 The `return()` Problem

The agent's failure to call `return()` is a systematic issue. Neither run attempted it. The v0.2.0 plugin includes a "Step 4: Return Results" section with:

```javascript
if (arc3.completed) {
    const score = await arc3.getScore();
    return(JSON.stringify(score));
} else {
    const frame = arc3.observe();
    return(JSON.stringify({
        status: frame.state,
        levelsCompleted: frame.levels_completed,
        actionsUsed: arc3.actionCount,
    }));
}
```

But this code is only reached when the agent "decides" it's done -- and with 20 iterations, the agent never feels done. It always thinks "I can make more progress." This is a fundamental tension: the agent doesn't know its iteration limit is approaching.

### 5.5 Could Partial Progress Be Captured?

The current scoring function cannot capture partial progress because it requires the ARC-3 API scorecard (not just `levelsCompleted`). To capture partial progress, either:

1. **The agent must call `return()` with the ARC-3 scorecard** -- requires the agent to know when to stop and call `arc3.getScore()`.
2. **The scoring function could be extended** -- e.g., check for `levelsCompleted` and compute a proxy score. But this diverges from the official ARC-3 scoring.
3. **The engine could auto-return on timeout** -- instead of recording an empty answer, the engine could call `arc3.getScore()` and use that as the answer.

Option 3 is the most reliable because it doesn't depend on agent behavior.

---

## 6. Recommendations for v0.3.0

### 6.1 Proactive `return()` Before Timeout (HIGH PRIORITY, LOW EFFORT)

**What to change:** Add to the delegation plugin (and/or the engine): "Before your last 2 iterations, call `arc3.getScore()` and `return()` with the scorecard. Even if the game isn't finished, partial credit is awarded."

Alternatively, modify the engine to auto-return the scorecard on timeout for ARC-3 tasks.

**Expected impact:** Converts 0% scores into partial credit scores. For v0.2.0's performance, this would yield a non-zero score immediately.

**Effort:** Low. Plugin prose change (5 minutes) or engine code change (30 minutes).

### 6.2 Increase Iteration Budget to 30-40 (HIGH PRIORITY, LOW EFFORT)

**What to change:** CLI flag `--maxIterations 35` for ARC-3 tasks.

**Expected impact:** With 35 iterations, v0.2.0's run would have had 15 more iterations for level 2. Given that level 2 requires the same ~10-iteration pattern (re-map + navigate + enter room), 35 iterations would likely enable 2 level completions.

**Effort:** Low. Single CLI flag change.

### 6.3 Re-Delegation on Level Transition (HIGH PRIORITY, MEDIUM EFFORT)

**What to change:** Add to the delegation plugin: "After each level completion, spawn a new scout to map the changed maze layout. The maze topology changes between levels -- corridors shift, marker position moves, room content changes."

**Expected impact:** The level 2 failure was caused by 6 wasted moves against unknown walls (iter 15). A re-delegated scout would map the new layout in 1 parent iteration + 7 scout actions, preventing the wasted moves. Estimated savings: 3-4 parent iterations per level transition.

**Effort:** Medium. Requires plugin prose updates to both the delegation test and scout plugins. The scout plugin may need a "quick map" mode that skips initial probing (mechanics are already known from level 1).

### 6.4 Map-While-Navigate Strategy (MEDIUM PRIORITY, LOW EFFORT)

**What to change:** Replace the mapping phase (iters 3-6) with concurrent mapping during navigation. Update the plugin's navigation code example to include grid inspection of the path ahead before each move.

**Expected impact:** Saves 2-3 iterations by eliminating dedicated mapping. The agent would still discover walls, but only those in its immediate path.

**Effort:** Low. Plugin prose change to the "Step 3: Navigate Incrementally" section.

### 6.5 Level Transition Detection and Adaptation (MEDIUM PRIORITY, MEDIUM EFFORT)

**What to change:** Add explicit guidance to the delegation plugin:

> "When `levels_completed` increases:
> 1. Do NOT assume the same path works. The maze topology changes.
> 2. First, scan for the new color 1 marker position (it moves).
> 3. Map the immediate area around the entity and the marker.
> 4. Plan a new path. Corridors may be in different positions.
> 5. Consider re-delegating to a scout if the layout is unfamiliar."

**Expected impact:** Prevents the H3-style error (v0.2.0 iter 17: tried the same pattern as level 1, which didn't work). The agent would immediately recognize the need to re-map.

**Effort:** Medium. Plugin prose update plus potential scout plugin changes for "quick re-scout" mode.

### 6.6 Scout Plugin: Suppress Path Suggestions (LOW PRIORITY, LOW EFFORT)

**What to change:** Remove or qualify the scout's `pathToGoal` section. The v0.2.0 scout suggested "RIGHT 2 + DOWN 4" which was wrong (ignored walls). The parent correctly ignored this, but a weaker parent might follow it.

Alternative: Change the scout plugin to say "Do NOT suggest a path -- you cannot see walls from action probing alone. Only report positions and mechanics."

**Expected impact:** Minor. The v0.2.0 parent already ignored the bad path. But it removes a potential failure mode for future runs.

**Effort:** Low. Single line change in scout plugin.

### 6.7 Engine: Auto-Return Scorecard on Timeout (MEDIUM PRIORITY, MEDIUM EFFORT)

**What to change:** In the RLM engine's ARC-3 task handler, detect when `maxIterations` is about to be reached. On the penultimate iteration, inject a system message instructing the agent to `return()` the scorecard. Or, on actual timeout, automatically call `arc3.getScore()` and record it as the answer.

**Expected impact:** Eliminates the `return()` gap entirely. All ARC-3 runs would produce scores proportional to their actual progress.

**Effort:** Medium. Engine code change, requires understanding the iteration lifecycle and ARC-3 API.

### 6.8 Scout Improvements (LOW PRIORITY -- diminishing returns)

The v0.2.0 scout is already excellent (correct entity ID, measured fuel, exact positions, 5/5 hypotheses correct). Further improvements:
- **Quick-scan mode:** For re-delegation on level transitions, the scout only needs to map the grid and find the marker -- it doesn't need to re-discover mechanics. A `mode: "quick-map"` parameter could instruct the scout to skip probing and just render the grid.
- **Wall mapping:** The scout could render the full grid and identify wall boundaries, not just entity positions. This would eliminate the need for the parent's 4-iteration mapping phase.

**Expected impact:** Minor for initial scouting (already good), potentially significant for re-delegation.

**Effort:** Low (quick-map) to Medium (wall mapping).

---

## 7. Broader Implications

### 7.1 When Is Delegation Worth the Overhead?

The two runs provide a clean A/B test of delegation value:

| Metric | v0.1.0 (bad delegation) | v0.2.0 (good delegation) |
|--------|------------------------|-------------------------|
| Delegation cost | 1 iter + 42 actions | 1 iter + 7 actions |
| Value delivered | Zero (discarded) | High (accepted, verified) |
| Parent discovery time | 10 iterations | 1 iteration (verification) |
| Net iteration savings | -1 (pure cost) | +9 (saved 10, cost 1) |
| Net action savings | -42 (pure cost) | +28 (saved ~35 discovery actions, cost 7) |

**Delegation is worth the overhead when:**
1. The scout produces **actionable, precise output** that the parent can verify and use.
2. The scout's resource consumption is **bounded and proportional** to the value delivered.
3. The parent's alternative (independent discovery) would cost **significantly more** in iterations/actions.

In v0.2.0, the scout saved ~10 parent iterations at the cost of 1 parent iteration + 7 game actions. The ROI is ~10x on iterations. In v0.1.0, the scout consumed 1 parent iteration + 42 game actions and delivered zero value -- the ROI was negative.

**Key insight:** Delegation quality is binary in practice. A bad scout (vague output, high resource consumption) is not just "less useful" -- it's actively harmful because (a) it consumes shared resources irreversibly, and (b) the parent must independently rediscover everything anyway. A good scout eliminates entire phases of parent cognition.

### 7.2 What Makes a Good Scout vs a Bad One?

Comparing the two scouts:

| Attribute | v0.1.0 Scout (Flash) | v0.2.0 Scout (Sonnet) |
|-----------|---------------------|----------------------|
| Model capability | Insufficient for visual reasoning | Sufficient |
| Output format | Vague natural language | Structured JSON with exact numbers |
| Action budget | Unbounded ("generous budget") | Explicit (20 actions, tracked) |
| Phase structure | Loose (explore freely) | Rigid (Phase 1: probe 4 actions, Phase 2: identify, Phase 3: map) |
| Deliverables | "Description of what you move" | "Exact color, exact bounding box, measured depletion rate" |
| Resource awareness | None | Counted actions, reported remaining |

**A good scout needs:**
1. **Sufficient model capability** for the domain. Flash cannot reason about 64x64 pixel grids with the precision required. Sonnet can.
2. **Explicit output schema** with exact numbers, not descriptions. "Color 12 at [40-41, 44-48]" is parseable; "a cluster of pixels" is not.
3. **Bounded resource consumption** with explicit tracking. The scout must leave resources for the parent.
4. **Phased structure** that prioritizes the most valuable information first. Probe actions -> identify entity -> measure resources -> map board.
5. **Testable claims** that the parent can verify. "Color 11 depletes by 2px per action" is verifiable in one observation.

### 7.3 How Should Shared Mutable State Be Managed?

Both runs share the `arc3` client between parent and scout. The game state is mutable and irreversible -- every `arc3.step()` changes the board permanently (fuel depletes, entity moves, markers activate). This creates several risks:

1. **Scout pollution:** The scout's actions permanently alter the game state. In v0.1.0, 42 scout actions consumed most of the fuel. Even in v0.2.0, the scout consumed 14 fuel pixels (7 actions x 2px/action).
2. **State handoff ambiguity:** The parent must correctly understand the post-scout game state. In v0.2.0, the scout reported its end-state positions, which the parent verified. In v0.1.0, the parent had to re-observe everything.
3. **No rollback:** There is no `arc3.reset()` or save/restore mechanism. The scout cannot "try things and undo."

**Best practices for shared mutable state:**
- Scouts should minimize mutations (7 actions, not 42).
- Scouts should report the exact end-state (entity position, fuel remaining).
- The parent should verify the end-state before acting.
- If possible, the API should support save/restore (game checkpointing).

### 7.4 Relationship Between Scout Quality and Parent Efficiency

The data shows a nearly linear relationship:

| Scout quality | Parent discovery iters | Parent navigation iters | Total parent iters | Levels completed |
|--------------|----------------------|------------------------|-------------------|-----------------|
| Low (v0.1.0) | 10 (iters 2-12) | 6 (iters 13-18) | 19 | 0 |
| High (v0.2.0) | 1 (iter 2) | 12 (iters 7-18) | 18 | 1 |

When scout quality is low, the parent spends most of its budget on rediscovery. When scout quality is high, the parent spends its budget on navigation -- the productive work. The scout effectively converts parent iteration budget from "exploration" to "exploitation."

This implies that **improving scout quality has outsized returns**: each improvement to the scout directly translates to more parent iterations available for navigation, which is the only phase that advances toward the goal.

### 7.5 The Delegation Overhead Constant

Delegation has a fixed overhead of approximately 2 iterations: 1 for the `rlm()` call and 1 for verification. This is the "cost of coordination." For this overhead to be worthwhile, the scout must save more than 2 iterations of parent discovery time. In v0.2.0, it saved ~10, so the ROI is clear. The break-even point is approximately: if the parent would need more than 3 iterations to discover what the scout reports, delegation is worthwhile.

For re-delegation on level transitions, the calculation is similar: if the parent would spend 3+ iterations re-mapping (as it did in iters 14-18), a re-delegation costing 1-2 iterations is worthwhile.

### 7.6 Iteration Budget as the Fundamental Constraint

The shift from fuel depletion (v0.1.0) to iteration exhaustion (v0.2.0) reveals that the RLM's iteration budget is the true bottleneck for complex multi-step tasks. Fuel is a domain-specific resource that can be managed with careful play. Iterations are a meta-resource that constrains the agent's ability to think, observe, plan, and act.

For tasks that require understanding (mapping a maze) before acting (navigating it), the iteration budget must accommodate both phases. The current budget of 20 is tight for single-level games and insufficient for multi-level games. The optimal budget depends on:
- Domain complexity (how many iterations for mapping?)
- Number of levels (each level requires re-mapping)
- Delegation overhead (2 iterations per delegation)
- Error recovery (wall-blocked moves, strategy pivots)

A reasonable formula: `budget = delegation(2) + mapping(3) + navigation(7) + buffer(3) = 15 per level`. For a 3-level game: 45 iterations.
