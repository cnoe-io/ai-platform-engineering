# Agent Forge GitHub Action Workflow Setup

**Status**: 🟢 In-use
**Category**: Integrations
**Date**: October 30, 2025

## Overview

A GitHub Action workflow has been created to automatically build and push the Backstage Agent Forge plugin Docker image to GitHub Container Registry.

## Files Created

### 1. `.github/workflows/build-agent-forge-plugin.yml`
The main workflow file that orchestrates the build and push process.

**Key Features:**
- ✅ Uses custom Dockerfile from `build/agent-forge/Dockerfile`
- ✅ Clones `https://github.com/cnoe-io/community-plugins.git` (branch: `agent-forge-upstream-docker`)
- ✅ Sets up Node.js 20 environment with Yarn
- ✅ Installs dependencies and builds the project
- ✅ Builds multi-platform Docker image (amd64 & arm64)
- ✅ Pushes to `ghcr.io/cnoe-io/backstage-plugin-agent-forge`
- ✅ Automatic tagging (latest, branch name, SHA, semantic versions)
- ✅ Build caching for faster subsequent runs
- ✅ Supply chain security with attestations

### 2. `.github/workflows/README.md`
Comprehensive documentation including:
- Workflow triggers and behavior
- Usage instructions
- Troubleshooting guide
- Customization options
- Security considerations

## Docker Image Details

**Registry:** GitHub Container Registry (ghcr.io)

**Image Name:** `ghcr.io/cnoe-io/backstage-plugin-agent-forge`

**Available Tags:**
- `latest` - Latest stable build
- `<branch>` - Branch-specific builds
- `<branch>-<sha>` - Commit-specific builds
- `<version>` - Semantic version tags

## Quick Start

### Pull the Image

```bash
docker pull ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

### Run the Container

```bash
docker run -d \
  -p 7007:7007 \
  --name agent-forge-plugin \
  ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

## Triggering the Workflow

The workflow can be triggered in three ways:

### 1. Automatic (Push)
Push to `main` or `develop` branch:
```bash
git push origin main
```

### 2. Pull Request
Open a PR targeting the `main` branch

### 3. Manual Trigger
1. Navigate to **Actions** tab in GitHub
2. Select **Build and Push Agent Forge Plugin**
3. Click **Run workflow**
4. Choose branch and click **Run workflow** button

## Prerequisites Checklist

Before running the workflow, ensure:

- [x] Custom Dockerfile exists at `build/agent-forge/Dockerfile` (✓ already present)
- [ ] Repository has GitHub Actions enabled
- [ ] `GITHUB_TOKEN` has package write permissions (Settings → Actions → General → Workflow permissions)
- [ ] The `cnoe-io/community-plugins` repository is accessible
- [ ] Branch `agent-forge-upstream-docker` exists in community-plugins
- [ ] Repository settings allow package publishing

## Configuration Settings

### GitHub Repository Settings

1. **Enable Package Publishing:**
   - Go to Settings → Actions → General
   - Under "Workflow permissions", select "Read and write permissions"
   - Check "Allow GitHub Actions to create and approve pull requests"

2. **Package Visibility:**
   - Go to the package settings after first build
   - Set visibility to "Public" if needed

### Workflow Customization

To customize the workflow, edit `.github/workflows/build-agent-forge-plugin.yml`:

```yaml
# Change trigger branches
on:
  push:
    branches:
      - main
      - your-branch

# Change source repository/branch
- uses: actions/checkout@v4
  with:
    repository: cnoe-io/community-plugins
    ref: your-branch-name

# Change Docker build settings
platforms: linux/amd64,linux/arm64
```

## Monitoring and Logs

### View Workflow Status

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Select the workflow run to view logs

### Check Published Packages

1. Navigate to your repository homepage
2. Click **Packages** in the right sidebar
3. View `backstage-plugin-agent-forge` package

### Download Artifacts

The workflow creates attestations for supply chain security:
- Available in the workflow run under "Artifacts"
- Automatically pushed to the registry

## Advanced Usage

### Building for Specific Platforms

Edit the workflow to build for specific platforms:

```yaml
platforms: linux/amd64  # Only amd64
# or
platforms: linux/arm64  # Only arm64
```

### Custom Build Arguments

Add build arguments:

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    build-args: |
      NODE_ENV=production
      VERSION=${{ github.sha }}
```

### Conditional Execution

Run only on specific conditions:

```yaml
- name: Build and push Docker image
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

## Troubleshooting

### Common Issues

**Problem:** Workflow fails at checkout step
```
Solution: Verify the repository URL and branch name are correct
```

**Problem:** Build fails with "command not found"
```
Solution: Check that the build commands in package.json are correct
          Update Node.js version if needed
```

**Problem:** Cannot push to ghcr.io
```
Solution: Enable write permissions for GITHUB_TOKEN in repository settings
          Path: Settings → Actions → General → Workflow permissions
```

**Problem:** Custom Dockerfile not found
```
Solution: Ensure build/agent-forge/Dockerfile exists in your repository
          The workflow copies this file to the community-plugins directory
```

## Next Steps

1. **Commit and push** the workflow files to your repository
2. **Configure** repository permissions for package publishing
3. **Trigger** the workflow manually or via push
4. **Monitor** the build in the Actions tab
5. **Verify** the image is available at `ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest`

## Support

For issues or questions:
- Review the workflow logs in the Actions tab
- Check the [GitHub Actions documentation](https://docs.github.com/en/actions)
- Verify the [community-plugins repository](https://github.com/cnoe-io/community-plugins)

---

**Date Added:** October 30, 2025
**Workflow Version:** 1.0
**Maintainer:** Platform Engineering Team
**Related Documentation:** [Agent Forge Docker Build Integration](./2025-10-30-agent-forge-docker-build.md)

