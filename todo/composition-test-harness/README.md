# Composition Test Harness

A test harness for composition concepts — implemented as an RLM program itself.

Supersedes the earlier sketch in `../composition-unit-tests/README.md`, which described vitest-based prompt-level tests. This design goes further: the harness is a multi-agent RLM program that runs scenarios, distills trajectories, and judges outcomes. It dogfoods the system it tests.

## Why an RLM Program?

A composition test needs to evaluate whether an agent makes the right structural decision. That evaluation requires:

1. **Running the agent** in a realistic prompt environment (system prompt + globalDocs + scenario state)
2. **Observing** the composition decision it makes (which app, which brief style, what state initialization)
3. **Judging** the decision against expectations

Steps 1-3 are exactly what RLM does: run code, observe output, reason about it. The test harness is a natural RLM program — an orchestrator that delegates scenario execution to a child, then judges the result.

## Program Structure

```
plugins/programs/composition-test/
  root.md              # Component catalog, shared state, scoring rubric
  harness.md           # Orchestrator: loads scenarios, delegates, judges
  scenario-runner.md   # Leaf: executes one scenario, returns composition decision
```

### root.md (globalDocs)

Contains:
- **Scenario schema**: the shape of a test scenario (input state, expected composition, anti-patterns)
- **Judgment rubric**: how to score a composition decision (correct topology? correct brief style? satisfies requires?)
- **Shared state**: `&TestResults` accumulator

Does NOT contain:
- The ARC-3 component catalog. Each scenario carries its own catalog excerpt as part of its input. This lets the harness test composition against arbitrary catalogs, not just the current ARC-3 one.

### harness.md (orchestrator)

```
role: orchestrator
delegates: [scenario-runner]

shape:
  self: [load scenarios, aggregate results, compute pass/fail]
  delegates:
    scenario-runner: [execute one scenario, return composition decision]
```

The orchestrator:
1. Reads scenarios from `context` (passed by the eval harness)
2. For each scenario: initializes `&ScenarioState`, delegates to scenario-runner
3. After each delegation: judges the result against expectations
4. Aggregates pass/fail/partial scores
5. Returns a summary: `{ passed: N, failed: N, partial: N, details: [...] }`

### scenario-runner.md (leaf)

```
role: leaf
delegates: []

shape:
  self: [read scenario input, reason about composition, return decision]
```

The scenario-runner receives:
- A component catalog excerpt (the available components for this scenario)
- Current state conditions (budget, depth, knowledge, retry context)
- A goal description

It returns a structured composition decision:
```
{
  topology: "direct" | "coordinated",
  brief_style: "exploratory" | "targeted",
  target_app: string,
  reasoning: string,
  state_initialization: string[]  // what requires the runner would satisfy
}
```

The scenario-runner does NOT actually run the composed agent. It only reasons about what composition it would choose. This is the key simplification — we test the decision, not the execution.

## Scenario Format

```typescript
interface CompositionScenario {
  id: string;
  name: string;
  description: string;

  // What the agent sees
  catalog: string;           // Component catalog excerpt (markdown)
  state: {
    depth: number;
    maxDepth: number;
    budget_remaining: number;
    knowledge: Record<string, unknown>;  // &GameKnowledge-like state
    retry_count: number;
    prior_attempts?: Array<{
      composition_used: string;
      result: string;
      structural_issues?: string[];
    }>;
  };
  goal: string;

  // What we expect
  expected: {
    topology: "direct" | "coordinated" | "either";
    brief_style: "exploratory" | "targeted" | "either";
    target_app?: string;
    must_satisfy_requires?: string[];  // state init the agent must do
    anti_patterns?: string[];          // descriptions of wrong choices
  };
}
```

## Example Scenarios

### 1. First encounter, full budget
```yaml
id: first-encounter
state:
  depth: 0, maxDepth: 3, budget_remaining: 40
  knowledge: {}
  retry_count: 0
goal: "Complete level 0"
expected:
  topology: coordinated
  brief_style: exploratory
  anti_patterns:
    - "Direct to leaf with no coordinator (discovery needs strategy cycling)"
    - "Targeted brief (no prior knowledge to draw from)"
```

### 2. Known mechanics, thin budget
```yaml
id: known-thin-budget
state:
  depth: 1, maxDepth: 3, budget_remaining: 12
  knowledge: { movement: confirmed, maze: confirmed, fuel: confirmed }
  retry_count: 0
goal: "Complete level 5"
expected:
  topology: direct
  brief_style: targeted
  must_satisfy_requires: ["world initialization", "strategy selection"]
  anti_patterns:
    - "Coordinated composition (overhead exceeds budget value)"
    - "Exploratory brief (confirmed knowledge exists, should use it)"
```

### 3. Retry after shape violation
```yaml
id: retry-shape-violation
state:
  depth: 0, maxDepth: 3, budget_remaining: 25
  knowledge: { movement: confirmed }
  retry_count: 1
  prior_attempts:
    - composition_used: "coordinated"
      result: "failed"
      structural_issues: ["coordinator called arc3.step directly (shape violation)"]
goal: "Complete level 2 (retry)"
expected:
  topology: direct  # or coordinated — but must differ from prior
  brief_style: targeted
  anti_patterns:
    - "Same composition as the failed attempt"
```

### 4. Depth-limited
```yaml
id: depth-limited
state:
  depth: 2, maxDepth: 3, budget_remaining: 30
  knowledge: {}
  retry_count: 0
goal: "Complete level 0"
expected:
  topology: direct  # only 1 level of depth headroom
  brief_style: exploratory
  anti_patterns:
    - "Coordinated (requires 2 levels of depth headroom)"
```

### 5. Catalog with missing coordinator
```yaml
id: no-coordinator-available
catalog: |
  ### oha
    role: leaf
    requires from caller: world initialized, strategy set
    produces for caller: updated world state, hypothesis updates
    does NOT produce: key_findings extraction
state:
  depth: 0, maxDepth: 2, budget_remaining: 40
  knowledge: {}
  retry_count: 0
goal: "Complete level 0"
expected:
  topology: direct  # no coordinator exists in catalog
  must_satisfy_requires: ["world initialization", "strategy selection", "key_findings extraction"]
  anti_patterns:
    - "Attempt to delegate to a component not in the catalog"
```

## Judgment

The harness judges each scenario on 4 axes:

1. **Topology correctness**: Did the agent pick the right topology (direct/coordinated)?
2. **Brief style correctness**: Did the agent pick the right brief style (exploratory/targeted)?
3. **Requires satisfaction**: Did the agent identify what state it must initialize?
4. **Anti-pattern avoidance**: Did the agent avoid named anti-patterns?

Scoring:
- Each axis: 1.0 (correct), 0.5 (partially correct / reasonable alternative), 0.0 (anti-pattern hit)
- Scenario score: average of applicable axes
- Suite score: average of scenario scores

A "partially correct" judgment requires reasoning — the harness orchestrator uses its own LLM capability to evaluate whether a non-exact-match answer is reasonable. This is where it dogfoods: the orchestrator is itself an RLM making judgment calls.

## What This Tests vs. Doesn't

### Tests
- Whether the composition vocabulary is learnable from globalDocs alone
- Whether budget/depth/knowledge conditions trigger the right composition style
- Whether retry context changes composition decisions
- Whether missing components are handled (inherit responsibilities)
- Whether the agent's reasoning references the right principles

### Does NOT Test
- Whether composed agents actually execute well (that's what full evals test)
- Whether briefs constructed from state are high-quality
- Whether curation after delegation preserves knowledge
- Whether the judge itself is well-calibrated (bootstrap problem)

## Running It

```bash
# Run composition test suite
npx tsx eval/run.ts --benchmark composition-test \
  --model anthropic/claude-sonnet-4-5-20250929 \
  --max-iterations 15 --max-depth 2 --max-tasks 1 \
  --program composition-test

# Or run a single scenario
npx tsx eval/run.ts --benchmark composition-test \
  --scenario first-encounter \
  --model anthropic/claude-sonnet-4-5-20250929 \
  --max-iterations 10 --max-depth 2 --max-tasks 1 \
  --program composition-test
```

Cost estimate: ~$0.10-0.30 per scenario with Sonnet, ~$0.50-1.00 with Opus. A full suite of 10-20 scenarios: $1-5 (vs $5-10 for a single ARC-3 eval).

## The Dogfooding Insight

This harness is itself a composition test. The harness orchestrator must:
- Compose its subtree (delegate to scenario-runner)
- Curate results after each delegation
- Judge quality using LLM reasoning

If the harness fails to compose correctly, we learn something about composition — from the harness itself. The test and the system under test share the same substrate.

This also means the harness's root.md exercises the same constructs it tests: component catalog, composition vocabulary, contracts. Writing the harness is itself a test of whether LANGUAGE.md is expressive enough for non-game domains.

## Deferred Decisions

- **Scenario storage format**: YAML files? JSON? Inline in root.md context? TBD based on how the eval harness loads benchmark data.
- **Baseline calibration**: Before trusting judgment scores, run each scenario manually and compare. The judge needs calibration data.
- **Cheap-model testing**: Can Haiku/Flash make reasonable composition decisions from globalDocs? If yes, composition tests become very cheap. If no, that's itself a signal about the learnability of composition principles.
- **Regression tracking**: Store scores across program versions to detect when changes to root.md or LANGUAGE.md degrade composition quality.

## Relationship to Other Todo Items

- `../composition-unit-tests/`: Earlier sketch, narrower scope (vitest prompt tests). This design subsumes it.
- `../outer-loop-self-improvement/`: The harness could feed into a self-improvement loop — run composition tests, identify weak scenarios, adjust principles, re-run. That's future work.
- `../delegation-reform/`: The depth-aware prompts work (now implemented in system-prompt.ts) was a prerequisite for this harness to be meaningful.
