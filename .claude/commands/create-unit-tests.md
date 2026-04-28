<!-- caipe-skill: claude/create-unit-tests -->
---
name: create-unit-tests
description: Creates a unit test script (build/unit-test.sh or scripts/unit-test.sh) for a Go or Python service and wires it into the CI pipeline. Use when a user asks to add unit tests, set up a test script, or create unit-test.sh for their project.
---

# Create Unit Test Script

Generate a `build/unit-test.sh` (Go) or `scripts/unit-test.sh` (Python) test runner
script and update the CI pipeline's `checkout-unit-tests` job to run it.

Reference implementations:
- Go: `cisco-eti/sre-go-helloworld/build/unit-test.sh`
- Python: `cisco-eti/platform-demo/scripts/unit-test.sh`

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Language/stack**: Go or Python?
2. **Script location**: `build/unit-test.sh` (Go convention) or `scripts/unit-test.sh` (Python)?
3. **Go**: Does the project have a `Makefile` with a `test` target?
4. **Go**: Coverage reports needed? (generates `coverage.out`)
5. **Python**: Test framework — `pytest` (default) or `unittest`?
6. **Python**: Test directory — `app/src/`, `tests/`, `.`?

### Step 2 — Generate unit-test.sh

### Step 3 — Wire into CI

Verify `.github/workflows/ci.yaml` `checkout-unit-tests` job references the script:

```yaml
      - name: Unit Tests
        run: bash build/unit-test.sh
```

---

## Script Templates

### Go: `build/unit-test.sh`

Minimal (matches sre-go-helloworld — tests run inside Docker build):

```bash
#!/bin/bash -e

# Tests are run inside the Docker build stage.
# To run locally: make test
echo "UNIT-TEST DONE"
```

With go test directly:

```bash
#!/bin/bash -e

go test -v ./...
```

With coverage:

```bash
#!/bin/bash -e

go test -v -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
```

With Makefile:

```bash
#!/bin/bash -e

make test
```

### Python: `scripts/unit-test.sh`

Minimal placeholder (matches platform-demo):

```bash
#!/bin/bash -e

echo "UNIT-TEST DONE"
```

With pytest:

```bash
#!/bin/bash -e

python3 -m pytest app/src/ -v
```

With coverage:

```bash
#!/bin/bash -e

python3 -m pytest app/src/ -v --cov=app/src/ --cov-report=term-missing
```

---

## Go `Makefile` `test` target

If the project uses `make test`:

```makefile
test:
	go test -v ./... -coverprofile=coverage.out

test-in-docker:
	docker build --build-arg CODE_COVERAGE=cc -t $(IMAGE_NAME):test .
```

---

## CI Integration

The `checkout-unit-tests` job in `ci.yaml` should call the test script:

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
        run: bash build/lint.sh     # if lint.sh exists

      - name: Unit Tests
        run: bash build/unit-test.sh
```

The `DEFAULT_CONTAINER_RUNNER` image must have the language runtime available
(Go toolchain or Python + pytest). The `sre-python-docker` image includes Python;
the Go runner includes the Go toolchain.

---

## SonarQube Integration (optional)

If the project uses SonarQube, generate `coverage.out` so SonarQube can pick it up.
Configure `build/sonar-project.properties`:

```properties
sonar.projectKey=my-project
sonar.projectName=My Project
sonar.sources=./pkg
sonar.language=go
sonar.go.coverage.reportPaths=./coverage.out
```

---

## Checklist

- [ ] Create `build/unit-test.sh` (or `scripts/unit-test.sh`)
- [ ] Make script executable: `chmod +x build/unit-test.sh`
- [ ] Go: ensure `Makefile` has `test` target if using `make test`
- [ ] Python: add `pytest` (or other framework) to `requirements.txt`
- [ ] Verify `ci.yaml` `checkout-unit-tests` calls `bash build/unit-test.sh`
- [ ] Run tests locally to confirm they pass before pushing
