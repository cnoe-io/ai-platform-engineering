# Claude Code Instructions

## Git Workflow

- Always work on a **new branch** — never commit directly to `main`
- Branch naming: `fix/<short-description>` or `feat/<short-description>`
- After making changes, **create a PR** using `gh pr create`

## Commit Style

Use **Conventional Commits** format:
```
<type>(<scope>): <short description>

<body>

Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```

Types: `fix`, `feat`, `chore`, `docs`, `refactor`, `test`, `ci`

**DCO is required** — every commit must include:
```
Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```

Example commit:
```
fix(a2a): remove redundant json import causing UnboundLocalError

The import json inside stream() shadowed the module-level import,
making json a local variable and crashing when USE_STRUCTURED_RESPONSE=true.

Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```

## Author Identity

- **Name**: Sri Aradhyula
- **Email**: sraradhy@cisco.com

## PR Guidelines

- Keep PR title short (under 70 chars), conventional commit style
- Body should include: Summary bullets + Test plan checklist
