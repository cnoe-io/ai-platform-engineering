<!-- caipe-skill: claude/create-lint -->
---
name: create-lint
description: Creates a lint script (build/lint.sh or scripts/lint.sh) for a Go or Python service and wires it into the CI pipeline's checkout-unit-tests job. Use when a user asks to add linting, set up a linter, or create lint.sh for their project.
---

# Create Lint Script

Generate a `build/lint.sh` (Go) or `scripts/lint.sh` (Python) lint script and update
the CI pipeline to run it in the `checkout-unit-tests` job.

Reference implementations:
- Go: `cisco-eti/sre-go-helloworld/build/lint.sh` — calls `make lint`
- Python: `cisco-eti/platform-demo/scripts/lint.sh` — placeholder (extend with flake8/pylint)

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Language/stack**: Go or Python?
2. **Script location**: `build/lint.sh` (Go convention) or `scripts/lint.sh` (Python convention)?
3. **Go**: Does the project have a `Makefile` with a `lint` target? If not, use `golangci-lint` directly.
4. **Python**: Which linter — `flake8`, `pylint`, `ruff`, or a placeholder?
5. **Source directory to lint**: e.g. `./pkg/...`, `./app/src/`, `.`

### Step 2 — Generate lint.sh

### Step 3 — Wire into CI

Update `.github/workflows/ci.yaml` to call the lint script in `checkout-unit-tests`:

```yaml
      - name: Lint
        run: bash build/lint.sh
```

Add this step **before** the Unit Tests step.

---

## Script Templates

### Go: `build/lint.sh`

```bash
#!/bin/bash -e

make lint
```

Requires a `Makefile` with a `lint` target. Typical Go `Makefile` lint target:

```makefile
lint:
	golangci-lint run ./...
```

If no Makefile, use golangci-lint directly:

```bash
#!/bin/bash -e

golangci-lint run ./...
```

### Python: `scripts/lint.sh`

Minimal placeholder (matches platform-demo pattern):

```bash
#!/bin/bash -e

echo "Linting DONE"
```

With flake8:

```bash
#!/bin/bash -e

flake8 app/src/ --max-line-length=120 --exclude=__pycache__
```

With ruff (modern, faster):

```bash
#!/bin/bash -e

ruff check app/src/
```

---

## `.golangci.yml` (Go only)

If the project doesn't have a `.golangci.yml`, create one at the repo root.
The `sre-go-helloworld` reference config:

```yaml
# .golangci.yml
run:
  timeout: 5m

linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gofmt
    - goimports

linters-settings:
  goimports:
    local-prefixes: github.com/cisco-eti
```

---

## CI Integration

Update `.github/workflows/ci.yaml`, adding the lint step inside `checkout-unit-tests`:

```yaml
  checkout-unit-tests:
    name: checkout & unit test
    runs-on:
      group: arc-runner-set
    container:
      image: ${{ vars.DEFAULT_CONTAINER_RUNNER }}
      options: --user root
      credentials:
        username: ${{ secrets.GHCR_USERNAME }}
        password: ${{ secrets.GHCR_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.ref }}
          clean: true

      - name: Lint
        run: bash build/lint.sh      # ← add this

      - name: Unit Tests
        run: bash build/unit-test.sh
```

---

## Checklist

- [ ] Create `build/lint.sh` (or `scripts/lint.sh`) with correct permissions (`chmod +x`)
- [ ] Go: ensure `Makefile` has a `lint` target, or use golangci-lint directly
- [ ] Go: create `.golangci.yml` if not present
- [ ] Python: install linter in `requirements.txt` or CI image
- [ ] Update `ci.yaml` to call `bash build/lint.sh` before unit tests
- [ ] Verify lint passes locally before committing
