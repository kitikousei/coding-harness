# Stage

You are running the write_implementation_plan stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/codegraph-impact.json
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/implementation-plan.json
- ${artifactRoot}/implementation-plan.md

# Allowed Tools

- read_file
- write_artifact
- codegraph_context
- codegraph_explore

# Sandbox

read-only for repository source files.

# Forbidden Actions

- Do not change code.
- Do not write outside declared output paths.
- Do not create branches.

# Completion Criteria

- implementation-plan.json matches schemas/implementation-plan.schema.json.
- implementation-plan.md contains file-level changes, step-by-step plan, test strategy, and rollback instructions.
