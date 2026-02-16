# ARC-3 Delegation Experiment: v0.6.0 Analysis and v0.7.0 Recommendations

**Date:** 2026-02-15
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6
**Run:** run-013 (v0.6.0)
**Prior runs:** run-008 (v0.1.0), run-009 (v0.2.0), run-010 (v0.3.0), run-011 (v0.4.0), run-012 (v0.5.0)

---

## 1. Executive Summary

v0.6.0 introduced BFS pathfinding, mandatory Level 2+ delegation, and blocked-move detection -- the three CRITICAL/HIGH recommendations from the v0.5.0 analysis. The result was mixed: **Level 1 performance was best-ever** (18 actions, 4 iterations, deliberate completion with BFS-guided navigation), but **Level 2 failed after 125 actions across 21 iterations** despite having the algorithmic tools to succeed.

The v0.5.0 prediction that "BFS + delegation will solve Level 2 navigation but expose a new failure mode" was half right. BFS was implemented and functional -- it computed valid paths and the agent followed them. Delegation was implemented and obeyed -- the agent spawned an L2 re-scout immediately after Level 1 completion. Yet Level 2 was not completed. The failure was not in the algorithm or the delegation, but in **execution fidelity**: the BFS implementation had two critical bugs, and the agent lacked the recovery patterns to handle level-transition state changes.

Final score: **14.3% (1/7 levels)**, identical to v0.5.0. Total actions: 143. Cost: $2.77. The return guard fired reliably at iteration 25.

---

## 2. Detailed Level 2 Failure Analysis (All 26 Iterations)

### Phase 1: Level 1 -- Textbook Execution (Iterations 1-4)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 1 | 4 (scout) | Game started. Delegated to arc3-scout. Scout used 4 actions, returned precise JSON: entity at r45-46/c39-43, marker at r32/c21, fuel at 76/84. |
| 2 | 7 | BFS computed 7-step path [3,3,3,3,1,1,1] from entity to marker. Executed successfully. Marker absorbed at step 7. Entity at r30-31/c19-23, fuel 62. |
| 3 | 0 | Post-absorption grid survey. Found rectangle at r9-15/c34-38 with color 0 border (60 pixels appeared). No game actions consumed. |
| 4 | 7 | BFS computed 7-step path [1,4,4,4,1,1,1] to rectangle interior at r10/c34. Executed. **Level 1 completed at step 7** (18 total actions). Fuel at 50. |

**L1 assessment:** Near-perfect. 18 actions, 4 iterations, 2 delegations (1 scout + 0 re-scout). BFS found and executed optimal paths. The only improvement would be pre-computing the rectangle path before marker absorption (saving 1 iteration for the survey).

### Phase 2: Level 2 Re-Scout (Iteration 5)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 5 | 0 (scout) | Mandatory re-scout delegation obeyed. Scout returned JSON: entity at r10-11/c34-38, marker at r32-33/c20-21. **CRITICAL PROBLEM:** Scout used 0 game actions (observe-only), which means it reported the pre-transition grid state. The entity position (r10-11/c34-38) is the Level 1 completion position, not the Level 2 starting position. The scout did not detect that the maze had already changed. |

**Scout failure mode:** The re-scout observed the frame immediately after Level 1 completion. The game server had already transitioned to Level 2's maze, but the entity was still at the Level 1 completion position (r10-11/c34-38). The scout reported this position as the "current" position without verifying whether the entity could actually move from there in the new maze. The marker position reported (r32-33/c20-21) was also stale -- the actual Level 2 marker was at r47/c51.

### Phase 3: Stale-Grid BFS (Iteration 6-7) -- THE CRITICAL FAILURE

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 6 | 0 | BFS computed 7-step path [2,2,2,3,3,2,3] from r10/c34 to r32/c21 (the **stale** marker position). Both standard and color-5-expanded walkable sets produced the same path. |
| 7 | 7 | **CATASTROPHIC:** Executed the 7-step path from iteration 6. But the maze had changed. Entity was actually at r40-41/c29-33 (teleported during level transition). All 7 moves were **blocked** -- entity stayed at r40-41/c29-33 for every step. Fuel dropped from 50 to 86 (refueled during transition, then -14 from 7 wasted moves). The real marker was at r47/c51, not r32/c21. |

**Root cause analysis:** The BFS at iteration 6 ran on the grid observed at iteration 5. But between Level 1 completion (iteration 4) and the BFS computation (iteration 6), the game transitioned to Level 2 with a completely different maze. The BFS computed a path through Level 1's corridors on Level 2's grid. The entity had been teleported to r40-41/c29-33 (the Level 2 spawn point), but the scout reported the old position. Every step of the path was invalid.

**Actions wasted:** 7 (14 fuel). This single failure consumed 100% of the scout's value and set the agent back by 2 iterations of recovery.

### Phase 4: Recovery and Marker Navigation (Iterations 8-9)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 8 | 2 | Agent recognized the entity was stuck. Re-scanned the grid from scratch. Found entity at r40-41/c29-33, marker at r47/c51. BFS found 17-step path. Tested UP (worked: r40->r35) and RIGHT (worked: c29->c34). Agent now knows it can move. Fuel at 82. |
| 9 | 15 | Fresh BFS from r35/c34 to marker at r47/c51: 15 steps [1,1,1,1,1,4,4,2,4,2,2,2,2,2,2]. Executed successfully. Marker absorbed at step 15. Entity at r45-46/c49-53. Fuel at 52. Actions total: 42. |

**Assessment:** Good recovery. The agent re-computed BFS on the actual grid and found a valid 15-step path. Navigation was clean with no blocked moves. But 15 steps is expensive -- the path went UP 5 steps to r10, RIGHT 2 steps to c44/c49, then DOWN 8 steps to r45. This long detour happened because the direct route (DOWN then RIGHT) was blocked by walls.

### Phase 5: Rectangle Navigation -- The Alignment Trap (Iterations 10-12)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 10 | 0 | Post-absorption grid scan. Found Rect1 at r39-45/c12-20 (color 5 border, color 9 interior). Rect2 at r54-62/c1-10. Marker absorbed (no colors 0/1). |
| 11 | 18+ | BFS to Rect1 interior (r41,c14): 20 steps. BFS to Rect2: **NO PATH**. Started executing 20-step path. Got to step 18 (entity at r30-31/c14-18, fuel 16) then **TypeError: Cannot read properties of null (reading 'rMin')**. Entity disappeared. |
| 12 | 0 | Grid is ALL color 11 (4096 pixels = entire 64x64 grid is fuel). Entity NOT FOUND. This was the "all-fuel transition frame" -- a special state where the grid temporarily becomes entirely fuel before resetting. |

**BFS goal matching bug exposed:** The BFS function uses `Math.abs(nr - goalR) <= STEP && Math.abs(nc - goalC) <= STEP` (where STEP=5) as its goal check. This means the BFS terminates when the entity is *within 5 pixels* of the goal -- not AT the goal. For a target of r41/c14, the BFS could terminate at r36/c14 or r41/c19 and call it "arrived." This is why the 20-step path ended at r30-31/c14-18 rather than at the actual rectangle interior at r41/c14.

**Entity disappearance:** At step 18, the entity was at r30-31/c14-18, still 10 rows above Rect1 (r39-45). The next step (DOWN from r30 to r35) likely triggered a portal or the all-fuel transition. The `getEntityPosition(result.frame[0], 12)` returned null because the entity was gone, causing the TypeError.

### Phase 6: Recovery from All-Fuel Frame (Iteration 13)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 13 | 4 | After UP action, normal maze reappeared. Fuel refilled to 98. Entity at r35-36/c29-33. Marker respawned (colors 0/1 returned). Tried LEFT (entity moved to r35-36/c29-33 -> hmm, or was that r35-36/c24-28?) and RIGHT. |

**Key observation:** The all-fuel frame was a transition state. Any action "unpaused" the game and restored the normal maze. Fuel was refilled to 98 (full refuel). But the marker had respawned -- the previous absorption was reset. The agent now had to re-absorb the marker AND navigate to the rectangle.

### Phase 7: Second Marker Absorption (Iteration 14)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 14 | 15 | BFS from r35/c34 to marker at r47/c51: 15 steps. Executed successfully. Marker absorbed at step 15. Entity at r45-46/c49-53. Fuel at 52 (same as first time). |

**Pattern repeat:** Identical to iteration 9. The agent successfully navigated to the marker a second time. But now it faces the same rectangle-entry problem with less time (11 iterations remaining vs 16 before).

### Phase 8: Second Rectangle Attempt -- The Stuck Loop (Iterations 15-24)

| Iter | Actions Used | What Happened |
|------|-------------|---------------|
| 15 | 20 | BFS to Rect1 (r41,c14): 20 steps. Executed but **ended at r35-36/c14-18** due to loose goal matching. Entity is now 4 rows above Rect1 with walls preventing direct DOWN entry. |
| 16 | 3+ | Entity at r35-36/c14-18. Tried DOWN -- **BLOCKED** (r37 c18 = wall, color 4). Entity footprint is 2x5 at c14-18, but wall pixel at c18 prevents downward movement. |
| 17 | 6+ | Tried UP/LEFT/DOWN combinations. LEFT blocked (c9-13 are all walls). DOWN from r30 still blocked at r35. Entity stuck in a corridor dead-end. |
| 18 | 0 | Reachability analysis: computed 59 reachable positions from current. Rect2 confirmed unreachable. r40-41/c14-18 listed as reachable but direct DOWN from r35 is blocked. |
| 19 | 2+ | BFS found 1-step path from r35 to r40: [DOWN]. But executing it left entity at r35-36 (blocked!). BFS said valid but actual movement was blocked. The BFS walkable check passed because the destination pixels were walkable, but the game's collision model rejected the move for reasons the BFS didn't account for. |
| 20 | 2+ | Testing all moves. LEFT caused **portal** (entity disappeared, fuel=4096 -- all-fuel frame again). RIGHT caused **teleport** from c14 to c34 + fuel refill to 98. |
| 21 | varies | BFS to marker from r40/c29: NO PATH. Actions: 113+. |
| 22-24 | varies | More attempts, all failing. Marker may have respawned again. Agent cycling between positions without progress. |
| 25 | 0 | Return guard fired at `__iter >= 25`. Score returned: 14.3% (1/7 levels, 143 total actions). |
| 26 | 0 | Final return confirmation. |

### Iteration Summary Table

| Phase | Iterations | Actions | Outcome |
|-------|-----------|---------|---------|
| L1 Scout | 1 | 4 | Good scout report |
| L1 Navigate to marker | 2 | 7 | Marker absorbed |
| L1 Navigate to rectangle | 3-4 | 7 | **Level 1 completed** |
| L2 Re-scout | 5 | 0 | Scout reported stale positions |
| L2 Stale BFS | 6-7 | 7 | All 7 moves blocked (stale grid) |
| L2 Recovery | 8 | 2 | Found actual position |
| L2 Marker absorption (1st) | 9 | 15 | Marker absorbed |
| L2 Rectangle attempt (1st) | 10-12 | 18 | Entity disappeared at step 18, all-fuel frame |
| L2 Recovery from all-fuel | 13 | 4 | Normal maze restored, fuel refilled, marker respawned |
| L2 Marker absorption (2nd) | 14 | 15 | Marker absorbed again |
| L2 Rectangle attempt (2nd) | 15-19 | 30+ | Entity stuck at r35/c14 due to alignment problem |
| L2 Portal/teleport attempts | 20-24 | 20+ | Portals, teleports, no progress |
| Return | 25-26 | 0 | Score returned |
| **Total** | **26** | **143** | **1/7 levels = 14.3%** |

---

## 3. Delegation Effectiveness

### L1 Delegation: Excellent

The initial scout (iteration 1) consumed 4 game actions and returned a precise, actionable report:
- Entity position: r45-46/c39-43 (exact, correct)
- Marker position: r32/c21 (exact, correct)
- Fuel state: 76/84 (exact, correct)
- Movement semantics: 5px steps, 2x5 entity footprint (correct)
- Recommended route: UP 3x, LEFT 4x (correct)

The parent used this report to compute a 7-step BFS path and execute it without any wasted moves. **Scout ROI: 4 actions invested, 0 blocked moves saved (baseline was already efficient for L1).**

### L2 Delegation: Structurally Sound, Informationally Stale

The L2 re-scout (iteration 5) was correctly triggered (mandatory delegation obeyed). However:

1. **Zero actions used:** The scout called `arc3.observe()` and returned immediately without any `arc3.step()` calls. This meant it reported the pre-transition state.

2. **Stale entity position:** Reported r10-11/c34-38 (Level 1 completion position). Actual L2 position was r40-41/c29-33.

3. **Stale marker position:** Reported r32-33/c20-21 (Level 1 marker area). Actual L2 marker was at r47/c51.

4. **No maze validation:** The scout did not verify that the corridors it reported were actually traversable from the entity's position.

**Delegation compliance score: 10/10 (obeyed the rule). Delegation value score: 2/10 (report was actively harmful -- the parent trusted stale positions and wasted 7 actions on an invalid path).**

### Delegation vs Self-Navigation Comparison

| Metric | v0.5.0 (No Delegation) | v0.6.0 (Delegation) |
|--------|----------------------|---------------------|
| L2 delegation called | No | Yes |
| L2 scout actions | 0 | 0 |
| L2 useful information from scout | N/A | Stale (harmful) |
| L2 actions wasted before first real move | 0 | 7 (stale BFS) |
| L2 blocked moves total | ~50 | ~15 |
| L2 marker absorptions | 2 | 2 |
| L2 rectangle entries | 0 | 0 |
| L2 outcome | 0 levels | 0 levels |

The delegation infrastructure worked correctly (the scout was called, it returned, the parent received the report). But the scout's zero-action mode produced stale data that was worse than having no data at all. In v0.5.0, the parent at least observed the actual grid before navigating.

---

## 4. BFS Analysis

### 4.1 Did BFS Find Paths?

| Context | BFS Result | Correct? |
|---------|-----------|----------|
| L1: Entity to marker | 7 steps [3,3,3,3,1,1,1] | Yes -- executed successfully |
| L1: Entity to rectangle | 7 steps [1,4,4,4,1,1,1] | Yes -- executed, level completed |
| L2: Stale grid to stale marker | 7 steps [2,2,2,3,3,2,3] | **No** -- computed on wrong grid |
| L2: Entity (actual) to marker | 15 steps | Yes -- executed successfully |
| L2: Entity to Rect1 (r41,c14) | 20 steps | Partially -- path terminated early due to goal matching |
| L2: Entity to Rect2 (r57,c4) | NO PATH | Correct -- Rect2 was genuinely unreachable |
| L2: Entity to Rect1 (2nd attempt) | 20 steps | Same bug -- terminated at r35/c14 |
| L2: r35 to r40 (1 step) | 1 step [DOWN] | **Wrong** -- BFS said valid, move was blocked |
| L2: r40/c29 to marker | NO PATH | Unclear if correct or walkable set too restrictive |

### 4.2 Was the Walkable Set Correct?

The `getWalkable()` function returns `new Set([3, 12, 11, 0, 1, 9])`. Analysis:

- **Color 3 (path):** Correct.
- **Color 12 (entity):** Correct -- entity standing on itself.
- **Color 11 (fuel):** Correct -- entity can traverse fuel pixels.
- **Color 0 (marker border/post-absorption):** Partially correct. Color 0 appears as rectangle borders after marker absorption. Walking through these is necessary for rectangle entry, but the BFS doesn't distinguish between "walkable through" and "triggers level completion."
- **Color 1 (marker):** Correct for marker absorption.
- **Color 9 (pattern):** Correct -- these are inside rectangles and are traversable.
- **Color 5 (rectangle border) -- NOT INCLUDED in default set:** This is the critical omission for rectangle entry. The agent sometimes adds 5 to an expanded walkable set, but the default `getWalkable()` excludes it. Since rectangle borders are color 5, the BFS cannot plan a path that crosses through the border into the rectangle interior.
- **Color 4 (wall) -- correctly excluded:** Walls are impassable.
- **Color 8 (decoration) -- excluded:** These small clusters (8-12 pixels) appear to be decorative. Including them might help if the entity needs to cross over them, but this was not tested.

**Verdict:** The walkable set is approximately correct for corridor navigation but insufficient for rectangle entry. The inconsistency between `getWalkable()` (no color 5) and the expanded sets used ad-hoc (with color 5) means the BFS gives different answers depending on which set the agent chooses.

### 4.3 BFS Goal Matching Bug

This is the root cause of the L2 failure. The BFS uses:

```javascript
const atGoal = Math.abs(nr - goalR) <= STEP && Math.abs(nc - goalC) <= STEP;
```

Where `STEP = 5`. This means the BFS considers any position within a 10x10 pixel area around the goal as "arrived." For a goal of r41/c14:
- r36/c14 matches (|36-41| = 5 <= 5, |14-14| = 0 <= 5) -- 5 rows too high
- r41/c19 matches (|41-41| = 0 <= 5, |19-14| = 5 <= 5) -- 5 cols too far right
- r46/c9 matches -- completely outside the rectangle

The BFS terminates at the *first* position that satisfies this loose check, which is often the wrong one. On the 20-step path to r41/c14, the BFS terminated at approximately r35/c14 -- leaving the entity 4-9 rows above the rectangle, unable to enter it directly because walls blocked the final approach.

**The fix is trivial:** Change the goal check to exact match:

```javascript
const atGoal = nr === goalR && nc === goalC;
```

Or, for the entity's 5-pixel grid alignment:

```javascript
const atGoal = Math.abs(nr - goalR) < 3 && Math.abs(nc - goalC) < 3;
```

### 4.4 BFS Validity vs Game Collision

At iteration 19, BFS computed a 1-step path [DOWN] from r35 to r40. The BFS `isValid()` check passed: all pixels in the 2x5 footprint at r40-41/c14-18 were walkable colors. But the actual game move was blocked.

Possible explanations:
1. The game's collision model uses a different footprint than the BFS assumes (e.g., the entity checks pixels at r40-41/c14-18 but also some pixels in between, like r37/c18 which is wall).
2. The game may check intermediate positions during the 5-pixel move, not just the destination.
3. Color 5 (rectangle border) at r39/c14-18 may block passage even though the *destination* r40/c14-18 is valid.

This suggests the BFS needs to validate not just the destination footprint but also the path between the current position and the destination (all intermediate rows/cols during the 5-pixel step).

---

## 5. What v0.6.0 Got Right vs Wrong

### 5.1 What v0.6.0 Got Right

**1. Delegation compliance (10/10).** The agent obeyed the mandatory delegation rule for Level 2. This is a significant behavioral improvement over v0.5.0, which never delegated despite having the infrastructure.

**2. BFS infrastructure present and functional.** The BFS code was correctly implemented for corridor navigation. It found optimal paths for L1 (7 steps to marker, 7 steps to rectangle) and for L2 marker navigation (15 steps). The algorithm itself works -- the bug is in the goal-matching threshold, not the search logic.

**3. Return guard reliable.** Third consecutive version with successful return. Fired at iteration 25, produced valid score JSON. No timeout.

**4. Level 1 best-ever efficiency.** 18 actions, 4 iterations. Better than v0.5.0's 16 actions in 9 iterations (fewer iterations is better -- each iteration costs LLM tokens). The BFS-guided approach eliminated all trial-and-error from L1 navigation.

**5. Variable persistence workaround stable.** No lost-variable failures. Helpers redefined each iteration. Scout report logged to console and read from history.

**6. Blocked-move detection present.** The agent checked for blocked moves during path execution and logged them. This prevented infinite loops on individual moves (though it didn't prevent the broader pattern of repeating failed strategies).

### 5.2 What v0.6.0 Got Wrong

**1. BFS goal matching too loose (CRITICAL).** The `Math.abs(nr - goalR) <= STEP` threshold terminated paths up to 5 pixels away from the target. This is the single highest-impact bug in v0.6.0. It caused the 20-step path to Rect1 to end at r35/c14 instead of r41/c14.

**2. Stale grid BFS execution (CRITICAL).** The agent computed a BFS path on the pre-transition grid and executed it post-transition without re-observing. This wasted 7 actions and 14 fuel. The plugin says "re-scout on level completion" but doesn't say "always re-observe the grid before executing a BFS path."

**3. Scout reported stale data (HIGH).** The L2 scout used 0 actions (observe-only) and returned the Level 1 completion position as the "current" position. The re-scout prompt says "Do NOT call arc3.start()" but doesn't say "call arc3.step() at least once to verify the maze has changed."

**4. No intermediate validation during BFS execution (HIGH).** The BFS computes a path assuming the grid is static. But the grid changes when the marker is absorbed (borders change color, new colors appear). The agent should re-verify the grid after key events (marker absorption, level completion) rather than blindly executing a pre-computed path.

**5. Rectangle entry strategy undefined (HIGH).** The plugin says to "enter the target rectangle" but doesn't specify how. On Level 1, entering from above via c34-38 worked. On Level 2, the rectangle was at r39-45/c12-20, and the entity couldn't enter from the side or below due to walls. The plugin needs explicit guidance on rectangle entry: try all 4 approach directions, validate each with BFS, test which one actually allows entry.

**6. All-fuel transition frame not handled (MEDIUM).** When the grid becomes entirely color 11 (4096 pixels), the agent wastes an iteration diagnosing this state. The fix is simple: if `countColor(grid, 11) > 200`, the grid is in a transition state; execute any action to proceed.

**7. Portal/teleport recovery incomplete (MEDIUM).** The agent detected teleports after single moves but didn't handle the broader case of multi-step sequences triggering portals (e.g., LEFT from c14 caused the all-fuel frame at iteration 20).

---

## 6. Bottleneck Progression

### v0.1.0 through v0.6.0

```
v0.1.0  Resource ---------> fix scout efficiency
v0.2.0  Cognitive --------> fix iteration budget
v0.3.0  Protocol ---------> fix return() guard
v0.4.0  Domain Knowledge -> fix level completion docs
v0.5.0  Algorithmic ------> fix pathfinding algorithm
v0.6.0  Execution Fidelity -> fix BFS implementation bugs   <-- WE ARE HERE
v0.7.0  ???  (predicted: Grid Alignment or Multi-Level Scaling)
```

### Analysis: Execution Fidelity

v0.6.0's bottleneck is a new category: **Execution Fidelity**. The algorithm was correct in principle (BFS finds shortest paths). The infrastructure was present (delegation, scout, helpers). But the *implementation details* were wrong:

1. Goal matching threshold too loose (5 pixels instead of exact)
2. Grid observation not refreshed before BFS execution
3. No intermediate position checking during movement
4. No validation that the destination is *actually* the rectangle interior

This is different from v0.5.0's "Algorithmic" bottleneck. v0.5.0 had no algorithm at all -- it navigated heuristically. v0.6.0 had the right algorithm but implemented it with bugs that produced incorrect results. The distinction matters because the fix is different: v0.5.0 needed a new capability (BFS), while v0.6.0 needs debugging of an existing capability.

### The Deeper Pattern

| Layer | Category | Nature of Fix | Effort |
|-------|----------|--------------|--------|
| 1 | Resource | Configuration (scout model) | Trivial |
| 2 | Cognitive | Configuration (iteration budget) | Trivial |
| 3 | Protocol | Prompt engineering (return guard) | Small |
| 4 | Domain Knowledge | Prompt engineering (level completion docs) | Small |
| 5 | Algorithmic | New code (BFS function) | Medium |
| 6 | Execution Fidelity | Bug fixes in existing code | Small-Medium |

The fixes are getting technically deeper but not necessarily harder. v0.6.0's bugs are classic off-by-one / threshold errors that are easy to fix once identified. The challenge is *identifying* them from the trajectory data -- which is what this analysis does.

---

## 7. Cross-Version Comparison Table (v0.1.0 through v0.6.0)

| Metric | v0.1.0 | v0.2.0 | v0.3.0 | v0.4.0 | v0.5.0 | **v0.6.0** | Trend |
|--------|--------|--------|--------|--------|--------|--------|-------|
| **Iteration budget** | 20 | 20 | 30 | 30 | 30 | **30** | Stable |
| **Scout model** | Flash | Sonnet | Sonnet | Sonnet | None | **Orchestrator** | Delegation restored |
| **Scout actions (L1)** | 42 | 7 | 6 | 4 | 0 | **4** | Efficient |
| **Scout actions (L2)** | -- | -- | -- | -- | 0 | **0** | Stale report |
| **Delegations** | 2 | 1 | 1 | 2 | 0 | **2** | Restored |
| **Levels completed** | 0 | 1 | 1 | 0 | 1 | **1** | Plateau |
| **L1 deliberate?** | -- | No | No | -- | Yes | **Yes** | Stable |
| **L1 actions** | -- | ~24 | ~33 | -- | 16 | **18** | Best-tier |
| **L1 iterations** | -- | 13 | 17 | -- | 9 | **4** | **Best ever** |
| **L2 attempted?** | No | Yes | Yes | No | Yes | **Yes** | -- |
| **L2 actions** | -- | ~22 | ~28 | -- | 106 | **125** | Worst (stale BFS + alignment) |
| **L2 marker absorbed?** | -- | -- | -- | -- | Yes (2x) | **Yes (2x)** | Same |
| **L2 rectangle entered?** | -- | -- | -- | -- | No | **No** | Same |
| **BFS used?** | No | No | No | No | No | **Yes** | New |
| **BFS bugs** | -- | -- | -- | -- | -- | **2 critical** | New failure mode |
| **return() called** | No | No | No | Yes | Yes | **Yes** | Stable |
| **Score** | 0 | 0 | 0 | 0 | 14.3% | **14.3%** | Plateau |
| **Fuel at end** | 0 | 56 | 44 | 0 | 60 | ~20 | Lower (more actions used) |
| **Total actions** | ~85 | 46 | 61 | 45 | 122 | **143** | Highest ever |
| **Wall time** | 255s | 336s | 515s | 558s | 725s | ~800s | Increasing |
| **Cost** | $0.63 | $0.77 | $1.46 | $1.27 | $2.08 | **$2.77** | Increasing |
| **Failure mode** | Resource | Cognitive | Protocol | Domain | Algorithmic | **Execution Fidelity** | New each version |

---

## 8. v0.7.0 Recommendations

### 8.1 Fix BFS Goal Matching (Exact Match)

**Priority:** CRITICAL
**Effort:** Trivial (change 1 line)
**Impact:** Directly fixes the primary L2 failure. Paths will terminate at the actual goal instead of 5 pixels away.

**Change in `arc3-delegation-test.md` BFS function:**

```javascript
// BEFORE (v0.6.0 — terminates up to 5 pixels away):
const atGoal = Math.abs(nr - goalR) <= STEP && Math.abs(nc - goalC) <= STEP;

// AFTER (v0.7.0 — exact position match):
const atGoal = nr === goalR && nc === goalC;
```

Also update the BFS to allow the goal position even if `isValid()` fails (the entity entering a rectangle should trigger level completion regardless of walkability):

```javascript
// BEFORE:
if (!atGoal && !isValid(nr, nc)) continue;

// AFTER:
if (!isValid(nr, nc) && !atGoal) continue;
// (same logic, but make it explicit that atGoal overrides walkability)
```

### 8.2 Always Re-Observe Grid Before BFS Execution

**Priority:** CRITICAL
**Effort:** Small (add 3 lines to navigation sections)
**Impact:** Prevents the stale-grid BFS catastrophe. Would have saved 7 actions (14 fuel) on the L2 transition.

**Add to the navigation code template (Steps 2, 3, and the multi-level loop):**

```javascript
// CRITICAL: Always get FRESH grid data before BFS.
// The grid changes on level transitions, marker absorption, and other events.
// NEVER execute a BFS path computed on a previous iteration's grid.
const grid = arc3.observe().frame[0];  // FRESH observation
const pos = getEntityPosition(grid, 12);
if (!pos) {
  console.log("Entity NOT FOUND. Grid may be in transition state.");
  // Try one action to advance past transition frame
  await arc3.step(1);
  // Re-observe
  continue;
}
```

**Add rule to Critical Rules:**

```markdown
11. **Fresh grid before BFS.** NEVER execute a BFS path computed on a previous
    iteration's grid. Always call `arc3.observe()` immediately before `bfsPath()`
    and use that grid. Level transitions change the maze completely -- a path
    valid on the old grid will be 100% invalid on the new grid. In v0.6.0,
    executing a stale BFS path wasted 7 actions (14 fuel) with zero progress.
```

### 8.3 BFS Intermediate Position Validation

**Priority:** HIGH
**Effort:** Medium (modify BFS `isValid()` to check intermediate rows/columns)
**Impact:** Prevents BFS from returning paths that pass through walls during the 5-pixel step.

**Modified `isValid()` function:**

```javascript
function isValid(r, c, grid, walkable) {
  const EH = 2, EW = 5;
  if (r < 0 || r + EH > 64 || c < 0 || c + EW > 64) return false;
  for (let dr = 0; dr < EH; dr++)
    for (let dc = 0; dc < EW; dc++)
      if (!walkable.has(grid[r + dr][c + dc])) return false;
  return true;
}

// Check that the entity can actually traverse from (fromR, fromC) to (toR, toC)
// by verifying all intermediate positions along the 5-pixel step.
function canMove(fromR, fromC, toR, toC, grid, walkable) {
  const EH = 2, EW = 5;
  const dr = Math.sign(toR - fromR);
  const dc = Math.sign(toC - fromC);
  // Check each intermediate row/col
  let r = fromR, c = fromC;
  while (r !== toR || c !== toC) {
    if (dr !== 0) r += dr;
    if (dc !== 0) c += dc;
    if (!isValid(r, c, grid, walkable)) return false;
  }
  return true;
}
```

### 8.4 Scout Must Verify Post-Transition State

**Priority:** HIGH
**Effort:** Small (add 5 lines to scout re-scout instructions)
**Impact:** Prevents stale position reporting. Would have given the parent accurate L2 data.

**Change in `arc3-scout.md` Re-Scout Mode:**

```markdown
### Re-Scout Mode

**If the game has already been started** (e.g., you are re-scouting after a level transition):

1. **Do NOT call `arc3.start()`.** Call `arc3.observe()` first.
2. **VERIFY the maze has changed.** After a level transition, the entity teleports
   to a new position. Execute ONE `arc3.step(1)` (UP) action to:
   (a) Confirm the entity can move (it may be in a transition frame)
   (b) Get the entity's ACTUAL current position (not the Level N-1 completion position)
   (c) Force the grid to update if it's in an all-fuel transition state
3. **Re-observe after the verification step.** Use `arc3.observe()` to get the
   TRUE Level N grid, entity position, and marker position.
4. **Skip mechanic probing** -- the parent already knows entity/fuel/movement.
5. **Focus on mapping** with the verified grid data.
```

### 8.5 All-Fuel Transition Frame Handler

**Priority:** HIGH
**Effort:** Small (add handler to return guard)
**Impact:** Prevents wasting an iteration on the all-fuel state. Saves 1 iteration per occurrence.

**Add to the return guard, after the fuel check:**

```javascript
// Check 4: All-fuel transition frame (grid entirely color 11)
if (__fuel > 200) {
  console.log(`ALL-FUEL FRAME DETECTED (${__fuel}px). Executing action to advance...`);
  const advResult = await arc3.step(1); // Any action advances past the transition
  const advGrid = advResult.frame[0];
  const advFuel = (() => {
    let n = 0;
    for (let r = 0; r < 64; r++)
      for (let c = 0; c < 64; c++)
        if (advGrid[r][c] === 11) n++;
    return n;
  })();
  console.log(`After advance: fuel=${advFuel}, levels=${advResult.levels_completed}`);
  // Continue with normal execution using the updated grid
}
```

### 8.6 Rectangle Entry Strategy: Multi-Directional BFS

**Priority:** HIGH
**Effort:** Medium (add new helper function and strategy section)
**Impact:** Addresses the core L2 failure -- the agent couldn't figure out how to enter Rect1. On Level 1, entry was from above. On Level 2, the approach direction may differ.

**Add new helper function:**

```javascript
// === RECTANGLE ENTRY PLANNER ===
// Try BFS to multiple entry points around the rectangle.
// Returns the shortest path to any entry point, or null if none found.
function planRectangleEntry(grid, entityR, entityC, rectRMin, rectRMax, rectCMin, rectCMax, walkable) {
  const entryPoints = [];

  // Try entry from above (row just above rectangle top)
  for (let c = rectCMin; c <= rectCMax - 4; c += 5) {
    entryPoints.push({ r: rectRMin, c: c, dir: "above" });
  }
  // Try entry from below (row just below rectangle bottom)
  for (let c = rectCMin; c <= rectCMax - 4; c += 5) {
    entryPoints.push({ r: rectRMax - 1, c: c, dir: "below" });
  }
  // Try entry from left
  for (let r = rectRMin; r <= rectRMax - 1; r += 5) {
    entryPoints.push({ r: r, c: rectCMin, dir: "left" });
  }
  // Try entry from right
  for (let r = rectRMin; r <= rectRMax - 1; r += 5) {
    entryPoints.push({ r: r, c: rectCMax - 4, dir: "right" });
  }

  let bestPath = null;
  let bestEntry = null;
  for (const entry of entryPoints) {
    const path = bfsPath(grid, entityR, entityC, entry.r, entry.c, walkable);
    if (path && (!bestPath || path.length < bestPath.length)) {
      bestPath = path;
      bestEntry = entry;
    }
  }

  if (bestPath) {
    console.log(`Best entry: ${bestEntry.dir} at [${bestEntry.r},${bestEntry.c}], ${bestPath.length} steps`);
  }
  return bestPath;
}
```

**Add strategy guidance:**

```markdown
### Rectangle Entry Strategy

After marker absorption, do NOT BFS to the rectangle *center*. Instead:

1. Identify the rectangle bounding box (color 5 border).
2. Compute BFS paths to multiple entry points: top edge, bottom edge, left edge, right edge.
3. Choose the shortest path. If no path exists to any edge, the rectangle may be unreachable from the current position -- try the other rectangle.
4. Execute the path. If the entity enters the rectangle, the level should complete.
5. **CRITICAL:** If the level does NOT complete after entering the rectangle, you may be at the wrong rectangle. ARC-3 has two rectangles per level -- only one triggers completion.
```

### 8.7 Pre-Compute Rectangle Path Before Marker Absorption

**Priority:** MEDIUM
**Effort:** Small (restructure navigation flow)
**Impact:** Prevents the marker-respawn loop. In v0.6.0, the marker respawned twice because the agent absorbed it before having a confirmed path to the rectangle.

**Add to Strategy section:**

```markdown
### Navigation Flow (MANDATORY for Level 2+)

1. **Compute paths first, move second.** Before absorbing the marker:
   a. BFS from entity to marker (path A)
   b. BFS from marker position to rectangle entry (path B)
   c. If path B does not exist: do NOT absorb the marker. Find a different route.
   d. If path A + path B combined > 20 steps: consider fuel budget carefully.

2. **Absorb only when path B is confirmed.** The marker respawns after ~10
   actions post-absorption. If path B is 12 steps, you cannot reach the
   rectangle in time. Navigate closer to the rectangle first, THEN absorb.

3. **Execute paths A and B as one continuous sequence.** Do not stop for grid
   analysis between absorption and rectangle entry. Every action after
   absorption counts against the respawn timer.
```

### 8.8 Entity Position Verification After Every Level Transition

**Priority:** MEDIUM
**Effort:** Small (add check to Step 4)
**Impact:** Catches the stale-position problem earlier. The agent should verify where it actually is before planning.

**Add to Step 4 (Re-Scout):**

```javascript
// After level completion, FIRST verify entity position on the NEW grid
const freshGrid = arc3.observe().frame[0];
const freshPos = getEntityPosition(freshGrid, 12);
if (!freshPos) {
  console.log("Entity not found on fresh grid - may be in transition. Trying action...");
  const r = await arc3.step(1);
  const p = getEntityPosition(r.frame[0], 12);
  console.log("After action, entity at:", JSON.stringify(p));
}
console.log("VERIFIED entity position:", JSON.stringify(freshPos));
console.log("Grid has changed from Level N-1. DO NOT use any previously computed paths.");
```

### 8.9 BFS Walkable Set: Include Color 5 for Rectangle Entry

**Priority:** MEDIUM
**Effort:** Trivial (add one number to the set)
**Impact:** Allows BFS to plan paths through rectangle borders, which is required for level completion.

**Change `getWalkable()`:**

```javascript
function getWalkable() {
  // Colors the entity can walk through.
  // 3 = path, 12 = self, 11 = fuel, 0 = marker/activated border,
  // 1 = marker, 9 = rectangle interior pattern, 5 = rectangle border
  return new Set([3, 12, 11, 0, 1, 9, 5]);
}
```

**Note:** This changes the walkable set globally. If color 5 causes BFS to find paths through rectangle borders that are actually impassable (the game may not allow traversal), use the expanded set only for rectangle-entry BFS calls.

### Recommendation Summary

| # | Recommendation | Priority | Effort | Root Cause Addressed |
|---|---------------|----------|--------|---------------------|
| 1 | Fix BFS goal matching (exact match) | **CRITICAL** | Trivial | BFS terminating 5px from goal |
| 2 | Always re-observe grid before BFS | **CRITICAL** | Small | Stale-grid BFS (7 wasted actions) |
| 3 | BFS intermediate position validation | **HIGH** | Medium | BFS path through walls |
| 4 | Scout must verify post-transition state | **HIGH** | Small | Scout reported stale positions |
| 5 | All-fuel transition frame handler | **HIGH** | Small | Wasted iteration on transition state |
| 6 | Multi-directional rectangle entry BFS | **HIGH** | Medium | Entity couldn't enter rectangle |
| 7 | Pre-compute rect path before absorption | **MEDIUM** | Small | Marker respawn loop (absorbed 2x) |
| 8 | Entity position verification after transition | **MEDIUM** | Small | Stale position assumptions |
| 9 | Include color 5 in default walkable set | **MEDIUM** | Trivial | BFS can't plan through rect borders |

**If only two changes are made:** Recommendations #1 (BFS goal matching) and #2 (fresh grid before BFS). These address the two direct causes of L2 failure: the BFS terminating at the wrong position and the BFS executing on a stale grid. Together, they would have:
- Saved 7 stale-grid actions (iteration 7)
- Directed the 20-step path to the actual rectangle interior instead of r35/c14
- Potentially completed Level 2 on the first attempt (iterations 10-11)

---

## 9. Projected v0.7.0 Outcomes

### Scenario: Recommendations 1-9 Implemented

| Phase | Iterations | Actions | Notes |
|-------|-----------|---------|-------|
| **Level 1** | | | |
| L1: Scout | 1 | 4 | Same as v0.6.0 |
| L1: BFS to marker | 2 | 7 | Same as v0.6.0 |
| L1: BFS to rectangle | 3 | 7 | Same as v0.6.0 |
| **L1 subtotal** | **3** | **18** | **Same efficiency, fewer iterations** |
| **Level 2** | | | |
| L2: Re-scout (verified) | 4 | 1-2 | Scout verifies position (1 action) |
| L2: BFS to marker (fresh grid) | 5 | 15 | Same path, but on correct grid |
| L2: Pre-compute rect path | 5 | 0 | Free computation |
| L2: BFS to rectangle (exact goal) | 6 | 10-15 | Exact goal matching hits actual rectangle |
| **L2 subtotal** | **3-4** | **26-32** | **vs v0.6.0's 125 actions (0 completed)** |
| **Level 3** | | | |
| L3: Re-scout + BFS | 7-9 | 20-30 | Same pattern |
| **Level 4** (if reached) | | | |
| L4: Re-scout + BFS | 10-12 | 20-30 | Depends on new mechanics |
| **Return** | 1 | 0 | Iter 25 or game complete |

### Conservative (Recommendations 1-2 only)

- **Levels completed: 2** (L1 + L2)
- **Score: 28.6%** (2/7)
- **Total actions: ~60-80**
- **Improvement: +1 level, +14.3 percentage points**
- **Confidence: High.** The two fixes directly address the L2 failure chain. BFS goal matching was the single biggest bug; fresh-grid observation was the second. With both fixed, the L2 rectangle entry path would have terminated at the correct position.

### Moderate (Recommendations 1-7)

- **Levels completed: 3** (L1 + L2 + L3)
- **Score: 42.9%** (3/7)
- **Total actions: ~80-110**
- **Improvement: +2 levels, +28.6 percentage points**
- **Confidence: Medium.** Depends on Level 3's maze complexity and whether the rectangle entry strategy generalizes. The multi-directional entry BFS should handle most rectangle layouts, but unknown mechanics on Level 3 could introduce new failures.

### Optimistic (All recommendations, no new failure modes)

- **Levels completed: 4-5**
- **Score: 57-71%**
- **Total actions: ~100-140**
- **Improvement: +3-4 levels**
- **Confidence: Low.** Requires Levels 4-5 to not introduce fundamentally new mechanics. The iteration budget (25 usable) limits the number of levels: at ~3-4 iterations per level, 25 iterations supports 6-7 levels. But each failure/recovery costs 1-2 extra iterations, so 4-5 levels is realistic only if navigation is clean.

### Predicted New Failure Mode

With execution fidelity bugs fixed, the predicted v0.7.0 failure is **Grid Alignment**: the entity's 5-pixel step grid may not align with rectangle entry points. Rectangles are positioned at arbitrary pixel coordinates, but the entity can only occupy positions that are multiples of 5 (r=0,5,10,...,60; c=0,5,10,...,60). If a rectangle's entry point requires the entity to be at, say, r42/c17 (not multiples of 5), the entity literally cannot reach it. This would require discovering secondary mechanics (like portals that move the entity off-grid, or a different step size near rectangles).

---

## 10. Broader Lessons

### 10.1 The BFS Implementation Quality Matters More Than Having BFS

v0.5.0 had no BFS and scored 14.3%. v0.6.0 had BFS and scored 14.3%. The algorithm was not the bottleneck -- the implementation quality was. A BFS with a 5-pixel goal tolerance is functionally equivalent to "no BFS" for targets smaller than 5 pixels. This underscores that adding a capability is only half the job; testing the capability against edge cases is the other half.

### 10.2 Stale State Is the Enemy of Reactive Systems

The stale-grid BFS failure is a category error: the agent treated a reactive environment (the game changes on level transitions) as a static one (the grid is the same as last iteration). This is a general lesson for any agent operating in dynamic environments: **always re-observe before acting on cached state**. The cost of re-observation (zero game actions, one `arc3.observe()` call) is negligible compared to the cost of acting on stale data (7 wasted actions, 14 fuel).

### 10.3 Delegation Value Depends on Scout Quality, Not Scout Existence

v0.6.0 proved that delegation alone is not sufficient. The scout was called (compliance), but the scout's report was stale (quality). The parent trusted the scout and wasted actions. In v0.5.0, the parent navigated solo and wasted different actions. The net result was the same: 0 levels on L2.

The lesson: delegation instructions must include quality checks. "Delegate scouting" is not enough; the plugin must say "delegate scouting AND verify the scout's positions match the current grid before using them."

### 10.4 The Fix-One-Break-Another Pattern Holds

| Version | Fix Applied | New Problem Exposed |
|---------|-----------|-------------------|
| v0.2.0 | Better scout | Not enough iterations |
| v0.3.0 | More iterations | Never called return() |
| v0.4.0 | return() guard | Didn't know level completion |
| v0.5.0 | Level completion encoded | No pathfinding for complex mazes |
| v0.6.0 | BFS pathfinding + delegation | BFS implementation bugs |

v0.6.0 confirms the pattern continues. The BFS fix solved the algorithmic gap but introduced implementation-level bugs that produced the same outcome (0 levels on L2). The good news is that v0.7.0's fixes are smaller and more targeted than any previous version's -- they are bug fixes, not new capabilities. This suggests the system is converging: each layer of bugs is thinner than the last.

### 10.5 Score Plateau Is Not Failure Plateau

v0.5.0 and v0.6.0 both scored 14.3%, but they failed for entirely different reasons. v0.5.0 failed because it had no pathfinding algorithm. v0.6.0 failed because its pathfinding algorithm had a goal-matching bug. The score is the same, but the *distance to the next level* is much smaller in v0.6.0: fixing one line of code (the goal threshold) would likely have enabled Level 2 completion. In v0.5.0, the fix required adding a 40-line function and restructuring the entire navigation strategy.

This is why trajectory analysis matters more than score comparison. Two identical scores can represent very different positions on the progress curve.
