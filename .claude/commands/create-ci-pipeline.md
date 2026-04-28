<!-- caipe-skill: claude/create-ci-pipeline -->
---
name: create-ci-pipeline
description: Creates GitHub Actions CI pipelines using Outshift's gh-reusable-workflows for repositories in the cisco-eti GitHub organization. Use when a user asks to set up CI, create a ci.yaml, or build a GitHub Actions pipeline.
---

# Create CI Pipeline

Generate GitHub Actions CI pipelines using Outshift reusable workflows
(`cisco-eti/gh-reusable-workflows@production`).

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Stack**: Go, Java (Maven), Python, Node/NPM, or other?
2. **Registries**: ECR, GHCR, Artifactory, or none?
3. **Security scans**: Corona/BlackDuck? SonarQube?
4. **Deployment**: Helm + ArgoCD? If so, what's the deployment repo name?
5. **Test script path**: e.g. `build/unit-test.sh`, `scripts/test.sh`
6. **Dockerfile path**: e.g. `build/Dockerfile`, `Dockerfile`
7. **Helm chart path**: e.g. `deploy/charts/<repo-name>`

### Step 2 — Generate the pipeline

Use `scripts/generate-pipeline.sh` to scaffold the `ci.yaml`, or build it manually
from the patterns in this skill. Place the output at `.github/workflows/ci.yaml`.

### Step 3 — Verify

- All active job IDs are listed in `reusable-workflow-ci-status.needs[]`.
- The `@production` branch is used on every `uses:` line.
- Required secrets are referenced (not hardcoded).

---

## Pipeline Anatomy

```
Checkout & Unit Tests  (custom job)
    └─► Docker Build & Push          [build-push-docker.yaml]
            └─► Security Scans       [corona-blackduck-scan.yaml] (optional)
                    └─► SonarQube    [sonar-scan.yaml]            (optional)
                            └─► Helm Publish  [helm-publish.yaml]
                                    └─► Trigger CD  [trigger-deploy.yaml]
                                            └─► CI Status Check   (always)
```

---

## Boilerplate (always include)

```yaml
name: CI

on:
  push:
    branches: ['main']
  pull_request:
    branches: ['main']
  workflow_dispatch:

permissions:
  id-token: write   # OIDC for ECR
  contents: read
  packages: write   # push to GHCR / ECR / GAR
```

---

## Jobs Reference

### Checkout & Unit Tests

Not a reusable workflow — define this job yourself.

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
      - name: Unit Tests
        run: bash build/unit-test.sh   # ← adjust per project
```

### Docker Build & Push

```yaml
  call-docker-build-push:
    name: Docker Build & Push
    needs: [checkout-unit-tests]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/build-push-docker.yaml@production
    secrets:
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      ghcr-org-token: ${{ secrets.GHCR_TOKEN }}
    with:
      runner-group: arc-runner-set
      image-name: "eti-sre/${{ github.event.repository.name }}"
      dockerfile: build/Dockerfile
      ecr-enabled: true
      ghcr-enabled: true
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}
```

### Go CI (optional)

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

### Maven CI (optional)

```yaml
  call-mvn-build:
    name: Maven Build & Test
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/mvn.yaml@production
    with:
      runner-group: arc-runner-set
      enable-mvn-build: true
      enable-mvn-lint: true
      enable-mvn-test: true
      path-to-pom: ./
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

### Corona & BlackDuck Scan (optional)

Requires repo-level variables: `CORONA_PRODUCT_NAME`, `CORONA_PRODUCT_ID`,
`CORONA_RELEASE_ID`, `CORONA_CSDL_ID`, `CORONA_ENGINEERING_CONTACT`,
`CORONA_IMAGE_ADMINS`, `CORONA_SECURITY_CONTACT`.

```yaml
  call-corona-blackduck-scan:
    name: Corona & Blackduck Scan
    needs: [call-docker-build-push]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/corona-blackduck-scan.yaml@production
    secrets:
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      ghcr-org-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-org-token: ${{ secrets.GHCR_TOKEN }}
    with:
      runner-group: arc-runner-set
      enable-corona: true
      enable-blackduck: true
      corona-product-name: ${{ vars.CORONA_PRODUCT_NAME }}
      corona-product-id: ${{ vars.CORONA_PRODUCT_ID }}
      corona-release-id: ${{ vars.CORONA_RELEASE_ID }}
      corona-csdl-id: ${{ vars.CORONA_CSDL_ID }}
      corona-security-contact: ${{ vars.CORONA_SECURITY_CONTACT }}
      corona-engineering-contact: ${{ vars.CORONA_ENGINEERING_CONTACT }}
      corona-image-admins: ${{ vars.CORONA_IMAGE_ADMINS }}
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}
      image-name: "eti-sre/${{ github.event.repository.name }}"
```

### SonarQube Scan (optional)

Requires a `sonar-project.properties` file in the repo.

```yaml
  call-sonar-scan:
    name: SonarQube Scan
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/sonar-scan.yaml@production
    with:
      sonar-properties-file: "./build/sonar-project.properties"
    secrets:
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
```

### Helm Publish (optional)

```yaml
  call-helm-publish:
    name: Helm Publish
    needs: [call-docker-build-push]   # or call-corona-blackduck-scan
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/helm-publish.yaml@production
    with:
      runner-group: arc-runner-set
      enable-private-ecr: true
      chart-path: "deploy/charts/${{ github.event.repository.name }}"
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

Use `enable-chartmuseum: true` and `enable-private-ecr: false` for Chart Museum deployments.

### Trigger CD (optional)

```yaml
  call-trigger-cd:
    name: Trigger CD
    needs: [call-helm-publish]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/trigger-deploy.yaml@production
    with:
      deployment-repo: "${{ github.repository }}-deployment"
      client-payload: '{"app-repository": "${{ github.repository }}", "values-file-path": "applications/${{ github.event.repository.name }}", "property-path": "tagversion", "value": ""}'
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      ghcr-org-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-org-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

### CI Status Check (always required)

Must include **all active job IDs** in the `needs` array.

```yaml
  reusable-workflow-ci-status:
    name: Reusable Workflow CI Status
    needs: [checkout-unit-tests, call-docker-build-push, call-helm-publish, call-trigger-cd]
    if: always()
    runs-on:
      group: arc-runner-set
    steps:
      - name: report failure
        if: ${{ cancelled() || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'failure') }}
        run: |
          echo -e "\033[31m*** WORKFLOW FAILED ***\033[0m"
          exit 1
      - name: report success
        run: echo -e "\033[1;36m*** WORKFLOW SUCCESS ***\033[0m"
```

---

## Scripts

Use `scripts/generate-pipeline.sh` to scaffold a `ci.yaml` interactively:

```bash
bash scripts/generate-pipeline.sh \
  --stack go \
  --image-name "eti-sre/my-service" \
  --dockerfile "build/Dockerfile" \
  --test-script "build/unit-test.sh" \
  --helm-chart "deploy/charts/my-service" \
  --deployment-repo "cisco-eti/my-service-deployment" \
  --registries ghcr,ecr \
  --output .github/workflows/ci.yaml
```

---

## Examples

### Hello World — Minimal Go Pipeline

Checkout → Docker (GHCR) → Helm (Chart Museum) → CD → Status

```yaml
# .github/workflows/ci.yaml
name: CI

on:
  push:
    branches: ['main']
  pull_request:
    branches: ['main']
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  packages: write

jobs:
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
      - name: Unit Tests
        run: bash build/unit-test.sh

  call-docker-build-push:
    name: Docker Build & Push
    needs: [checkout-unit-tests]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/build-push-docker.yaml@production
    secrets:
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      ghcr-org-token: ${{ secrets.GHCR_TOKEN }}
    with:
      runner-group: arc-runner-set
      image-name: "eti-sre/${{ github.event.repository.name }}"
      dockerfile: build/Dockerfile
      ghcr-enabled: true
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}

  call-helm-publish:
    name: Helm Publish
    needs: [call-docker-build-push]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/helm-publish.yaml@production
    with:
      runner-group: arc-runner-set
      enable-private-ecr: false
      enable-chartmuseum: true
      chart-path: "deploy/charts/${{ github.event.repository.name }}"
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}

  call-trigger-cd:
    name: Trigger CD
    needs: [call-helm-publish]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/trigger-deploy.yaml@production
    with:
      deployment-repo: "${{ github.repository }}-deployment"
      client-payload: '{"app-repository": "${{ github.repository }}", "values-file-path": "applications/${{ github.event.repository.name }}", "property-path": "tagversion", "value": ""}'
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      ghcr-org-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-org-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}

  reusable-workflow-ci-status:
    name: Reusable Workflow CI Status
    needs: [checkout-unit-tests, call-docker-build-push, call-helm-publish, call-trigger-cd]
    if: always()
    runs-on:
      group: arc-runner-set
    steps:
      - if: ${{ cancelled() || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'failure') }}
        run: exit 1
      - run: echo "CI passed"
```

### Full Pipeline — Go with Security Scans

See [CLAUDE.md](../CLAUDE.md) or the `sre-go-helloworld` reference implementation for
the full pipeline including Corona/BlackDuck, SonarQube, private ECR, and public ECR Helm.

---

## Related Skills

- **`setup-deployment-repo`** — Set up the ArgoCD GitOps deployment repo that CI triggers
- **`create-go-dockerfile`** — Generate `build/Dockerfile` for Go services
- **`create-python-dockerfile`** — Generate `build/Dockerfile` for Python services
- **`create-lint`** — Generate `build/lint.sh` and wire it into CI
- **`create-unit-tests`** — Generate `build/unit-test.sh` and wire it into CI

---

## Guidelines

- Always use `@production` — never `@main` or a SHA for reusable workflows.
- Always include the `reusable-workflow-ci-status` job — required for PR branch protection.
- Use `arc-runner-set` or `${{ vars.DEFAULT_ARC_RUNNERS }}` for the runner group.
- Never hardcode secrets or tokens; always use `${{ secrets.* }}`.
- The `checkout-unit-tests` job is custom — adapt the test command to the project.
- Add Corona/BlackDuck only after confirming the team's Corona product exists.
- Deployment repo naming convention: `<app-repo>-deployment`.
