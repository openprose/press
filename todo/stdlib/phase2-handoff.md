# Phase 2 Handoff: Rename `app` to `use`

## What Was Done

Renamed the `app` parameter/concept to `use` throughout the codebase, with full backwards compatibility. Both `app` and `use` are accepted everywhere. If both are provided, `use` wins. If only `app` is used, a deprecation warning is emitted.

## Code Changes

### `src/rlm.ts`

- `RlmOptions` interface: added `childComponents?: Record<string, string>` alongside existing `childApps`. `childApps` marked `@deprecated`.
- Internal resolution: `const components = options.childComponents ?? options.childApps ?? {};`. Internal code uses `opts.childComponents`.
- Sandbox `rlm()` function signature: added `use?: string` alongside existing `app?: string`. `app` marked `@deprecated`.
- Resolution: `const componentName = rlmOpts?.use ?? rlmOpts?.app;`
- If `app` is used without `use`, emits: `[node-rlm] { app: "..." } is deprecated. Use { use: "..." } instead.`
- Error message changed from `Unknown app "X"` to `Unknown component "X"`.
- The `delegation:spawn` event now emits both `componentName` and `appName` (both set to the resolved component name).

### `src/events.ts`

- `DelegationSpawnEvent`: added `componentName?: string` field. `appName` kept with `@deprecated` JSDoc.

### `src/system-prompt.ts`

- System prompt documentation changed from `{ systemPrompt?, model?, maxIterations?, app? }` to `{ systemPrompt?, model?, maxIterations?, use? }`.
- Description changed from "app loads a named program for the child" to "use loads a named component for the child".

### `src/plugins.ts`

- `ProgramDefinition` interface: added `childComponents: Record<string, string>`. `childApps` kept with `@deprecated` JSDoc.
- `loadProgram()`: internal variable renamed from `childApps` to `childComponents`. Return object populates both fields (they reference the same object): `{ ..., childComponents, childApps: childComponents }`.
- `loadStack()` options: added `use?: string` alongside existing `app?: string`. `app` marked `@deprecated`. Internal resolution: `const app = options.use ?? options.app;`.

### `src/index.ts`

- No changes needed. Re-exports `RlmOptions` and `DelegationSpawnEvent` types which now include the new fields.

### `eval/harness.ts`

- `HarnessConfig`: added `childComponents?: Record<string, string>` alongside existing `childApps` (for backwards compat with benchmark configs that set `childApps`).
- `SingleTaskConfig`: renamed `childApps` to `childComponents`.
- `runSingleTask()`: uses `childComponents` internally.
- `runEval()`: resolves `config.childComponents ?? config.childApps` when building `SingleTaskConfig`.
- The `rlm()` call now passes `childComponents` instead of `childApps`.

### `eval/run.ts`

- `CliArgs`: added `childComponents: string[]` that merges both `--child-component` and `--child-app` CLI flags.
- `BenchmarkConfig`: added `childComponents` alongside `childApps`.
- `--child-component <name>` CLI flag added. `--child-app` kept with "(deprecated)" note in help text.
- `configureArcCompound()`: internal variable renamed from `loadedChildApps` to `loadedChildComponents`. Sets `config.childComponents`.
- `loadAllPlugins()`: return type changed to `programChildComponents` and `cliChildComponents`. Internal logic uses new names.
- `main()`: merge logic uses `allChildComponents` and passes `childComponents` to `runEval`.
- Print config shows "Components:" instead of "Child Apps:".
- Log output changed: "Child apps:" to "Components:" in program loading output.

### Program `.md` Files

All `{ app: "name" }` in program prose changed to `{ use: "name" }`:

| File | Changes |
|------|---------|
| `programs/arc3/root.md` | `app: "game-solver"` -> `use: "game-solver"`, `app: "level-solver"` -> `use: "level-solver"`, `app: "oha"` -> `use: "oha"` |
| `programs/arc3/level-solver.md` | `{ app: "oha" }` -> `{ use: "oha" }` |
| `programs/arc3/game-solver.md` | `{ app: targetApp, maxIterations: 20 }` -> `{ use: targetApp, maxIterations: 20 }` |
| `programs/arc2-compound/root.md` | `app: "arc2-orchestrator"` -> `use: "arc2-orchestrator"`, `app: "arc2-solver"` -> `use: "arc2-solver"` |
| `programs/arc2-compound/orchestrator.md` | `{ app: "arc2-solver" }` -> `{ use: "arc2-solver" }`, `{ app: "arc2-solver", maxIterations: 18 }` -> `{ use: "arc2-solver", maxIterations: 18 }`, `childApps:` frontmatter -> `components:` |
| `programs/arc3/oha.md` | No `app:` references (leaf node, doesn't delegate) |
| `programs/arc2-compound/solver.md` | No `app:` references (leaf node, doesn't delegate) |

### Test Files

**`test/rlm.test.ts`** -- Replaced the 4 original `app:`/`childApps:` tests with 9 new tests:

- `use: child receives component prompt` -- primary test for new `use:` syntax
- `app: child receives component prompt (backwards compat)` -- verifies `app:` still works
- `use: unknown name errors with list` -- error handling for `use:`
- `app: unknown name errors with list (backwards compat)` -- error handling for deprecated `app:`
- `use + systemPrompt concatenated` -- `use:` + `systemPrompt` option
- `use wins over app when both provided` -- precedence test
- `childApps backwards compat: populates childComponents` -- `childApps` option still works
- `childComponents: not in root prompt` -- component bodies don't leak to root

**`test/plugins.test.ts`** -- Updated `loadStack` tests:

- `profile + use:` test (primary)
- `profile + app (backwards compat):` test (kept)
- `deduplicates drivers` now uses `use:`
- `use only` test (primary)
- `app only (backwards compat)` test (kept)
- `use wins over app when both provided` test (new)

### Documentation

| File | Changes |
|------|---------|
| `README.md` | `loadStack({ app: ... })` -> `loadStack({ use: ... })` |
| `CONTAINER.md` | All `{ app: "name" }` -> `{ use: "name" }`, `childApps` -> `childComponents`, `**app**:` -> `**use**:`, "child apps" -> "child components" |
| `LANGUAGE.md` | `app: "level-solver"` -> `use: "level-solver"` in component catalog example |
| `OBSERVABILITY.md` | `appName?` -> `componentName?` in delegation:spawn event docs |
| `BACKPRESSURE.md` | No changes needed (no `app:` references) |

## Decisions Made

1. **`childApps` and `childComponents` reference the same object in `loadProgram()` return.** Rather than copying, both fields point to the same `Record<string, string>`. This avoids memory waste and ensures consistency.

2. **Error messages say "Unknown component" not "Unknown app".** Since the deprecation is in flight, the user-facing error message uses the new terminology. This helps steer users toward the new name.

3. **`delegation:spawn` event emits both `componentName` and `appName`.** Both fields are set to the same resolved value (the resolved component name, whether it came from `use` or `app`). This means consumers that read `appName` continue to work. The `componentName` field is not `undefined` when `app` was used -- it resolves to the same value.

4. **`--child-component` is the new CLI flag, `--child-app` is kept.** Both are accepted. `childComponents` array in `CliArgs` merges both flags. The help text marks `--child-app` as deprecated.

5. **`eval/harness.ts` HarnessConfig keeps both fields.** Because benchmark configs (like `configureArcCompound`) may still set `childApps` in the `BenchmarkConfig`, the harness resolves `config.childComponents ?? config.childApps` when passing to `runSingleTask`. This provides a clean transition path.

6. **Program frontmatter `childApps:` -> `components:`.** In `orchestrator.md`, the frontmatter field `childApps: [arc2-solver]` was renamed to `components: [arc2-solver]`. This field is informational (not parsed by the engine for component resolution), so the rename is safe.

7. **`loadStack` `use` field takes priority over `app`.** If both are specified, `use` wins silently (no warning). The warning is emitted only in the sandbox `rlm()` function where the model's code is being evaluated, since that's the primary user-facing API.

## Verification

- `npx tsc --noEmit` -- passes with no errors
- `npx vitest run` -- 162 tests pass, 1 skipped (e2e, requires API key)
- Deprecation warnings appear correctly in test stderr for backwards-compat tests

## What the Scrutiny Agent Should Verify

1. **All tests pass**: `npx tsc --noEmit && npx vitest run`

2. **Backwards compatibility**: The `app:` option in sandbox `rlm()` calls still resolves components correctly (covered by `app: child receives component prompt (backwards compat)` test).

3. **`childApps` backwards compatibility**: Passing `childApps` to `rlm()` options still populates the component dictionary (covered by `childApps backwards compat: populates childComponents` test).

4. **`use` takes precedence over `app`**: When both are provided, `use` wins (covered by `use wins over app when both provided` test).

5. **Deprecation warning emitted**: When `app:` is used without `use:`, a console warning fires (visible in test stderr output).

6. **No stale `app:` in program prose**: Run `grep -rn '{ app:' programs/` and confirm zero matches.

7. **No stale `childApps` in active code paths**: Run `grep -rn 'childApps' src/ eval/ test/ --include="*.ts"` and confirm all remaining references are either `@deprecated` markers, backwards-compat resolution (`?? config.childApps`), or test names.

8. **Documentation consistency**: `CONTAINER.md`, `LANGUAGE.md`, `README.md` use `{ use: "name" }` and `childComponents`.

9. **`.prose/`, `.archive/`, `todo/` references are untouched**: These contain historical references to old names and should NOT be updated -- they are records of the past.
