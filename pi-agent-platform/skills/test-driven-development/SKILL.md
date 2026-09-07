---
name: test-driven-development
description: Write failing tests before production changes, then implement the smallest code change that passes them.
---

# Test Driven Development

Before changing production behavior:

- Write a focused failing test that describes the behavior that should exist.
- Run it and confirm it fails for the expected reason.
- Implement the smallest production change needed to pass.
- Re-run the focused test and then the relevant wider suite.

Prefer tests that assert observable behavior over tests that mirror implementation details. Keep mocks limited to slow or external boundaries.
