---
purpose: Active development work items and in-progress research threads for node-rlm — one subdirectory per initiative with specs, notes, and working artifacts; covers runtime improvements, benchmark integration, and self-improvement research
related:
  - ../README.md
  - ../docs/README.md
  - ../eval/README.md
  - ../programs/README.md
  - ../../planning/todo/README.md
---

# todo

Active development work items for node-rlm. Each subdirectory represents an ongoing initiative with its own specs, research notes, and working artifacts.

## Active Initiatives

- `composition-test-harness/` — Building a test harness for composite and control patterns in lib/
- `composition-unit-tests/` — Unit test coverage for lib/composites and lib/controls
- `observability/` — Expanding RLM observability: richer trajectory events, real-time streaming
- `delegation-reform/` — Refactoring the per-delegation systemPrompt architecture
- `stdlib/` — Standard library expansion for the RLM sandbox
- `backpressure/` — Backpressure mechanisms for rate limiting and concurrency control
- `arc-eval-integration/` — Tighter integration between eval harness and ARC-AGI benchmark APIs
- `arc2-compound-learning/` — Research on cross-task learning patterns in ARC-AGI-2 compound runs
- `arcgentica-research/` — Integration and comparison research with the arcgentica Python system
- `outer-loop-self-improvement/` — RLM self-improvement via outer-loop meta-learning
- `pi-integration/` — Integration with pi (persistent identity) architecture
- `rlm-test-with-rlm/` — Using RLM to generate and run its own tests
- `trajectory-analysis/` — Automated analysis of RLM trajectories for behavioral insights
- `trace-observability/` — Full-trace observability for eval runs
- `global-docs/` — Global documentation injection into RLM system prompts
- `003-analysis-prompts/` — Prompt engineering for eval analysis

Also contains: `oolong-data-release-asset.md` — planning doc for releasing the OOLONG benchmark dataset.
