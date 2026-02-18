# RLM Programming Language

A declarative language for programming recursive language model networks. Programs are structured prose — readable by both humans and LLMs — that declare contracts, state schemas, and delegation patterns. The model decides how to satisfy them.

## Core Principles

### 1. Declare Contracts, Not Procedures

Programs specify postconditions (`ensures`) and preconditions (`requires`), not step-by-step instructions. A better model satisfies the same contract more efficiently — no code changes needed.

```
ensures:
  - &GameKnowledge grows after every delegation (never lose confirmed findings)
  - If a level fails twice: analyze WHY before retrying
```

### 2. State as Interface

Agents communicate through typed state schemas. The schema IS the interface — if two agents agree on the shape, they can interoperate regardless of how they're implemented internally.

```
LevelState {
  level: number
  actions_taken: number
  world: { player: { position: [r, c], pattern: number[][] }, ... }
  hypotheses: { [id]: { claim: string, confidence: 0..1, status: "open" | "confirmed" | "refuted" } }
}
```

### 3. Goals Over Steps

Tell the agent what to achieve, not how to achieve it. Strategies are declared as options with trigger conditions — the agent selects among them based on current state.

```
strategies:
  "explore"   when: maze coverage < 30%
  "solve"     when: player pattern matches goal AND gatekeeper known
  "retreat"   when: fuel < 20% OR budget < 10
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

---

## Syntax Reference

### Program File

The composition root. Declares shared state and how nodes connect.

```yaml
---
name: arc3-solver
kind: program
version: 0.2.0
description: Solve ARC-3 interactive grid games
nodes: [game-solver, level-solver, oha]
---
```

### Program Node

A single agent in the network. Has a role, state dependencies, and a contract.

```yaml
---
name: arc3-game-solver
kind: program-node
role: orchestrator          # orchestrator | coordinator | leaf
version: 0.2.0
delegates: [level-solver]
state:
  reads: [&GameKnowledge]
  writes: [&GameKnowledge, &LevelState]
api: [arc3.start, arc3.observe, arc3.getScore]
---
```

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
  goal: "Complete level {n}/7. {knowledge_brief}"
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
  - If 3 consecutive cycles produce no change: change strategy
  - Hypotheses tested are marked confirmed or refuted (never left "open" forever)
  - Return value is a summary string: "{completed|failed}: {key_insight}"
```

### State Schemas

Typed data structures shared between agents. Field names are self-documenting. Comments use `--`.

```
GameKnowledge {
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
    goal: "Complete level {n}/7. {knowledge_brief}"
    &GameKnowledge
    &LevelState
  }

  curate(&GameKnowledge, &LevelState)

  if &LevelState.completed:
    proceed to next level
  else if attempts < 2:
    retry with enriched brief
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

Prioritized options with trigger conditions and budgets. The agent selects based on current state.

```
strategies (in priority order):

  1. "orient"
     when: actions_taken == 0
     goal: identify player, parse HUD, catalog visible objects
     budget: 4 actions

  2. "explore"
     when: maze coverage < 30% OR unknown objects exist
     goal: map the environment, find interactive objects
     budget: min(15, remaining_budget / 2)

  3. "solve"
     when: player pattern matches goal AND gatekeeper known
     goal: navigate to gatekeeper
     budget: remaining actions
```

### Invariants

Constraints that must hold at all times, not just at boundaries.

```
invariants:
  - MOVEMENT TRACKING: Track position by delta, not by color scan
  - SCALE AWARENESS: Normalize patterns before comparing (HUD and player may differ in scale)
  - FUEL IS FINITE: Every action costs fuel. Monitor and factor into decisions.
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
  one atomic step: observe, hypothesize, act, diff
```

### Capabilities (Leaf Nodes)

Declare WHAT the agent must be able to do, not HOW. The model builds the implementation.

```
required capabilities:

  findPlayer(frame, lastKnownPos)
    -- Find the player by movement delta, not color.

  diffFrames(before, after)
    -- Cell-by-cell comparison. Returns changed cells and player delta.

  comparePatterns(patternA, patternB)
    -- Handle scale differences. Normalize before comparing.
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

Each file is a standalone markdown document with YAML frontmatter. The frontmatter declares metadata (name, kind, role, version, state dependencies). The body is the program — contracts, schemas, patterns, and illustrative code that the model may improve upon.
