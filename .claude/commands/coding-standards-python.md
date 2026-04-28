<!-- caipe-skill: claude/coding-standards-python -->
---
name: coding-standards-python
description: >
  Apply Outshift Python coding standards to a Python project. Use when a user
  asks to set up code style, configure a linter, add pre-commit hooks, or
  ensure their Python project meets Outshift coding conventions. Reference
  implementation: cisco-eti/platform-demo.
---

# Python Coding Standards

Enforce consistent Python code style and quality in Outshift services.
Reference implementation: `cisco-eti/platform-demo`.

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Python version**: 3.10, 3.11, 3.12?
2. **Linter preference**: `ruff` (modern, fast, recommended) or `flake8` + `pylint`?
3. **Formatter**: `ruff format` (recommended) or `black`?
4. **Type checking**: `mypy`? (optional but recommended for new projects)
5. **Pre-commit hooks**: Set them up? (recommended)

### Step 2 — Install and configure tools

### Step 3 — Wire into CI

Update `scripts/lint.sh` and ensure `ci.yaml` calls it.

---

## Formatter: `ruff` (recommended)

```toml
# pyproject.toml
[tool.ruff]
line-length = 120
target-version = "py311"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle errors
    "W",   # pycodestyle warnings
    "F",   # pyflakes
    "I",   # isort
    "B",   # flake8-bugbear
    "C4",  # flake8-comprehensions
    "UP",  # pyupgrade
]
ignore = [
    "E501",  # line too long (handled by formatter)
    "B008",  # do not perform function calls in default arguments
]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

---

## Linter: `flake8` (if not using ruff)

```ini
# setup.cfg or .flake8
[flake8]
max-line-length = 120
exclude =
    .git,
    __pycache__,
    .venv,
    build,
    dist
ignore =
    E203,  # whitespace before ':'
    W503   # line break before binary operator
```

---

## Type Checking: `mypy` (optional)

```toml
# pyproject.toml
[tool.mypy]
python_version = "3.11"
strict = false
ignore_missing_imports = true
disallow_untyped_defs = true
warn_return_any = true
warn_unused_ignores = true
```

---

## `scripts/lint.sh`

```bash
#!/bin/bash -e

# Format check (ruff)
ruff format --check app/src/

# Lint (ruff)
ruff check app/src/
```

Or with flake8:

```bash
#!/bin/bash -e

flake8 app/src/ --max-line-length=120
```

---

## `requirements-dev.txt`

```
ruff>=0.4.0
mypy>=1.8.0
pytest>=8.0.0
pytest-cov>=5.0.0
```

---

## Pre-commit hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
      - id: check-merge-conflict
```

Install: `pre-commit install`

---

## Directory layout conventions

```
<service>/
├── app/
│   ├── requirements.txt       # runtime dependencies
│   └── src/
│       ├── server.py          # entry point
│       ├── health_check.py
│       └── ...
├── requirements-dev.txt       # dev/lint/test dependencies
├── scripts/
│   ├── lint.sh
│   └── unit-test.sh
├── pyproject.toml             # ruff/mypy config
└── build/
    └── Dockerfile
```

---

## Naming conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files / modules | `snake_case` | `health_check.py` |
| Classes | `PascalCase` | `HealthChecker` |
| Functions / variables | `snake_case` | `check_status()` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRIES = 3` |
| Private members | `_leading_underscore` | `_internal_helper()` |

---

## Code quality rules

- **Line length**: 120 characters max.
- **Imports**: sorted (isort / ruff-I). Standard library → third-party → local. No wildcard imports.
- **Docstrings**: Google style for public functions and classes.
- **Error handling**: Always catch specific exceptions. Never bare `except:`.
- **Logging**: Use `logging` module, not `print`. Include structured context.
- **Secrets**: Never hardcode. Use environment variables or Vault-backed ExternalSecrets.
- **Type hints**: Use on all public function signatures for new code.

---

## CI integration

```yaml
# .github/workflows/ci.yaml — inside checkout-unit-tests
      - name: Lint
        run: bash scripts/lint.sh

      - name: Unit Tests
        run: bash scripts/unit-test.sh
```

---

## Checklist

- [ ] `pyproject.toml` with ruff config (or `.flake8`)
- [ ] `scripts/lint.sh` calling ruff/flake8
- [ ] `scripts/unit-test.sh` calling pytest
- [ ] `requirements-dev.txt` with lint + test deps
- [ ] `.pre-commit-config.yaml` installed
- [ ] `ci.yaml` calls `bash scripts/lint.sh` before unit tests
- [ ] No hardcoded secrets or credentials in source
