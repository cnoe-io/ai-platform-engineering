# Kubernetes Agent Sandbox Integration with DeepAgents

## Overview

Research on integrating [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) as a sandbox provider for the DeepAgents library.

## Source

- Repository: https://github.com/kubernetes-sigs/agent-sandbox
- Python SDK: `k8s-agent-sandbox` ([PyPI](https://pypi.org/project/k8s-agent-sandbox/))
- License: Apache-2.0

## What is K8s Agent Sandbox?

A Kubernetes-native solution for managing isolated, stateful, singleton workloads ideal for AI agent runtimes. Provides:

- `Sandbox` CRD with stable identity and persistent storage
- `SandboxClaim` / `SandboxTemplate` for declarative provisioning
- `SandboxWarmPool` for pre-warmed pods (fast allocation)
- Strong isolation via gVisor/Kata Containers
- Python SDK for programmatic access via Gateway/Router HTTP API

## DeepAgents Sandbox Architecture

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SandboxBackendProtocol` | `deepagents.backends.protocol` | Protocol for sandbox backends |
| `BaseSandbox` | `deepagents.backends.sandbox` | Abstract base class - implements file ops via `execute()` |
| `SandboxProvider` | `deepagents_cli.integrations.sandbox_provider` | Factory interface for lifecycle management |
| `FilesystemMiddleware` | `deepagents.middleware.filesystem` | Provides tools to agents (ls, read, write, execute, etc.) |

### Existing Providers

- Daytona (`libs/partners/daytona/`)
- Modal (`libs/partners/modal/`)
- Runloop (`libs/partners/runloop/`)
- LangSmith (`libs/deepagents/deepagents/backends/langsmith.py`)

## Extensibility

**Confirmed: Fully extensible.**

To add a custom sandbox provider, extend `BaseSandbox` and implement 4 methods:

```python
from deepagents.backends.sandbox import BaseSandbox
from deepagents.backends.protocol import ExecuteResponse, FileDownloadResponse, FileUploadResponse

class K8sAgentSandbox(BaseSandbox):
    
    @property
    def id(self) -> str:
        """Unique identifier for the sandbox."""
        return self._client.sandbox_name
    
    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        """Execute shell command - the only required execution method."""
        result = self._client.run(command, timeout=timeout)
        return ExecuteResponse(
            output=result.stdout,
            exit_code=result.exit_code,
            truncated=False,
        )
    
    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """Upload binary files to sandbox."""
        ...
    
    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Download binary files from sandbox."""
        ...
```

All other file operations (`read`, `write`, `edit`, `ls`, `glob`, `grep`) are automatically implemented via `execute()` by the base class using Python scripts.

## API Mapping

| DeepAgents Method | k8s-agent-sandbox SDK |
|-------------------|----------------------|
| `execute(command)` | `SandboxClient.run(command)` |
| `upload_files()` | `SandboxClient.write_file(path, content)` |
| `download_files()` | `SandboxClient.read_file(path)` |
| `id` property | `sandbox_name` or `claim_name` |

## Implementation Options

### Option 1: External Package (Recommended)

Create a standalone package in your own repository:

```
your-saas-sandbox/
├── pyproject.toml          # depends on deepagents, k8s-agent-sandbox
├── src/your_saas_sandbox/
│   ├── __init__.py
│   ├── sandbox.py          # BaseSandbox implementation
│   └── provider.py         # SandboxProvider (optional)
└── tests/
```

**Pros:**
- Full control, private if needed
- Integrated with your SaaS CI/CD
- No upstream contribution required

### Option 2: Partner Package

Add to `libs/partners/k8s-agent-sandbox/` in DeepAgents monorepo.

**Pros:**
- Community maintained
- Included in standard test suite

**Cons:**
- Requires PR approval
- Follows monorepo release cadence

## Usage Example

```python
from deepagents.middleware.filesystem import FilesystemMiddleware
from k8s_agent_sandbox import SandboxClient
from your_saas_sandbox import K8sAgentSandbox

# Connect via in-cluster service DNS
with SandboxClient(
    template_name="python-sandbox-template",
    api_url="http://sandbox-router-svc.default.svc:8080",
    namespace="my-namespace",
) as k8s_client:
    
    sandbox = K8sAgentSandbox(client=k8s_client)
    
    # Use with FilesystemMiddleware - agent gets all tools automatically
    middleware = FilesystemMiddleware(backend=sandbox)
```

## Deployment Considerations

- **In-cluster**: Use K8s service DNS (`http://sandbox-router-svc.<ns>.svc.cluster.local:8080`)
- **External**: Use Gateway with public IP or `kubectl port-forward` for dev
- **Lifecycle**: Can create new sandboxes via `SandboxClaim` or connect to existing ones

## Status

Future consideration - feasibility confirmed.

## References

- [DeepAgents BaseSandbox](../deepagents-upstream/libs/deepagents/deepagents/backends/sandbox.py)
- [DeepAgents SandboxBackendProtocol](../deepagents-upstream/libs/deepagents/deepagents/backends/protocol.py)
- [Daytona Provider Example](../deepagents-upstream/libs/partners/daytona/)
- [K8s Agent Sandbox Docs](https://agent-sandbox.sigs.k8s.io/docs/)
