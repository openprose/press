# ARC-3 Delegation Experiment: v0.7.0 Analysis and v0.8.0 Recommendations

**Date:** 2026-02-16
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6
**Run:** run-014 (v0.7.0)
**Prior runs:** run-008 (v0.1.0), run-009 (v0.2.0), run-010 (v0.3.0), run-011 (v0.4.0), run-012 (v0.5.0), run-013 (v0.6.0)
**Result file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T00-13-38-935Z.json`
**Replay:** https://three.arcprize.org/scorecards/f1a71a4b-94bf-48c8-a909-f039a323cbfb

---

## 1. Executive Summary

- **Score: 14.3% (1/7 levels)** -- identical to v0.5.0 and v0.6.0. Level 1 completed, Level 2 failed. The three-version plateau at 1/7 continues.
- **Efficiency: 11 iterations, 58 total actions, $0.84 cost, 506s wall time.** This is the most efficient run in the series by every metric: fewest iterations (11 vs v0.6.0's 26), fewest actions (58 vs v0.6.0's 143), lowest cost ($0.84 vs v0.6.0's $2.77), and fastest wall time (506s vs v0.6.0's ~800s).
- **Level 1 performance was excellent:** 20 actions in 4 iterations with clean BFS-guided navigation. Scout delegation worked, BFS found optimal paths, marker absorbed and rectangle entered without any blocked moves.
- **Level 2 failed due to a new failure mode: marker-rectangle path length exceeding marker respawn timer.** The marker was absorbed at action 37, but the BFS path from marker to rectangle was 19 steps -- far exceeding the ~10-action respawn window. The marker respawned before the entity reached the rectangle.
- **The agent correctly recognized the futility and returned early at iteration 11**, preserving its score rather than burning remaining fuel on an impossible task. This is a new, positive behavior -- v0.6.0 burned all 25 iterations trying to recover.

---

## 2. v0.7.0 Changes Tested

v0.7.0 implemented all 9 recommendations from the v0.6.0 analysis. Here is the assessment of each:

### 2.1 BFS Goal Matching Fix (Exact Match) -- CRITICAL

**Change:** `const atGoal = nr === goalR && nc === goalC;` (replaces the loose `Math.abs() <= STEP` threshold)

**Did it fire?** YES. The BFS consistently computed paths to exact goal positions:
- Iteration 2: BFS to (30,19) returned 9 steps -- exact match, not an approximation.
- Iteration 4: BFS to (10,34) returned 7 steps -- entity arrived exactly at r10, c34.
- Iteration 6: BFS to multiple targets all computed with exact matching.
- Iteration 8: BFS to (45,49) returned 1 step, BFS to rect at (35,14) returned 19 steps -- exact goals.

**Did it help?** YES for Level 1 -- the entity reached the exact rectangle entry point and completed the level. For Level 2, the fix worked correctly (BFS computed the right path to r35,c14) but the path was too long for the respawn window. The fix eliminated the "terminating 5px away" bug from v0.6.0.

**Evidence:** In v0.6.0, the 20-step path to Rect1 ended at r35/c14 instead of r41/c14 (5 rows short). In v0.7.0, the 19-step path to (35,14) actually reached (35,14) and the entity arrived there. The BFS itself is now correct. The problem is elsewhere.

### 2.2 Fresh Grid Before BFS -- CRITICAL

**Change:** Rule #11 added: "NEVER execute a BFS path computed on a previous iteration's grid."

**Did it fire?** YES. Every BFS computation in the trajectory used a freshly-observed grid:
- Iteration 2: `const grid = arc3.observe().frame[0]` before BFS.
- Iteration 3: `let grid = arc3.observe().frame[0]` before BFS and path execution.
- Iteration 4: `const grid = arc3.observe().frame[0]` before BFS to rectangle.
- Iteration 6: `const grid = arc3.observe().frame[0]` before L2 BFS.

**Did it help?** YES. The stale-grid catastrophe from v0.6.0 (7 wasted actions on a pre-transition BFS path) did not recur. The agent always observed the current grid state before computing paths. Zero actions were wasted on stale BFS paths.

### 2.3 Scout Must Verify Post-Transition State -- HIGH

**Change:** Scout re-scout mode requires `arc3.step(1)` verification before reporting.

**Did it fire?** YES. The L2 re-scout (iteration 5) used 1 action to verify position. The scout report shows entity at r35-36/c29-33 with marker at r46-47/c51-52 -- these are the correct Level 2 positions (verified by subsequent navigation). In v0.6.0, the scout reported the stale Level 1 completion position (r10-11/c34-38).

**Did it help?** YES. The parent received accurate position data and computed valid BFS paths from the true entity position. The 7-action stale-BFS waste from v0.6.0 was completely eliminated.

### 2.4 All-Fuel Transition Frame Handler -- HIGH

**Change:** Return guard checks `__fuel > 200` and executes an action to advance past transition.

**Did it fire?** NO. The agent never encountered an all-fuel transition frame in v0.7.0. In v0.6.0, this occurred at iteration 12 when navigating too close to a portal. The v0.7.0 agent took a different (shorter) path and avoided the portal.

**Did it help?** Not tested, but the code was present and would have fired if needed.

### 2.5 Multi-Directional Rectangle Entry (planRectangleEntry) -- HIGH

**Change:** New `planRectangleEntry()` function tries BFS from all 4 directions.

**Did it fire?** PARTIALLY. The agent did not use `planRectangleEntry()` directly. Instead, it manually computed BFS paths to multiple rectangle entry points in iteration 6, searching a grid of (r,c) targets near the rectangle. This is functionally similar but less systematic. For the Level 2 rectangle at r39-45/c13-19, the agent tried (35,14), (40,14), and (45,14) as entry points.

**Did it help?** PARTIALLY. The agent found that (35,14) was reachable in 18-19 steps from the marker area, confirming the rectangle was accessible. But the path length was the real problem, not the entry direction.

### 2.6 Color 5 in Default Walkable Set -- MEDIUM

**Change:** `getWalkable()` now returns `new Set([3, 12, 11, 0, 1, 9, 5])`.

**Did it fire?** YES. Color 5 was included in the walkable set throughout the run. This allowed BFS to plan paths through rectangle borders.

**Did it help?** YES for Level 1 (BFS could plan paths that crossed the color 5 border of Rect1). For Level 2, the BFS with color 5 walkable still returned a 19-step path -- the problem was path length, not walkability.

### 2.7 Pre-Compute Rectangle Path Before Absorption -- MEDIUM

**Change:** Strategy guidance: compute marker-to-rect BFS before absorbing, only absorb if path is short enough.

**Did it fire?** YES. The agent pre-computed paths from the marker area to the rectangle:
- Iteration 6: Extensive search of BFS paths from marker candidates to rect entries. All paths were 15-21 steps.
- Iteration 7: Pre-computed (40,49)->(35,14) = 18 steps, (45,49)->(35,14) = 19 steps.

**Did it help?** THIS IS WHERE THE SYSTEM BROKE. The pre-computation showed the shortest path was 18-19 steps. The plugin says "Only absorb when path B is <=10 steps (marker respawns after ~10 actions post-absorption)." The agent should NOT have absorbed the marker given a 19-step path. **But the agent absorbed anyway.** The plugin guidance was present but not enforced -- the agent overrode it, perhaps reasoning that it was worth trying.

### 2.8 Entity Position Verification After Transition -- MEDIUM

**Change:** Verify entity position with `getEntityPosition()` after level completion before planning.

**Did it fire?** YES. Iteration 5's scout verified entity at r35-36/c29-33 after transition. Iteration 6 confirmed the same position. No stale position assumptions.

**Did it help?** YES. Clean position data throughout L2.

### 2.9 BFS Intermediate Position Validation -- HIGH (from v0.6.0 recs)

**Change:** `canMove()` function to validate intermediate positions during 5-pixel steps.

**Did it fire?** NO. The `canMove()` function was NOT implemented in the code the model actually wrote. The model used the standard `bfsPath()` with only destination validation. However, no moves were blocked during BFS path execution (all path steps succeeded), so the absence was not harmful in this run.

### Summary Table

| # | Change | Fired? | Helped? | Impact on L2 |
|---|--------|--------|---------|---------------|
| 1 | BFS exact goal match | YES | YES | Fixed BFS termination |
| 2 | Fresh grid before BFS | YES | YES | Eliminated stale-grid waste |
| 3 | Scout verification step | YES | YES | Accurate L2 position data |
| 4 | All-fuel handler | NO | N/A | Not encountered |
| 5 | Multi-directional rect entry | PARTIAL | PARTIAL | Found entry but path too long |
| 6 | Color 5 walkable | YES | YES | Enabled rect entry planning |
| 7 | Pre-compute rect path | YES | **FAILED** | Agent ignored <=10-step rule |
| 8 | Position verification | YES | YES | Clean position data |
| 9 | Intermediate validation | NO | N/A | Not implemented by model |

---

## 3. Trajectory Walkthrough

### Phase 1: Level 1 -- Near-Perfect Execution (Iterations 1-4, 20 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 1 | 4 (scout) | 4 | Game started. Delegated to arc3-scout. Scout used 4 actions (UP to verify movement). Returned precise JSON: entity at r40-41/c44-48 (post-scout-action position), marker at r31-33/c20-22, fuel at 76/84. Scout also mapped 8 vertical corridors and 4 horizontal bands. |
| 2 | 0 | 4 | Grid analysis iteration. Entity confirmed at r40/c44. Found inner rectangle at r9-15/c33-39 (43 color-5 pixels) and outer border rectangle (396 color-5 pixels). BFS to marker (30,19) computed: 9 steps [1,1,1,3,3,3,3,2,3]. No game actions consumed. |
| 3 | 9 | 13 | Executed 9-step BFS path to marker. All steps succeeded without blocks. Marker absorbed at step 8 (entity overlapped marker at r30-31/c19-23). Actions 5-13. |
| 4 | 7 | 20 | BFS from (30,19) to rect at (10,34): 7 steps [1,4,4,4,1,1,1]. Executed successfully. **Level 1 completed at step 6.** Entity at r10-11/c34-38. Fuel at 46. |

**L1 Assessment:** 20 actions, 4 iterations, 1 delegation. Slightly worse than v0.6.0's 18 actions / 4 iterations (the BFS route was 2 actions longer due to different marker approach angle). But clean execution with zero blocked moves, zero wasted actions. The BFS exact-goal fix is validated -- the entity reached the rectangle interior precisely.

### Phase 2: Level 2 Re-Scout (Iteration 5, 1 action)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 5 | 1 (scout) | 21 | Mandatory re-scout delegation obeyed. Scout used 1 action (verification step). Reported entity at r35-36/c29-33 (correct L2 spawn), marker at r46-47/c51-52 (correct L2 marker), two rectangles (outer borders). Fuel at 46 initially, jumped to 98 after level transition (fuel refill). |

**Scout quality improvement over v0.6.0:** The v0.6.0 scout reported the stale L1 completion position (r10-11/c34-38). The v0.7.0 scout correctly verified the L2 position. This single fix saved the 7-action stale-BFS waste that crippled v0.6.0.

### Phase 3: Level 2 BFS Planning (Iteration 6, 0 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 6 | 0 | 21 | Extensive BFS search. Entity at r35/c29. Marker at r47/c51. Found Rect2 at r39-45/c13-19 (43 color-5 pixels, inner rect with color 9 interior). Computed BFS to 21 marker-area targets: shortest paths 15-18 steps. Also found Rect2 positions for post-absorption. All computation, zero game actions. |

**Key data from iteration 6:**
- Entity: r35-36, c29-33
- Marker: r47, c51 (5 pixels)
- Rect2: r39-45, c13-19 (43 color-5 pixels)
- BFS to marker: shortest = 15 steps to (40,49)
- BFS marker-to-rect: shortest = 18 steps from (40,49) to (35,14)
- **Total marker+rect path: 15 + 18 = 33 steps**

**CRITICAL OBSERVATION:** The combined path (marker + rect) is 33 steps. With 98 fuel (49 moves), the fuel budget is sufficient. But the marker respawns after ~10 actions post-absorption. A 19-step path from marker to rect means the marker will respawn at step ~10, before the entity reaches the rectangle. **The agent computed this but did not halt.**

### Phase 4: Level 2 Marker Navigation (Iteration 7, 15 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 7 | 15 | 36 | Pre-computed marker-to-rect paths (confirming 18-19 steps). Then executed 15-step BFS to marker at (40,49). Navigation was clean: no blocked moves. Entity arrived at r40-41/c49-53 after 15 steps. Marker still present (not yet overlapping). Fuel at 68. |

The entity did NOT absorb the marker on this path -- it arrived at (40,49) but the marker is at (47,51). The BFS targeted the marker area, not the exact marker pixel. This is a goal-selection issue, not a BFS bug.

### Phase 5: Marker Absorption and Rectangle Attempt (Iteration 8, 20 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 8 | 20 | 56 | BFS from (40,49) to (45,49): 1 step [DOWN]. Marker absorbed at this step. Then BFS to rect at (35,14): 19 steps [1,1,1,1,1,1,1,3,3,3,3,3,3,2,2,3,2,2,2]. Executed all 19 steps. Entity arrived at (35,14). **BUT LEVEL DID NOT COMPLETE.** Marker respawned during the 19-step journey. Entity is at r35-36/c14-18, just 4 rows above the rectangle top edge (r39). Fuel at 28. |

**THE CRITICAL FAILURE:** The agent absorbed the marker and then executed a 19-step path to the rectangle. The marker respawns after ~10 actions. By step 10, the marker had already respawned, so entering the rectangle no longer triggers level completion (the marker must still be absorbed when the entity enters). The entity arrived at the correct position (r35, c14) but the game state had reset.

Looking at the grid rendering from iteration 9:
```
r34: 4 4 4 4 4 3 3 3 3 3 4 4 4 4 4 4
r35: 4 4 4 4 4 c c c c c 4 4 4 4 4 4   <-- entity (c = color 12)
r36: 4 4 4 4 4 c c c c c 4 4 4 4 4 4
r37: 4 4 4 4 4 9 9 9 9 9 4 4 4 4 4 4
r38: 4 4 4 3 3 9 9 9 9 9 3 3 4 4 4 4
r39: 4 4 4 3 5 9 9 9 9 9 5 3 4 4 4 4   <-- rect top border
r40: 4 4 4 3 5 5 5 5 5 5 5 3 4 4 4 4
r41: 4 4 4 3 5 5 9 9 9 5 5 3 4 4 4 4
r42: 4 4 4 3 5 5 9 5 5 5 5 3 4 4 4 4
r43: 4 4 4 3 5 5 9 5 9 5 5 3 4 4 4 4
r44: 4 4 4 3 5 5 5 5 5 5 5 3 4 4 4 4
r45: 4 4 4 3 5 5 5 5 5 5 5 3 4 4 4 4   <-- rect bottom border
r46: 4 4 4 3 3 3 3 3 3 3 3 3 4 4 4 4
```

The entity at r35/c14 is directly above the rectangle, separated by color 9 at r37-38 and the rect border at r39. The entity would need 1-2 more DOWN steps to enter. But it is blocked -- the DOWN move from r35 leaves the entity at r35 (blocked by r37's color 9 which is walkable, but r39's color 5 border overlapping with entity's 5-wide footprint creates collision at pixels that are walls).

Wait -- looking more carefully at the grid, the entity is at c14-18 and the rectangle is at c13-19. The entity's 5-wide footprint at c14-18 does NOT align with the rectangle's interior columns. The rect interior (color 9) is at c18-22 based on the rendering (the `9`s are in columns c18-22 relative to the c13 start). This is an alignment problem.

### Phase 6: Stuck and Return (Iterations 9-11, 2 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 9 | 0 | 56 | Grid analysis. Entity at r35/c14. Marker respawned at r47/c51 (5 pixels). Computed round-trip: marker to rect and back = 40 steps. With 14 moves of fuel, this is impossible. The agent correctly recognized the situation is unrecoverable. |
| 10 | 2 | 58 | Attempted to enter rect directly (DOWN and LEFT). Both blocked. Entity stuck at r35/c14. Fuel at 26. |
| 11 | 0 | 58 | Agent returned score. "Level 2 not completable with remaining fuel." Score: 14.3%. |

**Assessment:** The agent made the correct decision to return early. In v0.6.0, the agent burned 14 more iterations trying to recover, consuming $1.93 more in API cost with zero additional progress. v0.7.0's early termination preserved budget and time.

---

## 4. L2 Failure Analysis

### Failure Mode: Marker Respawn Before Rectangle Entry

This is a **different failure mode** from v0.6.0. Compare:

| Aspect | v0.6.0 Failure | v0.7.0 Failure |
|--------|---------------|---------------|
| BFS goal matching | Terminated 5px early | Correct (exact match) |
| Grid freshness | Stale grid, 7 wasted actions | Fresh grid throughout |
| Scout accuracy | Stale positions reported | Correct positions reported |
| Marker absorbed? | Yes (2x, both times marker respawned) | Yes (1x, marker respawned) |
| Rectangle reached? | No (stuck 5 rows above) | Yes (reached r35/c14, 4 rows above) |
| Entry attempted? | Yes (blocked) | Yes (blocked from r35) |
| Root cause | BFS bugs (loose goal, stale grid) | Path geometry (marker-to-rect too far) |
| Actions wasted on stale data | 7 | 0 |
| Actions wasted on blocked moves | ~50 | 2 |
| Total L2 actions | 125 | 38 |

The v0.7.0 failure is qualitatively better than v0.6.0. The agent navigated cleanly to the correct positions, absorbed the marker, and reached within 4 rows of the rectangle -- all without a single blocked move during BFS execution. The failure is purely geometric: the marker and rectangle are 19 steps apart on Level 2's maze, and the game mechanic requires reaching the rectangle within ~10 steps of absorption.

### Why Was the Path So Long?

The 19-step path from marker (45,49) to rect entry (35,14):
```
[1,1,1,1,1,1,1,3,3,3,3,3,3,2,2,3,2,2,2]
```

This path goes:
1. UP 7 times: r45->r40->r35->r30->r25->r20->r15->r10 (reaching the top corridor)
2. LEFT 6 times: c49->c44->c39->c34->c29->c24->c19 (traversing the top corridor)
3. DOWN 2 times: r10->r15->r20 (descending)
4. LEFT 1 time: c19->c14
5. DOWN 2 times: r20->r25->r30 (further descent)
6. DOWN 1 time: r30->r35 (final approach)

The path has to go UP to the top of the maze and LEFT across the entire width, then come back DOWN. This is because the direct route (LEFT from c49 to c14 at the entity's current row) is blocked by walls. The Level 2 maze has no direct horizontal corridor connecting the marker area (right side) to the rectangle (left side) at the entity's row level.

### Could the Agent Have Found a Shorter Path?

Looking at the corridor connectivity from the scout report:
- Vertical paths: c10-14, c15-19, c20-24, c25-29, c30-34, c35-39, c40-44, c45-49, c50-54
- Horizontal connection at r5-14: c19-53 (wide east-west corridor at top)
- Horizontal connection at r15-24: fragmented (c9-23 and c29-38 and c44-53, with gaps)
- Horizontal at r25-34: very fragmented (c14-18, c34-43, c49-53 -- three disconnected segments)
- Horizontal at r35-45: no wide east-west corridor

The maze geometry forces a detour through the top corridor (r5-14) to cross from the right side (c49) to the left side (c14). There is no shorter path. The BFS found the optimal route; it just happens to be 19 steps on this particular maze.

### The Deeper Problem: Path Length vs. Respawn Timer

The game mechanic creates a timing constraint: absorb the marker, then reach the rectangle within ~10 actions before respawn. The Level 2 maze places the marker and rectangle 19 steps apart. This means:

1. The agent cannot absorb the marker first and then navigate to the rectangle (19 > 10).
2. The agent needs to position itself at an intermediate point where both marker and rectangle are within ~5 steps, then absorb and immediately enter. But no such point exists on this maze -- the marker is at r47/c51 and the rectangle is at r39-45/c13-19. They are on opposite sides of the maze.
3. Alternatively, the respawn timer assumption (~10 actions) may be wrong, or there may be a mechanic to extend it.

---

## 5. BFS Bug Fix Assessment

### Did the Exact Goal Match Fix Fire?

**YES.** Every BFS call in the trajectory used exact goal matching (`nr === goalR && nc === goalC`). Evidence:

| Iteration | BFS Call | Goal | Result | Exact Match? |
|-----------|---------|------|--------|-------------|
| 2 | Entity to marker | (30,19) | 9 steps | YES -- entity reached r30/c19 |
| 3 | Entity to marker | (30,19) | 9 steps, MARKER ABSORBED at step 8 | YES |
| 3 | Marker to rect | (10,34) | 7 steps | YES |
| 4 | Entity to rect | (10,34) | 7 steps, LEVEL COMPLETED at step 6 | YES |
| 6 | Entity to (40,49) | (40,49) | 15 steps | YES |
| 7 | Entity to (40,49) | (40,49) | 15 steps | YES |
| 8 | Entity to (45,49) | (45,49) | 1 step | YES |
| 8 | Entity to (35,14) | (35,14) | 19 steps | YES -- entity reached r35/c14 |

The v0.6.0 bug where BFS terminated at (35,14) instead of (41,14) is gone. The BFS now reaches the exact specified goal.

### Did It Help?

YES for Level 1 -- the entity entered the rectangle at exactly (10,34) and the level completed.

For Level 2, the fix worked correctly but exposed the underlying path-length problem. In v0.6.0, the BFS terminated early AND the path was long. In v0.7.0, the BFS terminates correctly, but the path is still long. The fix was necessary but not sufficient.

### The `atGoal` Override

The BFS also includes `if (!isValid(nr, nc) && !atGoal) continue;` -- meaning the goal position overrides walkability checks. This allows the BFS to plan paths that terminate at a rectangle border (which might not be "walkable" by standard rules but triggers level completion). This override did not cause issues in this run.

---

## 6. Fresh Grid Fix Assessment

### Did the Model Observe Fresh Grids Before BFS?

**YES, consistently.** Evidence from the code:

- **Iteration 2:** `const grid = arc3.observe().frame[0];` then `bfsPath(grid, pos.rMin, ...)` -- fresh.
- **Iteration 3:** `let grid = arc3.observe().frame[0];` then BFS -- fresh.
- **Iteration 4:** `const grid = arc3.observe().frame[0];` then BFS -- fresh.
- **Iteration 6:** `const grid = arc3.observe().frame[0];` then BFS -- fresh.
- **Iteration 7:** `const grid = arc3.observe().frame[0];` then BFS -- fresh. Also used fresh grid for pre-computing marker-to-rect paths.
- **Iteration 8:** `const grid = arc3.observe().frame[0];` then BFS -- fresh.
- **Iteration 9:** `const grid = arc3.observe().frame[0];` -- fresh.

### Impact

The stale-grid catastrophe from v0.6.0 did not recur. In v0.6.0, the agent computed a BFS path on the Level 1 grid and executed it on the Level 2 maze, wasting 7 actions. In v0.7.0, every BFS computation used the current grid. Zero actions were wasted on stale data.

This fix alone saved 7 actions and 14 fuel compared to v0.6.0.

---

## 7. Cross-Version Progression Table

| Metric | v0.1.0 | v0.2.0 | v0.3.0 | v0.4.0 | v0.5.0 | v0.6.0 | **v0.7.0** | Trend |
|--------|--------|--------|--------|--------|--------|--------|--------|-------|
| **Plugin version** | 0.1.0 | 0.2.0 | 0.3.0 | 0.4.0 | 0.5.0 | 0.6.0 | **0.7.0** | -- |
| **Iteration budget** | 20 | 20 | 30 | 30 | 30 | 30 | **30** | Stable |
| **Iterations used** | ~20 | ~20 | ~30 | ~30 | ~30 | 26 | **11** | **Best ever** |
| **Scout model** | Flash | Sonnet | Sonnet | Sonnet | None | Orchestrator | **Orchestrator** | Stable |
| **Scout actions (L1)** | 42 | 7 | 6 | 4 | 0 | 4 | **4** | Efficient |
| **Scout actions (L2)** | -- | -- | -- | -- | 0 | 0 | **1** | Fixed |
| **Delegations** | 2 | 1 | 1 | 2 | 0 | 2 | **2** | Stable |
| **Levels completed** | 0 | 1 | 1 | 0 | 1 | 1 | **1** | Plateau |
| **L1 deliberate?** | -- | No | No | -- | Yes | Yes | **Yes** | Stable |
| **L1 actions** | -- | ~24 | ~33 | -- | 16 | 18 | **20** | Good |
| **L1 iterations** | -- | 13 | 17 | -- | 9 | 4 | **4** | Best-tier |
| **L2 attempted?** | No | Yes | Yes | No | Yes | Yes | **Yes** | -- |
| **L2 actions** | -- | ~22 | ~28 | -- | 106 | 125 | **38** | **Best ever** |
| **L2 marker absorbed?** | -- | -- | -- | -- | Yes (2x) | Yes (2x) | **Yes (1x)** | Improved |
| **L2 rectangle reached?** | -- | -- | -- | -- | No | No (5px short) | **Yes (4 rows above)** | **Best ever** |
| **L2 rectangle entered?** | -- | -- | -- | -- | No | No | **No** | Plateau |
| **BFS used?** | No | No | No | No | No | Yes (buggy) | **Yes (fixed)** | Improved |
| **BFS bugs** | -- | -- | -- | -- | -- | 2 critical | **0** | Fixed |
| **Blocked moves (L2)** | -- | -- | -- | -- | ~50 | ~15 | **2** | **Best ever** |
| **return() called** | No | No | No | Yes | Yes | Yes | **Yes** | Stable |
| **return() timing** | -- | -- | -- | iter 25 | iter 25 | iter 25 | **iter 11** | Smart early |
| **Score** | 0 | 0 | 0 | 0 | 14.3% | 14.3% | **14.3%** | Plateau |
| **Total actions** | ~85 | 46 | 61 | 45 | 122 | 143 | **58** | **Best ever** |
| **Wall time** | 255s | 336s | 515s | 558s | 725s | ~800s | **506s** | **Best ever** |
| **Cost** | $0.63 | $0.77 | $1.46 | $1.27 | $2.08 | $2.77 | **$0.84** | **Best ever** |
| **Failure mode** | Resource | Cognitive | Protocol | Domain | Algorithmic | Execution Fidelity | **Geometric** | New |
| **Key change** | Baseline | Better scout | More iterations | return() guard | Level completion | BFS + delegation | **BFS bug fixes** | -- |

---

## 8. Efficiency Analysis

### Why Only 11 Iterations?

v0.7.0 used 11 iterations vs v0.6.0's 26. This is a 58% reduction. The causes:

**Positive efficiency gains (good):**
1. **No stale-grid waste:** v0.6.0 burned iterations 6-8 recovering from stale BFS data. v0.7.0 had none.
2. **No all-fuel frame waste:** v0.6.0 burned iterations 12-13 recovering from a transition frame. v0.7.0 avoided this entirely.
3. **No marker-respawn loops:** v0.6.0 absorbed the marker twice, each time failing to reach the rectangle. v0.7.0 absorbed once, failed, and stopped.
4. **No stuck-loop iterations:** v0.6.0 spent iterations 15-24 stuck at r35/c14 trying different approaches. v0.7.0 recognized the situation was unrecoverable after 2 attempts and returned.

**Smart early termination (good):**
5. The agent correctly calculated that with 14 moves of fuel and a 40-step round-trip (marker + rect), Level 2 was impossible. Returning at iteration 11 preserved budget. This is the first time an agent showed this level of strategic awareness.

### Is This Good or Bad?

**Mostly good.** The 11-iteration run produced the same score as v0.6.0's 26-iteration run but at 30% of the cost ($0.84 vs $2.77) and 63% of the wall time. The efficiency gains are real -- the agent wasted far fewer actions on recovery loops.

**Slightly concerning:** The agent did not attempt any creative strategies to solve the path-length problem. It could have tried:
1. Navigating closer to the rectangle first, then absorbing the marker from a position where the rect path is shorter.
2. Testing whether the rectangle has multiple entry points at different distances.
3. Exploring whether there is a shortcut or portal that bypasses the maze structure.

Instead, it accepted the 19-step path as the only option and gave up. v0.6.0, despite being wasteful, at least attempted multiple approaches. The ideal behavior would be v0.7.0's efficiency with v0.6.0's persistence -- try creative strategies, but stop if fuel runs out.

---

## 9. Root Cause Analysis

### The Blocking Issue: Marker-Rectangle Spatial Separation

The single blocking issue preventing Level 2 completion is that **the marker and rectangle are too far apart on the maze for the entity to absorb the marker and reach the rectangle before marker respawn.**

Specifically:
- Marker position: r47, c51 (bottom-right quadrant)
- Rectangle position: r39-45, c13-19 (left quadrant)
- Shortest BFS path: 19 steps (requires going UP to r10, LEFT across the top corridor, then DOWN to c14)
- Marker respawn timer: ~10 actions after absorption
- Gap: 19 - 10 = 9 actions short

This is not a bug in the agent's code. The BFS is correct. The grid observation is fresh. The scout data is accurate. The entity reaches the correct positions. The problem is the interaction between:
1. **Maze geometry** (no direct path between marker and rect at the relevant row levels)
2. **Game mechanic** (marker respawns after ~10 actions)
3. **Agent strategy** (absorb marker first, then navigate to rect)

### The Missing Strategy: Position Before Absorb

The agent always navigates to the marker first, absorbs, then navigates to the rectangle. This works when marker and rectangle are close (Level 1: 7 steps apart). It fails when they are far (Level 2: 19 steps apart).

The correct strategy for Level 2 is:
1. Navigate to a position BETWEEN the marker and rectangle, such that both are reachable within ~5 steps.
2. If no such intermediate position exists (both targets are too far apart), navigate to a position adjacent to the rectangle first, then navigate to the marker, absorb, and return to the rectangle.

The optimal approach for this specific maze:
1. Navigate from spawn (r35/c29) to a position near the rectangle (e.g., r35/c14 or r40/c14) -- this costs ~8 steps.
2. From rectangle-adjacent position, navigate to the marker (e.g., r40/c14 to r45/c49) -- this costs ~20 steps.
3. Absorb the marker at (45,49).
4. Navigate from marker to rectangle (45,49 to 35,14) -- 19 steps. Still too long.

Actually, even with optimal positioning, the 19-step marker-to-rect path is the constraint. The entity cannot get from the marker to the rectangle in fewer than 19 steps because the maze geometry requires the top-corridor detour. No amount of pre-positioning helps if the shortest return path is 19 steps.

### Alternative: Is the Respawn Timer Wrong?

The ~10-action respawn assumption comes from v0.5.0 observations. But in v0.7.0, the marker definitely respawned -- the agent saw it at iteration 9 (after 19 post-absorption steps). What if the respawn timer is longer than 10 but shorter than 19? The actual threshold could be:
- If respawn happens at exactly action 10: need path <= 10 (currently 19)
- If respawn happens at exactly action 15: need path <= 15 (currently 19, still too long)
- If respawn happens at exactly action 18: need path <= 18 (currently 19, almost!)

The v0.6.0 analysis shows the marker respawned twice after absorption. But the exact action count at respawn was not precisely measured. If the respawn timer is 15-18 actions, the entity might barely fail (19 steps when it needs 18). In that case, finding a path that is even 1 step shorter could make the difference.

### Alternative: Is There a Different Rectangle?

The agent found two rectangle clusters:
1. Outer border (r0-63, c0-63) -- 396 pixels, this is the maze frame
2. Inner rect (r39-45, c13-19) -- 43 pixels, this is the actual target

But what if the outer border IS a target? Or what if there is a second inner rectangle that the agent missed? The scout report mentions rectangles at r0-51/c0-3 and r60-63/c12-63, but these look like they are part of the outer border. A more thorough rectangle search might find a closer target.

---

## 10. v0.8.0 Recommendations

### 10.1 Reverse Navigation Order: Rectangle-First Strategy (CRITICAL)

**Priority:** CRITICAL
**Effort:** Medium (restructure strategy section, no code changes to BFS)
**Impact:** Directly addresses the root cause. If the entity is already adjacent to the rectangle when it absorbs the marker, the rect-entry path is 0-3 steps, well within the respawn window.

**Strategy change:**

```markdown
### Navigation Flow (MANDATORY for Level 2+)

**CRITICAL CHANGE from v0.7.0:** Do NOT navigate to the marker first. Navigate to
the rectangle area first, THEN navigate to the marker, THEN return to the rectangle.

1. **Pre-compute all paths:**
   a. BFS from entity to each rectangle entry point (path A)
   b. BFS from each rectangle entry point to the marker (path B)
   c. BFS from the marker back to each rectangle entry point (path C)
   d. For each entry point, total return cost = len(path C)
   e. If ANY entry point has path C <= 8 steps: use that entry point.
   f. If ALL entry points have path C > 10: the marker-first strategy won't work.
      Try positioning at the entry point with the shortest path C,
      then navigate to marker, absorb, and sprint back.

2. **Execute in order:**
   a. Navigate to the best rectangle entry point (execute path A).
   b. Navigate from rectangle entry to marker (execute path B).
   c. Absorb the marker.
   d. Sprint back to the rectangle entry (execute path C -- must be <= 10 steps).
   e. Enter the rectangle. Level should complete.

3. **If path C > 10 for ALL entry points:**
   a. Find the position P that minimizes max(dist(P, marker), dist(P, rect_entry)).
   b. Navigate to P.
   c. Navigate to marker, absorb.
   d. Navigate from marker to rect via P (should be shorter because P is between them).
   e. If still too long: test whether a portal/shortcut exists between marker and rect.
```

**Why this works:** On Level 2, the entity can navigate to (35,14) in 8 steps from spawn. From (35,14), it needs to get to marker at (45,49) -- ~19 steps. From marker back to (35,14) -- 19 steps. Total: 8 + 19 + 19 = 46 steps (23 fuel). This does NOT solve the problem because path C (return) is still 19 steps.

**The real insight:** We need to find a rectangle entry point that is CLOSER to the marker. Let us check if the entity can enter the rectangle from the BOTTOM (r45) or RIGHT (c19) side rather than from above (r35). If the entity enters from (45,14), the return path from (45,49) to (45,14) might be shorter because both are at the same row.

BFS from (45,49) to (45,14): This would require a direct LEFT path at row 45. If the corridor at r45 connects c14 to c49, the path could be as short as 7 steps [3,3,3,3,3,3,3]. But the maze connectivity shows r45's horizontal extent is unknown from the data available.

**Add to plugin:** Explicitly compute paths C for ALL rectangle entry points before deciding where to absorb the marker. Log the shortest return path and only absorb when it is <= 10.

### 10.2 Precise Marker Respawn Timer Measurement (CRITICAL)

**Priority:** CRITICAL
**Effort:** Small (add instrumentation)
**Impact:** Knowing the exact respawn timer determines whether the current 19-step path is truly impossible or just barely too long.

**Add to the navigation code:**

```javascript
// After marker absorption, count exact actions until marker respawns
let postAbsorbActions = 0;
let markerRespawned = false;
for (let i = 0; i < path.length; i++) {
  const result = await arc3.step(path[i]);
  postAbsorbActions++;
  const curMarker = findMarker(result.frame[0]);
  if (curMarker && !markerRespawned) {
    markerRespawned = true;
    console.log(`MARKER RESPAWNED after ${postAbsorbActions} post-absorption actions`);
  }
  // ... rest of navigation
}
```

**Also log in the plugin rules:**

```markdown
13. **Measure marker respawn timer.** After absorbing the marker, count every
    action until the marker reappears. Log this number precisely. If the timer
    is 15+, paths up to 14 steps may work. If the timer is 10, only paths
    <= 9 steps are safe. This measurement is CRITICAL for Level 2+ planning.
```

### 10.3 Bidirectional Path Search: Rect-Adjacent Position to Marker (HIGH)

**Priority:** HIGH
**Effort:** Medium (new helper function)
**Impact:** Finds the shortest round-trip path from any rect entry point to the marker and back. This is the key computation for the rectangle-first strategy.

```javascript
// Find the rectangle entry point with the shortest round-trip to the marker.
function findBestAbsorptionPoint(grid, markerR, markerC, rectEntries, walkable) {
  let bestTrip = null;
  for (const entry of rectEntries) {
    const toMarker = bfsPath(grid, entry.r, entry.c, markerR, markerC, walkable);
    if (!toMarker) continue;
    const fromMarker = bfsPath(grid, markerR, markerC, entry.r, entry.c, walkable);
    if (!fromMarker) continue;
    const roundTrip = toMarker.length + fromMarker.length;
    const returnLen = fromMarker.length;
    console.log(`Entry [${entry.r},${entry.c}] (${entry.dir}): to marker=${toMarker.length}, return=${fromMarker.length}, total=${roundTrip}`);
    if (!bestTrip || returnLen < bestTrip.returnLen) {
      bestTrip = { entry, toMarker, fromMarker, roundTrip, returnLen };
    }
  }
  if (bestTrip) {
    console.log(`BEST: entry [${bestTrip.entry.r},${bestTrip.entry.c}], return=${bestTrip.returnLen} steps`);
  }
  return bestTrip;
}
```

### 10.4 Explore Maze for Shortcuts and Portals (HIGH)

**Priority:** HIGH
**Effort:** Medium (add probing instructions to scout)
**Impact:** If a portal connects the right side (near marker) to the left side (near rect), the 19-step path collapses to 1-3 steps. The v0.5.0 and v0.6.0 runs both observed teleport/portal mechanics. These were not systematically mapped.

**Add to scout re-scout instructions:**

```markdown
6. **Probe for portals/shortcuts.** If the marker and nearest rectangle are far apart
   (BFS > 10 steps), test whether boundary positions or specific color clusters
   trigger teleportation. In previous runs, moving past grid boundaries or through
   certain positions caused the entity to teleport. Document any teleport triggers:
   position entered, position exited, direction of movement.
```

### 10.5 Flexible Marker-Rectangle Order Based on Path Length (HIGH)

**Priority:** HIGH
**Effort:** Small (add conditional logic to strategy)
**Impact:** Automates the decision of whether to go marker-first or rectangle-first based on computed path lengths.

```markdown
### Adaptive Navigation Order

After computing all paths, choose the navigation order based on path lengths:

- **If BFS(marker -> best_rect_entry) <= 10 steps:** Use marker-first order.
  Navigate to marker, absorb, sprint to rectangle. (This is the Level 1 strategy.)

- **If BFS(marker -> best_rect_entry) > 10 steps:** Use rectangle-first order.
  Navigate to best rectangle entry point, then to marker, absorb, sprint back.
  Only proceed if the return path (marker -> rect_entry) <= 10 steps.

- **If ALL return paths > 10 steps:** The marker-to-rectangle distance exceeds
  the respawn timer on ALL routes. Possible recovery strategies:
  a. Look for portals that shorten the path.
  b. Test whether the other rectangle (if two exist) is closer to the marker.
  c. Test whether absorbing the marker at a different angle (approaching from a
     direction that leaves the entity closer to the rectangle) produces a shorter return.
  d. Report "Level N appears geometrically unsolvable with current knowledge" and
     return score.
```

### 10.6 Two-Rectangle Target Selection (MEDIUM)

**Priority:** MEDIUM
**Effort:** Small (add rectangle enumeration and testing)
**Impact:** The agent identified two rectangles (outer border + inner Rect2). But only tested paths to one. The other rectangle might be closer to the marker.

**Add to strategy:**

```markdown
### Rectangle Selection for Level Completion

Each level has two rectangles (identified by color 5 clusters). Only ONE triggers
level completion. Test BOTH rectangles:

1. Find all distinct color-5 clusters (excluding the outer border if it spans the full grid).
2. Compute BFS from marker to each rectangle.
3. Try the closer rectangle first.
4. If entering the closer rectangle does not complete the level, try the farther one.
5. If neither completes the level: the marker absorption may not have been registered
   (marker respawned). Re-absorb and retry.
```

### 10.7 Scout Should Compute Return Paths (MEDIUM)

**Priority:** MEDIUM
**Effort:** Small (add to scout instructions)
**Impact:** The scout can compute BFS paths without consuming game actions (BFS uses the observed grid, not game steps). If the scout computes and reports the marker-to-rect return paths for all entry points, the parent can make an informed absorption decision.

**Add to scout re-scout instructions:**

```markdown
7. **Compute return paths.** For each rectangle entry point, compute BFS from the marker
   position back to that entry point. Report the shortest return path length and the
   corresponding entry point. This tells the parent whether marker absorption is safe
   (return path <= 10) or requires a different strategy.
```

### Recommendation Summary

| # | Recommendation | Priority | Effort | Root Cause |
|---|---------------|----------|--------|------------|
| 1 | Rectangle-first navigation strategy | **CRITICAL** | Medium | Marker respawns before rect entry |
| 2 | Measure marker respawn timer precisely | **CRITICAL** | Small | Unknown exact respawn threshold |
| 3 | Bidirectional path search (rect-to-marker round-trip) | **HIGH** | Medium | Need shortest return path |
| 4 | Explore maze for portals/shortcuts | **HIGH** | Medium | 19-step path may have shortcut |
| 5 | Adaptive marker/rect navigation order | **HIGH** | Small | Strategy must adapt to geometry |
| 6 | Two-rectangle target selection | **MEDIUM** | Small | May be targeting wrong rectangle |
| 7 | Scout computes return paths | **MEDIUM** | Small | Parent needs path data for decisions |

**If only two changes are made:** Recommendations #1 (rectangle-first strategy) and #2 (respawn timer measurement). The rectangle-first strategy ensures the entity is already adjacent to the rectangle when it absorbs the marker, minimizing the return path. The respawn timer measurement provides the exact constraint so the agent knows what path lengths are feasible.

---

## 11. Bottleneck Progression

```
v0.1.0  Resource -----------> fix scout efficiency
v0.2.0  Cognitive ----------> fix iteration budget
v0.3.0  Protocol -----------> fix return() guard
v0.4.0  Domain Knowledge ---> fix level completion docs
v0.5.0  Algorithmic --------> fix pathfinding algorithm
v0.6.0  Execution Fidelity -> fix BFS implementation bugs
v0.7.0  Geometric ----------> fix navigation order for spatial layout   <-- WE ARE HERE
v0.8.0  ???  (predicted: Timing/Mechanic or Multi-Level Scaling)
```

### Analysis: Geometric Constraint

v0.7.0's bottleneck is a new category: **Geometric Constraint**. The agent's code is correct. The BFS works. The scout reports accurate data. The navigation is clean. But the spatial layout of the Level 2 maze places the marker and rectangle so far apart that the agent cannot traverse the distance within the marker respawn window.

This is distinct from all previous bottlenecks:
- v0.5.0 (Algorithmic): The agent had no pathfinding. Fix: add BFS.
- v0.6.0 (Execution Fidelity): The agent had BFS but it was buggy. Fix: debug BFS.
- v0.7.0 (Geometric): The agent has correct BFS but the maze geometry defeats the current strategy. Fix: change the strategy to account for geometry.

The fix is not about adding capability (v0.5.0) or debugging code (v0.6.0) but about **strategic reasoning** -- choosing the right order of operations based on computed path lengths. This is a higher-level fix that requires the agent to reason about game constraints (respawn timer) and adapt its strategy accordingly.

### The Deeper Pattern

| Layer | Category | Nature of Fix | Effort | Cognitive Level |
|-------|----------|--------------|--------|----------------|
| 1 | Resource | Configuration (scout model) | Trivial | Operational |
| 2 | Cognitive | Configuration (iteration budget) | Trivial | Operational |
| 3 | Protocol | Prompt engineering (return guard) | Small | Procedural |
| 4 | Domain Knowledge | Prompt engineering (level completion) | Small | Semantic |
| 5 | Algorithmic | New code (BFS function) | Medium | Computational |
| 6 | Execution Fidelity | Bug fixes in existing code | Small | Debugging |
| 7 | Geometric | Strategy restructuring | Medium | **Strategic** |

The fixes are ascending in cognitive complexity. v0.1.0-v0.4.0 were configuration/prompt fixes. v0.5.0-v0.6.0 were code-level fixes. v0.7.0's fix requires strategic reasoning about game constraints -- a qualitatively different type of intervention. This suggests the system is moving from "can the agent execute correctly?" to "can the agent plan correctly?" -- a transition from execution to planning.

---

## 12. Projected v0.8.0 Outcomes

### Conservative (Recommendations 1-2 only)

- **Levels completed: 2** (L1 + L2)
- **Score: 28.6%** (2/7)
- **Total actions: ~80**
- **Confidence: Medium.** The rectangle-first strategy should work IF the return path from marker to rect is <= 10 steps for at least one entry point. This is not guaranteed -- on this maze, the return path may still be 19 steps from all directions. But the bidirectional search might find a shorter return path via a different entry point (e.g., entering from the right side of the rectangle at c19, which is closer to the marker at c49).

### Moderate (Recommendations 1-5)

- **Levels completed: 2-3** (L1 + L2 + possibly L3)
- **Score: 28.6-42.9%** (2-3/7)
- **Confidence: Medium.** Level 3's baseline is 172 actions -- it is a complex level. Even with perfect BFS navigation, completing it within the remaining iteration budget (~15 iterations after L2) requires efficient pathfinding and no new failure modes.

### Optimistic (All recommendations, portals found)

- **Levels completed: 3-4**
- **Score: 42.9-57.1%**
- **Confidence: Low.** Requires finding portals or shortcuts that collapse the marker-to-rect path, AND Level 3-4 having solvable geometries.

### Predicted New Failure Mode

With the geometric constraint addressed, the predicted v0.8.0 failure is either:
1. **Timing precision:** The respawn timer is shorter than expected, making even optimized paths too long.
2. **Multi-level scaling:** The iteration budget (25 usable) limits the number of levels completable. At ~5 iterations per level (scout + plan + navigate), the agent can complete at most 5 levels in 25 iterations. But each recovery costs 1-2 extra iterations, so 3-4 levels is the practical maximum.
3. **New mechanics on Level 3+:** Later levels may introduce mechanics not seen on Levels 1-2 (different entity sizes, obstacles that move, keys that must be collected in sequence, etc.).
