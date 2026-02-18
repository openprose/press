---
name: arc2-compound-solver
kind: program
version: 1.2.0
description: Solve ARC-AGI-2 tasks through compound learning with cross-task knowledge accumulation
nodes: [session-orchestrator, task-solver]
---

# ARC-2 Compound Learning Solver

A 2-tier RLM program for solving ARC-AGI-2 grid transformation tasks. Tasks are processed sequentially. Knowledge accumulates across tasks via a shared library of primitives and strategies.

## Shared State

State prefixed with `&` lives in the sandbox as a `__camelCase` variable. All agents read and write it directly.

### &Library

The shared knowledge library. Persists across all tasks in the session. Pre-initialized by the harness as `__arcLibrary`.

```
Library {
  primitives: {
    [name]: {
      fn: Function                 -- live callable JS function
      source: string               -- fn.toString() for cross-task discoverability
      doc: string                  -- one-line description of what it does
    }
  }

  strategies: {
    approach: string               -- e.g. "connected components + color mapping"
    structuralHints: {             -- when to try this approach
      sameSize?: boolean           -- input/output same dimensions?
      colorCount?: number          -- distinct colors in input
      hasSymmetry?: boolean        -- rotational/reflective symmetry detected?
    }
    taskIds: string[]              -- tasks where this approach succeeded
    successCount: number
  }[]

  antiPatterns: string[]           -- failed approaches (avoid repeating)
                                   -- e.g. "color replacement failed on 0934a4d8"

  taskLog: {
    id: string
    solved: boolean
    confidence: number             -- 0..1, calibrated by leave-one-out validation
    approach: string               -- natural language: what was tried
    keyInsight: string             -- what worked, or why it failed
    answer: number[][][] | null    -- predicted test output(s)
    structuralProps: {             -- template: fields populated through analysis
      sameSize?: boolean
      inputDims?: [number, number]
      outputDims?: [number, number]
      colorCount?: number
      hasBackground?: boolean      -- is color 0 a dominant background?
      [custom]: any                -- solver may add task-specific observations
    }
    newPrimitives: string[]        -- names of functions stored on primitives
  }[]
}
```

### Harness-Injected Globals

These are injected by the eval harness, not by the program. Listed here for reference.

```
__arcTasks: { [taskId]: { train: [{ input, output }], test: [{ input }] } }
__arcTaskIds: string[]             -- all task IDs in dataset order
__arcCurrentTask: string | null    -- set by orchestrator before each delegation
__arcSubmit: {
  submit(taskId, answer): { correct: boolean, remaining: number }
  remaining(taskId): number        -- 0, 1, or 2
  getResults(): { [taskId]: boolean }
}
```

## Composition

```
SessionOrchestrator (app: "arc2-orchestrator")
  reads &Library (strategies, taskLog)
  writes &Library (curation after each solver return)
  for each task:
    sets __arcCurrentTask
    delegates -> TaskSolver via rlm(goal, null, { app: "arc2-solver", maxIterations: 18 })
    reads &Library.taskLog for solver's result
    validates answer (sanity checks)
    submits if valid
    curates &Library inline (promote/prune/record)
  after all tasks:
    retries failed tasks with diagnostic prompts
    returns __arcSubmit.getResults()

TaskSolver (app: "arc2-solver")
  reads &Library (primitives, strategies, antiPatterns)
  writes &Library (taskLog entry, new primitives)
  reads __arcTasks[__arcCurrentTask] for task data
  explores patterns via code (hypothesis-driven)
  self-verifies with leave-one-out cross-validation
  returns JSON: { solved, confidence, answer }
```

## Invariants

```
invariants:

  - SANDBOX IS SHARED: All state passes through __arcLibrary on globalThis.
    Never serialize the library into child prompts. Children read it directly.

  - 2 SUBMISSIONS PER TASK: Hard limit enforced by harness. The orchestrator
    decides when to submit. The solver NEVER calls __arcSubmit.

  - KNOWLEDGE ONLY GROWS: Working primitives are never deleted from &Library.
    New tasks may add primitives, strategies, and taskLog entries. The orchestrator
    may prune anti-patterns to stay under budget, but never working code.

  - LEAVE-ONE-OUT BEFORE SUBMIT: The solver must validate its transform via
    leave-one-out cross-validation (when >= 3 training pairs) before returning
    solved=true. The orchestrator must run sanity checks before submitting.
    Two independent validation gates reduce false positives.

  - VERIFY-THEN-RETURN: Verification and return() MUST occur in separate
    iterations. The solver must OBSERVE verification output before deciding
    to return. Writing verification code and return() in the same iteration
    means you return before seeing whether verification passed.

  - ANTI-PATTERNS FROM GROUND TRUTH: Anti-patterns are recorded by the
    orchestrator based on submission correctness (result.correct), not
    solver self-report (logEntry.solved). Strategies are only promoted
    when the submission is actually correct.

  - ONE TASKLOG ENTRY PER DELEGATION: Each solver invocation pushes exactly
    one taskLog entry at the end of its run. No intermediate entries.

  - TRY-CATCH EVERYTHING: The orchestrator wraps every rlm() call in try-catch.
    Child timeouts and errors are recorded in taskLog, not propagated as crashes.
```
