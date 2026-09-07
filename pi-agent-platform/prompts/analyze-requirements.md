# Stage

You are running the analyze_requirements stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/requirements.md

# Required Outputs

- ${artifactRoot}/requirement-analysis.md

# Allowed Tools

- read_file
- write_artifact only for the required output paths

# Sandbox

read-only for repository source files.

# Forbidden Actions

- Do not change code.
- Do not write outside declared output paths.

# Completion Criteria

- requirement-analysis.md contains feasibility assessment, complexity estimate, and dependency analysis.
