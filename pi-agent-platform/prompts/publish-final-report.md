# Stage

You are running the publish_final_report stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/codegraph-impact.json
- ${artifactRoot}/implementation-plan.json
- ${artifactRoot}/implementation-notes.md
- ${artifactRoot}/test-result.json
- ${artifactRoot}/review.md
- ${artifactRoot}/diff.patch

# Required Outputs

- ${artifactRoot}/final-report.json
- ${artifactRoot}/final-report.md

# Allowed Tools

- read_file
- write_artifact

# Sandbox

read-only.

# Forbidden Actions

- Do not change code.
- Do not modify any file except declared outputs.

# Completion Criteria

- final-report.json matches schemas/final-report.schema.json.
- final-report.md contains executive summary, changed files, test results, and remaining risks.
