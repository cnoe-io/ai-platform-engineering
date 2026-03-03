---
sidebar_position: 3
---

# Configure LLM Providers for KinD (Optional)

This page is **optional**. If you used [Run CAIPE with KinD](/getting-started/kind/setup) and ran `./setup-caipe.sh`, the script already prompted you for an LLM provider and API key and stored them in the cluster. You can skip this page unless you need to:

- **Change** the LLM provider or model after setup
- **Add or rotate** API keys without re-running the full setup
- **Configure** LLM access for automation (e.g. non-interactive or CI)

For the standard flow, the [KinD setup guide](/getting-started/kind/setup) (Step 3) is enough.

---

## When you need this

Use the steps below when you want to update LLM configuration manually (e.g. via `kubectl` or Helm) instead of re-running `./setup-caipe.sh`. The exact secret names and keys depend on your deployment; they are typically created by the setup script in the `ai-platform-engineering` (or similar) namespace.

- **Anthropic Claude**: Store the API key in a Kubernetes secret; the setup script can also prompt for it interactively.
- **OpenAI**: Same idea—use a Kubernetes secret or re-run the setup script and choose OpenAI when prompted.
- **AWS Bedrock**: Use AWS credentials (env vars or `~/.aws/credentials`) or a Kubernetes secret as described in the [KinD setup](/getting-started/kind/setup#aws-bedrock) section.

For full options and environment variables, see [Run CAIPE with KinD](/getting-started/kind/setup).