# ARC-3 Delegation Experiment: v0.1.0 through v0.4.0 Comparative Analysis

**Date:** 2026-02-15
**Task:** arc3-ls20-cb3b57cc
**Model:** anthropic/claude-opus-4-6 (all four runs)
**Runs:** run-008 (v0.1.0), run-009 (v0.2.0), run-010 (v0.3.0), run-011 (v0.4.0)

---

## 1. Executive Summary

Four versions of the ARC-3 delegation plugins have been tested against the same puzzle (ls20-cb3b57cc, 7 levels required for a win). Each version fixed the previous version's primary failure mode while inadvertently introducing or exposing a new one:

- **v0.1.0** (20 iters, Flash scout): Total failure. Double-execution bug spawned two useless scouts consuming 42 game actions. Parent ran out of fuel before completing any level. No `return()` call. Score: 0.
- **v0.2.0** (20 iters, Sonnet scout): First level completion. Single scout consumed 7 actions with a high-quality report. Level 1 completed at iter 13. Ran out of iterations on level 2 with 56 fuel remaining. No `return()` call. Score: 0.
- **v0.3.0** (30 iters, Sonnet scout): Re-scouting capability added. Map-while-navigate pattern. Level 1 completed at iter 17. Entity stuck in a dead-end on level 2. No `return()` call. Score: 0.
- **v0.4.0** (30 iters, Sonnet scout): Mandatory `return()` guard pattern. Agent called `return()` for the first time in four versions (a breakthrough). But 0 levels completed -- a regression from v0.2.0 and v0.3.0. Agent misunderstood the level completion mechanism. Fuel depleted. Score: 0.

**The v0.4.0 paradox:** The `return()` guard was the single most-requested fix across three prior analyses. It worked. But solving the protocol problem coincided with a regression in the gameplay: the agent absorbed the marker twice yet never navigated into the top rectangle (Rect 1) to trigger level completion. In v0.2.0 and v0.3.0, level completion was *accidental* -- the agent navigated UP through the c34-38 corridor after marker absorption and happened to enter Rect 1 at r10-11. In v0.4.0, the agent explored the rectangles from below, got stuck at Rect 1's border, and burned all fuel on a marker-bouncing hypothesis. The level completion mechanism was never deliberately understood in any version.

**Implication for v0.5.0:** The plugin must encode the level completion mechanism explicitly. Four runs and ~80 combined iterations of gameplay have failed to produce a deliberate level completion. The agent can discover the marker absorption mechanic reliably, but the second step -- entering the top rectangle from above via the c34-38 corridor -- must be stated as an instruction, not left to exploration.

---

## 2. Version Comparison Table

| Metric | v0.1.0 (run-008) | v0.2.0 (run-009) | v0.3.0 (run-010) | v0.4.0 (run-011) | Trend |
|--------|------------------|------------------|------------------|------------------|-------|
| **Iteration budget** | 20 | 20 | 30 | 30 | Stable at 30 |
| **Scout model** | Flash (Gemini) | Sonnet | Sonnet | Sonnet | Sonnet stable since v0.2.0 |
| **Scout count (L1)** | 2 (double-exec) | 1 | 1 | 1 | Fixed in v0.2.0 |
| **Scout actions (L1)** | 42 | 7 | 6 | 4 | Improving: 42 -> 7 -> 6 -> 4 |
| **Scout report quality** | Low (discarded) | High (accepted) | High (accepted) | High (accepted) | Stable |
| **Double-execution bug** | Yes | No | No | No | Fixed in v0.2.0 |
| **Variable persistence loss** | Yes | Yes | Yes | Yes (2 iters wasted) | **Persistent across all versions** |
| **Dedicated mapping iters** | 3 | 5 | 2 | ~3 | Variable |
| **Level 1 completed** | No | Yes (iter 13) | Yes (iter 17) | **No** | **REGRESSION in v0.4.0** |
| **Level 1 action cost** | N/A | 24 | 33 | N/A (never completed) | N/A |
| **Re-scout on L2** | N/A | No | Yes (D2, incomplete) | N/A | N/A |
| **Levels completed** | 0 | 1 | 1 | 0 | Regression |
| **Called `return()`** | No | No | No | **Yes** | **FIXED in v0.4.0** |
| **Fuel at end** | 0 | 56 (28 moves) | 44 (22 moves) | 0 | Regressed |
| **Total game actions** | ~85 | 46 | 61 | 45 | Comparable |
| **Failure mode** | Fuel depletion | Iter exhaustion | Dead-end + no return | Objective misunderstanding | Different each run |
| **Wall time** | 255s | 336s | 515s | 558s | Increasing |
| **Cost estimate** | $0.63 | $0.77 | $1.46 | $1.27 | v0.4.0 lower (fewer iters used) |
| **Score** | 0 | 0 | 0 | 0 | Stuck at 0 |

---

## 3. Bottleneck Progression

Each version solved the previous version's primary bottleneck, only to reveal the next one:

| Version | Primary Bottleneck Fixed | New Bottleneck Exposed | Category Shift |
|---------|-------------------------|----------------------|----------------|
| v0.1.0 | (baseline) | Fuel depletion from bad scouts | Resource |
| v0.2.0 | Fuel (scout efficiency 42->7) | Iteration exhaustion | Resource -> Cognitive |
| v0.3.0 | Iteration budget (20->30) | Dead-end navigation + no return | Cognitive -> Protocol |
| v0.4.0 | `return()` guard pattern | Level completion mechanism unknown | Protocol -> Domain Knowledge |

The pattern is clear: each fix peels back one layer. The current frontier is *domain knowledge* -- the agent must understand what triggers level completion. No amount of protocol compliance or resource management will help if the agent does not know *what to do* with the marker and rectangles.

---

## 4. The v0.4.0 Paradox: `return()` Solved, Level Completion Regressed

### 4.1 What v0.4.0 Got Right

The mandatory `return()` guard pattern was a genuine breakthrough:

1. **Guard compliance:** The agent copied the guard verbatim into every code block. The `if (fuel <= 2) { return(JSON.stringify(score)); }` check triggered correctly when fuel hit 0 at iter 20.
2. **First `return()` in four versions.** The agent submitted `{"card_id":"ceb29e8e-...","score":0,"total_levels_completed":0,"total_actions":45}`. The error field was `null` (not "RLM reached max iterations without returning an answer"). This is a structural success.
3. **Best scouting efficiency yet.** D1 used only 4 game actions -- down from 42 (v0.1.0), 7 (v0.2.0), and 6 (v0.3.0). The scout report included a correct 6-action optimal route to the marker.
4. **Analysis-only delegation.** D2 (iter 16) was instructed to analyze the game state without taking any game actions. This preserved fuel. D2 used 0 actions and returned route recommendations. This is a new delegation pattern not seen in prior versions.

### 4.2 What v0.4.0 Got Wrong

Despite these improvements, v0.4.0 completed 0 levels -- a regression from both v0.2.0 and v0.3.0.

**Root cause: the agent never discovered the level completion trigger.** After absorbing the color 0/1 marker (which it did twice, at iters 9 and 17), the agent needed to navigate UP through the c34-38 corridor to r10-11, entering the top rectangle (Rect 1). This is the same mechanism that *accidentally* worked in v0.2.0 (iter 13) and v0.3.0 (iter 17). In v0.4.0, the agent took a different path after marker absorption:

| Version | After marker absorption | Next action | Result |
|---------|------------------------|-------------|--------|
| v0.2.0 | Marker absorbed at iter 9 | Explored, then navigated UP through c34-38 corridor (iters 11-13) | Level 1 completed at iter 13 |
| v0.3.0 | Marker absorbed at iter 11 | Explored alignment, navigated UP through c34-38 corridor (iters 13-17) | Level 1 completed at iter 17 |
| v0.4.0 | Marker absorbed at iter 9 | Explored rectangles from below (iters 10-15), stuck at Rect 1 border | Never completed |

The critical difference: v0.2.0 and v0.3.0 approached Rect 1 from *above* (via the c34-38 narrow corridor, entering at r10-11). v0.4.0 approached from *below* (reaching r15-16 c34-38, at the bottom edge of Rect 1). From below, the entity could not enter the rectangle's color-5 interior. From above, it entered the rectangle's open top and triggered level completion.

**This was never a deliberate strategy.** In all four versions, the agent did not understand that "enter Rect 1 from above" is the level completion trigger. In v0.2.0 and v0.3.0, the upward navigation through the c34-38 corridor happened to terminate inside Rect 1. In v0.4.0, the agent's exploration path happened to approach from the wrong direction.

---

## 5. Root Causes Specific to v0.4.0's Regression

### 5.1 Variable Persistence Loss (2 wasted iterations)

The `scoutReport` variable assigned from `rlm()` at iter 0 was not defined at iter 1. The `getEntityPosition` helper function defined at iter 2 was not available at iter 4. This cost 2 full iterations to redeclare infrastructure.

**Evidence from trajectory:**
- Iter 1: `scoutReport is not defined` -- variable from iter 0 delegation lost
- Iter 4: `getEntityPosition is not defined` -- helper function from iter 2 lost

This is a chronic issue across all four versions. The RLM sandbox does not persist user-defined variables or functions across iteration boundaries. The `__iter` counter persists because the guard pattern uses `typeof __iter === 'undefined'` to re-initialize it each time. But no equivalent pattern exists for scout reports or helper functions.

**Impact on v0.4.0 specifically:** Those 2 wasted iterations consumed cognitive budget during the critical early phase. The agent had to re-derive scout findings from printed output and re-implement utility functions, delaying productive navigation by 2 iterations.

### 5.2 Target Position Averaging Artifact

At iter 5, the agent's `findTarget()` function averaged all color 0 and color 1 pixels to compute the target position. But colors 0 and 1 appear both as the small marker cluster (at r31-33, c20-22) and as rectangle borders (Rect 1 and Rect 2). The average of all these pixels gave misleading coordinates: [39.3, 17.7] instead of the actual marker at [31-33, 20-22].

This triggered a detour at iter 6 where the agent investigated the apparent "target shift," consuming actions and fuel to understand a computational artifact. In v0.2.0 and v0.3.0, the parent used the scout's explicit marker coordinates directly and never averaged all color 0/1 pixels.

### 5.3 Rectangle Exploration Instead of Upward Navigation

After marker absorption at iter 9, the agent spent 6 iterations (10-15) exploring the two rectangles:

- Iter 10: Diagnosed changed state after marker absorption
- Iter 11: Scanned corridors, found c34-38 vertical path at r17-24
- Iter 12: Entity reached r15-16 c34-38, near Rect 1; noticed border toggling
- Iter 13: Attempted UP into Rect 1 from below -- blocked by color-5 interior
- Iter 14: Compared Rect 1 and Rect 2 patterns (2x scaling relationship)
- Iter 15: Escaped Rect 1 area with DOWN x3, wasting 9 fuel for zero progress

In v0.2.0, the equivalent phase (iters 10-13) was: explore -> navigate UP through corridor -> enter Rect 1 from above -> level complete. The crucial difference is that v0.2.0 entered the corridor at a lower row and navigated continuously upward through Rect 1, while v0.4.0 stopped at the border and tried to push through from below.

### 5.4 Marker Bouncing Strategy (iters 17-20)

After D2's analysis recommendation to re-collect the marker, the agent spent its last 9 actions (and 18 fuel) bouncing between the marker position and a down position to repeatedly absorb and respawn the marker. The hypothesis (H5) was that repeated collections would transform the Rect 2 pattern toward a target state that triggers level completion. While creative, this was incorrect -- the level completion mechanism is spatial (enter Rect 1), not cumulative (collect N markers).

### 5.5 The Return Guard's Indirect Contribution to the Regression

The `return()` guard itself did not cause the regression, but the plugin restructuring around it may have contributed. The v0.4.0 plugin's dominant emphasis on `return()` protocol -- the opening statement "YOUR #1 JOB IS TO CALL `return()`", the guard code taking the first 15 lines of every code block, and the return-focused Step 5 -- may have displaced space that could have described the level completion mechanism. The plugin's strategy section focuses on scouting, parsing, and returning, but provides no guidance on *what constitutes level completion* or *how to trigger it*.

---

## 6. Cross-Version Pattern: Accidental vs. Deliberate Level Completion

The most striking finding across four versions is that level completion has never been achieved deliberately:

| Version | Marker absorbed? | Navigated to Rect 1? | Entered Rect 1? | Level completed? | Deliberate? |
|---------|-----------------|----------------------|-----------------|-----------------|-------------|
| v0.1.0 | No | No | No | No | N/A |
| v0.2.0 | Yes (iter 9) | Yes (iters 11-13) | Yes (iter 13, from above) | **Yes** | **No** -- agent was navigating "to the upper room" |
| v0.3.0 | Yes (iter 11) | Yes (iters 16-17) | Yes (iter 17, from above) | **Yes** | **No** -- agent was navigating "up through corridor" |
| v0.4.0 | Yes (iters 9, 17) | Yes (iter 12-13) | No (stuck at border from below) | No | N/A |

In v0.2.0 and v0.3.0, the agent navigated UP through the c34-38 corridor as part of its general exploration. When the entity crossed from r15 to r10-11, it entered Rect 1's interior and the game state transitioned. The agent noticed the transition ("LEVEL 1 COMPLETED") but did not understand *why* it happened. This is evidenced by v0.2.0's H3 (iter 17): the agent tried to repeat the exact same action sequence for level 2 without understanding the causal mechanism.

The implication: **relying on accidental discovery is fragile.** v0.4.0 proves that a slightly different exploration path misses the trigger entirely. The level completion mechanism must be encoded in the plugin as explicit knowledge.

---

## 7. Delegation Economics Across Four Versions

| Version | Delegation | Cost (actions) | Cost (iters) | Value | ROI |
|---------|-----------|---------------|-------------|-------|-----|
| v0.1.0 D1+D2 | 2 Flash scouts | 42 | 2 | Zero (discarded) | **-infinity** |
| v0.2.0 D1 | 1 Sonnet scout | 7 | 1 | High (accepted, L1 enabled) | **+9x** |
| v0.3.0 D1 | 1 Sonnet scout | 6 | 2 | High (accepted, L1 enabled) | **+4x** |
| v0.3.0 D2 | 1 Sonnet re-scout | 8 | 1 | Low (incomplete, entity moved) | **-1x** |
| v0.4.0 D1 | 1 Sonnet scout | 4 | 1 | High (accepted, but L1 not completed) | **+3x** (scouting value unrealized) |
| v0.4.0 D2 | 1 Opus analysis | 0 | 1 | Medium (route suggestion) | **+0.5x** |

The trend in initial scouting is clear: action cost has dropped from 42 to 4 across four versions while quality has remained high since v0.2.0. D1 scouting is a solved problem. The open question is re-scouting (D2) -- v0.3.0's re-scout was wasteful (8 actions, incomplete report), while v0.4.0's analysis-only delegation was a creative but ultimately insufficient alternative.

---

## 8. Recommendations for v0.5.0

All recommendations are **plugin-only changes** -- no harness or engine modifications.

### 8.1 Encode the Level Completion Mechanism (CRITICAL)

The single highest-impact change. Add to `arc3-delegation-test.md`, in the Strategy section after Step 1:

```markdown
### Level Completion Mechanism (CRITICAL -- discovered from prior runs)

The game follows a two-step level completion pattern:

1. **Absorb the marker:** Navigate the entity to the color 0/1 marker cluster.
   On contact, the marker disappears and the two rectangles activate (borders
   change color).

2. **Enter the top rectangle from ABOVE:** After marker absorption, navigate
   the entity UP through the narrow corridor at columns 34-38 until it reaches
   rows 10-11. The entity enters the top rectangle (Rect 1, approximately
   r9-15 c33-39) from its open top side. This triggers level completion.

**CRITICAL:** You MUST approach Rect 1 from ABOVE (via the c34-38 corridor).
Approaching from below (r15-16) will NOT work -- the color 5 interior blocks
entry from that direction. The correct route after marker absorption is:
navigate to c34-38, then UP repeatedly until level completion fires.

Do NOT spend iterations analyzing the rectangle patterns. Do NOT bounce
between the marker and rectangles. After absorbing the marker, go UP.
```

**Expected impact:** Eliminates the primary v0.4.0 failure. The agent would know the completion mechanism without needing to discover it through exploration.

### 8.2 Fix Variable Persistence Loss (HIGH PRIORITY)

Add to `arc3-delegation-test.md`, immediately after the Return Guard section:

```markdown
### Variable Persistence Warning

**Variables and functions do NOT persist across iterations.** The sandbox
resets between code blocks. This means:
- `scoutReport` from an `rlm()` call will NOT be available in the next iteration
- Helper functions like `getEntityPosition()` must be redefined every iteration

**Workaround:** Redefine all helpers at the top of every code block, after the
return guard. Print critical data (scout report, positions) to the console --
the console output is visible in your conversation history even though
variables are lost.

**Template for every code block after scouting:**
```

Then provide this reusable block:

```javascript
// === HELPERS (must redefine each iteration -- variables don't persist) ===
function getEntityPosition(g, color) {
  let rMin = 64, rMax = 0, cMin = 64, cMax = 0;
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === color) {
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      }
  return { rMin, rMax, cMin, cMax };
}

function findColor(g, color) {
  const positions = [];
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === color) positions.push([r, c]);
  return positions;
}

function countColor(g, color) {
  let n = 0;
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === color) n++;
  return n;
}
// === END HELPERS ===
```

**Expected impact:** Eliminates the 2 wasted iterations observed in v0.4.0 (iters 1 and 4). Saves ~10% of the iteration budget.

### 8.3 Fix Target Position Calculation (HIGH PRIORITY)

Add to the navigation guidance in `arc3-delegation-test.md`:

```markdown
### Finding the Marker Position

**Do NOT average all pixels of colors 0 and 1.** Colors 0 and 1 appear both
as the small marker cluster AND as rectangle borders. Averaging all pixels
gives misleading coordinates.

Instead, find the marker by looking for a SMALL cluster (2-5 pixels) of
colors 0/1 that is separate from the rectangles:

```javascript
function findMarker(g) {
  // Find all color 0 and color 1 positions
  const c0 = findColor(g, 0);
  const c1 = findColor(g, 1);
  const all = [...c0, ...c1];
  if (all.length === 0) return null; // marker already absorbed

  // The marker is a small cluster (2-5 pixels) separate from rectangles.
  // Rectangles are at rows 9-15 and rows 53-62. Filter those out.
  const markerPixels = all.filter(([r, c]) =>
    !(r >= 9 && r <= 15 && c >= 33 && c <= 39) &&  // not Rect 1
    !(r >= 53 && r <= 62 && c >= 1 && c <= 10)      // not Rect 2
  );
  if (markerPixels.length === 0) return null;

  const avgR = markerPixels.reduce((s, p) => s + p[0], 0) / markerPixels.length;
  const avgC = markerPixels.reduce((s, p) => s + p[1], 0) / markerPixels.length;
  return { row: Math.round(avgR), col: Math.round(avgC) };
}
```

**Expected impact:** Eliminates the target-shift confusion that cost v0.4.0 an iteration (iter 6) and diverted the agent's attention.

### 8.4 Add Fuel Budgeting Guidance (MEDIUM PRIORITY)

Add to the Critical Rules section of `arc3-delegation-test.md`:

```markdown
7. **Fuel budgeting.** You start with 84 fuel (42 moves). The scout uses
   ~4-7 moves. Level 1 navigation requires ~12-15 moves. That leaves ~20
   moves for level 2. Do NOT spend more than 5 moves on exploration after
   marker absorption -- go directly UP through the c34-38 corridor. Every
   blocked move wastes 2 fuel. Check fuel (`countColor(grid, 11)`) every
   3-4 actions.
```

**Expected impact:** Prevents the fuel exhaustion that occurred in v0.4.0 (84 fuel consumed in 45 actions across rectangle exploration and marker bouncing).

### 8.5 Consolidate the Return Guard with Fuel Check (MEDIUM PRIORITY)

The v0.4.0 return guard checks iteration count and game state but not fuel. Add a fuel check:

```javascript
// === RETURN GUARD (MANDATORY -- COPY THIS VERBATIM) ===
if (typeof __iter === 'undefined') __iter = 0;
__iter++;
console.log(`--- Iteration ${__iter} of ~30 ---`);

// Check 1: Near iteration limit
if (__iter >= 25) {
  console.log("APPROACHING LIMIT -- RETURNING SCORE NOW");
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}

// Check 2: Game finished
const __f = arc3.observe();
if (__f && (__f.state === "WIN" || __f.state === "GAME_OVER")) {
  console.log("GAME ENDED -- RETURNING SCORE");
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}

// Check 3: Fuel critically low (< 6 = 3 moves)
const __fuel = (() => {
  let n = 0;
  const g = __f.frame[0];
  for (let r = 0; r < 64; r++)
    for (let c = 0; c < 64; c++)
      if (g[r][c] === 11) n++;
  return n;
})();
if (__fuel < 6) {
  console.log(`FUEL CRITICAL (${__fuel}px) -- RETURNING SCORE NOW`);
  const score = await arc3.getScore();
  return(JSON.stringify(score));
}
console.log(`Fuel: ${__fuel}px (~${Math.floor(__fuel/2)} moves)`);
// === END RETURN GUARD ===
```

**Expected impact:** Returns earlier when fuel is nearly depleted, rather than waiting for exact zero. In v0.4.0, the last 4 iterations (17-20) consumed 8 fuel on futile marker bouncing. With a fuel threshold of 6, the guard would have fired at iter 18 (fuel=8), saving 2 wasted iterations.

### 8.6 Streamline Post-Marker Navigation in Plugin Steps (MEDIUM PRIORITY)

Replace the current Step 3 ("Navigate Toward Objectives") with two explicit sub-steps:

```markdown
#### Step 3a: Navigate to the Marker

Using the scout report and `findMarker()`, navigate to the color 0/1 marker
cluster. The marker is typically at approximately r31-33, c20-22 (level 1).
Use the c19-23 vertical corridor to reach the marker's row, then move
DOWN/UP to overlap it.

When the marker disappears (colors 0/1 pixel count drops to near 0 from the
marker area), the marker has been absorbed. Proceed immediately to Step 3b.

#### Step 3b: Enter Rect 1 from Above (Level Completion)

After marker absorption, navigate to column alignment c34-38 and then go
UP repeatedly. The c34-38 corridor is narrow (exactly 5 pixels wide) and
runs from approximately r17-24. Continue UP until `levels_completed`
increases.

Do NOT explore the rectangles. Do NOT analyze patterns. Go UP.
```

**Expected impact:** Gives the agent a clear two-phase recipe instead of a generic "navigate toward objectives" instruction. This directly addresses v0.4.0's failure to navigate UP after marker absorption.

### 8.7 Scout Plugin: Add Corridor Directionality (LOW PRIORITY)

Add to `arc3-scout.md` Phase 3:

```markdown
When mapping corridors, also note **which directions are open** from key
positions. For the c34-38 corridor: can the entity enter from below (r24+)
and exit at the top (r9-10)? For horizontal corridors: which intersections
connect vertical paths?

This directionality information helps the parent plan routes that avoid
dead-ends.
```

**Expected impact:** Marginal improvement to scout reports. The scout already maps corridors well; this adds directional context that could prevent dead-end navigation (as seen in v0.3.0 iter 26).

---

## 9. Priority Summary

| # | Recommendation | Priority | Effort | Target Failure Mode | Expected Impact |
|---|---------------|----------|--------|---------------------|-----------------|
| 1 | Encode level completion mechanism | CRITICAL | 15 min | v0.4.0 objective misunderstanding | Enables deliberate level 1 completion |
| 2 | Fix variable persistence (helper redeclaration) | HIGH | 15 min | v0.4.0 iters 1, 4 wasted | Saves 2 iterations per run |
| 3 | Fix target position calculation | HIGH | 10 min | v0.4.0 iter 5-6 target confusion | Saves 1 iteration per run |
| 4 | Add fuel budgeting guidance | MEDIUM | 5 min | v0.4.0 fuel exhaustion | Prevents over-exploration |
| 5 | Return guard with fuel check | MEDIUM | 10 min | Fuel-zero without return | Earlier return on fuel depletion |
| 6 | Streamline post-marker steps | MEDIUM | 15 min | v0.4.0 rectangle exploration | Direct path to level completion |
| 7 | Scout corridor directionality | LOW | 10 min | v0.3.0 dead-end navigation | Better route planning |

**Total estimated effort for all changes: ~80 minutes of plugin editing.**

If only one change is made, it should be recommendation #1 (encode the level completion mechanism). This single addition would have converted v0.4.0 from 0 levels to at least 1 level completed -- and with the `return()` guard already working, that level would have produced the first nonzero score in the experiment series.

---

## 10. Projected v0.5.0 Outcome

With recommendations 1-6 implemented, the projected v0.5.0 run would look like:

| Phase | Iterations | Actions | Notes |
|-------|-----------|---------|-------|
| Scout delegation (D1) | 1 | 4 | Same as v0.4.0 |
| Parse + verify (redeclare helpers) | 1 | 0 | No persistence loss |
| Navigate to marker | 3-4 | 10-12 | Direct route via c19-23, no target confusion |
| Absorb marker | 1 | 1-2 | Touch marker at r31-33 c20-22 |
| Navigate UP to Rect 1 | 2-3 | 6-8 | Known route: c34-38 corridor to r10-11 |
| **Level 1 total** | **8-10** | **21-26** | **vs 13 (v0.2.0), 17 (v0.3.0), never (v0.4.0)** |
| Re-scout level 2 | 1-2 | 4-6 | Map changed maze |
| Navigate level 2 | 8-12 | 15-25 | New marker position, new corridor layout |
| Return guard fires | -- | -- | On fuel depletion, iter limit, or game end |

**Projected levels completed: 2 (possibly 3 with efficient navigation)**
**Projected score: 0.05-0.15 (first nonzero score in the series)**

The combination of explicit level completion knowledge (recommendation 1), the working `return()` guard (v0.4.0 achievement), and efficiency improvements (recommendations 2-6) should break the score=0 barrier that has persisted across all four versions.

---

## 11. Broader Lessons

### 11.1 Accidental Success Is Not Repeatable

The most important lesson from v0.4.0 is that accidental discoveries are fragile. v0.2.0 and v0.3.0 completed level 1 because the agent's exploration path happened to pass through the level trigger. v0.4.0 took a slightly different path and missed it entirely. For a system to be reliable, critical domain knowledge must be encoded explicitly, not left to chance.

### 11.2 Plugin Instructions Compete for Attention

v0.4.0's plugin opened with "YOUR #1 JOB IS TO CALL `return()`" and dedicated significant space to the return protocol. This succeeded at making the agent call `return()`. But the emphasis on protocol may have crowded out navigation strategy. Plugin design is a zero-sum attention game -- every instruction competes with every other instruction for the model's focus. The v0.5.0 plugin must balance protocol compliance with domain knowledge.

### 11.3 The Fix-One-Break-Another Pattern

Four versions exhibit a pattern where fixing one problem destabilizes another:

- v0.2.0 fixed scouting, which enabled level 1 but revealed iteration exhaustion
- v0.3.0 fixed iterations, which revealed maze navigation difficulty and protocol failure
- v0.4.0 fixed protocol, which revealed domain knowledge gap

This is not coincidental. Each fix changes the agent's behavior in ways that expose previously-masked weaknesses. The implication: v0.5.0 should anticipate that encoding level completion knowledge will *also* expose a new failure mode (likely level 2 navigation difficulty or multi-level scaling). The recommendations above include defensive measures (fuel budgeting, re-scouting) to address probable next-layer failures.

### 11.4 Delegation Quality Has Converged

Scout efficiency has improved monotonically (42 -> 7 -> 6 -> 4 actions) and report quality has been consistently high since v0.2.0. Initial scouting is a solved problem for this domain. Further investment in scout optimization has diminishing returns. The bottleneck is now in the parent's ability to *use* the scout data effectively -- a problem of domain knowledge and strategy, not information quality.
