# Stage

You are running the fix_test_failures stage for task ${taskId} (attempt ${attempt}).

# Inputs

- ${artifactRoot}/test-result.json
- ${artifactRoot}/test-output.log
- ${artifactRoot}/implementation-plan.json
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/fix-attempt-${attempt}.md
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
- Do not make unrelated refactors.
- Do not remove failing tests.

# Completion Criteria

- fix-attempt-${attempt}.md describes the root cause and the fix applied.
- diff.patch contains the updated git diff.
- Only code that caused test failures or closely related code is modified.
