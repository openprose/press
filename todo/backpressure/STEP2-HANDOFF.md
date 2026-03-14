# Step 2 Handoff: Single-Node LLM Judge

## What was built

### Files created

**`programs/judge/root.md`** — The judge program's globalDocs. Contains:
- Evaluation principles (assess what model DID vs program SAYS, find actionable deviations, cite invocation IDs)
- Tier 2 output schemas: BriefAdherence, CurationAdherence, ContractAdherence with all fields
- Brief quality rubric with contamination severity levels (none/mild/severe) and concrete examples of what counts as contamination vs. legitimate brief content
- Curation rubric: present vs. absent, what to look for in subsequent iterations
- Contract checking rubric: requires/ensures/invariants with guidance on using "unknown"

**`programs/judge/evaluator.md`** — The single evaluator node. `kind: program-node`, `role: orchestrator`. Contains:
- Instructions for reading `__traceDigest`, `__mechanicalMetrics`, `__programFiles`, `__specDocs` from sandbox
- Step-by-step workflow: read inputs, extract contracts, assess brief adherence, assess curation, check contracts
- Critical instructions about handling truncation, not inventing evidence, citing specific text, returning valid JSON

### Files modified

**`eval/judge.ts`** — Extended from ~1092 lines to ~1448 lines. Changes:
- Added imports: `rlm` from `../src/rlm.js`, `fromOpenRouter` from `./drivers/openrouter.js`, `resolve`/`fileURLToPath` from Node
- Added Tier 2 type interfaces: `BriefAdherence`, `CurationAdherence`, `ContractAdherence`, `Tier2Judgment`, `JudgeReport` and their sub-types
- Extended CLI args: `--judge` flag, `--model` flag (default: `anthropic/claude-sonnet-4-20250514`), `--reasoning` flag (default: `medium`)
- Added `runLLMJudge()` function: loads judge program, loads spec docs, builds program files map, sets up sandbox globals, calls `rlm()`, parses JSON output, merges Tier 1 + Tier 2
- Added helper functions: `getProjectRoot()`, `loadSpecDocs()`, `buildProgramFilesMap()`
- Modified `main()`: branches on `--judge` flag. In judge mode, processes first task only (LLM judge is expensive). Original mode unchanged.

## How to run it

### Mechanical metrics only (existing behavior, unchanged):
```bash
npx tsx eval/judge.ts --result eval/results/arc3_anthropic_claude-opus-4-6_2026-02-26T21-48-08-707Z.json --program arc3
```

### Full judge (Tier 1 + Tier 2):
```bash
npx tsx eval/judge.ts \
  --result eval/results/arc3_anthropic_claude-opus-4-6_2026-02-26T21-48-08-707Z.json \
  --program arc3 \
  --judge
```

### Full judge with specific model:
```bash
npx tsx eval/judge.ts \
  --result eval/results/arc3_anthropic_claude-opus-4-6_2026-02-26T21-48-08-707Z.json \
  --program arc3 \
  --judge \
  --model anthropic/claude-opus-4-6 \
  --reasoning high
```

### Save output to file:
```bash
npx tsx eval/judge.ts \
  --result eval/results/arc3_anthropic_claude-opus-4-6_2026-02-26T21-48-08-707Z.json \
  --program arc3 \
  --judge \
  > eval/results/arc3_judge_report.json 2>eval/results/arc3_judge_log.txt
```

Requires `OPENROUTER_API_KEY` environment variable (or in `.env`).

## Decisions made that weren't in the plan

1. **JSON code fence stripping.** The judge parses the LLM's return value as JSON, but models sometimes wrap JSON in markdown code fences (` ```json ... ``` `). The parser strips these before parsing. This is a pragmatic choice -- better to handle it than to fail on valid output wrapped in formatting.

2. **Single task in judge mode.** When `--judge` is used without `--task`, only the first result is processed (with a warning). The LLM judge is expensive and slow; processing all tasks in one run is not the expected use case. Users can specify `--task <taskId>` for a specific task.

3. **Program files deduplication.** `loadProgram()` registers child components under both full names (e.g., `arc3-level-solver`) and short names (e.g., `level-solver`). The `buildProgramFilesMap()` function deduplicates by content to avoid injecting the same node file twice into the sandbox.

4. **Evaluator as orchestrator role.** The evaluator.md uses `role: orchestrator` because `loadProgram()` requires exactly one orchestrator node to serve as the root app. This is correct -- the evaluator IS the root (and only) node in the judge program.

5. **No observer wiring on the judge itself.** The judge's own `rlm()` call does not attach an observer. This could be added for debugging but is not needed for the core functionality. The judge is evaluating someone else's trace, not its own.

6. **Query includes run summary.** The query passed to the judge includes a summary of the run identity (benchmark, task, model, iterations, depth, etc.). This gives the judge immediate context without needing to parse the digest's `run` field first.

## Known limitations

1. **Brief truncation.** The trace digest truncates briefs to 300 chars and code to 500 chars. The judge sees the truncated versions, not full text. It is instructed to note when briefs are truncated and to flag the assessment as limited. For the Step 0 test trace, the game-solver brief is 445 chars -- so the judge sees only the first 300 chars with "..." appended. The contamination phrases ("This appears to be a maze/navigation puzzle") should still be visible in the first 300 chars.

2. **No sandbox:snapshot events.** The Step 0 trace lacks `sandbox:snapshot` events, which means &-state diffs are not available. Curation assessment relies on reading the parent's code in subsequent iterations, which is less reliable.

3. **No token usage data.** All `llm:response` events in the Step 0 trace have null `usage` fields (OpenRouter doesn't return them). Resource usage analysis is based on LLM call counts and durations only.

4. **JSON parsing fragility.** The judge must return valid JSON. If the model produces invalid JSON, the parse fails and the whole judge run errors. No retry logic is implemented. Consider adding retry on parse failure in Step 3.

5. **No streaming or progress output.** The judge runs silently until completion. For long runs (Opus with high reasoning), this could mean several minutes of no output. The `console.error` messages provide some indication of progress but no mid-run status from the LLM itself.

6. **Single node only.** The plan's Step 2 specifies a single evaluator node. Multi-polar expansion (multiple specialist judges with tension) is deferred to Step 3+ based on evidence of rationalization.

## What Step 3 (iterate) should focus on

1. **Run the judge against the Step 0 trace and read the output.** The key question: does it flag the game-solver brief contamination as `contamination_severity: "severe"`? If not, the rubric or the evaluator instructions need refinement.

2. **Assess JSON output quality.** Is the judge producing well-structured JSON? Are fields populated with concrete evidence? Or is it producing vague assessments? The notes fields should cite specific phrases and invocation IDs.

3. **Test with multiple traces.** Run against different arc3 results (different games, different models) to see if the judge's assessments are consistent and useful.

4. **Brief truncation impact.** If the 300-char truncation cuts off important contamination evidence, consider increasing the truncation limit in the trace digest (or providing full briefs as supplementary context).

5. **Curation assessment reliability.** Without sandbox:snapshot events, curation assessment is indirect. Evaluate whether the code-based assessment (looking at post-delegation iterations) produces useful signal.

6. **Rationalization detection.** Does the single evaluator rationalize its own assessments? If it consistently produces "none" contamination when the brief clearly contains interpretation, that is evidence for adding multi-polar tension (Step 4).

7. **Cost analysis.** How much does a single judge run cost? If it is expensive (many iterations, large context), consider whether the judge program needs to be more focused/efficient.
