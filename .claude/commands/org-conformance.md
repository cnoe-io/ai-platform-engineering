<!-- caipe-skill: claude/org-conformance -->
---
name: org-conformance
description: Outshift organization standards for CI pipelines, Dockerfiles, coding, Helm charts, and security. Always apply these rules when generating or reviewing code, CI workflows, or infrastructure for cisco-eti repos. This is the authoritative reference for org-wide conformance.
---

# Outshift Org Conformance Standards

These rules apply to **all** `cisco-eti` repositories. Always follow these when generating CI workflows, Dockerfiles, code, or infrastructure.

---

## 1. CI Pipeline (`ci.yaml`)

### Required structure (in order)

```
checkout-unit-tests
  └── call-docker-build-push
        └── call-corona-blackduck-scan
              └── call-helm-publish
                    └── call-trigger-cd
call-inclusive-lint  (parallel with checkout-unit-tests)
reusable-workflow-ci-status  (always last, lists all jobs in needs[])
```

### Hard rules

- All reusable workflows pinned to `@production`: `cisco-eti/gh-reusable-workflows/.github/workflows/<name>.yaml@production`
- Triggers: `push` to `main`, `pull_request` to `main`, `workflow_dispatch`
- Permissions block always present:
  ```yaml
  permissions:
    id-token: write
    contents: read
    packages: write
  ```
- `checkout-unit-tests` uses ARC self-hosted runners (`group: arc-runner-set`), not GitHub-hosted
- `reusable-workflow-ci-status` **always** lists every active job in `needs[]`
- Secrets: never hardcoded — always `${{ secrets.NAME }}`

### Required org secrets (auto-inherited, never define in repo)

- `VAULT_APPROLE_ROLE_ID`, `VAULT_APPROLE_SECRET_ID`
- `GHCR_USERNAME`, `GHCR_TOKEN`

### Required org variables (auto-inherited)

- `DEFAULT_CONTAINER_RUNNER`, `DEFAULT_ARC_RUNNERS`, `GHCR_REGISTRY`

---

## 2. Dockerfiles

### Base images (required — never use public Docker Hub images)

| Language | Build image | Runtime image |
|----------|-------------|---------------|
| Python | `ghcr.io/cisco-eti/sre-python-docker:v3.11.9-hardened-debian-12` | same (single-stage) |
| Go | `artifactory.devhub-cloud.cisco.com/sto-cg-docker/go:v1.25.6` | `chainguard-base:v20230214-2026.01.15` |
| General | `containers.cisco.com/sto-ccc-cloud9/hardened_debian:12-slim` | — |

### Hard rules

- Non-root user: run as UID `1001` (Python: user `app`, Go: non-root)
- Multi-stage builds for Go: separate builder and runtime stages
- `CGO_ENABLED=0` for Go builds
- Copy only compiled binary to runtime image (no source, no build tools)
- `--chown=app:app` when copying files in Python images

---

## 3. Security Scans

### Corona & BlackDuck (required for all services with Docker images)

Required repo-level variables (must be set before the scan job runs):
- `CORONA_PRODUCT_NAME`, `CORONA_PRODUCT_ID`, `CORONA_RELEASE_ID`
- `CORONA_CSDL_ID`, `CORONA_ENGINEERING_CONTACT`, `CORONA_SECURITY_CONTACT`, `CORONA_IMAGE_ADMINS`

### Inclusive language lint (required for all repos)

- Uses `cisco-eti/gh-reusable-workflows/.github/workflows/inclusive-lint.yaml@production`
- Requires `woke/rules.yaml` in repo root
- Runs in parallel with `checkout-unit-tests`

---

## 4. Helm Charts

### Directory structure (required)

```
deploy/charts/<service-name>/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── _helpers.tpl
    ├── namespace.yaml
    ├── configmap.yaml
    ├── deployment.yaml
    ├── service.yaml
    ├── ingress.yaml
    └── hpa.yaml
```

### Hard rules

- `chart-path`: always `deploy/charts/${{ github.event.repository.name }}`
- `tagversion` and `dimage` in `values.yaml` must be `SET_IN_DEPLOYMENT_REPO` — never hardcoded image tags in the chart
- Security context on all pods:
  ```yaml
  securityContext:
    runAsNonRoot: true
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
  ```
- Resource limits required on all containers

---

## 5. Deployment (CD)

### Deployment repo convention

- Name: `<app-repo>-deployment` (e.g. `my-service-deployment`)
- Org: `cisco-eti`
- Trigger CD via `trigger-deploy.yaml` reusable workflow after Helm publish

### ArgoCD / GitOps

- All environment values live in the deployment repo (`values.yaml`), never in the app repo
- `tagversion` updated automatically by the `trigger-deploy.yaml` step
- Applications registered in `cisco-eti/agntcy-deployment` ApplicationSet

---

## 6. Coding Standards

| Language | Linter | Formatter | Config file |
|----------|--------|-----------|-------------|
| Go | `golangci-lint` | `gofmt` / `goimports` | `.golangci.yml` |
| Python | `ruff` / `flake8` | `ruff format` | `pyproject.toml` |
| Rust | `clippy` | `rustfmt` | `rustfmt.toml` / `clippy.toml` |

### Common rules (all languages)

- Line length: 120–140 chars
- No secrets or credentials in code
- No `TODO` comments without a ticket reference
- Structured logging (no `fmt.Println` / `print()` in production code)

---

## 7. Infrastructure (Terraform)

- All changes via PR to `cisco-eti/platform-terraform-infra`
- Never apply Terraform manually — Atlantis handles plan and apply
- All resources tagged with: `DataClassification`, `ApplicationName`, `Environment`, `ResourceOwner`
- Register each module directory in `atlantis.yaml`

---

## 8. Access Management

- AD group membership managed via PRs to `cisco-eti/sre-cisco-groups-automation`
- Users identified by CEC ID
- `member_users` must be kept in alphabetical order

---

## 9. Commit Standards (mandatory for every commit)

These rules apply to **every commit** in any `cisco-eti` repository, regardless of
language, service type, or pipeline configuration.

### Conventional Commits (required)

All commit messages **must** follow [Conventional Commits v1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <subject>

<body>

<footers>
```

**Subject line rules:**
- Type must be one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Imperative, present tense — no capital first letter, no trailing period, max 72 chars
- `feat` and `fix` **require** a body explaining the *why*

**Breaking changes:**
- Mark with `!` after the type (`feat!:`) or add `BREAKING CHANGE:` footer

See the `conventional-commits` skill for full rules, examples, and checklist.

### DCO and AI Attribution (required)

- **AI agents must never add `Signed-off-by`** — only humans certify the DCO
- Human submitter must add their own `Signed-off-by` when the project requires DCO
- Any commit with AI-assisted code must include an `Assisted-by` trailer:

```
Assisted-by: Claude:claude-sonnet-4-6
```

See the `dco-ai-attribution` skill for the full format and checklist.

### Pre-commit checklist (run before every commit)

- [ ] Subject line follows Conventional Commits format
- [ ] `feat` / `fix` commits include a body explaining the *why*
- [ ] No secrets or credentials in any changed file
- [ ] No `TODO` without a ticket reference
- [ ] `Assisted-by` trailer present if AI tools contributed to the code
- [ ] `Signed-off-by` present if the project enforces DCO

---

## Quick Reference: Which Skill to Use

| Task | Skill |
|------|-------|
| Create CI pipeline | `create-ci-pipeline` |
| Docker build stage | `pipeline-docker-build-push` |
| Security scan | `pipeline-corona-blackduck` |
| Helm chart + publish | `create-helm-chart`, `pipeline-helm-publish` |
| Trigger ArgoCD deploy | `pipeline-trigger-deploy` |
| Set up deployment repo | `setup-deployment-repo` |
| Create Dockerfile (Python) | `create-python-dockerfile` |
| Create Dockerfile (Go) | `create-go-dockerfile` |
| Add lint | `create-lint` |
| Add unit tests | `create-unit-tests` |
| Go coding standards | `coding-standards-go` |
| Python coding standards | `coding-standards-python` |
| Rust coding standards | `coding-standards-rust` |
| Infrastructure changes | `platform-terraform-infra` |
| AD group access | `manage-ad-groups` |
| Platform docs | `search-platform-docs` |
| Commit message format | `conventional-commits` |
| DCO and AI attribution | `dco-ai-attribution` |
| Production readiness | `production-readiness` |
