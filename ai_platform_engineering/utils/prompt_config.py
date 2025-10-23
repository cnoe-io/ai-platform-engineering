"""
Prompt Configuration Utilities

This module provides utilities for loading and managing prompt configurations from YAML files.
Designed to work with the CAIPE deep agent system and supports multiple YAML configuration formats.
Consolidates all prompt loading and processing logic from various prompts.py files.
"""

import yaml
import os
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
# Note: PromptTemplate import removed - handled by individual prompts.py files

# Set up logging
logger = logging.getLogger(__name__)


class PromptConfigLoader:
    """
    Utility class for loading prompt configurations from YAML files.
    
    This class provides methods to load the deep agent prompt configuration
    and extract specific elements like agent prompts and skill examples.
    """
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the prompt config loader.
        
        Args:
            config_path: Optional path to config file. If None, searches for prompt_config.deep_agent.yaml
                        in common locations
        """
        self.config_path = config_path
        self._config = None
        self._load_config()
    
    def _find_config_file(self) -> Optional[str]:
        """
        Search for the deep agent config file in common locations.
        
        Returns:
            str: Path to config file if found, None otherwise
        """
        possible_paths = [
            # From project root
            "charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml",
            
            # From utils directory
            "../../charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml",
            
            # Relative to this file
            os.path.join(os.path.dirname(__file__), "../../charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml"),
            
            # From deepagents directory
            "../charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml",
            
            # Direct path
            "prompt_config.deep_agent.yaml",
        ]
        
        for path in possible_paths:
            abs_path = os.path.abspath(path)
            if os.path.exists(abs_path):
                return abs_path
        
        return None
    
    def _load_config(self) -> None:
        """Load the configuration from YAML file."""
        if self.config_path is None:
            self.config_path = self._find_config_file()
        
        if self.config_path is None:
            print("Warning: Could not find prompt_config.deep_agent.yaml")
            self._config = {}
            return
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self._config = yaml.safe_load(f) or {}
                print(f"Loaded deep agent prompt config from: {self.config_path}")
        except Exception as e:
            print(f"Error loading prompt config from {self.config_path}: {e}")
            self._config = {}
    
    @property
    def config(self) -> Dict[str, Any]:
        """Get the full loaded configuration."""
        return self._config or {}
    
    @property
    def agent_name(self) -> str:
        """Get the agent name from configuration."""
        return self.config.get('agent_name', 'AI Platform Engineer — Deep Agent')
    
    @property
    def agent_description(self) -> str:
        """Get the agent description from configuration."""
        return self.config.get('agent_description', 'Deep Agent orchestrator for CAIPE architecture')
    
    @property
    def system_prompt_template(self) -> str:
        """Get the system prompt template from configuration."""
        return self.config.get('system_prompt_template', '')
    
    @property
    def agent_prompts(self) -> Dict[str, Dict[str, str]]:
        """Get the agent prompts mapping from configuration."""
        return self.config.get('agent_prompts', {})
    
    @property
    def agent_skill_examples(self) -> Dict[str, List[str]]:
        """Get the agent skill examples mapping from configuration."""
        return self.config.get('agent_skill_examples', {})
    
    def get_agent_system_prompt(self, agent_key: str) -> str:
        """
        Get the system prompt for a specific agent.
        
        Args:
            agent_key: The agent identifier (e.g., 'incident-investigator', 'jira', 'rag')
            
        Returns:
            str: The system prompt for the agent, or a default prompt if not found
        """
        agent_config = self.agent_prompts.get(agent_key, {})
        return agent_config.get('system_prompt', f'Handle {agent_key} operations')
    
    def get_agent_skill_examples(self, agent_key: str) -> List[str]:
        """
        Get skill examples for a specific agent.
        
        Args:
            agent_key: The agent identifier
            
        Returns:
            list: List of skill examples for the agent
        """
        return self.agent_skill_examples.get(agent_key, [])
    
    def has_agent(self, agent_key: str) -> bool:
        """
        Check if an agent is configured.
        
        Args:
            agent_key: The agent identifier
            
        Returns:
            bool: True if agent is configured, False otherwise
        """
        return agent_key in self.agent_prompts
    
    def list_configured_agents(self) -> List[str]:
        """
        Get a list of all configured agent keys.
        
        Returns:
            list: List of configured agent identifiers
        """
        return list(self.agent_prompts.keys())
    
    def get_incident_engineering_agents(self) -> List[str]:
        """
        Get a list of incident engineering agent keys.
        Since incident engineering is now built into system_prompt_template,
        return the standard incident engineering capabilities.
        
        Returns:
            list: List of incident engineering capabilities
        """
        # These are the incident engineering capabilities now built into system_prompt_template
        incident_capabilities = [
            'incident-investigator',
            'incident-documenter', 
            'mttr-analyst',
            'uptime-analyst'
        ]
        
        # Check if incident engineering capabilities are available in system_prompt_template
        system_prompt = self.system_prompt_template.lower()
        
        # Simple check for incident-related content in the system prompt
        incident_indicators = [
            'incident',  # Any mention of incidents
            'mttr',      # MTTR analysis
            'uptime',    # Uptime analysis  
            'postmortem', # Documentation
            'root cause'  # Investigation
        ]
        
        # If any incident-related content is found, assume incident capabilities are available
        if any(indicator in system_prompt for indicator in incident_indicators):
            return incident_capabilities
        else:
            return []
    
    def get_incident_engineering_agents(self) -> List[str]:
        """
        Get a list of incident engineering agent keys.
        
        Returns:
            list: List of incident engineering agent identifiers
        """
        incident_agents = [
            'incident-investigator',
            'incident-documenter', 
            'mttr-analyst',
            'uptime-analyst'
        ]
        return [agent for agent in incident_agents if self.has_agent(agent)]


# Global instance for easy access
_global_loader = None

def get_prompt_config_loader(config_path: Optional[str] = None) -> PromptConfigLoader:
    """
    Get a global instance of the prompt config loader.
    
    Args:
        config_path: Optional path to config file
        
    Returns:
        PromptConfigLoader: The global loader instance
    """
    global _global_loader
    if _global_loader is None or config_path is not None:
        _global_loader = PromptConfigLoader(config_path)
    return _global_loader

def get_agent_system_prompt(agent_key: str) -> str:
    """
    Convenience function to get an agent's system prompt.
    
    Args:
        agent_key: The agent identifier
        
    Returns:
        str: The system prompt for the agent
    """
    loader = get_prompt_config_loader()
    return loader.get_agent_system_prompt(agent_key)

def get_agent_skill_examples(agent_key: str) -> List[str]:
    """
    Convenience function to get an agent's skill examples.
    
    Args:
        agent_key: The agent identifier
        
    Returns:
        list: List of skill examples for the agent
    """
    loader = get_prompt_config_loader()
    return loader.get_agent_skill_examples(agent_key)

# Export commonly used functions for easy importing
__all__ = [
    # Core classes
    "PromptConfigLoader",
    
    # Universal loading functions
    "load_prompt_config", 
    "get_prompt_config_loader",
    
    # Deep agent specific
    "get_agent_system_prompt", 
    "get_agent_skill_examples",
    "get_deep_agent_config",
    
    # Platform engineer specific
    "load_platform_config",
    "get_platform_agent_info", 
    "generate_platform_skill_examples",
    "generate_platform_system_prompt",
    "get_platform_prompts_config",
    
    
    # Configuration utilities
    "detect_config_type",
    "get_all_available_configs", 
    "merge_configs",
    "validate_config_structure",
    
    # Meta prompts
    "INCIDENT_ENGINEERING_META_PROMPTS"
]

def get_deep_agent_config() -> Dict[str, Any]:
    """
    Convenience function to get the full deep agent configuration.
    
    Returns:
        dict: The full configuration dictionary
    """
    loader = get_prompt_config_loader()
    return loader.config

# ============================================================================
# PLATFORM ENGINEER PROMPT PROCESSING LOGIC
# Moved from ai_platform_engineering/multi_agents/platform_engineer/prompts.py
# ============================================================================

def load_platform_config(path="prompt_config.yaml") -> Dict[str, Any]:
    """Load platform engineer prompt configuration from YAML file."""
    if os.path.exists(path):
        with open(path, "r") as f:
            return yaml.safe_load(f)
    return {}

def get_platform_agent_info(config: Dict[str, Any], platform_registry) -> tuple:
    """Extract agent information for platform engineer configuration."""
    agent_name = config.get("agent_name", "AI Platform Engineer")
    
    # Build dynamic agent description exactly matching original logic
    agent_description = config.get("agent_description", (
        "This platform engineering system integrates with multiple tools to manage operations efficiently. "
        "It includes PagerDuty for incident management, GitHub for version control and collaboration, "
        "Jira for project management and ticket tracking, Slack for team communication and notifications, "
    ) +
        ("Webex for messaging and notifications, " if platform_registry.agent_exists("webex") else "") +
        ("Komodor for Kubernetes cluster and workload management, " if platform_registry.agent_exists("komodor") else "") + (
        "ArgoCD for application deployment and synchronization, and Backstage for catalog and service metadata management. "
        "Each tool is handled by a specialized agent to ensure seamless task execution, "
        "covering tasks such as incident resolution, repository management, ticket updates, "
        "channel creation, application synchronization, and catalog queries."
    ))
    
    return agent_name, agent_description

def generate_platform_skill_examples(config: Dict[str, Any], platform_registry) -> List[str]:
    """Generate skill examples for platform engineering agents."""
    agent_examples_from_config = config.get("agent_skill_examples", {})
    agents = platform_registry.agents
    agent_skill_examples = []
    
    # Always include general examples
    if agent_examples_from_config.get("general"):
        agent_skill_examples.extend(agent_examples_from_config.get("general"))
    
    # Include sub-agent examples from config ONLY IF the sub-agent is enabled
    for agent_name, agent_card in agents.items():
        if agent_card is not None:
            try:
                agent_eg = agent_examples_from_config.get(agent_name.lower())
                if agent_eg:
                    logger.info("Agent examples config found for agent: %s", agent_name)
                    agent_skill_examples.extend(agent_eg)
                else:  # If no examples are provided in the config, use the agent's own examples
                    logger.info("Agent examples config not found for agent: %s", agent_name)
                    agent_skill_examples.extend(platform_registry.get_agent_examples(agent_name))
            except Exception as e:
                logger.warning(f"Error getting skill examples from agent: {e}")
                continue
    
    return agent_skill_examples

def generate_platform_system_prompt(config: Dict[str, Any], agents: Dict[str, Any]) -> str:
    """Generate dynamic system prompt for platform engineer based on available tools."""
    agent_prompts = config.get("agent_prompts", {})
    tool_instructions = []
    
    for agent_key, agent_card in agents.items():
        logger.info(f"Generating tool instruction for agent_key: {agent_key}")
        
        # Check if agent and agent_card are available
        if agent_card is None:
            logger.warning(f"Agent {agent_key} is None, skipping...")
            continue
        
        try:
            if agent_card is None:
                logger.warning(f"Agent {agent_key} has no agent card, skipping...")
                continue
            
            description = agent_card['description']
        except (AttributeError, KeyError) as e:
            logger.warning(f"Agent {agent_key} does not have description: {e}, skipping...")
            continue
        except Exception as e:
            logger.error(f"Error getting agent card for {agent_key}: {e}, skipping...")
            continue
        
        # Check if there is a system_prompt override provided in the prompt config
        system_prompt_override = agent_prompts.get(agent_key, {}).get("system_prompt", None)
        if system_prompt_override:
            agent_system_prompt = system_prompt_override
        else:
            # Use the agent description as the system prompt
            agent_system_prompt = description
        
        instruction = f"""
{agent_key}:
  {agent_system_prompt}
"""
        tool_instructions.append(instruction.strip())
    
    tool_instructions_str = "\n\n".join(tool_instructions)
    yaml_template = config.get("system_prompt_template")
    
    logger.info(f"System Prompt Template: {yaml_template}")
    
    if yaml_template:
        return yaml_template.format(tool_instructions=tool_instructions_str)
    else:
        return f"""
You are an AI Platform Engineer, a multi-agent system designed to manage operations across various tools.

LLM Instructions:
- Only respond to requests related to the integrated tools. Always call the appropriate agent or tool.
- When responding, use markdown format. Make sure all URLs are presented as clickable links.


{tool_instructions_str}
"""


# ============================================================================
# ENHANCED DEEP AGENT CONFIGURATION PROCESSING
# ============================================================================

# Meta prompts for incident engineering agent selection
INCIDENT_ENGINEERING_META_PROMPTS = """
## Incident Engineering Agent Selection Guide

Use these specialized incident engineering agents proactively when users mention:

### Incident Investigator Agent
**Trigger phrases**: "root cause analysis", "investigate incident", "why did this happen", "analyze outage", "troubleshoot issue"
**Use when**: Users need deep technical investigation of incidents using multiple data sources
**Example**: "Can you investigate why our API went down this morning?"

### Incident Documenter Agent  
**Trigger phrases**: "create postmortem", "document incident", "write up the outage", "incident report", "post-incident documentation"
**Use when**: Users need structured documentation with follow-up actions
**Example**: "Please create a postmortem for yesterday's database outage"

### MTTR Analyst Agent
**Trigger phrases**: "MTTR report", "recovery time analysis", "how long to fix", "incident response time", "time to resolution"
**Use when**: Users need analysis of incident response performance and improvement initiatives
**Example**: "Generate our monthly MTTR report and identify improvement opportunities"

### Uptime Analyst Agent
**Trigger phrases**: "uptime report", "availability analysis", "SLO compliance", "service reliability", "downtime analysis"
**Use when**: Users need service availability metrics and reliability improvement plans
**Example**: "Show me our Q4 uptime performance against SLO targets"

## Agent Orchestration Patterns

### Multi-Agent Workflows
For complex incident management, consider using multiple agents in sequence:

1. **Investigation → Documentation**: Use Incident Investigator first, then Incident Documenter for complete workflow
2. **Analysis → Reporting**: Use MTTR Analyst or Uptime Analyst, then Incident Documenter for executive reports
3. **Reactive → Proactive**: Start with investigation/documentation, follow up with trend analysis agents

### Proactive Usage
- After any incident mention, consider if documentation or analysis agents should be invoked
- For recurring "how are we doing" questions, proactively use MTTR or Uptime analysts
- When users mention metrics or trends, suggest comprehensive analysis even if not explicitly requested
"""

# ============================================================================
# UNIFIED PROMPT LOADING INTERFACE
# Provides backward compatibility for existing prompts.py files
# ============================================================================

def load_prompt_config(path: str = "prompt_config.yaml", config_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Universal prompt configuration loader.
    
    Args:
        path: Path to YAML config file (relative or absolute)
        config_type: Type hint for which config format ("deep_agent", "platform_engineer", "incident_engineer")
    
    Returns:
        Dict containing the loaded YAML configuration
    """
    # Auto-detect config type based on path if not specified
    if config_type is None:
        if "deep_agent" in path:
            config_type = "deep_agent"
        else:
            config_type = "platform_engineer"
    
    # Use appropriate loader based on config type
    if config_type == "deep_agent":
        loader = get_prompt_config_loader(path if path != "prompt_config.yaml" else None)
        return loader.config
    else:  # platform_engineer
        return load_platform_config(path)

# ============================================================================
# BACKWARD COMPATIBILITY FUNCTIONS
# These ensure existing imports continue to work without modification
# ============================================================================

# For multi_agents/platform_engineer/prompts.py compatibility
def get_platform_prompts_config() -> Dict[str, Any]:
    """Get platform engineer configuration - backward compatibility."""
    return load_platform_config()


# For integration/test_incident_engineering_prompt.py compatibility
# (These functions are already defined above)

# ============================================================================
# ENHANCED CONFIGURATION UTILITIES
# Additional utilities that work across all configuration types
# ============================================================================

def detect_config_type(config_content: Dict[str, Any]) -> str:
    """
    Detect the type of prompt configuration based on its structure.
    
    Returns:
        "deep_agent" or "platform_engineer"
    """
    if "system_prompt_template" in config_content and "agent_prompts" in config_content:
        return "deep_agent"
    else:
        return "platform_engineer"

def get_all_available_configs() -> Dict[str, str]:
    """
    Discover all available prompt configuration files.
    
    Returns:
        Dict mapping config names to file paths
    """
    configs = {}
    
    # Check for deep agent config
    loader = PromptConfigLoader()
    if loader.config_path:
        configs["deep_agent"] = loader.config_path
    
    # Check for platform engineer config
    if os.path.exists("prompt_config.yaml"):
        configs["platform_engineer"] = "prompt_config.yaml"
    
    
    return configs

def merge_configs(*config_dicts: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge multiple configuration dictionaries with smart conflict resolution.
    
    Args:
        *config_dicts: Variable number of configuration dictionaries to merge
        
    Returns:
        Merged configuration dictionary
    """
    merged = {}
    
    for config in config_dicts:
        for key, value in config.items():
            if key in merged:
                # Smart merge for known structure keys
                if key == "agent_prompts" and isinstance(merged[key], dict) and isinstance(value, dict):
                    merged[key].update(value)
                elif key == "agent_skill_examples" and isinstance(merged[key], dict) and isinstance(value, dict):
                    # Merge lists for skill examples
                    for agent, examples in value.items():
                        if agent in merged[key]:
                            merged[key][agent].extend(examples)
                        else:
                            merged[key][agent] = examples
                else:
                    # Later configs override earlier ones for other keys
                    merged[key] = value
            else:
                merged[key] = value
    
    return merged

def validate_config_structure(config: Dict[str, Any], config_type: str) -> tuple[bool, List[str]]:
    """
    Validate that a configuration has the expected structure for its type.
    
    Args:
        config: Configuration dictionary to validate
        config_type: Expected type ("deep_agent", "platform_engineer", "incident_engineer")
        
    Returns:
        Tuple of (is_valid, list_of_errors)
    """
    errors = []
    
    if config_type == "deep_agent":
        required_keys = ["agent_name", "system_prompt_template", "agent_prompts"]
        for key in required_keys:
            if key not in config:
                errors.append(f"Missing required key: {key}")
    
    
    elif config_type == "platform_engineer":
        # Platform engineer configs are more flexible, just check basic structure
        if not isinstance(config, dict):
            errors.append("Configuration should be a dictionary")
    
    return len(errors) == 0, errors

