#!/usr/bin/env python3
"""
Dynamic Docker Compose Generator
Generates docker-compose.yaml based on persona.yaml and agent configurations
"""

import yaml
import argparse
import os
from pathlib import Path

def load_profiles(profiles_file="persona.yaml"):
    """Load user-defined profiles configuration"""
    with open(profiles_file, 'r') as f:
        return yaml.safe_load(f)

def load_agent_config(agent_name, agents_dir="ai_platform_engineering/agents/workers"):
    """Load agent specification and configuration"""
    agent_dir = Path(agents_dir) / agent_name
    
    # Load agent specification
    agent_spec_file = agent_dir / "agent.yaml"
    config_file = agent_dir / "config.yaml"
    
    agent_spec = None
    agent_config = None
    
    if agent_spec_file.exists():
        with open(agent_spec_file, 'r') as f:
            agent_spec = yaml.safe_load(f)
    
    if config_file.exists():
        with open(config_file, 'r') as f:
            agent_config = yaml.safe_load(f)
    
    return agent_spec, agent_config

def get_transport_from_env():
    """Get A2A transport from environment or default to p2p"""
    return os.getenv('A2A_TRANSPORT', 'p2p')

def generate_platform_engineer_service(profile_name, agents, transport, use_profiles=True):
    """Generate platform engineer service configuration"""
    service = {
        'image': 'ghcr.io/cnoe-io/ai-platform-engineering:${IMAGE_TAG:-stable}',
        'container_name': f'platform-engineer-{profile_name}',
        'volumes': [
            '.env:/app/.env',
            './prompt_config.yaml:/app/prompt_config.yaml',
            './persona.yaml:/app/persona.yaml'
        ],
        'env_file': ['.env'],
        'ports': ['8000:8000'],
        'environment': [
            f'A2A_TRANSPORT={transport}'
        ],
        'depends_on': [],
        'command': 'platform-engineer'
    }
    
    if use_profiles:
        service['profiles'] = [profile_name]
    
    # Add agent host configurations and dependencies
    for agent_name in agents:
        service['environment'].append(
            f"{agent_name.upper()}_AGENT_HOST=agent-{agent_name}-{profile_name}"
        )
        service['depends_on'].append(f"agent-{agent_name}-{profile_name}")
    
    # Add transport-specific dependencies
    if transport == 'slim':
        service['depends_on'].extend(['slim-dataplane', 'slim-control-plane'])
    
    return service

def generate_agent_service(agent_name, agent_spec, agent_config, profile_name, transport, port_offset, use_profiles=True):
    """Generate individual agent service configuration"""
    mcp_deployment = agent_config.get('mcp_deployment') if agent_config else agent_spec['defaults']['mcp_deployment']
    
    service = {
        'image': f"{agent_spec['docker']['image_name']}:${{IMAGE_TAG:-stable}}",
        'container_name': f"agent-{agent_name}-{profile_name}",
        'volumes': agent_spec['docker']['required_volumes'].copy(),
        'ports': [f"{8001 + port_offset}:8000"],
        'environment': [
            f'A2A_TRANSPORT={transport}'
        ],
        'depends_on': []
    }
    
    # Add MCP configuration based on deployment mode
    if mcp_deployment in ['docker', 'remote']:
        mcp_config = agent_config.get('mcp_config') if agent_config else {}
        mcp_host = mcp_config.get('host', f'mcp-{agent_name}')
        mcp_port = mcp_config.get('port', 8000)
        
        service['environment'].extend([
            'MCP_MODE=http',
            f'MCP_HOST={mcp_host}',
            f'MCP_PORT={mcp_port}'
        ])
        
        # Only add dependency for docker mode, not remote
        if mcp_deployment == 'docker':
            service['depends_on'].append(mcp_host)
        
    elif mcp_deployment in ['stdio_local', 'stdio_package']:
        service['environment'].append('MCP_MODE=stdio')
        # For stdio modes, MCP server runs within the agent container
    
    # Add transport-specific dependencies
    if transport == 'slim':
        service['depends_on'].append('slim-dataplane')
    
    # Add environment variable overrides
    env_overrides = agent_config.get('env_overrides') if agent_config else {}
    if env_overrides:
        for key, value in env_overrides.items():
            service['environment'].append(f'{key}={value}')
    
    if use_profiles:
        service['profiles'] = [profile_name]
    
    return service

def generate_mcp_service(agent_name, agent_spec, agent_config, profiles, use_profiles=True):
    """Generate MCP service configuration"""
    mcp_deployment = agent_config.get('mcp_deployment') if agent_config else agent_spec['defaults']['mcp_deployment']
    
    if mcp_deployment != 'docker':
        return None  # No separate MCP service needed for stdio modes
    
    docker_config = agent_spec['mcp_deployment_options']['docker']
    mcp_config = agent_config.get('mcp_config') if agent_config else {}
    
    # Use custom image if specified in overrides
    overrides = (agent_config.get('overrides') if agent_config else {}) or {}
    image = overrides.get('mcp_image', docker_config['image'])
    port = overrides.get('mcp_port', docker_config['port'])
    
    service = {
        'image': f"{image}:${{IMAGE_TAG:-stable}}",
        'container_name': docker_config['container_name'],
        'env_file': ['.env'],
        'ports': [f"{18000 + hash(agent_name) % 100}:{port}"],
        'environment': docker_config['environment_vars'].copy()
    }
    
    if use_profiles:
        service['profiles'] = profiles
    
    return service

def generate_infrastructure_services():
    """Generate SLIM infrastructure services"""
    return {
        'slim-dataplane': {
            'image': 'ghcr.io/agntcy/slim:0.3.15',
            'container_name': 'slim-dataplane',
            'profiles': ['slim-infrastructure'],
            'ports': ['46357:46357'],
            'environment': [
                'PASSWORD=${SLIM_GATEWAY_PASSWORD:-dummy_password}',
                'CONFIG_PATH=/config.yaml'
            ],
            'volumes': ['./slim-config.yaml:/config.yaml'],
            'command': ['/slim', '--config', '/config.yaml']
        },
        'slim-control-plane': {
            'image': 'ghcr.io/agntcy/slim/control-plane:0.0.1',
            'container_name': 'slim-control-plane',
            'profiles': ['slim-infrastructure'],
            'ports': ['50051:50051', '50052:50052'],
            'environment': [
                'PASSWORD=${SLIM_GATEWAY_PASSWORD:-dummy_password}',
                'CONFIG_PATH=/config.yaml'
            ],
            'volumes': ['./slim-config.yaml:/config.yaml'],
            'command': ['/slim', '--config', '/config.yaml']
        }
    }

def generate_docker_compose(profiles_config, selected_profiles=None, agents_dir="ai_platform_engineering/agents/workers"):
    """Generate complete docker-compose configuration"""
    compose = {
        'services': {}
    }
    
    transport = get_transport_from_env()
    needs_slim_infrastructure = False
    
    # Process each profile
    profiles_to_process = selected_profiles or profiles_config['persona'].keys()
    mcp_services_added = set()  # Track which MCP services we've already added
    
    for profile_name in profiles_to_process:
        if profile_name not in profiles_config['persona']:
            print(f"Warning: Profile '{profile_name}' not found")
            continue
            
        profile_config = profiles_config['persona'][profile_name]
        agents = profile_config['agents']
        
        # Determine if we should use profiles (only for multi-profile generation)
        use_profiles = len(profiles_to_process) > 1
        
        # Generate platform engineer service
        platform_service = generate_platform_engineer_service(profile_name, agents, transport, use_profiles)
        if transport == 'slim':
            needs_slim_infrastructure = True
        compose['services'][f'platform-engineer-{profile_name}'] = platform_service
        
        # Generate agent and MCP services
        for i, agent_name in enumerate(agents):
            # Load agent configuration
            agent_spec, agent_config = load_agent_config(agent_name, agents_dir)
            
            if not agent_spec or not agent_config:
                print(f"Warning: Could not load configuration for agent '{agent_name}'")
                continue
            
            # Generate agent service
            agent_service = generate_agent_service(agent_name, agent_spec, agent_config, profile_name, transport, i, use_profiles)
            if transport == 'slim':
                needs_slim_infrastructure = True
            compose['services'][f'agent-{agent_name}-{profile_name}'] = agent_service
            
            # Generate MCP service if needed and not already added
            mcp_service_name = f"mcp-{agent_name}"
            if mcp_service_name not in mcp_services_added:
                mcp_service = generate_mcp_service(agent_name, agent_spec, agent_config, [profile_name], use_profiles)
                if mcp_service:
                    compose['services'][mcp_service_name] = mcp_service
                    mcp_services_added.add(mcp_service_name)
            else:
                # Add this profile to existing MCP service
                if mcp_service_name in compose['services'] and use_profiles:
                    compose['services'][mcp_service_name]['profiles'].append(profile_name)
    
    # Add infrastructure services only if needed
    if needs_slim_infrastructure:
        compose['services'].update(generate_infrastructure_services())
    
    return compose

def main():
    parser = argparse.ArgumentParser(description='Generate docker-compose.yaml from personas')
    parser.add_argument('--persona', nargs='+', help='Personas to include')
    parser.add_argument('--config', default='persona.yaml', help='Profiles configuration file')
    parser.add_argument('--agents-dir', default='ai_platform_engineering/agents', help='Agents directory')
    parser.add_argument('--output', default='docker-compose.generated.yaml', help='Output file')
    
    args = parser.parse_args()
    
    # Load profiles configuration
    profiles_config = load_profiles(args.config)
    
    # Generate docker-compose
    compose = generate_docker_compose(profiles_config, args.persona, args.agents_dir)
    
    # Write output
    with open(args.output, 'w') as f:
        yaml.dump(compose, f, default_flow_style=False, sort_keys=False)
    
    print(f"Generated {args.output}")
    if args.persona:
        print(f"Included personas: {', '.join(args.persona)}")
    else:
        print("Included all personas")
    
    transport = get_transport_from_env()
    print(f"Using A2A transport: {transport}")

if __name__ == '__main__':
    main()