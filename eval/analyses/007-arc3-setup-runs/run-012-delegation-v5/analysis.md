# ARC-3 Delegation Experiment: v0.5.0 Analysis and v0.6.0 Recommendations

**Date:** 2026-02-15
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6
**Run:** run-012 (v0.5.0)
**Prior runs:** run-008 (v0.1.0), run-009 (v0.2.0), run-010 (v0.3.0), run-011 (v0.4.0)

---

## 1. Executive Summary

v0.5.0 is the most successful run in the delegation experiment series. For the first time in five versions, the agent **deliberately** completed a level -- understanding the mechanism (absorb marker, enter Rect 1 from above) and executing it intentionally, not accidentally. Level 1 was completed in 16 actions, the most efficient performance yet against a 29-action baseline (55% of baseline = 181% efficiency). The return guard continued to work reliably, producing the first nonzero score in the series: **14.3% (1/7 levels)**.

However, v0.5.0 exposed a new class of failure: **algorithmic pathfinding**. After completing Level 1, the agent spent 14 iterations and 106 actions attempting Level 2 using heuristic try-and-backtrack navigation, never reaching the target rectangle. The agent correctly identified the route (UP to r10, RIGHT to c49, DOWN to marker, absorb, LEFT to rect at c14-19) and executed the first half (marker absorption) twice, but could not navigate LEFT from c29-33 to the rectangle at c14-19 due to persistent wall barriers. Approximately 50 of the 106 Level 2 actions were blocked moves -- zero-progress fuel waste.

Most strikingly, the agent never delegated. The scout plugin exists and has proven effective in v0.1.0-v0.4.0 (scout action cost dropped from 42 to 4 across versions). Yet v0.5.0's parent handled everything solo. This worked for Level 1 (self-analysis was sufficient) but was catastrophic for Level 2 (a scout could have mapped corridors without burning parent fuel on blocked moves).

The bottleneck progression continues its one-layer-per-version peeling pattern:

| Version | Bottleneck Fixed | New Bottleneck Exposed | Category |
|---------|-----------------|----------------------|----------|
| v0.1.0 | (baseline) | Fuel depletion from bad scouts | Resource |
| v0.2.0 | Scout efficiency (42->7 actions) | Couldn't process L2 within iteration budget | Cognitive |
| v0.3.0 | Iteration budget (20->30) | Never called return() | Protocol |
| v0.4.0 | return() guard pattern | Didn't know level completion mechanism | Domain Knowledge |
| v0.5.0 | Level completion mechanism encoded | Heuristic navigation doesn't scale to complex mazes | **Algorithmic** |

**Implication for v0.6.0:** The next bottleneck is computational. The agent needs a BFS pathfinding algorithm, enforced delegation for Level 2+, and blocked-move detection. These are all plugin-only changes.

---

## 2. What v0.5.0 Got Right

### 2.1 First Deliberate Level Completion

This is the headline achievement. In v0.2.0 and v0.3.0, level completion was accidental -- the agent happened to navigate through Rect 1 while exploring. In v0.5.0, the agent explicitly followed the encoded mechanism: absorb marker at iter 4, navigate RIGHT to c34-38, then UP through the corridor into Rect 1 at iter 9. The trajectory log shows clear intentionality:

```
iter  4  EXTRACT:navigate  [H1]  ~  LEFT x4 to c19-23, UP x3 to r30-31; marker absorbed
iter  9  EXTRACT:navigate  [H1]  ** RIGHT to c34-38, UP x3 to r10-11; LEVEL 1 COMPLETED
```

The agent's H1 hypothesis ("Navigate entity to color 0/1 marker, then enter the rectangle to complete level") was formed and executed as a deliberate strategy, not discovered through trial and error. This validates the v0.4.0 analysis recommendation #1 (encode the level completion mechanism) as the correct intervention.

### 2.2 Best Level 1 Efficiency

| Version | L1 Actions | L1 Iterations | Deliberate? |
|---------|-----------|--------------|-------------|
| v0.1.0 | -- | -- | N/A (never completed) |
| v0.2.0 | ~24 | 13 | No (accidental) |
| v0.3.0 | ~33 | 17 | No (accidental) |
| v0.4.0 | -- | -- | N/A (never completed) |
| v0.5.0 | **16** | **9** | **Yes** |

16 actions is 55% of the 29-action baseline, meaning the agent found a route that was nearly twice as efficient as the baseline solver. This was achieved without delegation -- the parent's self-analysis (3 explore iterations to map the grid) was sufficient for Level 1's relatively simple corridor structure.

### 2.3 Return Guard Reliable

The return guard fired at iteration 25 (`__iter >= 25`), producing a valid scorecard:
```json
{"card_id":"f6972e91-...","score":14.285714285714286,"total_levels_completed":1,"total_actions":122}
```

This is the second consecutive version with a successful return (v0.4.0 was the first). The return guard pattern is now proven stable. The `error: null` in the trajectory metadata confirms the harness received a proper answer, not a timeout.

### 2.4 Variable Persistence Workaround Effective

v0.1.0-v0.4.0 all suffered from variable persistence loss (2 wasted iterations in v0.4.0). v0.5.0 showed no persistence-related failures in the trajectory. The helper redeclaration template and the console-printing workaround (both added in v0.5.0's plugin) appear to have worked. The agent defined helpers inline and read scout data from conversation history rather than relying on cross-iteration variables.

### 2.5 New Mechanic Discoveries

v0.5.0 discovered two mechanics not observed in prior versions:

1. **Fuel refueling:** Fuel jumped from 18->78 (iter 19) and 32->86 (iter 23). This suggests fuel pickup locations exist in the Level 2 maze. Prior versions never encountered refueling because they never survived long enough in Level 2.

2. **Teleport/portal mechanic:** The entity teleported from inside Rect 1 (r10-11, c34-38) to r35-36, c29-33 when moving UP at iter 11. At iter 19, the entity teleported when crossing boundary coordinates (r64->0 or c64->0). These wrapping/portal mechanics are new information that should be documented for v0.6.0.

---

## 3. What v0.5.0 Got Wrong

### 3.1 No Delegation for Level 2

This is the most consequential failure. The v0.5.0 plugin explicitly includes delegation instructions (Step 1: "Delegate Initial Scouting", Step 4: "On Level Completion -- Re-Scout"). The scout plugin (`arc3-scout`) has a dedicated re-scout mode. Yet the agent never spawned a single child in 25 iterations.

**What happened:** The agent completed Level 1 so efficiently (9 iterations) that it had 16 iterations remaining. It chose to self-navigate Level 2 rather than delegate. For Level 1's simple maze this worked. For Level 2's complex multi-barrier layout, it was catastrophic.

**The cost:** 106 actions on Level 2, approximately 50 of which were blocked moves (zero progress, 2 fuel each = 100 fuel wasted on walls). A scout delegation would have consumed ~5 actions and 1-2 iterations to map Level 2's corridor structure, potentially revealing that the direct LEFT route from c29-33 was impassable and identifying an alternate path.

**Why it happened:** The plugin says "delegate scouting" but does not say "you MUST delegate for Level 2+." The agent optimized locally -- it had already proven it could analyze the grid without delegation (iters 1-3 for Level 1). It generalized this to Level 2 without recognizing that Level 2's complexity exceeded what heuristic navigation could handle.

### 3.2 No BFS Pathfinding Algorithm

The agent navigated by heuristic: try a direction, if blocked try perpendicular, repeat. This is the `try-direction, backtrack-if-blocked` pattern visible throughout iters 14-24:

```
iter 14  try DOWN (blocked), RIGHT (to c34-38, blocked RIGHT further, blocked DOWN)
iter 19  LEFT x7 through corridors; entity teleports; reaches c29-33; BLOCKED LEFT
iter 20  DOWN to r40-41; BLOCKED LEFT
iter 21  DOWN (blocked), RIGHT (to c34-38, blocked)
iter 24  UP to r35-36; LEFT x5 BLOCKED; DOWN BLOCKED
```

On Level 1, the maze had a clear corridor structure that heuristic navigation could traverse. On Level 2, the maze had a wall barrier at c24-33 that blocked every LEFT attempt at rows 35-46. The agent never found the alternate route because heuristic navigation doesn't systematically explore -- it greedily tries the most direct direction and gives up when blocked.

A BFS pathfinding algorithm on the 64x64 grid would have computed the shortest path (or confirmed no path exists) in a single iteration, using zero game actions. The grid data is available from `arc3.observe()` for free. The pathfinding computation is pure JavaScript -- no game interaction needed.

### 3.3 Teleport/Portal Mechanic Not Understood

At iter 11, moving UP from inside Rect 1 (r10-11, c34-38) teleported the entity to r35-36, c29-33. This was unexpected and disorienting. The agent spent iter 12 re-mapping from the new position. At iter 19, boundary wrapping occurred (coordinates crossing 64->0).

The plugin does mention "Level transitions: when `levels_completed` increases, expect the entity to teleport to a new position." But it does not document the general portal/wrapping mechanic. The entity did not teleport because of a level transition at iter 11 -- it teleported because of a portal mechanic within the maze itself.

### 3.4 Marker Respawning Mechanic Not Documented

At iter 20, after the marker had been absorbed at iter 18, the markers respawned at their original positions. The agent absorbed the marker again at iter 22, but again could not reach the rectangle. The respawning mechanic is not mentioned in the v0.5.0 plugin. This suggests that absorption alone is not permanent -- the agent must reach the rectangle within some action window or the marker resets.

### 3.5 Fuel Refueling Locations Not Tracked

Fuel jumped from 18->78 at iter 19 and 32->86 at iter 23. These refueling events coincided with the entity passing through specific locations. The agent noted the refueling but never mapped the fuel pickup positions. In a fuel-constrained game, knowing where to refuel is strategically critical -- the agent could plan routes through refueling stations.

---

## 4. The Bottleneck Progression

Five versions of the delegation experiment have now been run. Each version solved the previous version's primary bottleneck, only to expose the next layer:

### v0.1.0: Resource Depletion
**Bottleneck:** Flash scout burned 42 actions (84 fuel) exploring without discipline. Parent had no fuel remaining to navigate.
**Category:** Resource management.
**Fixed by v0.2.0:** Upgraded scout to Sonnet, reduced scout actions to 7.

### v0.2.0: Cognitive Overload
**Bottleneck:** Level 1 completed accidentally at iter 13, but the agent couldn't understand Level 2's changed maze within 7 remaining iterations (20 budget - 13 used).
**Category:** Cognitive -- the agent needed more iterations to process the maze change.
**Fixed by v0.3.0:** Increased iteration budget from 20 to 30. Added re-scouting capability.

### v0.3.0: Protocol Failure
**Bottleneck:** Agent navigated into a dead-end on Level 2, spent remaining iterations stuck, and never called `return()`. Result: max-iterations timeout, score 0 despite completing Level 1.
**Category:** Protocol compliance -- the agent didn't know it was supposed to return a result.
**Fixed by v0.4.0:** Mandatory `return()` guard pattern at the top of every code block.

### v0.4.0: Domain Knowledge Gap
**Bottleneck:** Agent called `return()` (breakthrough) but completed 0 levels (regression). It absorbed the marker but never entered Rect 1 from above -- it didn't know the level completion mechanism. v0.2.0 and v0.3.0 completed Level 1 accidentally; v0.4.0 took a different exploration path and missed the trigger entirely.
**Category:** Domain knowledge -- the agent needed explicit instruction on what triggers level completion.
**Fixed by v0.5.0:** Encoded the level completion mechanism in the plugin: "absorb marker, then navigate UP through c34-38 corridor to enter Rect 1."

### v0.5.0: Algorithmic Limitation
**Bottleneck:** Level 1 completed deliberately and efficiently (16 actions, best ever). Level 2 failed after 106 actions of heuristic try-and-backtrack navigation. The agent correctly identified the route conceptually but couldn't execute it because walls blocked the direct path, and the agent had no systematic method to find an alternate route.
**Category:** Algorithmic -- heuristic navigation doesn't scale to complex mazes. The agent needs BFS/DFS pathfinding.
**To be fixed by v0.6.0:** See Section 5.

### The Pattern

```
v0.1.0  Resource ---------> fix scout efficiency
v0.2.0  Cognitive --------> fix iteration budget
v0.3.0  Protocol ---------> fix return() guard
v0.4.0  Domain Knowledge -> fix level completion docs
v0.5.0  Algorithmic ------> fix pathfinding algorithm    <-- WE ARE HERE
v0.6.0  ???  (predicted: multi-level scaling or maze-variant generalization)
```

Each layer is a different class of problem. The early layers (resource, cognitive, protocol) were addressed by configuration changes and simple additions. The later layers (domain knowledge, algorithmic) require deeper changes to the agent's strategy and tooling. The predicted v0.6.0 failure mode is either multi-level scaling (can the agent repeat the pattern for 7 levels?) or maze-variant generalization (do Level 3+ mazes have new mechanics like locked doors, keys, or multi-step triggers?).

---

## 5. v0.6.0 Recommendations

### 5.1 BFS Pathfinding Utility Function

**Priority:** CRITICAL
**Effort:** Medium (add ~40 lines of JavaScript to the plugin helper template)
**Expected impact:** Eliminates the primary v0.5.0 failure. BFS would compute the shortest path from entity to marker (or entity to rectangle) on the 64x64 grid using only `arc3.observe()` data (zero game actions). Would have saved ~50 blocked moves and revealed whether the LEFT route from c29-33 was truly impassable.

**Plugin change -- add to the helper template in `arc3-delegation-test.md`:**

```javascript
// === BFS PATHFINDING (redefine each iteration) ===
// Finds shortest path on the 64x64 grid for a 2x5-pixel entity moving in 5-pixel steps.
// walkableColors: set of colors the entity can move through (typically {3} for path color)
// Returns array of actions [1=UP, 2=DOWN, 3=LEFT, 4=RIGHT] or null if no path exists.
function bfsPath(grid, startR, startC, goalR, goalC, walkableColors) {
  // Entity is 2 rows x 5 cols, moves in 5-pixel steps.
  // A position (r, c) means entity occupies rows [r, r+1] x cols [c, c+4].
  // A position is valid if ALL pixels in the entity's footprint are walkable.
  const STEP = 5;
  const ENTITY_H = 2;
  const ENTITY_W = 5;

  function isValid(r, c) {
    if (r < 0 || r + ENTITY_H > 64 || c < 0 || c + ENTITY_W > 64) return false;
    for (let dr = 0; dr < ENTITY_H; dr++)
      for (let dc = 0; dc < ENTITY_W; dc++)
        if (!walkableColors.has(grid[r + dr][c + dc])) return false;
    return true;
  }

  // Also treat the entity's current position and the goal as valid
  // (entity may be standing on its own color or on a special tile)
  const startKey = `${startR},${startC}`;
  const goalKey = `${goalR},${goalC}`;

  const visited = new Set();
  visited.add(startKey);
  const queue = [{ r: startR, c: startC, path: [] }];

  // Directions: [action, deltaRow, deltaCol]
  const dirs = [
    [1, -STEP, 0],   // UP
    [2, STEP, 0],    // DOWN
    [3, 0, -STEP],   // LEFT
    [4, 0, STEP],    // RIGHT
  ];

  while (queue.length > 0) {
    const { r, c, path } = queue.shift();

    for (const [action, dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;

      if (visited.has(key)) continue;

      // Allow goal position even if not all pixels are walkable
      // (entity entering the rectangle triggers level completion)
      const atGoal = Math.abs(nr - goalR) < STEP && Math.abs(nc - goalC) < STEP;

      if (!atGoal && !isValid(nr, nc)) continue;

      visited.add(key);
      const newPath = [...path, action];

      if (atGoal) return newPath;

      queue.push({ r: nr, c: nc, path: newPath });
    }
  }

  return null; // No path exists
}

function walkableSet(grid) {
  // Colors that the entity can walk through.
  // 3 = path, 12 = entity itself, 11 = fuel, 0/1 = marker/rect borders
  return new Set([3, 12, 11, 0, 1, 9]);
}
// === END BFS PATHFINDING ===
```

**Add navigation guidance to the Strategy section:**

```markdown
### Using BFS Pathfinding

Before moving, ALWAYS compute the shortest path:

1. Get current grid: `const grid = arc3.observe().frame[0]`
2. Get entity position: `const pos = getEntityPosition(grid, 12)`
3. Get target position (marker or rectangle entry point)
4. Compute path: `const path = bfsPath(grid, pos.rMin, pos.cMin, targetR, targetC, walkableSet(grid))`
5. If `path === null`: there is NO navigable route. Do NOT try heuristic navigation.
   Instead, re-scout or try a different approach.
6. If path exists: execute the actions in order, checking position after each step.

This replaces the heuristic try-and-backtrack approach that failed on Level 2.
```

### 5.2 Enforce Level 2+ Delegation

**Priority:** CRITICAL
**Effort:** Small (add ~10 lines of prose to the plugin)
**Expected impact:** A scout mapping Level 2 would consume ~5 actions and 1-2 iterations. In v0.5.0, the parent burned 106 actions on Level 2 self-navigation. Even accounting for imperfect scouting, delegation would save 50+ actions and identify impassable routes before the parent wastes fuel on them.

**Plugin change -- add to Critical Rules in `arc3-delegation-test.md`:**

```markdown
8. **MANDATORY delegation for Level 2+.** After completing Level 1, you MUST
   delegate scouting to the `arc3-scout` child (Step 4) before navigating
   Level 2. Do NOT attempt to self-navigate a new level. The maze layout
   changes completely on level transitions, and heuristic navigation wastes
   too many actions on unknown corridors. The scout can map the new layout
   in ~5 actions. You can self-navigate Level 1 (simple maze), but Level 2+
   requires a scout report + BFS pathfinding before any movement.
```

**Also add to the Step 4 re-scout section:**

```markdown
**THIS STEP IS NOT OPTIONAL.** When `levels_completed` increases, you MUST
execute Step 4 before attempting any navigation. In v0.5.0, skipping delegation
on Level 2 resulted in 106 wasted actions and 0 progress. The scout plugin
has a re-scout mode that uses at most 5 game actions.
```

### 5.3 Blocked-Move Detection and Strategy Switching

**Priority:** HIGH
**Effort:** Small (add ~15 lines of JavaScript to the navigation loop)
**Expected impact:** In v0.5.0, approximately 50 blocked moves occurred on Level 2. With a blocked-move threshold, the agent would have abandoned the LEFT route from c29-33 after 5-6 failures and switched to BFS pathfinding or a delegation. This alone could save 40+ actions.

**Plugin change -- add to the navigation code template in `arc3-delegation-test.md`:**

```javascript
// === BLOCKED-MOVE DETECTOR (add to navigation loops) ===
let blockedCount = 0;
const BLOCKED_THRESHOLD = 5;

// Inside the navigation loop, after checking if position changed:
if (newPos.rMid === pos.rMid && newPos.cMid === pos.cMid) {
  blockedCount++;
  console.log(`BLOCKED (${blockedCount}/${BLOCKED_THRESHOLD})`);
  if (blockedCount >= BLOCKED_THRESHOLD) {
    console.log("TOO MANY BLOCKED MOVES. Abandoning heuristic navigation.");
    console.log("Switching to BFS pathfinding or re-scouting.");
    // Option A: Compute BFS path from current position
    const grid = arc3.observe().frame[0];
    const path = bfsPath(grid, pos.rMin, pos.cMin, targetR, targetC, walkableSet(grid));
    if (path) {
      console.log("BFS found path:", path.length, "steps");
      // Execute BFS path...
    } else {
      console.log("BFS: NO PATH EXISTS from current position to target.");
      console.log("Need to re-scout or find alternate target.");
    }
    break; // Exit heuristic navigation loop
  }
}
// === END BLOCKED-MOVE DETECTOR ===
```

**Add to Critical Rules:**

```markdown
9. **Blocked-move detection.** If you get blocked 5+ times in the same
   direction or area, STOP heuristic navigation immediately. Compute a BFS
   path on the grid. If BFS returns null (no path), delegate a re-scout or
   try approaching the target from a completely different direction. Never
   burn more than 10 actions on blocked moves -- that is 20 fuel wasted.
```

### 5.4 Teleport/Portal Mechanics Documentation

**Priority:** HIGH
**Effort:** Small (add ~8 lines of prose to the plugin)
**Expected impact:** v0.5.0 lost 2 iterations (11-12) to teleport confusion. Documenting the mechanic saves exploration time and prevents the agent from relying on positions that may change unpredictably.

**Plugin change -- add new section after "Level Completion Mechanism" in `arc3-delegation-test.md`:**

```markdown
### Teleport/Portal Mechanics (discovered in v0.5.0)

The maze contains portal/teleport mechanics:

1. **Boundary wrapping:** Moving past the grid edge (row 63 or col 63) may
   wrap the entity to the opposite side (row 0 or col 0). This is NOT a
   bug -- it is a maze mechanic. The coordinates will jump from ~60s to ~0s.

2. **In-maze portals:** Certain positions teleport the entity to a distant
   location. In v0.5.0, moving UP from inside Rect 1 (r10-11, c34-38) after
   Level 1 completion teleported the entity to r35-36, c29-33. This may be
   a consistent portal or may vary by level.

**After ANY movement, check your position.** If the entity's coordinates
jump by more than 5 pixels (one step), a teleport occurred. Re-map your
position and re-plan your route. Do NOT assume the old route is still valid.
```

### 5.5 Marker Respawning Mechanic Documentation

**Priority:** HIGH
**Effort:** Small (add ~5 lines of prose)
**Expected impact:** In v0.5.0, the marker respawned after absorption at iters 18 and 22. Understanding this mechanic prevents the agent from wasting iterations re-absorbing markers and informs the strategy (must reach rectangle quickly after absorption).

**Plugin change -- add to the "Level Completion Mechanism" section:**

```markdown
**Marker respawning:** After absorbing the marker, you must enter the target
rectangle within a limited action window. If you take too many actions after
absorption without entering the rectangle, the marker may respawn at its
original position. In v0.5.0, the marker respawned after ~10 actions
post-absorption. Plan your route to the rectangle BEFORE absorbing the
marker. Only absorb when you have a confirmed BFS path to the rectangle.
```

### 5.6 Fuel Refueling Tracking

**Priority:** MEDIUM
**Effort:** Small (add ~10 lines to helpers)
**Expected impact:** Knowing refueling locations enables strategic route planning through fuel pickups. In v0.5.0, refueling saved the agent from fuel depletion twice, but the extra fuel was wasted on blocked moves. With refueling awareness + BFS pathfinding, the agent could sustain navigation across multiple levels.

**Plugin change -- add to the helper template:**

```javascript
// === FUEL TRACKING ===
// Call before and after each action to detect refueling
function checkFuelChange(prevFuel, grid) {
  const currentFuel = countColor(grid, 11);
  if (currentFuel > prevFuel + 2) { // +2 to account for display jitter
    const pos = getEntityPosition(grid, 12);
    console.log(`FUEL REFUELED: ${prevFuel} -> ${currentFuel} (+${currentFuel - prevFuel}) at entity position [${pos.rMin}-${pos.rMax}, ${pos.cMin}-${pos.cMax}]`);
    console.log("FUEL STATION FOUND at this position. Remember for future route planning.");
  }
  return currentFuel;
}
// === END FUEL TRACKING ===
```

**Add to Critical Rules:**

```markdown
10. **Fuel refueling.** The maze contains fuel pickup locations. When fuel
    increases by more than 4 pixels between actions, log the entity's
    position -- that is a fuel station. Plan routes through known fuel
    stations when fuel is low. Fuel refueling makes multi-level attempts
    viable even with high action counts.
```

### 5.7 Multi-Level Strategy: Scout, BFS, Navigate, Repeat

**Priority:** MEDIUM
**Effort:** Medium (restructure the Strategy section)
**Expected impact:** Provides a systematic loop for all levels beyond Level 1. Currently the plugin has Steps 1-5 as a linear flow. The agent needs a repeatable cycle for levels 2-7.

**Plugin change -- add new section after Step 4:**

```markdown
### Multi-Level Loop (Level 2+)

After completing each level, repeat this cycle:

1. **Re-scout** (Step 4): Delegate to `arc3-scout` to map the new maze.
   Budget: 1-2 iterations, 5 actions.

2. **BFS plan**: Compute the shortest path from entity to marker using
   `bfsPath()`. If no path exists, the scout may have missed corridors --
   try a second scout with explicit instructions to probe specific rows.

3. **Navigate to marker**: Execute the BFS-computed path. Track blocked
   moves. If blocked 3+ times, re-compute BFS (the maze state may have
   changed).

4. **BFS plan to rectangle**: BEFORE absorbing the marker, compute the path
   from the marker position to the target rectangle. Only absorb if the
   path exists and is within your fuel budget (remember: marker respawns
   after ~10 actions).

5. **Absorb and navigate**: Absorb the marker, then immediately execute
   the pre-computed path to the rectangle. Speed matters -- minimize
   actions between absorption and rectangle entry.

6. **Level complete**: Return to step 1.

**Budget per level:** ~3 iterations scout/plan, ~5-8 iterations navigate.
At ~8-11 iterations per level and 25 usable iterations, expect to complete
2-3 levels per run (possibly more with fuel refueling).
```

### 5.8 Scout Plugin: Add BFS Corridor Mapping

**Priority:** LOW
**Effort:** Small (add ~5 lines of guidance to `arc3-scout.md`)
**Expected impact:** Marginal improvement. The BFS on the parent side already computes paths from grid data. But having the scout explicitly report corridor connectivity in BFS-compatible terms (which positions are walkable, which are walls) would reduce the parent's analysis time.

**Plugin change -- add to Phase 3 of `arc3-scout.md`:**

```markdown
- **Walkability map:** For each 5-pixel-aligned position in the grid
  (r=0,5,10,...,60; c=0,5,10,...,60), report whether the entity's 2x5
  footprint at that position would be fully on walkable (color 3) pixels.
  This gives the parent a pre-computed BFS graph for pathfinding.
```

---

## 6. Recommendation Summary

| # | Recommendation | Priority | Effort | Target Failure Mode | Expected Impact |
|---|---------------|----------|--------|---------------------|-----------------|
| 1 | BFS pathfinding utility function | **CRITICAL** | Medium | v0.5.0 heuristic navigation failure (50 blocked moves) | Computes shortest path in 0 game actions |
| 2 | Enforce Level 2+ delegation | **CRITICAL** | Small | v0.5.0 no delegation (106 solo actions on L2) | Scout maps L2 in ~5 actions vs 106 wasted |
| 3 | Blocked-move detection and strategy switch | **HIGH** | Small | v0.5.0 ~50 blocked moves without changing approach | Abandons failing strategy after 5 blocks |
| 4 | Teleport/portal mechanics documentation | **HIGH** | Small | v0.5.0 lost 2 iters to teleport confusion | Prevents position assumption errors |
| 5 | Marker respawning documentation | **HIGH** | Small | v0.5.0 marker respawned twice, wasting absorption | Informs absorb-then-rush strategy |
| 6 | Fuel refueling tracking | **MEDIUM** | Small | v0.5.0 didn't track fuel stations strategically | Enables route planning through refueling |
| 7 | Multi-level strategy loop | **MEDIUM** | Medium | v0.5.0 had no systematic L2+ approach | Repeatable cycle for all 7 levels |
| 8 | Scout BFS corridor mapping | **LOW** | Small | Scout reports could be more BFS-friendly | Marginal time savings on parent analysis |

**Total estimated effort: ~90 minutes of plugin editing.**

**If only two changes are made:** Recommendations #1 (BFS pathfinding) and #2 (enforce delegation). These address the two root causes of v0.5.0's Level 2 failure: no pathfinding algorithm and no delegation. Together, they would have saved approximately 100 of the 106 Level 2 actions.

---

## 7. Projected v0.6.0 Outcome

### Scenario: Recommendations 1-7 Implemented

| Phase | Iterations | Actions | Fuel Used | Notes |
|-------|-----------|---------|-----------|-------|
| **Level 1** | | | | |
| L1: Self-analyze grid | 2-3 | 0 | 0 | Observe-only, no delegation needed |
| L1: Navigate to marker | 2-3 | 7-10 | 14-20 | BFS-guided, no blocked moves |
| L1: Navigate UP to Rect 1 | 1-2 | 4-6 | 8-12 | Known corridor, BFS-confirmed |
| **L1 subtotal** | **5-8** | **11-16** | **22-32** | **Comparable to v0.5.0's 16 actions** |
| **Level 2** | | | | |
| L2: Re-scout delegation | 1-2 | 5 | 10 | Mandatory scout maps new maze |
| L2: BFS plan + navigate to marker | 3-4 | 10-15 | 20-30 | Algorithmic path, no blocked moves |
| L2: BFS plan to rect + absorb + navigate | 2-3 | 8-12 | 16-24 | Pre-compute path before absorption |
| **L2 subtotal** | **6-9** | **23-32** | **46-64** | **vs v0.5.0's 106 actions (0 progress)** |
| **Level 3** | | | | |
| L3: Re-scout + BFS + navigate | 6-9 | 23-32 | 46-64 | Same pattern as L2 |
| **L3 subtotal** | **6-9** | **23-32** | **46-64** | **Fuel refueling may extend budget** |
| **Return** | 1 | 0 | 0 | Return guard at iter 25 or on completion |

### Projected Outcomes

**Conservative (no fuel refueling, recommendations 1-2 only):**
- Levels completed: **2** (L1 + L2)
- Score: **28.6%** (2/7)
- Total actions: ~50-60
- Iterations used: ~14-18
- Improvement over v0.5.0: +1 level, +14.3 percentage points

**Moderate (fuel refueling utilized, recommendations 1-7):**
- Levels completed: **3** (L1 + L2 + L3)
- Score: **42.9%** (3/7)
- Total actions: ~70-90
- Iterations used: ~20-25
- Improvement over v0.5.0: +2 levels, +28.6 percentage points

**Optimistic (BFS + delegation + fuel stations + no new failure modes):**
- Levels completed: **4-5**
- Score: **57-71%**
- Total actions: ~100-130
- Iterations used: 25 (budget-limited)
- Requires: Levels 4-7 don't introduce fundamentally new mechanics

**Likely new failure mode in v0.6.0:** Multi-level scaling or maze-variant generalization. Levels 4+ may introduce mechanics not seen in Levels 1-3 (locked doors, multi-marker sequences, dynamic walls, etc.). The BFS + delegation pattern should handle corridor-style mazes, but novel mechanics would require another round of plugin updates.

### Confidence Assessment

| Outcome | Confidence |
|---------|-----------|
| At least 2 levels completed | **High** (BFS + delegation directly addresses v0.5.0 failure) |
| 3 levels completed | **Medium** (depends on Level 3 maze complexity and fuel availability) |
| 4+ levels completed | **Low** (unknown Level 4+ mechanics, iteration budget pressure) |
| Score > 0 (at least 1 level) | **Very High** (v0.5.0 already achieved this; v0.6.0 should not regress) |

---

## 8. Cross-Version Comparison Table (v0.1.0 through v0.5.0)

| Metric | v0.1.0 | v0.2.0 | v0.3.0 | v0.4.0 | v0.5.0 | Trend |
|--------|--------|--------|--------|--------|--------|-------|
| **Iteration budget** | 20 | 20 | 30 | 30 | 30 | Stable |
| **Scout model** | Flash | Sonnet | Sonnet | Sonnet | None | Parent self-sufficient for L1 |
| **Scout actions (L1)** | 42 | 7 | 6 | 4 | 0 | No delegation |
| **Delegations** | 2 | 1 | 1 | 2 | **0** | Regression (should delegate on L2) |
| **Levels completed** | 0 | 1 | 1 | 0 | **1** | Recovered from v0.4.0 regression |
| **L1 deliberate?** | -- | No | No | -- | **Yes** | First deliberate completion |
| **L1 actions** | -- | ~24 | ~33 | -- | **16** | Best efficiency |
| **L2 attempted?** | No | Yes | Yes | No | **Yes** | -- |
| **L2 actions** | -- | ~22 | ~28 | -- | **106** | Worst (no pathfinding) |
| **return() called** | No | No | No | Yes | **Yes** | Stable since v0.4.0 |
| **Score** | 0 | 0 | 0 | 0 | **14.3%** | First nonzero score |
| **Fuel at end** | 0 | 56 | 44 | 0 | 60 | Recovered (refueling discovered) |
| **Total actions** | ~85 | 46 | 61 | 45 | 122 | Highest (L2 pathfinding waste) |
| **Wall time** | 255s | 336s | 515s | 558s | 725s | Increasing |
| **Cost estimate** | $0.63 | $0.77 | $1.46 | $1.27 | $2.08 | Increasing |
| **Failure mode** | Resource | Cognitive | Protocol | Domain Knowledge | **Algorithmic** | New category each version |

---

## 9. Broader Lessons

### 9.1 Explicit Knowledge Pays Off, But Has Limits

The v0.4.0 analysis recommended encoding the level completion mechanism. v0.5.0 did this, and the result was immediate: first deliberate level completion, best Level 1 efficiency. This validates the principle that discovered knowledge should be crystallized into the plugin.

However, explicit knowledge has limits. You can tell the agent *what* to do (absorb marker, enter rectangle) but not *how* to navigate a novel maze. Level 2's corridor layout was unknown before the run, so no amount of pre-encoded knowledge could specify the path. The agent needs algorithmic tools (BFS) to handle unknown environments, not just domain knowledge for known ones.

### 9.2 Self-Sufficiency Is Not Always Optimal

v0.5.0's parent proved it could analyze the grid and navigate Level 1 without delegation. It then over-generalized: if I can handle Level 1 alone, I can handle Level 2 alone. This is a classic capability overshoot -- success at one difficulty level does not imply success at the next.

The delegation infrastructure exists (scout plugin, re-scout mode, `rlm()` API). The agent simply chose not to use it. This suggests the plugin's delegation instructions need to be stronger: not "you may delegate" but "you MUST delegate on Level 2+." Autonomy is valuable, but enforced delegation at complexity boundaries is more valuable.

### 9.3 Heuristic Navigation Is a Dead End

The try-direction/backtrack-if-blocked heuristic worked for Level 1's simple corridor structure. It catastrophically failed on Level 2's complex layout. This is not a coincidence -- heuristic navigation degrades exponentially with maze complexity. A maze with N wall segments requires O(N) probes with heuristic navigation but O(grid_size) with BFS regardless of wall count.

The agent already has the grid data (from `arc3.observe()`, zero actions). The BFS computation is pure JavaScript (zero game actions). The only cost is iteration time (CPU cycles for BFS on a 64x64 grid are negligible). There is no reason NOT to use BFS for every navigation decision. Heuristic navigation should be eliminated entirely from the v0.6.0 strategy.

### 9.4 The Fix-One-Break-Another Pattern Continues

| Version | Fix Applied | New Problem Exposed |
|---------|-----------|-------------------|
| v0.2.0 | Better scout (42->7 actions) | Not enough iterations for L2 |
| v0.3.0 | More iterations (20->30) | Never called return() |
| v0.4.0 | return() guard | Didn't know level completion |
| v0.5.0 | Level completion encoded | No pathfinding for complex mazes |

v0.5.0 confirms the pattern: each fix peels back one layer and exposes the next. The prediction for v0.6.0 is that adding BFS + delegation will solve Level 2 navigation but expose a new failure mode at Levels 3-4 (likely a novel maze mechanic, an iteration budget crunch as more levels consume iterations, or a BFS assumption violation like dynamic walls).

### 9.5 The Score=0 Barrier Is Broken

For the first time in five versions, the agent scored above zero. This is symbolically important: the system can now produce partial results. The return guard (v0.4.0) plus the level completion mechanism (v0.5.0) together broke the score=0 barrier. Going forward, every run should produce at least Level 1 completion unless a regression is introduced.

This also means the evaluation metric becomes meaningful. At score=0, there was no gradient to optimize. At score=14.3%, improvements can be measured: 28.6% would be a 2x improvement, 42.9% would be 3x. The experiment has exited the "binary success/failure" phase and entered the "continuous improvement" phase.
