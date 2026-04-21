---
name: dco-ai-attribution
description: >
  DCO sign-off and AI attribution guidelines for commits that include
  AI-assisted code. AI coding agents may add Signed-off-by on the human
  author's behalf when the user has explicitly authorized AI-assisted
  commits in this repository. Always include a simple Assisted-by line
  to credit the AI tool. Apply whenever a user is committing AI-assisted
  code in this project.
---

# DCO and AI Attribution for AI-Assisted Commits

These rules apply to all commits in this repository, including those
authored or co-authored by AI coding agents.

> **Project policy:** AI coding agents operating in this repository **may**
> add `Signed-off-by` on behalf of the configured git user
> (`user.name` / `user.email`). The human submitter remains fully
> responsible for the contents of every commit and must review the diff
> before the commit is pushed.

---

## Sign-off rule

Use `git commit -s` (or include the `Signed-off-by` trailer manually) on
every commit. The trailer must match the configured git author:

  Signed-off-by: Your Name <your.email@example.com>

The human submitter is always responsible for:

1. Reviewing all AI-generated code before it is pushed
2. Ensuring the contribution is license-compatible with the project
3. Standing behind the `Signed-off-by` trailer as the legal certification

---

## Attribution: Assisted-by line

Add a single-line `Assisted-by` note in the commit body when AI materially
contributed to the commit.

**Format (best-effort model):**

  Assisted-by <tool> (model: <model>)

Do **not** put a colon directly after `Assisted-by` — GitHub's DCO check
parses `Trailer-Name:` lines as signature trailers and will reject the
commit. Use a space after `Assisted-by`. A colon inside the parenthetical
(`(model: ...)`) is fine because the parser only looks at the first token.

The agent fills in what it actually knows. If the runtime cannot
determine the model identifier reliably (most CLIs do not expose it as
an env var), write `(model: unknown)` so the human author can correct
it during review rather than guessing a stale model string.

**Examples:**

  Assisted-by claude (model: opus-4.7)
  Assisted-by claude (model: sonnet-4-6)
  Assisted-by cursor (model: unknown)
  Assisted-by gemini (model: 2.5-pro)
  Assisted-by codex (model: gpt-5)

For other AI tools, substitute the tool name and its model identifier
(or `unknown`).

---

## Complete commit message example

  fix(auth): validate JWT expiry before returning user context

  The expiry check was skipped when the token lacked an explicit 'exp'
  claim, allowing stale tokens to authenticate.

  Assisted-by claude (model: opus-4.7)

  Signed-off-by: John Doe <john@example.com>

---

## Pre-commit checklist

- [ ] I have read every line of AI-generated code in this commit
- [ ] I can explain what the code does and why it is correct
- [ ] The code is license-compatible with this project
- [ ] `Signed-off-by` matches the configured git author
- [ ] `Assisted-by <tool> (model: <model-or-unknown>)` is present when AI was involved (no colon directly after `Assisted-by`)
