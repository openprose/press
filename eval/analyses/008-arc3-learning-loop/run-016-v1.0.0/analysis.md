# Run 016 Analysis: ARC-3 v1.0.0 Orchestrator + Player Plugins

**Date:** 2026-02-16
**Run file:** `eval/results/arc3_anthropic_claude-opus-4-6_2026-02-16T03-53-05-368Z.json`
**Model:** claude-opus-4-6
**Plugins:** arc3-orchestrator v1.0.0 + arc3-player v1.0.0
**Config:** maxIterations=15, maxDepth=2, concurrency=5
**Score:** 0% (0/7 levels completed)
**Prior best (run-015):** 14.3% (1/7 levels, 18 actions on Level 1)
**Replay:** https://three.arcprize.org/scorecards/007ed62b-3550-4b42-b335-484d69f9882e

---

## 1. Discovery Checklist

Evaluated against `docs/ARC3_CANONICAL_RULES.md`:

| # | Discovery Item | Status | Evidence |
|---|---------------|--------|----------|
| 1 | Character identification | PARTIAL | Found colors 0/1 as "player" but never confirmed which pixels are the character. Misidentified player position throughout (the actual character is a 5x5 block with orange top/blue bottom, not the 2px cluster the model tracked). |
| 2 | Movement mechanics | MISSED | The model never confirmed step size or direction mapping through deliberate experimentation. It believed actions push a block (colors 12/9) rather than move the character. The child agent consumed 15 actions but never reported movement results back. |
| 3 | Wall detection | MISSED | Never tested what blocks movement. The model treated color 4 as "walls" (it is background) and color 3 as "corridors" (partially correct -- walkable paths). No systematic wall-probing was done. |
| 4 | Fuel depletion | PARTIAL | The model observed color 11 (b) pixels depleting by 2 per action and correctly identified this as a resource meter. However, it misunderstood the fuel mechanic -- it believed clearing all color-11 pixels was the goal (spent 20+ actions intentionally depleting fuel). Never understood fuel runs out = lose a life. |
| 5 | Fuel refill | MISSED | The yellow box with dark center (fuel refill icon) was never identified or interacted with. |
| 6 | Lives counter | MISSED | The 3 red squares at bottom-right (color 8 at rows 61-62, cols 56-63) were noticed as "color 8 positions" but never identified as a lives counter. |
| 7 | Pattern toggle | MISSED | White cross/cluster objects were never identified or interacted with. |
| 8 | Color changer | MISSED | Rainbow/multi-colored box was never identified or interacted with. |
| 9 | Goal icon | MISSED | The framed box at rows 8-16 was observed but interpreted as a "template" or "key pattern" -- never understood as the goal icon that must be reached with matching pattern. |
| 10 | Current pattern display (bottom-left HUD) | PARTIAL | The bottom-left box (rows 53-62, cols 1-10) was rendered and examined. The model noticed it contained a pattern of colors 5/9 but never understood it as the Goal Icon GateKeeper showing the current pattern state. |
| 11 | Pattern matching requirement | MISSED | The model never discovered that the GateKeeper's pattern must match the goal icon's pattern before reaching the goal. Instead, it developed a false hypothesis that clearing color-11 pixels opens an "exit corridor." |
| 12 | Strategic sequencing | MISSED | No understanding of the transform-then-navigate strategy. |
| 13 | Fog of war adaptation | N/A | Never reached Level 7. |

**Discovery score: 0 fully discovered, 3 partially discovered, 10 missed.**

---

## 2. Critical Failures

### Root Cause 1: Orchestrator ignored its own delegation pattern

The `arc3-orchestrator.md` plugin specifies a clear protocol:
- Iteration 0: Call `arc3.start()` once, initialize `__knowledge`
- Iteration 1+: Use `__level_task` / `__level_result` sandbox variables, call `rlm()` with `{ app: "arc3-player" }`

**What actually happened:** The orchestrator deviated from the plugin in every single way:

1. **Called `arc3.start()` TWICE in iteration 0.** The model emitted two identical code blocks, both calling `arc3.start()`. This is visible in the trace: `code` array has 2 entries at index 0, and the output contains the grid printed twice. This wasted the first iteration and may have caused state confusion.

2. **Never used `__level_task` or `__level_result`.** The plugin explicitly says "Pass knowledge via `__level_task` / `__level_result` sandbox variables -- never inline data in prompts." The orchestrator instead passed a huge JSON blob as the second argument to `rlm()` and used a custom `systemPrompt` parameter.

3. **Never passed `app: "arc3-player"` in the `rlm()` call.** The plugin specifies `{ app: "arc3-player" }` in the delegation options. The orchestrator instead used `{ systemPrompt: "..." }`, which means the child agent never received the arc3-player plugin body. The child had no access to `findComponents`, `clusterObjects`, `colorFreqs`, `renderRegion`, `diffGrids`, or any of the behavioral priorities.

4. **Used `maxIterations: 25` in the `rlm()` call.** The plugin specifies `maxIterations: 20`. The model used 25. But due to Root Cause 2, this was clamped to 15 anyway.

### Root Cause 2: CLI --max-iterations 15 capped children at 15

The run was invoked with `--max-iterations 15`. In `src/rlm.ts` line 243-244:

```typescript
const effectiveMaxIterations = maxIterationsOverride !== undefined
  ? Math.min(maxIterationsOverride, opts.maxIterations)
  : opts.maxIterations;
```

This means even though the orchestrator requested `maxIterations: 25` (or the plugin says 20), the child was capped at `min(25, 15) = 15`. The child hit this cap and returned the error: "RLM reached max iterations (15) without returning an answer."

**Impact:** The child agent used all 15 iterations but never returned a result. The orchestrator received an empty string as the summary and no `__level_result` to curate.

**Why this matters for the plugin design:** The orchestrator plugin assumes children get 20 iterations. If the CLI caps the root at 15, children can never exceed 15. The orchestrator needs at least 8 outer iterations (1 setup + 7 levels), leaving only 15 - 8 = 7 iterations for the orchestrator itself after delegation. But since the child consumed 15 of the root's iterations... wait, actually: children run in their own iteration counter. The issue is that the child's cap of 15 was insufficient for it to complete Level 1 AND return.

### Root Cause 3: Orchestrator played directly after child failure

After the child timed out, the orchestrator switched to playing the game directly (iterations 4-14). This violated the plugin's rule: "Delegate exactly one level per outer iteration." Instead of re-delegating with adjusted parameters, the orchestrator spent 11 iterations fumbling through the game itself without the perceptual toolkit or behavioral priorities.

**What the orchestrator did in direct play:**
- Iterations 4-5: Analyzed the grid, identified color positions
- Iteration 6: Noticed the pushable block (colors 12/9) had moved. Developed wrong hypothesis that the block can be pushed.
- Iteration 7: Tested movement. Observed the block shifted 5 columns right (actually: the CHARACTER moved, and the block was pushed). Also noticed 2 color-11 pixels disappeared from the "exit."
- Iteration 8: Tested down. Only 2 color-11 pixels changed. Concluded "each move opens part of the exit."
- Iteration 9: Spammed 5 more down moves. Confirmed 2 pixels removed per move.
- Iteration 10: Spammed 20 down moves to clear all remaining color-11 pixels. All 'b' cells gone but level not complete. 42 total actions consumed.
- Iteration 11: Printed full grid. No understanding of what to do next.
- Iteration 12: Tried UP. Entire grid became color 11 (likely a life was lost and the game showed a transition/death screen). Then LEFT reverted it. The model interpreted this as "switching between screens."
- Iteration 13: Pressed UP again to see the "other screen." Actually this was the game resetting after a life loss.
- Hit iteration 15 cap. Game ended with 0 levels completed, 45 total actions.

### Root Cause 4: Misidentification of the character

The model tracked colors 0 and 1 (a 5-pixel cluster at rows 31-33) as "the player." Looking at the canonical rules, the character is a 5x5 block with orange top (color 12/c) and blue bottom (color 9). The cluster the model tracked was actually the player character all along -- but in a different color representation. However, the model also tracked the color-12/9 block at rows 45-49 as a "target" or "pushable object." In reality, this was likely the character itself, and the 0/1 pixels were something else (possibly a small decorative element or part of the maze).

The result: the model thought it was "pushing a block" when it was actually moving the character. This is why the fuel depleted -- the character was moving.

### Root Cause 5: False hypothesis spirals

Once the model formed the hypothesis that "clearing color-11 pixels opens the exit," it committed 25+ actions to testing this hypothesis (spamming down moves). At no point did it step back and ask "what if this hypothesis is wrong?" The behavioral priority #7 from the player plugin -- "Surprises are the most valuable data" -- was never available because the player plugin was never loaded.

---

## 3. Comparison with v0.1-v0.8 (Prior Runs)

### Prior best: run-015 (14.3%, 1/7 levels)

The prior Opus run (`arc3_anthropic_claude-opus-4-6_2026-02-16T00-47-06-376Z.json`) scored 14.3% by completing Level 1 in 18 actions (human baseline: 29). Key differences:

| Dimension | run-015 (v0.8-ish, no plugin) | run-016 (v1.0.0 plugins) |
|-----------|-------------------------------|--------------------------|
| Config | maxIter=30, maxDepth=2 | maxIter=15, maxDepth=2 |
| Plugin | None (ad-hoc system prompt) | arc3-orchestrator + arc3-player |
| Child plugin | `arc3-scout` (nonexistent, so no plugin body) | Should have been `arc3-player` (never loaded) |
| Level 1 | Completed in 18 actions | Never completed |
| Total actions | 57 (18 on L1, 39 on L2) | 45 (all on L1, level never completed) |
| Movement discovery | Yes -- child identified 5px steps, entity color 12 | No -- model never confirmed movement mechanics |
| BFS pathfinding | Yes -- computed BFS path from entity to marker | No -- no pathfinding attempted |
| Fuel tracking | Yes -- tracked fuel depletion, added fuel guard | No -- misunderstood fuel as "exit progress bar" |

### What went worse in v1.0.0

1. **Half the iteration budget.** run-015 had 30 iterations; run-016 had 15. The orchestrator architecture requires at minimum 2 iterations per level (delegate + curate), so 15 iterations can barely cover 7 levels even without overhead. With the child consuming iterations from its own pool but the child cap also being 15, there was no room.

2. **Plugin non-adherence made the architecture HARMFUL.** The orchestrator plugin was designed to add structure, but the model ignored it and produced worse behavior than ad-hoc play. In run-015, the model ad-hoc delegated a "scout" (no plugin, so it improvised) and the scout actually returned useful structured JSON. In run-016, the model passed a custom systemPrompt instead of `app: "arc3-player"`, meaning the child had no perceptual toolkit.

3. **The learning loop never executed.** The core value proposition of v1.0.0 -- accumulate knowledge across levels via `__knowledge` -- never activated because the model never completed Level 1 and never curated any child results.

4. **Direct play was uninformed.** In run-015, the model's direct play benefited from the scout report (entity position, movement mechanics, resource meter). In run-016, the orchestrator's direct play started from scratch without using the (missing) child results.

### Was the learning-loop approach fundamentally flawed?

**No -- it was an execution problem.** The design is sound in principle:
- Delegate per-level to a child with specialized perceptual tools
- Curate knowledge between levels so later levels benefit from earlier discoveries
- Use structured variables (`__level_task`/`__level_result`) for clean data flow

The problems were all in execution:
1. The model did not follow the plugin's delegation pattern
2. The CLI config was wrong (15 iterations instead of 30+)
3. The child never received its plugin body
4. The orchestrator fell back to direct play instead of re-delegating

A properly executed run would need:
- `--max-iterations 30` minimum (ideally 50+ for 7 levels with delegation overhead)
- The model to actually follow the plugin's `rlm()` call signature
- A mechanism to ensure children receive their plugin body

---

## 4. Plugin Adherence Analysis

### arc3-orchestrator.md Adherence

| Plugin Directive | Followed? | What Happened |
|-----------------|-----------|---------------|
| `arc3.start()` called exactly once in iteration 0 | NO | Called twice (duplicate code blocks) |
| Delegate one level per outer iteration | NO | Delegated once, then played directly for 11 iterations |
| `__level_task = { level, knowledge: __knowledge }` | NO | Never set `__level_task`. Passed data as `rlm()` context argument. |
| `rlm()` with `{ app: "arc3-player" }` | NO | Used `{ systemPrompt: "..." }` instead. No `app` key. |
| `rlm()` with `maxIterations: 20` | NO | Used `maxIterations: 25` (then capped to 15 by engine). |
| Curate `__level_result.knowledge` between levels | NO | `__level_result` was never set by child (child timed out). |
| Return scorecard JSON on WIN/GAME_OVER | NO | Hit max iterations without returning. |
| Check `obs.state` at start of each iteration | NO | Only checked once after child failure. |

**Adherence score: 0/8 directives followed.**

### arc3-player.md Adherence

The player plugin was **never loaded** because the orchestrator did not pass `app: "arc3-player"` in the `rlm()` call. Therefore adherence is N/A -- the child operated without any plugin guidance.

If we evaluate the child's behavior against what the player plugin prescribes:

| Plugin Directive | Followed? | What Happened |
|-----------------|-----------|---------------|
| Read `__level_task` for prior knowledge | N/A | `__level_task` was never set |
| Use `findComponents` / `clusterObjects` | NO | Not available (plugin not loaded) |
| Use `colorFreqs` to determine background | NO | Not available |
| Use `diffGrids` after each action | NO | Not available |
| Discover movement first (each action once) | UNKNOWN | Child trace not captured in parent output |
| Track `__actionsThisLevel` | NO | Not available |
| Set `__level_result` on completion | NO | Child timed out |
| Call `return()` with summary | NO | Child timed out |

### Behavioral Priorities Analysis

The 7 behavioral priorities from `arc3-player.md` were never available to the child. When the orchestrator played directly, it also did not follow them:

1. **"Discover movement first"** -- The orchestrator's direct play (iteration 7) did test one RIGHT move and observed diffs. But it only tried 1 direction before jumping to a hypothesis, rather than testing all 4 directions.

2. **"Identify all distinct objects"** -- The orchestrator did catalog colors (iterations 1-2) but never used systematic component analysis. It identified color positions but not object boundaries or types.

3. **"Interact with every object type"** -- Never done. The model never navigated to the pattern toggle, color changer, or fuel refill.

4. **"Watch the whole grid for changes, especially edges and corners"** -- Partially done. The model noticed changes at the bottom bar (color 11 depletion) but misinterpreted them.

5. **"Compare before committing"** -- Never done. Once the model thought "clear the exit," it committed 20+ actions without verification.

6. **"Record evidence, not just conclusions"** -- Never done. `__k` structure was never initialized (plugin not loaded).

7. **"Surprises are the most valuable data"** -- The UP action producing a full-grid change (iteration 12) was extremely surprising -- it was likely a life-loss screen. The model noticed it but did not investigate meaningfully.

---

## 5. Recommended Changes

### 5.1 Make delegation pattern impossible to ignore

**Problem:** The model emitted a custom `systemPrompt` and skipped `app: "arc3-player"`. The plugin's code block is treated as a suggestion, not a constraint.

**Fix:** Add a MANDATORY WARNING at the top of the orchestrator plugin, before any code:

```markdown
### CRITICAL: Delegation Protocol

**YOU MUST delegate using this EXACT rlm() call signature. Do NOT use systemPrompt. Do NOT inline game data in the prompt.**

The child MUST receive the `arc3-player` app plugin via the `app` parameter -- this gives it vision algorithms and behavioral priorities it cannot function without.
```

Also restructure the Iteration 1+ code block to be more copy-paste resistant by removing narrative and making it look like mandatory boilerplate:

```markdown
### Iteration 1+: Delegate one level (COPY THIS EXACTLY)

```javascript
// === MANDATORY DELEGATION BLOCK — DO NOT MODIFY ===
const obs = arc3.observe();
const level = obs.levels_completed + 1;

if (obs.state === "WIN" || obs.state === "GAME_OVER") {
  return(JSON.stringify(await arc3.getScore()));
}

// Set shared variable — child reads this, not inline data
__level_task = { level, knowledge: __knowledge };

const summary = await rlm(
  `Play level ${level}/7 of an interactive grid game. ` +
  `Read __level_task.knowledge for discoveries from prior levels. ` +
  `Learn mechanics through experimentation, then complete the level efficiently. ` +
  `Write updated knowledge and results to __level_result. ` +
  `Minimize actions — you are scored on efficiency.`,
  { app: "arc3-player", model: "intelligent", maxIterations: 20 }
);
// === END MANDATORY BLOCK ===
```
```

### 5.2 Fix the maxIterations CLI override issue (plugin-side mitigation)

**Problem:** `Math.min(childMax, opts.maxIterations)` in `rlm.ts` means CLI `--max-iterations 15` caps children at 15 even when the plugin says 20. This is a harness behavior we cannot change via plugin, but we can mitigate it.

**Plugin-side fix:** Add a warning to the orchestrator plugin about the CLI requirement:

```markdown
### Prerequisites

This plugin requires `--max-iterations 30` minimum (recommended: 50).
If the CLI max-iterations is lower than 20, children will be capped below
their design budget and will time out.
```

Also add this to the plugin's Rules section:

```markdown
6. This plugin requires `--max-iterations` >= 30 at the CLI level.
   Children request 20 iterations; the engine caps children at
   min(requested, CLI max). If CLI max < 20, children cannot function.
```

### 5.3 Reduce wasted iterations on setup/analysis

**Problem:** The orchestrator spent 3 iterations (0-2) on setup before delegating. Iteration 0 called `arc3.start()` twice. Iterations 1-2 analyzed the grid in detail -- work that the child agent should be doing.

**Fix:** Make iteration 0 minimal. Remove any grid analysis from the orchestrator -- that is the child's job. The orchestrator should only initialize and delegate:

```markdown
### Iteration 0: Start the game (3 lines only)

```javascript
const init = await arc3.start();
__knowledge = { objectTypes: {}, mechanics: {}, rules: [], openQuestions: [] };
console.log("Game started. State:", init.state, "Levels:", init.levels_completed);
// DO NOT analyze the grid here. That is the child's job.
// Proceed immediately to Iteration 1 (delegation).
```
```

### 5.4 Improve mechanic discovery (test each action once and diff)

**Problem:** The child agent (when it eventually gets the player plugin) should test each action exactly once and diff the full grid. Instead of reading about this in narrative form, the plugin should provide a concrete "discovery protocol" code block.

**Fix:** Add a mandatory discovery block to the player plugin's Iteration 0:

```markdown
### Iteration 1: Discovery Protocol (MANDATORY — run before anything else)

```javascript
// Test each action exactly once, diff the entire grid, record results.
const discoveries = [];
const baseline = arc3.observe().frame[0];

for (const action of [1, 2, 3, 4]) {
  const before = arc3.observe().frame[0];
  const result = await arc3.step(action);
  const after = result.frame[0];
  const changes = diffGrids(before, after);

  // Categorize changes by region
  const mazeChanges = changes.filter(c => c.r < 52);
  const hudChanges = changes.filter(c => c.r >= 52);

  discoveries.push({
    action,
    totalChanges: changes.length,
    mazeChanges: mazeChanges.length,
    hudChanges: hudChanges.length,
    mazeExamples: mazeChanges.slice(0, 10),
    hudExamples: hudChanges.slice(0, 5),
    state: result.state,
  });

  console.log(`Action ${action}: ${mazeChanges.length} maze changes, ${hudChanges.length} HUD changes`);

  // If the entire grid changed (>1000 diffs), something dramatic happened (death? level transition?)
  if (changes.length > 1000) {
    console.log("WARNING: Massive grid change — possible death or screen transition");
  }
}

__grid = arc3.observe().frame[0];
__actionsThisLevel = 4; // We used 4 discovery actions

// Analyze discovery results
console.log("Discovery complete. Analyzing movement pattern...");

// The entity that moved in the maze region is the player
// Look for consistent displacement patterns across directions
```
```

### 5.5 Make the return protocol clearer and add a deadline guard

**Problem:** The child agent hit max iterations without returning. The player plugin shows the "On Completion" block but does not emphasize that the agent MUST return before running out of iterations.

**Fix:** Add an iteration guard to the player plugin that fires unconditionally:

```markdown
### Iteration Guard (PREPEND TO EVERY ITERATION)

```javascript
// === DEADLINE GUARD ===
// You MUST return before hitting the iteration limit.
// Reserve the last 2 iterations for return.
const __currentIter = (typeof __iterCount === 'undefined') ? 0 : __iterCount;
__iterCount = __currentIter + 1;

if (__iterCount >= 18) { // Leave 2 iterations of margin from max 20
  __level_result = {
    knowledge: __k,
    actions: __actionsThisLevel,
    completed: arc3.observe().levels_completed > __startLevel,
  };
  return(`Level ${__startLevel + 1}: ${__level_result.completed ? 'done' : 'incomplete'}, ` +
    `${__actionsThisLevel} actions, ${Object.keys(__k.mechanics).length} mechanics found.`);
}
// === END DEADLINE GUARD ===
```
```

Also add to the Rules section:

```markdown
### Rules

1. You MUST return a result before hitting the iteration limit. If unsure whether you can complete the level, return what you have.
2. Reserve the last 2 iterations as a safety margin — always return by iteration 18 (of 20).
3. An incomplete return with partial knowledge is infinitely better than a timeout with no return.
```

### 5.6 Add a fallback re-delegation pattern to the orchestrator

**Problem:** When the child failed (timed out), the orchestrator played directly. It should re-delegate or at minimum use the player's perceptual toolkit.

**Fix:** Add to the orchestrator plugin:

```markdown
### Handling Child Failure

If `summary` is empty or the child timed out:

```javascript
// Child failed — DO NOT play directly. Re-delegate with reduced scope.
if (!summary || summary === "") {
  console.log("Child timed out. Re-delegating with exploration-only scope...");
  const retry = await rlm(
    `Explore level ${level}/7 — discover 3 mechanics and return. ` +
    `Do NOT try to complete the level. Focus on: movement, objects, HUD elements. ` +
    `Write findings to __level_result and return immediately.`,
    { app: "arc3-player", model: "intelligent", maxIterations: 10 }
  );
  console.log(`Retry result: ${retry}`);
}
```

NEVER play the game directly from the orchestrator. The orchestrator has no
perceptual toolkit. Direct play will always be worse than delegating.
```

### Summary of Recommended Changes

| Change | File | Impact |
|--------|------|--------|
| Add CRITICAL warning about delegation protocol | `arc3-orchestrator.md` | Prevents model from ignoring the `app: "arc3-player"` parameter |
| Add CLI prerequisites (--max-iterations >= 30) | `arc3-orchestrator.md` | Prevents iteration budget starvation |
| Minimize iteration 0 (no grid analysis) | `arc3-orchestrator.md` | Saves 2+ iterations for actual gameplay |
| Add mandatory discovery protocol (test each action once) | `arc3-player.md` | Ensures systematic mechanic discovery instead of ad-hoc exploration |
| Add deadline guard (return by iteration 18) | `arc3-player.md` | Prevents child timeouts |
| Add fallback re-delegation pattern | `arc3-orchestrator.md` | Prevents orchestrator from playing directly |
| Add Rules section emphasizing return requirement | `arc3-player.md` | Makes return obligation explicit |

---

## Appendix A: Iteration-by-Iteration Trace Summary

| Iter | Agent | Actions Taken | What Happened |
|------|-------|:------------:|---------------|
| 0 | Orchestrator | 0 | Called `arc3.start()` TWICE (duplicate code blocks). Printed sampled grid. |
| 1 | Orchestrator | 0 | Analyzed grid colors, found positions of colors 0, 1, 8, 9, 11, 12. |
| 2 | Orchestrator | 0 | Printed full 64x64 grid at 1:1 resolution. |
| 3 | Orchestrator | 0 (child: 15) | Delegated to child with custom systemPrompt (not arc3-player plugin). Child hit 15-iteration cap, returned empty string. |
| 4 | Orchestrator | 0 | Checked state: NOT_FINISHED, 0 levels, 15 actions used by child. Found player still at same position (colors 0/1). |
| 5 | Orchestrator | 0 | Printed full grid. Noticed changes: color-0 outlines appeared on boxes, pushable block (12/9) moved down, exit corridor (color 3) appeared. |
| 6 | Orchestrator | 0 | Examined pushable block, bottom-left template, top template. Compared patterns. |
| 7 | Orchestrator | 1 | Tested RIGHT: block shifted 5 cols right (19-23 to 24-28), 2 color-11 pixels cleared at exit. |
| 8 | Orchestrator | 1 | Tested DOWN: block didn't move visibly, 2 more color-11 pixels cleared. |
| 9 | Orchestrator | 0 | Examined block position, exit area, full lower grid. |
| 10 | Orchestrator | 5 | Spammed 5 DOWN moves. Confirmed 2 color-11 pixels removed per move. |
| 11 | Orchestrator | 20 | Spammed 20 DOWN moves to clear all remaining color-11 pixels. All cleared but level NOT complete. Total: 42 actions. |
| 12 | Orchestrator | 0 | Printed full grid. Noticed no color-11 remaining but still NOT_FINISHED. |
| 13 | Orchestrator | 2 | Tested UP: entire grid became color 11 (4096 diffs -- likely death/transition screen). Then LEFT: reverted. Model thought it was "switching screens." |
| 14 | Orchestrator | 1 | Pressed UP again. Got original grid back but with block at new position. |
| -- | -- | -- | Hit max iterations (15). Final state: NOT_FINISHED, 0 levels, 45 actions. |

**Total actions:** 45 (15 by child + 30 by orchestrator direct play)
**Total iterations:** 15 (orchestrator) + 15 (child) = 30 LLM calls
**Estimated cost:** $0.45

## Appendix B: Comparison with run-015 Architecture

run-015 did NOT use the v1.0.0 plugins. It used an ad-hoc approach:

1. Iteration 0: Started game, delegated to `arc3-scout` (no plugin -- model improvised)
2. The scout returned a structured JSON with: entity position, movement per action (5px), fuel depletion rate, corridor map, marker positions, hypotheses
3. Iteration 1: Built BFS pathfinder, computed path from entity to marker
4. Iteration 2: Executed BFS path -- moved to marker. Level 1 completed in 18 actions.
5. Iterations 3-15: Attempted Level 2 (used 39 actions, failed to complete)

The critical difference: run-015's child returned useful data because it was not constrained by a plugin it could not load. The model improvised effectively. run-016's child could not improvise because it was given a custom systemPrompt that told it what to do, but without the perceptual tools to do it.

**Lesson:** A plugin that is not loaded is worse than no plugin at all, because the orchestrator writes delegation code assuming the child has capabilities it does not have.
