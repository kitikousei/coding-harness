# Stage

You are running the codegraph_impact stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/codegraph-impact.json
- ${artifactRoot}/codegraph-impact.md

# Allowed Tools

- read_file
- write_artifact
- codegraph_context
- codegraph_explore
- codegraph_impact

# Sandbox

read-only for repository source files.

# Forbidden Actions

- Do not change code.
- Do not write outside declared output paths.

# Completion Criteria

- codegraph-impact.json matches schemas/impact.schema.json.
- codegraph-impact.md contains entrypoints, affected files, test targets, and risks.
