# Run-004 Synthesis: Cross-Analysis Recommendations

**Date:** 2026-02-18
**Run:** `arc3_anthropic_claude-opus-4-6_2026-02-18T07-20-42-256Z.json`
**Score:** 3.42% (1/7 levels, 250 actions)
**Previous:** Run-003 scored 14.3% (1/7 levels, 127 actions, level 0 in 16 actions at 100% efficiency)
**Verdict:** Regression. Same number of levels completed, but 4.2x worse action efficiency and half the score.

---

## 1. Summary of Findings

- **The delegation brief poisoned the OHA.** The LevelSolver told OHA to "Click (action 6) on output cells" and "Use action 5 (Interact) to submit" -- actions that don't exist in the game. This single upstream error accounts for most of the regression from run-003, where the LevelSolver gave a clean "strategy: orient" brief that produced 16-action level completion. (Evaluation, Canonical Comparison, Distillation)

- **Knowledge never flows upward.** `__gameKnowledge.confirmed_mechanics` remained `{}` through the entire run despite extensive OHA-level discoveries about movement, maze structure, and fuel mechanics. The GameSolver's curation step (the core value proposition of the 3-tier architecture) simply never executed. Level 2 started with zero knowledge. (Canonical Comparison, Evaluation)

- **`prohibited: [arc3.step]` is routinely violated.** The LevelSolver called `arc3.step()` directly in both delegations. The prohibition is stated three times in the system prompt. The model ignores it when it judges direct action to be simpler. No amount of prompt repetition will fix this -- only engine enforcement. (Prompt Audit, Evaluation)

- **The agent never understands the win condition.** Across 4 delegated agents and 250+ actions, no agent discovered pattern toggles, color changers, fuel refills, the pattern-matching requirement, or the strategic sequence (transform then navigate). Level 0 was completed accidentally (the pattern likely matched by default). Without understanding the win condition, levels 1+ are impossible. (Canonical Comparison, Observation Quality)

- **Observation code is ad-hoc and never reused.** 110 code blocks were executed. Not a single helper function was defined and called across iterations. The same grid analysis was re-written from scratch 8+ times. Output truncation at 500 chars compounded this -- agents couldn't see their own analysis results. (Observation Quality)

---

## 2. Cross-Analysis Themes

### Where analyses agree

All five analyses converge on these points:

1. **The delegation brief is the regression's proximate cause.** The Evaluation, Canonical Comparison, and Distillation all identify the LevelSolver's "ARC puzzle" framing and wrong-action instructions as the primary driver of the efficiency regression. Run-003's clean brief ("strategy: orient") produced 100% efficiency; run-004's contaminated brief produced 24%.

2. **Knowledge curation is the architecture's bottleneck.** The Distillation, Canonical Comparison, and Evaluation all document that `__gameKnowledge.confirmed_mechanics = {}` at end of run. The 3-tier architecture's entire value depends on knowledge flowing upward (OHA -> LevelSolver -> GameSolver) and laterally (level N -> level N+1). This pipeline is broken.

3. **Budget enforcement is purely normative and always fails.** The Prompt Audit documents that `prohibited: [arc3.step]` is stated 3 times, and the Evaluation documents it was violated anyway. The Observation Quality analysis shows OHAs exceed their action budgets by 3-6x. All analyses agree: prompt-based enforcement does not work.

4. **The core game mechanics (pattern toggle, color changer, win condition) are never discovered.** The Canonical Comparison's checklist shows 0/12 items fully correct; the Evaluation's discovery table shows the same gaps across runs 003 and 004. The Observation Quality analysis explains why: no template matching, no pattern comparison functions, no systematic object interaction.

### Where analyses diverge

1. **Role of the uniform system prompt.** The Evaluation says the XML system prompt "MAY have contributed to longer reasoning blocks" but was not the primary cause. The Prompt Audit identifies specific token waste (delegation docs sent to leaf OHA, 200 wasted tokens/call) but rates the structural impact as low. The Distillation doesn't address the prompt format at all. My conclusion: **the uniform prompt format is not a regression factor.** The prompt *content* (delegation briefs) is the problem, not the prompt *structure*.

2. **Severity of the game restart.** The Distillation frames the restart as a partial success ("first run where the agent recovered from GAME_OVER"). The Evaluation frames it more negatively ("masks a deeper problem: OHA #0 should not have burned 144 actions in the first place"). Both are right. The restart capability is valuable, but it's a band-aid over the real issue: OHAs navigate blindly.

3. **Whether the 3-tier architecture adds value.** The Canonical Comparison and Distillation are implicitly skeptical -- the architecture adds complexity (3 tiers, 4 delegation calls) but the knowledge pipeline is broken, so it's overhead without benefit. The Evaluation is more optimistic, noting "the 3-tier architecture works structurally." My conclusion: **the architecture IS the right design, but it's currently incurring costs (token overhead, delegation brief errors, knowledge pipeline failure) without delivering its core benefit (cumulative knowledge).** Fix the pipeline, and the architecture pays off.

---

## 3. Prioritized Recommendations

### P0: Engine-Level Enforcement of `prohibited` APIs

**What:** In the RLM engine (`src/rlm.ts` or `src/plugins.ts`), before executing a child agent, parse the program node's `prohibited` field and replace those functions in the sandbox with throwing stubs. For example, if `prohibited: [arc3.step]`, wrap `sandbox.arc3.step` with `() => { throw new Error("arc3.step is prohibited at this delegation depth. Delegate to OHA.") }`.

**Files:** `src/rlm.ts` or `src/plugins.ts` (ENGINE change)

**Expected impact:** Eliminates the single most damaging behavioral failure. In run-004, the LevelSolver called `arc3.step()` 4 times directly; in run-003, LevelSolver #1 called it 20 times directly consuming 110 actions. Engine enforcement converts this from a prompt compliance problem (which the model will always sometimes violate) to a hard constraint.

**Supporting analyses:** Prompt Audit (Section 5.1, "the prompt already says everything it can say"), Evaluation (Section 6, P0), Distillation ("H4 repeated H1 mistake"), Run-003 Distill ("LevelSolver #1 called step 20 times")

### P0: Fix the Delegation Brief Content

**What:** The LevelSolver's delegation prompt to OHA must describe the *goal* and *known mechanics*, not specific action instructions. The prompt should NEVER mention "Click (action 6)" or "Interact (action 5)" -- these don't exist. Replace with: strategy name, known mechanics (from `__gameKnowledge` or `__levelState`), and the goal ("navigate the block to the target position" or "discover how to complete this level").

**Files:** `plugins/programs/arc3/level-solver.md` (PROGRAM change) -- add an explicit delegation brief template.

Proposed addition to the Delegation Loop section:

```
delegation brief format:
  "Execute strategy: {strategy}. "
  + confirmed mechanics (from &GameKnowledge or &LevelState.world)
  + "Open questions: {open_questions}"
  + if retry: "Previous attempt failed because: {failure_reason}. Try: {alternative}"

  NEVER include action-specific instructions (e.g. "press action 6").
  The OHA discovers available actions during orient.
```

**Expected impact:** This is the proximate cause of the run-003 -> run-004 regression. Run-003's clean brief produced 16-action level completion; run-004's contaminated brief produced 121-action completion. Fixing this should restore run-003 efficiency.

**Supporting analyses:** Evaluation (Section 5.2, 6 P0), Canonical Comparison (Section "What the Agent Got Wrong" #1), Distillation (Phase 2 root cause)

### P0: Fix Knowledge Curation Pipeline

**What:** The GameSolver's knowledge curation step must actually execute. Currently `__gameKnowledge.confirmed_mechanics` remains `{}` through the entire run. Two changes:

1. In `game-solver.md`, make curation a separate explicit step with a code template (not just prose instructions). Show the agent exactly what to extract and where to write it.

2. In `level-solver.md`, require the LevelSolver to write a structured summary to `__levelState.key_findings` before returning, so the GameSolver has clean data to curate from.

**Files:** `plugins/programs/arc3/game-solver.md`, `plugins/programs/arc3/level-solver.md` (PROGRAM change)

Proposed addition to game-solver.md Knowledge Curation:

```javascript
// Curation template -- execute this between delegations:
const ls = __levelState;
const gk = __gameKnowledge;

// Promote confirmed mechanics
if (ls.world?.player) {
  gk.confirmed_mechanics.player = {
    description: `5x5 block at ${JSON.stringify(ls.world.player.position)}, colors ${ls.world.player.colors}`,
    confidence: 0.9, evidence: ["observed movement"], first_seen: ls.level
  };
}
// ... similar for movement, maze, fuel, objects

// Record level outcome
gk.level_outcomes[ls.level] = {
  completed: Boolean(/* check arc3.observe().levels_completed */),
  actions_used: ls.actions_taken,
  key_insight: ls.key_findings?.key_insight || "unknown",
  strategies_tried: ls.strategies_tried || []
};
```

**Expected impact:** Enables the 3-tier architecture's core value: knowledge accumulation. Level 1 should start with full knowledge of movement mechanics, player identity, fuel system, and maze structure -- instead of re-discovering everything from scratch. This is the difference between "architecture works structurally" and "architecture delivers value."

**Supporting analyses:** Canonical Comparison (Section "Knowledge not propagated upward"), Evaluation (Section 3.5), Distillation ("Knowledge transfer failure" root cause)

### P1: Suppress Delegation Docs for Leaf Nodes

**What:** In `buildSystemPrompt()`, detect leaf nodes (either via `delegates: []` in program frontmatter, or by checking if depth == maxDepth - 1) and suppress: model table, rlm() API docs, "can delegate to depth N" context, and the "await rlm()" rule.

**Files:** `src/plugins.ts` or system prompt builder (ENGINE change)

**Expected impact:** Saves ~200 tokens per OHA call (16 calls in this run = 3,200 tokens). More importantly, eliminates the contradiction between "you can delegate to depth 3" and "you are a leaf node" that appears in OHA's system prompt. Three unawaited rlm() calls in this run suggest OHA may have been confused by this contradiction.

**Supporting analyses:** Prompt Audit (Sections 4.2-4.5, contradiction inventory)

### P1: Add Game State Check Before Delegation

**What:** The GameSolver must check `arc3.observe().state` and `arc3.observe().levels_completed` before delegating to a new LevelSolver. If the game is GAME_OVER, don't delegate.

**Files:** `plugins/programs/arc3/game-solver.md` (PROGRAM change) -- add to Delegation Pattern:

```javascript
// Before delegating:
const obs = arc3.observe();
if (obs.state === "GAME_OVER") {
  // Game is over, return score
  return arc3.getScore();
}
```

**Expected impact:** Prevents the LevelSolver #1 waste pattern: 7 iterations, 13 code blocks, significant API cost for zero gameplay on a dead game. In run-004, this wasted ~$0.10 and occupied time that could not help.

**Supporting analyses:** Evaluation (Section 3.4, P1), Distillation (Phase 4)

### P1: OHA Must Check Level Transitions

**What:** OHA should check `arc3.observe().levels_completed` after every multi-step action sequence. If `levels_completed` increased, the level has changed -- stop, record the transition, and return to the LevelSolver so it can reinitialize for the new level.

**Files:** `plugins/programs/arc3/oha.md` (PROGRAM change) -- add to the Act section:

```
After every multi-step action burst, check:
  const obs = arc3.observe();
  if (obs.levels_completed > __levelState.level) {
    // Level transition detected! Stop immediately.
    // Update &LevelState and return "LEVEL_COMPLETED"
  }
```

**Expected impact:** In run-004, OHA #1 completed level 0 at action ~121 but continued playing on level 1 for 127 more aimless actions because it never noticed the transition. Detecting transitions would have saved those 127 actions and allowed the LevelSolver to properly initialize for level 1.

**Supporting analyses:** Distillation (Root cause: "Level transition blindness"), Evaluation (Section 3.3)

### P2: Add Pathfinding Code Template to OHA

**What:** Include a concrete, copy-pasteable BFS implementation in `oha.md` that operates on the cell grid (5-pixel steps), not individual pixels. The current `capability: shortestPath` spec is too abstract -- the model never implements it.

**Files:** `plugins/programs/arc3/oha.md` (PROGRAM change) -- replace the abstract `shortestPath` capability with a concrete implementation:

```javascript
// BFS on cell grid
function bfs(cells, startR, startC, goalR, goalC) {
  const q = [[startR, startC, []]];
  const visited = new Set([`${startR}_${startC}`]);
  const dirs = [[-1,0,1],[1,0,2],[0,-1,3],[0,1,4]]; // [dr,dc,action]
  while (q.length) {
    const [r, c, path] = q.shift();
    if (r === goalR && c === goalC) return path;
    for (const [dr, dc, act] of dirs) {
      const nr = r+dr, nc = c+dc, key = `${nr}_${nc}`;
      if (!visited.has(key) && cells[key] === "floor") {
        visited.add(key);
        q.push([nr, nc, [...path, act]]);
      }
    }
  }
  return null;
}
```

**Expected impact:** The current "capability: shortestPath" specification has been ignored in every run. A concrete template is more likely to be adopted. If used, level 0 navigation drops from 121 actions to ~29 (the baseline). This is a 4x improvement on the single level we can currently complete.

**Supporting analyses:** Observation Quality (Section 4.1), Evaluation (Section 6 P2), Distillation ("Fuel-oblivious navigation")

### P2: Split globalDocs by Tier

**What:** OHA does not need the GameKnowledge schema, composition diagram, or `arc3.start()`/`arc3.getScore()` API docs. Split the globalDocs content so each tier receives only what it needs.

**Files:** `src/plugins.ts` or system prompt builder (ENGINE change), `eval/arc3-global-docs.md` (BENCHMARK change)

**Expected impact:** ~6,400 tokens saved across a typical run. Also removes the confusing contradiction where OHA sees `arc3.start()` documentation but is told it can't call it.

**Supporting analyses:** Prompt Audit (Sections 4.1, 4.8, 5.5)

### P2: Fuel-Aware Navigation

**What:** Add a resource monitoring requirement to the OHA Act phase. After every 10 actions, check fuel level. If fuel < 20, switch to conservative mode. If fuel < 5, stop and return.

**Files:** `plugins/programs/arc3/oha.md` (PROGRAM change) -- add to Invariants:

```
- FUEL MONITORING: After every 10 game actions, count the fuel pixels
  (color 11 at rows 61-62, cols 12-60). If fuel < 20 pixels, stop
  exploration and focus on the most promising path. If fuel < 5, return
  immediately with current state -- the level attempt is over.
```

**Expected impact:** Prevents the resource depletion catastrophe pattern seen in both OHA #0 (144 actions, all fuel burned) and OHA #1 (248 actions, 2 fuel remaining). Conservative fuel management preserves the option to attempt later levels.

**Supporting analyses:** Distillation ("Fuel-oblivious navigation"), Observation Quality (Section 4.3), Evaluation (Section 6 P3)

### P3: Remove Redundant "What You Cannot Do" Sections

**What:** The `prohibited` frontmatter and `Shape` section already declare boundaries. The "What You Cannot Do" prose section wastes tokens and creates false confidence that the model will comply.

**Files:** `plugins/programs/arc3/game-solver.md`, `plugins/programs/arc3/level-solver.md`, `plugins/programs/arc3/oha.md` (PROGRAM change)

**Expected impact:** ~140 tokens saved per level-solver + OHA call. Minor token savings, but cleaner program structure.

**Supporting analyses:** Prompt Audit (Section 4.7)

### P3: Add maxIterations Cap Documentation

**What:** Tell agents that `maxIterations` for children is capped at their own budget. Currently agents request `maxIterations: 20` for children but the effective cap is 10.

**Files:** `src/plugins.ts` or system prompt builder (ENGINE change) -- add to `<rlm-environment>`:
`"Note: child maxIterations is capped at your own budget (currently {N})."`

**Expected impact:** Prevents the agent from planning 20-iteration strategies when only 10 are available. Minor impact.

**Supporting analyses:** Prompt Audit (Section 5.3)

---

## 4. Regression Analysis: Why 14.3% -> 3.4%

### The numbers

| Metric | Run-003 | Run-004 | Delta |
|--------|---------|---------|-------|
| Score | 14.3% | 3.42% | -10.9 pp |
| Level 0 actions | 16 | 121 | +105 (7.6x worse) |
| Level 0 efficiency | 100% | 24% | -76 pp |
| Total actions | 127 | 250 | +123 |
| Wasted first attempt | 0 | 144 (full GAME_OVER) | New failure mode |
| Knowledge curated | Yes (movement, collection, completion) | No (`{}`) | Regression |

### The causal chain

1. **Root cause: The LevelSolver composed a bad delegation brief.** In run-003, the LevelSolver delegated to OHA with `strategy: "orient"` and no action-specific instructions. OHA executed a clean 16-action sequence. In run-004, the LevelSolver told OHA to "Click (action 6) on output cells to paint them" and "Use action 5 (Interact) to submit." This framed ARC-3 as an ARC-style painting puzzle, causing OHA to waste iterations on irrelevant analysis.

2. **Contributing factor: OHA #0 burned 144 actions before GAME_OVER.** The bad brief caused OHA #0 to spend 3 iterations analyzing grid structure before taking any action, then navigate blindly for 144 actions without understanding the goal. This consumed the entire first game session.

3. **Contributing factor: Knowledge didn't transfer after restart.** After the LevelSolver restarted the game, OHA #1 had to re-discover block movement mechanics from scratch (wasting 31 actions re-learning what D3 had already discovered at action 12). The LevelSolver's brief to OHA #1 even primed it to think color 1 was the player, repeating the H1 error.

4. **Contributing factor: Level transition blindness.** OHA #1 completed level 0 at action ~121 but didn't notice. It continued playing on the now-restructured level 1 maze for 127 more actions without any systematic strategy, consuming all remaining fuel.

### Why this specific regression class occurred

The delegation brief problem is stochastic -- the LevelSolver composes briefs based on its own analysis, and that analysis varies between runs. In run-003, the LevelSolver happened to produce a clean brief. In run-004, it produced a contaminated one. The program doesn't constrain the brief format tightly enough to prevent this. The fix is structural: add a brief template to `level-solver.md` that prohibits action-specific instructions and requires only strategy name + known mechanics + open questions.

### How to prevent this regression class

1. **Brief template in level-solver.md** (P0 recommendation above). Constrain the delegation brief to a specific format that cannot include wrong action instructions.
2. **Engine-level prohibited API enforcement** (P0 recommendation above). Even if the brief is bad, the LevelSolver can't take direct actions -- it must delegate.
3. **Knowledge curation** (P0 recommendation above). Even if OHA #0 fails, its discoveries are captured and passed to OHA #1, preventing re-learning costs.

These three changes together address the stochastic nature of the failure: the brief template prevents bad briefs, enforcement prevents the LevelSolver from working around delegation, and curation prevents knowledge loss between attempts.

---

## 5. What We Should NOT Change

### 1. The 3-tier architecture

The GameSolver -> LevelSolver -> OHA structure is correct. When it works (run-003 level 0), it produces optimal results (100% efficiency, 16 actions). The architecture is not the problem -- the implementation of the knowledge pipeline within the architecture is.

### 2. The uniform system prompt (buildSystemPrompt with XML sections)

The XML-based system prompt did not cause the regression. App names resolved correctly, delegation structure was respected, and agent roles were correctly understood. The Prompt Audit found some token waste opportunities but no behavioral regressions caused by the prompt format.

### 3. The OHA observe-hypothesize-act cycle structure

The OHA program's structure is sound. When the OHA received a clean brief (run-003), it executed a tight orient -> navigate loop. The problem is upstream (bad briefs, missing knowledge) not in the OHA cycle design itself.

### 4. The shared state schema (GameKnowledge, LevelState)

The schema design is correct. The problem is that agents don't populate it (curation never executes, `confirmed_mechanics = {}`). The schema itself needs no changes.

### 5. The game restart capability

Run-004 demonstrated that `arc3.start()` can recover from GAME_OVER. This is valuable. However, restarts should be the GameSolver's responsibility (not the LevelSolver's), and they should preserve learned knowledge.

### 6. The capability specifications in oha.md

The `shortestPath`, `diffFrames`, `findComponents`, and `compareRegions` specs are well-designed. The problem is adoption: agents don't implement them. The fix is to add concrete code templates alongside the specs, not to remove them.

### 7. The diff-based movement tracking

The Observation Quality analysis rated diff functions at 4/5 quality -- the best observation capability. The `diffFrames` approach correctly identified block movement in both OHA agents. Keep this as the primary movement detection method.

---

## 6. Next Experiment Design (Run-005)

### Hypothesis

The run-003 -> run-004 regression is caused by delegation brief contamination and knowledge pipeline failure, not by the uniform system prompt or the 3-tier architecture. Fixing the brief template and knowledge curation will restore run-003 level-0 efficiency (16 actions) and potentially enable level 1 completion.

### Changes for run-005

**Change 1: Delegation brief template in level-solver.md (PROGRAM)**

Add to the Delegation Loop section:

```
delegation brief format:
  Line 1: "Strategy: {current_strategy}."
  Line 2: Confirmed mechanics from &GameKnowledge or &LevelState.world
           (player size, movement step, wall color, maze structure)
  Line 3: "Open questions: {list}"
  Line 4: If retry: "Previous attempt failed: {reason}. Try: {alternative}"

  NEVER include specific action numbers (e.g., "press action 6").
  NEVER describe the game genre (e.g., "ARC puzzle", "Sokoban").
  The OHA discovers the game's nature through observation.
```

**Change 2: Knowledge curation code template in game-solver.md (PROGRAM)**

Add a concrete JavaScript curation template (not just prose instructions) that extracts confirmed mechanics from `__levelState` and writes them to `__gameKnowledge`. See the P0 recommendation above for the template.

**Change 3: Level transition detection in oha.md (PROGRAM)**

Add to the Act section:
```
After every multi-step action burst:
  1. Check arc3.observe().levels_completed
  2. If levels_completed > __levelState.level: STOP. Return "LEVEL_COMPLETED".
  3. Check fuel pixels. If < 10: STOP. Return "LOW_FUEL".
```

**Change 4: Engine enforcement of prohibited APIs (ENGINE)**

If feasible within the run-005 timeline, implement sandbox interception for `prohibited` functions. If not feasible, defer to run-006 but note this as a known risk.

### What NOT to change for run-005

- Do not change the system prompt format (buildSystemPrompt structure)
- Do not change maxDepth (keep at 3)
- Do not change the OHA capability specs
- Do not add game-specific hints (we're testing program architecture, not game knowledge)
- Do not add BFS code template yet (save for run-006 to isolate the effect of brief + curation fixes)

### Success criteria

| Metric | Target | Reasoning |
|--------|--------|-----------|
| Level 0 actions | <= 30 | Restore run-003 efficiency (~16 actions) |
| Level 0 score | >= 90% | Baseline is 29 actions |
| Level 1 attempted | Yes | Must reach level 1 with actions remaining |
| `confirmed_mechanics` populated | Yes | Curation pipeline must activate |
| LevelSolver direct step calls | 0 | Brief template should prevent this; engine enforcement if available |
| Total actions | <= 150 | Budget discipline |
| Levels completed | >= 1 | Match run-003/004 minimum |

### Stretch target

If the brief + curation fixes work, level 1 completion becomes plausible. Level 1 baseline is 41 actions. With confirmed mechanics from level 0, the OHA should orient faster. Target: level 1 in <= 80 actions. Combined target: 2/7 levels completed, score >= 25%.

### Risk assessment

The primary risk is that the LevelSolver still ignores the brief template and composes free-form briefs with wrong action instructions. This is why engine enforcement of `prohibited` is listed as a parallel change -- if the brief template alone doesn't hold, the enforcement ensures the LevelSolver can't take actions directly and must delegate even with a bad brief.

The secondary risk is that level 1 requires pattern toggle understanding, which no agent has ever discovered. This is a capability gap that program changes alone may not fix. If run-005 produces good level 0 efficiency but fails on level 1 for the same reason as previous runs (no pattern toggle discovery), then run-006 should focus on adding game-specific object interaction hints or improving OHA exploration strategy to ensure it interacts with every distinct object type it encounters.
