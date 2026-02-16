# ARC-3 Canonical Game Rules (ls20)

> **Purpose:** Ground truth reference for evaluating what the RLM discovers vs what's actually true.
> This document is NOT shown to the RLM. It exists solely for human analysis.

## Game Structure

- 64x64 pixel grid, 7 levels per game
- Scored on action efficiency: `human_baseline_actions / ai_actions` per level, averaged, capped at 1.0
- Only directional actions (1-4: up/down/left/right) are needed. Space bar, click, undo exist but are unnecessary.

## Board Elements

### 1. Character (the player)

- A small colored block in the maze
- Has two mutable properties: **pattern** (shape) and **color**
- Moves in discrete steps (5 pixels) in cardinal directions
- Blocked by walls (dark color)

### 2. Maze

- Walls (dark gray/color 4) and walkable paths (light gray/color 3)
- Layout changes every level
- Level 7 has **fog of war**: only the region around the character is visible

### 3. Goal Icon

- A fancy/decorated icon inside a framed box, located somewhere in the maze
- Reaching the goal completes the level **IF AND ONLY IF** the character's current pattern matches the required pattern
- If the pattern doesn't match, stepping on the goal has no effect (or wastes an action)
- Visual: appears as a larger framed/bordered display with a colored pattern inside (e.g., top-right or bottom-right of maze)

### 4. Current Pattern Display (HUD - bottom-left corner)

- Shows the character's **current** pattern/appearance
- Updates when the character steps on a Pattern Toggle or Color Changer
- This is the key state indicator: compare it to the Goal Icon's pattern to know if you're "ready"

### 5. Pattern Toggle (white cross / white cluster)

- A small white plus/cross shape sitting on the maze floor
- **Stepping on it changes the character's current pattern**
- Multiple toggles may exist per level
- The change is reflected in the Current Pattern Display (bottom-left)

### 6. Color Changer (rainbow / multi-colored box)

- A small multi-colored block (green, blue, red, orange quadrants)
- **Stepping on it changes the character's current color**
- The change is reflected in the Current Pattern Display (bottom-left)

### 7. Fuel Refill (yellow box with dark center)

- A small yellow-bordered square with a dark center dot
- **Stepping on it refills the fuel bar completely**
- Multiple refills may exist per level

### 8. Fuel Bar (HUD - bottom of screen)

- Horizontal bar that depletes with each movement action
- When fuel runs out, the character loses a life
- Refilled by stepping on Fuel Refill icons

### 9. Lives Counter (HUD - bottom-right)

- 3 red squares = 3 lives
- Lose a life when fuel runs out
- Lose all 3 = GAME_OVER

## Win Condition Per Level

```
1. Character's current pattern MUST match the Goal Icon's required pattern
2. Character MUST navigate to the Goal Icon's position
3. Order matters: get the right pattern FIRST, then reach the goal
   (or: reach toggles/changers to match, then navigate to goal)
```

## Strategic Sequence

For each level, the optimal strategy is:

1. **Survey**: Identify positions of goal, toggles, color changers, fuel refills
2. **Compare**: Check current pattern (bottom-left) vs goal pattern
3. **Transform**: If they don't match, plan a route through the necessary toggles/changers
4. **Navigate**: Go to the goal
5. **Refuel**: Route through fuel refills if the path is long

## Level 7 Special Rules

- **Fog of war**: Only a small region around the character is visible
- All other rules remain the same
- Exploration must be done by moving around (can't see the full grid)
- Memory of previously seen areas becomes critical

## What Our Agent Got Wrong (v0.1-v0.8)

| What we called it | What it actually is |
|---|---|
| "Marker" (colors 0/1) | Pattern Toggle (white cross) |
| "Absorption" | Stepping on the Pattern Toggle (changing character's pattern) |
| "Rectangle" (color 5 borders) | Goal Icon (framed display) |
| "Entering the rectangle" | Reaching the goal with matching pattern |
| "Border activation" (color 5 -> 0) | Pattern match causing goal to accept the character |
| "Marker respawn" | Toggle still being there (it's persistent, not consumed) |
| "Color 12 entity" | Character (correct) |
| "Color 11 fuel" | Fuel bar (correct) |
| "Color 9 trail" | Character trail / movement residue (mostly correct) |
| Never discovered | Pattern Toggle function |
| Never discovered | Color Changer function |
| Never discovered | Fuel Refill function |
| Never discovered | Pattern matching requirement |
| Never discovered | Lives counter |

## Mapping to Pixel Colors (approximate, from trajectory data)

| Color | Likely Element |
|---|---|
| 3 | Walkable path (light gray) |
| 4 | Walls (dark gray) |
| 5 | Goal icon border/frame |
| 11 | Fuel bar |
| 12 | Character |
| 9 | Character trail |
| 0, 1 | Pattern toggle (white cross pixels) |
| 8 | Decorative / HUD elements |
| Multiple (2,3,6,7,etc.) | Color changer / rainbow box, or pattern display |

## Discovery Checklist

When evaluating an RLM run, check which of these the agent discovered:

- [ ] Character identification (which pixels move)
- [ ] Movement mechanics (direction mapping, step size)
- [ ] Wall detection (what blocks movement)
- [ ] Fuel depletion (resource tracking)
- [ ] Fuel refill discovery (yellow box function)
- [ ] Lives counter recognition
- [ ] Pattern toggle discovery (white cross function)
- [ ] Color changer discovery (rainbow box function)
- [ ] Goal icon identification
- [ ] Current pattern display recognition (bottom-left HUD)
- [ ] Pattern matching requirement (must match to complete level)
- [ ] Strategic sequencing (transform then navigate)
- [ ] Fog of war adaptation (Level 7)
