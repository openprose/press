# Program Critique: ARC-3 Solver v0.2.0

**Reviewer:** Claude Opus 4.6 (automated critical review)
**Date:** 2026-02-17
**Artifacts reviewed:**
- Analysis: `eval/analyses/011-arc3-v2.2.0-deep-dive/` (knowledge-analysis, wrong-moves-analysis, meta-analysis, trajectory-distill)
- Program: `plugins/programs/arc3/` (program.md, game-solver.md, level-solver.md, oha.md)
- Language spec: `LANGUAGE.md`
**Baseline:** Run-027, v2.2.0, 17% score (2/7 levels completed, 431 actions, ~$133 cost)

---

## 1. Coverage Assessment

For each known failure mode from run-027, I assess whether the new program addresses it.

### Failure Mode 1: No BFS Pathfinding
**Status: Partially addressed, but aspirational.**

The `oha.md` action selection section states:

> if strategy == "solve":
>   compute path from player to gatekeeper using known floor cells
>   if path exists: follow it (prefer BFS shortest path over greedy)
>   BFS on maze.cells: treat "floor" as passable, "wall" as blocked, "unknown" as passable-but-risky

This is declarative intent, not a provided implementation. The old run proved the model *can* implement BFS (attempt 6 of L2) but only when the orchestrator provided the *exact algorithm*. In 5 prior attempts, the react agent never wrote BFS independently despite having equivalent capability descriptions in the prose plugin. The new program says "prefer BFS shortest path" but does not provide the function or even illustrative code. The model will face the same choice: write BFS or wander locally. The old evidence says it wanders 5 out of 6 times.

Additionally, the `maze.cells` representation stores cells as `"floor" | "wall" | "unknown"` keyed by `r_c` -- but there is no mention of cell dimensions (5x5 pixels), how to map pixel coordinates to cell coordinates, or how to convert a BFS cell path into `arc3.step()` calls. This pixel-to-cell mapping was a source of bugs in run-027 (wrong-moves-analysis, Failure 4: "mapping between cell coordinates and pixel coordinates is fragile"). The program does not address this.

**Verdict: Necessary intent is present. Implementation guidance is insufficient. The model will likely need 2-3 attempts before it writes working BFS, same as v2.2.0.**

### Failure Mode 2: Broken Player Position Tracking (Color Scan)
**Status: Directly addressed. This is the strongest fix in the program.**

The `oha.md` contract states:

> ensures:
>   - Player position is tracked by MOVEMENT DELTA, not by re-scanning colors
>       (colors appear on multiple objects -- position-by-color is unreliable)

And the invariant:

> MOVEMENT TRACKING: Track player position by accumulating movement deltas
> from diffFrames, NOT by re-scanning for player colors each frame.
> Reason: the player is multicolored (3x3, multiple colors). Other objects
> share those colors. Scanning by color produces false positives.

This directly targets the root cause from wrong-moves-analysis (Failure 1: "the agent searches for ALL pixels of colors 12 and 9 across the maze instead of finding the dense 5x5 player cluster"). The delta-based tracking approach is correct and the rationale is explicit. This is well-designed.

**Risk:** The `findPlayer` capability says "On first call: take one step, diff the two frames, find what moved." This requires spending one action purely for player detection. On later levels where fuel is tight (L3 baseline 172 actions), every action matters. But this is a reasonable trade-off vs the 80+ wasted actions from broken position tracking in v2.2.0.

**Verdict: Strong fix. Likely eliminates the ~50 wasted actions from position tracking bugs.**

### Failure Mode 3: Wall-Bump Perseveration
**Status: Partially addressed.**

The `oha.md` contract states:

> ensures:
>   - If an action has no visible effect: record this as evidence (walls, boundaries, cooldowns)
>   - Never take the same action from the same position twice unless testing a hypothesis

And `level-solver.md` stuck detection:

> stuck if ANY:
>   - same wall bumped 3+ times (perseveration)

The `&LevelState.world.maze.blocked_moves` field (`{ [r_c]: direction[] }`) explicitly tracks walls that have been bumped. This is excellent -- the old system had no record of bumped walls.

**Gap:** The "never take the same action from the same position twice" contract is an `ensures` clause, which is a postcondition the model must satisfy. In practice, perseveration happened inside tight code loops where the model wrote `for (let i = 0; i < 8; i++) arc3.step(4)` without checking results. The contract is correct, but the model generates code, and the code may not check after each step. The old run showed the model writes action-taking loops that skip per-step validation. The contract alone may not prevent this unless the model internalizes the "wrap every action in a diff" directive.

The `always:` section of action selection says:

> wrap every action in: observe_before -> act -> observe_after -> diff -> record
> never act blindly (no action without pre/post observation)

This is the right behavioral guidance. Whether the model follows it consistently is the open question.

**Verdict: Good structural support (blocked_moves tracking, stuck detection). The behavioral contract is correct but compliance depends on whether the model consistently wraps actions in diffs -- same compliance uncertainty that plagued the old system.**

### Failure Mode 4: No Fuel Model
**Status: Directly addressed.**

The `&LevelState.world.hud` schema includes:

> fuel_remaining: number -- estimated from fuel bar pixels
> fuel_max: number

The `readFuel` capability is declared:

> readFuel(frame)
>   -- Find the fuel bar in the HUD region.
>   -- Count pixels of the fuel color vs background in the bar region.
>   -- Returns: { remaining: number, max: number, percent: number }

The invariant states:

> FUEL IS FINITE: Every action costs fuel. When fuel reaches 0, the game ends (GAME_OVER). Monitor fuel and factor it into action decisions.

And the `retreat` strategy triggers on `fuel < 20%`.

**Gap:** The fuel model says "estimated from fuel bar pixels" but does not specify which rows/columns constitute the fuel bar. Run-027 showed the agent counted color 11 pixels across the entire grid (including non-HUD regions), producing wildly wrong fuel readings (wrong-moves-analysis: "fuel=768 is the total color 11 pixel count across the entire grid"). The `readFuel` capability should specify the HUD bar's pixel region (approximately rows 61-62, cols 13-54 based on the 64x64 grid).

**Verdict: Strong structural support. Missing the specific pixel coordinates of the fuel bar, which caused the misreading in v2.2.0. The model will likely get it right eventually via the `parseHUD` capability, but an explicit region hint would prevent the first-attempt misread.**

### Failure Mode 5: Pattern Matching Never Discovered
**Status: This is the program's most ambitious and critical change. Directly addressed through seed hypotheses and dedicated strategy.**

The `oha.md` seed hypotheses include:

> - "The goal is to make the player's pattern match the HUD goal pattern"
> - "The gatekeeper (bottom-right HUD) is the exit -- reach it when patterns match"
> - "Some objects change the player's shape or color when touched"

The `comparePatterns` capability is declared:

> comparePatterns(patternA, patternB, options?)
>   -- Compare two pixel patterns for similarity.
>   -- Handle: exact match, subset match, rotation, scale difference.
>   -- The goal pattern in the HUD may be at a DIFFERENT SCALE than the player's pattern.
>   -- Normalize both to the same dimensions before comparing.
>   -- Returns: { match: boolean, similarity: 0..1, transform_needed: string }

The entire "Pattern Matching (the Win Condition)" section in `oha.md` lays out the 6-step process. The `transform` strategy in `level-solver.md` handles the case where patterns don't match.

**This is a massive improvement.** In v2.2.0, the agent never discovered pattern matching across 431 actions and 13 orchestrator iterations. The knowledge analysis documented: "The core win condition -- matching the GateKeeper pattern to the Goal Icon -- was never discovered. This is the MOST IMPORTANT mechanic in the game." By providing this as a seed hypothesis, the new program gives the agent the answer it failed to discover organically.

**Risk 1:** The seed hypothesis says "The goal is to make the player's pattern match the HUD goal pattern." But the actual mechanic (based on the knowledge-analysis) involves a GateKeeper pattern in the HUD bottom-left that must match the Goal Icon in the maze, and the player toggles the GateKeeper pattern by stepping on pattern toggles. The program's description conflates "player pattern" with "gatekeeper pattern." The HUD section in `&LevelState` says:

> goal_pattern: number[][] -- the target pattern (bottom-left box)
> gatekeeper_pattern: number[][] -- the pattern on the goal gate (bottom-right box)

And the oha.md pattern matching section says:

> critical: the gatekeeper pattern may differ from the goal pattern.
> the gatekeeper shows what the EXIT looks like.
> the goal pattern shows what the PLAYER should look like.
> compare player against GOAL, not against gatekeeper.

**This is confused.** Based on the knowledge-analysis, the actual mechanic is: (a) the HUD bottom-left shows the current gatekeeper pattern; (b) the goal icon in the maze shows the required pattern; (c) stepping on pattern toggles changes the gatekeeper pattern; (d) the level completes when the gatekeeper pattern matches the goal icon AND the player reaches the goal. The program describes this as "player pattern must match goal pattern," which is likely wrong -- it's the gatekeeper pattern that must match, and the player changes the gatekeeper pattern by stepping on toggles. The program will lead the agent to try to change *its own* appearance rather than toggling the gatekeeper pattern.

**Risk 2:** Even with the correct hypothesis seeded, the agent still needs to: (a) implement `comparePatterns` correctly with scale normalization, (b) find the pattern toggle objects in the maze, (c) understand that stepping on them changes the gatekeeper, not the player, (d) plan a multi-step route: toggles -> gatekeeper. This is a complex chain. Seeding the hypothesis helps, but the execution requires multiple cognitive steps that the old system never reached.

**Verdict: Huge improvement in the right direction. The seed hypotheses are the single most valuable addition. However, the mechanic description is subtly wrong ("player pattern matches goal" vs "gatekeeper pattern matches goal icon"), which could misdirect the agent. Needs correction.**

### Failure Mode 6: False Hypotheses Persisted Without Falsification
**Status: Directly addressed through the hypothesis lifecycle.**

The `oha.md` hypothesis lifecycle includes an explicit `falsify` operation:

> falsify(hypothesis)
>   -- Actively seek evidence AGAINST the hypothesis, not just for it
>   -- If you believe "color 11 objects are collectible", try walking PAST one
>   --   without collecting it -- does anything change?
>   -- Confirmation bias is the primary failure mode. Counteract it.

And the `&GameKnowledge` schema includes `refuted_beliefs: string[]`.

The knowledge-analysis found: "The agent accumulated extensive knowledge about how things look and move, but never tested its win-condition hypothesis against the evidence of repeated failure." The meta-analysis found: "Six failed attempts at L2 using the 'collect items' strategy should have triggered a fundamental re-examination of the win condition."

The new system provides the structural mechanism for falsification, but the critical question is: will the model actually use it? The hypothesis lifecycle declares a falsification operation, but there is no contract clause that requires the agent to falsify after N failed attempts. The `level-solver.md` contract says "If 3 consecutive OHA cycles produce no world-state change: change strategy" -- but this is about world-state stasis, not strategy failure. You can take lots of actions that change the world state (moving around, collecting things) while pursuing a fundamentally wrong hypothesis.

**Gap:** There is no explicit contract: "If a strategy has been tried N times across attempts without completing the level, falsify the underlying hypothesis." The GameSolver contract says "If a level fails twice: analyze WHY before retrying" -- this is the closest, but "analyze WHY" is vague. It should be: "If a level fails twice: list all hypotheses with confidence > 0.5, propose a test that would REFUTE each one, and assign those tests as priorities for the next attempt."

**Verdict: Good structural mechanism. Missing the trigger that forces falsification after repeated failure. The model may still accumulate false beliefs if no explicit contract mandates falsification on failure.**

### Failure Mode 7: Manager Layer Was Dead Weight
**Status: Eliminated. The 3-tier architecture now has genuinely different roles at each level.**

The old architecture was: orchestrator -> level-manager -> react + synthesizer. The meta-analysis found: "In every single delegation (12 total), the manager followed exactly the same pattern... This is a deterministic relay station... Net value: zero."

The new architecture is: GameSolver -> LevelSolver -> OHA. The LevelSolver has a fundamentally different role from the old manager:
- It selects strategies (the manager never did)
- It detects stuckness (the manager never did)
- It adjusts between OHA delegations (the manager just passed through)
- It initializes the world model (the manager delegated this to the react agent)

**Risk:** Whether the LevelSolver actually exercises these capabilities or degenerates back into a pass-through depends on the model's execution. The contracts are there, but the old manager also had contracts that it ignored. See Section 2 for deeper analysis.

**Verdict: Architecturally correct elimination of dead weight. The LevelSolver has genuine value -- if it performs as designed.**

---

## 2. Architectural Critique

### Is the 3-tier composition the right structure?

**Yes, with caveats.** The three tiers have genuinely distinct responsibilities:

| Tier | Role | Iteration Count | Per-Iteration Cost |
|------|------|----------------|-------------------|
| GameSolver | Cross-level knowledge curation, budget allocation, retry decisions | ~7-14 | High (Opus) |
| LevelSolver | Within-level strategy selection, stuck detection, progress evaluation | ~5-15 per level | Medium (Opus) |
| OHA | Atomic observe-act cycles, hypothesis updates, perception | ~1-5 per delegation | Medium (Opus) |

The alternative (2-tier: GameSolver -> OHA) would overload OHA with both strategy selection AND perception. The old run showed that react agents that tried to do both ended up doing neither well -- they wandered locally without strategic oversight. The LevelSolver provides the strategic layer that was missing from the old react agent.

The alternative (single-agent) scored 14.3% at $22 cost. The meta-analysis concluded: "The multi-agent architecture's value proposition rests entirely on whether it can eventually solve the pattern-matching problem. If it cannot, the single-agent approach is strictly more efficient." Since the new program seeds the pattern-matching hypothesis, the multi-agent approach now has a viable path to solving what the single agent could not.

**Recommendation: Keep 3 tiers. The LevelSolver justifies its cost IF it actually performs strategy selection and stuck detection.**

### Should there be sibling nodes?

**Yes. A dedicated Pathfinder utility would be high-value.**

The meta-analysis found that BFS pathfinding was the #1 missing capability. The current design puts pathfinding inside OHA's "solve" strategy, but OHA is also responsible for perception, hypothesis management, and action execution. Pathfinding is a *deterministic computation* -- it takes a map and two positions and returns a path. It does not require an LLM. It should be a provided function, not a capability the model reimplements each time.

Option A: Provide `bfs(cellMap, start, goal)` as a pre-implemented sandbox function. This is the simplest approach and avoids delegation overhead. The LevelSolver or OHA calls it directly.

Option B: Create a Pathfinder sibling node that OHA delegates to. This is over-engineered -- BFS is 15 lines of code and does not benefit from LLM reasoning.

**Recommendation: Option A. Provide BFS as a sandbox utility function, not a separate node. Declare it in the program.md shared state section as a utility available to all nodes.**

Similarly, `comparePatterns` and `readFuel` are deterministic computations. They should be provided utilities, not capabilities the model reimplements. Every reimplementation is a chance for bugs (as proven by the broken player tracking code in v2.2.0).

### Is LevelSolver adding enough value?

**It could, but the current design does not guarantee it.**

The LevelSolver's value propositions are:
1. Strategy selection (orient -> explore -> test_hypothesis -> solve -> transform -> retreat)
2. Stuck detection (same wall 3+ times, no new cells discovered, etc.)
3. Between-delegation evaluation (assess whether OHA made progress)

**Risk 1: OHA iteration count.** The program says OHA executes "one atomic step: observe, hypothesize, act, observe, diff." If OHA truly takes only 1-2 actions per delegation, the LevelSolver is spending a full Opus iteration on strategy selection after every 1-2 game actions. That is roughly $0.75 per game action just for oversight. In v2.2.0, the react agent took ~15-50 actions per delegation, with the manager costing ~$1.50 per delegation (2 iterations). If OHA takes only 1-2 actions, the oversight cost per action *increases* dramatically.

**Risk 2: Degeneration.** If the LevelSolver sees that OHA is making progress (player moving, new cells discovered), it will just re-delegate with the same strategy. This is the same pass-through behavior the old manager exhibited. The LevelSolver only adds value when it *changes* strategy -- which should happen maybe 3-5 times per level. The other 10-40 delegations are pass-throughs.

**Recommendation: OHA should take multiple actions per delegation (5-10), not just one. The LevelSolver should delegate with a "take N actions in this strategy" instruction, not "take one step." This reduces the oversight-to-work ratio.**

### Should OHA be split into specialized leaf nodes?

**No. Splitting would increase delegation overhead without proportional benefit.** The four sub-capabilities (perception, hypothesis management, navigation, action selection) are tightly coupled -- you need all four for every game action. Splitting them into separate nodes would require serializing world state between them after every action, which is the exact data loss problem the analyses identified.

The one exception: if a "Hypothesis Evaluator" were a cheap sibling (Flash model, 1 iteration, no game access) that runs periodically to evaluate whether the current hypotheses are consistent with the evidence. The meta-analysis suggested: "A dedicated agent whose job is to evaluate the current win-condition hypothesis... A Flash model could do this for $0.05." This would be a sibling to LevelSolver, not a split of OHA.

**Recommendation: Keep OHA unified. Consider adding a cheap Hypothesis Evaluator sibling to LevelSolver that runs every 3-5 delegations.**

---

## 3. State Schema Gaps

### &GameKnowledge

**Missing fields:**

1. **`known_changers`**: A structured catalog of transformation objects (pattern toggles, color changers) separate from the general `object_catalog`. The agent needs to quickly look up "what objects can I interact with to change the gatekeeper pattern?" Having these mixed into the general catalog means the agent must scan all objects to find changers. Evidence: the knowledge-analysis found "Color changer: The rainbow/multi-colored box that changes the GateKeeper's color was never identified." A dedicated field would make the agent deliberately search for changers.

2. **`win_condition_model`**: An explicit, structured description of the believed win condition, separate from `confirmed_mechanics`. Currently, the win condition is implicit in the seed hypotheses and the pattern-matching section. But the knowledge-analysis showed that the v2.2.0 agent's win-condition model ("collect all color 11 items") was never recorded as a single testable belief -- it was distributed across multiple rules and mechanics. A single field:
   ```
   win_condition_model: {
     description: string    -- "Match gatekeeper pattern to goal icon, then reach goal"
     confidence: 0..1
     evidence: string[]
     last_tested: level
   }
   ```

3. **`level_baselines`**: Estimated human baselines per level, computed from prior performance. The budget strategy in `game-solver.md` says "max_per_level: 3x estimated baseline" but provides no mechanism to estimate baselines. After completing L1 in 25 actions, the agent could estimate L2 will take 30-50 actions.

**Assessment of existing fields:**

- `confirmed_mechanics` is well-designed.
- `object_catalog` is excellent -- storing visual patterns at native resolution enables the `comparePatterns` capability.
- `level_outcomes` is good but should include `maze_map: cells` so the next attempt does not rebuild from scratch (meta-analysis: "each react agent builds a cell map from scratch, 2-3 iterations, 4+ actions" of waste).
- `open_questions` is present but needs a mechanism to prevent premature pruning. The knowledge-analysis found: "The open question about HUD pattern matching was dropped rather than promoted." The schema should tag each question with `asked_at: level` and a contract should ensure questions are preserved for at least 2 levels unless explicitly answered.
- `refuted_beliefs` is an excellent addition that the old system lacked entirely.

### &LevelState

**Missing fields:**

1. **`fuel_per_action`**: The cost of each action in fuel units. The wrong-moves-analysis noted fuel decreases by 2 per action in L3. This is a constant the agent should track and use for path planning (e.g., "can I reach the goal with current fuel?").

2. **`deaths`**: Number of times the player has died/respawned on this level. The wrong-moves-analysis found: "When death occurs, it misreads the respawn as 'Player lost, fuel=768' and continues blindly." Tracking deaths would help the agent recognize and respond to respawn events.

3. **`path_plan`**: The current intended path (sequence of cell coordinates). If the agent has computed a BFS path, it should be stored so subsequent OHA cycles can continue executing it rather than recomputing. Currently, there is no field for a planned path.

4. **`cells_explored`**: A count or percentage of maze cells that have been visited/observed. The explore strategy triggers on "maze coverage < 30%" but there is no field to track this. The `maze.cells` dictionary could be counted, but an explicit metric would be cleaner.

### Maze Representation

The `maze.cells` schema is:
```
maze: {
  cells: { [r_c]: "floor" | "wall" | "unknown" }
  blocked_moves: { [r_c]: direction[] }
}
```

**Sufficient for BFS?** Barely. BFS needs to enumerate neighbors of a cell. With `r_c` string keys, the agent must parse the key into `(r, c)`, compute `(r-1, c)`, `(r+1, c)`, `(r, c-1)`, `(r, c+1)`, and look those up. This is doable but error-prone. An adjacency representation or a 2D array would be more natural for BFS.

**Missing:** The cell-to-pixel mapping. The maze uses 5x5 pixel cells. To convert a BFS path into `arc3.step()` calls, the agent needs to know that moving from cell (3,4) to cell (3,5) requires action 4 (RIGHT). This mapping is not specified anywhere in the state schema.

**Missing:** Object locations in cell coordinates. The `objects` dictionary uses pixel coordinates `[r, c]` but BFS operates on cell coordinates. The agent needs to convert between the two systems. This conversion was a source of bugs in v2.2.0 (wrong-moves-analysis: "The cell-to-pixel correspondence is never validated").

**Recommendation: Add `cell_size: number` (value: 5) and `grid_origin: [r, c]` to the maze schema. Add a note that cell coordinates are `Math.floor((pixel_r - grid_origin[0]) / cell_size)`. This makes the mapping explicit.**

---

## 4. Contract Gaps

### Missing Critical `ensures`

1. **OHA: "Fuel is read and recorded in &LevelState.world.hud.fuel_remaining after every action."** Currently, fuel monitoring is an invariant ("FUEL IS FINITE: Every action costs fuel"), but there is no ensures clause requiring OHA to actually update the fuel field. Without this, the model might track fuel in a local variable but forget to write it back to `&LevelState`, and the LevelSolver's `retreat` strategy (which triggers on `fuel < 20%`) would never fire.

2. **LevelSolver: "If the current attempt completes in fewer actions than the prior attempt, record the strategy as successful in &GameKnowledge."** This enables learning across levels. Currently, `level_outcomes` records whether the level was completed and the key insight, but not which strategy succeeded.

3. **GameSolver: "Before retrying a failed level, the delegation prompt MUST include at least one specific NEW instruction that differs from the previous attempt."** This prevents the "same approach, same failure" loop that dominated L2 in v2.2.0 (6 attempts, first 5 using essentially the same strategy). The current contract says "analyze WHY before retrying" but does not require the retry to be *different*.

4. **OHA: "After reaching a potential goal location and the level not completing, immediately compare the gatekeeper pattern against the goal pattern using comparePatterns."** This is the exact behavior the meta-analysis said would have saved the run: "When the agent reaches the goal and the level doesn't complete, it needs to reason: 'What conditions could prevent level completion?'" Currently, the program describes this behavior in the pattern matching section but does not enforce it as a contract.

5. **LevelSolver: "The world model initialization MUST include parsing the HUD to extract goal_pattern, gatekeeper_pattern, and fuel_remaining before any OHA delegation."** The contract says "&LevelState.world is initialized from the first observation before any delegation" but does not specify that HUD parsing is part of initialization. If the LevelSolver initializes the world but skips HUD parsing, OHA will not have the patterns needed for comparison.

### Contracts That Are Too Vague

1. **GameSolver: "If a level fails twice: analyze WHY before retrying (don't repeat the same approach)."** "Analyze WHY" is not actionable. What does analysis look like? The agent should: (a) list hypotheses that were active during the failed attempts, (b) identify which were tested vs untested, (c) propose alternative hypotheses, (d) assign the cheapest alternative as the focus of the next attempt. This should be a structured `given:` block, not a vague instruction.

2. **LevelSolver: "evaluates progress, adjusts strategy if stuck."** "Adjusts strategy" needs to be defined. The stuck detection section defines when the agent is stuck, but the response is qualitative: "if exploring: change direction (prefer unexplored quadrants)." What does "change direction" mean in code? Should the LevelSolver set a target quadrant in `&LevelState`? Should it blacklist the current strategy? This needs to be a state mutation, not a prose suggestion.

3. **OHA: "Hypotheses are updated after every action (not just at the end)."** Updated how? The hypothesis lifecycle defines `update(hypothesis, observation)`, but the contract does not specify which hypotheses should be checked after each action. Should OHA check all open hypotheses after every action? Only the one related to the current strategy? The old run showed agents that updated hypotheses sporadically -- the contract needs to be more specific: "After every action, check each hypothesis whose `tests_remaining` includes an action similar to the one just taken."

### Missing `requires` Preconditions

1. **OHA requires: "&LevelState.world.hud.goal_pattern is populated (not null/empty)."** If OHA is asked to run the "solve" or "transform" strategy but the goal pattern was never extracted, it cannot compare patterns. This precondition would force LevelSolver to parse the HUD before delegating solve/transform.

2. **OHA requires: "&LevelState.world.maze.cells has at least the player's current cell mapped."** If OHA is asked to "explore" but the maze is completely empty, it has no starting point. The orientation phase should guarantee at least the player's position is mapped.

3. **LevelSolver requires: "arc3.observe() returns a valid frame with state != GAME_OVER."** If the game is already over when LevelSolver is invoked, it should detect this immediately rather than attempting to play.

---

## 5. Strategy Gaps

### Are the 6 strategies sufficient?

**Mostly, but there are two significant gaps.**

**Gap 1: No "investigate_goal_failure" strategy.** When the agent reaches the goal and the level does not complete, the current strategies offer no explicit response. The "solve" strategy assumes reaching the gatekeeper completes the level. When it does not, the agent falls through to... what? It is not "stuck" (the player moved). It is not "exploring" (the goal was found). It is not "transforming" (it may not know transformation is needed). This is exactly the state the v2.2.0 agent was in at L3 attempt 5: "Reached the goal at cell (1,9). Color 1 was absorbed. Level did NOT complete."

**Recommendation: Add a 7th strategy:**
```
  7. "investigate_goal_failure"
     when: player reached gatekeeper AND level did NOT complete
     goal: compare gatekeeper/goal patterns, find pattern-changing objects,
           hypothesize what preconditions were not met
     budget: 10 actions
```

**Gap 2: No "refuel" strategy.** The `retreat` strategy triggers when fuel < 20%, but its goal is "attempt the shortest path to gatekeeper with current pattern" -- it gives up on optimization and tries to complete. There is no strategy for "fuel is getting low, go find a fuel refill." The knowledge-analysis found: "Fuel refill: That fuel refills vanish after use was never confirmed." The wrong-moves-analysis found: "The agent never considers finding a fuel refill on the way." A dedicated refuel strategy would address this:
```
  "refuel"
     when: fuel < 40% AND fuel_refill locations known in object_catalog
     goal: navigate to nearest fuel refill, then resume previous strategy
     budget: 10 actions
```

### Is the priority ordering correct?

**Mostly, but `test_hypothesis` should be higher priority than `explore`.**

Current order: orient -> explore -> test_hypothesis -> solve -> transform -> retreat.

Problem: the `explore` strategy triggers when "maze coverage < 30% OR unknown objects exist." In early play, maze coverage is always < 30%, so the agent will explore before testing hypotheses. But the most valuable thing the agent can do is test the win-condition hypothesis early. If the agent can quickly determine whether the level requires pattern matching (by comparing the HUD goal to the gatekeeper), it can plan its exploration around finding transformation objects rather than blindly mapping corridors.

**Recommendation: Reorder to: orient -> test_hypothesis -> explore -> transform -> solve -> retreat.** Test the win-condition hypothesis immediately after orientation. If pattern matching is confirmed, exploration becomes targeted (search for changers) rather than generic.

### Are the budget allocations realistic?

**No. They are too conservative for later levels.**

| Strategy | Budget | Concern |
|----------|--------|---------|
| orient | 4 actions | Reasonable |
| explore | min(15, remaining/2) | L3 baseline is 172. 15 actions explores maybe 15 cells of a ~169-cell maze (13x13). That's 9% coverage. Need 40+ to hit 30%. |
| test_hypothesis | 5 actions per test | Reasonable for simple tests, but a pattern-matching test (step on toggle, compare before/after) might take 5+ actions just to reach the toggle. |
| solve | remaining actions | Fine |
| transform | min(20, remaining - 10) | Inadequate. If the agent needs to visit 2 pattern toggles and a color changer, each requiring 10+ navigation actions, 20 is too few. |
| retreat | remaining | Fine |

**Recommendation: Scale budgets by level. L1 budgets are fine as-is. L3+ should have explore budget of min(40, remaining/2) and transform budget of min(40, remaining - 15).**

### Strategy for "transformed but still doesn't match"?

**No. This is a critical gap.** If the agent transforms its pattern (or the gatekeeper pattern) but comparePatterns still returns `match: false`, the current strategies offer no guidance. The `transform` strategy says "visit changers to modify player pattern toward the goal" and "re-compare after transformation -- did it help?" But if it did NOT help, the strategy has no fallback. Does the agent try a different changer? Undo the transformation? Try a different order of transformations?

**Recommendation: Add to the `transform` strategy:**
```
  if transformation did NOT bring patterns closer to matching:
    - record the transformation and its result in observation_history
    - if the transformation moved AWAY from the goal: undo it (step on the toggle again)
    - if multiple changers exist, try the untried one
    - if all changers tried and no match: propose hypothesis "win condition may not be pattern matching for this level"
```

---

## 6. Specific Recommendations

### Recommendation 1: Provide BFS as a sandbox utility, not a capability to reimplement

**File:** `plugins/programs/arc3/program.md`
**Change:** Add a "Shared Utilities" section after Shared State:

```
## Shared Utilities

Available as sandbox globals. Do NOT reimplement -- call directly.

### bfs(cells, start, goal)
Breadth-first search on the maze cell grid.
- `cells`: { [r_c]: "floor" | "wall" | "unknown" }
- `start`: [r, c] in cell coordinates
- `goal`: [r, c] in cell coordinates
- Returns: [r, c][] -- path from start to goal, or null if unreachable
- Treats "floor" and "unknown" as passable, "wall" as blocked

### cellToActions(path)
Converts a cell path to a sequence of arc3.step() action numbers.
- path: [r, c][] from bfs()
- Returns: number[] -- action codes (1=up, 2=down, 3=left, 4=right)
```

And include the actual JavaScript implementation in the section (15-20 lines of code for BFS + 10 for cellToActions).

**Why:** The meta-analysis found BFS was the #1 missing capability (saving ~150 actions on L2). The model implements BFS correctly when told to, but 5 out of 6 times it does not write it without explicit prompting. Providing it as a utility eliminates the implementation variability.

**Expected impact:** +5-10% score improvement from action efficiency on navigation-heavy levels.

### Recommendation 2: Correct the pattern matching mechanic description

**File:** `plugins/programs/arc3/oha.md`
**Change:** Replace the "Pattern Matching (the Win Condition)" section:

```
## Pattern Matching (the Win Condition)

The core puzzle: the HUD bottom-left shows a GATEKEEPER PATTERN.
The goal icon in the maze shows the REQUIRED PATTERN.
The level completes when:
  (1) the gatekeeper pattern matches the goal icon pattern, AND
  (2) the player reaches the goal icon location.

You do NOT change the player's pattern. You change the GATEKEEPER
pattern by stepping on toggle objects (white cross / color 0+1 patterns)
or color changers (multi-colored boxes) in the maze.

given: hud.goal_pattern, hud.gatekeeper_pattern

  step 1: compare gatekeeper_pattern vs goal_pattern
  step 2: if they match -> navigate to goal icon (solve strategy)
  step 3: if they don't match -> find toggle/changer objects in the maze
  step 4: step on a toggle -> observe gatekeeper_pattern change in HUD
  step 5: re-compare -> repeat until gatekeeper matches goal
  step 6: navigate to goal icon
```

**Why:** The current description says "make the player's pattern match the HUD goal pattern." Based on the knowledge-analysis discovery checklist, the actual mechanic involves changing the gatekeeper pattern via toggles, not changing the player's appearance. Getting this wrong would send the agent searching for player-transformation objects that may not exist, wasting actions on a misunderstanding.

**Expected impact:** Critical for correctness. Without this fix, the agent will pursue the wrong sub-goal even with the right overall hypothesis.

### Recommendation 3: Add explicit HUD region coordinates

**File:** `plugins/programs/arc3/oha.md`
**Change:** In the `parseHUD` capability, add:

```
  parseHUD(frame)
    -- The HUD occupies rows 52-63 of the 64x64 grid.
    -- Layout (approximate, verify by observation):
    --   Fuel bar:        rows 61-62, cols ~13-54 (color 11 = fuel, rest = background)
    --   Goal pattern:    rows 54-60, cols 2-8 (bordered box, bottom-left)
    --   Lives indicator: rows 54-60, cols 56-62 (color 8 = lives, bottom-right)
    --   Gatekeeper:      rows 54-60, cols 10-16 (or embedded in goal area)
    -- These are approximate. Verify positions on the first frame.
```

**Why:** The wrong-moves-analysis found the agent read fuel as "768" by counting color 11 across the entire grid. Providing approximate HUD coordinates prevents this misread.

**Expected impact:** Eliminates first-attempt fuel misreading. Prevents 1 death + ~27 wasted actions per run.

### Recommendation 4: Increase OHA's action count per delegation

**File:** `plugins/programs/arc3/oha.md`
**Change:** In the Goal section, change from "one atomic step" to:

```
## Goal

Execute the strategy assigned in &LevelState.current_strategy. Take up to
N actions per delegation (where N is set by LevelSolver in &LevelState),
wrapping EACH action in observe-diff-record. Return when:
  - N actions taken, OR
  - strategy goal achieved, OR
  - stuck (same position for 3 consecutive actions), OR
  - level completed or game over

Typical N values:
  orient: 4 (one per direction)
  explore: 8-12
  test_hypothesis: 3-5
  solve: remaining budget
  transform: 10-15
  retreat: remaining budget
```

**Why:** If OHA takes 1 action per delegation, the LevelSolver spends one full Opus iteration (~$0.75) supervising each game action. With 431 actions, that is $323 just for oversight -- far more than the entire v2.2.0 run cost. The LevelSolver should delegate 5-15 actions at a time, checking between batches. This matches the v2.2.0 react agent pattern (15-50 actions per delegation) but with better structure.

**Expected impact:** Reduces cost by 60-80% without loss of strategic oversight. The LevelSolver still evaluates between delegations, but at a 5-15x lower frequency.

### Recommendation 5: Add a pixel-to-cell coordinate system

**File:** `plugins/programs/arc3/program.md`
**Change:** Add to the `&LevelState` maze schema:

```
    maze: {
      cell_size: 5                          -- pixels per cell (constant across levels)
      grid_origin: [r, c]                   -- pixel coordinates of cell (0,0)
      grid_dims: [rows, cols]               -- number of cells (e.g., 13x13)
      cells: { [r_c]: "floor" | "wall" | "unknown" }
      blocked_moves: { [r_c]: direction[] }
    }

    -- Conversion functions (OHA implements these):
    -- pixelToCell(pr, pc) = [Math.floor((pr - grid_origin[0]) / cell_size),
    --                        Math.floor((pc - grid_origin[1]) / cell_size)]
    -- cellToPixel(cr, cc) = [grid_origin[0] + cr * cell_size,
    --                        grid_origin[1] + cc * cell_size]
```

**Why:** The wrong-moves-analysis (Failure 4) documented that "the mapping between cell coordinates and pixel coordinates is fragile" and "the cell-to-pixel correspondence is never validated." Making the mapping explicit in the schema prevents this class of bug.

**Expected impact:** Eliminates coordinate system confusion, saving ~20 actions per level retry.

### Recommendation 6: Add "investigate_goal_failure" strategy

**File:** `plugins/programs/arc3/level-solver.md`
**Change:** Add between "solve" and "retreat":

```
  6. "investigate_goal_failure"
     when: observation_history shows player reached gatekeeper AND level did NOT complete
     goal: compare gatekeeper_pattern vs goal_pattern using comparePatterns.
           If they don't match: identify transformation objects and switch to "transform".
           If they do match: investigate other completion conditions (items, switches).
     budget: 8 actions
```

**Why:** The trajectory-distill showed that at L3 attempt 5, the agent "Reached the goal at cell (1,9). Color 1 was absorbed. Level did NOT complete." The agent had no protocol for this situation and its next action was a fuel-depleted move that caused GAME_OVER. An explicit strategy for goal-reach-without-completion would have triggered pattern comparison.

**Expected impact:** If this strategy correctly triggers pattern comparison, it enables the agent to discover the transformation requirement even without the seed hypotheses. Critical for levels where the agent reaches the goal early.

### Recommendation 7: Persist maze maps across attempts in &GameKnowledge

**File:** `plugins/programs/arc3/program.md`
**Change:** Add to `level_outcomes`:

```
  level_outcomes: {
    [level]: {
      completed: boolean
      actions_used: number
      key_insight: string
      strategies_tried: string[]
      maze_map: { cells, grid_dims, grid_origin }  -- persisted from &LevelState.world.maze
      known_objects: { [id]: { type, position, interacted } }  -- from &LevelState.world.objects
    }
  }
```

**Why:** The meta-analysis found: "Each react agent builds a cell map from scratch (2-3 iterations, 4+ actions). If the map were stored... subsequent attempts could skip mapping entirely. Cost savings: ~15 actions and ~$5 per level retry." Persisting the map in level_outcomes allows the next attempt to start with a pre-built maze.

**Expected impact:** Saves 4-8 actions per retry (12-24 actions over 3 retries of a single level).

### Recommendation 8: Add falsification trigger contract to GameSolver

**File:** `plugins/programs/arc3/game-solver.md`
**Change:** Add to the contract:

```
ensures:
  ...existing ensures...
  - If a level fails twice with the same dominant hypothesis active:
      mark that hypothesis as "tested_and_failed" in &GameKnowledge.refuted_beliefs,
      propose at least one ALTERNATIVE hypothesis in the next delegation brief,
      assign that alternative as the priority investigation target
  - The delegation prompt for a retry MUST include at least one new instruction
    that was NOT in the previous delegation prompt
```

**Why:** The knowledge-analysis found: "Six failed attempts at L2 using the 'collect items' strategy should have triggered a fundamental re-examination of the win condition, but the knowledge system has no mechanism for this kind of epistemic revision." The current GameSolver contract says "If a level fails twice: analyze WHY" but does not mandate that the analysis produces a *different* approach.

**Expected impact:** Prevents the 5-attempt repetition loop from v2.2.0. Could save 100+ actions per level stuck on a wrong hypothesis.

### Recommendation 9: Make open question preservation a hard contract

**File:** `plugins/programs/arc3/game-solver.md`
**Change:** In the Knowledge Curation section, change `preserve` to a contract:

```
ensures:
  ...existing ensures...
  - Open questions from &LevelState are preserved in &GameKnowledge.open_questions
    for at least 2 levels UNLESS explicitly answered by confirmed evidence.
    Reason: the most important open question in v2.2.0 ("Does the HUD pattern
    need to match something?") was dropped after 1 level without being answered.
```

**Why:** The knowledge-analysis found: "The most important open question -- 'Does the HUD bottom-left box pattern need to match something?' -- was asked in L1 and persisted through iteration 2 but was DROPPED by iteration 3 without being answered. This was the closest the agent came to discovering the core mechanic." Preserving questions is a known curation failure that must be prevented.

**Expected impact:** Low direct impact (the seed hypotheses now provide the pattern-matching insight directly), but prevents future curation losses for novel mechanics the seed hypotheses do not cover.

### Recommendation 10: Add OHA action batching and the seed hypothesis for gatekeeper toggle

**File:** `plugins/programs/arc3/oha.md`
**Change:** Add to seed hypotheses:

```
initial_hypotheses:
  ...existing hypotheses...
  - "Stepping on white-cross patterns (colors 0/1) toggles the gatekeeper pattern in the HUD"
  - "Multi-colored boxes change the gatekeeper's color scheme"
  - "The gatekeeper pattern must match the goal pattern BEFORE the level can complete"
```

**Why:** The existing seed hypothesis says "The goal is to make the player's pattern match the HUD goal pattern" which is subtly wrong (it's the gatekeeper pattern, not the player pattern). Adding specific toggle/changer hypotheses guides the agent toward the correct interaction model. The knowledge-analysis documented: "Pattern toggle discovery (color 0/1 noticed but misidentified as harmful 'special items')" -- the agent found the toggles but misinterpreted them. Correct seed hypotheses prevent this misinterpretation.

**Expected impact:** Critical for L2+ completion. Without correct toggle understanding, the agent cannot complete any level that requires pattern transformation.

### Recommendation 11: Specify the LevelSolver's initialization code more concretely

**File:** `plugins/programs/arc3/level-solver.md`
**Change:** Expand the Initialization section with illustrative code:

```
## Initialization

On first iteration, before any delegation, write and execute JavaScript that:

1. Calls arc3.observe() to get the initial frame
2. Parses the 64x64 grid to identify:
   a. Maze area (rows 0-51) vs HUD area (rows 52-63)
   b. Player position: take one test step, diff, find what moved, step back
   c. Cell size: measure wall spacing (expect 5px cells)
   d. HUD goal pattern: extract the bordered box contents in the bottom-left
   e. HUD gatekeeper pattern: extract the second bordered box
   f. Fuel: count fuel-colored pixels in the fuel bar region
   g. Objects: findComponents on the maze area, excluding player and background
3. Writes all findings to &LevelState.world
4. Sets &LevelState.current_strategy = "orient"

This MUST produce a populated &LevelState.world before the first OHA delegation.
If parsing fails, retry with a different approach before delegating.
```

**Why:** The old run showed that initialization was inconsistent -- sometimes thorough, sometimes skipped. The LevelSolver contract says "world is initialized from the first observation before any delegation" but does not specify what "initialized" means in enough detail. The HUD parsing (goal pattern, gatekeeper pattern, fuel) is particularly critical and was often skipped in v2.2.0.

**Expected impact:** Ensures OHA has a populated world model from iteration 0. Saves 2-3 OHA iterations of re-discovery.

### Recommendation 12: Add a guard against budget-busting single OHA delegations

**File:** `plugins/programs/arc3/level-solver.md`
**Change:** Add to the Delegation Loop:

```
    delegate OHA {
      goal: strategy.goal
      action_limit: min(strategy.budget, &LevelState.action_budget - &LevelState.actions_taken)
      &LevelState
    }

    // After child returns, verify budget compliance:
    if &LevelState.actions_taken > prior_actions + action_limit + 2:
      // OHA overran its budget. Record this and reduce future limits.
      log("WARNING: OHA overran budget by " + overrun + " actions")
```

**Why:** The meta-analysis found: "Budget compliance is approximately 50%. The orchestrator itself sometimes inflated the budget. The react agents overran the budget when they were 'on the trail.'" The new architecture needs explicit budget enforcement at the LevelSolver level, with the LevelSolver monitoring OHA's actual action consumption vs its allocation.

**Expected impact:** Prevents single OHA delegations from consuming the entire level budget. Saves ~50 actions per run from budget overruns.

---

## Overall Assessment

### Will this program score better than 17%?

**Probably yes, with the recommended fixes. Without them, it is a coin flip.**

The program's two strongest improvements are:
1. **Seed hypotheses about pattern matching** -- this directly addresses the #1 failure mode (pattern matching never discovered) that was responsible for all L3+ failures.
2. **Movement tracking by delta** -- this directly addresses the #2 failure mode (broken position tracking) that wasted ~50 actions.

These two changes alone could push the score to 25-35% (L1 at 100%, L2 at 60-80%, L3 at 20-40%).

However, the program has significant risks that could cause it to score WORSE:
1. **OHA as single-action leaf**: If OHA takes 1 action per delegation, the cost will be 3-5x higher than v2.2.0 with no score improvement. This is the most dangerous design flaw.
2. **Confused mechanic description**: If the agent tries to change its own pattern instead of the gatekeeper pattern, it will waste all L2+ actions pursuing the wrong transformation.
3. **No provided BFS implementation**: The model will reimplement BFS each time, introducing bugs. 5/6 times in v2.2.0, the model did not write BFS at all.

### Score prediction with recommended fixes applied:

| Level | Predicted Score | Rationale |
|-------|----------------|-----------|
| L1 | 90-100% | Same as v2.2.0. May be slightly worse if OHA overhead costs 1-2 extra actions. |
| L2 | 50-80% | BFS provided as utility + correct pattern matching hypothesis = faster completion. Budget: 50-80 actions vs 214 in v2.2.0. |
| L3 | 15-40% | Pattern matching hypothesis + fuel tracking + BFS enable completion, but fuel management on the larger maze is challenging. Budget: 150-200 actions. |
| L4-L5 | 0-20% | Novel mechanics may require new hypotheses beyond seeds. Pattern matching foundation helps but doesn't guarantee. |
| L6-L7 | 0-10% | L7 fog of war is fundamentally different. No special handling in the program. |
| **Total** | **25-45%** | Central estimate: **35%** (roughly 2x the v2.2.0 score) |

### Score prediction WITHOUT recommended fixes (program as-is):

| Level | Predicted Score | Rationale |
|-------|----------------|-----------|
| L1 | 80-100% | Overhead from 3-tier delegation may cost 2-5 extra actions. |
| L2 | 20-50% | Confused pattern matching description + no BFS utility = multiple failed attempts. Better than v2.2.0 due to seed hypotheses but not dramatically. |
| L3 | 0-15% | If L2 burns too many actions, L3 budget is limited. Fuel management still weak without explicit HUD coordinates. |
| L4+ | 0% | Unlikely to reach with enough actions remaining. |
| **Total** | **15-25%** | Central estimate: **20%** (marginal improvement over v2.2.0's 17%) |

### Cost prediction:

With OHA taking 1 action per delegation (as currently designed): **$200-300** (worse than v2.2.0's $133).
With OHA taking 5-12 actions per delegation (recommendation 4): **$60-90** (better than v2.2.0).

### The bottom line:

The program is architecturally sound and addresses the right failure modes. But it under-specifies critical implementation details (BFS, HUD coordinates, cell mapping), gets the core mechanic subtly wrong (player pattern vs gatekeeper pattern), and risks massive cost inflation from single-action OHA delegations. With the 12 recommendations above applied, this program should reliably beat 25% and has a realistic path to 40-50%. Without the fixes, it is a marginal improvement over v2.2.0 at higher cost.

The single most impactful fix is Recommendation 2 (correcting the pattern matching mechanic description). If the agent pursues the wrong transformation target, no amount of architectural elegance will help.
