<!-- caipe-skill: claude/pipeline-docker-build-push -->
---
name: pipeline-docker-build-push
description: Add the Docker Build & Push stage to a CI pipeline using the Outshift build-push-docker.yaml reusable workflow. Use when a user needs to build a Docker image and push to ECR, GHCR, or Artifactory.
---

# Pipeline Stage: Docker Build & Push

Reusable workflow: `cisco-eti/gh-reusable-workflows/.github/workflows/build-push-docker.yaml@production`

Builds a Docker image and pushes to one or more registries (ECR, GHCR, Artifactory DevHub).
Tags: `YYYY-MM-DD-<SHA>` on push to main, `latest` always, semver tag when a git tag is pushed.

---

## Minimal example

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
      ghcr-enabled: true
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}
```

---

## Key inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `image-name` | yes | — | Docker image name, e.g. `eti-sre/my-service` |
| `dockerfile` | no | `Dockerfile` | Path to Dockerfile |
| `context` | no | `.` | Docker build context |
| `ecr-enabled` | no | `false` | Push to AWS private ECR |
| `ghcr-enabled` | no | `false` | Push to GHCR |
| `ghcr-org-registry` | no | — | GHCR org registry, use `${{ vars.GHCR_REGISTRY }}` |
| `artifactory-devhub-enabled` | no | `false` | Push to Artifactory DevHub |
| `use-build-script` | no | `false` | Use a custom build script instead of `docker build` |
| `build-args` | no | `--no-cache` | Extra Docker build args |
| `runner-group` | no | `${{ vars.DEFAULT_ARC_RUNNERS }}` | ARC runner group |

## Required secrets

| Secret | Description |
|--------|-------------|
| `vault-approle-role-id` | Vault AppRole role ID |
| `vault-approle-secret-id` | Vault AppRole secret ID |
| `ghcr-username` | GHCR username |
| `ghcr-token` | GHCR token |
| `ghcr-org-token` | GHCR org token (can be same as `ghcr-token`) |

---

## Push to ECR + GHCR

```yaml
    with:
      runner-group: arc-runner-set
      image-name: "eti-sre/${{ github.event.repository.name }}"
      dockerfile: build/Dockerfile
      ecr-enabled: true
      ghcr-enabled: true
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}
```

## Push to GHCR only (Chart Museum / simpler deployments)

```yaml
    with:
      runner-group: arc-runner-set
      image-name: "eti-sre/${{ github.event.repository.name }}"
      dockerfile: build/Dockerfile
      ghcr-enabled: true
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}
```

## Custom build script

```yaml
    with:
      use-build-script: true
      # place your build script at build/build-docker.sh
```

---

## Placement in pipeline

```
checkout-unit-tests → call-docker-build-push → [corona-blackduck-scan | helm-publish]
```
