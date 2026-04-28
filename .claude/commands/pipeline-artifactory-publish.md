<!-- caipe-skill: claude/pipeline-artifactory-publish -->
---
name: pipeline-artifactory-publish
description: Add an Artifactory publish stage to a CI pipeline for Python or NPM packages using Outshift reusable workflows. Use when a user needs to publish an internal Python package to outshift-pypi or an NPM package to outshift-npm on Artifactory DevHub.
---

# Pipeline Stage: Artifactory Publish (Python / NPM)

Two reusable workflows for publishing internal packages to Outshift's Artifactory DevHub:

- Python → `artifactory-publish-python.yaml@production` → `outshift-pypi`
- NPM → `artifactory-publish-npm.yaml@production` → `outshift-npm`

> Use these for **internal** packages. For public PyPI, use `pipeline-pypi-publish` instead.

---

## Python: Publish to Artifactory

```yaml
  call-publish-python:
    name: Publish Python Package
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/artifactory-publish-python.yaml@production
    with:
      python-version: '3.11'
      python-artifactory-repo: 'outshift-pypi'
      publish-enabled: true
    secrets:
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

### Python inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `python-version` | no | `3.10` | Python version |
| `python-artifactory-repo` | no | `outshift-pypi` | Target Artifactory repo |
| `install-enabled` | no | `true` | Run `pip install` of dependencies |
| `download-from-artifactory` | no | `false` | Configure pip to pull from Artifactory |
| `publish-enabled` | no | `false` | Actually publish the package |

---

## NPM: Publish to Artifactory

```yaml
  call-publish-npm:
    name: Publish NPM Package
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/artifactory-publish-npm.yaml@production
    with:
      node-version: '20.x'
      npm-artifactory-repo: 'outshift-npm'
      install-enabled: true
      build-enabled: true
      publish-enabled: true
    secrets:
      vault-approle-role-id: ${{ secrets.VAULT_APPROLE_ROLE_ID }}
      vault-approle-secret-id: ${{ secrets.VAULT_APPROLE_SECRET_ID }}
```

### NPM inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `node-version` | no | `20.x` | Node.js version |
| `npm-artifactory-repo` | no | `outshift-npm` | Target Artifactory repo |
| `working-directory` | no | `.` | Directory containing `package.json` |
| `install-enabled` | no | `true` | Run `npm install` |
| `build-enabled` | no | `true` | Run `npm run build` |
| `publish-enabled` | no | `false` | Run `npm publish` |

---

## Required secrets (both workflows)

| Secret | Description |
|--------|-------------|
| `vault-approle-role-id` | Vault AppRole role ID |
| `vault-approle-secret-id` | Vault AppRole secret ID |

Artifactory credentials are fetched from Vault automatically.

---

## Placement in pipeline

For library packages (no Docker image needed):

```
checkout-unit-tests → call-publish-python  (or call-publish-npm)
```

For services that also publish a Docker image:

```
checkout-unit-tests → call-docker-build-push → call-publish-python
```

---

## Notes

- `publish-enabled` defaults to `false` — set it to `true` only on push to `main` or a release branch. Use a conditional if needed:
  ```yaml
      publish-enabled: ${{ github.ref == 'refs/heads/main' }}
  ```
- The Python workflow uses `python setup.py bdist_wheel upload`. Ensure your `setup.py` is configured.
- The NPM workflow runs `npm publish` from the configured `working-directory`.
