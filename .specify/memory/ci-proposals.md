# CI Proposal Rules

**Created**: 2026-04-21
**Origin**: RC deployment fiasco — agent oversold a "single clean workflow" approach that actually required 3 manual steps due to GitHub Actions token limitations.

## Rule: Full End-to-End Flow Required

When proposing ANY CI/CD change — no matter how small — the agent MUST present the **complete flow** before the user commits to the approach. This includes:

1. **Every workflow/job involved** — not just the one being added/modified, but every downstream workflow that must fire
2. **Trigger chain** — exactly what triggers what, including:
   - Push events, tag events, workflow_dispatch, workflow_run, etc.
   - Which token is used (GITHUB_TOKEN vs PAT) and whether it can trigger downstream workflows
   - GitHub Actions limitation: pushes/tags created by `github-actions[bot]` using `GITHUB_TOKEN` do NOT trigger other workflows (infinite loop prevention)
3. **Manual steps required** — any `workflow_dispatch` or human intervention needed in the chain
4. **Permissions and secrets** — what secrets/permissions each step needs
5. **Failure modes** — what happens if any step in the chain fails; how to recover
6. **Comparison with alternatives** — especially simpler in-code alternatives. Do NOT dismiss simpler options without explaining the full cost of the CI approach.

## Anti-Patterns to Avoid

- Saying "one workflow handles it" when there's a downstream dependency chain
- Glossing over token limitations between workflows
- Presenting CI automation as "clean" when it requires manual triggers
- Overselling elegance over simplicity (violates Constitution Principle I: Worse is Better)

## Lesson Learned

A simple in-code or in-chart change is often better than a multi-workflow CI solution. The Constitution says "simplicity of implementation wins." Apply that to CI too.
