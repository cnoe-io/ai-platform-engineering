<!-- caipe-skill: claude/create-skill -->
---
name: create-skill
description: >
  Scaffold a new skill directory with a properly formatted SKILL.md file.
  Use when a user wants to create a new skill, write a SKILL.md, or add
  a skill to this repository. Enforces YAML frontmatter safety rules and
  follows the conventions of existing Outshift skills.
---

# Create Skill

Scaffold a new `<skill-name>/SKILL.md` in this repository with correct YAML
frontmatter and body structure. Prevents the silent-skip bug where `yaml.safe_load`
fails on unquoted `: ` inside inline description values.

---

## Process

### Step 1 — Gather requirements

Ask the user:

1. **Skill name** — lowercase, hyphenated (e.g. `create-widget`, `coding-standards-java`).
   This becomes both the directory name and the `name:` frontmatter field.
2. **Skill type** — determines body template:
   - **Process** — step-by-step guide that creates or configures something
     (e.g. `create-lint`, `create-go-dockerfile`, `coding-standards-go`)
   - **Policy / standard** — rules, format spec, and examples to follow
     (e.g. `dco-ai-attribution`, `conventional-commits`)
   - **Checklist** — scored/checkbox audit
     (e.g. `production-readiness`)
3. **Purpose** — one-sentence summary of what the skill does (becomes the description).
4. **Trigger phrases** — when should this skill activate? ("Use when a user asks to ...")
5. **Reference implementation** — a `cisco-eti/` repo that demonstrates the pattern (if any).

### Step 2 — Create directory and SKILL.md with frontmatter

```bash
mkdir -p <skill-name>
```

Write the frontmatter block following the rules in the next section.

### Step 3 — Write the body

Use the template matching the skill type (see Body Templates below).

### Step 4 — Validate

Run the YAML parse check to confirm the frontmatter loads without error:

```python
python3 -c "
import yaml, re
content = open('<skill-name>/SKILL.md').read()
match = re.match(r'^---\s*\n(.*?)\n---\s*\n?', content, re.DOTALL)
assert match, 'No frontmatter found'
data = yaml.safe_load(match.group(1))
assert isinstance(data, dict), f'Parsed as {type(data)}, not dict'
assert data.get('name'), 'Missing name'
assert data.get('description'), 'Missing description'
print(f'OK: name={data[\"name\"]!r}, description={str(data[\"description\"])[:60]!r}...')
"
```

### Step 5 — Register the skill

Add a row for the new skill in **all three** index files:

| File | Table to update |
|------|----------------|
| `AGENTS.md` | "Available Skills" table |
| `CLAUDE.md` | "Available Skills" table |
| `README.md` | Skills table |

---

## YAML Frontmatter Rules

These rules prevent the supervisor's `_build_skill_dict` from silently skipping
a skill due to a YAML parse failure.

### Required fields

| Field | Rule |
|-------|------|
| `name` | Must match the directory name exactly. Lowercase, hyphenated. |
| `description` | One paragraph. Start with a verb. Include "Use when ..." trigger phrases. |

No other frontmatter fields are required (the supervisor ignores them for loading).

### Always use the block scalar (`>`) for description

```yaml
# CORRECT — block scalar folds lines into one paragraph
description: >
  Creates a Helm chart for a service following Outshift conventions. Use when a
  user asks to create a Helm chart, add Kubernetes deployment manifests, or set
  up deploy/charts/ for a new service. Reference implementations:
  cisco-eti/platform-demo (Python), cisco-eti/sre-go-helloworld (Go).
```

### Never put `: ` in an inline description

```yaml
# BROKEN — yaml.safe_load sees "implementation:" as a mapping key
description: Creates a Helm chart. Reference implementation: cisco-eti/platform-demo.
```

This causes `yaml.safe_load` to raise `mapping values are not allowed here`,
the `except yaml.YAMLError` clause returns `{}`, description becomes empty,
and the skill is silently skipped with "missing name or description".

The block scalar (`>`) avoids this because continuation lines are treated as
a string literal, not parsed for YAML constructs.

### Description style guide

- Start with a verb ("Creates ...", "Add ...", "Explains ...", "Apply ...")
- Include "Use when a user ..." trigger phrases so the supervisor can match intent
- Mention reference implementations if applicable
- Keep under ~300 characters when folded into a single line
- Wrap lines at ~80 columns in the SKILL.md source

---

## Body Templates

### Process skill (create-*, coding-standards-*)

```markdown
# <Title>

One-paragraph summary of what this skill produces.

Reference: `cisco-eti/<repo>`

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. ...
2. ...

### Step 2 — Generate <artifact>

### Step 3 — Wire into CI (if applicable)

---

## Templates

### <Variant A>

\```yaml
# template content
\```

### <Variant B>

\```yaml
# template content
\```

---

## Checklist

- [ ] Item 1
- [ ] Item 2
```

### Policy / standard skill (dco-ai-attribution, conventional-commits)

```markdown
# <Title>

Source / authority for this policy.

---

## Core rule

Explanation of the main rule.

---

## Format

\```
Template or format spec
\```

| Field | Description |
|-------|-------------|
| ... | ... |

### Examples

\```
Example 1
Example 2
\```

---

## When to apply

- Bullet list of trigger conditions

---

## Checklist

- [ ] Item 1
- [ ] Item 2

---

## References

- Link 1
- Link 2
```

### Checklist skill (production-readiness)

```markdown
# <Title>

Source link. Summary of scoring or pass criteria.

---

## Scoring summary

| Category | Items | Score |
|----------|-------|-------|
| ... | ... | _/N |

---

## 1. Category Name (N points)

- [ ] Checklist item
- [ ] Checklist item

> How to verify: ...

---

## References

- Link 1
- Link 2
```

---

## Skeleton Template

Copy this starter and fill in the blanks:

```markdown
---
name: <skill-name>
description: >
  <One paragraph. Start with a verb. Include "Use when ..." trigger phrases.>
---

# <Skill Title>

<One-paragraph summary.>

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. ...

### Step 2 — Generate output

---

## Checklist

- [ ] Skill directory created with correct name
- [ ] SKILL.md frontmatter passes YAML validation
- [ ] Skill registered in AGENTS.md, CLAUDE.md, README.md
```

---

## Validation Checklist

Before merging a new skill:

- [ ] Directory name is lowercase, hyphenated, matches `name:` in frontmatter
- [ ] `description:` uses block scalar (`>`) — no inline `: ` that could break YAML
- [ ] YAML parse check passes (Step 4 above)
- [ ] Body follows one of the three templates (process / policy / checklist)
- [ ] Sections separated by `---` horizontal rules
- [ ] Code blocks use fenced syntax with language tags
- [ ] Skill added to `AGENTS.md` Available Skills table
- [ ] Skill added to `CLAUDE.md` Available Skills table
- [ ] Skill added to `README.md` skills table
