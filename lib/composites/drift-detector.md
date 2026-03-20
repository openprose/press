---
name: drift-detector
kind: program-node
role: coordinator
version: 0.1.0
slots: [reviewer, diff_analyst]
delegates: []
prohibited: []
state:
  reads: [&compositeState]
  writes: [&compositeState]
---

# Drift Detector

Run a diagnostic measurement on two versions of the same material. Compare the diagnostic signatures. Did the edit improve clarity, introduce ambiguity, or shift complexity?

## Shape

```
shape:
  self: [run measurement on version A, run measurement on version B, delegate comparison of diagnostic profiles]
  delegates:
    reviewer: [examine material and report understanding — same as blind-review]
    diff_analyst: [compare two diagnostic profiles and classify the direction of change]
  prohibited: none
```

## Contract

```
requires:
  - &compositeState exists at __compositeState with:
      reviewer: string          -- component name for reviewers
      diff_analyst: string      -- component name for the diff analyst
      version_a: string         -- the earlier version of the material
      version_b: string         -- the later version of the material
      label_a: string           -- (optional, default "Before") label for version A
      label_b: string           -- (optional, default "After") label for version B
      tiers: object[]           -- reviewer configurations (same as blind-review)
      task_brief: string        -- what reviewers should focus on

ensures:
  - Version A and Version B each undergo an independent blind-review
  - Reviewers of version A never see version B, and vice versa
  - Diff analyst receives both diagnostic profiles and classifies the change:
    - Clarified: ambiguity decreased (cross-tier agreement increased)
    - Obscured: ambiguity increased (cross-tier agreement decreased)
    - Simplified: complexity decreased (lower tiers now understand what only higher tiers did before)
    - Complicated: complexity increased (understanding moved to higher tiers only)
    - Neutral: diagnostic signature unchanged despite surface edits
  - Analysis is per-section where possible — an edit can clarify one section while obscuring another
  - &compositeState.result contains the diff analyst's change classification
  - &compositeState.profile_a contains the version A diagnostic profile
  - &compositeState.profile_b contains the version B diagnostic profile
```

## Delegation Loop

```javascript
const {
  reviewer, diff_analyst, version_a, version_b,
  label_a = "Before", label_b = "After",
  tiers, task_brief
} = __compositeState;

// Helper: run a blind-review-style measurement on one version
async function measureVersion(version, label) {
  const roster = [];
  for (const tier of tiers) {
    for (let i = 0; i < (tier.count || 1); i++) {
      roster.push({ id: `${tier.model}-${i + 1}`, model: tier.model });
    }
  }

  const reviews = {};
  for (const agent of roster) {
    const brief = `${task_brief}\n\nExamine the following material. Report your understanding as specifically as possible.\n\n${version}`;
    const report = await rlm(brief, null, { use: reviewer, model: agent.model });
    reviews[agent.id] = { model: agent.model, report };
  }

  return { label, roster, reviews };
}

// Measure both versions independently
const profileA = await measureVersion(version_a, label_a);
const profileB = await measureVersion(version_b, label_b);

// Diff analyst compares diagnostic signatures
const diffBrief = `Two versions of the same material ("${label_a}" and "${label_b}") were independently reviewed by agents across ${tiers.length} capability tiers. Compare the diagnostic profiles to determine what changed.

=== ${label_a.toUpperCase()} — Diagnostic Profile ===
${tiers.map(tier => {
  const tierAgents = profileA.roster.filter(a => a.model === tier.model);
  return `${tier.model.toUpperCase()} TIER:\n${tierAgents.map(a =>
    `  ${a.id}: ${profileA.reviews[a.id].report}`
  ).join("\n")}`;
}).join("\n\n")}

=== ${label_b.toUpperCase()} — Diagnostic Profile ===
${tiers.map(tier => {
  const tierAgents = profileB.roster.filter(a => a.model === tier.model);
  return `${tier.model.toUpperCase()} TIER:\n${tierAgents.map(a =>
    `  ${a.id}: ${profileB.reviews[a.id].report}`
  ).join("\n")}`;
}).join("\n\n")}

Classify the change from ${label_a} to ${label_b}:
- CLARIFIED: cross-tier agreement increased — material is now less ambiguous
- OBSCURED: cross-tier agreement decreased — material is now more ambiguous
- SIMPLIFIED: understanding moved down-tier — lower-capability agents now grasp what only higher tiers did before
- COMPLICATED: understanding moved up-tier — material now requires higher capability to parse
- NEUTRAL: diagnostic signature unchanged despite surface edits

Provide per-section analysis where possible. An edit can clarify one part while obscuring another.`;

const analysis = await rlm(diffBrief, null, { use: diff_analyst });

__compositeState.result = analysis;
__compositeState.profile_a = profileA;
__compositeState.profile_b = profileB;
return(analysis);
```

## Notes

This is a seed pattern. Reviewers do not know another version exists — each set reviews only its assigned version. The diff analyst does not know it is part of a drift detector composite. The key insight is that this measures *change in diagnostic properties*, not change in content. A large textual diff can produce a NEUTRAL diagnostic signature (the edit changed wording but not clarity). A small textual diff can produce OBSCURED (a subtle rewording introduced ambiguity). This makes drift-detector a regression test for prose quality — run it in CI on every documentation change, and flag edits that degrade clarity even when the author intended to improve it.
