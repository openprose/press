---
name: contrastive-probe
kind: program-node
role: coordinator
version: 0.1.0
slots: [measurement, ranker]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Contrastive Probe

A meta-composite. Run any read-only measurement on two candidate artifacts, then rank which scores better on the measured dimension.

## Shape

```
shape:
  self: [run the same measurement composite on candidate A and candidate B, delegate ranking]
  delegates:
    measurement: [any read-only measurement composite — blind-review, stochastic-probe, assumption-miner, etc.]
    ranker: [given two diagnostic profiles, determine which candidate is superior on the measured dimension]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      measurement: string       -- component name for the measurement composite to use
      ranker: string            -- component name for the ranker
      candidate_a: object       -- compositeState config for measuring candidate A (passed to measurement composite)
      candidate_b: object       -- compositeState config for measuring candidate B (passed to measurement composite)
      label_a: string           -- (optional, default "Candidate A")
      label_b: string           -- (optional, default "Candidate B")
      dimension: string         -- what is being compared (e.g. "clarity", "determinism", "assumption count")

ensures:
  - The same measurement composite runs independently on both candidates
  - Candidates are measured in isolation — the measurement of A does not influence B
  - Ranker receives both diagnostic profiles and the dimension to judge
  - Ranker determines:
    - Which candidate scores better on the specified dimension
    - By how much (qualitative magnitude: marginal, clear, decisive)
    - What specifically makes one better than the other
  - &compositeState.result contains the ranker's verdict
  - &compositeState.profile_a contains candidate A's measurement result
  - &compositeState.profile_b contains candidate B's measurement result
```

## Delegation Loop

```javascript
const {
  measurement, ranker,
  candidate_a, candidate_b,
  label_a = "Candidate A", label_b = "Candidate B",
  dimension
} = __compositeState;

// Run measurement on candidate A
const profileA = await rlm(null, null, {
  use: measurement,
  compositeState: candidate_a
});

// Run measurement on candidate B
const profileB = await rlm(null, null, {
  use: measurement,
  compositeState: candidate_b
});

// Ranker compares
const rankerBrief = `Two candidates were measured on the same dimension using the same diagnostic instrument.

Dimension: ${dimension}

=== ${label_a.toUpperCase()} — Diagnostic Profile ===
${JSON.stringify(profileA, null, 2)}

=== ${label_b.toUpperCase()} — Diagnostic Profile ===
${JSON.stringify(profileB, null, 2)}

Determine:
1. Which candidate scores BETTER on "${dimension}"?
2. By how much? (marginal / clear / decisive)
3. What specifically makes one better? (cite evidence from the profiles)
4. Are there sub-dimensions where the losing candidate is actually superior?`;

const verdict = await rlm(rankerBrief, null, { use: ranker });

__compositeState.result = verdict;
__compositeState.profile_a = profileA;
__compositeState.profile_b = profileB;
return(verdict);
```

## Notes

This is a seed pattern and a meta-composite — it composes over other measurement composites rather than implementing its own measurement logic. The ranker does not know it is part of a contrastive probe. The measurement composite does not know it is being used comparatively.

The value is in making qualitative comparisons empirical. "Which of these two prompts is clearer?" is a subjective question. "Which of these two prompts produces a higher cross-tier agreement score on blind-review?" is a measurable one. Contrastive probe turns any measurement composite into a comparator, enabling:

- **Prompt A/B testing**: which prompt is more deterministic (via stochastic-probe)?
- **Documentation quality comparison**: which version is clearer (via blind-review)?
- **API surface ranking**: which interface has fewer hidden assumptions (via assumption-miner)?
- **Vendor evaluation**: which provider's documentation drifts less from their actual API behavior (via synchronization-probe)?

The meta-composite pattern also means new measurement composites automatically become available as contrastive dimensions without any additional work.
