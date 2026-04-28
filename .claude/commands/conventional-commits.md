<!-- caipe-skill: claude/conventional-commits -->
---
name: conventional-commits
description: >
  Mandate Conventional Commits format and proper commit descriptions for all projects.
  Every commit must have a typed subject line, a meaningful description explaining the
  why, and optional footers (Assisted-by, Signed-off-by, breaking changes). Apply
  whenever a user is writing or reviewing a commit message.
---

# Conventional Commits

All commits **must** follow the [Conventional Commits v1.0](https://www.conventionalcommits.org/en/v1.0.0/)
specification. This enables automated changelogs, semantic versioning, and makes
history readable at a glance.

---

## Format

```
<type>(<scope>): <subject>

<body>

<footers>
```

Every part has rules — see below.

---

## Subject line (required)

```
<type>(<scope>): <subject>
```

| Rule | Detail |
|------|--------|
| **type** | One of the allowed types (see table below) |
| **scope** | Optional, in parentheses — the module, package, or area affected (e.g. `auth`, `api`, `helm`) |
| **subject** | Imperative, present tense. No capital first letter. No trailing period. Max 72 chars total. |

### Allowed types

| Type | When to use |
|------|-------------|
| `feat` | A new feature visible to users or callers |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace — no logic change |
| `refactor` | Code restructuring — no feature or bug change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system, Dockerfile, Makefile changes |
| `ci` | CI/CD workflow changes |
| `chore` | Maintenance: dependency bumps, generated files, tooling |
| `revert` | Reverts a previous commit |

### Good vs bad subjects

| Bad | Good |
|-----|------|
| `fix bug` | `fix(auth): reject tokens missing exp claim` |
| `Update stuff` | `chore(deps): bump golang.org/x/net to v0.20.0` |
| `WIP` | `feat(api): add pagination to /v1/events endpoint` |
| `changes` | `refactor(store): extract query builder into separate package` |

---

## Body (required for feat and fix; strongly recommended for all)

The body explains **why** the change was made, not what — the diff already shows what.

Rules:
- Separate from the subject with a **blank line**
- Wrap at **72 characters**
- Use complete sentences
- Reference the problem, the decision, and any trade-offs

### Good body example

```
fix(cache): evict stale entries before writing new values

The cache was growing unbounded because eviction only ran on read
paths, not on writes. Under write-heavy load this caused OOM kills
in production. Eviction now runs before every Put() call.
```

### Bad body example

```
fix(cache): evict stale entries before writing new values

Fixed the cache bug.
```

---

## Footers (optional but recommended for AI-assisted commits)

Footers appear after the body, separated by a blank line. Each footer is one line:

```
<token>: <value>
```

| Footer | When to use |
|--------|-------------|
| `Assisted-by: Claude:claude-sonnet-4-6` | Any commit with AI-assisted code (see dco-ai-attribution skill) |
| `Signed-off-by: Name <email>` | When the project requires DCO certification |
| `BREAKING CHANGE: <description>` | When the commit introduces a breaking API/contract change |
| `Fixes #<issue>` | To auto-close a GitHub issue on merge |
| `Refs #<issue>` | To link without closing |

`BREAKING CHANGE` in the footer (or a `!` after the type, e.g. `feat!:`) triggers a
**major** version bump in semantic versioning tools.

---

## Complete examples

### Feature with scope and body

```
feat(api): add cursor-based pagination to /v1/events

Offset pagination caused full table scans on large datasets.
Cursor-based pagination using the event ID as the cursor reduces
query cost from O(n) to O(log n) on the indexed column.

Refs #412
Assisted-by: Claude:claude-sonnet-4-6
Signed-off-by: Sri Aradhyula <sraradhy@example.com>
```

### Bug fix with breaking change

```
fix(auth)!: require explicit exp claim in all JWT tokens

Tokens without an exp claim were previously accepted, allowing
indefinitely valid sessions. This is now rejected at the middleware
layer. Clients must issue tokens with an explicit expiry.

BREAKING CHANGE: JWTs without an exp claim are now rejected with 401.
Signed-off-by: Sri Aradhyula <sraradhy@example.com>
```

### Chore (no body required)

```
chore(deps): bump helm/chart-testing-action from 2.6.0 to 2.7.0
```

### CI change

```
ci: add inclusive-language lint stage to all PRs

Assisted-by: Claude:claude-sonnet-4-6
```

---

## Checklist before committing

- [ ] Subject line uses an allowed `type`
- [ ] Subject is imperative, present tense, ≤ 72 chars total
- [ ] A body is present for `feat` and `fix` commits
- [ ] Body explains **why**, not just what
- [ ] Breaking changes are marked with `!` or `BREAKING CHANGE:` footer
- [ ] Relevant issue links added (`Fixes #N` or `Refs #N`)
- [ ] `Assisted-by` footer present if AI tools were used

---

## References

- Conventional Commits spec: <https://www.conventionalcommits.org/en/v1.0.0/>
- Semantic Versioning: <https://semver.org>
- DCO and AI attribution: see `dco-ai-attribution` skill
