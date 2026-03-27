# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Inline Templates for Agent Generation

These templates are used as fallback when external template files are not available.
"""

from .models import AgentManifest, AgentProtocol


def get_template(template_name: str, manifest: AgentManifest) -> str:
    """Get template content by name"""
    templates = {
        "agent_init.py.j2": _agent_init_template,
        "agent_main.py.j2": _agent_main_template,
        "agentcard.py.j2": _agentcard_template,
        "agent_state.py.j2": _agent_state_template,
        "a2a_init.py.j2": _a2a_init_template,
        "a2a_agent.py.j2": _a2a_agent_template,
        "a2a_executor.py.j2": _a2a_executor_template,
        "a2a_helpers.py.j2": _a2a_helpers_template,
        "a2a_readme.md.j2": _a2a_readme_template,
        "mcp_server.py.j2": _mcp_server_template,
        "mcp_pyproject.toml.j2": _mcp_pyproject_template,
        "mcp_makefile.j2": _mcp_makefile_template,
        "pyproject.toml.j2": _pyproject_template,
        "makefile.j2": _makefile_template,
        "dockerfile_a2a.j2": _dockerfile_a2a_template,
        "env.example.j2": _env_example_template,
        "langgraph.json.j2": _langgraph_json_template,
        "readme.md.j2": _readme_template,
        "changelog.md.j2": _changelog_template,
        "test_agent.py.j2": _test_agent_template,
        "client_a2a.py.j2": _client_a2a_template,
        "client_slim.py.j2": _client_slim_template,
    }
    
    template_func = templates.get(template_name)
    if template_func:
        return template_func(manifest)
    
    return f"# Template {template_name} not found\n"


def _agent_init_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
{manifest.metadata.display_name} Agent Package

{manifest.metadata.description}
\"\"\"

__version__ = "{manifest.metadata.version}"
"""


def _agent_main_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
Main entry point for {manifest.metadata.display_name} Agent
\"\"\"

if __name__ == "__main__":
    print("{manifest.metadata.display_name} Agent v{manifest.metadata.version}")
    print("To run the agent, use: make run-a2a")
"""


def _agentcard_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    
    # Build skills section
    skills_code = []
    for skill in manifest.skills:
        examples_str = ',\n      '.join([f'"{ex}"' for ex in skill.examples])
        tags_str = ',\n    '.join([f'"{tag}"' for tag in skill.tags])
        
        skills_code.append(f'''AgentSkill(
  id="{skill.id}",
  name="{skill.name}",
  description="{skill.description}",
  tags=[
    {tags_str}],
    examples=[
      {examples_str}
  ])''')
    
    skills_str = ',\n  '.join(skills_code)
    
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

# ==================================================
# AGENT SPECIFIC CONFIGURATION
# Auto-generated from manifest
# ==================================================
AGENT_NAME = '{agent_name}'
AGENT_DESCRIPTION = (
  "{manifest.metadata.description}"
)

# Agent Skills
agent_skills = [
  {skills_str}
]

# ==================================================
# SHARED CONFIGURATION
# ==================================================
SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(
  streaming={str(manifest.capabilities.get('streaming', True))},
  pushNotifications={str(manifest.capabilities.get('pushNotifications', True))}
)

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {{AGENT_NAME.upper()}} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {{agent_url}}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{{AGENT_NAME.lower()}}-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='{manifest.metadata.version}',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=agent_skills,
    security=[{{"public": []}}],
  )
"""


def _agent_state_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
State management for {manifest.metadata.display_name} Agent
\"\"\"

from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    \"\"\"State for the {manifest.metadata.display_name} agent\"\"\"
    messages: Annotated[list, add_messages]
"""


def _a2a_init_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
A2A Server Bindings for {manifest.metadata.display_name} Agent
\"\"\"
"""


def _a2a_agent_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    pkg_name = f"agent_{agent_name}"
    
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
A2A Agent Implementation for {manifest.metadata.display_name}
\"\"\"

import os
from a2a import A2AServer
from {pkg_name}.agentcard import create_agent_card
from {pkg_name}.protocol_bindings.a2a_server.agent_executor import create_agent_executor

# Configuration
HOST = os.getenv("A2A_AGENT_HOST", "0.0.0.0")
PORT = int(os.getenv("A2A_AGENT_PORT", "8000"))
AGENT_URL = os.getenv("A2A_AGENT_URL", f"http://{{HOST}}:{{PORT}}")

# Create agent card
agent_card = create_agent_card(AGENT_URL)

# Create agent executor
agent_executor = create_agent_executor()

# Create A2A server
a2a_agent = A2AServer(
    agent_card=agent_card,
    agent_executor=agent_executor
)

def main():
    \"\"\"Main entry point for A2A server\"\"\"
    print(f"Starting {{agent_card.name}} agent on {{HOST}}:{{PORT}}")
    a2a_agent.run(host=HOST, port=PORT)

if __name__ == "__main__":
    main()
"""


def _a2a_executor_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    pkg_name = f"agent_{agent_name}"
    
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
Agent Executor for {manifest.metadata.display_name}
\"\"\"

import os
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import create_react_agent
from ai_platform_engineering.utils.models.llm_utils import get_llm
from {pkg_name}.state import AgentState

def create_agent_executor():
    \"\"\"Create the agent executor with LangGraph\"\"\"
    
    # Get LLM
    llm = get_llm()
    
    # Create tools list (add your tools here)
    tools = []
    
    # Create ReAct agent
    react_agent = create_react_agent(llm, tools)
    
    # Define agent workflow
    workflow = StateGraph(AgentState)
    
    def agent_node(state: AgentState):
        \"\"\"Agent processing node\"\"\"
        result = react_agent.invoke(state)
        return {{"messages": result["messages"]}}
    
    workflow.add_node("agent", agent_node)
    workflow.add_edge(START, "agent")
    workflow.add_edge("agent", END)
    
    return workflow.compile()
"""


def _a2a_helpers_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
Helper functions for {manifest.metadata.display_name} Agent
\"\"\"

def format_response(data):
    \"\"\"Format agent response\"\"\"
    return str(data)
"""


def _a2a_readme_template(manifest: AgentManifest) -> str:
    return f"""# {manifest.metadata.display_name} A2A Server

A2A protocol binding for the {manifest.metadata.display_name} agent.

## Running

```bash
make run-a2a
```
"""


def _mcp_server_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
MCP Server for {manifest.metadata.display_name}
\"\"\"

import os
from mcp.server import Server
from mcp.server.stdio import stdio_server

# Create MCP server
server = Server("{agent_name}")

@server.list_tools()
async def list_tools():
    \"\"\"List available tools\"\"\"
    return []

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    \"\"\"Call a tool\"\"\"
    return {{"content": [{{"type": "text", "text": f"Tool {{name}} not implemented"}}]}}

async def main():
    \"\"\"Main entry point\"\"\"
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
"""


def _mcp_pyproject_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    
    return f"""[project]
name = "mcp_{agent_name}"
version = "{manifest.metadata.version}"
description = "MCP server for {manifest.metadata.display_name}"
requires-python = ">=3.13"
dependencies = [
    "mcp>=0.1.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
"""


def _mcp_makefile_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    
    return f"""# MCP Server Makefile
AGENT_NAME = {agent_name}
MCP_PACKAGE_NAME = mcp_{agent_name}

include ../../mcp-common.mk
"""


def _pyproject_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    pkg_name = f"agent_{agent_name}"
    
    # Build dependencies
    deps = [
        '"a2a-sdk>=0.2.16"',
        '"langchain-core>=0.3.60"',
        '"langchain-openai>=0.3.17"',
        '"langgraph>=0.5.3"',
        '"python-dotenv>=1.0.1"',
        '"cnoe-agent-utils>=0.3.2"',
    ]
    
    # Add custom dependencies from manifest
    for dep in manifest.dependencies:
        if dep.source.value == "pypi":
            if dep.version:
                deps.append(f'"{dep.name}{dep.version}"')
            else:
                deps.append(f'"{dep.name}"')
    
    deps_str = ',\n    '.join(deps)
    
    author_section = ""
    if manifest.metadata.author:
        author_section = f'''authors = [
    {{ name = "{manifest.metadata.author}", email = "{manifest.metadata.author_email or ''}" }},
]
'''
    
    return f"""[project]
name = "{pkg_name}"
version = "{manifest.metadata.version}"
license = "{manifest.metadata.license}"
description = "{manifest.metadata.description}"
readme = "README.md"
{author_section}requires-python = ">=3.13,<4.0"
dependencies = [
    {deps_str}
]

[tool.hatch.build.targets.wheel]
packages = ["."]

[tool.hatch.metadata]
allow-direct-references = true

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 140
indent-width = 2

[tool.ruff.lint]
select = ["E", "F"]
ignore = ["F403"]
"""


def _makefile_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    
    return f"""# {manifest.metadata.display_name} Agent Makefile

AGENT_NAME = {agent_name}

include ../common.mk
"""


def _dockerfile_a2a_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    pkg_name = f"agent_{agent_name}"
    base_image = manifest.docker_config.get('base_image', 'python:3.13-slim')
    
    return f"""FROM {base_image}

WORKDIR /app

# Install uv
RUN pip install uv

# Copy project files
COPY . .

# Install dependencies
RUN uv pip install --system -e .

# Expose port
EXPOSE 8000

# Run the agent
CMD ["python", "-m", "{pkg_name}.protocol_bindings.a2a_server.agent"]
"""


def _env_example_template(manifest: AgentManifest) -> str:
    lines = [
        "############################",
        "# Agent Configuration",
        "############################",
        "LLM_PROVIDER=azure-openai",
        f"AGENT_NAME={manifest.metadata.name}",
        "",
        "############################",
        "# LLM Configuration",
        "############################",
        "AZURE_OPENAI_API_KEY=",
        "AZURE_OPENAI_ENDPOINT=",
        "AZURE_OPENAI_DEPLOYMENT=gpt-4",
        ""
    ]
    
    # Add custom environment variables
    if manifest.environment:
        lines.extend([
            "############################",
            f"# {manifest.metadata.display_name} Configuration",
            "############################"
        ])
        for env_var in manifest.environment:
            default_val = env_var.default or ""
            lines.append(f"{env_var.name}={default_val}  # {env_var.description}")
        lines.append("")
    
    return '\n'.join(lines)


def _langgraph_json_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    pkg_name = f"agent_{agent_name}"
    
    return f"""{{
  "dependencies": ["."],
  "graphs": {{
    "{agent_name}": "./{pkg_name}/protocol_bindings/a2a_server/agent_executor.py:create_agent_executor"
  }},
  "env": ".env"
}}
"""


def _readme_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    
    # Build skills documentation
    skills_docs = []
    for skill in manifest.skills:
        examples_md = '\n'.join([f"- {ex}" for ex in skill.examples])
        skills_docs.append(f"""### {skill.name}

{skill.description}

**Examples:**
{examples_md}
""")
    
    skills_section = '\n\n'.join(skills_docs)
    
    # Build environment variables documentation
    env_docs = []
    if manifest.environment:
        for env_var in manifest.environment:
            required = "✅ Required" if env_var.required else "Optional"
            default_text = f" (default: `{env_var.default}`)" if env_var.default else ""
            env_docs.append(f"- `{env_var.name}`: {env_var.description} - {required}{default_text}")
    
    env_section = '\n'.join(env_docs) if env_docs else "No additional environment variables required."
    
    return f"""# 🚀 {manifest.metadata.display_name}

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-{manifest.metadata.license}-green)](LICENSE)

{manifest.metadata.description}

**Version:** {manifest.metadata.version}

## 🚀 Getting Started

### 1️⃣ Configure Environment

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
LLM_PROVIDER=azure-openai
AGENT_NAME={agent_name}
AZURE_OPENAI_API_KEY=your_api_key
AZURE_OPENAI_ENDPOINT=your_endpoint
AZURE_OPENAI_DEPLOYMENT=gpt-4
```

### 2️⃣ Install Dependencies

```bash
make uv-sync
```

### 3️⃣ Start the Agent

```bash
make run-a2a
```

### 4️⃣ Test the Agent

In a new terminal:

```bash
make run-a2a-client
```

## ✨ Features

{skills_section}

## 🔧 Configuration

### Environment Variables

{env_section}

## 📚 Documentation

- [API Documentation](docs/api.md) - Detailed API reference
- [Development Guide](docs/development.md) - Setup and development workflow

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

{manifest.metadata.license}

---

*This agent was auto-generated using the CNOE Agent Generator.*
"""


def _changelog_template(manifest: AgentManifest) -> str:
    return f"""# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [{manifest.metadata.version}] - Initial Release

### Added
- Initial agent implementation
- Basic functionality for {manifest.metadata.display_name}
"""


def _test_agent_template(manifest: AgentManifest) -> str:
    agent_name = manifest.metadata.name
    pkg_name = f"agent_{agent_name}"
    
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
Tests for {manifest.metadata.display_name} Agent
\"\"\"

import pytest


def test_agent_import():
    \"\"\"Test that agent can be imported\"\"\"
    from {pkg_name} import __version__
    assert __version__ == "{manifest.metadata.version}"


def test_agent_card():
    \"\"\"Test agent card creation\"\"\"
    from {pkg_name}.agentcard import create_agent_card
    
    agent_card = create_agent_card("http://localhost:8000")
    assert agent_card.name == "{agent_name}"
    assert agent_card.version == "{manifest.metadata.version}"
"""


def _client_a2a_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
A2A Client for {manifest.metadata.display_name}
\"\"\"

import os
from a2a import A2AClient

def main():
    agent_url = os.getenv("A2A_AGENT_URL", "http://localhost:8000")
    
    client = A2AClient(agent_url)
    
    print(f"Connected to {manifest.metadata.display_name} at {{agent_url}}")
    print("Enter your queries (type 'exit' to quit):")
    
    while True:
        query = input("\\n> ")
        if query.lower() == 'exit':
            break
        
        response = client.send(query)
        print(f"\\nAgent: {{response}}")

if __name__ == "__main__":
    main()
"""


def _client_slim_template(manifest: AgentManifest) -> str:
    return f"""# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

\"\"\"
SLIM Client for {manifest.metadata.display_name}
\"\"\"

import os

def main():
    print("{manifest.metadata.display_name} - SLIM Client")
    print("SLIM client implementation pending")

if __name__ == "__main__":
    main()
"""

