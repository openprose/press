# Run-003 Distillation: v0.4.0 Programs (shape + prohibited)

**Date:** 2026-02-18
**Version:** v0.4.0
**Score:** 14.3% (1/7 levels)
**Actions:** 127 game actions, 37 API calls
**Cost:** ~$0.73 (at Sonnet pricing)
**Time:** 20m 47s
**Config:** maxIter=10, maxDepth=3, game=ls20

## Result Summary

| Level | Actions | Baseline | Score | Notes |
|-------|---------|----------|-------|-------|
| 0     | 16      | 29       | 100%  | Completed via 3-tier delegation |
| 1     | 111     | 41       | 0%    | Failed — LevelSolver played directly |
| 2-6   | 0       | 49-172   | 0%    | Never reached |

## Delegation Tree

```
GameSolver (root, depth 0) — 10 iterations, 2 API calls
├── LevelSolver #0 (depth 1) — 2 iters, level 0
│   └── OHA (depth 2) — 10 iters, 17 game actions
│       ✓ Level 0 completed in 16 actions (100% efficiency)
├── LevelSolver #1 (depth 1) — 10 iters, level 1
│   └── (NO OHA delegation)
│       ✗ Called arc3.step directly 20 times, 110 actions, never completed
└── LevelSolver #2 (depth 1) — 6 iters, level 1 retry
    ├── OHA (depth 2) — 5 iters
    └── OHA (depth 2) — 2 iters
        ✗ Mixed: delegated some + played directly, never completed
```

## Key Findings

### 1. 3-tier delegation works — when it works

Level 0 is the clearest success across all versions. The full chain activated:
- **GameSolver** started the game, analyzed the initial frame, initialized `__gameKnowledge` and `__levelState`, delegated to LevelSolver with a knowledge brief.
- **LevelSolver** analyzed the grid, identified components (maze, HUD, objects), initialized `__levelState.world`, delegated to OHA with an "orient" strategy.
- **OHA** took 17 actions: identified the player (5x5 block of colors 12+9), discovered movement mechanics (1 cell/step), found a collectible object (colors 0/1), collected it, navigated to the target area.

Level 0: 16 game actions vs 29 baseline = **100% efficiency**. This is the best level-0 performance in any version.

### 2. Shape/prohibited compliance is inconsistent across delegations

The v0.4.0 `shape` construct and `prohibited: [arc3.step]` frontmatter worked for LevelSolver #0 but failed for #1 and partially for #2:

| LevelSolver | Delegated to OHA? | Direct arc3.step calls | Actions |
|-------------|-------------------|----------------------|---------|
| #0 (level 0) | Yes (1 child) | 1 | 17 |
| #1 (level 1) | **No** | **20** | 110 |
| #2 (level 1 retry) | Yes (2 children) | 3 | ~130 |

The root cause appears to be **prompt contamination**: the root's delegation prompt for #1 included action-specific instructions like "Try clicking (action 6) on objects", "Use action 5 (Interact) when near objects", "Movement is likely actions 1-4". These instructions prime the LevelSolver to act directly instead of delegating, overriding the shape constraint.

### 3. Shared state (`__gameKnowledge`, `__levelState`) worked

This is the first version where the full shared-state lifecycle activated:
- GameSolver wrote `__gameKnowledge` and `__levelState` before delegation
- LevelSolver read them and wrote back findings via `__levelState`
- OHA read/wrote `__levelState.world`, `hypotheses`, `observation_history`
- After delegation, GameSolver curated: promoted hypotheses to `confirmed_mechanics`, recorded `level_outcomes`, cataloged objects

Confirmed mechanics after level 0:
- `movement`: 4-directional, player is 5x5 block (confidence 0.9)
- `collection`: moving onto objects collects them (confidence 0.8)
- `level_completion`: navigate to target area (confidence 0.7)

### 4. finish=length improved but still significant

8/37 API calls (21.6%) hit token limit, down from 33% in run-002. The pattern:
- Most truncations occurred in OHA iterations (long analysis code) and LevelSolver's first iteration (big initial frame analysis)
- Input chars grew rapidly: from 15k to 132k for the longest LevelSolver sessions
- The shared state approach (writing to `__levelState` in-place) means context grows with each iteration as the sandbox accumulates data

### 5. Level 1 failed despite rich knowledge brief

The second delegation had confirmed mechanics, known objects, and prior outcomes. But 110 actions were spent without completing level 1 (baseline: 41 actions). Two issues:
- LevelSolver played directly instead of delegating to OHA, losing the structured OHA cycle
- No maze mapping was done for level 1 — the agent took random exploratory actions without systematic tracking

## API Call Breakdown

| Metric | Value |
|--------|-------|
| Total API calls | 37 |
| finish=stop | 29 (78%) |
| finish=length | 8 (22%) |
| Root calls | 2 |
| LevelSolver calls | 14 |
| OHA calls | 21 |

## Comparison with Previous Runs

| Run | Version | Score | Levels | Actions | 3-tier? | OHA delegations |
|-----|---------|-------|--------|---------|---------|-----------------|
| 001 | v0.3.0  | 0%    | 0/7    | 42      | No (wrong app names) | 0 |
| 002 | v0.3.1  | 0%    | 0/7    | ~150    | 2-tier only | 0 |
| **003** | **v0.4.0** | **14.3%** | **1/7** | **127** | **Partial** | **3** |

## Root Causes to Fix

### P0: LevelSolver delegation inconsistency
The shape/prohibited construct works for the first delegation but fails when the root's prompt contains action-specific instructions. Two fixes:
1. **Root prompt discipline**: The orchestrator's delegation prompt should describe *what* to accomplish, not *how* to take actions. Action instructions belong in OHA's prompt only.
2. **Stronger shape enforcement**: Consider engine-level enforcement (reject `arc3.step` calls from depth-1 agents) rather than relying on prompt compliance.

### P1: Context growth
Input chars grew from 15k to 132k across iterations. The shared-state approach (writing everything to sandbox variables) means the REPL output accumulates. Possible mitigations:
- Limit console.log verbosity in OHA iterations
- Summarize `__levelState.observation_history` instead of appending indefinitely
- Use structured returns instead of dumping state to console

### P2: No systematic maze mapping on level 1
Level 0 succeeded partly because OHA discovered the player, objects, and navigation path in one coherent 17-action sequence. Level 1 spent 110 actions without building a comparable world model because the LevelSolver was playing directly (no OHA cycle of observe-hypothesize-act).
