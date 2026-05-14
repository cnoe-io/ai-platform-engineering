---
id: index
title: Coding-Agent Skills
sidebar_label: Overview
sidebar_position: 1
description: All Claude Code skills in .claude/skills/ — what each one does, when to use it, and how to invoke it.
---

# Coding-Agent Skills

Skills are plain Markdown playbooks that live in `.claude/skills/`. Any team member can invoke them with a `/skill-name` slash command in Claude Code, and the agent follows the same steps every time — consistent, reviewable, no ad-hoc prompting required.

---

## Available skills

### 📝 `/release-docs`

Generate a combined release blog post for a new version.

**Use when:** cutting a release or when someone asks "what changed in 0.4.x"

**Produces:** `docs/releases/YYYY-MM-DD-release-X-Y-Z.md` — release notes narrative + upgrade guide in one file, picked up by the Docusaurus releases blog plugin.

**Inputs:** to-version, from-version (auto-detected from git tags if omitted), optional `values.yaml` for personal impact analysis.

→ [View skill source](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.claude/skills/release-docs/SKILL.md)

---

### 🔄 `/update-docs`

Audit and sync all documentation surfaces after a release or feature addition.

**Use when:** after cutting a release, adding a new agent, or updating platform features.

**Checks:**

| # | Surface | Stale when… |
|---|---|---|
| 1 | Release blog posts | A git tag has no matching `docs/releases/` file |
| 2 | Homepage version string | Helm `--version` in `index.tsx` is behind latest tag |
| 3 | `lastVersion` config | `docusaurus.config.ts` points at wrong version |
| 4 | Version snapshot | No `versioned_docs/version-X.Y.Z/` for a tag |
| 5 | Features page tiles | New feature docs without a tile in `features.tsx` |
| 6 | Agent docs | Agent directory with no `docs/docs/agents/<name>.md` |
| 7 | Sidebar | Doc directory not in `sidebars.ts` |
| 8 | Navbar label | Version label behind latest tag |

→ [View skill source](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.claude/skills/update-docs/SKILL.md)

---

### 🧪 `/integration-testing`

Run the full end-to-end integration test suite against a running Docker Compose stack.

**Use when:** validating a feature branch before raising a PR, or after a major refactor.

→ [View skill source](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.claude/skills/integration-testing/SKILL.md)

---

### 📡 `/streaming-testing`

Compare A2A streaming behaviour across two supervisor versions side-by-side.

**Use when:** validating streaming correctness after changes to the supervisor or event pipeline.

→ [View skill source](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.claude/skills/streaming-testing/SKILL.md)

---

### 💾 `/persistence`

Test and manage LangGraph persistence backends (Redis, Postgres, MongoDB).

**Use when:** switching persistence backends, validating checkpoint isolation, or debugging cross-agent memory issues.

→ [View skill source](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.claude/skills/persistence/)

---

### 🚦 `/quality-gates`

Run all pre-commit quality gates — lint, Python tests, UI tests — in one command.

**Use when:** before raising a PR or after resolving merge conflicts.

```bash
# Run all gates
./skills/quality-gates/run_all.sh

# Auto-fix lint first, then validate
./skills/quality-gates/run_all.sh --fix
```

→ [View skill source](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.claude/skills/quality-gates/)

---

## Adding a new skill

See [Create a Skill](./create-skill) for the full guide. The short version:

1. Create `.claude/skills/<your-skill-name>/SKILL.md`
2. Add an entry to `.claude/skills/README.md`
3. Add a row to the table above

The skill is immediately available as `/your-skill-name` to anyone using Claude Code in this repo.
