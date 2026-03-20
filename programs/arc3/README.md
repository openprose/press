---
purpose: ARC-AGI-3 interactive game solver program — multi-agent architecture for playing ARC-AGI-3 games via REST API
related:
  - ../README.md
  - ../../eval/README.md
  - ../../arc3-docs/README.md
---

# programs/arc3

RLM program for solving ARC-AGI-3 interactive games.

ARC-AGI-3 games are played via REST API rather than static datasets. This program defines a multi-agent architecture that manages game state, plans moves, and executes actions through the API.

## Contents

- `root.md` — Root agent entry point; initializes game session and coordinates sub-agents
- `game-solver.md` — Game-level solver: understands game rules, plans overall strategy
- `level-solver.md` — Level-level solver: executes specific moves for individual game levels
- `oha.md` — Observer-Handler-Actor composite variant for game play
