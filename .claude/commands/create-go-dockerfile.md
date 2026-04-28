<!-- caipe-skill: claude/create-go-dockerfile -->
---
name: create-go-dockerfile
description: >
  Creates a production-ready multi-stage Dockerfile for Go services using Cisco
  hardened base images. Use when a user asks to create a Dockerfile for a Go
  app, containerize a Go service, or set up a Docker build for Go. Reference
  implementation: cisco-eti/sre-go-helloworld.
---

# Create Go Dockerfile

Generate a `build/Dockerfile` for Go services using a multi-stage build:
- **Build stage**: Cisco Outshift hardened Go builder image from Artifactory
- **Runtime stage**: Minimal hardened Chainguard base image

Reference: https://github.com/cisco-eti/sre-go-helloworld/blob/main/build/Dockerfile

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Go version**: 1.21, 1.22, 1.23 (check available tags in Artifactory)
2. **Binary name**: e.g. `myservice.bin`, `app.bin`
3. **Main package path**: e.g. `./cmd/myservice`, `.`
4. **Exposed port**: e.g. `9010`, `8080`
5. **Build target**: Does the project use a `Makefile` with a `build` target? (default: yes)
6. **Module path**: from `go.mod` (e.g. `github.com/cisco-eti/my-service`)

### Step 2 — Generate the Dockerfile

Place at `build/Dockerfile`.

---

## Dockerfile Template

```dockerfile
FROM artifactory.devhub-cloud.cisco.com/sto-cg-docker/go:v1.25.6 AS base-build

ARG DEBIAN_FRONTEND=noninteractive
RUN rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

ARG BUILD_VERSION
ARG GO_BUILD_ENV

ENV GO111MODULE=on
ENV GOPROXY="https://proxy.golang.org, direct"

WORKDIR /app

# Download dependencies first for layer caching
COPY go.mod go.sum Makefile /app/
RUN go mod download

COPY . /app/

# Ensure source directory is safe for git operations
RUN git config --global --add safe.directory /app

# Build the binary
RUN BUILD_VERSION="${BUILD_VERSION}" GO_BUILD_ENV="${GO_BUILD_ENV}" make build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM artifactory.devhub-cloud.cisco.com/sto-cg-docker/chainguard-base:v20230214-2026.01.15 AS run

COPY --from=base-build /app/<binary-name>.bin /usr/bin/<binary-name>.bin

EXPOSE 9010

ENTRYPOINT ["/usr/bin/<binary-name>.bin"]
```

---

## Base Images

| Stage | Image | Purpose |
|-------|-------|---------|
| Build | `artifactory.devhub-cloud.cisco.com/sto-cg-docker/go:v1.25.6` | Hardened Go toolchain |
| Runtime | `artifactory.devhub-cloud.cisco.com/sto-cg-docker/chainguard-base:v20230214-2026.01.15` | Minimal distroless-like runtime |

**Do not use** `FROM golang:*` or `FROM alpine:*` — use the Cisco Artifactory images.
For simpler builds that don't need a separate runtime stage, the Debian fallback is:
`FROM containers.cisco.com/sto-ccc-cloud9/hardened_debian:12-slim`

---

## Required `Makefile` `build` target

The Dockerfile calls `make build`. Ensure your `Makefile` has:

```makefile
BINARY_NAME ?= myservice.bin

build:
	CGO_ENABLED=0 go build -o $(BINARY_NAME) ./cmd/myservice/...
```

Adjust the binary name and main package path to match the project.

---

## Example: Simple HTTP service

```dockerfile
FROM artifactory.devhub-cloud.cisco.com/sto-cg-docker/go:v1.25.6 AS base-build

ARG DEBIAN_FRONTEND=noninteractive
RUN rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

ARG BUILD_VERSION
ARG GO_BUILD_ENV

ENV GO111MODULE=on
ENV GOPROXY="https://proxy.golang.org, direct"

WORKDIR /app
COPY go.mod go.sum Makefile /app/
RUN go mod download
COPY . /app/
RUN git config --global --add safe.directory /app
RUN BUILD_VERSION="${BUILD_VERSION}" GO_BUILD_ENV="${GO_BUILD_ENV}" make build

FROM artifactory.devhub-cloud.cisco.com/sto-cg-docker/chainguard-base:v20230214-2026.01.15 AS run
COPY --from=base-build /app/myservice.bin /usr/bin/myservice.bin
EXPOSE 8080
ENTRYPOINT ["/usr/bin/myservice.bin"]
```

---

## Code Coverage & Static Analysis (optional build args)

The sre-go-helloworld pattern supports optional CI build args:

```dockerfile
ARG CODE_COVERAGE
ARG COVER_OUT=coverage.out
ARG STATIC_ANALYSIS

# Run tests with coverage (activated when CODE_COVERAGE=cc)
RUN if [ "${CODE_COVERAGE}" = "cc" ]; then \
      go test -v ./... -coverprofile=${COVER_OUT}; \
    else \
      go test -v ./...; \
    fi
```

Only add this if the project needs coverage reports in the Docker build step.
Typically tests are run separately via `build/unit-test.sh`.

---

## Wiring into CI

After generating the Dockerfile, ensure CI references it:

```yaml
  call-docker-build-push:
    with:
      dockerfile: build/Dockerfile
```

---

## Guidelines

- The multi-stage build keeps the final image minimal — only the binary and its dependencies.
- Use `CGO_ENABLED=0` in the build to produce a statically linked binary compatible
  with the distroless runtime image.
- Copy only `go.mod`, `go.sum`, and `Makefile` before the full `COPY .` to leverage
  Docker layer caching for `go mod download`.
- The `git config --global --add safe.directory` is required because the build runs
  inside a container where the git repo owner doesn't match.
