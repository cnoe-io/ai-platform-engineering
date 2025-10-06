#!/usr/bin/env python3
"""
CAIPE Docker Compose Generator
===============================

Dynamically generates docker-compose.yaml files based on persona configurations.
Each persona defines a set of AI agents and their communication transport (P2P or SLIM).

Usage:
    ./generate-docker-compose.py --persona argocd --output docker-compose/docker-compose.argocd.yaml
    ./generate-docker-compose.py --persona github aws --dev

Author: CAIPE Team
License: Apache 2.0
"""

import yaml
import argparse
import os
from pathlib import Path
from typing import Dict, List, Optional, Any


# ============================================================================
# Configuration Constants
# ============================================================================

# All available agents in the platform
ALL_AGENTS = [
    'argocd', 'aws', 'backstage', 'confluence', 'github', 'jira',
    'komodor', 'pagerduty', 'slack', 'splunk', 'weather', 'webex',
    'petstore', 'rag'
]

# Transport mode mapping for profile names
TRANSPORT_PROFILES = {
    'p2p': 'a2a-p2p',
    'slim': 'a2a-over-slim'
}

# Default paths
DEFAULT_ENV_FILE = '../.env'
DEFAULT_PERSONA_FILE = 'persona.yaml'


# ============================================================================
# Configuration Loading
# ============================================================================

def load_profiles(profiles_file: str = DEFAULT_PERSONA_FILE) -> Dict[str, Any]:
    """
    Load persona configuration from YAML file.
    
    Args:
        profiles_file: Path to persona.yaml configuration file
        
    Returns:
        Dictionary containing persona definitions and metadata
        
    Raises:
        FileNotFoundError: If profiles_file doesn't exist
        yaml.YAMLError: If file contains invalid YAML
    """
    with open(profiles_file, 'r') as f:
        return yaml.safe_load(f)


def get_transport_from_env() -> str:
    """
    Get A2A transport mode from environment variable.
    
    Returns:
        Transport mode ('p2p' or 'slim'), defaults to 'p2p'
    """
    return os.getenv('A2A_TRANSPORT', 'p2p')


# ============================================================================
# Agent Configuration
# ============================================================================

def get_agent_defaults(agent_name: str) -> Dict[str, Any]:
    """
    Get default configuration for a specific agent.
    
    Each agent has default settings for image, MCP configuration,
    volumes, and other service-specific parameters.
    
    Args:
        agent_name: Name of the agent (e.g., 'argocd', 'github')
        
    Returns:
        Dictionary with agent's default configuration including:
        - image: Docker image reference
        - mcp_mode: Model Context Protocol mode
        - mcp_host: MCP server hostname
        - mcp_port: MCP server port
        - has_mcp_service: Whether agent has dedicated MCP service
        - env_file: Environment file references
        - volumes: Volume mounts
    """
    # Base defaults for all agents
    defaults = {
        'image': f'ghcr.io/cnoe-io/agent-{agent_name}:${{IMAGE_TAG:-stable}}',
        'mcp_mode': 'http',
        'mcp_host': f'mcp-{agent_name}',
        'mcp_port': 8000,
        'has_mcp_service': True,
        'env_file': ['.env'],
        'volumes': []
    }

    # Agent-specific overrides
    agent_overrides = {
        'github': {
            'volumes': ['/var/run/docker.sock:/var/run/docker.sock'],
            'has_mcp_service': False,
            'mcp_mode': 'http'
        },
        'weather': {
            'mcp_mode': 'http',
            'mcp_host': 'weather.outshift.io',
            'mcp_port': 443,
            'has_mcp_service': False
        },
        'petstore': {
            'image': 'ghcr.io/cnoe-io/agent-template:${IMAGE_TAG:-stable}',
            'mcp_host': 'petstore.outshift.io',
            'mcp_port': 443,
            'has_mcp_service': False
        },
        'rag': {
            'has_mcp_service': False,
            'mcp_mode': 'http',
            'image': 'ghcr.io/cnoe-io/caipe-rag-agent-rag:${IMAGE_TAG:-stable}'
        }
    }

    # Apply agent-specific overrides if they exist
    if agent_name in agent_overrides:
        defaults.update(agent_overrides[agent_name])

    return defaults


# ============================================================================
# CAIPE Platform Service Generation
# ============================================================================

def generate_platform_engineer_service(
    profile_name: str,
    agents: List[str],
    transport: str,
    use_profiles: bool = True,
    dev_mode: bool = False,
    env_file_path: str = DEFAULT_ENV_FILE
) -> Dict[str, Any]:
    """
    Generate CAIPE platform engineer orchestrator service configuration.
    
    The platform engineer is the main orchestrator that coordinates
    communication between multiple AI agents.
    
    Args:
        profile_name: Name of the profile (e.g., 'argocd-p2p')
        agents: List of agent names to enable
        transport: Transport mode ('p2p' or 'slim')
        use_profiles: Whether to add Docker Compose profile
        dev_mode: Enable development mode with local code mounts
        env_file_path: Path to environment file
        
    Returns:
        Docker Compose service definition dictionary
    """
    # Configure volume mounts
    volumes = [
        '../prompt_config.yaml:/app/prompt_config.yaml',
        '../persona.yaml:/app/persona.yaml'
    ]

    # Add local code mounts for live development
    if dev_mode:
        volumes.append('../ai_platform_engineering:/app/ai_platform_engineering')

    # Base service configuration
    service = {
        'image': 'ghcr.io/cnoe-io/ai-platform-engineering:${IMAGE_TAG:-stable}',
        'container_name': f'caipe-{profile_name}',
        'volumes': volumes,
        'env_file': [env_file_path],
        'ports': ['8000:8000'],
        'environment': [f'A2A_TRANSPORT={transport}'],
        'depends_on': [],
        'command': 'platform-engineer'
    }

    # Use local build in dev mode instead of pulling image
    if dev_mode:
        service['build'] = {
            'context': '..',
            'dockerfile': 'build/Dockerfile'
        }
        del service['image']

    # Add Docker Compose profile if needed
    if use_profiles:
        service['profiles'] = [profile_name]

    # Configure agent host environment variables and dependencies
    for agent_name in agents:
        agent_host = f"agent-{agent_name}-{profile_name}"
        service['environment'].append(
            f"{agent_name.upper()}_AGENT_HOST={agent_host}"
        )
        service['depends_on'].append(agent_host)

    # Add ENABLE flags for all agents (enables/disables agents in orchestrator)
    for agent_name in ALL_AGENTS:
        is_enabled = 'true' if agent_name in agents else 'false'
        env_var_name = agent_name.upper().replace('-', '_')
        
        # Special cases with different environment variable names
        env_var_mapping = {
            'petstore': 'ENABLE_PETSTORE_AGENT',
            'weather': 'ENABLE_WEATHER_AGENT',
            'webex': 'ENABLE_WEBEX_AGENT',
            'rag': 'ENABLE_RAG'
        }
        
        env_var = env_var_mapping.get(agent_name, f'ENABLE_{env_var_name}')
        service['environment'].append(f'{env_var}={is_enabled}')

    # Add transport-specific infrastructure dependencies
    if transport == 'slim':
        service['depends_on'].extend(['slim-dataplane', 'slim-control-plane'])

    return service


# ============================================================================
# Agent Service Generation
# ============================================================================

def generate_agent_service(
    agent_name: str,
    profile_name: str,
    transport: str,
    port_offset: int,
    use_profiles: bool = True,
    dev_mode: bool = False,
    env_file_path: str = DEFAULT_ENV_FILE,
    enable_graph_rag: bool = True
) -> Dict[str, Any]:
    """
    Generate individual AI agent service configuration.
    
    Args:
        agent_name: Name of the agent (e.g., 'argocd')
        profile_name: Full profile name (e.g., 'argocd-p2p')
        transport: Transport mode ('p2p' or 'slim')
        port_offset: Port offset from base port 8001
        use_profiles: Whether to add Docker Compose profile
        dev_mode: Enable development mode with local code mounts
        env_file_path: Path to environment file
        enable_graph_rag: Whether to enable graph RAG for RAG agent
        
    Returns:
        Docker Compose service definition dictionary
    """
    defaults = get_agent_defaults(agent_name)
    volumes = defaults['volumes'].copy() if defaults['volumes'] else []

    # Add local code mount for development
    if dev_mode:
        volumes.append(
            f'../ai_platform_engineering/agents/{agent_name}:/app/ai_platform_engineering/agents/{agent_name}'
        )

    # Special handling for RAG agent with different configuration
    if agent_name == 'rag':
        graph_rag_value = 'true' if enable_graph_rag else 'false'
        service = {
            'image': defaults['image'],
            'container_name': f"agent_{agent_name}",  # RAG uses underscore
            'env_file': [env_file_path],
            'ports': ['8099:8099'],  # RAG uses dedicated port
            'environment': [
                'LOG_LEVEL=DEBUG',
                'REDIS_URL=redis://rag-redis:6379/0',
                'NEO4J_ADDR=neo4j://neo4j:7687',
                'NEO4J_ONTOLOGY_ADDR=neo4j://neo4j-ontology:7688',
                'NEO4J_USERNAME=neo4j',
                'NEO4J_PASSWORD=dummy_password',
                'RAG_SERVER_URL=http://rag_server:9446',
                f'ENABLE_GRAPH_RAG={graph_rag_value}'
            ],
            'depends_on': ['rag_server', 'rag-redis'],
            'restart': 'unless-stopped'
        }
    else:
        # Standard agent configuration
        service = {
            'image': defaults['image'],
            'container_name': f"agent-{agent_name}-{profile_name}",
            'env_file': [env_file_path],
            'ports': [f"{8001 + port_offset}:8000"],
            'environment': [
                f'A2A_TRANSPORT={transport}',
                f'MCP_MODE={defaults["mcp_mode"]}',
                f'MCP_HOST={defaults["mcp_host"]}',
                f'MCP_PORT={defaults["mcp_port"]}'
            ],
            'depends_on': []
        }

    # Add volumes if any are configured
    if volumes:
        service['volumes'] = volumes

    # Use local build in dev mode
    if dev_mode and agent_name != 'rag':
        service['build'] = {
            'context': '..',
            'dockerfile': f'ai_platform_engineering/agents/{agent_name}/build/Dockerfile'
        }
        del service['image']

    # Add MCP service dependency if agent has one
    if defaults['has_mcp_service'] and agent_name != 'rag':
        service['depends_on'].append(defaults['mcp_host'])

    # Add transport-specific dependencies
    if transport == 'slim' and agent_name != 'rag':
        service['depends_on'].append('slim-dataplane')

    # Add Docker Compose profile
    if use_profiles and agent_name != 'rag':
        service['profiles'] = [profile_name]

    return service


# ============================================================================
# MCP Service Generation
# ============================================================================

def generate_mcp_service(
    agent_name: str,
    profiles: List[str],
    use_profiles: bool = True,
    dev_mode: bool = False,
    env_file_path: str = DEFAULT_ENV_FILE
) -> Optional[Dict[str, Any]]:
    """
    Generate Model Context Protocol (MCP) server service.
    
    MCP servers provide the actual capabilities (tools) that agents use.
    Not all agents have dedicated MCP services (some use remote MCPs).
    
    Args:
        agent_name: Name of the agent
        profiles: List of Docker Compose profiles
        use_profiles: Whether to add profiles
        dev_mode: Enable development mode
        env_file_path: Path to environment file
        
    Returns:
        Docker Compose service definition or None if agent has no MCP service
    """
    defaults = get_agent_defaults(agent_name)

    # Skip if agent doesn't have a dedicated MCP service
    if not defaults['has_mcp_service']:
        return None

    # Calculate stable port offset based on agent name
    port_offset = sum(ord(c) for c in agent_name) % 100

    service = {
        'image': f'ghcr.io/cnoe-io/mcp-{agent_name}:${{IMAGE_TAG:-stable}}',
        'container_name': f'mcp-{agent_name}',
        'env_file': [env_file_path],
        'ports': [f"{18000 + port_offset}:8000"],
        'environment': [
            'MCP_MODE=http',
            'MCP_HOST=0.0.0.0',
            'MCP_PORT=8000'
        ]
    }

    # Add local code mounts and build context in dev mode
    if dev_mode:
        service['volumes'] = [
            f'../ai_platform_engineering/agents/{agent_name}/mcp:/app/mcp'
        ]
        service['build'] = {
            'context': '..',
            'dockerfile': f'ai_platform_engineering/agents/{agent_name}/mcp/build/Dockerfile'
        }
        del service['image']

    # Add Docker Compose profiles
    if use_profiles:
        service['profiles'] = profiles

    return service


# ============================================================================
# RAG Infrastructure Services
# ============================================================================

def generate_rag_services(enable_graph_rag: bool = True) -> Dict[str, Dict[str, Any]]:
    """
    Generate RAG (Retrieval-Augmented Generation) infrastructure services.
    
    RAG services include:
    - rag_server: Main RAG orchestration server
    - agent_ontology: Ontology management agent
    - rag_webui: Web UI for RAG visualization
    - neo4j: Graph database for knowledge graph
    - neo4j-ontology: Separate graph DB for ontology
    - rag-redis: Redis for caching
    - milvus-standalone: Vector database
    - etcd: Configuration store for Milvus
    - milvus-minio: Object storage for Milvus
    
    Args:
        enable_graph_rag: Whether to enable graph RAG (neo4j services)
    
    Returns:
        Dictionary of service name to service configuration
    """
    # Set ENABLE_GRAPH_RAG based on parameter
    graph_rag_value = 'true' if enable_graph_rag else 'false'
    
    return {
        'rag_server': {
            'image': 'ghcr.io/cnoe-io/caipe-rag-server:${IMAGE_TAG:-stable}',
            'container_name': 'rag_server',
            'ports': ['9446:9446'],
            'environment': [
                'LOG_LEVEL=DEBUG',
                'REDIS_URL=redis://rag-redis:6379/0',
                'NEO4J_ADDR=neo4j://neo4j:7687',
                'NEO4J_ONTOLOGY_ADDR=neo4j://neo4j-ontology:7688',
                'NEO4J_USERNAME=neo4j',
                'NEO4J_PASSWORD=dummy_password',
                'MILVUS_URI=http://milvus-standalone:19530',
                'ONTOLOGY_AGENT_RESTAPI_ADDR=http://agent_ontology:8098',
                f'ENABLE_GRAPH_RAG={graph_rag_value}',
                'CLEANUP_INTERVAL=86400'
            ],
            'restart': 'unless-stopped',
            'env_file': ['../.env'],
            'depends_on': ['rag-redis']
        },
        'agent_ontology': {
            'image': 'ghcr.io/cnoe-io/caipe-rag-agent-ontology:${IMAGE_TAG:-stable}',
            'container_name': 'agent_ontology',
            'ports': ['8098:8098'],
            'environment': [
                'LOG_LEVEL=DEBUG',
                'REDIS_URL=redis://rag-redis:6379/0',
                'NEO4J_ADDR=neo4j://neo4j:7687',
                'NEO4J_ONTOLOGY_ADDR=neo4j://neo4j-ontology:7688',
                'NEO4J_USERNAME=neo4j',
                'NEO4J_PASSWORD=dummy_password',
                'SYNC_INTERVAL=86400'
            ],
            'env_file': ['../.env'],
            'restart': 'unless-stopped',
            'depends_on': ['rag_server', 'neo4j', 'neo4j-ontology', 'rag-redis']
        },
        'rag_webui': {
            'build': {
                'context': '../ai_platform_engineering/knowledge_bases/rag',
                'dockerfile': './build/Dockerfile.webui'
            },
            'container_name': 'rag-webui',
            'depends_on': ['rag_server'],
            'ports': ['9447:80']
        },
        'neo4j': {
            'image': 'neo4j:latest',
            'container_name': 'neo4j',
            'volumes': [
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j/logs:/logs',
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j/config:/config',
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j/data:/data',
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j/plugins:/plugins'
            ],
            'ports': ['7474:7474', '7687:7687'],
            'restart': 'unless-stopped',
            'environment': {
                'NEO4J_AUTH': 'neo4j/dummy_password',
                'NEO4J_PLUGINS': '["apoc"]',
                'NEO4J_apoc_export_file_enabled': 'true',
                'NEO4J_apoc_import_file_enabled': 'true',
                'NEO4J_apoc_import_file_use__neo4j__config': 'true'
            }
        },
        'neo4j-ontology': {
            'image': 'neo4j:latest',
            'container_name': 'neo4j-ontology',
            'volumes': [
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j-ontology/logs:/logs',
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j-ontology/config:/config',
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j-ontology/data:/data',
                '${DOCKER_VOLUME_DIRECTORY:-.}/volumes/neo4j-ontology/plugins:/plugins'
            ],
            'ports': ['7688:7687'],
            'restart': 'unless-stopped',
            'environment': {
                'NEO4J_AUTH': 'neo4j/dummy_password',
                'NEO4J_PLUGINS': '["apoc"]',
                'NEO4J_apoc_export_file_enabled': 'true',
                'NEO4J_apoc_import_file_enabled': 'true',
                'NEO4J_apoc_import_file_use__neo4j__config': 'true'
            }
        },
        'rag-redis': {
            'image': 'redis',
            'container_name': 'rag-redis',
            'command': ['/bin/sh', '-c', 'redis-server'],
            'ports': [':6379'],
            'restart': 'unless-stopped'
        },
        'milvus-standalone': {
            'container_name': 'milvus-standalone',
            'image': 'milvusdb/milvus:v2.6.0',
            'command': ['milvus', 'run', 'standalone'],
            'security_opt': ['seccomp:unconfined'],
            'environment': {
                'MINIO_REGION': 'us-east-1',
                'ETCD_ENDPOINTS': 'etcd:2379',
                'MINIO_ADDRESS': 'milvus-minio:9000',
                'LOG_LEVEL': 'error'
            },
            'volumes': ['${DOCKER_VOLUME_DIRECTORY:-.}/volumes/milvus:/var/lib/milvus'],
            'healthcheck': {
                'test': ['CMD', 'curl', '-f', 'http://localhost:9091/healthz'],
                'interval': '30s',
                'start_period': '90s',
                'timeout': '20s',
                'retries': 3
            },
            'ports': [':19530', ':9091'],
            'depends_on': ['etcd', 'milvus-minio']
        },
        'etcd': {
            'container_name': 'milvus-etcd',
            'image': 'quay.io/coreos/etcd:v3.5.18',
            'environment': {
                'ETCD_AUTO_COMPACTION_MODE': 'revision',
                'ETCD_AUTO_COMPACTION_RETENTION': '1000',
                'ETCD_QUOTA_BACKEND_BYTES': '4294967296',
                'ETCD_SNAPSHOT_COUNT': '50000'
            },
            'volumes': ['${DOCKER_VOLUME_DIRECTORY:-.}/volumes/etcd:/etcd'],
            'command': 'etcd -advertise-client-urls=http://etcd:2379 -listen-client-urls http://0.0.0.0:2379 --data-dir /etcd',
            'healthcheck': {
                'test': ['CMD', 'etcdctl', 'endpoint', 'health'],
                'interval': '30s',
                'timeout': '20s',
                'retries': 3
            }
        },
        'milvus-minio': {
            'container_name': 'milvus-minio',
            'image': 'minio/minio:RELEASE.2024-05-28T17-19-04Z',
            'environment': {
                'MINIO_ACCESS_KEY': 'minioadmin',
                'MINIO_SECRET_KEY': 'minioadmin'
            },
            'ports': [':9001', ':9000'],
            'volumes': ['${DOCKER_VOLUME_DIRECTORY:-.}/volumes/minio:/minio_data'],
            'command': 'minio server /minio_data --console-address ":9001"',
            'healthcheck': {
                'test': ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live'],
                'interval': '30s',
                'timeout': '20s',
                'retries': 3
            }
        }
    }


# ============================================================================
# Tracing Infrastructure Services
# ============================================================================

def generate_tracing_services() -> Dict[str, Dict[str, Any]]:
    """
    Generate Langfuse tracing infrastructure services.
    
    Langfuse provides distributed tracing for LLM applications, allowing
    monitoring of agent interactions, LLM calls, and performance metrics.
    
    Services included:
    - langfuse-worker: Background processing worker
    - langfuse-web: Web UI and API server
    - langfuse-clickhouse: Analytics database
    - langfuse-minio: Object storage for events
    - langfuse-redis: Cache and queue
    - langfuse-postgres: Metadata database
    
    Returns:
        Dictionary of service name to service configuration
    """
    return {
        'langfuse-worker': {
            'image': 'langfuse/langfuse-worker:3',
            'container_name': 'langfuse-worker',
            'restart': 'always',
            'depends_on': {
                'langfuse-postgres': {'condition': 'service_healthy'},
                'langfuse-minio': {'condition': 'service_healthy'},
                'langfuse-redis': {'condition': 'service_healthy'},
                'langfuse-clickhouse': {'condition': 'service_healthy'}
            },
            'ports': ['127.0.0.1:3030:3030'],
            'environment': [
                'DATABASE_URL=postgresql://postgres:postgres@langfuse-postgres:5432/postgres',
                'SALT=mysalt',
                'ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000',
                'CLICKHOUSE_MIGRATION_URL=clickhouse://langfuse-clickhouse:9000',
                'CLICKHOUSE_URL=http://langfuse-clickhouse:8123',
                'CLICKHOUSE_USER=clickhouse',
                'CLICKHOUSE_PASSWORD=clickhouse',
                'CLICKHOUSE_CLUSTER_ENABLED=false',
                'LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse',
                'LANGFUSE_S3_EVENT_UPLOAD_REGION=us-east-1',
                'LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minio',
                'LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=miniosecret',
                'LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://langfuse-minio:9000',
                'LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=true',
                'LANGFUSE_S3_EVENT_UPLOAD_PREFIX=events/',
                'LANGFUSE_S3_MEDIA_UPLOAD_BUCKET=langfuse',
                'LANGFUSE_S3_MEDIA_UPLOAD_REGION=us-east-1',
                'LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=minio',
                'LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=miniosecret',
                'LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=http://langfuse-minio:9000',
                'LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE=true',
                'LANGFUSE_S3_MEDIA_UPLOAD_PREFIX=media/',
                'REDIS_HOST=langfuse-redis',
                'REDIS_AUTH=myredissecret'
            ]
        },
        'langfuse-web': {
            'image': 'langfuse/langfuse:3',
            'container_name': 'langfuse-web',
            'restart': 'always',
            'depends_on': {
                'langfuse-postgres': {'condition': 'service_healthy'},
                'langfuse-minio': {'condition': 'service_healthy'},
                'langfuse-redis': {'condition': 'service_healthy'},
                'langfuse-clickhouse': {'condition': 'service_healthy'}
            },
            'ports': ['3000:3000'],
            'environment': [
                'DATABASE_URL=postgresql://postgres:postgres@langfuse-postgres:5432/postgres',
                'SALT=mysalt',
                'ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000',
                'CLICKHOUSE_MIGRATION_URL=clickhouse://langfuse-clickhouse:9000',
                'CLICKHOUSE_URL=http://langfuse-clickhouse:8123',
                'CLICKHOUSE_USER=clickhouse',
                'HOSTNAME=0.0.0.0',
                'CLICKHOUSE_PASSWORD=clickhouse',
                'CLICKHOUSE_CLUSTER_ENABLED=false',
                'LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse',
                'LANGFUSE_S3_EVENT_UPLOAD_REGION=us-east-1',
                'LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minio',
                'LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=miniosecret',
                'LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://langfuse-minio:9000',
                'LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=true',
                'LANGFUSE_S3_EVENT_UPLOAD_PREFIX=events/',
                'LANGFUSE_S3_MEDIA_UPLOAD_BUCKET=langfuse',
                'LANGFUSE_S3_MEDIA_UPLOAD_REGION=us-east-1',
                'LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=minio',
                'LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=miniosecret',
                'LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=http://langfuse-minio:9000',
                'LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE=true',
                'LANGFUSE_S3_MEDIA_UPLOAD_PREFIX=media/',
                'REDIS_HOST=langfuse-redis',
                'REDIS_AUTH=myredissecret',
                'NEXTAUTH_URL=http://localhost:3000',
                'NEXTAUTH_SECRET=mysecret'
            ]
        },
        'langfuse-clickhouse': {
            'image': 'clickhouse/clickhouse-server',
            'container_name': 'langfuse-clickhouse',
            'restart': 'always',
            'user': '101:101',
            'environment': {
                'CLICKHOUSE_DB': 'default',
                'CLICKHOUSE_USER': 'clickhouse',
                'CLICKHOUSE_PASSWORD': 'clickhouse'
            },
            'volumes': [
                'langfuse_clickhouse_data:/var/lib/clickhouse',
                'langfuse_clickhouse_logs:/var/log/clickhouse-server'
            ],
            'ports': ['127.0.0.1:8123:8123', '127.0.0.1:9000:9000'],
            'healthcheck': {
                'test': 'wget --no-verbose --tries=1 --spider http://localhost:8123/ping || exit 1',
                'interval': '5s',
                'timeout': '5s',
                'retries': 10,
                'start_period': '1s'
            }
        },
        'langfuse-minio': {
            'image': 'minio/minio',
            'container_name': 'langfuse-minio',
            'restart': 'always',
            'entrypoint': 'sh',
            'command': '-c \'mkdir -p /data/langfuse && minio server --address ":9000" --console-address ":9001" /data\'',
            'environment': {
                'MINIO_ROOT_USER': 'minio',
                'MINIO_ROOT_PASSWORD': 'miniosecret'
            },
            'ports': ['9090:9000', '127.0.0.1:9091:9001'],
            'volumes': ['langfuse_minio_data:/data'],
            'healthcheck': {
                'test': ['CMD', 'mc', 'ready', 'local'],
                'interval': '1s',
                'timeout': '5s',
                'retries': 5,
                'start_period': '1s'
            }
        },
        'langfuse-redis': {
            'image': 'redis:7',
            'container_name': 'langfuse-redis',
            'restart': 'always',
            'command': '--requirepass ${REDIS_AUTH:-myredissecret}',
            'ports': ['127.0.0.1:6379:6379'],
            'healthcheck': {
                'test': ['CMD', 'redis-cli', 'ping'],
                'interval': '3s',
                'timeout': '10s',
                'retries': 10
            }
        },
        'langfuse-postgres': {
            'image': 'postgres:15',
            'container_name': 'langfuse-postgres',
            'restart': 'always',
            'healthcheck': {
                'test': ['CMD-SHELL', 'pg_isready -U postgres'],
                'interval': '3s',
                'timeout': '3s',
                'retries': 10
            },
            'environment': {
                'POSTGRES_USER': 'postgres',
                'POSTGRES_PASSWORD': 'postgres',
                'POSTGRES_DB': 'postgres'
            },
            'ports': ['127.0.0.1:5432:5432'],
            'volumes': ['langfuse_postgres_data:/var/lib/postgresql/data']
        }
    }


# ============================================================================
# SLIM Infrastructure Services
# ============================================================================

def generate_infrastructure_services() -> Dict[str, Dict[str, Any]]:
    """
    Generate SLIM dataplane infrastructure services.
    
    SLIM (Service Level Integration Mesh) provides advanced message routing,
    load balancing, and service mesh capabilities for agent communication.
    
    Services:
    - slim-dataplane: Handles message routing and data plane operations
    - slim-control-plane: Manages control plane configuration
    
    Returns:
        Dictionary of service name to service configuration
    """
    return {
        'slim-dataplane': {
            'image': 'ghcr.io/agntcy/slim:0.3.15',
            'container_name': 'slim-dataplane',
            'profiles': ['a2a-over-slim'],
            'ports': ['46357:46357'],
            'environment': [
                'PASSWORD=${SLIM_GATEWAY_PASSWORD:-dummy_password}',
                'CONFIG_PATH=/config.yaml'
            ],
            'volumes': ['../slim-config.yaml:/config.yaml'],
            'command': ['/slim', '--config', '/config.yaml']
        },
        'slim-control-plane': {
            'image': 'ghcr.io/agntcy/slim/control-plane:0.0.1',
            'container_name': 'slim-control-plane',
            'profiles': ['a2a-over-slim'],
            'ports': ['50051:50051', '50052:50052'],
            'environment': [
                'PASSWORD=${SLIM_GATEWAY_PASSWORD:-dummy_password}',
                'CONFIG_PATH=/config.yaml'
            ],
            'volumes': ['../slim-config.yaml:/config.yaml'],
            'command': ['/slim', '--config', '/config.yaml']
        }
    }


# ============================================================================
# Main Docker Compose Generation
# ============================================================================

def generate_docker_compose(
    profiles_config: Dict[str, Any],
    selected_profiles: Optional[List[str]] = None,
    dev_mode: bool = False
) -> Dict[str, Any]:
    """
    Generate complete docker-compose configuration with both P2P and SLIM profiles.
    
    This is the main orchestration function that combines all service
    generation functions to create a complete docker-compose.yaml structure.
    
    Args:
        profiles_config: Loaded persona configuration
        selected_profiles: List of persona names to generate (None = all)
        dev_mode: Enable development mode with local code mounts
        
    Returns:
        Complete docker-compose.yaml structure as dictionary
    """
    compose = {'services': {}}

    # Determine which personas to process
    profiles_to_process = selected_profiles or profiles_config['persona'].keys()
    mcp_services_added = set()  # Track MCP services to avoid duplicates

    # Generate services for each persona
    for profile_name in profiles_to_process:
        if profile_name not in profiles_config['persona']:
            print(f"Warning: Profile '{profile_name}' not found in configuration")
            continue

        profile_config = profiles_config['persona'][profile_name]
        agents = profile_config['agents']
        enable_graph_rag = profile_config.get('enable_graph_rag', True)

        # Generate for both P2P and SLIM transports
        for transport in ['p2p', 'slim']:
            service_suffix = f'{profile_name}-{transport}'
            profile = TRANSPORT_PROFILES[transport]

            # Generate CAIPE orchestrator service
            platform_service = generate_platform_engineer_service(
                service_suffix, agents, transport, True, dev_mode
            )
            platform_service['profiles'] = [profile]
            compose['services'][f'caipe-{service_suffix}'] = platform_service

            # Generate agent services
            for i, agent_name in enumerate(agents):
                agent_service = generate_agent_service(
                    agent_name, service_suffix, transport, i, True, dev_mode, 
                    DEFAULT_ENV_FILE, enable_graph_rag
                )
                agent_service['profiles'] = [profile]
                compose['services'][f'agent-{agent_name}-{service_suffix}'] = agent_service

                # Generate MCP service if needed (shared across transports)
                mcp_service_name = f"mcp-{agent_name}"
                if mcp_service_name not in mcp_services_added:
                    mcp_service = generate_mcp_service(
                        agent_name, [profile], True, dev_mode
                    )
                    if mcp_service:
                        mcp_service['profiles'] = [profile]
                        compose['services'][mcp_service_name] = mcp_service
                        mcp_services_added.add(mcp_service_name)
                else:
                    # Add profile to existing MCP service
                    if mcp_service_name in compose['services']:
                        if profile not in compose['services'][mcp_service_name].get('profiles', []):
                            compose['services'][mcp_service_name]['profiles'].append(profile)

    # Always add SLIM infrastructure services
    compose['services'].update(generate_infrastructure_services())

    # Add RAG services if any persona includes RAG agent
    has_rag = any(
        'rag' in profiles_config['persona'][p]['agents']
        for p in profiles_to_process
        if p in profiles_config['persona']
    )
    if has_rag:
        # Determine enable_graph_rag setting from personas with RAG agent
        # If any persona with RAG wants graph_rag enabled, enable it
        enable_graph_rag_for_services = any(
            profiles_config['persona'][p].get('enable_graph_rag', True)
            for p in profiles_to_process
            if p in profiles_config['persona'] and 'rag' in profiles_config['persona'][p]['agents']
        )
        compose['services'].update(generate_rag_services(enable_graph_rag_for_services))
        if 'volumes' not in compose:
            compose['volumes'] = {}
        compose['volumes'].update({
            'milvus_etcd': {'driver': 'local'},
            'milvus_minio': {'driver': 'local'},
            'milvus_data': {'driver': 'local'}
        })

    # Add tracing services if any persona has "tracing" in name
    has_tracing = any('tracing' in p for p in profiles_to_process)
    if has_tracing:
        compose['services'].update(generate_tracing_services())
        if 'volumes' not in compose:
            compose['volumes'] = {}
        compose['volumes'].update({
            'langfuse_postgres_data': {'driver': 'local'},
            'langfuse_clickhouse_data': {'driver': 'local'},
            'langfuse_clickhouse_logs': {'driver': 'local'},
            'langfuse_minio_data': {'driver': 'local'}
        })

    return compose


# ============================================================================
# Banner Generation
# ============================================================================

def generate_banner(personas: List[str], dev_mode: bool) -> str:
    """
    Generate informational banner for docker-compose file.
    
    Args:
        personas: List of persona names included
        dev_mode: Whether dev mode is enabled
        
    Returns:
        Multi-line comment string with generation info and usage instructions
    """
    mode = "DEV (with local code mounts)" if dev_mode else "PROD (with container images)"
    personas_str = ' '.join(personas)
    dev_flag = ' DEV=true' if dev_mode else ''
    dev_arg = ' --dev' if dev_mode else ''

    return f"""# ============================================================================
# AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
# ============================================================================
# Generated by: scripts/generate-docker-compose.py
# Mode: {mode}
# Personas: {', '.join(personas)}
# Transports: a2a-p2p, a2a-over-slim
#
# To regenerate this file, run:
#   make generate-compose PERSONAS="{personas_str}"{dev_flag}
#
# Or manually:
#   ./scripts/generate-docker-compose.py --persona {personas_str}{dev_arg}
#
# Usage:
#   docker compose --profile a2a-p2p up         # For P2P transport
#   docker compose --profile a2a-over-slim up   # For SLIM transport
# ============================================================================

"""


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """
    Main entry point for the docker-compose generator.
    
    Parses command-line arguments, loads configuration, generates
    docker-compose content, and writes output file.
    """
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description='Generate docker-compose.yaml from personas',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate for single persona
  %(prog)s --persona argocd --output docker-compose/docker-compose.argocd.yaml
  
  # Generate for multiple personas
  %(prog)s --persona github aws --output docker-compose/docker-compose.multi.yaml
  
  # Generate with dev mode
  %(prog)s --persona argocd --dev
  
  # Generate for all personas
  %(prog)s --output docker-compose/docker-compose.all.yaml
        """
    )
    parser.add_argument(
        '--persona',
        nargs='+',
        help='Personas to include (omit for all personas)'
    )
    parser.add_argument(
        '--config',
        default=DEFAULT_PERSONA_FILE,
        help=f'Profiles configuration file (default: {DEFAULT_PERSONA_FILE})'
    )
    parser.add_argument(
        '--output',
        default='docker-compose.generated.yaml',
        help='Output file path (default: docker-compose.generated.yaml)'
    )
    parser.add_argument(
        '--dev',
        action='store_true',
        help='Generate dev compose with local code mounts and build contexts'
    )

    args = parser.parse_args()

    # Create output directory if needed
    output_dir = Path(args.output).parent
    if output_dir != Path('.') and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    # Load persona configuration
    try:
        profiles_config = load_profiles(args.config)
    except FileNotFoundError:
        print(f"Error: Configuration file '{args.config}' not found")
        return 1
    except yaml.YAMLError as e:
        print(f"Error: Invalid YAML in '{args.config}': {e}")
        return 1

    # Generate docker-compose structure
    compose = generate_docker_compose(profiles_config, args.persona, args.dev)

    # Determine personas for banner
    personas = args.persona or list(profiles_config['persona'].keys())
    banner = generate_banner(personas, args.dev)

    # Write output file
    try:
        with open(args.output, 'w') as f:
            f.write(banner)
            yaml.dump(compose, f, default_flow_style=False, sort_keys=False)
    except IOError as e:
        print(f"Error writing output file '{args.output}': {e}")
        return 1

    # Print summary
    mode = "DEV (with local code mounts)" if args.dev else "PROD (with container images)"
    print(f"Generated {args.output}")
    print(f"Mode: {mode}")
    if args.persona:
        print(f"Included personas: {', '.join(args.persona)}")
    else:
        print("Included all personas")
    print(f"Transports: a2a-p2p, a2a-over-slim (both profiles generated)")

    return 0


if __name__ == '__main__':
    exit(main())
