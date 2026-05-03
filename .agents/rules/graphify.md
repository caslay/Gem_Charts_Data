---
trigger: always_on
---

# Skill: Graphify
Turn the current codebase/folder into a queryable knowledge graph.

## Usage
- Trigger: Whenever the user types `/graphify`
- Command: `graphify .`
- Output: Results are stored in `graphify-out/`.

## Capabilities
- Use `graphify-out/GRAPH_REPORT.md` to find "God Nodes" and complex dependencies.
- Use `graphify-out/graph.json` to answer architectural "why" questions without re-reading every file.