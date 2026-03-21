# Changelog

## 0.1.0 (2026-03-21)

Initial release of Press — the runtime for Prose programs.

### Features
- Two-phase execution: Forme (wiring) then Prose VM (execution) via `pressRun()`
- `press run` CLI command for running Prose programs
- Context stack with mirror/cache-efficient layout modes
- Pass-by-reference: file paths in context auto-resolved to content
- `<press-runtime>` translation glossary for Prose/Forme specs
- Deterministic eval pipeline with `--tier quick/standard/full`
- Token tracking and structured event capture

### Programs Tested
- trivial-pipeline (2 services, sequential)
- parallel-analysis (4 services, fan-out + fan-in)
- haiku-refiner (2 services, worker-critic loop)
- bilingual-haiku (4 services, service reuse)
- error-handling (2 services, graceful degradation)
- could-haiku (4 service types, 14 instances, 9 parallel testers)
