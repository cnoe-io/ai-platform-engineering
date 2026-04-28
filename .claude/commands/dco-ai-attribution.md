<!-- caipe-skill: claude/dco-ai-attribution -->
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
policy (`Documentation/process/coding-assistants.rst`). They apply to **all** projects
where the Developer Certificate of Origin (DCO) governs contributions.

---

## Core rule: AI must never add Signed-off-by

`Signed-off-by` is a **human-only** legal certification of the DCO. An AI agent must not
generate, suggest, or insert a `Signed-off-by` line on behalf of itself.

The human submitter is always responsible for:

1. Reviewing **all** AI-generated code before committing
2. Ensuring the contribution is license-compatible with the target project
3. Adding their **own** `Signed-off-by` to certify the DCO:

```
Signed-off-by: Your Name <you@example.com>
```

4. Taking full legal and ethical responsibility for the contribution

---

## Attribution: Assisted-by trailer

When a commit includes code materially assisted by an AI tool, add an `Assisted-by`
trailer so reviewers and maintainers understand how the code was produced.

### Format

```
Assisted-by: AGENT_NAME:MODEL_VERSION [TOOL1] [TOOL2]
```

| Field | Description |
|-------|-------------|
| `AGENT_NAME` | Name of the AI tool or agent framework |
| `MODEL_VERSION` | Specific model version used |
| `[TOOL1] [TOOL2]` | Optional: specialized analysis tools invoked (e.g. `coccinelle`, `sparse`, `smatch`, `clang-tidy`). Omit basic dev tools (git, gcc, make, editors). |

### Examples

```
# AI-only assistance, no extra tools
Assisted-by: Claude:claude-sonnet-4-6

# AI assistance plus static analysis
Assisted-by: Claude:claude-sonnet-4-6 clang-tidy

# Linux kernel example from the upstream doc
Assisted-by: Claude:claude-3-opus coccinelle sparse
```

---

## Complete commit message example

```
fix(auth): validate JWT expiry before returning user context

The expiry check was skipped when the token lacked an explicit 'exp'
claim, allowing stale tokens to authenticate. Add a strict check that
rejects tokens with no expiry.

Assisted-by: Claude:claude-sonnet-4-6
Signed-off-by: Sri Aradhyula <sraradhy@example.com>
```

---

## When to apply this

- Any commit that includes code written or significantly revised by an AI tool
- Code reviews of PRs where AI tools were used — ask the author to add `Assisted-by`
- CI linting: if your project enforces DCO (e.g. via `dco` GitHub App), the `Assisted-by`
  tag is purely informational and does not replace the human `Signed-off-by`

---

## Checklist before committing AI-assisted code

- [ ] I have read and understood every line of AI-generated code
- [ ] I can explain what the code does and why it is correct
- [ ] The code is license-compatible with the target project
- [ ] I have added my own `Signed-off-by` trailer
- [ ] I have added an `Assisted-by` trailer identifying the AI tool and model version
- [ ] No AI-generated `Signed-off-by` line is present

---

## References

- Linux kernel coding-assistants policy:
  `Documentation/process/coding-assistants.rst`
  <https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst>
- Developer Certificate of Origin: <https://developercertificate.org>
- Linux kernel submitting-patches guide:
  `Documentation/process/submitting-patches.rst`

---

## How this skill was developed

This skill was written with the assistance of Claude Code (model: `claude-sonnet-4-6`).
The policy content is derived verbatim from the Linux kernel's upstream documentation
(`Documentation/process/coding-assistants.rst`), which was authored by the kernel
community and is licensed under GPL-2.0.

```
Assisted-by: Claude:claude-sonnet-4-6
```
