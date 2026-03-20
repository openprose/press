---
purpose: Multi-agent RLM topology patterns — 7 named architectures describing how multiple RLM instances collaborate to solve problems; the structural building blocks for programs/ compositions
related:
  - ../README.md
  - ../controls/README.md
  - ../roles/README.md
  - ../../programs/README.md
  - ../../../planning/guidance/rlms.md
glossary:
  OAA: Observer-Actor-Arbiter — a three-role composite where one agent observes, one acts, and one arbitrates decisions
  Dialectic: A two-agent debate structure where opposing positions are synthesized into a conclusion
  Ratchet: An iterative improvement composite that prevents regression — each round must improve on the last
  Witness: A composite that records and reflects on the behavior of other agents for meta-analysis
---

# lib/composites

Named multi-agent topology patterns for RLM programs.

## Contents

- `observer-actor-arbiter.md` — Three-role OAA composite: observer tracks state, actor proposes actions, arbiter decides
- `ensemble-synthesizer.md` — N-agent ensemble that independently solves then synthesizes into a consensus answer
- `worker-critic.md` — Two-agent loop: worker produces, critic evaluates, repeat until accepted
- `ratchet.md` — Iterative improvement loop with regression prevention
- `witness.md` — Meta-observer composite for recording and reflecting on agent behavior
- `dialectic.md` — Two-agent debate structure producing a synthesized conclusion
- `proposer-adversary.md` — Adversarial proposal testing: proposer generates, adversary stress-tests
