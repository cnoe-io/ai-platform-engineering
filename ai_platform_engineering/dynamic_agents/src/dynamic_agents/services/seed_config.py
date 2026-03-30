"""Seed configuration loader for Dynamic Agents.

Loads initial agents, MCP servers, and models from config.yaml at server startup.
These config-driven entities:
- Have explicit IDs specified in the config
- Override existing entities with the same ID (upsert behavior)
- Are marked as config_driven=True and cannot be edited/deleted via UI
- Are re-applied on every server restart (config is source of truth)
"""

import logging
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

from dynamic_agents.services.models_config import ModelInfo, set_available_models

if TYPE_CHECKING:
    from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)

# Use the same config file as models_config.py
DEFAULT_CONFIG_PATH = Path(__file__).parent / "config.yaml"

# Pattern to match ${VAR_NAME} or ${VAR_NAME:-default}
ENV_VAR_PATTERN = re.compile(r"\$\{([^}:]+)(?::-([^}]*))?\}")


def _expand_env_vars(value: Any) -> Any:
    """Recursively expand environment variables in a value.

    Supports ${VAR_NAME} and ${VAR_NAME:-default} syntax.
    """
    if isinstance(value, str):

        def replace_env_var(match: re.Match) -> str:
            var_name = match.group(1)
            default = match.group(2)  # May be None
            env_value = os.environ.get(var_name)
            if env_value is not None:
                return env_value
            if default is not None:
                return default
            logger.warning(f"Environment variable {var_name} not set and no default provided")
            return ""

        return ENV_VAR_PATTERN.sub(replace_env_var, value)
    elif isinstance(value, dict):
        return {k: _expand_env_vars(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [_expand_env_vars(item) for item in value]
    else:
        return value


def get_config_path() -> Path:
    """Get the configuration file path from environment or default."""
    env_path = os.environ.get("SEED_CONFIG_PATH")
    if env_path:
        return Path(env_path)
    return DEFAULT_CONFIG_PATH


def load_seed_config(config_path: Path | str | None = None) -> dict[str, Any]:
    """Load seed configuration from YAML file.

    Args:
        config_path: Path to the config YAML file.
                    Defaults to SEED_CONFIG_PATH env var or config.yaml in the same directory.

    Returns:
        Dictionary with 'agents' and 'mcp_servers' lists.
    """
    if config_path is None:
        config_path = get_config_path()

    config_path = Path(config_path)

    is_seed_config = os.environ.get("SEED_CONFIG_PATH") and str(config_path) == os.environ.get("SEED_CONFIG_PATH")
    source = "seed config" if is_seed_config else "default config"
    logger.info(f"Loading configuration from {source}: {config_path}")

    if not config_path.exists():
        logger.warning(f"Seed config not found at {config_path}, skipping seed")
        return {"agents": [], "mcp_servers": []}

    with open(config_path) as f:
        config = yaml.safe_load(f) or {}

    # Expand environment variables in the config
    models = config.get("models", [])
    agents = _expand_env_vars(config.get("agents", []))
    mcp_servers = _expand_env_vars(config.get("mcp_servers", []))

    return {"models": models, "agents": agents, "mcp_servers": mcp_servers}


def seed_mcp_servers(mongo: "MongoDBService", servers: list[dict[str, Any]]) -> int:
    """Upsert MCP servers from seed config.

    Args:
        mongo: MongoDB service instance
        servers: List of server configs from YAML

    Returns:
        Number of servers upserted
    """
    if not servers:
        return 0

    count = 0

    for server_data in servers:
        server_id = server_data.get("id")
        if not server_id:
            logger.warning("Skipping MCP server without id: %s", server_data.get("name", "unknown"))
            continue

        # Build the document to upsert
        doc = {
            "name": server_data.get("name", server_id),
            "description": server_data.get("description"),
            "transport": server_data.get("transport", "stdio"),
            "endpoint": server_data.get("endpoint"),
            "command": server_data.get("command"),
            "args": server_data.get("args"),
            "env": server_data.get("env"),
            "cwd": server_data.get("cwd"),
            "enabled": server_data.get("enabled", True),
            "config_driven": True,
        }

        mongo.upsert_server(server_id, doc)
        logger.info(f"Seeded MCP server: {server_id}")
        count += 1

    return count


def seed_agents(mongo: "MongoDBService", agents: list[dict[str, Any]]) -> int:
    """Upsert agents from seed config.

    Args:
        mongo: MongoDB service instance
        agents: List of agent configs from YAML

    Returns:
        Number of agents upserted
    """
    if not agents:
        return 0

    count = 0

    for agent_data in agents:
        agent_id = agent_data.get("id")
        if not agent_id:
            logger.warning("Skipping agent without id: %s", agent_data.get("name", "unknown"))
            continue

        # Build the document to upsert
        doc = {
            "name": agent_data.get("name", agent_id),
            "description": agent_data.get("description"),
            "system_prompt": agent_data.get("system_prompt", ""),
            "allowed_tools": agent_data.get("allowed_tools", {}),
            "model_id": agent_data.get("model_id", ""),
            "model_provider": agent_data.get("model_provider", ""),
            "visibility": agent_data.get("visibility", "global"),
            "shared_with_teams": agent_data.get("shared_with_teams"),
            "subagents": agent_data.get("subagents", []),
            "builtin_tools": agent_data.get("builtin_tools"),
            "enabled": agent_data.get("enabled", True),
            "owner_id": "system",  # Config-driven agents are owned by system
            "is_system": False,  # is_system is for hard-coded system agents
            "config_driven": True,
        }

        mongo.upsert_agent(agent_id, doc)
        logger.info(f"Seeded agent: {agent_id}")
        count += 1

    return count


def cleanup_stale_config_driven(
    mongo: "MongoDBService",
    current_server_ids: set[str],
    current_agent_ids: set[str],
) -> tuple[int, int]:
    """Remove config-driven entities that are no longer in the config.

    When an entity is removed from config.yaml, it should be deleted from
    the database on the next server restart. This function identifies and
    removes such stale entities.

    Args:
        mongo: MongoDB service instance
        current_server_ids: Set of server IDs currently defined in config
        current_agent_ids: Set of agent IDs currently defined in config

    Returns:
        Tuple of (servers_deleted, agents_deleted)
    """
    servers_deleted = 0
    agents_deleted = 0

    # Find and delete stale MCP servers
    all_servers = mongo.list_servers()
    for server in all_servers:
        if server.config_driven and server.id not in current_server_ids:
            logger.info(f"Removing stale config-driven MCP server: {server.id}")
            mongo.delete_server(server.id)
            servers_deleted += 1

    # Find and delete stale agents
    # We need to get all agents, not filtered by user access
    all_agents = mongo.list_all_agents()
    for agent in all_agents:
        if agent.config_driven and agent.id not in current_agent_ids:
            logger.info(f"Removing stale config-driven agent: {agent.id}")
            mongo.delete_agent(agent.id)
            agents_deleted += 1

    if servers_deleted or agents_deleted:
        logger.info(f"Cleaned up stale config-driven entities: {servers_deleted} servers, {agents_deleted} agents")

    return servers_deleted, agents_deleted


def apply_seed_config(mongo: "MongoDBService", config_path: Path | str | None = None) -> None:
    """Load and apply seed configuration from YAML.

    This function is called at server startup to ensure config-driven
    agents, MCP servers, and models are loaded and cached.

    Also cleans up config-driven entities that have been removed from the config.

    Args:
        mongo: MongoDB service instance
        config_path: Optional path to config YAML file
    """
    config = load_seed_config(config_path)

    models_data = config.get("models", [])
    mcp_servers = config.get("mcp_servers", [])
    agents = config.get("agents", [])

    logger.info(f"Found {len(models_data)} models, {len(mcp_servers)} MCP servers, {len(agents)} agents in config")

    # Load and cache models for API access
    models = [
        ModelInfo(
            model_id=m.get("model_id", ""),
            name=m.get("name", "Unknown"),
            provider=m.get("provider", "unknown"),
            description=m.get("description", ""),
        )
        for m in models_data
    ]
    set_available_models(models)

    # Extract IDs from current config
    current_server_ids = {s.get("id") for s in mcp_servers if s.get("id")}
    current_agent_ids = {a.get("id") for a in agents if a.get("id")}

    if not mcp_servers and not agents:
        logger.info("No MCP servers or agents to seed")
        # Still cleanup any existing config-driven entities
        cleanup_stale_config_driven(mongo, current_server_ids, current_agent_ids)
        return

    mcp_count = seed_mcp_servers(mongo, mcp_servers)
    agent_count = seed_agents(mongo, agents)

    # Cleanup entities that are no longer in the config
    cleanup_stale_config_driven(mongo, current_server_ids, current_agent_ids)

    logger.info(f"Seed configuration applied: {mcp_count} MCP servers, {agent_count} agents")
