---
name: dco-ai-attribution
description: >
  DCO compliance and AI attribution guidelines for commits that include AI-assisted code.
  Enforces the Linux kernel coding-assistants policy: AI must never add Signed-off-by;
  humans certify the DCO; Assisted-by trailer documents AI tool usage. Apply whenever
  a user is committing AI-assisted code in any project.
---

# DCO and AI Attribution for AI-Assisted Commits

These rules are derived from the Linux kernel's official
[AI Coding Assistants](https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst)
policy. They apply to all projects where the DCO governs contributions.

---

## Core rule: AI must never add Signed-off-by

`Signed-off-by` is a human-only legal certification of the DCO. An AI agent must not
generate, suggest, or insert a `Signed-off-by` line on behalf of itself.

The human submitter is always responsible for:
1. Reviewing all AI-generated code before committing
2. Ensuring the contribution is license-compatible with the target project
3. Adding their own `Signed-off-by` to certify the DCO
4. Taking full legal and ethical responsibility for the contribution

---

## Attribution: Assisted-by trailer

Format:
  Assisted-by: AGENT_NAME:MODEL_VERSION [TOOL1] [TOOL2]

Examples:
  Assisted-by: Claude:claude-sonnet-4-6
  Assisted-by: Claude:claude-sonnet-4-6 clang-tidy
  Assisted-by: Claude:claude-3-opus coccinelle sparse

---

## Complete commit message example

  fix(auth): validate JWT expiry before returning user context

  The expiry check was skipped when the token lacked an explicit 'exp'
  claim, allowing stale tokens to authenticate.

  Assisted-by: Claude:claude-sonnet-4-6
  Signed-off-by: Sri Aradhyula <sraradhy@example.com>

---

## Pre-commit checklist

- [ ] I have read and understood every line of AI-generated code
- [ ] I can explain what the code does and why it is correct
- [ ] The code is license-compatible with the target project
- [ ] I have added my own Signed-off-by trailer
- [ ] I have added an Assisted-by trailer (AI tool + model version)
- [ ] No AI-generated Signed-off-by line is present

---

## How this skill was developed

Written with Claude Code (claude-sonnet-4-6). Policy content derived from the Linux
kernel's coding-assistants.rst, authored by the kernel community (GPL-2.0).

  Assisted-by: Claude:claude-sonnet-4-6
