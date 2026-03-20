---
purpose: Per-run analysis documents for all benchmark evaluations — OOLONG score progression, ARC-AGI-2/3 run comparisons, hyperparameters, qualitative observations, and lessons learned across 18 numbered analysis directories
related:
  - ../README.md
  - ../results/README.md
  - ../../programs/README.md
---

# Eval Run Analyses

Run-by-run analysis of the RLM eval harness across OOLONG, ARC-AGI-2, and ARC-AGI-3 benchmarks.

## Directory Structure

Analyses are organized in two groups:

- **Root-level OOLONG run files** (`run-00.md` through `run-06.md`) — early OOLONG iteration history
- **Numbered analysis directories** (`001` through `018`) — later benchmark runs spanning OOLONG, ARC-AGI-2, and ARC-AGI-3

### Numbered Analysis Directories

| Dir | Topic |
|-----|-------|
| 001 | Sonnet plugin comparison |
| 002 | ARC-AGI-2 benchmark (6 runs, cross-run HTML comparison) |
| 003 | Opus ARC Feb 13 |
| 004 | Opus ARC drivers vs baseline |
| 005 | Arcgentica comparison |
| 006 | Algorithmic analysis driver |
| 007 | ARC-AGI-3 setup runs (15 runs, delegation experiments v1–v8) |
| 008 | ARC-AGI-3 learning loop |
| 009 | ARC-AGI-3 multi-agent |
| 010 | ARC-AGI-2 compound initial run |
| 011 | ARC-AGI-3 v2.2.0 deep dive |
| 012 | Program review |
| 013 | ARC-AGI-3 program v0.3.0 |
| 014 | ARC-AGI-2 compound v1.1 |
| 015 | ARC-AGI-2 compound v1.2 |
| 016 | ARC-AGI-3 program v0.6.0 |
| 017 | ARC-AGI-2 compound v1.3.0 |
| 018 | ARC-AGI-2 compound v1.3.0 tool-call-only variant |

## OOLONG Score Progression (early runs)

| Run | Date | Model | maxDepth | Plugins | Score | Perfect | Zero | Notes |
|-----|------|-------|----------|---------|-------|---------|------|-------|
| 0 | 2026-02-08..10 | Mixed (4 models) | 2 | 0 | 0--2% | 0 | 50 | Pre-baseline exploration, all near-zero |
| 1 | 2026-02-10 | Gemini 3 Flash | 2 | 0 | 5.1% | 2/50 | 44/50 | Baseline, no plugins, old scorer |
| 2 | 2026-02-10 | Gemini 3 Flash | 2 | 4 | 20.0% | 10/50 | 39/50 | First plugin suite, FLAT prompt fix |
| 3 | 2026-02-11 | Gemini 3 Flash | 1 | 6 | 50.7% | 24/50 | 16/50 | maxDepth=1, FLAT prompt rewrite |
| 4 | 2026-02-11 | Gemini 3 Flash | 1 | 6 | 58.0% | 28/50 | 13/50 | Scorer fixes, penultimate warning |
| 5 | 2026-02-11 | Gemini 3 Flash | 3 | 7 | 0.0%* | 0/4 | 3/4 | *Killed after 4 tasks. Catastrophic regression. |
| 6 | 2026-02-11 | Gemini 3 Flash | 1 | 7 | 58.4% | 27/50 | 13/50 | Per-delegation systemPrompt arch. Neutral at depth 1. |

## Run Files (OOLONG)

- [run-00.md](run-00.md) — Pre-baseline exploration (0--2%)
- [run-01.md](run-01.md) — Baseline (5.1%)
- [run-02.md](run-02.md) — First plugins (20.0%)
- [run-03.md](run-03.md) — maxDepth=1 breakthrough (50.7%)
- [run-04.md](run-04.md) — Best result (58.0%)
- [run-05.md](run-05.md) — maxDepth=3 failure (killed)
- [run-06.md](run-06.md) — Per-delegation systemPrompt (58.4%)

## Key Lessons

1. **maxDepth=1 > maxDepth=2 > maxDepth=3** for OOLONG. Deeper delegation hurts because children lose context and waste tokens re-sending or failing without data.
2. **FLAT_SYSTEM_PROMPT identity matters.** Saying "You are an RLM" primes code generation 27% of the time. Neutral "helpful assistant" identity works better.
3. **Scorer parity is critical.** Case-insensitive matching and missing answer_type gating inflated earlier scores.
4. **Plugins have diminishing returns.** The jump from 0 to 4 plugins was +15pp, from 4 to 6 was +30pp, but the 7th plugin (recursive-delegation-strategy) provided no benefit on OOLONG.
5. **NUMERIC_ONE_CLASS + inputSubset=False is the unsolved problem.** 0/12 perfect across all runs. Requires classifying ~388 unlabeled questions into 6 categories and counting — the model can't do this reliably.
6. **Per-delegation systemPrompt is neutral at maxDepth=1.** The architecture needs maxDepth>=2 to demonstrate value, but the recursive-delegation-strategy plugin must be updated to use `{ systemPrompt }` before maxDepth=2 is viable.
