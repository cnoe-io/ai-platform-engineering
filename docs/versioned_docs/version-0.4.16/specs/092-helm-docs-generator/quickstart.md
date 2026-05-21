---
sidebar_label: Quickstart
sidebar_position: 5
---

# Quickstart: Helm Chart Documentation Generator

## Prerequisites

Install the required CLI tools:

```bash
brew install helm-docs yq helm
```

Or via Go:

```bash
go install github.com/norwoodj/helm-docs/cmd/helm-docs@latest
go install github.com/mikefarah/yq/v4@latest
```

Verify:

```bash
helm-docs --version   # v1.14+
yq --version          # v4+
helm version           # v3+
```

## Generate all chart docs

```bash
make docs-helm-charts
```

This single command:

1. Fetches the latest published version from the OCI registry
2. Runs `helm-docs` to regenerate values tables from `values.yaml`
3. Enriches each chart's source `README.md` with usage examples
4. Generates Docusaurus pages in `docs/docs/installation/helm-charts/`

## Override the chart version

If you're offline or want to pin a specific version:

```bash
make docs-helm-charts CHART_VERSION=0.2.37
```

## Validate the output

Run the full end-to-end validation (generates docs, builds Docusaurus, checks for RC patterns):

```bash
make docs-helm-validate
```

Or run the steps individually:

```bash
# Generate docs
make docs-helm-charts

# Build Docusaurus (verifies MDX compilation, broken links, sidebar)
make docs-build

# Check for RC version leakage
grep -rE '-(rc|alpha|beta|pre)\.' docs/docs/installation/helm-charts/ && echo "FAIL" || echo "PASS"
```

## What gets generated

For each chart under `charts/`, two files are produced:

| Output | Location | Purpose |
|--------|----------|---------|
| Source README | `charts/<parent>/charts/<chart>/README.md` | GitHub-browsable reference with usage examples |
| Docusaurus page | `docs/docs/installation/helm-charts/<parent>/<chart>.md` | Documentation site page with frontmatter |

## Generated doc sections

Each generated chart doc includes:

1. **Auto-generated marker** — warning not to edit manually
2. **Chart metadata** — name, description, published version
3. **Quick Start** — `helm install` and `helm upgrade` commands
4. **Customizing Values** — `--set` and `-f values.yaml` examples
5. **Reading the Values Table** — explains Key, Type, Default, Description columns
6. **Values** — full parameter table (from `helm-docs`)
7. **Dependencies** — subchart table with versions and conditions (parent charts only)
