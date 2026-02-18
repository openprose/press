# Composition Unit Tests

How do we iterate on composition principles without running full evals ($5-10, 30+ minutes)?

## The Idea

Design scenarios where the right and wrong composition are obvious, then test whether the model chooses correctly given only program.md content and a task description. No sandbox, no game, no API calls — just prompt + response.

## Sketch

A "composition unit test" would:

1. Present the model with a `<rlm-environment>` containing program.md's component catalog and composition principles
2. Present a task scenario (e.g., "Level 3, mechanics already known, budget 15 actions")
3. Ask: "What component(s) would you delegate to? Why?"
4. Check the response against expected composition

### Example Scenarios

**Scenario: Known simple level**
- Input: &GameKnowledge has confirmed movement, maze structure, fuel mechanics. Level 4 is structurally similar to levels 0-3.
- Expected: Skip coordinator, delegate directly to OHA (overhead not justified).
- Anti-pattern: Full 3-tier chain for a well-understood level.

**Scenario: First level, no knowledge**
- Input: Empty &GameKnowledge. Level 0. Full budget.
- Expected: Full chain (coordinator for strategy selection + leaf for execution).
- Anti-pattern: Direct to leaf (no strategic perspective for discovery phase).

**Scenario: Retry after structural failure**
- Input: Previous attempt used coordinator->OHA, but coordinator played directly (shape violation).
- Expected: Different composition (e.g., direct to OHA with explicit initialization, or re-use coordinator with stronger brief).
- Anti-pattern: Repeat exact same composition.

**Scenario: Low budget, low depth**
- Input: 10 actions remaining, depth 2 of 3 (1 delegation level left).
- Expected: Direct to leaf. No multi-tier overhead.
- Anti-pattern: Try to compose a 2-tier subtree with only 1 tier of headroom.

## Implementation Approach

Could be a vitest test that:
1. Constructs a system prompt using `buildSystemPrompt()` with the component catalog in globalDocs
2. Calls a real LLM (or a stubbed one for unit tests) with a composition scenario
3. Parses the response for composition decisions
4. Asserts the decision matches expectations

For real LLM tests (integration), this would cost ~$0.02 per scenario vs $5+ per full eval. Could run 50 scenarios for $1.

## Open Questions

- How do we make composition decisions parseable from LLM responses? Structured output? A specific format convention?
- Should we test at the prompt level (give the model the full prompt and check its first code block) or at a more abstract level (just the composition reasoning)?
- Can we use cheap models (Haiku, Flash) for composition tests, or does composition reasoning require Opus-class capability?
- How do we avoid Goodhart's law — optimizing for test scenarios that don't reflect real composition quality?

## Priority

Medium. Save for after the program.md rewrite (composition guide instead of wiring diagram) is done and tested with at least one full eval run. The composition tests would then validate the principles in isolation.
