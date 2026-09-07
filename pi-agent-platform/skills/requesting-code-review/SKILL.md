---
name: requesting-code-review
description: Review completed changes for correctness, regressions, missing tests, and risk before final reporting.
---

# Requesting Code Review

Before publishing a final report or merging work:

- Review the diff for behavioral regressions, security issues, and missing error paths.
- Check that tests cover the changed behavior and the failure modes that matter.
- Verify the relevant test and build commands have been run.
- Report concrete findings first, with file and line references where possible.

If no issues are found, state the remaining risk clearly instead of inventing findings.
