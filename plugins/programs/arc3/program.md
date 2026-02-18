---
name: arc3-solver
kind: program
version: 0.4.0
description: Solve ARC-3 interactive grid games through observation, hypothesis, and action
nodes: [game-solver, level-solver, oha]
---

# ARC-3 Solver

A 3-tier RLM program for playing interactive grid games with unknown rules. The agent discovers all game mechanics through experimentation — nothing about how the game works is assumed.

## Shared State

State prefixed with `&` lives in the sandbox as a `__camelCase` variable (e.g., `&GameKnowledge` → `__gameKnowledge`). All agents read and write it directly — no serialization into prompts or return values.

Schemas are templates. Fields are populated through observation — their existence is not guaranteed until the agent discovers the corresponding game element.

### &GameKnowledge

Persists across levels. The orchestrator curates this between delegations.

```
GameKnowledge {
  confirmed_mechanics: {
    [name]: {
      description: string
      confidence: 0..1
      evidence: string[]
      first_seen: level
    }
  }

  object_catalog: {
    [type]: {
      visual: {
        colors: number[]
        size: [h, w]
        pattern: number[][]
        is_multicolor: boolean
      }
      behavior: string
      locations_seen: [r, c][]
    }
  }

  level_outcomes: {
    [level]: {
      completed: boolean
      actions_used: number
      key_insight: string
      strategies_tried: string[]
      maze_snapshot: { cells, grid_dims }  -- persisted for retry attempts
      known_objects: { [id]: { type, position, interacted } }
    }
  }

  open_questions: string[]
  refuted_beliefs: string[]
}
```

### &LevelState

Exists for the duration of one level attempt. Created fresh by LevelSolver.

```
LevelState {
  level: number
  attempt: number
  actions_taken: number
  action_budget: number
  current_strategy: string

  world: {
    grid_dimensions: [rows, cols]
    background_colors: number[]

    player: {
      position: [r, c]
      size: [h, w]
      pattern: number[][]
      colors: number[]
    }

    objects: {
      [id]: {
        type: string             -- from object_catalog, or "unknown"
        position: [r, c]
        size: [h, w]
        pattern: number[][]
        interacted: boolean
      }
    }

    maze: {
      cell_size: number          -- pixels per cell (discovered, typically 5)
      grid_origin: [r, c]       -- pixel coords of cell (0,0)
      grid_dims: [rows, cols]   -- number of cells
      cells: { [r_c]: "floor" | "wall" | "unknown" }
      blocked_moves: { [r_c]: direction[] }
    }

    hud: {
      regions: {
        [name]: {
          position: [r, c, h, w]
          pattern: number[][]
          interpretation: string -- what the agent believes this shows
        }
      }
      resource_level: number     -- estimated from observation (0..1)
      resource_max: number
    }
  }

  hypotheses: {
    [id]: {
      claim: string
      evidence_for: string[]
      evidence_against: string[]
      confidence: 0..1
      status: "open" | "confirmed" | "refuted"
      tests_remaining: string[]
    }
  }

  observation_history: {
    action: number | string      -- action code or description
    before: { player_pos, world_snapshot }
    after: { player_pos, world_snapshot }
    diff: string
    hypothesis_updates: string[]
  }[]
}
```

## Composition

```
GameSolver (app: "arc3-game-solver")
  writes &GameKnowledge (once, at init)
  for each level:
    writes &LevelState (fresh per attempt)
    delegates -> LevelSolver via rlm(goal, null, { app: "level-solver" })
    reads &LevelState after return
    curates &GameKnowledge from &LevelState

LevelSolver (app: "level-solver")
  reads &GameKnowledge for prior knowledge
  reads/writes &LevelState
  loop until complete or budget exhausted:
    selects strategy, writes to &LevelState.current_strategy
    delegates -> OHA via rlm(goal, null, { app: "oha" })
    reads &LevelState after return
    evaluates progress, adjusts strategy if stuck

OHA (app: "oha")
  reads/writes &LevelState
  one cycle:
    Observe:    parse the current frame, update &LevelState.world
    Hypothesize: update hypotheses with latest evidence, select action intent
    Act:        execute a coherent action sequence (may be many game steps)
    Observe:    parse the frame again, diff against pre-Act state
    Record:     write diffs and hypothesis updates to &LevelState
```
