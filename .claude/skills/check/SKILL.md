---
name: check
description: Run typecheck, lint, tests and build via the scout agent, and summarize what fails.
disable-model-invocation: true
context: fork
agent: scout
background: false
---

Run PersonalFinancije's checks and report the results.

1. Find the commands in the Commands section of `CLAUDE.md`, falling back to the scripts in `package.json`. If neither has them yet, say so and stop.
2. Run, in order: typecheck, lint, unit tests, build. Run e2e tests only if they were asked for: $ARGUMENTS
3. Report one line per check (pass/fail). For each failure, group errors by file, give the first error for each distinct cause with `file:line`, and suggest which agent should fix it.
