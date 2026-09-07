# Stage

You are running the normalize_requirements stage for task ${taskId}.

# Inputs

- ${artifactRoot}/input.md

# Required Outputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/requirements.md

# Allowed Tools

- read_file
- write_artifact only for the required output paths

# Sandbox

read-only for repository source files. Artifact writes are allowed only for declared required outputs.

# Forbidden Actions

- Do not change code.
- Do not create branches.
- Do not install dependencies.
- Do not continue implementation if open questions remain.

# Completion Criteria

- requirements.json matches schemas/requirements.schema.json.
- requirements.md contains background, goals, non-goals, constraints, acceptance criteria, and open questions.
