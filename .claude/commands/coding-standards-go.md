<!-- caipe-skill: claude/coding-standards-go -->
---
name: coding-standards-go
description: >
  Apply Outshift Go coding standards to a Go project. Use when a user asks to
  set up golangci-lint, configure code style, add pre-commit hooks, or ensure
  their Go project meets Outshift coding conventions. Reference implementation:
  cisco-eti/sre-go-helloworld.
---

# Go Coding Standards

Enforce consistent Go code style and quality in Outshift services.
Reference implementation: `cisco-eti/sre-go-helloworld`.

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Go version**: 1.21, 1.22, 1.23?
2. **Module path**: from `go.mod` (e.g. `github.com/cisco-eti/my-service`)
3. **Swagger/OpenAPI docs**: Using `swaggo/swag`? (affects lint target)
4. **Pre-commit hooks**: Set them up?

### Step 2 — Create config files

### Step 3 — Wire into CI via `build/lint.sh`

---

## `.golangci.yml`

Based on `cisco-eti/sre-go-helloworld`:

```yaml
linters-settings:
  dupl:
    threshold: 100
  funlen:
    lines: 100
    statements: 50
  goconst:
    min-len: 2
    min-occurrences: 2
  gocritic:
    enabled-tags:
      - diagnostic
      - performance
      - style
    disabled-checks:
      - dupImport
      - ifElseChain
      - octalLiteral
      - wrapperFunc
  gocyclo:
    min-complexity: 15
  goimports:
    local-prefixes: github.com/cisco-eti
  lll:
    line-length: 140
  misspell:
    locale: US
  nolintlint:
    allow-leading-space: true
    allow-unused: false
    require-explanation: false
    require-specific: false
  whitespace:
    multi-if: true
    multi-func: true

linters:
  disable-all: true
  enable:
    - bodyclose
    - dogsled
    - dupl
    - exhaustive
    - funlen
    - goconst
    - gocyclo
    - gofmt
    - goimports
    - goprintffuncname
    - ineffassign
    - lll
    - misspell
    - nakedret
    - nolintlint
    - rowserrcheck
    - staticcheck
    - typecheck
    - unconvert
    - whitespace

issues:
  exclude-rules:
    - path: _test\.go
      linters:
        - gomnd
    - linters:
        - gocritic
      text: "unnecessaryDefer:"
  exclude-dirs:
    - vendor
```

---

## `Makefile`

Based on `cisco-eti/sre-go-helloworld`:

```makefile
SHELL := /bin/bash
PROJECT_NAME = my-service
GO_FILES = $(shell go list ./... | grep -v /vendor/)

GO_BUILD_ENV ?= CGO_ENABLED=0
BUILD_VERSION ?= latest

.PHONY: all build test lint fmt vet clean

all: fmt lint vet test build

build:
	$(GO_BUILD_ENV) go mod verify
	$(GO_BUILD_ENV) go build -ldflags "-X main.buildVersion=$(BUILD_VERSION)" \
	  -o ./$(PROJECT_NAME).bin ./cmd/$(PROJECT_NAME)/.

test:
	go test --cover -count=1 $(GO_FILES)

cover:
	go test -coverprofile=coverage.out $(GO_FILES)
	go tool cover -html=coverage.out -o coverage.html

lint:
	go fmt ./...
	golangci-lint run -v

fmt:
	go fmt $(GO_FILES)

vet:
	go vet $(GO_FILES)

clean:
	rm -f $(PROJECT_NAME).bin coverage.out coverage.html
```

---

## `build/lint.sh`

```bash
#!/bin/bash -e

make lint
```

---

## `build/unit-test.sh`

```bash
#!/bin/bash -e

go test --cover -count=1 ./...
```

Or with Makefile:

```bash
#!/bin/bash -e

make test
```

---

## Pre-commit hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/dnephin/pre-commit-golang
    rev: v0.5.1
    hooks:
      - id: go-fmt
      - id: go-vet
      - id: go-lint
      - id: go-unit-tests

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-merge-conflict
      - id: check-added-large-files
```

For the git hooks from `sre-go-helloworld` (gofmt + staticcheck):

```bash
# .github/githooks/pre-commit — symlink or copy to .git/hooks/pre-commit
#!/bin/bash
bash .github/githooks/gofmt_checks
```

---

## Directory layout conventions

```
<service>/
├── cmd/
│   └── <service>/
│       └── main.go        # entry point
├── pkg/
│   └── app/
│       ├── app.go
│       ├── handlers.go
│       └── health.go
├── build/
│   ├── Dockerfile
│   ├── lint.sh
│   └── unit-test.sh
├── deploy/
│   └── charts/
│       └── <service>/
├── go.mod
├── go.sum
├── Makefile
└── .golangci.yml
```

---

## Naming conventions

| Element | Convention | Example |
|---------|------------|---------|
| Packages | lowercase, single word | `app`, `handlers` |
| Files | `snake_case` | `health_check.go` |
| Exported types / funcs | `PascalCase` | `HealthChecker`, `GetStatus()` |
| Unexported | `camelCase` | `parseResponse()` |
| Constants | `PascalCase` (exported) or `camelCase` | `MaxRetries`, `defaultTimeout` |
| Interfaces | noun or `-er` suffix | `Scanner`, `HealthChecker` |
| Test files | `*_test.go` | `handlers_test.go` |

---

## Code quality rules

- **Line length**: 140 characters max (matches `lll` config).
- **Error handling**: Always check errors. Never `_` an error from a function that can fail.
- **Goroutines**: Always handle panics in goroutines. Cancel contexts properly.
- **Logging**: Use structured logging (`log/slog` or `zap`). Never `fmt.Print` in production code.
- **Secrets**: Never hardcode. Use environment variables or Vault-backed ExternalSecrets.
- **Context**: Pass `context.Context` as the first parameter in functions that do I/O.
- **`//nolint`**: Require a comment explaining why.
- **Tests**: Table-driven tests preferred. Test files end in `_test.go`. Use `testify/assert`.

---

## CI integration

```yaml
# .github/workflows/ci.yaml — inside checkout-unit-tests
      - name: Lint
        run: bash build/lint.sh

      - name: Unit Tests
        run: bash build/unit-test.sh
```

---

## Checklist

- [ ] `.golangci.yml` at repo root
- [ ] `Makefile` with `build`, `test`, `lint`, `fmt`, `vet` targets
- [ ] `build/lint.sh` calling `make lint`
- [ ] `build/unit-test.sh` calling `go test` or `make test`
- [ ] Pre-commit hooks installed
- [ ] `ci.yaml` calls `bash build/lint.sh` before unit tests
- [ ] No hardcoded secrets
- [ ] `CGO_ENABLED=0` in build for static binary
