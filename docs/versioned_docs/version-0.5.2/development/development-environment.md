# Development Environment Setup

This guide will help you set up your local development environment for building and testing agents and MCP servers.

## Prerequisites

### Required Software

Before starting, ensure you have the following installed:

- **Python 3.11 or higher** ([Download](https://www.python.org/downloads/))
- **uv** - Fast Python package manager ([Install Guide](https://docs.astral.sh/uv/getting-started/installation/))
- **Git** - Version control ([Download](https://git-scm.com/downloads))
- **Docker** - Container runtime ([Download](https://docs.docker.com/get-docker/))
- **Make** - Build automation (usually pre-installed on macOS/Linux)

### Verify Installation

```bash
# Check Python version
python --version  # Should be 3.11 or higher

# Check uv installation
uv --version

# Check Git
git --version

# Check Docker
docker --version

# Check Make
make --version
```

## Clone the Repository

```bash
# Clone the repository
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering

# Create a development branch
git checkout -b feat/my-new-feature
```

## Environment Configuration

### LLM API Keys

You'll need an API key from at least one LLM provider:

- **OpenAI**: [Get API Key](https://platform.openai.com/api-keys)
- **Anthropic**: [Get API Key](https://console.anthropic.com/settings/keys)
- **Azure OpenAI**: [Get Access](https://azure.microsoft.com/en-us/products/ai-services/openai-service)

### Create `.env` File

Create a `.env` file in the project root:

```bash
# Copy the example environment file
cp .env.example .env
```

Edit `.env` with your configuration:

```env
############################
# LLM Configuration
############################
# Choose your LLM provider: openai, anthropic, or azure-openai
LLM_PROVIDER=openai

# OpenAI Configuration
OPENAI_API_KEY=sk-your-key-here
MODEL_NAME=gpt-4o

# Anthropic Configuration (if using)
ANTHROPIC_API_KEY=your-anthropic-key-here
# MODEL_NAME=claude-3-5-sonnet-20241022

# Azure OpenAI Configuration (if using)
# AZURE_OPENAI_API_KEY=your-azure-key-here
# AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
# AZURE_OPENAI_DEPLOYMENT=gpt-4o
# OPENAI_API_VERSION=2024-08-01-preview

############################
# Agent Configuration
############################
AGENT_HOST=0.0.0.0
AGENT_PORT=8000
LOG_LEVEL=INFO

############################
# Context Management
############################
MAX_CONTEXT_TOKENS=20000
MAX_TOOL_OUTPUT_SIZE=5000

############################
# A2A Protocol
############################
A2A_AGENT_PORT=8000
A2A_AUTH_ENABLED=false
```

## Install Dependencies

### Using uv (Recommended)

```bash
# Install all dependencies including dev tools
uv sync --all-groups

# Activate the virtual environment
source .venv/bin/activate
```

### Verify Installation

```bash
# Check installed packages
uv pip list

# Test Python imports
python -c "import langchain; import langgraph; print('✓ Dependencies installed successfully')"
```

## IDE Setup

### Visual Studio Code

Install recommended extensions:

```bash
# Install VS Code extensions (optional)
code --install-extension ms-python.python
code --install-extension ms-python.vscode-pylance
code --install-extension charliermarsh.ruff
```

Create `.vscode/settings.json`:

```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/.venv/bin/python",
  "python.linting.enabled": true,
  "python.linting.ruffEnabled": true,
  "python.formatting.provider": "none",
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll": "explicit",
      "source.organizeImports": "explicit"
    }
  },
  "files.exclude": {
    "**/__pycache__": true,
    "**/*.pyc": true
  }
}
```

### PyCharm / IntelliJ IDEA

1. Open the project in PyCharm
2. Configure Python interpreter: **Settings** → **Project** → **Python Interpreter**
3. Select the `.venv/bin/python` interpreter
4. Enable Ruff: **Settings** → **Tools** → **External Tools**

## Project Structure Overview

```
ai-platform-engineering/
├── ai_platform_engineering/
│   ├── agents/                    # Individual agent implementations
│   │   ├── argocd/               # ArgoCD agent
│   │   ├── aws/                  # AWS agent
│   │   ├── jira/                 # Jira agent
│   │   └── template/             # Template agent (start here!)
│   ├── multi_agents/             # Multi-agent orchestration
│   │   └── platform_engineer/   # Platform engineer supervisor
│   ├── utils/                    # Shared utilities
│   │   └── a2a_common/          # A2A protocol utilities
│   └── knowledge_bases/          # RAG implementations
├── charts/                       # Helm charts for deployment
├── build/                        # Docker build files
├── docs/                         # Documentation (Docusaurus)
├── evals/                        # Evaluation suites
├── integration/                  # Integration tests
├── scripts/                      # Build and utility scripts
├── docker-compose.yaml           # Production compose
├── docker-compose.dev.yaml       # Development compose
├── Makefile                      # Build automation
├── pyproject.toml               # Python dependencies
└── uv.lock                      # Locked dependencies
```

## Development Workflow

### Running Tests

```bash
# Run all tests
make test

# Run supervisor tests only
make test-supervisor

# Run agent tests
make test-agents

# Run specific agent tests
make test-agent-argocd
make test-mcp-jira
```

### Code Quality

```bash
# Run linter
make lint

# Auto-fix linting issues
make lint-fix

# Format code
ruff format .
```

### Running Agents Locally

```bash
# Run a specific agent (e.g., Jira)
cd ai_platform_engineering/agents/jira
make run-a2a

# In another terminal, connect a client
make run-a2a-client
```

### Using Docker Compose

```bash
# Start all services in development mode
docker compose -f docker-compose.dev.yaml up

# Start specific services
docker compose -f docker-compose.dev.yaml up caipe-supervisor mcp-jira

# Rebuild after code changes
docker compose -f docker-compose.dev.yaml up --build

# View logs
docker compose -f docker-compose.dev.yaml logs -f agent-jira
```

## Common Development Tasks

### Create a New Branch

```bash
# Feature branch
git checkout -b feat/my-new-feature

# Bug fix branch
git checkout -b fix/bug-description

# Documentation branch
git checkout -b docs/update-guide
```

### Commit Changes (with DCO)

All commits must be signed off (Developer Certificate of Origin):

```bash
# Stage changes
git add .

# Commit with sign-off
git commit -s -m "feat: add new feature

Detailed description of the changes.

Closes #123"
```

### Push and Create PR

```bash
# Push to your fork
git push origin feat/my-new-feature

# Create PR using GitHub CLI (optional)
gh pr create --title "feat: add new feature" --body "Description..."
```

## Troubleshooting

### Common Issues

#### uv command not found

```bash
# Install uv using pip
pip install uv

# Or using curl (macOS/Linux)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

#### Python version mismatch

```bash
# Install Python 3.11+ using pyenv
pyenv install 3.11
pyenv local 3.11
```

#### Docker permission denied

```bash
# Add your user to the docker group (Linux)
sudo usermod -aG docker $USER
newgrp docker

# Or use Docker Desktop (macOS/Windows)
```

#### Port already in use

```bash
# Find what's using the port
lsof -i :8000

# Kill the process
kill -9 <PID>

# Or change the port in .env
A2A_AGENT_PORT=8001
```

### Getting Help

- Check existing issues: [GitHub Issues](https://github.com/cnoe-io/ai-platform-engineering/issues)
- Ask in discussions: [GitHub Discussions](https://github.com/cnoe-io/ai-platform-engineering/discussions)
- Join community meetings: [Community Calendar](../community/index.md)

## Next Steps

Now that your environment is set up, you're ready to:

1. **[Create Your First Agent](./creating-an-agent)** - Build a new agent from the template
2. **[Build an MCP Server](./creating-mcp-server)** - Connect to external APIs
3. **[Explore Existing Agents](../agents/README.md)** - Learn from production examples

---

**Pro Tips:**

- Use `make help` to see all available make targets
- Keep your `.env` file updated with required credentials
- Run tests frequently to catch issues early
- Use Docker for consistent environments across team members
- Enable pre-commit hooks for automated checks

Happy coding! 🚀

