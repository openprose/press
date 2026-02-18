# RLM Programming Language

A declarative language for programming recursive language model networks. Programs are structured prose — readable by both humans and LLMs — that declare contracts, state schemas, and delegation patterns. The model decides how to satisfy them.

## Core Principles

### 1. Declare Contracts, Not Procedures

Programs specify postconditions (`ensures`) and preconditions (`requires`), not step-by-step instructions. A better model satisfies the same contract more efficiently — no code changes needed.

```
ensures:
  - &Knowledge grows after every delegation (never lose confirmed findings)
  - If a task fails twice: the retry MUST differ from prior attempts
```

### 2. State as Interface

Agents communicate through typed state schemas. The schema IS the interface — if two agents agree on the shape, they can interoperate regardless of how they're implemented internally.

```
LevelState {
  actions_taken: number
  world: { player: { position: [r, c] }, objects: { ... }, ... }
  hypotheses: { [id]: { claim: string, confidence: 0..1, status: "open" | "confirmed" | "refuted" } }
}
```

### 3. Goals Over Steps

Tell the agent what to achieve, not how to achieve it. Strategies are declared as options with trigger conditions — the agent selects among them based on current state.

```
strategies:
  "explore"      when: environment coverage < 30%
  "test"         when: open hypotheses have untested predictions
  "execute_plan" when: goal conditions appear satisfied
  "investigate"  when: goal was reached but task did not complete
```

### 4. Model-Upgrade-Proof

Every construct is designed so that a more capable model executes the same program better. Contracts tighten naturally. Illustrative code gets rewritten. Strategy selection improves. Nothing in the language bets against the model getting smarter.

### 5. Hypotheses Are First-Class

In exploratory domains, beliefs about the world are structured objects with confidence, evidence, and lifecycle — not free-text notes. This enables falsification, promotion, and demotion as formal operations.

```
lifecycle:
  propose(claim, evidence)  -> confidence 0.3, status "open"
  update(hypothesis, obs)   -> adjust confidence ±0.2/0.3
  confirm(hypothesis)       -> confidence >= 0.8
  refute(hypothesis)        -> confidence <= 0.1
  falsify(hypothesis)       -> actively seek counter-evidence
```

### 6. Composable Primitives

Complex behavior emerges from a small set of reusable node types. A 3-tier game solver is three nodes composed — not a monolith. Each node has a single role, a clear contract, and declared state dependencies.

### 7. Minimal Syntax, Maximum Intent

The language has almost no syntax. It's structured markdown with a few conventions. If a human can read it and know what to build, so can a model.

### 8. Discover, Don't Prescribe

Programs teach the agent HOW TO LEARN, not WHAT TO LEARN. Domain-specific knowledge (game mechanics, API behavior, environmental rules) is discovered through interaction and recorded in state — never hardcoded in the program. The program provides the epistemological framework; the agent fills it with empirical content.

---

## Syntax Reference

### Program File

The composition root. Declares shared state and how nodes connect.

```yaml
---
name: arc3-solver
kind: program
version: 0.3.0
description: Solve ARC-3 interactive grid games through observation, hypothesis, and action
nodes: [game-solver, level-solver, oha]
---
```

### Program Node

A single agent in the network. Has a role, state dependencies, and a contract.

The frontmatter is part of the program — it is included in the agent's system prompt, not stripped. The agent sees its own role, delegation targets, API access, and prohibitions at the top of its instructions.

```yaml
---
name: arc3-level-solver
kind: program-node
role: coordinator          # orchestrator | coordinator | leaf
version: 0.4.0
delegates: [oha]           # child app names this node delegates to
prohibited: [arc3.step]    # sandbox APIs this node must NOT call
state:
  reads: [&GameKnowledge, &LevelState]
  writes: [&LevelState]
api: [arc3.observe]         # sandbox APIs this node may call
---
```

`api` lists what the node CAN use. `prohibited` lists what it MUST NOT use. `delegates` lists who handles the prohibited capabilities. These three fields together define the node's boundary.

### The `&` Prefix — Pass by Reference

State prefixed with `&` lives in the sandbox as a `__camelCase` variable. All agents in the delegation tree read and write it directly — no serialization into prompts or return values.

| Declaration | Sandbox Variable | Meaning |
|---|---|---|
| `&GameKnowledge` | `__gameKnowledge` | Shared via sandbox. Read/write directly. |
| `LevelSummary` | *(in prompt or return)* | Passed by value. Serialized into text. |

**Use `&` when:** The state is medium-to-large and would pollute context if serialized into every prompt and return value. Multiple agents need to read or write it. It accumulates over time.

**Omit `&` when:** The state is small (a number, a short string, a flag). It only flows in one direction (parent→child in the prompt, or child→parent in the return value).

```
state:
  reads: [&GameKnowledge, &LevelState]   # by reference — read from sandbox
  writes: [&LevelState]                  # by reference — write to sandbox

# In delegation patterns:
delegate LevelSolver {
  goal: "Complete level {n}. {knowledge_brief}"
  &GameKnowledge   -- child reads __gameKnowledge directly
  &LevelState      -- child reads/writes __levelState directly
}
```

### Contracts

Preconditions (`requires`) and postconditions (`ensures`). The agent must satisfy all of them.

```
requires:
  - &GameKnowledge exists at __gameKnowledge
  - &LevelState exists at __levelState (level, attempt, action_budget populated)

ensures:
  - &LevelState.world is initialized before any delegation
  - If 3 consecutive cycles produce no observable change: change strategy
  - Hypotheses that were tested are marked confirmed or refuted (never left "open" forever)
  - Return value is a summary string: "{completed|failed}: {key_insight}"
```

### State Schemas

Typed data structures shared between agents. Field names are self-documenting. Comments use `--`. Schemas are templates — fields are populated through observation, not assumed to exist.

```
Knowledge {
  confirmed_mechanics: {
    [name]: {
      description: string
      confidence: 0..1        -- 0 = refuted, 1 = certain
      evidence: string[]
      first_seen: level
    }
  }
  open_questions: string[]    -- things to investigate next
  refuted_beliefs: string[]   -- things that turned out wrong
}
```

### Delegation Patterns

Describe the control flow between agents. Use `&` to mark shared state.

```
for each level:
  __levelState = { level: n, attempt: k, actions_taken: 0, action_budget: 40 }

  result = delegate LevelSolver {
    goal: "Complete level {n}. {knowledge_brief}"
    &GameKnowledge
    &LevelState
  }

  curate(&GameKnowledge, &LevelState)

  if &LevelState.completed:
    proceed
  else if attempts < 2:
    retry with enriched brief (must differ from prior attempt)
  else:
    record failure, move on
```

### `given:` Blocks

Declarative transformations. State in, state out. The model implements the logic.

```
given: &LevelState (written by child)

  promote: hypotheses with confidence >= 0.8 -> confirmed_mechanics
  record: new object types -> object_catalog
  preserve: open questions that were NOT answered
  demote: beliefs that child evidence contradicts -> refuted_beliefs
  extract: the key insight ("what worked?" or "what was missing?")
```

### Strategies

Prioritized options with trigger conditions. The agent selects based on current state.

```
strategies (in priority order):

  1. "orient"
     when: actions_taken == 0
     goal: learn basic controls and perceptual structure

  2. "explore"
     when: environment coverage < 30% OR unidentified objects exist
     goal: map the environment, find interactable objects

  3. "test_hypothesis"
     when: open hypotheses have untested predictions
     goal: test the highest-value hypothesis

  4. "execute_plan"
     when: goal conditions appear satisfied
     goal: navigate to goal, complete the task

  5. "investigate"
     when: goal was reached but task did not complete
     goal: discover what preconditions were not met

  6. "retreat"
     when: resources critically low
     goal: attempt completion with current state
```

### Shape

Declares the node's execution boundary: what it does directly, what it delegates, and what sandbox APIs it must not call. Without explicit shape declarations, models take the path of least resistance — calling sandbox APIs directly instead of delegating to children.

```
shape:
  self: [select strategy, evaluate progress, curate findings]
  delegates:
    oha: [game actions, frame analysis, hypothesis testing]
  prohibited: [arc3.step]
```

`prohibited` names sandbox APIs that exist and are callable but that this node must not use. `delegates` maps child app names to the capabilities they own. Together, these establish a hard boundary: "this work belongs to my children, not to me."

Why this matters: LLMs gravitate toward the simplest path. If a coordinator node can see `arc3.step()` in the sandbox, it will call it directly rather than composing a delegation via `rlm()`. `prohibited` makes the boundary explicit — the model sees "I can call this, but my program forbids it."

Frontmatter shorthand (visible to the agent when program nodes include frontmatter):

```yaml
delegates: [oha]
prohibited: [arc3.step]
```

### Invariants

Constraints that must hold at all times, not just at boundaries.

```
invariants:
  - POSITION TRACKING: Track position by movement delta, not by visual scan
      (visual scan produces false positives when multiple objects share colors)
  - RESOURCE MONITORING: Track resource consumption after every action
  - NO BLIND ACTIONS: Every action must be preceded and followed by observation
```

### Capabilities

Declare WHAT a utility function must do — inputs, outputs, invariants — not HOW. The model builds the implementation. Include a `verify` clause: a set of concrete assertions the model can (and should) run after implementing the function, to confirm correctness.

```
capability: shortestPath(map, start, goal) -> path | null

  requires:
    - map: { [key]: "passable" | "blocked" | "unknown" }
    - start and goal are keys in map

  ensures:
    - if a path through non-blocked cells exists: returns it
    - if no path exists: returns null
    - returned path has minimum length among all valid paths

  verify:
    - path[0] == start AND path[last] == goal
    - every cell in path: map[cell] != "blocked"
    - consecutive cells differ by exactly 1 in exactly one coordinate
    - path contains no duplicates
```

The `verify` clause is executable: the agent should write assertions that check these conditions after implementing the function. A capability whose implementation passes all `verify` checks is correct. A capability that fails a check must be fixed before proceeding.

Capabilities are NOT provided implementations. They are specifications. The model writes the code. A better model writes better code. But any correct implementation must pass the verify checks.

```
capability: diffFrames(before, after) -> diff

  requires:
    - before, after: number[][] of same dimensions

  ensures:
    - identifies all cells where before[r][c] != after[r][c]
    - computes the displacement of the player entity (if any)
    - detects objects that appeared or disappeared

  verify:
    - every entry in diff.changed_cells: before[r][c] != after[r][c]
    - no cell where before[r][c] != after[r][c] is missing from diff.changed_cells
    - diff.player_delta matches the actual displacement of the player cluster
```

### Composition

How the nodes connect. Shows state flow direction with `&`.

```
GameSolver
  writes &GameKnowledge (once, at init)
  for each level:
    writes &LevelState (fresh per attempt)
    delegates -> LevelSolver
    reads &LevelState after return
    curates &GameKnowledge from &LevelState

LevelSolver
  reads &GameKnowledge for prior knowledge
  reads/writes &LevelState
  loop:
    delegates -> OHA
    reads &LevelState after return

OHA
  reads/writes &LevelState
  one cycle: Observe → Hypothesize → Act (multi-step) → Observe → Record
```

---

## File Structure

Programs live in `plugins/programs/{name}/`:

```
plugins/programs/arc3/
  program.md           # composition root — state schemas, node list, data flow
  game-solver.md       # orchestrator node
  level-solver.md      # coordinator node
  oha.md               # leaf node (ObserveHypothesizeAct)
```

Each file is a standalone markdown document with YAML frontmatter. For program nodes, the frontmatter is part of the program spec — it declares the node's identity, delegation targets, API access, and prohibitions. The loader includes frontmatter in the agent's system prompt so the agent sees its own boundary constraints. The body contains contracts, schemas, patterns, and illustrative code that the model may improve upon.
