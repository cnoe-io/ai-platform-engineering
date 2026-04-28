<!-- caipe-skill: claude/pipeline-corona-blackduck -->
---
name: pipeline-corona-blackduck
description: Add the Corona & BlackDuck security scan stage to a CI pipeline using the Outshift corona-blackduck-scan.yaml reusable workflow. Use when a user needs container image compliance scanning (Corona) and open-source dependency scanning (BlackDuck).
---

# Pipeline Stage: Corona & BlackDuck Scan

Reusable workflow: `cisco-eti/gh-reusable-workflows/.github/workflows/corona-blackduck-scan.yaml@production`

Runs two security scans against the built Docker image:
- **Corona**: Cisco's container image compliance scanner — registers the image in the security inventory
- **BlackDuck**: Open-source dependency vulnerability scanner

> Required for all production services in the `cisco-eti` organization.

---

## Minimal example

```yaml
  call-corona-blackduck-scan:
    name: Corona & BlackDuck Scan
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
      image-name: "eti-sre/${{ github.event.repository.name }}"
      ghcr-org-registry: ${{ vars.GHCR_REGISTRY }}
      corona-product-name: ${{ vars.CORONA_PRODUCT_NAME }}
      corona-product-id: ${{ vars.CORONA_PRODUCT_ID }}
      corona-release-id: ${{ vars.CORONA_RELEASE_ID }}
      corona-csdl-id: ${{ vars.CORONA_CSDL_ID }}
      corona-security-contact: ${{ vars.CORONA_SECURITY_CONTACT }}
      corona-engineering-contact: ${{ vars.CORONA_ENGINEERING_CONTACT }}
      corona-image-admins: ${{ vars.CORONA_IMAGE_ADMINS }}
```

---

## Key inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `enable-corona` | no | `true` | Run Corona scan |
| `enable-blackduck` | no | `true` | Run BlackDuck scan |
| `image-name` | no | repo name | Docker image name (without registry) |
| `image-tag` | no | `null` | Specific image tag to scan |
| `language` | no | `go` | Source language for BlackDuck scan options |
| `bd-scanning-directory` | no | `.` | Directory for BlackDuck to scan |
| `ghcr-org-registry` | no | `ghcr.io/cisco-eti` | GHCR org registry |
| `corona-product-name` | no | — | Corona product name (from repo variable) |
| `corona-product-id` | no | — | Corona product ID |
| `corona-release-id` | no | — | Corona release ID |
| `corona-csdl-id` | no | — | CSDL ID for compliance |
| `corona-security-contact` | no | — | Security contact email |
| `corona-engineering-contact` | no | — | Engineering contact email |
| `corona-image-admins` | no | — | Image admins list |
| `runner-group` | no | `${{ vars.DEFAULT_RUNNER_GROUP }}` | ARC runner group |

## Required secrets

| Secret | Description |
|--------|-------------|
| `vault-approle-role-id` | Vault AppRole role ID |
| `vault-approle-secret-id` | Vault AppRole secret ID |
| `ghcr-username` | GHCR username |
| `ghcr-token` | GHCR token |
| `ghcr-org-username` | GHCR org username |
| `ghcr-org-token` | GHCR org token |

---

## Required repo-level variables

Set these in GitHub → Settings → Secrets and variables → Variables:

| Variable | Description |
|----------|-------------|
| `CORONA_PRODUCT_NAME` | Product name in Corona inventory |
| `CORONA_PRODUCT_ID` | Product ID in Corona |
| `CORONA_RELEASE_ID` | Release ID in Corona |
| `CORONA_CSDL_ID` | CSDL compliance ID |
| `CORONA_SECURITY_CONTACT` | Security team email |
| `CORONA_ENGINEERING_CONTACT` | Engineering team email |
| `CORONA_IMAGE_ADMINS` | Comma-separated image admins |

Contact the security team to obtain these values if your product is not yet registered in Corona.

---

## Placement in pipeline

```
call-docker-build-push → call-corona-blackduck-scan → call-helm-publish
```

Always runs **after** the Docker image is built and pushed (must exist in the registry to scan it).

---

## Notes

- To scan only Corona (skip BlackDuck): `enable-blackduck: false`
- To scan only BlackDuck (skip Corona): `enable-corona: false`
- BlackDuck `language` defaults to `go`. For Java set `language: java`, for Python set `language: python`.
- The scan runs inside the `CISCO_OUTSHIFT_CORONA_BD_IMAGE` container (org-level variable).
