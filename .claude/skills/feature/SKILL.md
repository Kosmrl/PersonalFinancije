---
name: feature
description: Build a feature end-to-end with the agent team — architect plans, developer implements, test-writer tests, reviewer reviews.
argument-hint: <feature description>
disable-model-invocation: true
---

Build this feature for PersonalFinancije with the agent team in `.claude/agents/`:

$ARGUMENTS

You are the orchestrator. Delegate each step to the named agent, pass along what the next agent needs (plan path, changed files, findings), and keep the user informed between steps.

1. **Plan**: delegate to `architect` with the feature description. Show the user the plan summary, its path and its open questions. **Stop and wait for the user's approval and answers before any code is written.** Once approved, set the plan's status line to `Approved`.
   - Skip this step only if the change is trivial: one file, no schema, auth or money logic. Tell the user you skipped it.
2. **Implement**: delegate to `developer` with the approved plan's path. For a long build sequence, delegate one or two steps at a time and check the results in between.
3. **Test**: delegate to `test-writer` with the plan path and the list of changed files. If it reports bugs, send them to `developer` to fix, then run `test-writer` again.
4. **Review**: delegate to `reviewer` with the plan path. Send its blockers and should-fix findings to `developer`, then have `reviewer` re-check only the fixed parts. Do at most two fix rounds. After that, report what's still open instead of looping.
5. **Report**: tell the user what was built, the test results, the review verdict, and anything unresolved or worth checking by hand. Set the plan's status line to `Done`. Don't commit unless the user asks.
