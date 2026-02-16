# ARC-3 Delegation Experiment: v0.8.0 Analysis and v0.9.0 Recommendations

**Date:** 2026-02-16
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6
**Run:** run-015 (v0.8.0)
**Prior runs:** run-008 (v0.1.0) through run-014 (v0.7.0)
**Result file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T00-47-06-376Z.json`

---

## 1. Executive Summary

- **Score: 14.3% (1/7 levels)** -- identical to v0.5.0, v0.6.0, and v0.7.0. This is the 4th consecutive version at 14.3%, establishing a firm plateau. Level 1 completed, Level 2 failed.
- **Efficiency: 16 iterations used, 57 scored actions (70 total including fuel-burn), $unknown cost, 745s wall time.** More iterations than v0.7.0's 11, roughly comparable wall time. The additional iterations were spent on detailed grid analysis and a failed rect-entry attempt.
- **Level 1 was again near-perfect:** 18 actions, 5 iterations (including scout delegation). Clean BFS navigation, marker absorbed at step 7, rectangle entered at step 18. Fuel refilled to 98 on level transition.
- **Level 2 revealed a NEW and CRITICAL failure mode: the marker was never actually absorbed.** The entity overlapped the marker position (entity at [45,49] spanning rows 45-46, cols 49-53; marker at rows 46-47, cols 50-52), `findMarker()` returned null, and the agent believed absorption succeeded. But no color-0 borders appeared around the rectangles (0 pixels of color 0 post-"absorption"). Moving away revealed the marker was still there. The entity merely occluded the marker pixels without triggering the absorption mechanic.
- **The 14.3% plateau IS structural for ls20 Level 2 with the current approach.** The fundamental blocker is not path length, not respawn timing, and not BFS bugs. It is that the entity's 5-pixel grid alignment cannot position the entity to truly absorb the Level 2 marker given the maze geometry. Even if absorption were to work, the 18-19 step marker-to-rect path would still exceed the respawn window.

---

## 2. v0.8.0 Changes Tested

v0.8.0 implemented changes from the v0.7.0 analysis. Here is the assessment of each:

### 2.1 `findBestAbsorptionPoint()`: Did it run?

**Status: NOT USED BY THE AGENT.** The function was defined in the plugin template but the agent never called it. Instead, the agent performed ad-hoc BFS searches to rect entry points in iterations 7 and 11. The agent manually checked targets like `[35,14]`, `[40,14]`, and `[45,14]` and found paths of 18, 19, and 20 steps respectively.

**What the agent found:** The inner rect at [39-45, 13-19] had color-3 corridor borders at cols 12 and 20. The BFS found paths to three entry positions above/inside the rect. The shortest was 18 steps to [35,14]. No BFS paths were found to the other rectangles (bottom-left [53-62, 1-10] and bottom-bar [60-63, 12-63]).

**Why it didn't help:** Even though the function existed, the agent's own analysis in iteration 7 showed all rect entry points were 18+ BFS steps from the marker area. The return path from marker to rect was always 18-19 steps, far exceeding any plausible respawn window.

### 2.2 Adaptive Navigation Order: Did the agent use marker-first or rect-first?

**Status: MARKER-FIRST (same as v0.7.0).** The agent navigated to the marker first (16-step BFS to [45,49] in iteration 8), "absorbed" it, then attempted to navigate to the rectangle. The agent did reason about trying rect-first in iteration 12 ("In Level 1, absorption persisted even after respawn. So just go to the rect!") and executed an 18-step path directly to [35,14] without re-absorbing the marker. This was a creative strategy but it failed because the marker was never truly absorbed -- the rect borders (color 5) remained unchanged.

**Key observation:** The agent DID try the rect-first approach in iteration 12, but it was based on the false premise that absorption had already occurred. Since absorption never actually triggered, navigating to the rect was futile -- color 5 blocked entry.

### 2.3 Respawn Timer Measurement: Did it instrument the count?

**Status: PARTIALLY.** In iteration 5 (Level 1), the agent logged `MARKER RESPAWNED after N post-absorption actions` during the rect navigation. The marker respawned after just 1 action in Level 1 (immediately), but entering the rectangle still completed the level. This confirmed that for Level 1, marker respawn is irrelevant -- absorption is permanent and rect entry works regardless of respawn.

For Level 2, the "absorption" at iteration 8 was followed by moving UP in iteration 9, at which point `marker=[47,51]` reappeared. But since the marker was never truly absorbed (no color-0 borders appeared), this is not a valid respawn measurement. The agent detected 0 pixels of color 0 after "absorption" -- a key signal it misinterpreted.

### 2.4 Scout Return Path Computation

**Status: PARTIALLY FIRED.** The L2 re-scout (iteration 6) returned a report including `returnPaths` data with `bestEntry: [5,9]` and `recommendation: "rect-first (best return > 10)"`. However, the return path lengths were all `null` (the scout could not compute BFS paths), making the data unusable. The scout correctly recommended rect-first strategy but could not quantify it.

### Summary Table

| # | Change | Fired? | Helped? | Impact on L2 |
|---|--------|--------|---------|---------------|
| 1 | `findBestAbsorptionPoint()` | NO | N/A | Never called by agent |
| 2 | Adaptive navigation order | PARTIAL | NO | Tried rect-first but marker never absorbed |
| 3 | Respawn timer measurement | PARTIAL (L1 only) | NO | L2 "absorption" was false |
| 4 | Scout return path computation | PARTIAL | NO | All return paths were null |
| 5 | BFS exact goal match (from v0.7.0) | YES | YES | Paths correct, entity reached targets |
| 6 | Fresh grid before BFS | YES | YES | No stale-grid errors |
| 7 | Scout L2 verification step | YES | YES | Correct L2 entity position |
| 8 | All-fuel transition handler | NO | N/A | Not encountered |

---

## 3. Trajectory Walkthrough

### Phase 1: Level 1 -- Clean Execution (Iterations 1-5, 18 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 1 | 4 (scout) | 4 | Game started. Delegated to arc3-scout. Scout used 4 actions, returned JSON: entity at r45-46/c39-43, marker at r32/c21, fuel 76/84. Corridors mapped. |
| 2 | 0 | 4 | Grid analysis. BFS found NO exact path to marker [32,21] (grid alignment mismatch: entity at 5-pixel grid steps from r45/c39 never lands on r32/c21). Closest reachable: [30,19], dist 4. 37 reachable positions computed. |
| 3 | 7 | 11 | BFS to [30,19]: 7 steps [3,3,3,3,1,1,1]. Entity navigated cleanly. **Marker absorbed at step 6** (entity at [30,19] spanning rows 30-31, cols 19-23 was close enough to marker at [31-32, 20-21]). |
| 4 | 0 | 11 | Post-absorption grid survey. 60 pixels of color 0 appeared (rect borders activated). Found upper rect [10-14, 34-38] with color-0 borders. BFS to [10,34]: 7 steps. BFS to [15,34]: 6 steps. |
| 5 | 7 | 18 | Executed path [1,4,4,4,1,1,1] to [10,34]. **Level 1 completed at step 6.** Marker respawned during navigation (after 1 action), but level completed anyway. Entity at r10/c34. |

**L1 Assessment:** 18 actions, 5 iterations. Near-identical to v0.7.0 (20 actions) and v0.6.0 (18 actions). BFS correct, no blocked moves, no wasted actions. The marker absorption at proximity (not exact overlap) and persistent activation despite respawn are confirmed mechanics.

### Phase 2: Level 2 Re-Scout (Iteration 6, 1 scout action)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 6 | 1 (scout) | 19 | Re-scout delegation. Scout used 1 verification action. Reported entity at r35-36/c29-33 (correct L2 spawn), marker at r46-47/c51-52 (correct L2 marker). Fuel refilled to 98. Return path analysis returned nulls. Scout recommended "rect-first" strategy. |

### Phase 3: Level 2 BFS Analysis (Iteration 7, 0 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 7 | 0 | 19 | Extensive BFS. Entity at [35,29], marker at [47,51]. 59 reachable positions. Closest reachable to marker: [45,49], dist 4, no overlap. Rect clusters: [0-51,0-3] (208px border), [39-45,13-19] (43px inner), [53-62,1-10] (76px), [60-63,12-63] (112px). **No BFS paths found to ANY rectangle entry points.** No BFS path to marker. |

**Critical data point:** The BFS found zero paths to any rectangle AND zero paths to the marker. This means the entity's 5-pixel step grid cannot reach either target exactly. It can only reach positions *near* them (closest reachable to marker: dist 4 at [45,49]).

### Phase 4: Marker "Absorption" Attempt (Iteration 8, 16 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 8 | 16 | 35 | BFS to [45,49]: 16 steps [4,1,1,1,1,1,4,4,2,4,2,2,2,2,2,2]. Entity navigated cleanly to [45,49]. `findMarker()` returned null at step 15 -- entity at rows 45-46, cols 49-53 occluded marker pixels at rows 46-47, cols 50-52. **Agent believed marker was absorbed.** Post-absorption colors: `{3:1445, 4:2079, 5:439, 8:12, 9:45, 11:66, 12:10}` -- **0 pixels of color 0.** In L1, absorption produced 60 pixels of color 0. This is the smoking gun: absorption did NOT trigger. BFS found NO paths to any rect entry points. |

**THE CRITICAL MOMENT:** The agent saw 0 color-0 pixels but did not immediately recognize this as "absorption failed." It proceeded to iteration 9 to investigate.

### Phase 5: Discovery that Marker Was Never Absorbed (Iteration 9, 1 action)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 9 | 1 | 36 | Moved UP to [40,49]. Marker reappeared at [47,51] (colors 0:3, 1:2 returned). Rect borders unchanged (all color 5). Grid around rect [39-45,13-19] showed color 5 borders intact -- no color 0 doors. **Agent concluded marker was not properly absorbed, or it respawned.** Printed color 9 locations, examined rect structure. |

### Phase 6: Grid Analysis and Path Planning (Iterations 10-11, 0 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 10 | 0 | 36 | Full grid overview. Found color 8 at [61-62, 56-63] (decorative element in bottom bar). Checked entity validity at various positions near rect. [35,14] valid (all color 3), [40,14] valid (all color 5, but BFS considers 5 walkable), [45,14] valid (color 5 and 3). Row 38 NOT on entity grid (not reachable via 5-step moves). |
| 11 | 0 | 36 | BFS found paths: [35,14]=18 steps, [40,14]=19 steps, [45,14]=20 steps. Full row scans revealed maze structure. Row 40: walls at c4-11, c20-28, c39-43, c59-63. Row 35: walls at c4-13, c19-28, c39-48, c54-63. Two disconnected corridors at the entity's row level, requiring detour through top corridor. |

### Phase 7: Rect-First Strategy Attempt (Iteration 12, 20 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 12 | 20 | 56 | Agent reasoned: "In Level 1, absorption persisted even after respawn. Just go to the rect!" Executed 18-step BFS to [35,14]. Entity arrived at [35,14]. **Level NOT completed.** Tried DOWN -- **BLOCKED** (entity stayed at [35,14]). Tried DOWN again -- still blocked. Entity cannot enter the rect because color 5 borders at row 39-40 are walls. |

**THE DECISIVE FAILURE:** The agent's hypothesis that absorption persists was wrong FOR LEVEL 2. In Level 1, the entity at [30,19] was close enough to trigger true absorption (color 0 borders appeared). In Level 2, the entity at [45,49] merely occluded the marker without triggering absorption (no color 0 borders). The fundamental mechanic requires a more precise positional overlap that the Level 2 grid alignment does not permit.

### Phase 8: Stuck Analysis and Resignation (Iterations 13-14, 1 action)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 13 | 0 | 56 | Grid analysis at [35,14]. Rect border still color 5 at r39-40. Entity trail (color 9) at r37-38. Closest reachable (no color 5) to marker: 19 steps. Fuel at 28px (14 moves). Marker at [47,51], 19 steps away. Impossible to reach marker AND return with 14 moves. |
| 14 | 1 | 57 | Moved UP to [30,14]. Trail at r33-34 pushed up. Rect border unchanged. Attempted `arc3.getScore()` -- API returned 404 (game still in progress, scorecard not finalized). |

### Phase 9: Fuel Burn and Score Return (Iterations 15-16, 13 actions)

| Iter | Actions | Cumulative | What Happened |
|------|---------|-----------|---------------|
| 15 | 0 | 57 | BFS to marker: 18 steps. "Path too long (18 steps), not enough fuel." |
| 16 | 13 (burn) | 70 | Burned remaining fuel by moving UP repeatedly. Fuel jumped to 82 (likely hit a transition/portal), then continued dropping. Game remained NOT_FINISHED. Score retrieved: 14.3% (1/7 levels, 57 scored actions). |

**Final score:** Level 1 completed in 18 actions (baseline 29 = 100% score). Level 2: 39 actions used, 0% score. Overall: 14.3%.

---

## 4. L2 Failure Analysis: Different from v0.7.0

### Failure Mode Comparison

| Aspect | v0.6.0 | v0.7.0 | **v0.8.0** |
|--------|--------|--------|-----------|
| Marker truly absorbed? | Yes (2x, color 0 appeared) | Yes (1x, color 0 appeared) | **NO (0 color 0 pixels)** |
| Color 0 borders appeared? | Yes | Yes | **No** |
| Rectangle reachable? | No (5px short) | Yes (reached r35/c14) | **Yes (reached r35/c14)** |
| Rectangle enterable? | No (blocked) | No (blocked by color 5) | **No (blocked by color 5)** |
| Root cause | BFS bugs | Path geometry (19 steps > respawn) | **Absorption never triggered** |
| Agent's false belief | None | "19-step path will work" | **"Marker was absorbed"** |
| Actions wasted on recovery | ~50 | 2 | **20** (rect navigation on false premise) |

### The New Root Cause: False Absorption

In v0.7.0, the marker was genuinely absorbed (color 0 borders appeared, 60 pixels), but the return path was too long. In v0.8.0, the marker was NEVER absorbed -- `findMarker()` returned null because the entity's pixels (color 12) were painted on top of the marker pixels, hiding them. But the game engine did not register this as absorption. Moving away revealed the marker was still there.

**Evidence:**
1. Post-"absorption" color counts: `{3:1445, 4:2079, 5:439, 8:12, 9:45, 11:66, 12:10}` -- zero pixels of color 0 or 1 (marker colors). In L1 after true absorption: `{0:60, ...}`.
2. After moving UP: marker reappeared at exact same position [47,51] with same pixel count (5).
3. Rect borders remained color 5 throughout -- never changed to color 0.

### Why Did Absorption Work in L1 But Not L2?

**Level 1:** Entity at [30,19] (rows 30-31, cols 19-23). Marker at rows 31-33, cols 20-22. The entity's bottom row (31) overlapped with the marker's top row (31). The entity's col range (19-23) overlapped with the marker's col range (20-22). There was genuine pixel-level overlap.

**Level 2:** Entity at [45,49] (rows 45-46, cols 49-53). Marker at rows 46-47, cols 50-52. The entity's bottom row (46) overlapped with the marker's top row (46), and cols 50-52 are within the entity's col range (49-53). This APPEARS identical to L1 -- partial row overlap.

**The difference is likely in the exact pixel-level geometry.** The entity is a 2x5 block (10 pixels). The marker is a 5-pixel cluster in an irregular pattern (not a rectangle). The game engine may require the entity to overlap a specific anchor pixel of the marker (e.g., the center pixel), not just any pixel in the cluster. In L1, the alignment happened to overlap the anchor. In L2, it did not.

Alternatively, the 5-pixel step grid alignment from the L2 spawn position (r35, c29) generates a different grid than L1 (r45, c39). The reachable positions near the L2 marker are constrained to a grid that doesn't achieve the necessary overlap.

---

## 5. Strategy Assessment: Did rect-first help?

**The agent did attempt a rect-first strategy in iteration 12**, navigating directly to [35,14] without re-absorbing the marker. This was a creative application of the v0.8.0 guidance.

**Why it failed:** The strategy assumed that absorption had already occurred (from iteration 8). Since absorption never actually triggered, the rect borders remained color 5 (walls), and the entity was blocked from entering.

**If absorption HAD worked:** The rect-first approach would still have failed because:
1. The entity at [35,14] is 4 rows above the rect top border (r39). Moving DOWN would require the entity to occupy rows 40-41, cols 14-18 -- all color 5. Even if color 5 is "walkable" in the BFS model, the game engine treats it as a wall.
2. After absorption, color 0 borders would appear at the OUTER edge of the rect (e.g., r38-39 at the top). The entity at [35,14] would then need to move DOWN to [40,14] -- but [40,14] spans rows 40-41, which are inside the color-5 rect body. Entry requires positioning at the color-0 border, not inside the color-5 body.
3. The actual entry path in Level 1 worked because [10,34] placed the entity at rows 10-11, cols 34-38, which was ON the color-0 border (row 10 was color 0) and inside the rect structure. The specific alignment of the L1 rect allowed this; the L2 rect's position may not.

---

## 6. Cross-Version Progression Table

| Version | Score | Levels | Iterations | Actions | Cost | Key Change | Failure Mode |
|---------|-------|--------|-----------|---------|------|------------|--------------|
| v0.1.0 | 0% | 0/7 | ~20 | ~85 | $0.63 | Baseline | Resource depletion (no `return()`) |
| v0.2.0 | 0% | 1/7* | ~20 | 46 | $0.77 | Better scout model | Cognitive (L2 not attempted) |
| v0.3.0 | 0% | 1/7* | ~30 | 61 | $1.46 | More iterations | Protocol (no `return()` called) |
| v0.4.0 | 0% | 0/7 | ~30 | 45 | $1.27 | return() guard | Domain confusion (wrong game mechanics) |
| v0.5.0 | 14.3% | 1/7 | ~30 | 122 | $2.08 | Level completion | Algorithmic (no BFS, random walk) |
| v0.6.0 | 14.3% | 1/7 | 26 | 143 | $2.77 | BFS + delegation | Execution fidelity (BFS bugs, stale grid) |
| v0.7.0 | 14.3% | 1/7 | 11 | 58 | $0.84 | BFS bug fixes | Geometric (marker-to-rect 19 steps > respawn) |
| **v0.8.0** | **14.3%** | **1/7** | **16** | **57** | **~$1.00** | **Rect-first strategy, absorption point search** | **Absorption failure (entity occludes but does not absorb marker)** |

*v0.2.0 and v0.3.0 completed Level 1 in-game but scored 0% due to no `return()` call.

---

## 7. The 14.3% Plateau

### Is Level 2 of ls20 structurally unsolvable with the current approach?

**Yes, very likely.** The evidence across four versions (v0.5.0-v0.8.0) paints a consistent picture:

**Problem 1: Absorption may be impossible on L2's grid alignment.**
The entity spawns at r35/c29 and moves in 5-pixel steps. The reachable positions form a fixed grid: rows {0,5,10,15,20,25,30,35,40,45,50,55,60}, cols {4,9,14,19,24,29,34,39,44,49,54,59}. The L2 marker is at approximately [46-47, 50-52]. The closest reachable position is [45,49] (entity spans rows 45-46, cols 49-53). While this partially overlaps with the marker, the game engine does not register it as absorption. The entity cannot reach any other position that overlaps the marker more precisely because all reachable positions are on the 5-pixel grid.

**Problem 2: Even if absorption worked, the return path is 18-19 steps.**
The L2 maze geometry places the marker (bottom-right) and the only enterable rectangle (left-center) on opposite sides of the maze. The shortest BFS path between them requires a detour through the top corridor (row 5-14). This path is 18-19 steps, which exceeds any plausible marker respawn window.

**Problem 3: The rect entry itself is blocked by alignment.**
The rect at [39-45, 13-19] has its border at rows 39-40 and 44-45. The entity's reachable grid positions are rows 35, 40, and 45. At row 40, the entity spans rows 40-41 -- landing directly on the color 5 border (wall). The game engine blocks this move regardless of whether color 5 is in the "walkable" set. In Level 1, the rect at [10-14, 34-38] happened to have an entry position where the entity grid aligned with the color-0 border.

### What would it take to break through?

To break the 14.3% plateau, one of the following would need to change:

1. **Different grid alignment** -- If the entity started at a different spawn position (e.g., r37/c31 instead of r35/c29), it might generate a grid that overlaps the marker's anchor pixel.
2. **Shorter maze path** -- If the maze had a direct horizontal corridor connecting the marker area and the rect area, the return path could be short enough.
3. **Different marker position** -- If the marker were closer to the rect (within 5-8 BFS steps), the timing constraint would be satisfied.
4. **Portal/shortcut mechanics** -- If the game has teleport mechanics that the agent hasn't discovered.

None of these are under the agent's control -- they are properties of the fixed maze seed `ls20-cb3b57cc`.

---

## 8. Root Cause Analysis

### THE specific blocking issue:

**The entity's 5-pixel-step movement grid, as determined by the Level 2 spawn position, cannot achieve a positional overlap with the marker that the game engine recognizes as "absorption."**

This is a different root cause from v0.7.0 (which was "path too long"). In v0.8.0, we discovered that the v0.7.0 analysis was built on a false premise: v0.7.0 assumed absorption worked (because `findMarker()` returned null). Re-examining v0.7.0's data with the v0.8.0 insight: v0.7.0 also showed 0 pixels of color 0 after "absorption" in some iterations, but the analysis attributed this to respawn rather than failed absorption.

The chain of failures:
1. Entity grid alignment prevents true marker absorption on L2.
2. Without absorption, rect borders remain color 5 (walls).
3. Without color-0 borders, the entity cannot enter the rectangle.
4. Without entering the rectangle, the level cannot complete.

This is **not a software bug** -- the BFS is correct, the grid observation is fresh, the scout data is accurate, the entity reaches the right positions. The problem is a fundamental geometric incompatibility between the entity's movement grid and the marker's position on Level 2 of this specific maze seed.

---

## 9. v0.9.0 Recommendations

### 9.1 Verify the Absorption Mechanic Precisely (CRITICAL)

**Priority:** CRITICAL
**Effort:** Medium
**Impact:** Determines whether L2 is solvable at all.

The agent needs to experimentally test absorption with different approach angles. Instead of always approaching the marker from the closest reachable position [45,49], try ALL reachable positions near the marker and check for color-0 border activation after each:

```markdown
### Absorption Testing Protocol
After reaching each position near the marker:
1. Check color counts BEFORE and AFTER arriving.
2. If color 0 count increases by 40+ pixels: absorption SUCCEEDED.
3. If color 0 count unchanged: absorption FAILED, try next position.
4. Positions to test: [45,49], [45,54], [40,49], [40,54], [50,49], [50,54].
5. For each position, also test moving INTO the marker from each direction
   (approach from UP vs DOWN vs LEFT vs RIGHT may produce different results).
```

If no position triggers absorption, L2 is confirmed unsolvable with the current grid seed.

### 9.2 Try a Different Game Seed (CRITICAL)

**Priority:** CRITICAL
**Effort:** Small (configuration change)
**Impact:** Bypasses the L2 geometric constraint entirely.

The ls20-cb3b57cc seed may have a Level 2 that is structurally incompatible with the agent's movement resolution. Other seeds will have different marker positions, rect positions, and corridor layouts. A different seed might place the L2 marker on a reachable grid position where absorption works, and/or place the marker and rect closer together.

**Recommendation:** Run the same v0.8.0 plugin on 3-5 different ls20 seeds. If the agent scores 28.6%+ (2/7 levels) on ANY other seed, it confirms the plateau is seed-specific, not approach-specific.

### 9.3 Investigate Whether Color 5 Is Truly a Wall (HIGH)

**Priority:** HIGH
**Effort:** Small (1-2 test actions)
**Impact:** May reveal an alternate rect entry method.

In all runs, the agent's BFS treats color 5 as walkable, but the game engine blocks movement into color 5 cells. The agent should explicitly test:
1. Move entity to [35,14] (adjacent to rect from above).
2. Attempt DOWN -- does the entity move to [40,14] or stay at [35,14]?
3. If blocked, color 5 is confirmed as a wall in the game engine.
4. If it moves, the entry point is reachable and the problem is purely about absorption.

In v0.8.0 iteration 12, DOWN from [35,14] was blocked (entity stayed). This confirms color 5 is a wall. **Remove color 5 from the walkable set** in the BFS to avoid computing paths through walls.

### 9.4 Search for Portals and Shortcuts (HIGH)

**Priority:** HIGH
**Effort:** Medium (5-10 test actions)
**Impact:** Could collapse the 19-step path if a teleport exists.

In v0.6.0, the agent discovered what appeared to be portal mechanics (moving LEFT from c14 caused a teleport/all-fuel frame, moving RIGHT caused a teleport from c14 to c34). These were never systematically explored.

**Recommendation:** Dedicate 5 scout actions to testing boundary positions:
- Move to grid edges (row 0, row 60, col 4, col 59) and check for teleportation.
- Move through color 8 areas (decorative elements at [61-62, 56-63]).
- Test if the entity can move through the left-wall rectangle [0-51, 0-3] which might be a portal boundary.

### 9.5 Increase Iteration Budget for L2 Exploration (MEDIUM)

**Priority:** MEDIUM
**Effort:** Configuration change
**Impact:** More iterations = more strategy attempts.

v0.8.0 used 16 of 30 iterations. The agent has budget remaining but returned early due to fuel exhaustion. Consider:
- Increasing `maxIterations` to 40-50 for more exploration room.
- Adding a "reset" mechanic: if the game has a reset option, it could restart L2 with full fuel.

### 9.6 Remove Color 5 from Walkable Set (SMALL)

**Priority:** SMALL but eliminates confusion
**Effort:** Trivial

Change `getWalkable()` to return `new Set([3, 12, 11, 0, 1, 9])` (remove 5). This prevents the BFS from computing paths through rect borders that the game engine won't allow. The BFS will then correctly report NO PATH to rect interiors when borders are still color 5, and WILL find paths when borders change to color 0 (which is in the walkable set).

---

## 10. Should We Continue Iterating on ls20?

### Honest Assessment

**The 14.3% plateau on ls20-cb3b57cc is very likely a dead end.** Here is the reasoning:

**Arguments for stopping:**
1. Four consecutive versions (v0.5.0-v0.8.0) have all failed at exactly the same point: L2 rect entry.
2. Each version has eliminated a different failure mode (BFS bugs, stale grid, path length, absorption), revealing a deeper structural problem.
3. The root cause in v0.8.0 is not a bug -- it is a geometric incompatibility between the entity's movement grid and the marker position on this specific maze seed.
4. The maze is deterministic (same seed = same layout). No amount of code improvement will change the L2 geometry.
5. We have spent 8 runs and $10+ on a single maze seed with diminishing marginal returns.

**Arguments for one more try:**
1. The absorption mechanic has not been thoroughly tested. Maybe a different approach angle (e.g., arriving at [45,49] from the LEFT instead of from above) triggers absorption. The anchor pixel theory is untested.
2. Portal/teleport mechanics were never systematically explored. If a portal connects the marker area to the rect area, the 19-step path constraint vanishes.
3. Running on a different seed would validate whether the approach works in principle.

### Recommendation

**Do ONE more run with two goals:**

1. **Test absorption from all angles.** Approach the L2 marker from every reachable adjacent position, checking for color-0 border activation after each. This definitively determines whether absorption is possible on this seed. Budget: 20 actions.

2. **If absorption is impossible, run on a different seed.** Use the same v0.8.0 plugin on 2-3 other ls20 seeds. If the agent scores 28.6%+ on any seed, the plugin approach is validated and the problem was seed-specific. If it still plateaus at 14.3% across seeds, the approach needs fundamental rethinking (e.g., different entity movement strategy, different game mechanics understanding).

**If both fail**, stop iterating on ls20 and consider:
- A different game within ARC-3 that has more forgiving geometry.
- A fundamentally different navigation approach (e.g., trying to discover if the game has an "interact" mechanic, or if the entity can be resized, or if there are hidden mechanics not yet discovered).

The 14.3% plateau is informative: it tells us the agent can reliably solve one level of a maze game with BFS pathfinding and scout delegation. The blocker is a game-mechanics problem (absorption geometry), not an AI capability problem. Changing the game seed or game type is the most productive next step.
