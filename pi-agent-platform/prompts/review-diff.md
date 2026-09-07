# Stage

You are running the review_diff stage for task ${taskId}.

# Inputs

- ${artifactRoot}/diff.patch
- ${artifactRoot}/requirements.json
- ${artifactRoot}/implementation-plan.json
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/review.md

# Allowed Tools

- read_file
- write_artifact
- terminal

# Sandbox

read-only for repository source files.

# Forbidden Actions

- Do not change code.
- Do not push to remote.

# Completion Criteria

- review.md contains code quality assessment, test coverage review, security concerns, and approval recommendation.
