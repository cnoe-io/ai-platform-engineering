# Contributing Guide

Thank you for considering contributing to this project! We welcome contributions from the community and are excited to collaborate with you.

## Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | Python package manager | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| [Docker](https://docs.docker.com/get-docker/) | Container runtime | [docs.docker.com](https://docs.docker.com/get-docker/) |
| [Helm 3](https://helm.sh/docs/intro/install/) | Kubernetes package manager | `brew install helm` |
| [helm-docs](https://github.com/norwoodj/helm-docs) | Auto-generate chart READMEs from `values.yaml` | see below |

### Installing helm-docs

```bash
# macOS / Linux (Homebrew)
brew install helm-docs

# Any platform (Go)
go install github.com/norwoodj/helm-docs/cmd/helm-docs@latest

# Binary download (Linux / macOS / Windows)
# https://github.com/norwoodj/helm-docs/releases
```

After modifying `values.yaml` in any chart, regenerate the chart READMEs:

```bash
make helm-docs
```

## Pull Request (PR) Policy

1. **Fork the Repository**: Start by forking the repository and creating a new branch for your changes.
2. **Write Clear Commit Messages**: Ensure your commit messages are concise and descriptive.
3. **Follow Coding Standards**: Adhere to the project's coding standards and guidelines.
4. **Testing**: Test your changes thoroughly before submitting a PR.
5. **PR Submission**:
    - Provide a clear description of the changes in the PR.
    - Reference any related issues or tickets.
6. **Approval Process**:
    - All PRs must be reviewed and approved by at least one maintainer.
    - Address any feedback promptly to ensure smooth progress.

## Code of Conduct

We are committed to fostering an open and welcoming environment. By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

Thank you for contributing!
