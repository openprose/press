# Run-002 Distillation: v0.3.1 Program System

**Run ID:** `arc3_anthropic_claude-opus-4-6_2026-02-18T04-45-30-230Z`
**Score:** 0% (0/7 levels, 0 completed)
**Actions:** 65 total on level 0 (131 before GAME_OVER including the re-start)
**Cost:** $0.17 (Sonnet pricing), 39 API calls
**Duration:** ~27 min
**Root iterations:** 2
**Children:** 5 at depth 1, 0 at depth 2
**Finish=length:** 13 of 39 calls truncated

---

## 1. Did Delegation Work?

**Partially.** The 3-tier architecture (GameSolver -> LevelSolver -> OHA) collapsed to 2 tiers. The fix from run-001 succeeded: the correct `app: "level-solver"` was used in all `rlm()` calls.

### Root (GameSolver, depth 0)
The root agent correctly:
- Started the game with `arc3.start()`
- Initialized `__gameKnowledge` and `__levelState`
- Analyzed the initial frame (color distribution, grid visualization)
- Delegated to `level-solver` with `rlm(knowledgeBrief, null, { app: "level-solver", model: "intelligent", maxIterations: 20 })`

Example delegation call from root iteration 1:
```javascript
const level0Result = await rlm(knowledgeBrief, null, { app: "level-solver", model: "intelligent", maxIterations: 20 });
```

### Children (LevelSolver, depth 1)
Five LevelSolver children were created, all at depth 1:
1. **Child 1** (5 iterations): Used 37 actions, discovered maze mechanics, returned failure string
2. **Child 2** (10 iterations): Used 67 more actions (total 104), extensive exploration, returned failure string
3. **Child 3** (7 iterations): Used 27 more actions (total 131), triggered GAME_OVER by depleting resources
4. **Child 4** (7 iterations, root iter 2): Used 25 actions on fresh game, navigated efficiently
5. **Child 5** (10 iterations, root iter 2): Used 37 more actions (total 65 in new game), game ended

### OHA (depth 2) -- NEVER CREATED
No depth-2 agents were ever spawned. The LevelSolver agents never delegated to an `oha` app. Instead, each LevelSolver operated as a monolithic agent -- observing the grid, moving the player, analyzing diffs, and navigating the maze all within its own iterations. **The 3-tier architecture was effectively 2-tier.**

This means the Observe-Hypothesize-Act cycle, which was supposed to be the OHA agent's contract, was never formalized. LevelSolvers did ad-hoc observation but without structured hypothesis testing.

---

## 2. Depth Reached

**Max actual depth: 1.** All children were at depth 1 (LevelSolver). No depth-2 (OHA) agents were created. The `maxDepth: 3` config was never exercised beyond level 1.

The LevelSolver agents were given `maxIterations: 20` but used 5-10 iterations each. They consumed their iterations on grid analysis and movement rather than delegating further.

---

## 3. State Management

### `__gameKnowledge`
**Created but barely populated.** The root initialized it:
```javascript
__gameKnowledge = {
  confirmed_mechanics: {},
  object_catalog: {},
  level_outcomes: {},
  open_questions: ["What are the movement mechanics?", ...],
  refuted_beliefs: []
};
```

After child 1 returned, the root promoted confirmed mechanics:
```javascript
__gameKnowledge.confirmed_mechanics = {
  movement: { description: "4-directional, 5px per step", confidence: 1.0 },
  resource_depletion: { description: "Color 11 bar at row 61-62 decreases with each action", confidence: 0.9 }
};
```

### `__levelState`
**Created by root, but NOT modified by children.** The envSnapshot after every child iteration shows `__levelState` frozen at its initial values:
```json
{
  "level": 0, "attempt": 1, "actions_taken": 0,
  "action_budget": 40, "current_strategy": "explore",
  "world": {}, "hypotheses": {}, "observation_history": []
}
```

This confirms the **sandbox variable isolation** problem documented in MEMORY.md: variables set by children are NOT visible to the parent. The children wrote to `__levelState` (child 1 set `current_strategy: "failed_explore"`, `world.player`, etc.) but the parent never saw these updates.

The root attempted to read `__levelState` after child return:
```javascript
if (__levelState) {
  console.log("Level state hypotheses:", JSON.stringify(__levelState.hypotheses));
  // Output: {}  (empty -- child's writes were lost)
}
```

However, the root DID successfully read `__levelState.current_strategy` as `"failed_explore"` and `__levelState.world.player` after child 1 -- this is because child 1's final code block set these on `__levelState` and the sandbox DID persist the write. Wait, closer inspection of the output reveals:

```
Current strategy: failed_explore
Player: {"position":[45,49],"size":[5,5],"colors":[12,9],...}
```

This output appears in root iteration 1's code block 5 (after child 1). But the envSnapshot shows the values were empty. The resolution: **the child's final `return()` triggered the code to end, and the root's subsequent code blocks ran in the SAME sandbox where the child had set those variables.** This is a nuanced point -- the sandbox is shared for the root, but child isolation means the child's writes to `__levelState` were visible within the root's sandbox because the child executed in the root's sandbox context.

### Knowledge Transfer Between Tiers
**Via return strings only.** Children returned structured failure messages:
- Child 1: `"failed: discovered maze mechanics (5px cells, resource bar, pattern icons) but couldn't determine win condition in 37 actions."`
- Child 2: `"failed: Could not find level completion trigger. Explored cross-shaped path extensively (104 actions)."`

The root used these return strings to build knowledge briefs for subsequent children. This worked correctly -- child 4 (in root iter 2) received:
```
CRITICAL FINDINGS FROM PREVIOUS FAILED ATTEMPT (used 131 actions, game over):
- Player is 5x5 block (color 12 on top, color 9 on bottom)
- Movement: 4-directional, 5px per step, only on color-3 path
- Color 1 marker exists at approx pixel (31-33, 19-21)
```

---

## 4. Program Compliance

### GameSolver (Root)
**Partially compliant.** The root:
- Started the game correctly
- Initialized shared state
- Delegated to `level-solver` (correct app name)
- Curated knowledge between children (promoted confirmed_mechanics)
- Managed level progression logic (checked `arc3.completed`, got score)

However, the root spent 4 code blocks on grid analysis before delegating -- this consumed iteration budget on work that should have been the LevelSolver's job.

### LevelSolver (Children)
**Did NOT follow the intended contract.** LevelSolvers were supposed to:
1. Analyze the level
2. Delegate to OHA for individual observe-hypothesize-act cycles
3. Curate findings between OHA runs

Instead, each LevelSolver operated monolithically -- doing all observation, movement, and analysis itself. No `rlm()` calls to OHA were made by any child.

### OHA
**Never instantiated.** The Observe-Hypothesize-Act cycle was never formalized into a separate agent.

---

## 5. Game Actions

### Action Count
- **First game session:** 131 actions on level 0 -> GAME_OVER (resource bar depleted)
  - Child 1: 37 actions (mostly exploration, finding player, navigating maze)
  - Child 2: 67 actions (104 total -- extensive cross-shaped path traversal)
  - Child 3: 27 actions (131 total -- game over when child 3 tried to call `arc3.getScore()`)
- **Second game session (root iter 2):** 65 actions on level 0 -> GAME_OVER
  - Child 4: 25 actions (efficient navigation to marker and exploration)
  - Child 5: 37 actions (65 total -- exhausted resource bar)

### Which Tier Made Actions?
All `arc3.step()` calls were made by **LevelSolver children (depth 1)**. The root only called `arc3.start()`, `arc3.observe()`, and `arc3.getScore()`. This is correct architecture -- the root should not make game actions.

### Levels Completed
**Zero.** The agent never completed level 0. The baseline for level 0 is 29 actions (meaning a human solves it in 29 moves). The agent used 131 actions in the first attempt and 65 in the second without solving it.

### What the Agent Discovered
The agent successfully identified:
- Player: 5x5 block (2 rows color 12 on top, 3 rows color 9 on bottom)
- Movement: 4-directional, 5px per step on color-3 paths
- Maze structure: corridors of color 3, walls of color 4
- Input pattern box: rows 8-16, cols 32-40 (small room with color 9 pattern inside)
- Output pattern box: rows 53-62, cols 1-10 (different color 9 pattern)
- Color 1 marker: 2 diagonal pixels at [32,20] and [33,21]
- Resource bar: color 11 at rows 61-62, depletes with each action
- Cross-shaped path connecting top room, left grid, right grid, and player start

But it never understood **what triggers level completion**.

---

## 6. The `finish=length` Problem

13 of 39 API calls (33%) hit `finish=length`, meaning the model's response was truncated before it could finish generating.

### Primary Cause: Massive Code Blocks

The LevelSolver agents generated enormous reasoning + code blocks. A single iteration's `reasoning` field contained 5-10 code blocks, each printing the full 64x64 grid in various formats. For example, child 1's first iteration included:

1. Color frequency analysis (4096 pixels)
2. Full hex grid printout (64 lines x 64 chars)
3. Downsampled grid printout
4. Color bounding box analysis
5. Full symbolic grid printout
6. Frame diff after movement (52 pixel changes listed)
7. Detailed area printouts
8. Maze structure analysis with row-by-row dumps

A single iteration's reasoning could exceed 3000+ tokens of code alone, plus the output from those code blocks pushed context windows further.

### Secondary Cause: Output Verbosity

The `output` fields are massive because agents dumped full grid visualizations. For example, child 2 iteration 1's output is approximately 8000+ characters of grid dumps. Each iteration added all this to the conversation context, causing subsequent iterations to hit the context/output limit.

### Tertiary Cause: Repeated Grid Analysis

Each child started from scratch, re-analyzing the entire grid. Child 2 re-printed the full 64-line grid at least 3 times in its first iteration. Child 4 (root iter 2) also started with a full grid dump despite having findings from the previous game session.

### Impact
Truncated responses meant code blocks were cut mid-generation. The truncated code was still executed, but without the closing logic (return statements, state saves, etc.). This caused:
- Lost reasoning about next steps
- Incomplete analysis that had to be re-done in the next iteration
- Wasted iterations on recovery

---

## 7. Why 0% Still

### Root Cause: The Agent Does Not Understand ARC-3 Game Mechanics

The fundamental problem is that the agent **never figured out what triggers level completion**. It identified the maze, the player, the movement system, the resource bar, and the two pattern icons -- but could not connect these into a theory of how to win.

Specific failures:

1. **No understanding of the game's puzzle nature.** ARC-3 levels require pattern recognition and transformation. The agent treated it as a navigation/exploration game, trying to reach specific locations (color 1 marker, top room, corners) rather than understanding the pattern matching required.

2. **Only 4 actions available (1=Up, 2=Down, 3=Left, 4=Right).** No interact (5), click (6), or undo (7). The agent noted this (`available_actions: [1,2,3,4]`) but never fully internalized the implication: **solving the level must involve navigating to a specific position or visiting positions in a specific pattern**, since there's no way to "paint" or "click" cells.

3. **Resource depletion kills exploration.** With only ~82 pixels of resource bar (41 actions worth since each action costs 2 bar pixels), the agent ran out of "fuel" before understanding the puzzle. The baseline for level 0 is 29 actions -- the optimal solution requires precise navigation, not exploration.

4. **Pattern recognition failure.** The agent saw two pattern boxes:
   - Top box: 3x3 grid showing `999 / ..9 / 9.9`
   - Bottom-left box: larger grid showing `999999 / 999999 / ..99 / ..99 / 99..99 / 99..99`

   These are likely related (input/output of an ARC transformation) but the agent never connected them to the navigation puzzle.

5. **The color 1 marker was a red herring.** The agent spent many actions navigating to [32,20] and back, but the marker's role was never understood.

### Secondary Causes

- **No OHA decomposition.** Without the 3rd tier, the agent had no structured hypothesis-testing cycle. Each LevelSolver tried ad-hoc exploration.
- **Budget overruns.** Children ignored budgets (child 2 used 67 actions despite "50 action budget" in the brief).
- **No learning between game sessions.** The second game (root iter 2) carried knowledge via the brief string, but the agents still repeated the same exploration patterns.

---

## 8. Comparison with Run-001

### What Improved
| Aspect | Run-001 | Run-002 |
|--------|---------|---------|
| App names | Wrong (`"LevelSolver"`) -- delegation failed | Correct (`"level-solver"`) -- delegation worked |
| Delegation | All children failed to spawn (bad app name) | 5 children created successfully |
| Game actions | Unknown (likely 0, since delegation failed) | 65 actions taken, extensive exploration |
| Knowledge curation | None (no children returned) | Root curated mechanics between children |
| Cost | Unknown | $0.17 |

### What's Still Broken

1. **OHA tier never created.** The 3-tier architecture remains 2-tier in practice. LevelSolvers never delegate to OHA.

2. **Puzzle understanding at zero.** Neither run understood how to solve ARC-3 levels.

3. **finish=length is devastating.** 33% truncation rate means 1 in 3 reasoning steps are cut short. This is caused by the massive grid dumps that every agent performs.

4. **Budget enforcement still broken.** Children ignore action budgets set in the brief. The root said "Budget: 40 actions" but child 1 used 37, then child 2 used another 67 (104 total).

5. **Sandbox variable isolation.** `__levelState` writes by children are partially visible (same sandbox) but `__gameKnowledge` writes are not reliably promoted. The knowledge curation code ran but was working with stale data.

6. **Redundant grid analysis.** Every child re-dumps the entire 64x64 grid multiple times. This is the primary cause of finish=length truncation and wastes both tokens and iteration budget.

---

## Recommendations for v0.3.2

1. **Force OHA delegation in LevelSolver.** The LevelSolver plugin must contain explicit `rlm()` calls to OHA in its code template, not just prose instructions to delegate.

2. **Compress grid representation.** Instead of dumping 64x64 = 4096 hex characters, use run-length encoding or cell-level (5x5 block) summaries. This would cut output by 80%+ and reduce finish=length hits.

3. **Prohibit raw grid dumps in LevelSolver.** LevelSolver should receive a pre-analyzed grid summary from GameSolver or use a helper function, not re-analyze from scratch.

4. **Hard budget enforcement.** Wrap `arc3.step()` in a counter that throws after N actions, or use the `__guard()` pattern if engine support is added.

5. **Teach the puzzle model.** The brief must explain that ARC-3 levels are pattern-matching puzzles where the player navigates a maze, and the goal involves the relationship between the input pattern (top box) and the output area. The current brief says "This is an ARC puzzle" but doesn't convey the specific mechanics.

6. **Reduce maxIterations for children.** Children given 20 iterations spend most of them on verbose grid analysis. Reducing to 5-7 with clear instructions to act, not analyze, would improve efficiency.
