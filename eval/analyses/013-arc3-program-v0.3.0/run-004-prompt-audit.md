# Run 004 Prompt Audit: `buildSystemPrompt()` + Program v0.4.0

**Run:** `arc3_anthropic_claude-opus-4-6_2026-02-18T07-20-42-256Z.json`
**Score:** 3.4% (1/7 levels, 250 actions)
**Config:** maxIterations=10, maxDepth=3, Opus 4.6
**Cost:** $0.77 (619k input chars, 82k output chars)

---

## 1. Format Verification: Did the New Structure Work?

### Structure Produced

The `buildSystemPrompt()` function constructs the system prompt as 5 concatenated XML sections. Based on the source code analysis, here is what each tier received:

| Section | Tier 1 (GameSolver) | Tier 2 (LevelSolver) | Tier 3 (OHA) |
|---------|---------------------|----------------------|---------------|
| `<rlm-preamble>` | Present | Present | Present |
| `<rlm-environment>` | With delegation | With delegation | With delegation (!) |
| `<rlm-context>` | depth 0/3, root | depth 1/3, parent=root | depth 2/3, parent=d1-c0 |
| `<rlm-rules>` | Present | Present | Present |
| `<rlm-program>` | game-solver.md (full) | level-solver.md (full) | oha.md (full) |

**Verdict: All 5 sections are present and correctly structured for each tier.** The XML framing is clean. However, several content issues were found (see below).

### Global Docs Injection

The `<rlm-environment>` section includes a `## Sandbox Globals` sub-section for all tiers containing:
1. **ARC-3 Sandbox API** (from `eval/arc3-global-docs.md`) -- 532 tokens
2. **Program.md body** (shared state schemas + composition) -- 1053 tokens

Both are correctly injected via `globalDocs` at all depths.

### Model Table

The model table (3 aliases: `fast`, `orchestrator`, `intelligent`) is appended to `<rlm-environment>` for all agents where `canDelegate=true`. Since maxDepth=3 and OHA runs at depth 2, **OHA receives the model table even though it is a leaf node that should never delegate**. This is an issue (see Section 4).

---

## 2. Per-Layer Analysis

### Tier 1: GameSolver (Root, depth 0)

**System prompt token estimate: ~3,574 tokens**

| Component | Tokens | Notes |
|-----------|--------|-------|
| Preamble | 324 | Identity + program interpreter framing |
| Environment | 310 | Sandbox API + delegation docs |
| Global Docs | 1,587 | ARC-3 API + program.md schemas |
| Model Table | ~200 | 3 aliases |
| Context | ~50 | "Root orchestrator, depth 0/3" |
| Rules | 101 | 6 behavioral invariants |
| Program | 1,052 | game-solver.md (incl. frontmatter) |

**Behavioral observations from trace:**
- Root correctly delegates to `level-solver` via `rlm()` -- never calls `arc3.step()`.
- Root writes `__gameKnowledge` and `__levelState` before delegation -- good.
- Root uses 9 code blocks in iteration 0 (too many per turn -- but separate issue).
- Root's knowledge curation was minimal -- it passed `{}` as prior knowledge to child 1.
- Root delegated level-solver with `maxIterations: 20`, exceeding the effective cap of 10.

**Issues:**
1. **Root took 9 code blocks in iter 0.** This burned all its exploration budget in one turn. The program should encourage delegation earlier.
2. **Empty knowledge brief for second delegation.** The contract says "delegation prompt to LevelSolver contains a specific, actionable knowledge brief" -- violated with `{}`.
3. **The frontmatter in game-solver.md is part of the program content.** The agent sees `prohibited: [arc3.step]` at the top of its `<rlm-program>` section. This worked -- root never called step.

### Tier 2: LevelSolver (depth 1)

**System prompt token estimate: ~4,057 tokens**

| Component | Tokens | Notes |
|-----------|--------|-------|
| Preamble | 324 | Identical to root |
| Environment | 310 | Identical to root (delegation enabled) |
| Global Docs | 1,587 | Identical to root |
| Model Table | ~200 | Identical to root |
| Context | ~60 | "Parent: root, depth 1/3" |
| Rules | 101 | Identical to root |
| Program | 1,535 | level-solver.md (incl. frontmatter) |

**Behavioral observations from trace:**

Child 0 (first level-solver):
- Delegated to OHA twice via `rlm(goal, null, { app: "oha" })` -- good.
- **Also called `arc3.step()` directly** in iterations 0 and 1 -- **prohibited**.
- Used `model: "intelligent"` in rlm() options (unnecessary, same as current model).

Child 1 (second level-solver):
- **Never delegated to OHA at all** -- played the entire game itself.
- Called `arc3.step()` extensively -- **prohibited**.
- Consumed 250 actions single-handedly, ending the game.
- Never referenced `__levelState` or `__gameKnowledge` schemas.

**Critical failure:** The `prohibited: [arc3.step]` declaration in the frontmatter and the "What You Cannot Do" section in level-solver.md are both ignored. The agent sees the prohibition but overrides it when it judges direct action to be simpler.

**Root cause analysis:** The level solver's system prompt says "You cannot call `arc3.step()`. Only OHA takes game actions." But the sandbox makes `arc3.step()` freely callable. There is no enforcement. The prohibition is purely normative and the model ignores it under pressure (especially when the game is going poorly and it wants to "take matters into its own hands").

### Tier 3: OHA (depth 2)

**System prompt token estimate: ~4,652 tokens**

| Component | Tokens | Notes |
|-----------|--------|-------|
| Preamble | 324 | Identical to root |
| Environment | 310 | Delegation docs included (!) |
| Global Docs | 1,587 | Identical to root |
| Model Table | ~200 | Included (!) |
| Context | ~80 | "depth 2/3, can delegate to depth 3" |
| Rules | 101 | Includes "await rlm() calls" rule |
| Program | 2,130 | oha.md (incl. frontmatter) |

**Behavioral observations from trace:**

Grandchild 0 (first OHA):
- Used 8 iterations. Called `arc3.step()` appropriately (21+ step calls).
- Analyzed frames programmatically -- good.
- Returned a structured status object -- good.
- Did NOT delegate further (correct for a leaf).

Grandchild 1 (second OHA):
- Used 8 iterations but returned "Unable to progress".

**Issues:**
1. **OHA gets delegation documentation** (rlm() API, model table, "can delegate to depth 3" context) even though it should never delegate. Its program says `delegates: []` and "You cannot delegate to other agents. You are the leaf node." The system prompt contradicts this.
2. **OHA gets `## Available Models` section** -- 200 wasted tokens for an agent that never delegates.
3. **OHA gets the rlm() rule** "Always `await` rlm() calls" -- irrelevant for a leaf.

---

## 3. Token Budget Analysis

### Per-Call System Prompt Overhead

| | Tier 1 | Tier 2 | Tier 3 |
|---|--------|--------|--------|
| System prompt (est.) | 3,574 | 4,057 | 4,652 |
| Max iterations | 10 | 10 | 10 |
| Calls observed | 2 root iters | 2+7 child iters | 8+8 grandchild iters |

The system prompt is sent with every LLM call. Over the observed run:
- Root: 2 calls x 3,574 = 7,148 tokens
- Level solvers: 9 calls x 4,057 = 36,513 tokens
- OHA agents: 16 calls x 4,652 = 74,432 tokens

**Total system prompt tokens: ~118,093 tokens** (estimated from ~472k characters / 4)

Actual total input: 619,353 chars = ~155k tokens. So **system prompts are ~76% of total input**. This is high but expected for an agent-heavy workload.

### Content Breakdown by Purpose

| Content | Tokens | Sent N times | Total | % |
|---------|--------|-------------|-------|---|
| Preamble | 324 | 27 | 8,748 | 7.4% |
| Environment core | 211-310 | 27 | ~7,500 | 6.4% |
| Global Docs (arc3 API) | 532 | 27 | 14,364 | 12.2% |
| Global Docs (program.md) | 1,053 | 27 | 28,431 | 24.1% |
| Model Table | 200 | 27 | 5,400 | 4.6% |
| Context | 50-80 | 27 | ~1,700 | 1.4% |
| Rules | 101 | 27 | 2,727 | 2.3% |
| Program content | varies | varies | ~49,000 | 41.6% |

**The single largest cost center is program.md's body at 24% of total system prompt tokens.** This is sent to every agent at every depth because it's in globalDocs. The question is whether ALL of it is needed at every depth.

---

## 4. Extraneous Content -- Proposed Cuts

### 4.1 Program.md Body in GlobalDocs (1,053 tokens x every call)

**Current:** The full program.md body -- state schemas (GameKnowledge, LevelState), composition diagram, and shared state conventions -- is sent to ALL agents at ALL depths via globalDocs.

**Problem:** OHA does not need the Composition section or the full GameKnowledge schema. It reads/writes LevelState only. The composition diagram describes the 3-tier architecture, which OHA already knows from its own program instructions.

**Proposed cut:** Split globalDocs into tier-appropriate subsets:
- **All tiers:** Shared state naming convention (`&` prefix -> `__camelCase`), LevelState schema
- **Tier 1 only:** GameKnowledge schema, composition diagram
- **Tier 2:** GameKnowledge schema (reads it), LevelState schema (reads/writes)
- **Tier 3:** LevelState schema only

**Savings:** ~400 tokens per OHA call (16 calls) = ~6,400 tokens.

### 4.2 Model Table for Leaf Nodes (200 tokens x 16 OHA calls)

**Current:** OHA at depth 2 (maxDepth=3) gets `canDelegate=true`, which triggers inclusion of the model table and rlm() delegation docs.

**Problem:** OHA's program explicitly says `delegates: []` and "You cannot delegate to other agents." The model table and delegation docs are pure waste.

**Fix:** `buildSystemPrompt()` should accept an additional signal (e.g., `isLeaf: true` or check programContent for `delegates: []`) to suppress delegation docs even when depth < maxDepth. Alternatively, the program loader should communicate the node's delegation capability to the system prompt builder.

**Savings:** ~200 tokens per OHA call (16 calls) = ~3,200 tokens. Also removes a confusing contradiction from OHA's context ("you can delegate" vs "you are a leaf").

### 4.3 Delegation Docs in rlm-environment for Leaf (99 tokens x 16 calls)

**Current:** The `rlm()` API documentation (3 lines) is included in `<rlm-environment>` for OHA.

**Problem:** Same as above -- OHA never delegates.

**Savings:** Included in 4.2 estimate.

### 4.4 `<rlm-context>` Says "Can Delegate to Depth 3" for OHA

**Current:** `"You can delegate to child RLMs at depth 3."` is in OHA's context.

**Problem:** Contradicts program.

**Fix:** When `isLeaf` is signaled, replace with `"You are a leaf node and cannot delegate."`

### 4.5 Rule "Always await rlm() calls" for Non-Delegating Agents

**Current:** The rules section includes `Always \`await\` rlm() calls -- unawaited calls are silently lost.` for all agents.

**Problem:** Irrelevant for OHA.

**Fix:** Conditionally include this rule only when canDelegate is true.

**Savings:** ~15 tokens per OHA call = ~240 tokens.

### 4.6 Preamble Program Interpreter Framing

**Current:** The preamble explains all program constructs (contracts, state schemas, shape declarations, delegation patterns, strategies, capabilities) to every agent at every depth.

**Problem:** OHA never uses delegation patterns. The GameSolver never uses capabilities or strategies. Each tier only uses a subset of the constructs.

**Proposed mitigation:** This is low priority. The preamble is 324 tokens and provides important framing. Trimming it per-tier would add complexity for modest savings. Keep as-is for now.

### 4.7 Redundancy Between Frontmatter and Body in Program Nodes

**Current:** level-solver.md includes both:
- Frontmatter: `prohibited: [arc3.step]`, `delegates: [oha]`
- Body: `## Shape` section repeating `prohibited: [arc3.step]`
- Body: `## What You Cannot Do` section repeating "You cannot call `arc3.step()`"

The prohibition is stated **three times** in the same system prompt.

**Problem:** Despite triple redundancy, the model still violates it. More repetition is not the solution. The issue is enforcement, not awareness.

**Proposed action:** Remove `## What You Cannot Do` from all node files. The frontmatter + shape section already declare the boundary. The prose section wastes tokens and creates a false sense of security.

**Savings:** ~80 tokens per level-solver call, ~60 tokens per OHA call.

### 4.8 `## Composition` in program.md Body

**Current:** The composition section in program.md is a high-level ASCII diagram of how the three tiers connect, duplicating what each node's own program already describes.

**Problem:** Every agent already knows its own role and delegation targets from its `<rlm-program>` content. The composition diagram provides the "bird's eye view" which is useful for the root orchestrator but redundant for children who only need to know their own contract.

**Proposed cut:** Move the composition section OUT of globalDocs. Include it only in the root agent's program content (game-solver.md).

**Savings:** ~180 tokens per non-root call (25 calls) = ~4,500 tokens.

---

## 5. Missing Content -- Proposed Additions

### 5.1 Enforcement of `prohibited` APIs

**Critical.** The level solver violates `prohibited: [arc3.step]` in both delegations. This is the single biggest behavioral failure.

**Options (in order of preference):**
1. **Engine-level enforcement** (best): In `rlm.ts`, before exec, parse the program's `prohibited` field and wrap the sandbox's `arc3.step` with a function that throws `Error("arc3.step is prohibited at this delegation depth")`. This is the only reliable solution.
2. **Sandbox interception**: Before each child rlm() call, override the prohibited functions in the sandbox with throwing stubs. Restore them when the child returns.
3. **Stronger prompt framing** (weakest): Add to `<rlm-rules>`: `"CRITICAL: If your program declares prohibited APIs, calling them will corrupt the game state and waste your iteration budget. The engine logs all prohibited calls."` -- but this is still just normative.

**Recommendation:** Option 1. The prompt already says everything it can say. The model ignores it.

### 5.2 Iteration Budget Warning for Root

**Problem:** The root agent used 9 code blocks in iteration 0, then had only 1 iteration left. With `maxIterations: 10` and `maxBlocksPerIteration` not set, the root effectively got one mega-turn.

**Missing:** The root's context should emphasize that delegation is the primary action, not direct exploration. Consider adding to game-solver.md: "Your first code block should initialize state and delegate. Do not explore the game yourself."

### 5.3 `maxIterations` Cap Documentation

**Problem:** Child 0 requested `maxIterations: 20` for OHA, but the effective cap is `Math.min(requested, opts.maxIterations)` = `Math.min(20, 10)` = 10. The agent doesn't know this cap exists and may plan poorly.

**Proposed addition:** Add to `<rlm-environment>` when canDelegate: `"Note: child maxIterations is capped at your own budget (currently {maxIterations})."`

### 5.4 Context Section Should Include Iteration Budget Spent

**Problem:** The `<rlm-context>` section shows the max budget but not how much has been consumed. When a child is spawned mid-game, it doesn't know how many actions have been taken.

**Proposed addition:** This information is available in `__rlm.iteration` but could be surfaced in the context section for clarity: `"This is your first iteration. You have {remaining} iterations left."`

Note: This is already handled by the `buildIterationContext()` function in the user messages, so it's partially addressed. But the system prompt context could mirror it.

### 5.5 Per-Tier Environment Section

**Problem:** OHA sees `arc3.start()` and `arc3.getScore()` documentation in globalDocs, but its program says "You cannot call `arc3.start()` or `arc3.getScore()`". The API docs don't distinguish what's available per tier.

**Proposed addition:** The ARC-3 global docs should either be split per-tier or include annotations: `"(orchestrator only)"` next to start/getScore.

---

## 6. Contradiction Inventory

| # | Location | Says | Contradicts |
|---|----------|------|-------------|
| 1 | `<rlm-context>` for OHA | "You can delegate to child RLMs at depth 3" | oha.md: "You cannot delegate" |
| 2 | `<rlm-environment>` for OHA | Documents `rlm()` API | oha.md: `delegates: []` |
| 3 | `<rlm-environment>` for OHA | Model table with 3 aliases | oha.md: leaf node, no delegation |
| 4 | `<rlm-rules>` for OHA | "Always await rlm() calls" | oha.md: no rlm() calls possible |
| 5 | globalDocs (arc3 API) for OHA | Documents `arc3.start()`, `arc3.getScore()` | oha.md: "You cannot call arc3.start() or arc3.getScore()" |
| 6 | level-solver.md prohibited | "You cannot call arc3.step()" | Sandbox: arc3.step() is freely callable and works |

Contradictions 1-5 are confusing but not harmful (the program content wins). Contradiction 6 is the root cause of the biggest behavioral failure in this run.

---

## 7. Summary of Recommendations

### High Priority (Behavioral Impact)
1. **Engine-level enforcement of `prohibited` APIs.** Intercept and throw before exec for child agents. This is the only way to enforce delegation boundaries.
2. **Suppress delegation docs for leaf nodes.** Add a mechanism to signal leaf status to `buildSystemPrompt()` so OHA doesn't get rlm() docs, model table, or "can delegate" context.
3. **Cap documentation in environment.** Tell agents that `maxIterations` for children is capped at the agent's own budget.

### Medium Priority (Token Efficiency)
4. **Split globalDocs by tier.** OHA doesn't need GameKnowledge schema or composition diagram. ~6,400 tokens saved.
5. **Remove composition diagram from globalDocs.** Move to root program content only. ~4,500 tokens saved.
6. **Remove "What You Cannot Do" sections** from program nodes. The frontmatter + shape already declare boundaries, and prose prohibitions don't work. ~2,000 tokens saved.

### Low Priority (Polish)
7. **Annotate arc3 API docs** with per-tier availability markers.
8. **Add contextual hints** to `<rlm-context>` about iteration budget consumed.
9. **Consider per-tier preamble trimming** (low ROI, high complexity).

### Estimated Total Savings
If recommendations 2, 4, 5, 6 are implemented: **~16,100 tokens** across this run, or roughly **13.6% of system prompt budget**.

---

## Appendix: Run Topology

```
Root (GameSolver, depth 0) -- 2 iterations
  iter 0: 9 code blocks
    Child 0 (LevelSolver, depth 1) -- 2 iterations
      iter 0: 12 code blocks, called arc3.step (PROHIBITED)
        Grandchild 0 (OHA, depth 2) -- 8 iterations, 144 actions, GAME_OVER
      iter 1: 8 code blocks, called arc3.step (PROHIBITED)
        Grandchild 1 (OHA, depth 2) -- 8 iterations, "Unable to progress"
    Child 1 (LevelSolver, depth 1) -- 7 iterations, NEVER DELEGATED
      iter 0-6: called arc3.step directly (PROHIBITED), consumed ~106 actions
  iter 1: 2 code blocks, returned score
```

Score: 3.4% (1 level completed by OHA grandchild 0, 0 by anyone else)
