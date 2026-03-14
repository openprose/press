# Backpressure: Deferred Components

Components from the BACKPRESSURE.md design that we defer until the core judge (PLAN.md Steps 0-3) is working and producing actionable signal. Each is a real capability, but building it before the foundation is validated would be premature.

## Multi-polar specialist judges

The full BACKPRESSURE.md architecture has 5 specialist nodes:

```
programs/judge/
  evaluator.md         -- orchestrator
  shape-judge.md       -- shape adherence analysis
  delegation-judge.md  -- delegation discipline analysis
  contract-judge.md    -- contract satisfaction analysis
  meta-critic.md       -- spec critique + vocabulary evolution
```

**Why defer:** The single-node evaluator in Step 2 may be sufficient. Multi-polarity adds value when the monologue rationalizes -- we need evidence of rationalization before adding structural tension. The "Multi-Polarity Over Monologue" tenet says the minimum viable polarity is 2, not 5.

**When to build:** When Step 3 reveals the single evaluator consistently missing things a human catches, or producing internally contradictory assessments it doesn't flag.

## Level 2: Spec critique (the meta-critic)

The meta-critic looks beyond "did the model follow the program" to "should the program have been different." It asks:
- Is the `prohibited` construct sufficient?
- Are composition principles too abstract?
- Is the system prompt making the program legible enough?
- Are there recurring deviation patterns that suggest a missing language construct?

**Why defer:** This requires the judge to reason about the language itself, not just program adherence. It's the most ambitious component and the hardest to validate. The core judge needs to work first.

**When to build:** When we have enough adherence reports to see recurring patterns that aren't explained by program quality alone.

## Stdlib usage assessment

Evaluate whether programs use stdlib components effectively, and whether unused stdlib components would have helped.

**Why defer:** The stdlib isn't wired into the engine yet. No agent currently knows about stdlib components. Assessing usage of something that isn't available is hypothetical.

**When to build:** After stdlib is wired into the loading pipeline and agents can actually discover and use stdlib components.

## Vocabulary evolution / novel pattern detection

The judge's deepest long-term function: detect recurring behavioral patterns across traces, name them, promote successful ones to the stdlib, demote failures.

**Why defer:** Requires aggregation across many runs, not single-run analysis. The AdherenceReport schema deliberately excludes vocabulary observations because pattern detection happens in post-processing over many reports, not within one.

**When to build:** After we have 20+ adherence reports and can look for recurring `primary_factor` values and structural patterns.

## Cross-run comparison and `--compare-models`

Compare adherence across models (hold program constant, change model) or across program versions (hold model constant, change program).

```bash
npx tsx eval/judge.ts --results-dir eval/results/ --program arc3 --compare-models
```

**Why defer:** Requires multiple judge reports to compare. The comparison logic is straightforward once individual reports exist.

**When to build:** After Step 3, when we have reports from multiple runs to compare.

## Diagnosis section (Tier 3 open judgment)

The schema's `Diagnosis` section: `primary_factor`, `contributing_factors`, `program_changes`, `language_observations`. This requires the judge to synthesize across all other sections and reason about causality.

**Why defer:** Open-ended causal reasoning is the noisiest form of LLM judgment. We need to trust the Tier 1 and Tier 2 sections first. If those produce useful signal, the Diagnosis section adds a synthesis layer. If they don't, Diagnosis will be noise built on noise.

**When to build:** When the Tier 2 fields (brief adherence, curation, contracts) are producing consistent, actionable findings.

## CompositionAdherence section

Assess whether the model's composition decisions match the program's vocabulary: did it choose `direct` vs `coordinated` appropriately given budget, depth headroom, and knowledge state?

**Why defer:** Requires the judge to read sandbox snapshots, infer state conditions, and evaluate composition choices against the vocabulary. This is Tier 3 judgment -- the most expensive and least validated.

**When to build:** When we have evidence that composition decisions are a significant source of adherence failures (from the Step 3 learning loop).

## Viewer integration

Render adherence annotations on the eval viewer's event timeline (`eval/viewer.html`).

**Why defer:** The viewer needs adherence reports to render. Build the reports first.

**When to build:** After Step 2 produces stable JSON output.
