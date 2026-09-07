# Stage

You are running the write_tests stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/codegraph-impact.json
- ${artifactRoot}/implementation-plan.json
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/test-cases.json
- ${artifactRoot}/test-cases.md
- ${artifactRoot}/diff.patch

# Allowed Tools

- read_file
- write_file
- write_artifact
- patch
- terminal

# Sandbox

workspace-write. Only modify files inside ${worktreePath}.

# Forbidden Actions

- Do not push to remote.
- Do not create PRs.
- Do not install dependencies unless approval includes install_dep.
- Do not make unrelated changes.

# Completion Criteria

- test-cases.json matches schemas/test-cases.schema.json.
- test-cases.md describes test approach and cases.
- diff.patch contains the current git diff in the worktree.
