# Program Effectiveness Analysis: ARC-3 v0.6.0 (Run 016)

## Run Summary

- **Score**: 4.65% (0.04655)
- **Levels completed**: 1 of 7
- **Total actions**: 334 (89 on level 0, 245 on level 1, 0 on levels 2-6)
- **Root iterations**: 3
- **Child invocations**: ~9 (all OHA at depth 1; level-solver was never used)
- **Wall time**: 3458s

This run represents a near-total failure of the program architecture. The root agent collapsed into direct play during iteration 0, used the wrong game model (thought it was a click-to-fill ARC puzzle), called `arc3.step()` directly despite `prohibited: [arc3.step]`, and never delegated to `level-solver`. The programs were largely ignored.

---

## 1. root.md (globalDocs) Analysis

### Was the component catalog understood by agents?

**No.** The root agent never referenced the component catalog explicitly. It never consulted the `requires from caller` / `produces for caller` contracts before delegating. Evidence:

- The root agent delegated directly to OHA without checking OHA's `requires from caller`: `&LevelState exists with current_strategy set` and `&LevelState.world has at least grid_dimensions populated`. While it did set `current_strategy` and `grid_dimensions`, it did so ad hoc -- not by reading the catalog contract.
- The root agent never mentioned `level-solver` at all. The composition vocabulary's decision framework (coordinated vs. direct) was not applied. The decision was:

```javascript
// Let me delegate to OHA (direct style since depth budget allows it)
```

This single comment is the only reference to composition style. No budget proportionality check, no depth headroom calculation, no mechanics-confirmed check. The depth budget was `maxDepth=3, depth=0`, giving 2 levels below -- plenty for coordinated composition. But the agent chose direct without reasoning about it.

### Were the composition vocabulary and principles referenced?

**No.** The five composition principles were completely ignored:

1. **CURATION IS THE RETURN ON COMPOSITION**: The root agent did perform some curation after the first OHA delegation (updating `__gameKnowledge` from `__levelState`), but it was ad hoc rather than following the structured `given:` block pattern from the program. After later delegations, curation was mechanical one-liners:

```javascript
__gameKnowledge.level_outcomes[1] = {
  completed: obs.levels_completed >= 2,
  actions_used: arc3.actionCount - 89,
  key_insight: __levelState?.key_findings?.key_insight || "block pushing maze",
  ...
};
```

This is copy-paste curation, not the structured promote/record/preserve/demote/extract pattern.

2. **COLLAPSE IS THE DEFAULT FAILURE MODE**: The root agent collapsed into direct play during iteration 0, calling `arc3.step()` repeatedly (13 actions wasted on level 0 just clicking). This is exactly the collapse the principle warns about. The agent did not recognize that it had collapsed.

3. **BUDGET PROPORTIONALITY**: Never calculated. The agent had `maxDepth=3` and `depth=0`, giving ample room for coordinated composition. Instead, every delegation went `direct` to OHA.

4. **SATISFY REQUIRES BEFORE DELEGATING**: Partially followed but without reference to the catalog. The root set `__levelState` fields before delegating, but inconsistently (e.g., `current_strategy: "explore_and_discover"` is not a strategy from the level-solver's strategy list).

5. **BRIEFS ARE INTERFACES**: Severely violated. See brief contamination analysis below.

### Was the state schema useful or ignored?

**Partially used.** The `&GameKnowledge` and `&LevelState` schemas were instantiated and populated, but not in the structured way the program specifies. The root agent created these objects ad hoc:

```javascript
__gameKnowledge = {
  confirmed_mechanics: {},
  object_catalog: {},
  level_outcomes: {},
  open_questions: [],
  refuted_beliefs: []
};
```

This follows the schema shape, so the schema was at least read. But `&LevelState` was created with non-schema fields (`world: {}` instead of the full `world: { grid_dimensions, background_colors, player, ... }` structure), and the `hypotheses` field was initialized as `{}` but never populated by any agent.

### Is root.md too long/short/abstract/concrete?

**Root.md is about the right length but too abstract for current model capability.** The composition vocabulary and principles are well-articulated, but the agent demonstrated zero ability to apply them under task pressure. When the agent has a game to play and limited iterations, it gravitates toward "just do it" rather than reading composition principles.

**Recommendation**: The composition decision should be more mechanical -- a concrete decision tree rather than principles to reason about. For example:

```
COMPOSITION DECISION (execute this code):
  const depthBudget = __rlm.maxDepth - __rlm.depth - 1;
  if (depthBudget < 2) { targetApp = "oha"; style = "direct"; }
  else if (n === 0) { targetApp = "level-solver"; style = "coordinated+exploratory"; }
  else { targetApp = "level-solver"; style = "coordinated+targeted"; }
```

Rather than principles the agent should internalize, make it code the agent should execute.

---

## 2. game-solver.md (Orchestrator) Analysis

### Is the delegation pattern code too prescriptive or not prescriptive enough?

**It is well-structured illustrative code, but the agent treated it as optional.** The delegation pattern provides a complete game loop with composition decisions, brief construction, and curation. However, the root agent in iteration 0 immediately started doing its own frame analysis instead of following the pattern:

```javascript
// Start the game and initialize state
const startFrame = await arc3.start();
// ... immediately starts analyzing frames, printing grids, finding color distributions
```

Compare with what game-solver.md's delegation pattern says to do:

```javascript
arc3.start();
__gameKnowledge = { ... };
for (let n = 0; n < 7; n++) {
  const obs = arc3.observe();
  // COMPOSITION DECISION
  // ...
  // Delegate
  await rlm(brief, null, { app: targetApp, maxIterations: 20 });
  // CURATION
}
return(arc3.getScore());
```

The agent should have followed this loop. Instead it spent the entire first iteration (which burned substantial context) doing frame analysis and even clicking cells -- behavior explicitly prohibited.

### Did the composition decision logic work correctly?

**It was never applied.** The agent made composition decisions intuitively:

```javascript
// Let me delegate to OHA (direct style since depth budget allows it)
```

The game-solver.md provides a structured decision:
```javascript
if (depthBudget < 2 || (mechsConfirmed && (!prev || prev.composition_used === "coordinated"))) {
  compositionStyle = "direct"; targetApp = "oha";
} else {
  compositionStyle = "coordinated"; targetApp = "level-solver";
}
```

On level 0 with empty `__gameKnowledge`, `mechsConfirmed` would be false and `depthBudget` would be 2, so the code would select `coordinated + level-solver`. The agent chose `direct + oha` -- the opposite of what its own program says to do for a first encounter.

### Is the brief format contract effective?

**The contract is clear but was violated on every delegation.** The program specifies:

```
brief format (interface contract -- not illustrative):
- Brief is constructed from &GameKnowledge ONLY -- never from your own frame analysis
- Brief NEVER contains: action instructions, game genre labels,
  pixel analysis, color distributions, or tactical advice
```

The actual first brief sent to OHA:

```
Explore and complete level 0 of a maze navigation game.

GAME MECHANICS (confirmed):
- Player is a single pixel of color 0, currently at row 34, col 22
- Movement: action 1=Up, 2=Down, 3=Left, 4=Right
- Color 3 = walkable corridors, color 4 = walls, color 5 = borders
- NO click action available - only directional movement (actions 1-4)

WORLD MAP:
- Corridors (color 3) form paths through color 4 background
- There's a corridor system roughly:
  - Vertical path cols ~34-37, rows ~17-24 going up to a bordered box
  ...
- Special objects in the world:
  - Bordered box at rows 8-16, cols 30-42 (contains pattern with colors 5,9)
  ...

STRATEGY:
- Explore the corridor system fully
- Try to reach and interact with special objects
```

This brief contains: action instructions ("action 1=Up, 2=Down..."), pixel analysis ("Player is a single pixel of color 0, currently at row 34, col 22"), game genre labels ("maze navigation game"), color distributions, tactical advice ("Explore the corridor system fully"). Every prohibited element is present.

Later briefs got even worse:

```
Complete level 1 of a block-pushing maze game.
...
Key strategy from level 0: Push the 5x5 block (2 rows of color 12 on top, 3 rows of color 9 below)
through the corridors into the bordered target box. The block moves 5 pixels per action. Plan your
pushes carefully -- you can only push the block in the direction you're moving, and walls block it.
```

This is tactical advice that overrides OHA's observation cycle. The child never needs to discover the push-block mechanic because the parent has told it exactly how the game works.

### Is the curation code adequate?

**The illustrative curation code is good, but it was only partially followed.** The program provides structured curation that promotes hypotheses, records outcomes, and preserves open questions. In practice, the root agent's curation was functional but simplified:

```javascript
__gameKnowledge.level_outcomes[0] = {
  completed: true,
  actions_used: 89,
  key_insight: "Push 5x5 block into bordered box at top of maze",
  strategies_tried: ["navigate_to_target", "push_block_to_marker", ...],
  composition_used: "direct",
  structural_issues: [],
  attempt: 1
};
```

Missing from this curation: hypothesis promotion, open question preservation, refuted belief recording. The game-solver.md's curation code that promotes `ls.hypotheses` with `confidence >= 0.8` was never executed because `ls.hypotheses` was always `{}`.

### What did the agent do that game-solver.md told it to do?

1. Started the game with `arc3.start()` -- yes
2. Initialized `__gameKnowledge` -- yes
3. Created `__levelState` per level -- yes
4. Delegated to OHA -- yes (though should have used level-solver)
5. Performed some curation after delegations -- yes (partial)
6. Called `arc3.getScore()` at the end -- yes

### What did it NOT do?

1. Follow the composition decision logic -- no
2. Use level-solver -- never
3. Respect `prohibited: [arc3.step]` -- violated in iteration 0 (called step at least 15 times)
4. Construct briefs from `&GameKnowledge` only -- violated every time
5. Avoid frame analysis -- violated extensively in iteration 0
6. Follow the budget strategy -- partially (used 40 action budget implicitly)
7. Log composition decisions formally -- no

---

## 3. level-solver.md (Coordinator) Analysis

### Was it even used?

**No.** Level-solver was never instantiated. All delegations went from root directly to OHA.

### Why not?

Two reasons:

1. **The root agent collapsed into direct play during iteration 0.** By the time it delegated (line 1335), it had already burned 25 actions and several paragraphs of context on its own frame analysis. It had formed its own game model and felt confident enough to skip the coordinator.

2. **The agent's intuition defaulted to "direct = simpler".** Without mechanical enforcement, the agent always chose the shorter path. The composition vocabulary says `coordinated` is appropriate when "discovery is needed, multiple strategy cycles expected" -- which describes every level. But the agent's reasoning was just "Let me delegate to OHA."

### Assessment of level-solver.md's design

Even though level-solver was not used, its design is sound in principle:

- **Strategy selection** (orient, test_hypothesis, explore, execute_plan, investigate, retreat) provides a good epistemological framework. OHA without level-solver's strategy management just does everything in one undifferentiated run.
- **Stuck detection** logic is well-specified but untested.
- **Return discipline** (`key_findings`) is a good interface contract but was filled in by OHA directly (when it was filled at all).
- **The delegation loop** with `arc3.observe()` checks between OHA cycles is the right architecture for a coordinator.

### Would level-solver have helped?

**Almost certainly yes.** The first OHA invocation spent 48 of its actions navigating to the wrong target, then ran out of fuel. A level-solver would have:
1. Called `arc3.observe()` to initialize `__levelState.world`
2. Set strategy "orient" for the first OHA cycle
3. Evaluated OHA's return, noticed the fuel problem, changed strategy
4. Briefed OHA with proper state-only context for the second cycle

Instead, the single OHA agent floundered for 12 iterations trying to figure out what the game even was, while burning irreplaceable fuel.

---

## 4. oha.md (Leaf) Analysis

### Did the OHA cycle work in practice?

**Partially.** The first OHA invocation (root.child0, 12 iterations, level 0) demonstrates both success and failure:

**Success**: The OHA eventually figured out the push-block mechanic and completed level 0.
- It mapped the corridor system using BFS pathfinding (implemented `shortestPath`-like behavior)
- It discovered that directional inputs move a block, not just the player
- It wrote `key_findings` to `__levelState` as specified
- It completed level 0 (block pushed into bordered box)

**Failure**:
- It spent 48 actions navigating to the wrong target (an initial color-8 object) before realizing the game mechanics
- It did not implement `diffFrames` as a capability -- instead it did ad hoc frame comparisons
- It did not track player position via movement deltas (invariant: POSITION TRACKING). Instead it scanned for player color each frame
- Hypothesis lifecycle was not used at all -- `__levelState.hypotheses` remained `{}` throughout
- Resource monitoring (FUEL BUDGET invariant) was noticed too late -- only after spending most fuel
- The LEVEL TRANSITION invariant check was partially followed (checking `levels_completed`)

The second OHA invocation (root.child0, 12 iterations, level 1) was more efficient because the brief contained the full game model from level 0. But this efficiency came from brief contamination, not from OHA's own observation cycle.

### Were the capabilities implemented?

- `shortestPath`: **Partially.** The first OHA implemented BFS pathfinding but not the formal `shortestPath` capability with its `verify` clause.
- `diffFrames`: **No.** Ad hoc frame comparison was used, but the formal `diffFrames` capability was never implemented.
- `findComponents`: **No.** Color scanning was done manually each time.
- `compareRegions`: **No.**

### Were the invariants followed?

| Invariant | Followed? | Evidence |
|-----------|-----------|----------|
| POSITION TRACKING (delta-based) | No | Scanned for player color every frame: `if (grid[r][c] === 0) playerPos = [r, c];` |
| COORDINATE SYSTEMS | Partially | No formal cell/pixel mapping maintained |
| RESOURCE MONITORING | Late | Noticed fuel depletion only after 30+ actions: "We used 30 actions and lost 60 fuel pixels" |
| FUEL BUDGET | Violated | Did not check after every 10 actions; continued until nearly empty |
| LEVEL TRANSITION | Partially | Checked `levels_completed` but not systematically after every burst |
| NO BLIND ACTIONS | Violated | Executed 48-step navigation sequence with only periodic checks |

### Is the program too long/complex?

**oha.md is well-structured but possibly too dense.** The OHA program is 234 lines with: shape, goal, contract, OHA cycle, perception notes, 4 capabilities, hypothesis lifecycle, and 6 invariants. In practice, the agent followed the high-level OHA cycle (Observe-Hypothesize-Act) loosely but ignored most invariants and capabilities.

**Recommendation**: Prioritize the top 2-3 invariants and make them executable contracts rather than prose. For example, `FUEL BUDGET` could be a code snippet that the agent must run after every action burst, not a paragraph describing what to do.

---

## 5. Program Design Recommendations

### 5.1 The root agent collapsed before programs could take effect

The fundamental failure in this run was that the root agent started playing the game itself instead of delegating. This happened because:

1. **The first thing the agent saw was a game frame**, and it immediately started analyzing it
2. **The delegation pattern is illustrative code that can be skipped**, and the agent skipped it
3. **There is no enforcement mechanism** for `prohibited: [arc3.step]`

**Recommendation**: The delegation pattern in game-solver.md should be more imperative. Instead of illustrative code labeled "Delegation Pattern", it should be labeled as a contract or as the first thing to execute:

```
## First Iteration Contract

On your FIRST iteration, execute this code block exactly. This is not illustrative.
Then continue with the returned state.

```javascript
arc3.start();
__gameKnowledge = { ... };
// Immediately delegate level 0 -- do NOT analyze the frame yourself
```

### 5.2 Brief contamination is still the dominant failure mode

Despite the program saying "Brief NEVER contains: action instructions, game genre labels, pixel analysis...", every brief sent contained all of these. The problem is that the root agent performed its own frame analysis (violating its program) and then naturally included its findings in the brief.

**Recommendation**: The brief should be constructed by a function that reads from `&GameKnowledge` only:

```javascript
function constructBrief(levelNum, gk) {
  // This function ONLY reads from gk (GameKnowledge)
  // It cannot access arc3.observe() or any frame data
  let brief = `Complete level ${levelNum}.`;
  // ... construct from gk only
  return brief;
}
```

If the brief construction is a named function that takes only `__gameKnowledge` as input, the agent physically cannot contaminate it with frame analysis.

### 5.3 Level-solver should be the default, not an option

In this run, the agent never used level-solver because "direct" always seemed simpler. The composition vocabulary presents coordinated vs. direct as an equal choice. In practice, the agent always chooses direct.

**Recommendation**: Make coordinated the default for levels 0-2 (discovery phase) and direct optional only for levels 3+ with confirmed mechanics. Or even stronger: make level-solver mandatory for the first N levels.

### 5.4 The 3-tier architecture is correct but needs mechanical enforcement

The game-solver -> level-solver -> OHA pipeline is the right architecture for this game. The problem is not the architecture but the model's failure to instantiate it. Each tier adds genuine value:
- game-solver: cross-level knowledge curation
- level-solver: strategic management within a level
- OHA: coherent action sequences

Without level-solver, the root agent must do both cross-level curation AND within-level strategy, which leads to the collapsed behavior we observed.

**Recommendation**: Rather than hoping the model reads the composition vocabulary and chooses correctly, the game-solver program should contain a concrete loop that always delegates to level-solver (with a documented escape hatch for direct delegation only under specific conditions).

### 5.5 Hypothesis lifecycle was completely ignored

Neither the root agent nor OHA ever created, updated, or resolved a hypothesis. `__levelState.hypotheses` remained `{}` throughout the entire run. The hypothesis lifecycle in oha.md is well-specified but was treated as optional.

**Recommendation**: Make hypotheses a required output. The OHA contract should have:
```
ensures:
  - At least 1 hypothesis must be created with status "open" or resolved to "confirmed"/"refuted"
  - Return will be rejected (by the coordinator) if hypotheses is empty
```

This gives level-solver a mechanical check: if OHA returns with empty hypotheses, something went wrong.

### 5.6 Programs should be shorter and more hierarchical

Currently each program is a flat document. The agent reads it once at the beginning and then gradually forgets it as context fills with game observations. Key contracts get buried under capabilities and invariants.

**Recommendation**: Put the most critical information first and make it concise:
1. Shape + prohibited (2 lines)
2. First-iteration contract (5 lines of actual code to execute)
3. Delegation loop (10 lines of code)
4. Brief format (5 lines)
5. Everything else (capabilities, invariants, hypothesis lifecycle)

### 5.7 Missing constructs in LANGUAGE.md

Two constructs would have helped:

1. **`execute:` blocks** -- code that the agent must execute literally (not illustrative). The current language distinguishes "illustrative" code from "interface" contracts, but there is no construct for "this is actual code, run it." The delegation pattern is illustrative, which means the agent feels free to deviate.

2. **`guard:` clauses** -- pre-delegation checks that must pass. For example:
```
guard before rlm(app: "oha"):
  assert __levelState.current_strategy is set
  assert __levelState.world.grid_dimensions is populated
  assert brief does not contain action numbers or color values
```
These guards would be declarative assertions the agent checks before delegating.

---

## 6. Illustrative Code Analysis

### Did the agent follow the delegation pattern code?

**Partially.** The agent followed the structural shape (start game, create knowledge, loop through levels, delegate, curate) but deviated on every detail:

| Delegation Pattern Element | Followed? | What Actually Happened |
|---------------------------|-----------|----------------------|
| `arc3.start()` | Yes | Called in first code block |
| Initialize `__gameKnowledge` | Yes | Initialized with correct schema |
| Composition decision logic | No | Skipped entirely; always chose "direct" |
| Brief constructed from state | No | Brief contained frame analysis |
| `__levelState` initialization | Partially | Created but with non-schema fields |
| `await rlm(brief, ...)` | Yes | Delegated (though to wrong target) |
| Curation after delegation | Partially | Ad hoc rather than structured |
| `return(arc3.getScore())` | Yes | Called at the end |

### Is the balance between illustrative code and declarative contracts right?

**The balance is currently wrong.** The problem is that both the delegation pattern (illustrative code) and the brief format (interface contract) are presented in the same visual style. The agent treats both as suggestions.

The delegation pattern should either be:
1. **Mandatory first-iteration code** (marked differently from illustrative code)
2. **Or removed entirely** and replaced with tighter contracts

The brief format contract is strong on paper but unenforceable. The program says "Brief NEVER contains: action instructions" but the model writes them anyway because it has action-level knowledge from its own frame analysis.

**The root cause is that the game-solver.md tells the agent "You do NOT analyze the game frame" but then gives it access to `arc3.observe()`.** If the agent can see the frame, it will analyze it. The `api: [arc3.start, arc3.observe, arc3.getScore]` grants observe access for the purpose of checking game state (levels_completed, state), but the agent inevitably reads the frame data too.

**Recommendation**: Consider whether game-solver needs `arc3.observe()` at all. It could check game state via the child's return value and `__levelState` updates. If it must observe, the brief construction code should be isolated from observation code.

---

## 7. Summary of Key Findings

### What went right
1. The OHA agent eventually figured out the push-block mechanic and completed level 0
2. The state schema (`&GameKnowledge`, `&LevelState`) was instantiated correctly
3. Knowledge curation happened (partially) between delegations
4. The child agent wrote structured `key_findings` to `__levelState`

### What went wrong
1. Root agent collapsed into direct play, violating `prohibited: [arc3.step]` (13+ direct actions)
2. Level-solver was never used -- all composition was "direct"
3. Every brief was contaminated with frame analysis and tactical advice
4. Hypothesis lifecycle was completely ignored (empty `{}` throughout)
5. 89 actions on level 0 (human baseline: 29) -- 3x over budget
6. 245 actions on level 1 with no completion (human baseline: 41)
7. Only 1 of 7 levels completed

### Root causes (in priority order)
1. **Collapse at the orchestrator level**: The root agent started playing instead of composing
2. **Brief contamination**: Once the root analyzed the frame, contamination was inevitable
3. **Composition vocabulary treated as optional**: The agent never applied the decision framework
4. **No enforcement mechanism**: `prohibited` is advisory, not enforced by the engine
5. **Program density**: Too many constructs (capabilities, invariants, lifecycle) for the agent to follow under task pressure

### Highest-value changes
1. Make the delegation pattern in game-solver.md a mandatory first-iteration execution, not illustrative code
2. Isolate brief construction from frame analysis (function that takes only `__gameKnowledge`)
3. Make level-solver the default delegation target for discovery levels
4. Reduce oha.md to core essentials: OHA cycle + top 3 invariants
5. Add a `guard:` or `execute:` construct to LANGUAGE.md for non-optional code
