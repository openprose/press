# Run 004 - Canonical Rules Comparison

> **Run:** `arc3_anthropic_claude-opus-4-6_2026-02-18T07-20-42-256Z.json`
> **Score:** 3.4% (1/7 levels completed, 250 total actions)
> **Config:** maxIterations=10, maxDepth=3, game=ls20
> **Program:** arc3 v0.4.0 (3-tier: game-solver -> level-solver -> oha)
> **Cost:** $0.77

## Score Breakdown

| Level | Actions Used | Baseline | Score | Completed |
|-------|-------------|----------|-------|-----------|
| 1     | 121         | 29       | 24.0% | Yes       |
| 2     | 129         | 41       | 0%    | No (GAME_OVER) |
| 3-7   | 0           | 172/49/53/62/82 | 0% | Not reached |

Level 1 was completed but at 4.2x the baseline actions (121 vs 29). Level 2 consumed all remaining actions (129) without completion, triggering GAME_OVER.

---

## Discovery Checklist Scorecard

| # | Discovery Item | Discovered? | When | Accurate? | Notes |
|---|---------------|-------------|------|-----------|-------|
| 1 | Character identification | Partial | OHA0 Iter 3-4 (Level 1) | Wrong | Identified the 5x5 color 12+9 block as the moveable entity, but never recognized it as the *character*. Called it "the block" or "marker 2". Misidentified the 2-pixel color 0/1 pattern as "player cursor" or "marker 1". |
| 2 | Movement mechanics | Yes | OHA0 Iter 3-4 (Level 1) | Partially correct | Correctly determined the block moves 5 pixels per directional action. Got direction mapping right (1=Up, 2=Down, 3=Left, 4=Right). But believed the actions move "objects, not a player character" -- a fundamental misframing. |
| 3 | Wall detection | Partial | OHA1 Iter 1-2 (Level 1) | Partially correct | Identified that color 4 (yellow) blocks movement and that the maze is made of color 3 (walkable). Rendered maze maps using '#' for walls and '.' for walkable. However, confused about which entity was being blocked -- thought the "player" (color 1 pixels) couldn't move, when actually the character (color 12+9 block) was the one navigating walls. |
| 4 | Fuel depletion | Partial | OHA0 Iter 4-6 (Level 1) | Partially correct | Noticed the bottom bar (color 11 pixels) shrinks with each move. In OHA1, correctly noted "fuel remaining: 2" near the end. Understood the resource was limited but did not identify the exact mechanic (1 unit per step) or that running out causes a life loss. |
| 5 | Fuel refill discovery | No | -- | -- | Never identified the yellow box with dark center as a fuel refill icon. Never stepped on one deliberately. |
| 6 | Lives counter recognition | No | -- | -- | Color 8 pixels at (61-62, 56-57) were noticed but identified as "azure HUD elements" that "disappeared" after an Up action. Never recognized these as the 3-lives indicator (red squares). |
| 7 | Pattern toggle discovery | No | -- | -- | The white cross / white cluster pattern toggle was never identified. The color 0/1 pixels at rows 31-33 were misidentified as a "player cursor" or "marker 1". These were likely the pattern toggle or a related HUD element. |
| 8 | Color changer discovery | No | -- | -- | The rainbow/multi-colored box was never identified as a color changer. |
| 9 | Goal icon identification | Partial | OHA0 Iter 1-2 (Level 1) | Wrong | Identified the framed box in the upper arm (rows 9-15, cols 33-39) containing a color 9 pattern, but never understood it as the "Goal Icon" that must be reached. Instead interpreted it as a "target pattern to match" or part of an ARC-style transformation puzzle. |
| 10 | Current pattern display recognition (HUD) | Partial | OHA0 Iter 1-2, OHA1 Iter 3 (Level 1) | Wrong | Identified the bottom-left area (rows 53-62, cols 1-10) as a "reference pattern" or "template" showing a 5x5 grid of color 9 on color 5 background. Never understood it as the "Goal Icon GateKeeper" -- the dynamic indicator that must match the goal icon's pattern. In OHA1 Iter 7, noticed the reference pattern *changed* but attributed this to gameplay interaction rather than understanding the toggle mechanic. |
| 11 | Pattern matching requirement | No | -- | -- | Never discovered that the GateKeeper pattern must match the Goal Icon pattern to complete a level. The agent's mental model was closer to "navigate the block to a target position" or "arrange colored blocks to match a pattern" (Sokoban-like). |
| 12 | Strategic sequencing (transform then navigate) | No | -- | -- | Never established the correct sequence: toggle pattern -> navigate to goal. Movement was exploratory and undirected, with no concept of "prepare state, then reach goal". |
| 13 | Fog of war adaptation (Level 7) | N/A | -- | -- | Never reached Level 7. |

**Discovery Score: 0/12 fully correct, 5/12 partial, 7/12 missed entirely**

---

## What the Agent Got Right

### 1. Grid structure identification
The agent correctly identified the 64x64 grid with color-coded regions: color 3 as walkable maze, color 4 as walls/background, color 5 as HUD elements. The cross-shaped maze structure was accurately mapped.

### 2. Movement step size
Correctly determined that the moveable block shifts by exactly 5 pixels per action in the pressed direction.

### 3. Direction mapping
Correctly used 1=Up, 2=Down, 3=Left, 4=Right throughout.

### 4. Fuel bar observation
Noticed that the color 11 bar at the bottom depleted with movement and correctly associated it with a limited resource. Tracked its decline and noted when it was nearly empty.

### 5. Maze topology
Produced accurate ASCII maps of the cross-shaped maze, correctly identifying arms, junctions, and wall positions.

### 6. Level 1 eventual completion
Despite 121 actions (4.2x baseline), the agent did manage to complete Level 1. This appears to have happened somewhat accidentally during exploration -- the block was moved through various positions, and the level completed when the right conditions were met (block at correct position with correct pattern state).

---

## What the Agent Got Wrong

### 1. Fundamental game model: "ARC puzzle" framing (Critical)
The game-solver told the level-solver this was "an ARC-style puzzle" where you need to "find input/output regions, determine the transformation rule, paint the output using Click." This is completely wrong -- ARC-3 is a *maze navigation game* with a character, not a pattern transformation task. This incorrect framing persisted through the entire run.

The initial query to the level-solver included instructions like:
> "Use Click (action 6) to paint cells in the output grid"
> "Use Interact (action 5) to possibly submit/confirm"

Neither Click nor Interact are needed in ARC-3. Only directional actions (1-4) are required.

### 2. Character misidentification (Critical)
The agent never recognized the 5x5 block (2 rows orange/color 12, 3 rows blue/color 9) as the player character. Instead it was called:
- "the block" (neutral)
- "marker 2" (OHA0)
- "colored blocks" that the actions move (Level 2)

The 2-pixel color 0/1 pattern was misidentified as:
- "player cursor" (OHA0 Iter 0)
- "marker 1" (OHA0 Iter 3)
- Something that "didn't move" (all OHA attempts)

The canonical rules clearly describe the character as "a 5x5 block: top two rows orange, bottom three blue."

### 3. "Sokoban" hypothesis (Wrong)
OHA1 Iter 3 developed the hypothesis: "This is a SOKOBAN-like puzzle! The actions move OBJECTS, not the player!" This inverted the actual mechanic. The arrows move the *character* (the 12+9 block), which is the player. The agent thought the color 1 pixels were the player and the 12+9 block was an object being pushed.

### 4. Pattern matching misunderstanding
The agent noticed the bottom-left "reference pattern" and the goal icon pattern in the maze, and tried to figure out how they related. In OHA1 Iter 4-5, it attempted to compute transformations between them (mirror, rotation). It never grasped that:
- The bottom-left display is the GateKeeper (changes when you step on toggles)
- The goal icon in the maze is fixed for the level
- They must match for level completion

### 5. Reference pattern change attributed to movement
In OHA1 Iter 7, the agent noticed the reference pattern changed from `999/9../9.9` to `999/..9/9.9`. It noted "the reference keeps changing based on what we do" but attributed it to movement rather than understanding the pattern toggle mechanic.

### 6. Knowledge transfer failure
The `__gameKnowledge` object remained essentially empty throughout the entire run:
```json
{
  "confirmed_mechanics": {},
  "object_catalog": {},
  "level_outcomes": { "1": { "completed": true, "actions_used": 248 } },
  "open_questions": ["What is the game mechanic?", "How do we win a level?"],
  "refuted_beliefs": []
}
```
Despite extensive observations at the OHA level, no confirmed mechanics or object catalogs were ever populated. The open questions "What is the game mechanic?" and "How do we win a level?" persisted from initialization through the end of the run, never answered.

### 7. Level 2 never delegated to OHA
For Level 2, the level-solver (child1) ran 7 iterations but never delegated to an OHA child. It operated directly, repeating the same initial observations without making progress. The `__levelState` never updated from its initialized values across all 7 iterations.

---

## What the Agent Missed Entirely

### 1. Fuel refill mechanic
The yellow box with dark center that refills fuel was never identified or interacted with deliberately.

### 2. Lives system
The 3 red squares (color 8 at bottom-right) were observed as "azure HUD elements" that disappeared, but never understood as lives. The agent never connected fuel depletion to life loss.

### 3. Pattern toggle (white cross)
The key interactive element -- stepping on a white cross to change the GateKeeper pattern -- was never discovered.

### 4. Color changer (rainbow box)
The multi-colored block that changes the GateKeeper's color was never identified.

### 5. Win condition
The agent never understood: "GateKeeper pattern must match Goal Icon pattern, then navigate character to Goal Icon." This is the core game mechanic.

### 6. Strategic planning
Without understanding the win condition, no strategic sequencing (survey -> compare -> transform -> navigate -> refuel) was possible.

---

## Incorrect Beliefs Formed

| Belief | Reality | Formed When |
|--------|---------|-------------|
| This is an ARC-style transformation puzzle | It's a maze navigation game | Game-solver initialization |
| Actions 5 (Interact) and 6 (Click) are needed | Only actions 1-4 (directional) are needed | Game-solver query to level-solver |
| Color 1 pixels are the "player" | Color 1 is not the player; the 12+9 block is the character | OHA0 Iter 0 |
| The 12+9 block is a moveable "object" | The 12+9 block IS the player character | OHA1 Iter 3 |
| This is Sokoban-like (push objects) | This is character navigation (move yourself) | OHA1 Iter 3 |
| The bottom-left pattern is a static "reference" | It's the GateKeeper display, changes dynamically | OHA0 Iter 1-2 |
| The upper arm 9-pattern is a "target to match" | It's the Goal Icon (destination + pattern gate) | OHA0 Iter 2 |
| Moving the block arranges patterns to match reference | Moving the character navigates through the maze | OHA1 Iter 4 |
| Player moves 1 pixel per action | Character moves 5 pixels per step | Level-solver query to OHA1 |

---

## Knowledge Evolution Timeline

### Game-Solver (Depth 0) -- 2 iterations
- **Iter 0:** Started the game. Identified colors and grid structure. Delegated Level 1 and Level 2 to level-solver children. Passed incorrect "ARC puzzle" framing.
- **Iter 1:** Game was already GAME_OVER. Retrieved score. Returned result.

### Level-Solver Child 0 (Level 1, Depth 1) -- 2 iterations
- **Iter 0:** Analyzed grid structure (cell regions, groups). Delegated to OHA with "ARC puzzle" instructions. OHA ran 8 iterations, explored but hit GAME_OVER at 144 actions. Received back failure.
- **Iter 1:** Re-framed as "cross-shaped maze puzzle." Better understanding of maze structure and player position. Delegated to OHA again. OHA ran 8 more iterations with more systematic exploration. Eventually used 248 actions total. Level was completed (action 121 was the completion point based on score data).

### OHA Child 0 (Level 1, Attempt 1, Depth 2) -- 8 iterations
- **Iter 0:** Observed grid. Found cell regions useless (only 1 cell). Identified colors.
- **Iter 1:** Mapped bottom-left "template" and top box inner pattern. Noticed the framed box.
- **Iter 2:** Extracted template as 5x5 pattern. Compared to upper arm pattern. First identified the 12+9 "marker."
- **Iter 3:** Discovered movement: Right shifts 12+9 block by 5 pixels. Mapped maze. Noted "fuel bar" (color 11).
- **Iter 4:** Confirmed block movement mechanics. Began navigating through maze. Discovered wrapping behavior.
- **Iter 5:** Navigated block to upper arm area. Noticed patterns in different areas.
- **Iter 6:** Noted upper arm 9-pattern disappeared. New patterns appeared. Maze restructured. Did not understand this was level progression.
- **Iter 7:** Game Over at 144 actions. Returned failure.

### OHA Child 1 (Level 1, Attempt 2, Depth 2) -- 8 iterations
- **Iter 0:** Re-observed. Found player at (33,21) with 2 pixels. 4 actions already used.
- **Iter 1:** Mapped full maze. Identified walls. Player "not moving" (because the 0/1 pixels are not the player).
- **Iter 2:** Discovered that LEFT action moves the 12+9 block by 5 pixels (52 pixel diffs). Key insight moment.
- **Iter 3:** Formed Sokoban hypothesis. Mapped current positions of all colored objects.
- **Iter 4:** Compared reference pattern to upper arm pattern. Noted they are mirrors. Began trying to position block.
- **Iter 5:** Block near upper arm. Upper arm 9-pattern present. Trying to align.
- **Iter 6:** Upper arm pattern disappeared. New patterns appeared (color 11). Maze restructured. Confused.
- **Iter 7:** Reference pattern changed. "The reference keeps changing." Moved block around. 248 actions used.

### Level-Solver Child 1 (Level 2, Depth 1) -- 7 iterations
- **Iter 0-2:** Repeated initial observations. Identified special pixels. No delegation to OHA.
- **Iter 3:** Moved Right and Up. Discovered block shift. Observed HUD changes. Did not delegate.
- **Iter 4:** Game was already GAME_OVER (250 actions consumed). Retrieved state.
- **Iter 5-6:** Confirmed game over. Returned result.

---

## Structural Issues Observed

### 1. Knowledge not propagated upward
OHA-level discoveries (block movement, fuel depletion, maze structure) were never captured into `__gameKnowledge.confirmed_mechanics`. The level-solver received the OHA's textual answer but did not update its own state. This meant Level 2 started with zero knowledge.

### 2. Level 2 did not use OHA delegation
Despite the 3-tier architecture being available, the Level 2 solver ran all 7 iterations at depth 1 without ever delegating to an OHA child (depth 2). This bypassed the entire action-execution layer, causing it to repeat observations without taking effective action.

### 3. Incorrect initial framing propagated
The game-solver's "ARC-style puzzle" framing was passed in the very first query and was never corrected, even after Level 1 revealed it was a maze/navigation game. The Level 2 query still said: "This is an ARC-style puzzle game... Paint the output using Click (action 6)."

### 4. State variables never updated
`__levelState.world`, `__levelState.hypotheses`, and `__gameKnowledge.confirmed_mechanics` remained empty dictionaries throughout the Level 2 solver's 7 iterations. The state management system was initialized but never utilized.

---

## Summary

The agent's most critical failure was the initial framing: treating ARC-3 as an ARC-style pattern transformation puzzle rather than a maze navigation game. This poisoned all downstream reasoning. At the OHA level, the agent made genuine progress discovering movement mechanics and maze structure, but these discoveries were (a) incorrectly interpreted (Sokoban vs. character navigation) and (b) never propagated back up to inform subsequent level attempts. The core win condition -- matching the GateKeeper pattern to the Goal Icon, then navigating to the goal -- was never discovered. Of 12 canonical discovery items, zero were fully and correctly identified.
