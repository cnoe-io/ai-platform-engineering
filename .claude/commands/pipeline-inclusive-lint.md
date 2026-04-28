<!-- caipe-skill: claude/pipeline-inclusive-lint -->
---
name: pipeline-inclusive-lint
description: Add the inclusive language lint stage to a CI pipeline using the Outshift inclusive-lint.yaml reusable workflow. Use when a user needs to check for non-inclusive terminology (using the woke tool) in their codebase.
---

# Pipeline Stage: Inclusive Language Lint

Reusable workflow: `cisco-eti/gh-reusable-workflows/.github/workflows/inclusive-lint.yaml@production`

Runs [woke](https://github.com/get-woke/woke) to check for non-inclusive terminology in the codebase (e.g. `whitelist`/`blacklist`, `master`/`slave`). Required by Cisco's inclusive language policy.

---

## Minimal example

```yaml
  call-inclusive-lint:
    name: Inclusive Language Lint
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/inclusive-lint.yaml@production
    secrets:
      ghcr-username: ${{ secrets.GHCR_USERNAME }}
      ghcr-token: ${{ secrets.GHCR_TOKEN }}
```

---

## Key inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `runner` | no | `${{ vars.UBUNTU_RUNNER }}` | Runner (uses Ubuntu, not ARC) |
| `runner-docker-image` | no | `${{ vars.DEFAULT_CONTAINER_RUNNER }}` | Container image |
| `continue-on-error` | no | `false` | Warn instead of failing |

## Required secrets

| Secret | Description |
|--------|-------------|
| `ghcr-username` | GHCR username |
| `ghcr-token` | GHCR token |

> Does **not** require Vault secrets.

---

## `woke/rules.yaml`

The workflow uses a `woke/rules.yaml` file in the repo root. Create it to customize which terms are flagged:

```yaml
rules:
  - name: whitelist
    terms:
      - whitelist
      - white-list
    alternatives:
      - allowlist
    severity: warning

  - name: blacklist
    terms:
      - blacklist
      - black-list
    alternatives:
      - denylist
    severity: warning

  - name: master-slave
    terms:
      - master
      - slave
    alternatives:
      - primary/replica
      - leader/follower
    severity: warning
```

See `cisco-eti/platform-demo/woke/rules.yaml` for the reference config.

---

## `.legitignore`

Exclude false positives (binary files, vendor dirs, specific lines) using `.legitignore`:

```
vendor/
*.png
*.jpg
build/
```

---

## Placement in pipeline

Inclusive lint runs independently — it doesn't depend on Docker builds or tests:

```
call-inclusive-lint  (runs in parallel with checkout-unit-tests)
checkout-unit-tests → call-docker-build-push → ...
```

Add it to `reusable-workflow-ci-status.needs[]`:

```yaml
  reusable-workflow-ci-status:
    needs: [checkout-unit-tests, call-inclusive-lint, call-docker-build-push, ...]
```

---

## Notes

- The workflow **warns** on violations (outputs to log) but only exits non-zero if the `inclusive.output` file is non-empty and you handle it. Review the output log.
- `continue-on-error: true` prevents this from blocking merges during a transition period.
- The `woke/rules.yaml` file is **required** — the workflow will fail if it doesn't exist.
