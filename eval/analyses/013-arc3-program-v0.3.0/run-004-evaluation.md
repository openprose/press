# Run-004 Evaluation: ARC-3 Program v0.4.0 + Uniform System Prompt

**Date:** 2026-02-18
**Version:** v0.4.0 + uniform system prompt (buildSystemPrompt with XML sections)
**Score:** 3.42% (1/7 levels completed, level 0 only)
**Actions:** 250 total (121 on level 0, 129 on level 1)
**Cost:** $0.77
**Wall time:** ~21 minutes
**Config:** maxIterations=10, maxDepth=3, game=ls20
**Replay:** https://three.arcprize.org/scorecards/ab10c0e2-6622-421c-aa58-72e459f983b3

---

## Executive Summary

The 3-tier architecture (GameSolver -> LevelSolver -> OHA) activated correctly -- both the level-solver and oha apps were loaded with the right names. Level 0 was completed after a costly two-phase process: the first OHA burned through all fuel in 144 aimless actions (GAME_OVER), the LevelSolver restarted the game, and the second OHA eventually completed level 0 in 121 actions (vs 29 baseline). Level 1 consumed the remaining 129 actions without completion, ending in GAME_OVER.

The key regression from run-003 is that level 0 took 121 actions here (24% efficiency) compared to 16 actions in run-003 (100% efficiency). The improvement is that the system recovered from a total wipeout (GAME_OVER at 144 actions) by restarting the game, which is a first. The uniform system prompt did not cause delegation failures -- app names and architecture were respected. But the OHA agents demonstrated poor strategic discipline, burning through fuel with large movement bursts (15-25 steps per direction) instead of systematic, observed navigation.

---

## 1. Delegation Tree

```
GameSolver (root, depth 0) -- 2 iterations
├── LevelSolver #0 (depth 1) -- 2 iterations
│   ├── OHA #0 (depth 2) -- 8 iterations, 144 game actions
│   │   X GAME_OVER: burned all fuel, 0 levels completed
│   │   [LevelSolver restarted game with arc3.start()]
│   └── OHA #1 (depth 2) -- 8 iterations, 248 game actions (121 on lvl 0 + rest on lvl 1)
│       ✓ Level 0 completed at action 120 (121st action)
│       X Continued on level 1, used remaining budget, GAME_OVER at 250 total
└── LevelSolver #1 (depth 1) -- 7 iterations, 2 game actions on level 1
    X Game already GAME_OVER when spawned, spent 7 iterations trying to recover
```

### Tier Compliance

| Agent | Called arc3.step()? | Delegated correctly? | Notes |
|-------|-------------------|---------------------|-------|
| GameSolver (root) | No | Yes, to `level-solver` | Correct: never called step(), delegated with correct app name |
| LevelSolver #0 | 4 times (iter 1) | Yes, to `oha` (2 children) | Mostly correct; called arc3.step() 4 times directly in iter 1 after restart before delegating |
| OHA #0 | Yes (144 actions) | N/A (leaf) | Correct role, poor execution |
| OHA #1 | Yes (246 actions) | N/A (leaf) | Correct role, poor execution |
| LevelSolver #1 | 0 times | No OHA delegation | Game already GAME_OVER, spent iterations trying to get score |

**Key finding:** The `prohibited: [arc3.step]` constraint on LevelSolver was violated 4 times in iteration 1 (after the restart). The LevelSolver directly called `arc3.step(4)` (Right), `arc3.step(2)` (Down x2) as test moves. This is a minor violation (4 actions vs 246 by OHA) but reflects that the prohibition is still not absolute.

---

## 2. What Went Well

### 2.1 Game Restart Recovery

This is the first run where the agent recovered from a total GAME_OVER by restarting the game with `arc3.start()`. The LevelSolver recognized that OHA #0 had burned 144 actions with 0 levels completed, correctly called `arc3.start()` to reset, and then delegated to OHA #1. This demonstrates situational awareness absent in runs 001-002.

### 2.2 Correct App Name Resolution

All delegations used correct app names:
- GameSolver -> `{ app: "level-solver" }`
- LevelSolver -> `{ app: "oha" }`

This is consistent across all 4 delegation calls. The uniform system prompt (buildSystemPrompt with XML sections) did not interfere with app name resolution.

### 2.3 Level 0 Completion

Level 0 was completed at action 120 (the 121st total game action). The OHA discovered:
- Player is a 5x5 block (2 rows color 12 on top, 3 rows color 9 on bottom)
- Movement is directional, 5px per step on color-3 walkable paths
- There is a cross-shaped maze with yellow (4) walls and green (3) corridors
- A reference pattern in the bottom-left HUD (rows 53-62, cols 1-10)
- A target pattern in the upper arm of the cross (rows 8-16, cols 32-40)
- A fuel bar (color 11) at rows 61-62 that depletes with each action

The agent moved the block through the maze, eventually navigating to the goal position at action 120.

### 2.4 Shared State Partially Worked

The `__levelState` was populated by OHA agents with useful data:
- `world.player_position: [34, 22]`
- `world.maze_walkable_color: 3`
- `world.objects_of_interest` listing the pattern, item_c, and item_9 objects
- `world.reference_pattern` describing the HUD pattern

However, `__gameKnowledge.confirmed_mechanics` remained empty -- the GameSolver's curation step never promoted the OHA's discoveries to confirmed mechanics.

### 2.5 The `[ERROR] rlm() not awaited` Warnings

Multiple warnings appeared in the output: "1 rlm() call(s) were NOT awaited." These indicate that OHA agents attempted to delegate further (forbidden per their contract as leaf nodes). The warnings prevented silent failures -- the agents were notified their calls were wasted. This error detection infrastructure is working correctly.

---

## 3. What Went Poorly

### 3.1 OHA #0: Complete Failure (144 wasted actions)

OHA #0 consumed 144 actions without completing any level. Key failures:

**Misidentification of game type:** The LevelSolver's delegation prompt told OHA: "Click (action 6) on output cells to paint them with the correct colors. Use action 5 (Interact) to submit." But only actions 1-4 were available. The OHA tried to treat this as an ARC painting puzzle rather than a navigation puzzle, wasting iterations analyzing pixel patterns.

**No player identification:** OHA #0 spent its first 3 iterations analyzing the grid structure (color distributions, bounding boxes, cell regions) but never identified the player entity or tested what happens when directional actions are taken. It operated at the perception level without the ACT step of OHA.

**Uncontrolled movement bursts:** When OHA #0 finally started taking actions, it used large bursts: "Step 0: action=4... Step 1: BLOCKED!" followed by trying another direction. It moved 89+ actions before even discovering the fuel depletion mechanic, then hit GAME_OVER at 144 actions.

**No hypothesis testing:** Despite the OHA contract requiring structured hypotheses, OHA #0 had `hypotheses: {}` in its final env snapshot. No formal hypothesis was ever created, tested, or resolved.

### 3.2 OHA #1: Inefficient Level 0 Completion (121 actions vs 29 baseline)

While OHA #1 succeeded, it used 4.2x the human baseline:

**No pathfinding:** Despite the OHA spec's `shortestPath` capability, no BFS or pathfinding algorithm was ever implemented. The agent navigated by trial-and-error, taking large movement bursts in each direction and checking what changed.

**Redundant exploration:** The agent traversed the same corridors multiple times. Action sequence analysis shows:
- Right x12, Down x11, Right x5 (navigating east and south)
- Then Left x15, Up x7, Right x5 (backtracking)
- Then Left x5, Up x15 (moving to upper arm)
- Then Left x3, Up x5, Right x3, Up x3 (navigating into the goal)

Many of these movements were reversals of prior movements, indicating the agent did not build a mental map of the maze.

**No resource monitoring:** OHA #1 did not track fuel depletion. By iteration 7, fuel was at 2 pixels -- critically low. The agent was unaware of this until the final check.

### 3.3 Level 1: 129 Wasted Actions

After level 0 completion, OHA #1 continued playing on level 1 (still within the same delegation). It took 129 more actions without completing the level. The action pattern was even more erratic:
- Down x10, Right x20 (large movements)
- Down x5, Up x5, Left x5, Up x15 (oscillation)
- Left x20, Down x25, Right x10, Up x10 (massive sweeps)

This is pure flailing -- no systematic exploration, no hypothesis testing, no maze mapping. The agent moved the block in huge sweeps without understanding the new maze layout.

### 3.4 LevelSolver #1: 7 Wasted Iterations

When GameSolver delegated LevelSolver #1 for level 2, the game was already GAME_OVER. LevelSolver #1 spent 7 iterations discovering this:
- Iter 0: Massive grid analysis (21k chars of reasoning), printed the full 64x64 grid multiple times
- Iter 1: Empty output (0 chars) -- likely a code execution issue
- Iter 2: Found the special objects, tried to undo (action 7), got "Game already completed"
- Iters 3-6: Repeatedly checked state, tried to get score, eventually returned failure

This wasted at least 4 API calls and significant tokens on a dead game state. The GameSolver should have checked `arc3.completed` or `arc3.observe().state` before delegating.

### 3.5 Knowledge Curation Failure

The GameSolver's final `__gameKnowledge` state:
```javascript
{
  confirmed_mechanics: {},          // EMPTY despite extensive discoveries
  object_catalog: {},               // EMPTY despite finding multiple objects
  level_outcomes: { 1: { ... } },   // Level 1 only, wrong: actually level 0
  open_questions: ["What is the game mechanic?", "How do we win a level?"],  // Never answered
  refuted_beliefs: []               // EMPTY despite disproving many theories
}
```

The GameSolver never performed the curation step specified in its contract. After OHA returned, the GameSolver immediately delegated to the next level without promoting discoveries. The `confirmed_mechanics` should have contained movement, player identification, maze structure, and fuel mechanics.

### 3.6 Erroneous Level Numbering

The GameSolver recorded the outcome under `level_outcomes[1]` with `completed: true`, but it was actually level 0 that was completed (the scorecard shows `level_actions[0] = 121`). The code used `currentFrame.levels_completed + 1 = 2` to set the next level, then recorded the outcome for level 1. This off-by-one error propagated into the knowledge brief for subsequent delegations.

### 3.7 Missing Discovery: Pattern Toggle / Color Changer / Fuel Refill

According to the canonical rules, the game has:
- Pattern toggles (white cross shapes) that change the current pattern
- Color changers (rainbow boxes) that change colors
- Fuel refills (yellow box with dark center) that refill the fuel bar

None of these were discovered by any agent in this run. The OHA agents treated the game as a pure navigation puzzle ("get the block to the goal") without understanding the pattern-matching prerequisite. Level 0 was completed (likely the pattern already matched by default), but level 1 failed likely because the pattern did not match and the agent never discovered how to change it.

---

## 4. Key Metrics

### 4.1 Actions Per Level

| Level | Actions | Baseline | Efficiency | Score | Status |
|-------|---------|----------|------------|-------|--------|
| 0     | 121     | 29       | 24.0%      | 24.0  | Completed |
| 1     | 129     | 41       | 31.8%*     | 0.0   | Failed |
| 2-6   | 0       | 49-172   | N/A        | 0.0   | Never reached |

*Efficiency calculated as baseline/actions, but level 1 was not completed, so score = 0.

### 4.2 Delegation Count and Iteration Usage

| Agent | Delegations Made | Iterations Used | Iterations Available |
|-------|-----------------|-----------------|---------------------|
| GameSolver (root) | 2 (to level-solver) | 2 | 10 |
| LevelSolver #0 | 2 (to oha) | 2 | ~20 |
| OHA #0 | 0 (leaf) | 8 | ~25 |
| OHA #1 | 0 (leaf) | 8 | ~25 |
| LevelSolver #1 | 0 (game over) | 7 | ~20 |

The root used only 2 of 10 available iterations. The reason: iteration 0 contained 9 code blocks that handled the entire game lifecycle (start, analyze, delegate for level 0, curate, delegate for level 1, check state), and iteration 1 just retrieved the final score. The model packed everything into a single iteration.

### 4.3 Knowledge Accuracy at End of Run

| Item | Discovered? | Accurate? | Notes |
|------|-------------|-----------|-------|
| Player identification | Yes | Partial | Identified as 5x5 block of colors 12+9, but confused with colors 0+1 in early OHA |
| Movement mechanics | Yes | Yes | Directional, 5px per step on color-3 paths |
| Wall detection | Yes | Yes | Color 4 blocks movement |
| Fuel depletion | Yes | Late | Discovered only in OHA #1 iter 7, fuel at 2 pixels |
| Fuel refill | No | N/A | Never discovered |
| Pattern toggle | No | N/A | Never discovered |
| Color changer | No | N/A | Never discovered |
| Goal icon | Partial | No | Agent saw the upper-arm pattern but didn't understand it as a goal icon |
| HUD pattern display | Yes | Partial | Saw bottom-left reference pattern, compared it to upper pattern |
| Pattern matching requirement | No | N/A | Completed level 0 without understanding this requirement |
| Lives counter | No | N/A | Noted color 8 at bottom-right but didn't identify as lives |
| Maze structure | Yes | Yes | Cross-shaped corridors of color 3 with color 4 walls |

### 4.4 Budget Utilization

The GameSolver specified `action_budget: 40` for level 0 and `action_budget: 40` for subsequent levels. OHA #0 used 144 actions (3.6x budget) before GAME_OVER. OHA #1 used 248 actions (6.2x budget). Budget constraints were completely ignored.

---

## 5. Comparison with Previous Runs

### 5.1 Score Trend

| Run | Version | Score | Levels | Actions | Cost | Key Change |
|-----|---------|-------|--------|---------|------|------------|
| 001 | v0.3.0  | 0%    | 0/7    | 129     | $0.40 | Wrong app names, no delegation |
| 002 | v0.3.1  | 0%    | 0/7    | ~150    | $0.17 | Correct app names, 2-tier only |
| 003 | v0.4.0  | 14.3% | 1/7    | 127     | $0.73 | 3-tier worked, level 0 in 16 actions |
| **004** | **v0.4.0 + uniform prompt** | **3.42%** | **1/7** | **250** | **$0.77** | **3-tier worked but inefficient** |

### 5.2 Regression from Run-003

Run-004 is a **regression** compared to run-003:

| Dimension | Run-003 | Run-004 | Delta |
|-----------|---------|---------|-------|
| Score | 14.3% | 3.42% | -10.9 pp |
| Level 0 actions | 16 | 121 | +105 (7.6x worse) |
| Level 0 efficiency | 100% | 24% | -76 pp |
| OHA delegations | 3 | 2 | -1 |
| Total actions | 127 | 250 | +123 |
| Wasted game (GAME_OVER + restart) | 0 | 144 actions | New failure mode |

The primary regression is in level 0 efficiency. Run-003's OHA completed level 0 in 16 actions -- a near-perfect run. Run-004's OHA #1 needed 121 actions after a full restart. The difference:

1. **Run-003 OHA had a focused strategy brief.** The LevelSolver provided "orient" as the strategy, and OHA executed a clean sequence: identify player, test movement, navigate to goal.
2. **Run-004 OHA received a confused brief.** The LevelSolver told OHA to "Click (action 6) on output cells to paint them" and "Use action 5 (Interact) to submit" -- actions that don't exist in this game. This misdirected the OHA's entire approach.

### 5.3 What the Uniform System Prompt Changed

The uniform system prompt (buildSystemPrompt with XML sections) was introduced between runs 003 and 004. Based on the trace, it did NOT cause:
- App name resolution failures (all correct)
- Delegation structural failures (3-tier activated)
- Contract misunderstanding (agents knew their roles)

It MAY have contributed to:
- Longer reasoning blocks (the XML structure may encourage more verbose reasoning)
- The LevelSolver's iter 0 spending 8 code blocks on grid analysis before delegating (potentially because the structured prompt encouraged thorough analysis over quick delegation)

However, the primary cause of the regression appears to be **prompt content in the delegation brief**, not the system prompt format. The LevelSolver told OHA #0 to use Click and Interact actions, which primed it for the wrong game type.

### 5.4 Consistent Failure Modes Across Runs

These failures appear in every run:
1. **Budget enforcement is ignored.** OHA agents always exceed their action budget.
2. **No pathfinding implemented.** Despite the OHA spec's `shortestPath` capability, no agent has ever implemented BFS.
3. **Hypothesis lifecycle not followed.** `hypotheses: {}` in every final env snapshot across all runs.
4. **Pattern toggle / color changer / fuel refill never discovered.** The game's key interactive objects are never found.
5. **Observation history never populated.** `observation_history: []` in every run.

---

## 6. Root Causes and Recommendations

### P0: OHA Brief Must Not Contain Action-Specific Instructions

The LevelSolver's delegation to OHA included: "Click (action 6) on output cells", "Use action 5 (Interact) to submit". These actions are unavailable (only 1-4 exist). The OHA wasted cycles trying to reconcile these instructions with reality.

**Fix:** The LevelSolver's delegation prompt should describe the *goal* ("navigate to the target position"), not specific actions. The OHA discovers available actions during the orient phase.

### P1: GameSolver Must Check Game State Before Delegating

The GameSolver delegated LevelSolver #1 for "level 2" when the game was already GAME_OVER. This wasted 7 iterations.

**Fix:** Add a state check after each LevelSolver returns: `if (arc3.observe().state === "GAME_OVER") break;`

### P1: GameSolver Must Actually Curate Knowledge

`__gameKnowledge.confirmed_mechanics` remained empty despite discovering movement, player ID, maze structure, and fuel mechanics. The curation step from the contract was never executed.

**Fix:** Add explicit curation code in the game-solver delegation pattern, or make curation a separate code block that runs between delegations.

### P2: OHA Must Implement Pathfinding

Every OHA run navigates by trial-and-error with large movement bursts. The `shortestPath` capability is never implemented. If the OHA used BFS on the discovered maze, level 0 would take ~29 actions (optimal) instead of 121.

**Fix:** Include a pathfinding code template in the OHA spec that agents can use directly, rather than requiring them to invent it.

### P2: LevelSolver Should Not Restart Games

The LevelSolver called `arc3.start()` to restart after GAME_OVER. While this worked, it consumed a full game attempt. The GameSolver (root) should manage restarts, not the LevelSolver.

**Fix:** If GAME_OVER occurs, the LevelSolver should return a failure string. The GameSolver decides whether to restart.

### P3: OHA Needs Resource Monitoring

OHA #1 reached 2 fuel pixels before realizing resources were low. The OHA spec requires resource monitoring after every Act, but this was never done.

**Fix:** Include a fuel-checking utility function in the OHA prompt that OHA must call after every multi-step action sequence.

---

## 7. Discovery Checklist (per Canonical Rules)

| Discovery | Found? | Run-003 | Notes |
|-----------|--------|---------|-------|
| Character identification | Yes | Yes | 5x5 block, colors 12+9 |
| Movement mechanics | Yes | Yes | 4-dir, 5px/step |
| Wall detection | Yes | Yes | Color 4 walls, color 3 walkable |
| Fuel depletion | Yes | Yes | Color 11 bar depletes |
| Fuel refill | **No** | No | Never discovered in any run |
| Lives counter | **No** | No | Color 8 at bottom-right not identified |
| Pattern toggle | **No** | No | Never discovered in any run |
| Color changer | **No** | No | Never discovered in any run |
| Goal icon | Partial | Partial | Saw upper-arm pattern, didn't understand it |
| HUD pattern display | Yes | Yes | Bottom-left reference pattern identified |
| Pattern matching requirement | **No** | **No** | Completed level 0 without understanding this |
| Strategic sequencing | **No** | **No** | No agent sequenced transform-then-navigate |
| Fog of war | N/A | N/A | Never reached level 7 |

The discovery profile is unchanged from run-003. The critical missing pieces are pattern toggles, color changers, and the pattern matching requirement. Without understanding these, levels beyond 0 (where the pattern may already match by default) will likely fail.

---

## 8. Summary of Findings

**The 3-tier architecture works structurally** -- apps are loaded, delegation flows correctly, and the division of responsibilities (orchestrator / coordinator / leaf executor) is respected in broad strokes. The uniform system prompt did not break this.

**The efficiency regression from run-003 is caused by prompt content**, not architecture. The LevelSolver's delegation brief contained wrong action instructions (Click, Interact) that misdirected the OHA. Run-003's cleaner brief ("strategy: orient") produced a 7.6x more efficient OHA execution.

**The game restart recovery is novel** but masks a deeper problem: OHA #0 should not have burned 144 actions in the first place. Better orient behavior (test each direction once, confirm player, then navigate systematically) would prevent the need for restarts.

**No run has discovered pattern toggles, color changers, or fuel refills.** These are the key interactive objects that make levels solvable. Until the agent discovers that stepping on certain objects changes the HUD pattern, and that the HUD pattern must match the goal icon to complete a level, higher levels will remain impossible. This is the most important capability gap to address.
