# The Standard Library

A collection of reusable program components for composing multi-agent systems. Three categories: composites (multi-agent structural patterns), roles (single-agent behaviors), and controls (delegation flow patterns). Seventeen components total, expressed as prose `.md` files in `lib/`.

These are program nodes, not engine primitives. They live alongside programs, not inside the runtime. The engine does not know they exist. A program author references them; the model reads them and self-configures.

## Why a Standard Library

The stdlib is a library for **program authors** -- humans writing `root.md` files who need to compose agents into structures. It is not a runtime framework. It provides no APIs. It adds no engine complexity. It is markdown that gets injected into system prompts when a program references a component.

Three observations motivate it:

**Patterns recur.** Every program that needs quality assurance ends up building some version of work-then-critique. Every program that needs robust observation builds something like independent witnesses. These are structural patterns -- they describe how agents relate, not what agents do. Crystallizing them into reusable nodes means a program author does not reinvent the same topology each time.

**Multi-polarity needs structure.** The tenet "tension is structural error correction" (TENETS.md) says that a single agent rationalizes its own mistakes, and that two or three agents with distinct roles catch errors through adversarial tension. But multi-polarity is not "add more agents." It requires specific structural relationships: the critic must not see the worker's self-assessment, the observer must be independent of the actor, the ratchet must be unable to roll back certified progress. Composites encode these relationships as concrete, slottable patterns. The structural guarantees are in the pattern, not in the program author's discipline.

**Roles fill slots.** A composite like `worker-critic` declares two slots: `worker` and `critic`. What fills those slots? The program author might write domain-specific nodes. Or they might use a stdlib role -- the `critic` role is a single-agent behavior designed to fill the `critic` slot in any composite that needs one. Roles and composites compose: a role is a leaf, a composite is a coordinator, and together they form a small delegation subtree.

## The SFT Analogy

The stdlib is like supervised fine-tuning (SFT) for composition. SFT gives a base model a starting behavior -- hand-designed demonstrations of how to respond. RLHF then refines that behavior from feedback. The stdlib gives program authors a starting vocabulary of structural patterns -- hand-designed compositions of how agents should relate. The backpressure judge (BACKPRESSURE.md) provides the RLHF-like feedback loop.

The analogy is precise:

- **SFT patterns are a seed.** They bootstrap useful behavior, but they are not the final answer. The stdlib's 17 components are a starting vocabulary that will grow, shrink, and change as empirical traces reveal what works.
- **RLHF refines what SFT starts.** The judge analyzes execution traces, detects patterns the model discovers on its own, and promotes recurring effective patterns into the stdlib. It also retires components that consistently fail or go unused.
- **Discovery is expected.** A program author who invents an effective pattern not in the stdlib is doing the right thing. A model that discovers a structural arrangement that outperforms a named composite is doing the right thing. The stdlib is a seed, not a cage.

The long-term expectation: the hand-designed library converges toward an empirically-grounded one. Engineering intuition seeds it. Traces evolve it. The judge is the mechanism.

## Categories

### Composites (`lib/composites/`)

Multi-agent structural patterns. A composite is a coordinator node: it receives a task from a parent, manages internal multi-polar dynamics across two or three child agents, and returns a result. The composing parent calls a composite as one component. The children never know they are part of a composite.

Each composite declares **slots** -- named positions that the parent fills with component names before delegating. The composite reads its slot assignments from `&compositeState` and delegates accordingly. The structural relationships between slots (who sees whose output, what information is firewalled) are encoded in the composite's delegation logic.

Composites implement the multi-polarity tenet as concrete patterns. `worker-critic` creates tension between production and evaluation. `witness` creates tension between independent observations. `ratchet` creates tension between progress and certification. The tension is the structural error correction -- it is not a side effect, it is the point.

### Roles (`lib/roles/`)

Single-agent reusable behaviors. A role is a leaf node: it receives a brief, does one thing, and returns a structured result. Roles do not delegate.

Roles serve two purposes. They fill composite slots -- the `critic` role fills the `critic` slot in `worker-critic`, the `verifier` role fills the `ratchet` slot in `ratchet`. They also stand alone as delegation targets -- a program author who needs classification can delegate to `classifier` directly without wrapping it in a composite.

The distinction between roles is in what they evaluate and how they return:
- `critic` evaluates quality against criteria: accept/reject with reasoning
- `verifier` checks formal correctness against constraints: valid/invalid with violations
- `classifier` categorizes an item into one of a provided set
- `extractor` maps unstructured input to a target schema
- `summarizer` compresses content while preserving specified information

### Controls (`lib/controls/`)

Delegation flow patterns. A control is a coordinator that wraps other components to add iteration, parallelism, gating, or sequencing. Controls manage the flow of delegation -- they decide when, how often, and in what order to delegate to their wrapped targets.

Controls use `&controlState` (not `&compositeState`) for their slot-filling convention, reflecting that they manage flow rather than multi-polar tension.

The distinction between controls and composites: composites create structural tension between agents with different roles. Controls manage the delegation mechanics around agents that may have the same role. `worker-critic` is a composite because the worker and critic have fundamentally different jobs. `retry-with-learning` is a control because it delegates to the same target repeatedly with enriched briefs.

## How Components Are Structured

Every stdlib component is a `.md` file with YAML frontmatter. The frontmatter declares the component's identity, role, slots, and state dependencies. The body declares contracts, shape, and delegation logic -- often with illustrative JavaScript.

### Frontmatter

```yaml
---
name: worker-critic
kind: program-node
role: coordinator
version: 0.1.0
slots: [worker, critic]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---
```

`slots` lists the positions the parent must fill. `delegates` is empty because the composite does not have fixed children -- the parent decides what fills each slot at composition time. `state` declares `&compositeState` (for composites) or `&controlState` (for controls) as the communication channel with the parent.

Roles have no slots and no state dependencies:

```yaml
---
name: critic
kind: program-node
role: leaf
version: 0.1.0
delegates: []
prohibited: []
state:
  reads: []
  writes: []
---
```

### Contracts

Each component declares `requires` (what the caller must provide) and `ensures` (what the component guarantees). For composites and controls, `requires` specifies the `&compositeState` or `&controlState` shape:

```
requires:
  - &compositeState exists at __compositeState with:
      worker: string        -- component name to use as worker
      critic: string        -- component name to use as critic
      task_brief: string    -- the task to pass to the worker
      criteria: string      -- acceptance criteria for the critic
      max_retries: number   -- (optional, default 3)
```

For roles, `requires` specifies what the brief must contain:

```
requires:
  - Brief contains:
      result: the work product to evaluate
      criteria: what constitutes acceptance
      task: the original task description
```

`ensures` declares postconditions and the return shape:

```
ensures:
  - Worker receives only the task brief (first attempt) or task brief + critique (retries)
  - Critic returns { verdict: "accept" | "reject", reasoning, issues, suggestions }
  - On accept: return the worker's result immediately
  - &compositeState.result contains the final output
  - &compositeState.attempts contains the count
```

### Delegation Logic

Composites and controls include illustrative JavaScript showing how the delegation loop works. This code is a starting point -- the model may improve upon it. A better model writes better delegation logic. But the structural guarantees (information firewalls, retry semantics, slot isolation) must be preserved.

```javascript
// From worker-critic
const { worker, critic, task_brief, criteria, max_retries = 3 } = __compositeState;
let lastResult = null;
let lastCritique = null;

for (let attempt = 0; attempt < max_retries; attempt++) {
  let workerBrief = task_brief;
  if (lastCritique) {
    workerBrief += `\n\nPrevious attempt was rejected.\nCritique: ${lastCritique.reasoning}`;
  }
  lastResult = await press(workerBrief, null, { use: worker });

  const criticBrief = `Evaluate this result against the criteria.\n\nOriginal task: ${task_brief}\nCriteria: ${criteria}\n\nResult to evaluate:\n${lastResult}`;
  const verdict = await press(criticBrief, null, { use: critic });

  if (/accept/i.test(String(verdict))) {
    __compositeState.result = lastResult;
    __compositeState.attempts = attempt + 1;
    return(lastResult);
  }
  lastCritique = verdict;
}
```

## How to Use the Standard Library

### Registering components

Stdlib components become available when registered in `childComponents`. A program author can reference them in `root.md`'s component catalog alongside domain-specific nodes. The engine loads the component's `.md` file as the child's `<rlm-program>` when the parent delegates with `{ use: "worker-critic" }`.

### Setting up slots

The composing parent sets up slot assignments in `&compositeState` (or `&controlState`) before delegating. The composite reads these assignments and delegates to the named components:

```javascript
// Parent sets up the composite
__compositeState = {
  worker: "my-domain-worker",     // a program-specific component
  critic: "critic",               // the stdlib critic role
  task_brief: "Analyze this dataset and produce a summary.",
  criteria: "Summary must contain all key findings and be under 500 words.",
  max_retries: 3
};

const result = await press("Run worker-critic on this task", null, { use: "worker-critic" });
// After return: __compositeState.result has the accepted output
```

### Composing roles into composites

Roles are designed to fill composite slots. The `critic` role produces `{ verdict, reasoning, issues, suggestions }` -- exactly the shape that `worker-critic`'s critic slot expects. The `verifier` role produces `{ valid, violations, checks_passed }` -- a natural fit for `ratchet`'s certification slot when the criteria are formal constraints.

The mapping is not enforced. Any component that satisfies a slot's behavioral expectations can fill it. A domain-specific node can fill a composite slot. A role can fill a slot in a domain-specific composite. The stdlib provides defaults; the program author decides.

### Using controls

Controls wrap other delegations. The parent sets up `&controlState` with the target component and flow parameters:

```javascript
// Retry a component with failure learning
__controlState = {
  target: "level-solver",
  task_brief: "Complete level 3. Grid is 10x10, goal is in top-right.",
  max_retries: 3
};

const result = await press("Retry with learning", null, { use: "retry-with-learning" });
```

```javascript
// Gate: check preconditions before expensive delegation
__controlState = {
  guard: "classifier",
  target: "expensive-analyzer",
  task_brief: "Analyze this dataset for anomalies."
};

const result = await press("Gate check", null, { use: "gate" });
// __controlState.proceeded tells you if the guard passed
```

### Standalone roles

Roles can be used without a composite. Delegate directly when you need a single-agent behavior:

```javascript
const summary = await press(
  `Summarize this content. Preserve: key decisions, open questions.\n\n${largeContent}`,
  null,
  { use: "summarizer" }
);
```

## Adding New Components

A pattern belongs in the stdlib when it meets four criteria:

**Recurrence.** It appears across multiple programs. A pattern used in only one program is a program-local component, not a library component. When the same structural arrangement shows up in arc3, in the judge, and in a data analysis program, it is a candidate.

**Structural, not domain-specific.** It describes how agents relate (actor/observer, proposer/adversary, sequential stages), not what agents do (analyze grids, parse JSON, play games). The `worker-critic` pattern works for code review, essay writing, and data analysis because it is about the relationship between production and evaluation, not about any particular domain.

**Clear slot interfaces.** The component has named slots with documented behavioral expectations. A parent can fill the slots without reading the component's implementation -- the contract is sufficient.

**Bitter-lesson compatibility.** A better model should use the same pattern more effectively. The pattern does not bet against model improvement. `worker-critic` gets better with a better model because the worker produces better work and the critic catches subtler issues. A pattern that relies on model limitations (e.g., "the model needs 5 retries because it always fails the first time") is not a good stdlib candidate.

### The promotion path

1. A pattern appears in a program as a local component.
2. The same pattern appears in a second program.
3. The judge (BACKPRESSURE.md) detects the recurrence in traces and flags it as a candidate.
4. A human reviews, generalizes the pattern into a slot-based component, and adds it to `lib/`.
5. The original program-local components are replaced with references to the stdlib version.

The demotion path is the reverse: a component that is consistently unused or ineffective across traces gets retired.

## Catalog

### Composites

| Component | Description | Slots |
|-----------|-------------|-------|
| `worker-critic` | Work, evaluate, retry until accepted or budget exhausted | `worker`, `critic` |
| `proposer-adversary` | Propose, then attack the proposal; parent decides | `proposer`, `adversary` |
| `observer-actor-arbiter` | Act, observe independently, arbitrate next step | `actor`, `observer`, `arbiter` |
| `ensemble-synthesizer` | K agents work independently, synthesizer merges by reasoning about disagreements | `ensemble_member`, `synthesizer` |
| `dialectic` | Thesis and antithesis argue positions; disagreement is the output | `thesis`, `antithesis` |
| `witness` | Two agents independently observe same data; discrepancies flag ambiguity | `witness_a`, `witness_b` |
| `ratchet` | Advance and certify; certified progress is never rolled back | `advancer`, `ratchet` |

### Roles

| Component | Description | Natural composite slot |
|-----------|-------------|----------------------|
| `critic` | Evaluate result against criteria; accept or reject with structured reasoning | `worker-critic.critic` |
| `verifier` | Check result against formal constraints; correctness, not quality | `ratchet.ratchet` |
| `summarizer` | Compress large context preserving specified key information | Pipeline stage, curation |
| `classifier` | Categorize an item given categories and criteria | `gate.guard`, routing |
| `extractor` | Pull structured data from unstructured input given a target schema | Pipeline stage, state population |

### Controls

| Component | Description | Slots |
|-----------|-------------|-------|
| `retry-with-learning` | Retry with failure analysis passed to each subsequent attempt | `target` |
| `progressive-refinement` | Iteratively improve through rounds until quality threshold met | `refiner`, `evaluator` |
| `map-reduce` | Split input into chunks, delegate to mappers, merge with reducer | `mapper`, `reducer` |
| `pipeline` | Sequential transformation; each stage sees only predecessor's output | `stages[]` |
| `gate` | Check precondition before delegating; fail-fast | `guard`, `target` |

## File Paths

```
lib/
  composites/
    worker-critic.md
    proposer-adversary.md
    observer-actor-arbiter.md
    ensemble-synthesizer.md
    dialectic.md
    witness.md
    ratchet.md
  roles/
    critic.md
    verifier.md
    summarizer.md
    classifier.md
    extractor.md
  controls/
    retry-with-learning.md
    progressive-refinement.md
    map-reduce.md
    pipeline.md
    gate.md
```
