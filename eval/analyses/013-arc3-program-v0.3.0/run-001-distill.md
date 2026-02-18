# Run 001 Distillation: ARC-3 Program v0.3.0

**Date:** 2026-02-18
**Config:** `--max-iterations 10 --max-depth 3 --program arc3`
**Model:** `anthropic/claude-opus-4-6`
**Result:** 0% score, 0/7 levels, 129 game actions, 4 root iterations, 6m37s, $0.40
**Replay:** https://three.arcprize.org/scorecards/30b665aa-aecc-4d91-bd9c-46c1d8726e42

---

## Executive Summary

The program architecture was **completely ignored**. The root agent never loaded any program node. It did not act as a GameSolver. It did not delegate to a LevelSolver with `app: "arc3-level-solver"`. No OHA agent was ever spawned. Instead, the root agent improvised from scratch -- analyzing the grid manually, making 129 aimless movement actions on level 0, and never completing any level. The entire 3-tier architecture (GameSolver -> LevelSolver -> OHA) existed only on paper.

---

## 1. Trajectory

### Root Iteration 1: Setup + Failed Delegations (0 game actions)

The root agent's first iteration contained **10 code blocks** -- a massive monologue spanning game initialization through multiple delegation attempts. Here is what happened:

1. Called `arc3.start()` and initialized `__gameKnowledge` correctly.
2. Analyzed the grid: found a 64x64 frame with colors 0-15, identified a non-zero region spanning the full grid.
3. Initialized `__levelState` with level 0, attempt 1, budget 40.
4. **Delegated to "LevelSolver"** with `rlm(prompt, null, { model: "intelligent", maxIterations: 20, app: "LevelSolver" })`.
5. The delegation returned **immediately** with no actions taken. The `LevelSolver` app name was wrong (should be `arc3-level-solver` per the program node name).
6. Checked state: 0 actions, 0 levels completed. `__gameKnowledge` remained empty.
7. **Assumed level 0 was completed** (incorrectly -- the code says `level_outcomes[0] = { completed: true, actions_used: 0 }` despite no actions).
8. Delegated again for "level 1" with the same wrong app name. Again returned with 0 actions.
9. Delegated 4 more times in the same iteration, all returning immediately with 0 actions.
10. Called `arc3.getScore()` which failed with 404 (game not finished).

**Key failure:** All 6 `rlm()` delegations in iteration 1 used `app: "LevelSolver"` -- a nonexistent app name. The program nodes are named `arc3-level-solver` and `arc3-oha`. The root never discovered or corrected this.

### Root Iteration 2: Direct Play Attempt (118 game actions)

Realizing the delegations produced nothing ("The LevelSolver delegations aren't working - they're not taking any actions"), the root agent abandoned delegation and began playing directly. This iteration contained **22 code blocks** -- the longest single iteration in the trace.

**Phase 1: Grid analysis and player identification (0 actions)**
- Printed the full 64x64 grid.
- Identified colors 0 and 1 at rows 31-33, cols 24-26 as the "player sprite."
- Found special objects: color 12 at (45,39-43), color 11 at (49,42), color 9 at (11,35-38).
- Noted a top box (rows 8-16, cols 33-41) with a pattern, and a maze structure of color-3 corridors and color-4 walls.

**Phase 2: Blind navigation (actions 1-109)**
- Pressed Right 1 time -- confirmed player movement.
- Moved Down 10, Right 15, Up 15, Right 25, Down 25, Left 12, Down 1, Left 5.
- **Critical misunderstanding:** The player position at (31,21) appeared NOT to move in the output. The agent was confused -- the player sprite (colors 0,1) was indeed moving, but the grid also had other structures using colors 0 and 1 (box borders), creating false positives in the player-finding code.
- Tried to "pick up" colored objects at (49,37) and (49,42) by walking over them. Reported success but then found the objects were still there -- the player sprite overlapping created the illusion of collection.
- Explored the HUD area (bottom-left box with color 9 pattern, bottom bar with color 11 progress indicator).

**Phase 3: Sokoban hypothesis (actions 110-118)**
- Tried pushing objects by approaching from different angles. Objects did not move.
- Examined the bottom section, left edge, and corridor structure.
- Still had no understanding of the win condition.

### Root Iteration 3: Belated Understanding + Exhaustion (actions 119-197 + child)

**Phase 1: Breakthrough realization (action 119)**
At the start of iteration 3, the agent finally realized:
- The player at (31,21) had NOT been moving despite 118 actions.
- The colored block (colors 12 and 9) WAS moving.
- Colors 0 and 1 appeared in many places (box borders, HUD borders) -- the "player" detection had been wrong.

After pressing Right once more (action 119), the agent confirmed:
- Color 12 block moved from cols 19-23 to cols 20-24.
- The player sprite (0,1) at (31-33, 20-22) also moved right to (31-33, 21-23).
- Both the player and the colored block moved together, linked at a fixed spatial offset.

**Phase 2: Exploration with correct understanding (actions 120-165)**
- Moved Up 6: block went from rows 45-46 to rows 39-40, player from rows 31-33 to rows 25-27.
- Moved Right 15: player entered the vertical corridor at cols 34-37.
- Moved Up 15: player entered the top box (rows 15-17).
- Moved Up 10 more: player at row 9 (top of box interior).
- Still NOT_FINISHED after 165 actions.

**Phase 3: Resource exhaustion and panic (actions 166-197)**
- Progress bar (color 11) dropped to 4 pixels, then 0.
- Tried Undo (action 7) -- not available (only actions 1-4).
- Moved Down 20 -- block barely moved, likely hit maze boundary.
- 186 actions used. All resource indicators depleted.
- Took 11 more aimless actions (187-197). Still NOT_FINISHED.

**Phase 4: Late delegation (actions 198-?)**
Finally delegated to a child (without any app name this time) with `maxIterations: 15`, passing the full 64x64 grid as a hex string in the prompt.

### Child (depth 1, iteration 1): Analysis + Truncation

The child received the full grid state and 197 actions of context. It:
1. Extracted the top box and bottom-left box patterns.
2. Found the player (0,1) at (31-33, 20-22) and block (12) at (25-26, 49-53).
3. Mapped the maze corridors with a visual representation (`.` for floor, `#` for wall).
4. Compared the reference patterns in the two boxes.
5. Tried moving (right, down, down, right) -- **3 more game actions**.
6. **TRUNCATED** (`finish=length`): The reasoning text was cut off mid-sentence at "Let me take a more strategic approach. I'll map the maze as a grid of cells and use B" -- the model hit its output token limit.

When the child's iteration 1 tried to execute its last code block, it received: "Game already completed" -- meaning the game had ended (GAME_OVER) during or after the parent's actions. The child reported the scorecard.

### Child (depth 1, iteration 2): Scorecard retrieval

The child confirmed GAME_OVER with 0 levels completed, returned the scorecard JSON.

### Root Iteration 4: Score retrieval

The root agent confirmed GAME_OVER and returned the scorecard. Final score: 0%.

---

## 2. Delegation Behavior

### Complete Program Failure

The 3-tier program architecture was **never instantiated**:

| Intended Tier | Program Node Name | App Used in Code | Actually Loaded? |
|---|---|---|---|
| GameSolver | `arc3-game-solver` | (root, loaded by harness) | Unclear -- root did not act as GameSolver |
| LevelSolver | `arc3-level-solver` | `"LevelSolver"` (wrong) | **No** |
| OHA | `arc3-oha` | Never referenced | **No** |

**Root cause:** The root agent used `app: "LevelSolver"` in all 6 delegation attempts in iteration 1. The correct app name is `arc3-level-solver` (as defined in the program node YAML frontmatter `name: arc3-level-solver`). The wrong name caused the child to load with no specialized system prompt, so it had no instructions and returned immediately.

In iteration 3, the root delegated once more -- this time with NO `app` parameter at all. The child ran as a generic RLM agent, spending 2 iterations analyzing the grid before hitting GAME_OVER.

**No OHA agent was ever created.** The 3rd tier (depth 2) was never reached. Maximum actual depth was 1 (one child).

### Delegation Tally

| Delegation | App Param | Depth | Iterations | Actions Taken | Useful? |
|---|---|---|---|---|---|
| 1 (iter 1) | `"LevelSolver"` | 1 | 0 (no-op) | 0 | No |
| 2 (iter 1) | `"LevelSolver"` | 1 | 0 (no-op) | 0 | No |
| 3 (iter 1) | `"LevelSolver"` | 1 | 0 (no-op) | 0 | No |
| 4 (iter 1) | `"LevelSolver"` | 1 | 0 (no-op) | 0 | No |
| 5 (iter 1) | `"LevelSolver"` | 1 | 0 (no-op) | 0 | No |
| 6 (iter 1) | `"LevelSolver"` | 1 | 0 (no-op) | 0 | No |
| 7 (iter 3) | (none) | 1 | 2 | ~3 | No |

Total: 7 delegations, 0 useful. The children contributed nothing.

---

## 3. State Management

### __gameKnowledge

Initialized in iteration 1 with the correct schema template:
```javascript
__gameKnowledge = {
  confirmed_mechanics: {},
  object_catalog: {},
  level_outcomes: {},
  open_questions: [],
  refuted_beliefs: []
};
```

**Never meaningfully populated.** The final state shows:
- `confirmed_mechanics: {}` -- empty despite 129 actions of exploration.
- `object_catalog: {}` -- empty despite discovering multiple object types.
- `level_outcomes` contains **erroneous entries**: `{0: {completed: true, actions_used: 0}, "-1": {completed: true}}` -- the root falsely recorded level 0 as completed with 0 actions. The `-1` key is a bug from `frame.levels_completed - 1` when `levels_completed` was 0.
- `open_questions: []` -- empty despite many unresolved questions.
- `refuted_beliefs: []` -- empty despite several hypotheses being disproven.

### __levelState

Initialized multiple times (once per delegation attempt in iteration 1, once more in iteration 3). Final state:
```javascript
__levelState = {
  level: 0,
  attempt: 2,
  actions_taken: 129,  // only updated in iteration 3's delegation
  action_budget: 100,
  current_strategy: "analyze_pattern_and_solve",
  world: {},           // NEVER populated
  hypotheses: {},      // NEVER populated
  observation_history: []  // NEVER populated
};
```

**Shared state completely failed.** The sandbox variable isolation issue (known from prior runs) was NOT the cause here -- the root agent simply never wrote meaningful data to these structures. The child agents, having no program-node instructions, also never wrote to them.

---

## 4. Program Compliance

### GameSolver Contract Violations

The root was supposed to act as GameSolver. Here is how it violated every contract clause:

| Contract Clause | Compliance | Details |
|---|---|---|
| `__gameKnowledge` grows after every delegation | **Violated** | Remained empty throughout |
| Failed strategies recorded | **Violated** | No strategies recorded |
| Delegation prompt contains actionable knowledge brief | **Violated** | Prompts contained generic instructions, not concrete facts |
| Failed hypothesis triggers alternative | **Violated** | No hypothesis tracking at all |
| Retry prompt includes new instruction | **Partially** | Different prompts but not informed by failure analysis |
| Open questions preserved | **Violated** | None recorded |
| Return `arc3.getScore()` when game ends | **Done** | Returned scorecard in iteration 4 |
| Cannot call `arc3.step()` | **VIOLATED** | Root called `arc3.step()` directly in iterations 2 and 3 (118+ actions) |
| Cannot interpret frame pixel data | **VIOLATED** | Root wrote extensive grid analysis code |

The root broke the two most critical constraints: it called `arc3.step()` directly (forbidden -- only OHA should do this) and interpreted pixel data (supposed to be done only by code-writing agents at the leaf level).

### LevelSolver Contract

Never instantiated. No LevelSolver agent was ever loaded.

### OHA Contract

Never instantiated. No OHA agent was ever created.

### OHA Cycle (Observe -> Hypothesize -> Act -> Observe -> Record)

Never executed as designed. The root's direct play was purely ad-hoc: observe, try something, observe again, try something else. No hypotheses were formally created, tested, or recorded.

---

## 5. Game Actions

### Action Summary

- **Total actions:** 129 (reported by `arc3.actionCount`)
- **Levels completed:** 0/7
- **Available actions:** [1, 2, 3, 4] (Up, Down, Left, Right only -- no Interact, Click, or Undo)
- **Score:** 0%

### Action Breakdown by Phase

| Phase | Actions | Direction | Effect |
|---|---|---|---|
| Iter 2: Initial Right | 1 | Right | Player moved 1 pixel right |
| Iter 2: Down 10 | 10 | Down | Player moved ~6 rows (hit wall) |
| Iter 2: Right 15 | 15 | Right | Player barely moved (hit wall) |
| Iter 2: Up 15 | 15 | Up | Moved up to row 26-28 |
| Iter 2: Right 25 | 25 | Right | Moved to cols 50-52 |
| Iter 2: Down 25 | 25 | Down | Moved to row 48 |
| Iter 2: Left 12 | 12 | Left | Moved to cols 40-42 |
| Iter 2: Down 1 | 1 | Down | Row 49 |
| Iter 2: Left 5 | 5 | Left | Cols 35-37 |
| Iter 2: Up 3 + push attempts | 6 | Mixed | Testing object interaction |
| Iter 2: Various exploration | ~5 | Mixed | Examining structures |
| Iter 3: Right 1 (discovery) | 1 | Right | Confirmed block movement |
| Iter 3: Up 6 | 6 | Up | Block to rows 39-40 |
| Iter 3: Right 15 | 15 | Right | Player to corridor (cols 36-38) |
| Iter 3: Up 25 | 25 | Up | Player into top box (row 9) |
| Iter 3: Down 20 | 20 | Down | Back down |
| Iter 3: Various | ~11 | Mixed | Last gasps |
| Child: 3 moves | 3 | Mixed | Right, Down x2 |

**Total arc3.step() calls in code:** Approximately 197 (the output says "197 actions used"), but only 129 were registered by the API. The discrepancy is because many `arc3.step()` calls hit walls and may not have been counted, or the agent miscounted.

**API-reported actions:** 0 (the scorecard shows `"actions": 0, "total_actions": 0`). This is a separate issue -- the ARC3 API's scorecard was fetched before the game session was properly closed, or there is a registration bug. The local `arc3.actionCount` reported 129.

### What the Game Actually Was

Based on the grid analysis in the trace:
- **Layout:** A maze of color-3 corridors on color-4 walls, within a color-5 border frame.
- **Player:** A 3x3 sprite (colors 0, 1) at rows 31-33, linked to a 5x5 colored block (colors 12 and 9) at rows 45-49. They move together with a fixed spatial offset.
- **Top box:** Rows 8-16, cols 33-41 -- a reference pattern (color 9 forming a specific shape inside color 5).
- **Bottom-left box:** Rows 53-62, cols 1-10 -- another pattern (scaled version of the top box pattern).
- **Bottom bar:** Color 11 progress indicator (decreased with each action) and color 8 markers.
- **Available actions:** Only directional movement (1-4). No Interact, Click, or Undo.
- **Win condition:** Unknown/never discovered. The agent never completed level 0.

---

## 6. Failure Modes

### Primary Failure: Program Not Loaded

The most critical failure is that the 3-tier program architecture was never instantiated. The root agent either:
1. Was not loaded with the `arc3-game-solver` system prompt, OR
2. Was loaded with it but ignored all instructions.

Evidence for option 2: The root DID initialize `__gameKnowledge` with the correct schema from the program spec, and DID attempt to delegate to "LevelSolver" -- suggesting it had some awareness of the program structure. But it used the wrong app name (`"LevelSolver"` instead of `"arc3-level-solver"`), and when delegation failed, it abandoned the architecture entirely.

### Secondary Failure: Wrong App Names

All 6 delegations used `app: "LevelSolver"` -- the role name from the YAML, not the actual `name` field. The program spec defines `name: arc3-level-solver` but the `role: coordinator` field says nothing about "LevelSolver." The agent may have inferred the app name from the program composition diagram:
```
GameSolver
  delegates -> LevelSolver
```
...and used "LevelSolver" literally as the app parameter.

### Tertiary Failure: Player Identification Error

For the first 118 actions, the agent believed the player was at (31-33, 20-22) because it scanned for colors 0 and 1. But colors 0 and 1 also appeared in box borders (top box border at rows 9,15 and bottom-left box border at rows 53,62). The player scan returned false positives from these borders.

The agent spent many actions moving in directions where the player appeared stuck -- but the player WAS moving (confirmed by color-12 block displacement). The agent simply could not detect the movement because its player-detection code was confused by border pixels.

This is exactly the failure mode that the OHA spec's "POSITION TRACKING" invariant was designed to prevent: "Track player position by accumulating movement deltas from frame diffs, NOT by re-scanning for player colors each frame."

### Quaternary Failure: No Hypothesis Discipline

The agent formed ad-hoc theories ("maybe it's Sokoban," "maybe I need to reach the top box," "maybe the block needs to match the reference pattern") but never formalized, tested, or refuted any of them. Without the OHA cycle's structured hypothesis management, the agent jumped between theories without systematic evidence gathering.

### Budget Exhaustion

129 game actions on level 0 alone. The human baseline for level 0 is 29 actions. The agent used 4.4x the human budget without completing the level. The GameSolver's budget strategy (40 initial, 60 retry, skip after 300) was never enforced because the GameSolver contract was never followed.

---

## 7. The `finish=length` Truncation

### Location

The truncation occurred in the **child agent** (depth 1), **iteration 1** -- the only delegation that actually executed code.

### What Was Truncated

The child's iteration 1 reasoning contained 8 code blocks analyzing the grid and maze structure. The reasoning text was cut off mid-sentence in the 8th code block:

```
// Let me take a more strategic approach. I'll map the maze as a grid of cells
// and use B
```

The "B" was almost certainly the beginning of "BFS" (Breadth-First Search) -- the child was about to implement pathfinding through the maze. This is exactly the `shortestPath` capability described in the OHA spec.

### Impact

The truncation prevented the child from:
1. Implementing a pathfinding algorithm to navigate the maze.
2. Taking any meaningful game actions (it only managed 3 moves before the game ended).
3. Discovering the win condition through systematic exploration.

However, the truncation's impact was limited because the game was already GAME_OVER by the time the child executed its code. The 129 actions taken by the parent had already exhausted the game (likely a resource/time limit, though the state remained NOT_FINISHED until the child's code triggered the GAME_OVER check).

### Why It Happened

The child received an enormous prompt: the full 64x64 grid as hex text (4,096 characters of grid data), plus 197 actions of context, plus prior knowledge. Combined with 8 code blocks of analysis in its response, the model hit its output token limit. The OHA spec's structured cycle would have produced much shorter, more focused outputs.

---

## 8. Key Findings for v0.3.1

### The Program Loading Mechanism Is Broken or Nonexistent

The most urgent finding: the `--program arc3` flag either did not load the program nodes as system prompts, or the agent's system prompt did not include the correct app names for delegation. The agent should have received the `arc3-game-solver` instructions as its system prompt, including the exact app names to use for delegation. If it did receive them, it failed to use the correct names.

**Action needed:** Verify that `--program arc3` injects `game-solver.md` as the root agent's system prompt AND makes `arc3-level-solver` and `arc3-oha` available as app names for `rlm({app: "..."})`.

### App Name Discovery

Even if the program is loaded correctly, the agent must know the exact string to pass as `app`. The program spec uses readable names like "LevelSolver" in the composition diagram but the YAML `name` field uses `arc3-level-solver`. This mismatch caused all delegations to fail.

**Action needed:** Either (a) make the composition diagram use the exact app names, or (b) add explicit delegation examples with the correct app strings in the GameSolver and LevelSolver specs.

### Depth Was Never Tested

The run used `--max-depth 3` to enable 3-tier delegation, but maximum actual depth was 1. The OHA tier (depth 2) was never reached. The `maxIterations` exhaustion at depth 0 meant fewer delegation opportunities.

### The Root Iterated Only 4 Times (of 10 available)

With `--max-iterations 10`, the root used only 4 iterations. This is because:
- Iteration 1: 10 code blocks (delegated 6 times, all no-ops).
- Iteration 2: 22 code blocks (direct play, ~118 actions).
- Iteration 3: 12 code blocks (continued play + 1 delegation). Hit GAME_OVER.
- Iteration 4: 1 code block (score retrieval).

The model packed enormous amounts of work into each iteration via multiple code blocks. The iteration budget was not the binding constraint -- the game ending (GAME_OVER) was.

### Cost Efficiency

At $0.40 for 129 actions and 0% score, this is the cheapest ARC-3 run in the project history but also among the worst outcomes. For comparison, v1.8.0 cost $3.63 for 180 actions. The lower cost reflects fewer LLM calls (only 4 root iterations + 2 child iterations = 6 LLM turns total, versus the multi-delegation runs of v1.x).

---

## 9. Comparison with Plugin Architecture (v1.x)

| Dimension | v1.x (best: v1.7.0) | v0.3.0 Program |
|---|---|---|
| Score | 14.3% (best) | 0% |
| Levels completed | 1/7 (best) | 0/7 |
| Delegation depth | 2 (orchestrator -> player) | 1 (root -> generic child) |
| Child returns | 1/4 useful (25%) | 0/7 useful (0%) |
| Actions | 356 | 129 |
| Cost | $4.80 | $0.40 |
| Architecture adherence | Partial | None |
| App loading | Correct (`arc3-orchestrator`, `arc3-player`) | Wrong (`"LevelSolver"`) |

The plugin architecture (v1.x), while imperfect, at least loaded the correct apps for delegation. The program architecture adds a third tier and more structure, but this structure was never activated.

---

## 10. Recommendations

1. **Fix program loading**: The `--program arc3` flag must inject `game-solver.md` as the root system prompt and register `arc3-level-solver` and `arc3-oha` as available apps.

2. **Explicit app name examples**: Add delegation code examples to each program node spec with the exact `app` string:
   ```javascript
   // In game-solver.md:
   await rlm(prompt, null, { app: "arc3-level-solver" })
   // In level-solver.md:
   await rlm(prompt, null, { app: "arc3-oha" })
   ```

3. **Verify child loading**: Before running the next eval, test that `rlm("test", null, { app: "arc3-level-solver" })` actually loads the level-solver system prompt.

4. **Root should not call arc3.step()**: The GameSolver contract forbids this, but the agent violated it immediately when delegation failed. Consider engine-level enforcement (as with budget enforcement in v1.x).

5. **Reduce prompt bloat**: The iteration-3 delegation passed the full 64x64 grid as hex text in the prompt. This consumed tokens and contributed to the `finish=length` truncation. The program spec's shared-state design (`__levelState.world`) is supposed to avoid this -- the grid should be parsed into structured data, not passed raw.
