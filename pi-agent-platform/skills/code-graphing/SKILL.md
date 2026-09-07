---
name: code-graphing
description: Use CodeGraph MCP tools for structural code analysis and impact mapping.
---

# Code Graphing

Use CodeGraph for structural questions before reading files manually:

- Use `codegraph_context` to identify relevant symbols, call paths, and files.
- Use `codegraph_explore` to read grouped source for the symbols you need.
- Use `codegraph_impact` when the task asks what changes could affect.

Use text search only for literal strings such as log messages, comments, or exact user-facing copy.

For the `codegraph_impact` stage, produce:

- Entry points involved in the requested change.
- Affected files and symbols.
- Tests that should be run or added.
- Risks, assumptions, and open questions.

If CodeGraph is unavailable or not initialized for the worktree, stop and report the stage as blocked instead of guessing.
