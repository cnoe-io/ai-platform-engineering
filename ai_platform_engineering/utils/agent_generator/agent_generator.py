# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Generator

Generates agent scaffolding from manifests.
"""

import os
import shutil
from pathlib import Path
from typing import Optional, Dict, Any
from .models import AgentManifest, AgentProtocol, DependencySource


class AgentGenerator:
    """Generator for creating agent scaffolding from manifests"""
    
    def __init__(self, template_dir: Optional[Path] = None):
        """
        Initialize the generator
        
        Args:
            template_dir: Directory containing external templates (optional, unused for now)
        """
        # Template directory for future use with external templates
        self.template_dir = Path(template_dir) if template_dir else None
    
    def generate(
        self,
        manifest: AgentManifest,
        output_dir: Path,
        overwrite: bool = False,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Generate agent scaffolding from manifest
        
        Args:
            manifest: The agent manifest
            output_dir: Output directory for generated agent
            overwrite: Whether to overwrite existing files
            dry_run: If True, only show what would be generated
            
        Returns:
            Dictionary with generation results and statistics
        """
        output_dir = Path(output_dir)
        agent_name = manifest.metadata.name
        agent_dir = output_dir / agent_name
        
        results = {
            "agent_name": agent_name,
            "agent_dir": str(agent_dir),
            "files_created": [],
            "files_skipped": [],
            "dry_run": dry_run
        }
        
        # Check if agent directory exists
        if agent_dir.exists() and not overwrite:
            raise FileExistsError(
                f"Agent directory already exists: {agent_dir}. "
                "Use overwrite=True to replace it."
            )
        
        if not dry_run:
            # Create agent directory structure
            agent_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate agent structure
        self._generate_agent_package(manifest, agent_dir, results, dry_run)
        self._generate_protocol_bindings(manifest, agent_dir, results, dry_run)
        self._generate_build_files(manifest, agent_dir, results, dry_run)
        self._generate_config_files(manifest, agent_dir, results, dry_run)
        self._generate_documentation(manifest, agent_dir, results, dry_run)
        self._generate_tests(manifest, agent_dir, results, dry_run)
        self._generate_clients(manifest, agent_dir, results, dry_run)
        
        return results
    
    def _generate_agent_package(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate main agent package"""
        agent_name = manifest.metadata.name
        pkg_name = f"agent_{agent_name}"
        pkg_dir = agent_dir / pkg_name
        
        if not dry_run:
            pkg_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate __init__.py
        self._create_file(
            pkg_dir / "__init__.py",
            self._render_template("agent_init.py.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate __main__.py
        self._create_file(
            pkg_dir / "__main__.py",
            self._render_template("agent_main.py.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate agentcard.py
        self._create_file(
            pkg_dir / "agentcard.py",
            self._render_template("agentcard.py.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate state.py if needed
        self._create_file(
            pkg_dir / "state.py",
            self._render_template("agent_state.py.j2", manifest=manifest),
            results,
            dry_run
        )
    
    def _generate_protocol_bindings(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate protocol binding code"""
        agent_name = manifest.metadata.name
        pkg_name = f"agent_{agent_name}"
        bindings_dir = agent_dir / pkg_name / "protocol_bindings"
        
        if not dry_run:
            bindings_dir.mkdir(parents=True, exist_ok=True)
        
        self._create_file(
            bindings_dir / "__init__.py",
            "# Protocol bindings\n",
            results,
            dry_run
        )
        
        # Generate A2A server if needed
        if AgentProtocol.A2A in manifest.protocols or AgentProtocol.BOTH in manifest.protocols:
            self._generate_a2a_server(manifest, bindings_dir, results, dry_run)
        
        # Generate MCP server if needed
        if AgentProtocol.MCP in manifest.protocols or AgentProtocol.BOTH in manifest.protocols:
            self._generate_mcp_server(manifest, agent_dir, results, dry_run)
    
    def _generate_a2a_server(
        self,
        manifest: AgentManifest,
        bindings_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate A2A server code"""
        a2a_dir = bindings_dir / "a2a_server"
        
        if not dry_run:
            a2a_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate A2A server files
        files = {
            "__init__.py": "a2a_init.py.j2",
            "agent.py": "a2a_agent.py.j2",
            "agent_executor.py": "a2a_executor.py.j2",
            "helpers.py": "a2a_helpers.py.j2",
            "README.md": "a2a_readme.md.j2"
        }
        
        for filename, template_name in files.items():
            self._create_file(
                a2a_dir / filename,
                self._render_template(template_name, manifest=manifest),
                results,
                dry_run
            )
    
    def _generate_mcp_server(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate MCP server code"""
        agent_name = manifest.metadata.name
        mcp_dir = agent_dir / "mcp"
        mcp_pkg_dir = mcp_dir / f"mcp_{agent_name}"
        
        if not dry_run:
            mcp_pkg_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate MCP server files
        self._create_file(
            mcp_pkg_dir / "__init__.py",
            "# MCP Server Package\n",
            results,
            dry_run
        )
        
        self._create_file(
            mcp_pkg_dir / "server.py",
            self._render_template("mcp_server.py.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate MCP pyproject.toml
        self._create_file(
            mcp_dir / "pyproject.toml",
            self._render_template("mcp_pyproject.toml.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate MCP Makefile
        self._create_file(
            mcp_dir / "Makefile",
            self._render_template("mcp_makefile.j2", manifest=manifest),
            results,
            dry_run
        )
    
    def _generate_build_files(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate build configuration files"""
        # Generate pyproject.toml
        self._create_file(
            agent_dir / "pyproject.toml",
            self._render_template("pyproject.toml.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate Makefile
        self._create_file(
            agent_dir / "Makefile",
            self._render_template("makefile.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate Dockerfile
        build_dir = agent_dir / "build"
        if not dry_run:
            build_dir.mkdir(parents=True, exist_ok=True)
        
        if AgentProtocol.A2A in manifest.protocols or AgentProtocol.BOTH in manifest.protocols:
            self._create_file(
                build_dir / "Dockerfile.a2a",
                self._render_template("dockerfile_a2a.j2", manifest=manifest),
                results,
                dry_run
            )
    
    def _generate_config_files(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate configuration files"""
        # Generate .env.example
        self._create_file(
            agent_dir / ".env.example",
            self._render_template("env.example.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate langgraph.json
        if AgentProtocol.A2A in manifest.protocols or AgentProtocol.BOTH in manifest.protocols:
            self._create_file(
                agent_dir / "langgraph.json",
                self._render_template("langgraph.json.j2", manifest=manifest),
                results,
                dry_run
            )
    
    def _generate_documentation(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate documentation files"""
        # Generate README.md
        self._create_file(
            agent_dir / "README.md",
            self._render_template("readme.md.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate CHANGELOG.md
        self._create_file(
            agent_dir / "CHANGELOG.md",
            self._render_template("changelog.md.j2", manifest=manifest),
            results,
            dry_run
        )
    
    def _generate_tests(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate test scaffolding"""
        tests_dir = agent_dir / "tests"
        
        if not dry_run:
            tests_dir.mkdir(parents=True, exist_ok=True)
        
        self._create_file(
            tests_dir / "__init__.py",
            "# Tests\n",
            results,
            dry_run
        )
        
        self._create_file(
            tests_dir / "test_agent.py",
            self._render_template("test_agent.py.j2", manifest=manifest),
            results,
            dry_run
        )
    
    def _generate_clients(
        self,
        manifest: AgentManifest,
        agent_dir: Path,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Generate client code for testing"""
        clients_dir = agent_dir / "clients"
        
        if not dry_run:
            clients_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate A2A client
        a2a_client_dir = clients_dir / "a2a"
        if not dry_run:
            a2a_client_dir.mkdir(parents=True, exist_ok=True)
        
        self._create_file(
            a2a_client_dir / "agent.py",
            self._render_template("client_a2a.py.j2", manifest=manifest),
            results,
            dry_run
        )
        
        # Generate SLIM client
        slim_client_dir = clients_dir / "slim"
        if not dry_run:
            slim_client_dir.mkdir(parents=True, exist_ok=True)
        
        self._create_file(
            slim_client_dir / "agent.py",
            self._render_template("client_slim.py.j2", manifest=manifest),
            results,
            dry_run
        )
    
    def _render_template(self, template_name: str, **context) -> str:
        """
        Render a template using inline templates
        
        Args:
            template_name: Name of the template file
            **context: Template context variables
            
        Returns:
            Rendered template string
        """
        # Use inline templates
        return self._get_inline_template(template_name, **context)
    
    def _get_inline_template(self, template_name: str, manifest: AgentManifest) -> str:
        """Get inline template content as fallback"""
        # Import inline templates
        from .templates_inline import get_template
        return get_template(template_name, manifest)
    
    def _create_file(
        self,
        file_path: Path,
        content: str,
        results: Dict[str, Any],
        dry_run: bool
    ):
        """Create a file with content"""
        if dry_run:
            results["files_created"].append(str(file_path))
            return
        
        # Create parent directories
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write content
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        results["files_created"].append(str(file_path))

