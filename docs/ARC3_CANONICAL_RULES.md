# ARC-3 Canonical Game Rules (ls20)

> **Purpose:** Ground truth reference for evaluating what the RLM discovers vs what's actually true.
> This document is NOT shown to the RLM. It exists solely for human analysis.

## Game Structure

- 64x64 pixel grid, 7 levels per game
- Scored on action efficiency: `human_baseline_actions / ai_actions` per level, averaged, capped at 1.0
- Only directional actions (1-4: up/down/left/right) are needed. Space bar, click, undo exist but are unnecessary.

## Board Elements

### 1. Character (the player)

- A 5x5 block in the maze: the top two rows are orange, the bottom three are blue
- Moves in discrete steps (5 pixels) in cardinal directions (up/down/left/right)
- Blocked by walls (dark color)
- Goal is to reach the Goal Icon, while the correct pattern is set
- Moving the character causes the fuel bar to deplete one unit per step
- Moving the character into a special icon (pattern toggle or color changer) changes the Goal Icon GateKeeper's pattern or color
- The character can "step through" the changes, by moving off and back on to the icon in question.
- The character can refuel all fuel by moving into the Fuel Refill icon

### 2. Maze

- Walls (dark gray/color) and walkable paths (light gray/color)
- Layout changes every level
- Level 7 has **fog of war**: only the region around the character is visible

### 3. Goal Icon

- A fancy/decorated icon inside a framed box, located somewhere in the maze
- Reaching the goal completes the level **IF AND ONLY IF** the Goal Icon GateKeeper's pattern matches the pattern of the Goal Icon in the maze
- If the pattern doesn't match, stepping on the goal has no effect (or wastes an action)
- Visual: appears as a framed/bordered display with a colored pattern inside. It always occurs in the maze.
- Sometimes it is outlined in white pixels, this doesn't mean anything special, beyond still needing to match the Goal Icon GateKeeper's white pixel border pattern (ie the white pixel border is just another pattern and is not special in any way)

### 4. Goal Icon GateKeeper (HUD - bottom-left corner)

- Shows an icon which must be toggled to match the pattern of the Goal Icon in the maze
- Updates when the character steps on a Pattern Toggle or Color Changer
- This is the key state indicator: compare it to the Goal Icon's pattern to know if you're "ready" to reach the goal

### 5. Pattern Toggle (white cross / white cluster)

- A small white plus/cross shape sitting on the maze floor
- **Stepping on it changes the character's current pattern**
- Multiple toggles may exist per level
- The change is reflected in the Current Pattern Display (bottom-left)
- There is likely some geometric connection between the pattern toggle and the goal icon gatekeeper.

### 6. Color Changer (rainbow / multi-colored box)

- A small multi-colored block (green, blue, red, orange quadrants)
- **Stepping on it changes the Goal Icon GateKeeper's color**
- The change is reflected in the Current Pattern Display (bottom-left)

### 7. Fuel Refill (yellow box with dark center)

- A small yellow-bordered square with a dark center dot
- **Stepping on it refills the fuel bar completely**
- Multiple refills may exist per level
- Count the number of steps needed to reach the next action and if there's a fuel refill nearby the path, calculate whether it's worth it to refuel.
- Fuel refills disappear after being used.

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
1. Goal Icon GateKeeper's pattern MUST match the pattern of the Goal Icon in the maze
2. Character MUST navigate to the Goal Icon's position
3. Order matters: reach toggles/changers to match the pattern of the Goal Icon in the maze, then navigate to the goal. Refuel along the way as needed.
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
