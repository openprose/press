# Run 016 Synthesis: ARC-3 Program v0.6.0

**Date:** 2026-02-18
**Run:** `arc3-ls20-cb3b57cc`
**Score:** 4.65% (0.047 normalized)
**Model:** claude-opus-4-6
**Program version:** v0.6.0 (composition guide, component catalog, composition vocabulary)
**Prior run (013, v0.3.0):** 3.42% (run-004) / 14.3% (run-003)
**Verdict:** Marginal improvement over v0.3.0 run-004, but the same structural failures persist. The composition vocabulary and component catalog had zero observable impact on agent behavior.

---

## 1. Score Card

| Metric | Value | Target / Baseline | Assessment |
|--------|-------|-------------------|------------|
| Overall score | 4.65 / 100 | > 25% | FAIL |
| Levels completed | 1 of 7 | >= 2 | FAIL |
| Total game actions | 334 | <= 150 | FAIL (2.2x over) |
| Level 0 actions | 89 | 29 (human baseline) | 32.6% efficiency |
| Level 1 actions | 245 | 41 (human baseline) | 0% (not completed) |
| Root shape violations | 25+ `arc3.step` calls | 0 | FAIL |
| Level-solver usage | 0 invocations | >= 1 | FAIL |
| Hypothesis lifecycle usage | 0 hypotheses tracked | >= 1 per level | FAIL |
| Knowledge curation pipeline | Bypassed (manual only) | Fully operational | FAIL |
| `confirmed_mechanics` populated | Yes (manually, late) | Yes (via pipeline) | PARTIAL |
| Wall time | 3458s (~58 min) | -- | -- |

---

## 2. Cross-Cutting Findings

### Finding 1: Composition Collapse at the Root

**Severity:** Critical
**Identified by:** Trajectory, Programs, Container, State, Coding

The root agent (game-solver) absorbed the work of both level-solver and partially OHA. It called `arc3.step()` at least 25 times despite `prohibited: [arc3.step]` in its frontmatter. It performed extensive pixel-level frame analysis despite the program stating "You do NOT analyze the game frame."

This is the single most damaging failure. It cascaded into every other problem: the root's frame analysis contaminated briefs, the root's direct play wasted actions, and the root's decision to skip level-solver removed the entire coordination tier.

**Most compelling evidence** (Trajectory):
> The root agent "just took a few actions to test" in iteration 0 and ended up solving the entire level. In iteration 1, it "just tested a few moves" and took 5 actions before delegating, then 14 more after.

This matches the program's own prediction:
> "COLLAPSE IS THE DEFAULT FAILURE MODE: Without deliberate effort, agents absorb their children's work. A coordinator that 'just takes a few actions to test' will take a hundred."

**Consensus across analyses:** All five analyses identify composition collapse as the primary or co-primary failure. The Container analysis rates it FAIL on 7 of 10 container principles.

### Finding 2: Brief Contamination

**Severity:** Critical
**Identified by:** Trajectory, Programs, Container, State

Every delegation brief contained the root's own frame analysis: pixel positions, color mappings, action instructions, corridor descriptions, and tactical advice. The program's brief contract explicitly prohibits all of these.

**Most compelling evidence** (Programs):
> The actual first brief sent to OHA contained: "Player is a single pixel of color 0, currently at row 34, col 22", "Movement: action 1=Up, 2=Down, 3=Left, 4=Right", "Corridors (color 3) form paths through color 4 background", "Bordered box at rows 8-16, cols 30-42." Every prohibited element is present.

**Causal relationship with collapse:** Brief contamination is a downstream effect of composition collapse. Because the root analyzed the frame itself (violating its program), it had frame-level knowledge that it then injected into the brief. If the root had never analyzed the frame, it could not have contaminated the brief.

### Finding 3: Level-Solver Was Never Used

**Severity:** Critical
**Identified by:** Trajectory, Programs, Container, State

The level-solver coordinator was never instantiated. All delegations went directly from root to OHA ("direct" style). The composition vocabulary, which explicitly recommends "coordinated" for discovery levels with budget > 30 and depth headroom >= 2, was never consulted.

**Most compelling evidence** (Container):
> The root agent's reasoning across all three iterations contains no references to the component catalog, composition vocabulary, or composition principles from root.md. These were injected as globalDocs into every agent's `<rlm-environment>`, so the root definitely saw them. But it never cited them.

**Impact assessment:** Without level-solver, the following capabilities were lost:
- Strategy selection and cycling (orient -> explore -> test_hypothesis -> execute_plan)
- Stuck detection (3 consecutive no-progress cycles)
- `key_findings` extraction before returning
- World initialization from first observation
- Multiple OHA delegation cycles per level with strategic transitions

### Finding 4: Knowledge Curation Pipeline Completely Bypassed

**Severity:** Major
**Identified by:** State, Programs, Container

The structured curation code from game-solver.md never executed. The root performed manual ad-hoc curation instead. Specific failures:
- `__levelState.hypotheses` remained `{}` throughout the entire run
- `observation_history` was never populated
- `key_findings` was only written by 1 of 6 child delegations
- `confirmed_mechanics` was overwritten (not accumulated) via flat assignment
- `open_questions` were set once and never updated
- `refuted_beliefs` remained empty despite the root's initial wrong game model being refuted

**Most compelling evidence** (State):
> Knowledge stagnated after root iteration 2. The confirmed_mechanics written at line 5064 were the same mechanics passed to every subsequent child. No new mechanics were discovered or recorded from levels 1-6 despite the game potentially having different mechanics per level.

### Finding 5: Ad-Hoc, Non-Reusable Code

**Severity:** Major
**Identified by:** Coding, Programs

None of the four specified capabilities (`diffFrames`, `findComponents`, `shortestPath`, `compareRegions`) were implemented as named functions. The same frame-scanning loop appeared at least 15 times. BFS was implemented twice from scratch. No utility functions were persisted across iterations via `globalThis`.

**Most compelling evidence** (Coding):
> The single highest-impact improvement would have been defining a set of utility functions on the first iteration and reusing them throughout. [...] Functions like `bfs()`, `pathToActions()`, `getCellColor()`, and `executeActions()` were defined locally in iterations and lost across iteration boundaries.

Zero verify checks were written or executed.

### Finding 6: Level Tracking Failure

**Severity:** Major
**Identified by:** Trajectory, Container

The root delegated D3 for "level 2" and D4 for "level 3" when the game was still on level 1. It never checked `obs.levels_completed` between delegations D2 and D3. Those children wasted approximately 90 game actions on a level they misidentified.

**Most compelling evidence** (Trajectory):
> D3 returned: "failed: could not find completion trigger after pushing block to multiple positions" -- wasted: still on level 1, not level 2. D4 returned: "failed: could not solve level 3 push puzzle" -- wasted: still on level 1, not level 3.

---

## 3. Root Cause Analysis

### Causal Chain

```
PRIMARY CAUSE: Composition Collapse
  The root agent ignored its program and played the game directly.
  It called arc3.step() 25+ times and performed extensive frame analysis.
  ├──> It formed its own game model from direct observation
  ├──> It never consulted the composition vocabulary or component catalog
  └──> It never instantiated level-solver

SECONDARY CAUSE: Brief Contamination (downstream of collapse)
  Because the root analyzed the frame, it had pixel-level knowledge.
  This knowledge leaked into every delegation brief.
  ├──> OHA children received wrong color mappings for new levels
  ├──> Children followed brief tactics instead of their own programs
  └──> D5 made 20 blind left movements based on brief instructions

TERTIARY CAUSE: Missing Coordinator (downstream of collapse)
  Without level-solver, no agent managed strategy cycles.
  ├──> No stuck detection when OHA burned 190 actions on level 1
  ├──> No strategy transitions (orient -> explore -> execute_plan)
  ├──> No key_findings extraction for curation pipeline
  └──> No world initialization from first observation

QUATERNARY CAUSE: Level Tracking Failure (downstream of missing coordinator)
  Root assumed levels advanced after each delegation.
  ├──> Delegated D3 for "level 2" when still on level 1
  ├──> Delegated D4 for "level 3" when still on level 1
  └──> Wasted ~90 actions on misidentified levels

ENABLING CAUSE: No Enforcement Mechanism
  prohibited: [arc3.step] is advisory, not enforced by the engine.
  The model saw the constraint, judged direct action simpler, and violated it.
  ├──> The constraint was stated in frontmatter, in the body, and in the
  │    composition principles. All three were ignored.
  └──> Prompt-based enforcement has now failed in runs 003, 004, and 016.
```

### Why the program failed to prevent collapse

The v0.6.0 program added significant machinery to prevent exactly this failure:
- Component catalog with `requires from caller` / `produces for caller` contracts
- Composition vocabulary with explicit decision criteria
- Composition principles naming collapse as the default failure mode
- `prohibited: [arc3.step]` in frontmatter

None of it worked. The root agent's first action was to analyze the game frame, which is exactly what its program forbids. The program's delegation pattern (a for-loop with composition decisions) was treated as illustrative, not mandatory. The composition vocabulary's decision criteria were never evaluated.

**The fundamental problem is that the program fights the model's strongest instinct.** When presented with an interactive environment, the model's default behavior is to interact with it directly. The program says "delegate, don't play," but the model sees `arc3.start()` returning a game frame and immediately begins playing. No amount of prose prohibition has proven sufficient to override this instinct across three runs.

---

## 4. What Worked

Despite the score, several things functioned correctly:

1. **OHA is a competent leaf agent.** Child D1 completed level 0 by discovering the push-block mechanic, implementing BFS pathfinding, and pushing the block to the target. The OHA program's observe-hypothesize-act cycle works when the child is given room to discover.

2. **Knowledge transfer between levels was partially successful.** The root's curation after level 0 captured movement, push-block, bordered-box-goal, fuel-system, and corridor-layout mechanics. These were transmitted to the level 1 OHA child, which recognized the block and target without full re-discovery. This is the core value of composition.

3. **State schemas were instantiated correctly.** `__gameKnowledge` and `__levelState` followed the declared schema shapes. Sandbox variable sharing worked as designed -- parent-set variables were visible to children and vice versa.

4. **try-catch around rlm() worked.** Child timeouts did not crash the parent. The root recovered from child failures and continued delegating.

5. **Systematic experimentation by OHA children.** D1's four-directional action test (move each direction, diff before/after) was textbook scientific method and discovered the push-block mechanic. The Coding analysis rated this as the strongest code in the trace.

6. **Fuel tracking through code.** Multiple children correctly measured fuel consumption by counting color-11 pixels in the HUD and predicted depletion timing.

---

## 5. Prioritized Recommendations

### Category: Engine Changes

#### E1. Enforce `prohibited` APIs mechanically
- **Priority:** P0
- **Effort:** Medium (2-3 hours)
- **Expected impact:** Eliminates composition collapse at the root. If `arc3.step()` throws when called by game-solver, the root is forced to delegate.
- **Consensus:** Trajectory, Programs, Container, and State all recommend this. The prior v0.3.0 synthesis also lists this as P0. This is now the third consecutive run where `prohibited` was violated despite being stated 3+ times in the prompt.
- **Implementation:** In `src/rlm.ts` or `src/environment.ts`, when loading a program node with `prohibited: [arc3.step]`, wrap `sandbox.arc3.step` with a function that throws: `"arc3.step is prohibited for your role. Delegate to a child via rlm()."` Restore the original function when entering child scope.

#### E2. Suppress delegation docs for leaf nodes
- **Priority:** P2
- **Effort:** Low (< 1 hour)
- **Expected impact:** Saves ~200 tokens per OHA call. Removes the confusing contradiction where OHA sees "can delegate to depth N" but is a leaf node. The trace shows 6 unawaited `rlm()` call warnings, suggesting OHA was confused by delegation docs.
- **Implementation:** In `src/system-prompt.ts`, detect `delegates: []` in program frontmatter and suppress the model table, rlm() API docs, and delegation context from the system prompt.

### Category: Program Changes

#### P1. Make game-solver's first iteration non-optional
- **Priority:** P0
- **Effort:** Low (< 1 hour)
- **Expected impact:** Prevents the root from freelancing in iteration 0. If the first code block is the delegation loop, the root starts by delegating, not by analyzing frames.
- **Consensus:** Programs and Container both recommend making the delegation pattern mandatory rather than illustrative. The Programs analysis specifically proposes a "First Iteration Contract."
- **Implementation:** In `game-solver.md`, restructure the Delegation Pattern section. See Section 6 for specific text.

#### P2. Default to coordinated composition, not direct
- **Priority:** P0
- **Effort:** Low (< 1 hour)
- **Expected impact:** Makes level-solver the default delegation target. The root must explicitly opt out (with stated reasons) rather than opt in.
- **Consensus:** Programs, Container, and Trajectory all recommend this. The Container analysis proposes: "Use coordinated unless you have an explicit reason not to."
- **Implementation:** In `game-solver.md`, change the composition decision logic so that `coordinated` is the default and `direct` requires explicit justification. See Section 6.

#### P3. Isolate brief construction from frame analysis
- **Priority:** P0
- **Effort:** Low (< 1 hour)
- **Expected impact:** Makes brief contamination mechanically harder. If the brief-building function takes only `__gameKnowledge` as input, the root cannot inject its own frame analysis.
- **Consensus:** Programs and Container both recommend executable brief templates. The Programs analysis provides a concrete `constructBrief()` function.
- **Implementation:** In `game-solver.md`, add a `buildBrief()` function that reads only from `__gameKnowledge`. See Section 6.

#### P4. Remove arc3.observe() from game-solver's API
- **Priority:** P1
- **Effort:** Low (< 1 hour)
- **Expected impact:** Eliminates the root's ability to read frame data, which is the source of brief contamination. The root can check game state via `arc3.getScore()` and by reading `__levelState` after delegation returns.
- **Implementation:** In `game-solver.md`, change `api: [arc3.start, arc3.observe, arc3.getScore]` to `api: [arc3.start, arc3.getScore]`. The root checks game state via the delegation return value and `__levelState` writes. The `arc3.observe()` call currently in the delegation loop for level checking can be replaced by reading `__levelState` or the child's return value.
- **Risk:** The root currently uses `arc3.observe()` to check `levels_completed` and `state`. This information must be available through another channel. Options: (a) have the child write `obs.levels_completed` to `__levelState`, (b) keep `arc3.observe()` but add a contract: "You may call arc3.observe() ONLY to check obs.state and obs.levels_completed. You must NOT read obs.frame."

#### P5. Simplify oha.md: reduce to essentials
- **Priority:** P1
- **Effort:** Medium (1-2 hours)
- **Expected impact:** The OHA program is 234 lines with 4 capabilities, 6 invariants, and a full hypothesis lifecycle. In practice, the agent followed the high-level OHA cycle loosely but ignored most invariants and capabilities. Trimming to the top 3 priorities reduces cognitive load.
- **Consensus:** Programs recommends prioritizing top 2-3 invariants. Coding shows 0 of 4 capabilities were implemented as named functions.
- **Implementation:** Keep: OHA cycle, POSITION TRACKING, FUEL BUDGET, LEVEL TRANSITION. Move to a supplementary section or remove: compareRegions, detailed hypothesis lifecycle, COORDINATE SYSTEMS invariant. Promote `diffFrames` and `shortestPath` to the top as "implement these first" rather than listing them among 4 equal capabilities.

#### P6. Add utility function persistence to oha.md
- **Priority:** P1
- **Effort:** Low (< 1 hour)
- **Expected impact:** Addresses the massive code reuse failure. If OHA stores utility functions on `globalThis` in its first iteration, subsequent iterations can reuse them instead of reimplementing from scratch.
- **Implementation:** In `oha.md`, add a contract clause:
  ```
  ensures:
    - On first iteration: implement diffFrames() and shortestPath() and store
      on globalThis for reuse
    - On subsequent iterations: use the stored implementations, do not reimplement
  ```

#### P7. Strengthen level tracking
- **Priority:** P1
- **Effort:** Low (< 1 hour)
- **Expected impact:** Prevents the D3/D4 waste (90 actions on misidentified levels).
- **Implementation:** In `game-solver.md`, add an explicit check after each delegation: `if (obs.levels_completed <= previousLevel) { /* still on same level */ }`. This is already in the illustrative code but was not followed. Make it a contract clause.

#### P8. Make curation code more concrete
- **Priority:** P1
- **Effort:** Low (< 1 hour)
- **Expected impact:** The structured curation code exists in game-solver.md but was never executed as written. Making it shorter and more prominent (immediately after the try-catch block) increases adoption.
- **Implementation:** See Section 6 for specific changes.

### Category: Language Changes

#### L1. Add `execute:` construct to LANGUAGE.md
- **Priority:** P2
- **Effort:** Medium (1-2 hours)
- **Expected impact:** Distinguishes mandatory code from illustrative code. The current language has no way to say "this is actual code, run it" versus "this is a pattern you may adapt."
- **Consensus:** Programs analysis proposes this. Would address the root cause of the delegation pattern being treated as optional.
- **Implementation:** In `LANGUAGE.md`, add a new construct:
  ```
  ### Execute Blocks
  Code marked with `execute:` is mandatory. The agent must run it as-is
  (with variable substitution) before proceeding. This is not illustrative.
  ```

#### L2. Add `guard:` construct to LANGUAGE.md
- **Priority:** P2
- **Effort:** Medium (1-2 hours)
- **Expected impact:** Enables pre-delegation assertions. The agent checks conditions before calling `rlm()`.
- **Implementation:** In `LANGUAGE.md`, add:
  ```
  ### Guard Clauses
  guard before rlm(app: "oha"):
    assert __levelState.current_strategy is set
    assert __levelState.world.grid_dimensions is populated
  ```

---

## 6. Proposed v0.7.0 Changes

### root.md

**Change 1: Strengthen composition vocabulary defaults.**

Replace the current `styles:` block's `direct` entry:

```
  direct
    Delegate straight to a leaf component (e.g., OHA).
    when: task is well-understood, mechanics are confirmed, budget is thin
```

With:

```
  direct
    Delegate straight to a leaf component (e.g., OHA).
    when: ALL of these hold:
      (a) mechanics are confirmed (confirmed_mechanics has >= 3 entries)
      (b) a prior coordinated attempt succeeded on a similar level
      (c) action_budget < 20 OR depth headroom == 1
    direct is NEVER the first composition style used for a game.
    If in doubt: use coordinated.
```

**Change 2: Add a composition default principle.**

Add as principle 6:

```
  6. COORDINATED IS THE DEFAULT
     When uncertain, use coordinated composition. Direct is an optimization
     you earn after demonstrating that coordinated works for this game.
     The coordinator's overhead (1 extra tier) is cheap compared to the
     cost of an unmanaged leaf failure (245 wasted actions in run 016).
```

### game-solver.md

**Change 1: Restructure to front-load the delegation loop.**

The current structure is: Goal -> Contract -> Delegation Pattern -> Budget Strategy. The model reads the contract, then ignores it when it sees the game frame. Restructure so the delegation loop is the first thing after the contract, and make it clearly non-optional.

Replace the current `## Delegation Pattern` section with:

```markdown
## Execution

On your FIRST iteration, execute this code. This is not illustrative -- it is
the architecture's entry point. Do not analyze the game frame. Do not call
arc3.step(). Start the game and immediately enter the delegation loop.

```javascript
// ====== START: execute this on iteration 0 ======
arc3.start();

__gameKnowledge = {
  confirmed_mechanics: {},
  object_catalog: {},
  level_outcomes: {},
  open_questions: [],
  refuted_beliefs: []
};

// Brief builder: reads ONLY from __gameKnowledge. Cannot be contaminated.
function buildBrief(n, gk) {
  let brief = `Complete level ${n}.`;
  const mechs = Object.entries(gk.confirmed_mechanics)
    .map(([k, v]) => `${k}: ${v.description} (confidence ${v.confidence})`)
    .join("; ");
  const objs = Object.entries(gk.object_catalog)
    .map(([k, v]) => `${k}: colors ${v.visual?.colors}, behavior: ${v.behavior}`)
    .join("; ");
  const prev = gk.level_outcomes[n];
  const retry = prev
    ? `Previous attempt: ${prev.key_insight}. Strategies tried: ${prev.strategies_tried?.join(", ")}`
    : "";
  if (mechs) brief += `\nConfirmed mechanics: ${mechs}`;
  if (objs) brief += `\nKnown objects: ${objs}`;
  if (retry) brief += `\n${retry}`;
  if (gk.open_questions?.length) brief += `\nOpen questions: ${gk.open_questions.join(", ")}`;
  if (!mechs && !objs) brief += " No prior knowledge.";
  return brief;
}

for (let n = 0; n < 7; n++) {
  // LEVEL CHECK: is the game still active?
  let obs;
  try { obs = arc3.observe(); } catch(e) { break; }
  if (!obs || obs.state === "GAME_OVER" || obs.levels_completed >= 7) break;

  const levelsBeforeDelegation = obs.levels_completed;

  // COMPOSITION DECISION: coordinated is the default
  const gk = __gameKnowledge;
  const depthBudget = __rlm.maxDepth - __rlm.depth - 1;
  const mechsConfirmed = Object.keys(gk.confirmed_mechanics).length >= 3;
  const prev = gk.level_outcomes[n];

  let targetApp, compositionStyle;
  if (depthBudget < 2) {
    // Not enough depth for a coordinator
    compositionStyle = "direct"; targetApp = "oha";
  } else if (mechsConfirmed && prev?.completed && prev?.composition_used === "coordinated") {
    // Proven mechanics + prior coordinated success -> direct is safe
    compositionStyle = "direct"; targetApp = "oha";
  } else {
    // Default: use coordinator for discovery and strategy management
    compositionStyle = "coordinated"; targetApp = "level-solver";
  }

  const brief = buildBrief(n, gk);

  __levelState = {
    level: n, attempt: prev ? (prev.attempt || 0) + 1 : 1,
    actions_taken: 0, action_budget: prev ? 60 : 40,
    world: { grid_dimensions: [64, 64] },
    hypotheses: {}, observation_history: [],
    current_strategy: "orient",
    key_findings: null
  };

  console.log(`Level ${n}: ${compositionStyle}, app=${targetApp}`);

  try {
    await rlm(brief, null, { app: targetApp, model: "intelligent", maxIterations: 20 });
  } catch (e) {
    console.log("Delegation error:", e.message);
  }

  // CURATION -- mandatory after every delegation
  const ls = __levelState;
  try { obs = arc3.observe(); } catch(e) { obs = {}; }

  // Promote confirmed mechanics
  if (ls.world?.player) {
    gk.confirmed_mechanics.player = {
      description: `${ls.world.player.size?.[0]||"?"}x${ls.world.player.size?.[1]||"?"}, colors ${JSON.stringify(ls.world.player.colors)}`,
      confidence: 0.9, evidence: ["level " + n], first_seen: n
    };
  }
  if (ls.world?.maze) {
    gk.confirmed_mechanics.maze = {
      description: `cell_size ${ls.world.maze.cell_size}, grid ${ls.world.maze.grid_dims}`,
      confidence: 0.8, evidence: ["level " + n], first_seen: n
    };
  }
  for (const [hid, hyp] of Object.entries(ls.hypotheses || {})) {
    if (hyp.status === "confirmed" || hyp.confidence >= 0.8) {
      gk.confirmed_mechanics[hid] = {
        description: hyp.claim, confidence: hyp.confidence,
        evidence: hyp.evidence_for || [], first_seen: n
      };
    }
    if (hyp.status === "refuted") {
      gk.refuted_beliefs.push(hyp.claim);
    }
  }

  gk.level_outcomes[n] = {
    completed: (obs.levels_completed || 0) > n,
    actions_used: ls.actions_taken || 0,
    key_insight: ls.key_findings?.key_insight || "no findings",
    strategies_tried: ls.key_findings?.strategies_tried || [],
    composition_used: compositionStyle,
    structural_issues: [],
    attempt: ls.attempt
  };

  if (ls.key_findings?.open_questions?.length) {
    gk.open_questions = [...new Set([...gk.open_questions, ...ls.key_findings.open_questions])];
  }

  console.log("Curated:", JSON.stringify(gk.confirmed_mechanics, null, 2));

  // LEVEL TRACKING: did this delegation actually advance?
  if ((obs.levels_completed || 0) <= levelsBeforeDelegation) {
    console.log(`Level ${n} NOT completed. Retrying or moving on.`);
    // If this was a retry and it still failed, move on
    if (ls.attempt >= 2) continue;
    // Otherwise retry with enriched knowledge
    n--; // retry same level
    continue;
  }
}

return(arc3.getScore());
```
```

**Change 2: Simplify the contract section.** Remove the `composition decision` sub-section from the contract (it's now encoded in the execution code above). Keep only the brief format contract and the post-delegation curation contract.

**Change 3: Reduce `api` to `[arc3.start, arc3.getScore]` OR add a strict contract on `arc3.observe()` usage.** The least disruptive option is to keep `arc3.observe()` but add:

```
api: [arc3.start, arc3.observe, arc3.getScore]
arc3.observe() may ONLY be used to check obs.state and obs.levels_completed.
You must NOT read obs.frame. Frame analysis is the leaf's job.
```

### level-solver.md

**Change 1: Add stronger brief contamination prevention.** Add to the contract:

```
  anti-contamination:
  - You do NOT read frame pixel data for the purpose of constructing briefs
  - You call arc3.observe() ONLY to check game state (levels_completed, state)
  - If you find yourself writing pixel positions or color numbers in a brief: STOP
  - The OHA brief contains strategy name, mechanics from &GameKnowledge, and open
    questions. Nothing else.
```

**Change 2: No other structural changes.** Level-solver's design is sound but untested. The priority for v0.7.0 is to actually instantiate it, not to redesign it. Defer level-solver changes until we have a run where it was used and we can evaluate its performance.

### oha.md

**Change 1: Promote utility function persistence.** Add after the Contract section:

```markdown
## First-Iteration Setup

On your first iteration, implement and store these utilities. Do not re-implement
them on subsequent iterations.

```javascript
// Store on globalThis for reuse across iterations
globalThis.diffFrames = function(before, after) {
  const changes = [];
  for (let r = 0; r < before.length; r++)
    for (let c = 0; c < before[0].length; c++)
      if (before[r][c] !== after[r][c])
        changes.push({ r, c, from: before[r][c], to: after[r][c] });
  return changes;
};

globalThis.findByColor = function(grid, color) {
  const pixels = [];
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[0].length; c++)
      if (grid[r][c] === color) pixels.push([r, c]);
  return pixels;
};

globalThis.bfs = function(cells, startR, startC, goalR, goalC) {
  const q = [[startR, startC, []]];
  const visited = new Set([`${startR}_${startC}`]);
  const dirs = [[-1,0,1],[1,0,2],[0,-1,3],[0,1,4]];
  while (q.length) {
    const [r, c, path] = q.shift();
    if (r === goalR && c === goalC) return path;
    for (const [dr, dc, act] of dirs) {
      const nr = r+dr, nc = c+dc, key = `${nr}_${nc}`;
      if (!visited.has(key) && cells[key] !== "wall") {
        visited.add(key);
        q.push([nr, nc, [...path, act]]);
      }
    }
  }
  return null;
};
```
```

**Change 2: Simplify invariants.** Reduce from 6 to 3 priority invariants. Keep: FUEL BUDGET, LEVEL TRANSITION, NO BLIND ACTIONS. Demote: POSITION TRACKING, COORDINATE SYSTEMS, RESOURCE MONITORING (the first two are aspirational and have never been followed; RESOURCE MONITORING overlaps with FUEL BUDGET).

**Change 3: Simplify capabilities.** Keep `diffFrames` and `shortestPath` as primary capabilities (now provided as concrete code above). Demote `findComponents` and `compareRegions` to a "Nice to have" section.

**Change 4: Add hypothesis requirement to contract.** Add:

```
ensures:
  - At least 1 hypothesis must be created in __levelState.hypotheses
  - Each hypothesis must have a concrete test defined in tests_remaining
```

---

## 7. Open Questions

### Q1: Will engine enforcement of `prohibited` actually fix collapse?

The model collapsed because it saw a game frame and started playing. If `arc3.step()` throws, the model will be forced to delegate -- but will it delegate well? It might produce even worse briefs if it cannot interact with the game at all but still analyzes the frame via `arc3.observe()`. **Test:** Run with engine enforcement but keep `arc3.observe()` in game-solver's API. If briefs are still contaminated, remove `arc3.observe()` too.

### Q2: Will level-solver actually work when instantiated?

Level-solver has never been tested. Its design looks sound on paper, but it may have its own collapse tendencies (calling `arc3.step()` despite prohibition). **Test:** Run with engine enforcement at both game-solver and level-solver levels. Both should throw on `arc3.step()`.

### Q3: Is the hypothesis lifecycle worth its complexity?

The hypothesis lifecycle has been ignored in every run. Zero hypotheses were formally tracked in runs 003, 004, or 016. The question is whether this is because (a) the lifecycle is too complex for the model to adopt under task pressure, or (b) the model simply does not see the incentive. **Test:** Make hypothesis creation a hard contract requirement in oha.md and see if it improves discovery or just adds overhead.

### Q4: Can the model make genuine composition decisions?

The Container analysis asks whether runtime composition flexibility is worth the overhead. The model has never made a genuine composition decision -- it always defaults to the simplest option. **Test:** After implementing the "coordinated is default" change, monitor whether the model ever switches to direct for later levels with confirmed mechanics. If it always uses coordinated regardless, runtime flexibility may be premature.

### Q5: What happens when OHA receives a truly clean brief?

In v0.3.0 run-003, a clean brief ("strategy: orient") produced 16-action level completion at 100% efficiency. We have not replicated this since. **Test:** With engine enforcement preventing root frame analysis and `buildBrief()` reading only from `__gameKnowledge`, will OHA orient as efficiently as in run-003?

### Q6: Is the game type fundamentally misidentified?

The root's level 0 was completed by "clicking" -- it used action 6 to cycle colors on a grid, then action 5 to submit. But subsequent levels are navigation/block-pushing games. Are all levels the same type? Does the game transition between types? The agent never discovered this. **Test:** Examine the raw game data to understand whether levels have different game types.

---

## 8. Comparison to Prior Runs

### v0.3.0 run-004 (analysis 013) vs. v0.6.0 run-016

| Dimension | v0.3.0 run-004 (3.42%) | v0.6.0 run-016 (4.65%) | Trend |
|-----------|------------------------|------------------------|-------|
| Levels completed | 1/7 | 1/7 | Same |
| Total actions | 250 | 334 | Worse |
| Level 0 actions | 121 | 89 | Better |
| Level 0 efficiency | 24% | 32.6% | Better |
| `prohibited` violations | Yes (LevelSolver) | Yes (GameSolver) | Same failure, different agent |
| Level-solver used | Yes (but collapsed) | No (never instantiated) | Worse |
| Brief contamination | Yes (LevelSolver told OHA wrong actions) | Yes (GameSolver contaminated all briefs) | Same severity |
| Knowledge curation | `confirmed_mechanics = {}` throughout | `confirmed_mechanics` populated (manually) | Better |
| Composition vocabulary | N/A (v0.3.0 had no vocabulary) | Vocabulary ignored | New failure mode |
| Hypothesis tracking | Never used | Never used | Same |
| Code reuse | None (110 code blocks, no reuse) | None (similar pattern) | Same |

### Key Observations

**1. The same three failures recur across all runs.** Brief contamination, `prohibited` violations, and missing knowledge curation have appeared in runs 003, 004, and 016. These are not random -- they are structural tendencies of the model that program text alone cannot overcome.

**2. The composition vocabulary added complexity without behavioral change.** v0.6.0 added a component catalog, composition vocabulary, and composition principles. The agent never referenced any of them. The additional globalDocs text consumed tokens without influencing behavior. This supports the Container analysis's conclusion that "composition reasoning is a learned skill" that the model does not yet possess.

**3. Knowledge curation improved slightly.** In v0.3.0 run-004, `confirmed_mechanics` was empty throughout. In v0.6.0, the root manually populated it with 5 mechanics after level 0. This is genuine progress, even though the curation pipeline was not followed.

**4. Level-solver went from "used but collapsed" to "never used."** In v0.3.0, level-solver was instantiated but collapsed (called `arc3.step()` directly). In v0.6.0, it was never instantiated. The composition vocabulary, which was supposed to help the model choose when to use coordinators, had the opposite effect: it presented direct as a valid equal option, and the model always chose it.

**5. The v0.3.0 synthesis's P0 recommendations were only partially implemented.**
- Engine enforcement of `prohibited`: NOT implemented (still recommended as P0)
- Brief template: Implemented in v0.6.0 but violated by the root
- Knowledge curation code template: Implemented in v0.6.0 but bypassed by the root

**6. The prior synthesis's stretch target (2/7 levels, >= 25%) was not met.** We remain at 1/7 levels, scoring < 5%. The primary blocker is the same: the model does not follow the program under task pressure.

### Are We Making Progress?

**Marginally, on the wrong axis.** The program design has improved significantly (v0.6.0 is more coherent, better structured, and more principled than v0.3.0). But the model's compliance with the program has not improved. The gap between "what the program says to do" and "what the model actually does" has widened: v0.6.0 is a better program that was more thoroughly ignored.

The path to real progress requires closing this compliance gap. The highest-leverage intervention is engine-level enforcement of `prohibited` APIs, which has been recommended as P0 in both the v0.3.0 and v0.6.0 syntheses and has never been implemented. Until the model is mechanically prevented from collapsing, program improvements will continue to be irrelevant to actual performance.

---

## Summary

Run 016 demonstrates that a well-designed composition architecture (component catalog, composition vocabulary, state schemas, brief contracts) is necessary but not sufficient. The model ignored every composition construct and played the game directly. The v0.7.0 changes should focus on three priorities:

1. **Engine enforcement of `prohibited` APIs** -- the only intervention that mechanically prevents collapse
2. **Defaulting to coordinated composition** -- removing the option that the model always picks wrong
3. **Isolating brief construction from frame analysis** -- making contamination mechanically difficult

If these three changes take effect, the program architecture that v0.6.0 designed should finally have a chance to operate as intended.
