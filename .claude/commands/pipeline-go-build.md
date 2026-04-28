<!-- caipe-skill: claude/pipeline-go-build -->
---
name: pipeline-go-build
description: Add the Go Build, Lint & Test stage to a CI pipeline using the Outshift go.yaml reusable workflow. Use when a user has a Go project and needs to run go build, golangci-lint, and go test in CI.
---

# Pipeline Stage: Go Build, Lint & Test

Reusable workflow: `cisco-eti/gh-reusable-workflows/.github/workflows/go.yaml@production`

Runs Go build, golangci-lint, and go test in CI. Can optionally upload the binary as an artifact or to S3.

---

## Minimal example

```yaml
  call-go-build-test:
    name: Go Build & Test
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/go.yaml@production
    with:
      runner-group: arc-runner-set
      enable-go-build: true
      enable-go-lint: true
      enable-go-test: true
      go-version: '1.21.0'
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

---

## Key inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `go-version` | no | `1.21.0` | Go version |
| `enable-go-build` | no | `true` | Run `go build` |
| `enable-go-lint` | no | `true` | Run golangci-lint |
| `enable-go-test` | no | `true` | Run `go test` |
| `go-build-goos` | no | `linux` | Target OS |
| `go-build-goarch` | no | `amd64` | Target arch |
| `go-pre-command` | no | `""` | Command to run before build (e.g. `go generate ./...`) |
| `go-build-args` | no | — | Extra `go build` arguments |
| `go-test-args` | no | — | Extra `go test` arguments |
| `golangci-version` | no | `v1.54.2` | golangci-lint version |
| `lint-continue-on-error` | no | `true` | Don't fail CI on lint errors |
| `upload-artifact-build-enabled` | no | `false` | Upload binary as GitHub artifact |
| `s3-bucket-name` | no | `""` | Upload binary to S3 bucket |
| `runner-group` | no | `${{ vars.DEFAULT_RUNNER_GROUP }}` | ARC runner group |

## Required secrets

| Secret | Description |
|--------|-------------|
| `vault-approle-role-id` | Vault AppRole role ID |
| `vault-approle-secret-id` | Vault AppRole secret ID |
| `ghcr-username` | GHCR username |
| `ghcr-token` | GHCR token |

---

## Placement in pipeline

This job typically runs **in parallel** with or **before** `call-docker-build-push`, or replaces the unit-test step in `checkout-unit-tests`:

```
checkout-unit-tests ──┐
call-go-build-test  ──┴──► call-docker-build-push
```

Or as a standalone pre-build gate:

```
call-go-build-test → call-docker-build-push → helm-publish
```

---

## Notes

- `lint-continue-on-error: true` (default) means lint failures are warnings, not blockers. Set to `false` to enforce lint.
- The Go reusable workflow uses the `DEFAULT_CONTAINER_RUNNER` container image, which must have Go available, **or** it uses `actions/setup-go` directly.
- For cross-compilation, set `go-build-goos` and `go-build-goarch` (e.g. `windows`, `arm64`).
