<!-- caipe-skill: claude/pipeline-helm-publish -->
---
name: pipeline-helm-publish
description: Add the Helm chart publish stage to a CI pipeline using the Outshift helm-publish.yaml reusable workflow. Use when a user needs to package and push a Helm chart to ECR, Chart Museum, or GAR.
---

# Pipeline Stage: Helm Publish

Reusable workflow: `cisco-eti/gh-reusable-workflows/.github/workflows/helm-publish.yaml@production`

Packages and pushes a Helm chart to one or more registries: private ECR (OCI), public ECR, Chart Museum, or Google Artifact Registry (GAR).

---

## Minimal example — Chart Museum

```yaml
  call-helm-publish:
    name: Helm Publish
    needs: [call-docker-build-push]
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/helm-publish.yaml@production
    with:
      runner-group: arc-runner-set
      enable-chartmuseum: true
      enable-private-ecr: false
      chart-path: "deploy/charts/${{ github.event.repository.name }}"
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

## Minimal example — Private ECR (OCI)

```yaml
  call-helm-publish:
    name: Helm Publish
    needs: [call-docker-build-push]
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

---

## Key inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `chart-path` | **yes** | — | Path to the Helm chart directory |
| `enable-private-ecr` | no | `true` | Push to AWS private ECR (OCI) |
| `enable-public-ecr` | no | `false` | Push to AWS public ECR |
| `enable-chartmuseum` | no | `false` | Push to `chartmuseum.prod.eticloud.io` |
| `gar-enabled` | no | `false` | Push to Google Artifact Registry |
| `gcp-project-name` | no | `eticloud-scratch` | GCP project for GAR |
| `override-chart-version` | no | `""` | Override `version` in `Chart.yaml` |
| `chart-suffix` | no | `""` | Append suffix to version (e.g. `-dev`, `-stg`) |
| `custom-script-path` | no | `""` | Run a custom script before packaging |
| `custom-repo-path` | no | `""` | Custom ECR repo path prefix |
| `runner-group` | no | `${{ vars.DEFAULT_ARC_RUNNERS }}` | ARC runner group |

## Required secrets

| Secret | Description |
|--------|-------------|
| `vault-approle-role-id` | Vault AppRole role ID |
| `vault-approle-secret-id` | Vault AppRole secret ID |
| `ghcr-username` | GHCR username |
| `ghcr-token` | GHCR token |
| `vault-venture-approle-role-id` | (optional) Venture-specific Vault role (for GAR) |
| `vault-venture-approle-secret-id` | (optional) Venture-specific Vault secret |

---

## Registry comparison

| Registry | Input flag | Use case |
|----------|-----------|----------|
| Private ECR (OCI) | `enable-private-ecr: true` | Production services, ArgoCD via ECR |
| Public ECR | `enable-public-ecr: true` | Open-source charts |
| Chart Museum | `enable-chartmuseum: true` | Simpler deployments, dev/staging |
| GAR | `gar-enabled: true` | GCP-hosted services |

> Default is `enable-private-ecr: true`. Always explicitly set the flags you want.

---

## Placement in pipeline

```
call-docker-build-push → [call-corona-blackduck-scan] → call-helm-publish → call-trigger-cd
```

The `needs` value should point at the last job before this one (usually `call-corona-blackduck-scan` if security scans are enabled, otherwise `call-docker-build-push`).

---

## Notes

- The `chart-path` must contain a valid `Chart.yaml` with `name` and `version` fields.
- `helm lint` is **not** run automatically — validate your chart locally with `helm lint <chart-path>` before pushing.
- `override-chart-version` is useful for CI-generated versions (e.g. `0.1.0-${{ github.sha }}`).
- For ECR, the workflow automatically creates the ECR repository if it doesn't exist.
