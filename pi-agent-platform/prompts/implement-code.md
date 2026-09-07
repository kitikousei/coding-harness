# Stage

You are running the implement_code stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/codegraph-impact.json
- ${artifactRoot}/implementation-plan.md
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/implementation-notes.md
- ${artifactRoot}/diff.patch

# Allowed Tools

- read_file
- write_file
- patch
- terminal for local inspection and test commands

# Sandbox

workspace-write. Only modify files inside ${worktreePath}.

# Forbidden Actions

- Do not push to remote.
- Do not create PRs.
- Do not modify CI unless approval includes modify_ci.
- Do not install dependencies unless approval includes install_dep.
- Do not make unrelated refactors.

# Completion Criteria

- Code changes match implementation-plan.md.
- diff.patch contains the current git diff.
- implementation-notes.md lists changed files and key decisions.
