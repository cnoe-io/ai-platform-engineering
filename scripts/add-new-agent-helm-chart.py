#!/usr/bin/env python3
"""
Script to automatically update Helm configuration when a new MCP server is added.
This script will:
1. Add new dependency in Chart.yaml
2. Bump the chart version
3. Add new mcp-* sections to values files with empty configurations
"""

import sys
import re
from pathlib import Path
from ruamel.yaml import YAML

# assisted-by Codex Codex-sonnet-4-6
yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096  # Prevent line wrapping

def get_script_dir():
    """Get the directory where this script is located."""
    return Path(__file__).parent.absolute()

def get_project_root():
    """Get the project root directory."""
    return get_script_dir().parent

def get_mcp_servers_dir():
    """Get the MCP servers directory path."""
    return get_project_root() / "ai_platform_engineering" / "mcp"

def get_chart_dir():
    """Get the ai-platform-engineering chart directory path."""
    return get_project_root() / "charts" / "ai-platform-engineering"

def get_existing_mcp_servers():
    """Get list of existing MCP servers from the MCP directory."""
    mcp_dir = get_mcp_servers_dir()
    if not mcp_dir.exists():
        print(f"Error: MCP directory not found at {mcp_dir}")
        return []

    servers = []
    for item in mcp_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('__'):
            servers.append(item.name)
    
    return sorted(servers)

def get_chart_dependencies():
    """Get current dependencies from Chart.yaml."""
    return get_configured_mcp_servers()

def get_mcp_chart_version():
    """Get the current version from the mcp-server chart."""
    mcp_chart_file = get_chart_dir() / "charts" / "mcp-server" / "Chart.yaml"
    
    if not mcp_chart_file.exists():
        print(f"Warning: mcp-server Chart.yaml not found at {mcp_chart_file}, using default version 0.1.0")
        return "0.1.0"
    
    try:
        with open(mcp_chart_file, 'r') as f:
            chart_data = yaml.load(f)
        
        version = chart_data.get('version', '0.1.0')
        print(f"📦 Using mcp-server chart version: {version}")
        return version
    except Exception as e:
        print(f"Warning: Could not read mcp-server chart version: {e}, using default 0.1.0")
        return "0.1.0"

def bump_chart_version(chart_file):
    """Bump the main chart version (patch bump for new MCP servers)."""
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

def add_chart_dependency(server_name):
    """Add new dependency to Chart.yaml with proper formatting."""
    chart_file = get_chart_dir() / "Chart.yaml"
    
    with open(chart_file, 'r') as f:
        content = f.read()
    
    # Check if dependency already exists
    if f"alias: mcp-{server_name}" in content:
        print(f"✓ Dependency mcp-{server_name} already exists in Chart.yaml")
        return
    
    mcp_version = get_mcp_chart_version()
    
    # Insert MCP servers before the RAG stack dependency.
    rag_stack_pattern = r'(\n  - name: rag-stack)'
    
    new_dependency = \
f"""
  - name: mcp-server
    version: {mcp_version}
    alias: mcp-{server_name}
    tags:
      - mcp-{server_name}
    import-values:
      - child: global
        parent: global.enabledSubAgents.{server_name}"""

    match = re.search(rag_stack_pattern, content)
    if match:
        insert_pos = match.start()
        new_content = content[:insert_pos] + new_dependency + content[insert_pos:]
        
        with open(chart_file, 'w') as f:
            f.write(new_content)
        
        print(f"✓ Added dependency mcp-{server_name} to Chart.yaml")
    else:
        print("Warning: Could not find rag-stack dependency in Chart.yaml")

def add_to_values_file(values_file, server_name):
    """Add new mcp section to values.yaml."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    if f"mcp-{server_name}:" in content:
        print(f"✓ mcp-{server_name} already exists in {values_file.name}")
        return

    server_section = f'''
mcp-{server_name}:
  enabled: false
  nameOverride: "mcp-{server_name}"
  image:
    repository: "ghcr.io/cnoe-io/mcp-{server_name}"
  mcp:
    image:
      repository: "ghcr.io/cnoe-io/mcp-{server_name}"
      tag: ""
      pullPolicy: "IfNotPresent"
    mode: "http"
    port: 8000
'''
    
    with open(values_file, 'a') as f:
        f.write(server_section)
    
    print(f"✓ Added mcp-{server_name} section to {values_file.name}")

def add_to_existing_secrets_file(values_file, server_name):
    """Add new mcp section to values-existing-secrets.yaml."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    if f"mcp-{server_name}:" in content:
        print(f"✓ mcp-{server_name} already exists in {values_file.name}")
        return

    server_section = f'''
mcp-{server_name}:
  agentSecrets:
    secretName: "" # Specify an existing Kubernetes secret name, or leave empty to auto-generate from values-secrets.yaml
'''
    
    with open(values_file, 'a') as f:
        f.write(server_section)
    
    print(f"✓ Added mcp-{server_name} section to {values_file.name}")

def add_to_ingress_file(values_file, server_name):
    """Add new mcp section to values-ingress.yaml.example."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    if f"mcp-{server_name}:" in content:
        print(f"✓ mcp-{server_name} already exists in {values_file.name}")
        return

    server_section = f'''
mcp-{server_name}:
  ingress:
    hosts: []
      #  - mcp-{server_name}.local
    tls: []
      # - secretName: mcp-{server_name}-tls
      #   hosts:
      #     - mcp-{server_name}.local
'''
    
    with open(values_file, 'a') as f:
        f.write(server_section)
    
    print(f"✓ Added mcp-{server_name} section to {values_file.name}")

def add_to_external_secrets_file(values_file, server_name):
    """Add new mcp secret section to external secrets values file."""
    if not values_file.exists():
        print(f"Warning: {values_file} not found, skipping")
        return
    
    with open(values_file, 'r') as f:
        content = f.read()
    
    if f"mcp-{server_name}:" in content:
        print(f"✓ mcp-{server_name} already exists in {values_file.name}")
        return

    external_ref_section = f'''
mcp-{server_name}:
  agentSecrets:
    secretName: "external-{server_name}-secret"
    externalSecrets:
      data:
      # TODO: Add {server_name} specific secrets here.
      # - secretKey: {server_name.upper()}_API_KEY
      #   remoteRef:
      #     conversionStrategy: Default
      #     decodingStrategy: None
      #     key: dev/{server_name}
      #     property: {server_name.upper()}_API_KEY
'''

    with open(values_file, 'a') as f:
        f.write(external_ref_section)

    print(f"✓ Added mcp-{server_name} external secret section to {values_file.name}")

def get_configured_mcp_servers():
    """Get list of MCP servers already configured in Chart.yaml."""
    chart_file = get_chart_dir() / "Chart.yaml"
    if not chart_file.exists():
        print(f"Error: Chart.yaml not found at {chart_file}")
        return []
    
    try:
        with open(chart_file, 'r') as f:
            chart_data = yaml.load(f)
        
        dependencies = chart_data.get('dependencies', [])
        configured_servers = []
        
        for dep in dependencies:
            alias = dep.get('alias', '')
            if alias.startswith('mcp-'):
                configured_servers.append(alias[4:])
        
        return sorted(configured_servers)
    except Exception as e:
        print(f"Error reading Chart.yaml: {e}")
        return []

def main():
    """Main function to automatically detect and process new MCP servers."""
    print("🔍 Scanning for new MCP servers...")
    print("=" * 50)
    
    chart_dir = get_chart_dir()
    if not chart_dir.exists():
        print(f"Error: chart directory not found at {chart_dir}")
        sys.exit(1)
    
    filesystem_servers = get_existing_mcp_servers()
    configured_servers = get_configured_mcp_servers()
    
    print(f"📁 MCP servers in filesystem: {filesystem_servers}")
    print(f"📋 MCP servers in Chart.yaml: {configured_servers}")
    
    new_servers = [server for server in filesystem_servers if server not in configured_servers]
    
    if not new_servers:
        print("\n✅ No new MCP servers found. All MCP servers are already configured.")
        return
    
    print(f"\n🆕 Found new MCP servers: {new_servers}")
    print("=" * 50)
    
    for server_name in new_servers:
        print(f"\n🔧 Processing MCP server: {server_name}")
        
        # 1. Add dependency to Chart.yaml
        add_chart_dependency(server_name)
        
        # 2. Update values files
        add_to_values_file(chart_dir / "values.yaml", server_name)
        add_to_existing_secrets_file(chart_dir / "values-existing-secrets.yaml", server_name)
        add_to_ingress_file(chart_dir / "values-ingress.yaml.example", server_name)
        
        # 3. Update external secrets file
        add_to_external_secrets_file(chart_dir / "values-external-secrets.yaml", server_name)
        
        print(f"✅ MCP server {server_name} configured successfully!")
    
    # 4. Bump version once after all servers are processed
    if new_servers:
        bump_chart_version(chart_dir / "Chart.yaml")
    
    print("\n" + "=" * 50)
    print("🎉 All new MCP servers have been configured!")
    print("\n📝 Manual steps required:")
    for server_name in new_servers:
        print(f"\nFor mcp-{server_name}:")
        print("  1. Review and update configuration in:")
        print("     - charts/ai-platform-engineering/values.yaml")
        print("     - charts/ai-platform-engineering/values-existing-secrets.yaml")
        print("     - charts/ai-platform-engineering/values-external-secrets.yaml")
        print("  2. Add specific secrets and environment variables")
    print("\n3. Test the configuration with: helm template ./charts/ai-platform-engineering")
    print("4. Run: helm dependency update ./charts/ai-platform-engineering")

if __name__ == "__main__":
    main()
