# could-haiku examples

This directory contains example output from the `could-haiku` program — a documentation diagnostic that uses multi-tier AI agents to evaluate whether documentation is clear enough for readers at different capability levels.

## Files

- **astro-docs-report.md** — Diagnostic report from evaluating Astro's getting-started documentation (`docs.astro.build`). Demonstrates the full report format: overall grade, per-stage clarity scores, ambiguity findings, tier-by-tier analysis, and prioritized recommendations.

## How these were generated

```
press run programs/could-haiku/index.md \
  --url "https://docs.astro.build/en/getting-started/" \
  --depth shallow
```

The program scrapes the target documentation, dispatches 9 AI agents (3 per capability tier: haiku, sonnet, opus) to read it, synthesizes their results, and produces the diagnostic report.
