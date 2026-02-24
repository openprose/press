# Analysis: Container Paradigm in ARC-3 v0.6.0

**Run**: 016-arc3-program-v0.6.0
**Score**: 4.65 / 100 (1 of 7 levels completed, 334 actions, GAME_OVER)
**Model**: claude-opus-4-6
**Program version**: v0.6.0 (composition guide, component catalog)
**Root iterations**: 3 (but effectively 1 massive iteration with many code blocks, then 1 curation+delegation, then 1 continuation)
**Child delegations**: 5 OHA invocations (0 level-solver invocations)

---

## Executive Summary

The container paradigm failed comprehensively in this run. The root agent -- designated as the "intelligent container" -- collapsed into a leaf agent during its first two iterations, spending 25 game actions directly via `arc3.step()` (which its program explicitly lists as `prohibited`). It never used the `level-solver` coordinator component. It never referenced the composition vocabulary from `root.md`. Its briefs contained detailed pixel-level analysis that contaminated every child delegation. The one level it completed (level 0, 89 actions vs 29 baseline) was solved by a child OHA that had to re-discover the game world despite receiving a map from the parent. The remaining 245 actions were spent on level 1 without completing it. The container model's central thesis -- that an LLM reading prose programs will make runtime composition decisions -- did not hold up against the gravitational pull of direct action.

---

## 1. Did the Root Agent Act as an Intelligent Container?

### Did it read the component catalog from globalDocs?

**No evidence that it did.** The root agent's reasoning across all three iterations contains no references to the component catalog, composition vocabulary, or composition principles from `root.md`. These were injected as `globalDocs` into every agent's `<rlm-environment>`, so the root definitely saw them. But it never cited them in its reasoning, never mentioned the `requires from caller` / `produces for caller` contracts, and never explicitly selected a composition style.

The closest it came was a comment at line 1305:
```
// Let me delegate to OHA (direct style since depth budget allows it)
```
This mentions "direct style" -- a vocabulary term -- but the reasoning is post-hoc: it had already decided to delegate to OHA and was rationalizing the choice. There is no evidence of the root reading the catalog, comparing components, and selecting.

### Did it make composition decisions based on observable state?

**Partially.** The root did check `__rlm.depth` and `__rlm.maxDepth` before delegating. But it never checked:
- Whether `depthBudget < 2` (which would justify direct over coordinated)
- How many confirmed mechanics it had (which would distinguish exploratory from targeted)
- Whether the action budget was thin or rich
- Whether a prior composition failed structurally

Its decision to use "direct" composition (OHA only, skip level-solver) was made implicitly by hardcoding `app: "oha"` in every delegation call. It never considered coordinated composition at any point.

### Did it select from the composition vocabulary?

**No.** Every delegation used the same pattern:
```javascript
await rlm(brief, null, { app: "oha", model: "intelligent", maxIterations: N })
```

There was no variation. No coordinated delegation. No exploratory vs targeted distinction. The `compositionStyle` and `briefStyle` variables from the game-solver.md delegation pattern were never instantiated. The root treated composition as a solved problem on the first attempt and never revisited it.

### Did it satisfy requires before delegating?

**Partially, but contaminated.** The root did:
- Initialize `__gameKnowledge` (though not using the schema from root.md)
- Initialize `__levelState` with level, attempt, action_budget

But it did not:
- Check OHA's `requires from caller`: "LevelState exists with current_strategy set" and "LevelState.world has at least grid_dimensions populated"
- For the first delegation, `current_strategy` was set to `"explore_and_discover"` -- not a strategy from the OHA strategy list
- `__levelState.world` was set to `{ grid_dimensions: [64, 64], player: { position: [34, 22], colors: [0] }, background_colors: [4] }` -- partially satisfying OHA's requirement but using analysis the root had done itself

### Did it curate after delegation?

**Somewhat, but late and shallow.** After the first OHA child returned (having completed level 0), the root in iteration 2 did update `__gameKnowledge` with:
- `confirmed_mechanics`: movement, push_block, bordered_box_goal, fuel_system, corridor_layout
- `level_outcomes[0]`: completed, actions, key insight
- `object_catalog`: push_block, bordered_box, pattern_display

This is genuine curation. But:
1. It happened one iteration late -- the root wasted iteration 1 on direct play before delegating
2. The curation was manual prose, not reading from `__levelState` as the program specifies
3. After level 1 delegation (which failed), curation was minimal -- just recording the outcome
4. For levels 2-6, the `solveLevel()` function was a mechanical loop with no curation between levels

---

## 2. Did Children Act as Containers for Their Subtrees?

### Was level-solver ever used?

**No.** The level-solver coordinator component was never invoked. Not once in the entire run. Every delegation went directly to OHA. The root chose "direct" composition exclusively, meaning it inherited all coordinator responsibilities:
- Initialize `&LevelState.world` from first observation
- Set `current_strategy`
- Detect when stuck and change strategy
- Write `key_findings` before returning

The root partially handled some of these (world initialization, strategy setting) but abandoned stuck detection and key_findings entirely.

### Was the distributed composition model evident?

**No.** With only two tiers (root -> OHA), there was no distributed composition. OHA children operated as pure leaf agents -- they observed, hypothesized, and acted. They never made composition decisions themselves (correctly, as leaves). But the absence of the coordinator tier meant no agent was managing strategy cycles or detecting stuck states.

---

## 3. Composition Decision Quality

### Delegation 1: Level 0 to OHA (direct + exploratory)

**Component selected**: OHA (leaf)
**Topology**: direct (skip coordinator)
**Brief style**: exploratory-ish but contaminated
**Decision quality**: Poor

The brief contained:
- Pixel-level world map ("Vertical path cols ~34-37, rows ~17-24")
- Specific object locations ("Bordered box at rows 8-16, cols 30-42")
- Game interpretation ("maze navigation game")
- Player position ("currently at row 34, col 22")

This violates the "briefs are interfaces" principle. The root dumped its own pixel analysis into the brief. The child then had to re-discover the world because the root's analysis was incomplete (it hadn't found the pushable block mechanism yet). The root's wrong initial hypothesis (that this was a click-based ARC puzzle) wasted the first 25 actions before any delegation.

**Why coordinated would have been better**: With `depthBudget = 2` and no prior knowledge, the composition vocabulary explicitly says "coordinated" is appropriate. A level-solver coordinator would have:
1. Parsed the initial frame properly (its contract requires this before any OHA delegation)
2. Set the right strategy ("orient" -> "explore" -> "execute_plan")
3. Detected when OHA was stuck and changed strategies
4. Produced `key_findings` for the root's curation

### Delegations 2-8: Levels 1-6 to OHA (direct + targeted)

**Component selected**: OHA (leaf), always
**Topology**: direct, always
**Brief style**: targeted (rich with mechanics from level 0)
**Decision quality**: Degrading

For level 1, the brief was reasonable -- it contained confirmed mechanics from level 0. But it also contained tactical advice:
```
Key strategy from level 0: Push the 5x5 block through the corridors into the bordered target box.
Plan your pushes carefully.
```

This is not "facts from state" -- it's the parent's strategic interpretation. OHA has its own strategy selection system.

For levels 3-6, the root created a `solveLevel()` function that mechanically delegated with a fixed brief template. There was no adaptation:
- Same brief regardless of whether prior levels succeeded or failed
- Same `maxIterations` (decreasing from 12 to 8-10)
- No analysis of why level 1 failed before trying level 2
- No composition change despite level 1's structural failure (245 actions, 0 levels completed)

### Budget and depth headroom

The root had `maxDepth=3`, `depth=0`, giving `depthBudget=2`. This was sufficient for coordinated composition (root -> level-solver -> OHA). The root never checked this. The `action_budget` was generous (40-100 per level), also justifying coordinated composition. Neither budget consideration was factored into the composition decision.

---

## 4. Container Pitfalls

### No global consistency arbiter

**Manifest.** When the root skipped level-solver, nobody satisfied the coordinator's responsibilities:
- `&LevelState.world` initialization was incomplete (root set grid_dimensions but not player, maze, objects)
- `key_findings` were never written by OHA (its contract says "does NOT produce" this)
- Stuck detection was never performed
- Strategy transitions ("orient" -> "explore" -> "execute_plan") were never managed

The component catalog explicitly documents this in the `does NOT produce` section for OHA. The root was supposed to read this and know it was inheriting those responsibilities. It did not.

### Ephemeral topology

**Partially logged.** The root did write `composition_used: "direct"` in level outcomes. But it never logged why it chose direct. There is no trace of composition reasoning -- just the result. If this were a real system, you could not reconstruct why coordinated was never tried.

### Cascading failures

**Severe.** The root's contaminated brief for level 1 told OHA that "Player is color 0" and "corridors are color 3." But on level 1, the color mapping changed -- color 0 was the background (2925 pixels), not the player. OHA spent 245 actions confused about which pixel was the player because the brief's color assignments were wrong for this level. A wrong brief at depth 0 burned the entire level 1 budget at depth 1.

This is the exact cascading failure CONTAINER.md warns about: "A contaminated brief at depth 0 burns hundreds of actions at depth 2 before anyone intervenes."

### State schemas coupled to topology

**Broken.** The root set `__levelState.key_findings = null` for every level. OHA never wrote key_findings (its contract explicitly says it does not produce these). The root then checked `__levelState?.key_findings?.key_insight` and got `undefined`, recording "no findings returned." The state schema expected a coordinator to produce key_findings; skipping the coordinator left this field permanently empty.

### Collapse

**Total collapse in iterations 0-1.** The root agent's program says:
```yaml
prohibited: [arc3.step]
```

And the composition principle says:
```
Observable symptom: if you called arc3.step() and your role says
prohibited: [arc3.step], you have collapsed.
```

The root called `arc3.step()` at least 25 times across iterations 0 and 1:
- Iteration 0: `arc3.step(6, 14, 45)` x13 (click actions on wrong game!), `arc3.step(5)` x1 (submit)
- Iteration 1: `arc3.step(4)` x2 (right), `arc3.step(2)` x3 (down), `arc3.step(3)` x1 (left), `arc3.step(4)` x1 (right), plus 12 more via a loop

This is textbook collapse. The orchestrator absorbed the leaf's work. The root did everything itself for the first ~25 actions: frame analysis, movement, object interaction. It only delegated after it had already explored the game world. This is the single most severe violation of the container model observed in this run.

---

## 5. Composition Principles Adherence

### Curation is the return on composition

**Partially upheld.** The root did curate after level 0 -- it promoted mechanics to `__gameKnowledge`, recorded outcomes, and built a knowledge brief for level 1. This is the one area where the container model added value: knowledge from level 0 was transmitted to level 1's OHA child. However:
- Curation was manual, not reading from `__levelState` as the program specifies
- After level 1 failed, there was minimal curation -- just "block pushing"
- Levels 3-6 used a `solveLevel()` function with no curation between them
- The root never promoted hypotheses from children's `__levelState.hypotheses`

### Collapse is the default failure mode

**Confirmed empirically.** The root collapsed in iterations 0-1. The composition principles warn about this as the primary anti-pattern, and it happened despite the program explicitly marking `arc3.step` as prohibited. The model's gravitational pull toward direct action overwhelmed the prose constraint.

### Budget proportionality

**Violated.** With `depthBudget=2` and `action_budget=40`, the composition vocabulary says coordinated composition is justified. The root used direct composition for every level. When level 1 failed with 245 actions, the root did not switch to a different composition style -- it just tried the same approach with smaller iteration budgets.

### Satisfy requires before delegating

**Partially satisfied.** The root initialized `__levelState` and `__gameKnowledge` before each delegation. But:
- OHA's `requires`: `current_strategy` set and `world.grid_dimensions` populated
- Root set `current_strategy = "push_block_to_target"` (not in OHA's strategy list)
- Root set grid_dimensions but not the full world model OHA expects
- Root never checked the component catalog's `requires from caller` section

### Briefs are interfaces

**Violated.** Every brief from the root contained the root's own analysis:
- "Player is a single pixel of color 0, currently at row 34, col 22" (parent's frame analysis)
- "Corridors (color 3) form paths through color 4 background" (parent's observation)
- "Bordered box at rows 8-16, cols 30-42" (pixel coordinates from parent's analysis)
- "Key strategy from level 0: Push the 5x5 block..." (tactical advice)

The program says briefs should contain "goals, confirmed knowledge (from &-state), open questions, retry context" and "NEVER contain action-level instructions, game genre labels, pixel analysis." Every brief violated this contract.

---

## 6. What Went Well

### Knowledge transfer between levels

The root's curation after level 0 was genuine. It identified:
- Movement mechanics (directional actions 1-4)
- Push block behavior (5x5, moves 5px, blocked by walls)
- Goal condition (push block into bordered box)
- Fuel system (HUD bar)

This knowledge was transmitted to the level 1 OHA child, which immediately recognized the block and target without re-discovering them from scratch. This is the core value proposition of composition: level 0 discoveries accelerate level 1. The problem was that the knowledge was transmitted as contaminating analysis rather than as structured `&`-state facts.

### Child OHA agents were competent leaves

The OHA children generally followed the OHA program well:
- They observed frames programmatically (wrote JavaScript to parse the grid)
- They formed hypotheses about game mechanics
- They implemented BFS pathfinding
- They tracked player position via frame diffs
- They returned structured summaries

Child 0 (level 0) completed the level in 89 actions after initial confusion from the contaminated brief. The OHA program's observation-hypothesis-act cycle worked as designed when the child was left to discover on its own.

### The `try-catch` pattern around `rlm()` worked

Every delegation was wrapped in `try-catch`, preventing child timeouts from crashing the parent. This is a small but important mechanical success.

---

## 7. What Went Poorly

### The root did not behave as a container

The most fundamental failure: the root agent read the game-solver.md program (which says "You do NOT analyze the game frame or take game actions. You compose, delegate, and curate.") and then immediately started analyzing the game frame and taking game actions. The `prohibited: [arc3.step]` constraint was ignored. The composition vocabulary was ignored. The component catalog was ignored.

This suggests that the prose program is not strong enough to override the model's default behavior when presented with an interactive environment. The model sees `arc3.start()` and a game frame and defaults to playing the game directly, regardless of what the program says about composition.

### Misidentification of the game type

The root's first iteration thought this was a click-based ARC puzzle (with action 6 to click on cells). It spent 13 actions on click-cycling colors before discovering the real game had only actions 1-4. This wasted actions were entirely in the root's iteration 0 -- before any delegation. A coordinator or OHA child following its "orient" strategy would have tested each available action systematically rather than assuming a click paradigm.

### Level-solver was never used

The coordinator component -- which handles strategy management, stuck detection, and key_findings extraction -- was never instantiated. This meant:
- No stuck detection when level 1 OHA burned 190 actions going nowhere
- No strategy cycling when "push_block_to_target" failed
- No structured key_findings for the root to curate

### Brief contamination caused cascading failures

The level 1 brief told OHA that "Player is color 0." On level 1's map, color 0 was the background. OHA spent most of its 245 actions confused about player identity. If the brief had been "facts from &-state" as the program requires, this contamination would not have occurred -- the `&GameKnowledge.confirmed_mechanics.movement` entry says "Player moves through corridors using actions 1-4" but does not hardcode "Player is color 0."

### No adaptation after failure

When level 1 failed (245 actions, zero completion), the root did not:
- Analyze why it failed
- Try a different composition style (e.g., coordinated instead of direct)
- Adjust the brief to avoid the color-mapping error
- Increase the iteration budget for the retry

Instead it moved to level 2 with the same approach. The game-solver.md program says "If a level fails twice with the same composition: try a different composition." There was no retry with different composition; there was no retry at all.

### Mechanical loop replaced intelligent composition

In iteration 2, the root defined a `solveLevel()` function and called it in a loop for levels 3-6. This is the antithesis of intelligent composition: the same template, same brief, same component, same topology, for every level regardless of state. The "intelligent container" became a for-loop.

---

## 8. Comparison to Alternatives

### Would fixed wiring have done better?

**Almost certainly yes.** A fixed wiring of game-solver -> level-solver -> OHA would have:
1. Prevented the root from playing the game directly (level-solver would have been the first child, not OHA)
2. Given every level a coordinator for stuck detection and strategy management
3. Ensured key_findings were written after every level
4. Added only 1 extra depth tier (root at 0, level-solver at 1, OHA at 2 -- fits in maxDepth=3)

The main cost would be 1 extra iteration per level for the coordinator overhead. Given that the run spent 245 actions on level 1 with zero completion, coordinator overhead is cheap compared to unmanaged leaf failure.

### Is runtime composition flexibility worth the overhead?

**Not with the current model behavior.** The flexibility to skip the coordinator was always exercised (100% of delegations went directly to OHA), and exercised badly. The composition decision was never grounded in observable state. The root never reconsidered its topology after failure.

In theory, runtime composition is valuable: level 7 with confirmed mechanics should use fewer tiers than level 1 with no knowledge. But in practice, the model did not make this distinction. It used the same topology for everything.

### Should composition decisions be simpler?

**Yes.** Two specific simplifications would help:

1. **Default to coordinated, opt into direct.** The current vocabulary treats direct and coordinated as equal options. But collapse is the default failure mode, meaning direct should be the exception, not the rule. The vocabulary should say: "Use coordinated unless you have an explicit reason not to."

2. **Make prohibited enforcement mechanical, not normative.** The root called `arc3.step()` despite `prohibited: [arc3.step]` in its frontmatter. If the engine actually blocked this call (throwing an error), the root would have been forced to delegate. The current approach relies on the model reading "prohibited" and choosing to comply; the model did not comply.

---

## 9. Structural Recommendations

### Near-term (program changes)

1. **Stronger collapse prevention.** The game-solver program's first code block should be the delegation loop, not game observation. Move `arc3.start()` before the loop, then immediately delegate. The current delegation pattern puts the loop at the end of a long document; the model reads the contract and then ignores it in favor of direct action.

2. **Default topology in the program.** Instead of "select from the composition vocabulary," say "use coordinated composition unless mechanics are confirmed AND action_budget < 15." Make direct the exception.

3. **Brief templates as executable code, not prose.** Instead of "Brief is constructed from `__gameKnowledge` ONLY," provide a function:
   ```javascript
   function buildBrief(level, gk) {
     let brief = `Complete level ${level}.`;
     // ... reads only from gk
     return brief;
   }
   ```
   This makes brief contamination mechanically harder -- the function reads from state, not from the parent's frame analysis.

### Medium-term (engine changes)

4. **Enforce `prohibited` mechanically.** When a program node declares `prohibited: [arc3.step]`, the engine should intercept calls to `arc3.step()` in that agent's sandbox and return an error: "This API is prohibited for your role. Delegate to a child." This would have prevented the collapse entirely.

5. **Composition decision logging.** Before every `rlm()` call, log: which component, which topology, which brief style, what state conditions drove the decision. Make this a required output that the trace captures.

### Long-term (model capability)

6. **Composition reasoning is a learned skill.** The model's failure here is not primarily a program design problem -- it's a capability gap. Models are trained to solve problems directly. "Read a catalog and decide whether to interpose a coordinator" is a meta-cognitive skill that the training signal does not strongly reward. This may improve with better models, or it may require fine-tuning on composition decision scenarios (the "composition unit tests" mentioned in CONTAINER.md as not yet implemented).

---

## 10. Summary Table

| Container Principle | Observed | Rating |
|---|---|---|
| Root reads component catalog | No evidence | FAIL |
| Root selects composition style | "direct" hardcoded, never varied | FAIL |
| Root satisfies requires before delegating | Partial (init state, wrong strategy names) | WEAK |
| Root curates after delegation | Yes for level 0, minimal after | PARTIAL |
| Children act as containers | N/A (level-solver never used) | N/A |
| No collapse | Root called prohibited API 25+ times | FAIL |
| Budget proportionality | Rich budget, used flat topology | FAIL |
| Briefs are interfaces | Every brief contained parent analysis | FAIL |
| Adapt composition after failure | Never changed approach | FAIL |
| Knowledge flows upward | Yes for level 0 mechanics | PASS |

**Overall verdict**: The container paradigm's core thesis -- that the model is the container and makes intelligent runtime composition decisions -- was not supported by this run. The model defaulted to direct action, ignored the composition vocabulary, contaminated briefs, and never used the coordinator component. The one bright spot (knowledge curation between levels) shows the value proposition of composition, but the model did not reliably adopt the container role.

The fix is likely a combination of stronger program design (default to coordinated, executable brief templates), mechanical enforcement (block prohibited APIs), and potentially model-level improvements in meta-cognitive composition reasoning.
