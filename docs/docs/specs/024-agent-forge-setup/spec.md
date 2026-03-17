---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: Agent Forge Docker Build Integration"
---

# Agent Forge Docker Build Integration

**Status**: 🟢 In-use
**Category**: Integrations
**Date**: October 30, 2025 (consolidated November 5, 2025)

## Overview

The GitHub Action workflow has been configured to use a custom Dockerfile from `build/agent-forge/Dockerfile` instead of relying on a Dockerfile from the cloned community-plugins repository. This enables automated building and publishing of the Backstage Agent Forge plugin as a Docker image to GitHub Container Registry (ghcr.io).


## Testing Locally

The local test script (`test-build-locally.sh`) also uses your custom Dockerfile:

```bash
# Run the local test
./.github/test-build-locally.sh
```

The script will:
1. Clone the community-plugins repository
2. Copy your custom Dockerfile
3. Build the project
4. Create the Docker image
5. Offer to run the container


## Best Practices

1. **Keep it Simple**: Don't add unnecessary dependencies
2. **Use Multi-Stage**: Separate build and runtime stages
3. **Cache Layers**: Order commands from least to most frequently changing
4. **Security**: Use official base images and keep them updated
5. **Document**: Comment complex commands in the Dockerfile
6. **Test**: Always test changes locally before pushing


## Overview

A GitHub Action workflow has been created to automatically build and push the Backstage Agent Forge plugin Docker image to GitHub Container Registry.


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



## Related

- Architecture: [architecture.md](./architecture.md)
