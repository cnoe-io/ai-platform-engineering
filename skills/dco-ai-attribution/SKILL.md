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

## Core rule: AI must never add Signed-off-by — **except under explicit human authorization**

`Signed-off-by` is a human-only legal certification of the DCO. By default, an AI agent
must not generate, suggest, or insert a `Signed-off-by` line on behalf of itself or on
behalf of a human author.

The human submitter is always responsible for:
1. Reviewing all AI-generated code before committing
2. Ensuring the contribution is license-compatible with the target project
3. Adding their own `Signed-off-by` to certify the DCO
4. Taking full legal and ethical responsibility for the contribution

### Explicit-authorization carve-out (delegated DCO sign-off)

A human author MAY explicitly delegate `Signed-off-by` insertion to an AI agent for a
bounded session. When that delegation is present, the agent should run `git commit -s`
(or otherwise append a `Signed-off-by: <human name> <human email>` line) on the human's
behalf, using the git identity already configured on the human's machine
(`git config user.name`, `git config user.email`).

Strict requirements for the carve-out:

1. **Explicit, contemporaneous authorization.** The human must have stated, in the
   current chat session or a session-scoped instruction, words equivalent to
   "you may sign off as me", "use `git commit -s` on my behalf", "I delegate DCO
   sign-off to you for this session", or an equivalent unambiguous grant.
   Standing instructions in `CLAUDE.md` / `AGENTS.md` count as session-scoped only
   when the human has acknowledged them in the current conversation.
2. **Human identity only.** The agent must use the human's configured git identity.
   The agent must never sign off as itself or as a fictitious identity.
3. **Attribution still required.** The `Assisted-by` trailer is still mandatory on
   any commit where the agent materially contributed code. The carve-out does not
   relax attribution; it only delegates the keystroke.
4. **Same legal effect.** The human is still legally certifying the DCO. By
   authorizing the agent to sign off on their behalf, the human is making the
   same DCO certification they would make by typing `-s` themselves. The agent
   is acting as a typing aid, not as a legal party.
5. **Revocable at any time.** If the human says "stop signing off as me",
   "remove the carve-out", or similar, the agent immediately reverts to the
   default rule and never signs off again in that session.
6. **Audit trail.** When operating under the carve-out, the agent should make
   the delegation visible — for example, by mentioning in the conversation
   that it is signing off on the human's behalf per their authorization, so
   the chat transcript itself documents the delegation.

If any of the above conditions are unclear, the agent must default to the strict
rule (do not sign off; ask the human to add `-s` themselves).

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

## Pre-commit checklist (default rule)

- [ ] I have read and understood every line of AI-generated code
- [ ] I can explain what the code does and why it is correct
- [ ] The code is license-compatible with the target project
- [ ] I have added my own Signed-off-by trailer
- [ ] I have added an Assisted-by trailer (AI tool + model version)
- [ ] No AI-generated Signed-off-by line is present

## Pre-commit checklist (under explicit-authorization carve-out)

- [ ] The human author granted explicit, contemporaneous authorization in this session
- [ ] The agent is signing off using the human's configured git identity
      (`git config user.name` / `git config user.email`)
- [ ] The Assisted-by trailer is still present
- [ ] The delegation is visible somewhere in the conversation transcript
- [ ] The human reviewed the diff before authorizing the commit (or pre-authorized
      a bounded scope of work, e.g. "implement spec 102 and 103 and sign off as me")

---

## How this skill was developed

Written with Claude Code (claude-sonnet-4-6). Policy content derived from the Linux
kernel's coding-assistants.rst, authored by the kernel community (GPL-2.0).

  Assisted-by: Claude:claude-sonnet-4-6
