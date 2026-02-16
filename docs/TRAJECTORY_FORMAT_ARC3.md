# Trajectory Format: ARC-3 Extensions

Extensions to the [canonical trajectory format](./TRAJECTORY_FORMAT.md) for
ARC-AGI-3 interactive game trajectories.

ARC-3 games have a shared, mutable game state (frame, score, fuel) that persists
across parent and child agents. Tracking resource consumption across agent
boundaries is critical for understanding delegation failures in this benchmark.

---

## Additional Frontmatter Fields

These fields supplement the canonical frontmatter. Include them in ARC-3
trajectory annotations.

| Field | Type | Description |
|-------|------|-------------|
| delegationActionsCost | number | Game actions consumed by all child agents combined |
| resourceActions | number | Total game actions consumed (all agents) |
| resourceFuel | number | Fuel remaining at end of run (color 11 pixel count) |
| resourceFuelInitial | number | Fuel at start of level (color 11 pixel count) |

**Example:**
```yaml
delegationActionsCost: 42
resourceActions: 85
resourceFuel: 0
resourceFuelInitial: 82
```

These fields enable queries like:
- "What fraction of game actions were consumed by delegation?"
- "Did fuel depletion cause the failure?"
- "How many effective moves remained when the agent began its solve attempt?"

---

## Resource Log

The Resource Log tracks consumption of game-specific resources across agent
boundaries. It sits after the Delegation Log.

**Format:**

```markdown
## Resource Log

| Resource | Initial | After D1 | After D2 | After iter N | Final |
|----------|---------|---------|---------|-------------|-------|
| Game actions | 0 | ~20 | 42 | 83 | ~85 |
| Fuel (color 11 px) | 82 | ~42 | ~0 | ~4 | 0 |
| Levels completed | 0 | 0 | 0 | 0 | 0 |
| Block position | [45,49] | ? | [40,49] | [25,19] | [35,19] |
| Player position | [32,20] | [32,20] | [32,20] | [32,20] | [32,20] |
```

**Guidelines:**
- Column headers are delegation boundaries and key parent iterations
- Use `~` prefix for estimated values (not directly observed)
- Use `?` for unknown values (child didn't report)
- Include a row for each resource that matters for understanding the outcome
- The "After Dx" columns make delegation cost visible at a glance

**Common resources to track:**

| Resource | What it measures |
|----------|-----------------|
| Game actions | Total actions sent to the API (cumulative, irreversible) |
| Fuel (color 11 px) | Pixel count of color 11 — depletes 2px per action |
| Levels completed | Game progress (0 = no levels beaten) |
| Entity positions | Row/col bounding boxes of key game objects |

---

## Additional Patterns

These ARC-3-specific patterns supplement the canonical pattern vocabulary.

| Pattern | Description |
|---------|-------------|
| `fuel-depletion` | Color 11 fuel bar reached 0, preventing further meaningful actions |
| `transition-screen` | Game displayed a full-screen transition (all color 11) between states |
| `entity-misidentification` | Agent identified the wrong object as the controlled entity |

Note: Use the canonical `delegation-resource-depletion` failure mode (not a
separate ARC-3 pattern) when a child agent depletes shared game resources.

---

## Example

See `eval/analyses/007-arc3-setup-runs/run-008-delegation-experiment/trajectory-v3.md`
for a complete ARC-3 trajectory annotation using these extensions.
