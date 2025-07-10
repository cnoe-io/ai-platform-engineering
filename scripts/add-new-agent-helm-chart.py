#!/usr/bin/env python3
"""
Script to automatically update Helm configuration when a new agent is added.
This script will:
1. Add new dependency in Chart.yaml
2. Bump the chart version
3. Add new agent sections to values files with empty configurations
"""

import sys
import re
from pathlib import Path
from ruamel.yaml import YAML

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096  # Prevent line wrapping

def get_script_dir():
    """Get the directory where this script is located."""
    return Path(__file__).parent.absolute()

def get_project_root():
    """Get the project root directory."""
    return get_script_dir().parent

def get_agents_dir():
    """Get the agents directory path."""
    return get_project_root() / "ai_platform_engineering" / "agents"

def get_helm_dir():
    """Get the helm directory path."""
    return get_project_root() / "helm"

def get_existing_agents():
    """Get list of existing agents from the agents directory."""
    agents_dir = get_agents_dir()
    if not agents_dir.exists():
        print(f"Error: Agents directory not found at {agents_dir}")
        return []
    
    agents = []
    for item in agents_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('__'):
            agents.append(item.name)
    
    return sorted(agents)

def get_chart_dependencies():
    """Get current dependencies from Chart.yaml (deprecated - use get_configured_agents instead)."""
    return get_configured_agents()

def get_agent_chart_version():
    """Get the current version from the agent chart."""
    agent_chart_file = get_helm_dir() / "charts" / "agent" / "Chart.yaml"
    
    if not agent_chart_file.exists():
        print(f"Warning: Agent Chart.yaml not found at {agent_chart_file}, using default version 0.1.0")
        return "0.1.0"
    
    try:
        with open(agent_chart_file, 'r') as f:
            chart_data = yaml.load(f)
        
        version = chart_data.get('version', '0.1.0')
        print(f"📦 Using agent chart version: {version}")
        return version
    except Exception as e:
        print(f"Warning: Could not read agent chart version: {e}, using default 0.1.0")
        return "0.1.0"

def bump_chart_version(chart_file):
    """Bump the main chart version (patch bump for new agents)."""
    with open(chart_file, 'r') as f:
        content = f.read()
    
    # Find ONLY the main chart version line (first occurrence) - preserve spacing
    version_pattern = r'^(version:\s*)(\d+)\.(\d+)\.(\d+)'
    match_version = re.search(version_pattern, content, re.MULTILINE)
    
    if match_version:
        print(f"Current main chart version: {match_version.group(0)}")
        prefix = match_version.group(1)  # Captures "version: " with original spacing
        major, minor, patch = map(int, match_version.groups()[1:])  # Skip the prefix group
        
        print(f"Parsed version - major: {major}, minor: {minor}, patch: {patch}")
        
        # Bump patch version
        new_patch = patch + 1
        new_version = f"{major}.{minor}.{new_patch}"
        
        print(f"New version will be: {new_version}")
        print(f"Replacement string: '{prefix}{new_version}'")
        
        # Replace ONLY the first occurrence (main chart version) - preserve original spacing
        new_content = content.replace(match_version.group(0), f'{prefix}{new_version}', 1)
        # Debug: check if replacement actually happened
        if new_content == content:
            print("WARNING: Content didn't change! Regex replacement failed.")
            print(f"Pattern: {version_pattern}")
            print(f"Looking for: {match_version.group(0)}")
        else:
            print("✓ Content was successfully modified")
        
        with open(chart_file, 'w') as f:
            f.write(new_content)
        
        print(f"✓ Bumped main chart version to {new_version} (patch bump)")
        return new_version
    else:
        print("Warning: Could not find main version in Chart.yaml")
        return None

def add_chart_dependency(agent_name):
    """Add new dependency to Chart.yaml with proper formatting."""
    chart_file = get_helm_dir() / "Chart.yaml"
    
    with open(chart_file, 'r') as f:
        content = f.read()
    
    # Check if dependency already exists
    if f"alias: agent-{agent_name}" in content:
        print(f"✓ Dependency agent-{agent_name} already exists in Chart.yaml")
        return
    
    # Get current agent chart version
    agent_version = get_agent_chart_version()
    
    # Find the external-secrets comment line to insert before it
    external_secrets_pattern = r'(\s+# Separate chart for external secrets)'
    
    new_dependency = \
f"""
  - name: agent
    version: {agent_version}
    alias: agent-{agent_name}
    condition: agent-{agent_name}.enabled"""
    
    match = re.search(external_secrets_pattern, content)
    if match:
        # Insert before the comment line
        insert_pos = match.start()
        new_content = content[:insert_pos] + new_dependency + content[insert_pos:]
        
        with open(chart_file, 'w') as f:
            f.write(new_content)
        
        print(f"✓ Added dependency agent-{agent_name} to Chart.yaml")
    else:
        print("Warning: Could not find external-secrets comment in Chart.yaml")

def add_to_values_file(values_file, agent_name):
    """Add new agent section to values.yaml."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    # Check if agent already exists in the file
    if f"agent-{agent_name}:" in content:
        print(f"✓ agent-{agent_name} already exists in {values_file.name}")
        return

    # Add new agent section at the end
    agent_section = f'''
agent-{agent_name}:
  enabled: false
  nameOverride: "agent-{agent_name}"
  image:
    repository: "ghcr.io/cnoe-io/agent-{agent_name}"
'''
    
    with open(values_file, 'a') as f:
        f.write(agent_section)
    
    print(f"✓ Added agent-{agent_name} section to {values_file.name}")

def add_to_existing_secrets_file(values_file, agent_name):
    """Add new agent section to values-existing-secrets.yaml."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    # Check if agent already exists in the file
    if f"agent-{agent_name}:" in content:
        print(f"✓ agent-{agent_name} already exists in {values_file.name}")
        return

    # Add new agent section at the end
    agent_section = f'''
agent-{agent_name}:
  secrets:
    secretName: "" # Specify an existing Kubernetes secret name, or leave empty to auto-generate from values-secrets.yaml
'''
    
    with open(values_file, 'a') as f:
        f.write(agent_section)
    
    print(f"✓ Added agent-{agent_name} section to {values_file.name}")

def add_to_ingress_file(values_file, agent_name):
    """Add new agent section to values-ingress.yaml.example."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    # Check if agent already exists in the file
    if f"agent-{agent_name}:" in content:
        print(f"✓ agent-{agent_name} already exists in {values_file.name}")
        return

    # Add new agent section at the end
    agent_section = f'''
agent-{agent_name}:
  ingress:
    hosts:
      - host: agent-{agent_name}.local
        paths:
          - path: /
            pathType: Prefix
    tls: []
      # - secretName: agent-{agent_name}-tls
      #   hosts:
      #     - agent-{agent_name}.local
'''
    
    with open(values_file, 'a') as f:
        f.write(agent_section)
    
    print(f"✓ Added agent-{agent_name} section to {values_file.name}")

def add_to_external_secrets_file(values_file, agent_name):
    """Add new agent secret section to external secrets values file."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    # Check if agent secret already exists
    if f"- name: {agent_name}-secret" in content:
        print(f"✓ {agent_name}-secret already exists in {values_file.name}")
        return
    
    # Find the end of the externalSecrets list
    external_secrets_pattern = r'(\s+# Slack configuration[\s\S]*?property: SLACK_TEAM_ID)'
    
    match = re.search(external_secrets_pattern, content)
    if match:
        # Add new secret configuration after Slack
        new_secret_section = \
f'''
    # {agent_name.title()} configuration
    - name: {agent_name}-secret
      secretStoreRef:
        name: "" # Use your secret store
        kind: ClusterSecretStore # Use your secret store kind
      target:
        name: {agent_name}-secret
      data:
        # TODO: Add {agent_name} specific secrets here
        # Example:
        # - secretKey: {agent_name.upper()}_API_KEY
        #   remoteRef:
        #     conversionStrategy: Default
        #     decodingStrategy: None
        #     key: dev/{agent_name} # Use your key path
        #     property: {agent_name.upper()}_API_KEY
'''
        
        new_content = content + new_secret_section
        
        with open(values_file, 'w') as f:
            f.write(new_content)
        
        print(f"✓ Added {agent_name}-secret section to {values_file.name}")
    else:
        print(f"Warning: Could not find insertion point in {values_file.name}")

def get_configured_agents():
    """Get list of agents already configured in Chart.yaml."""
    chart_file = get_helm_dir() / "Chart.yaml"
    if not chart_file.exists():
        print(f"Error: Chart.yaml not found at {chart_file}")
        return []
    
    try:
        with open(chart_file, 'r') as f:
            chart_data = yaml.load(f)
        
        dependencies = chart_data.get('dependencies', [])
        configured_agents = []
        
        for dep in dependencies:
            alias = dep.get('alias', '')
            if alias.startswith('agent-'):
                # Extract agent name from alias (e.g., 'agent-slack' -> 'slack')
                agent_name = alias[6:]  # Remove 'agent-' prefix
                configured_agents.append(agent_name)
        
        return sorted(configured_agents)
    except Exception as e:
        print(f"Error reading Chart.yaml: {e}")
        return []

def main():
    """Main function to automatically detect and process new agents."""
    print("🔍 Scanning for new agents...")
    print("=" * 50)
    
    helm_dir = get_helm_dir()
    if not helm_dir.exists():
        print(f"Error: Helm directory not found at {helm_dir}")
        sys.exit(1)
    
    # Get agents from filesystem and from Chart.yaml
    filesystem_agents = get_existing_agents()
    configured_agents = get_configured_agents()
    
    print(f"📁 Agents in filesystem: {filesystem_agents}")
    print(f"📋 Agents in Chart.yaml: {configured_agents}")
    
    # Find new agents that aren't configured yet
    new_agents = [agent for agent in filesystem_agents if agent not in configured_agents]
    
    if not new_agents:
        print("\n✅ No new agents found. All agents are already configured.")
        return
    
    print(f"\n🆕 Found new agents: {new_agents}")
    print("=" * 50)
    
    # Process each new agent
    for agent_name in new_agents:
        print(f"\n🔧 Processing agent: {agent_name}")
        
        # 1. Add dependency to Chart.yaml
        add_chart_dependency(agent_name)
        
        # 2. Update values files
        add_to_values_file(helm_dir / "values.yaml", agent_name)
        add_to_existing_secrets_file(helm_dir / "values-existing-secrets.yaml", agent_name)
        add_to_ingress_file(helm_dir / "values-ingress.yaml.example", agent_name)
        
        # 3. Update external secrets file
        add_to_external_secrets_file(helm_dir / "values-external-secrets.yaml.example", agent_name)
        
        print(f"✅ Agent {agent_name} configured successfully!")
    
    # 4. Bump version once after all agents are processed
    if new_agents:
        bump_chart_version(helm_dir / "Chart.yaml")
    
    print("\n" + "=" * 50)
    print("🎉 All new agents have been configured!")
    print("\n📝 Manual steps required:")
    for agent_name in new_agents:
        print(f"\nFor agent-{agent_name}:")
        print("  1. Review and update configuration in:")
        print("     - helm/values.yaml")
        print("     - helm/values-existing-secrets.yaml") 
        print("     - helm/values-external-secrets.yaml.example")
        print("  2. Add specific secrets and environment variables")
    print("\n3. Test the configuration with: helm template ./helm")
    print("4. Run: helm dependency update ./helm")

if __name__ == "__main__":
    main()
