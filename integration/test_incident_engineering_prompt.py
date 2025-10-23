"""
Example usage of Incident Engineering Deep Agents

This example demonstrates how incident engineering capabilities are now integrated
into the deep agent system through the system_prompt_template rather than separate sub-agents.
"""

import asyncio
from deepagents import create_configurable_agent
from ai_platform_engineering.utils.prompt_config import (
    get_prompt_config_loader,
    get_agent_system_prompt,  
    get_agent_skill_examples,
)

def main():
    """
    Demonstrate incident engineering capabilities integrated into deep agents.
    """
    
    # Load the YAML configuration
    loader = get_prompt_config_loader()
    
    # Check what incident engineering capabilities are available
    incident_capabilities = loader.get_incident_engineering_agents()
    
    # The system prompt now includes incident engineering capabilities built-in
    system_prompt = loader.system_prompt_template
    
    print("📋 Incident Engineering Integration Status:")
    if incident_capabilities:
        print(f"   ✅ Incident engineering capabilities detected: {', '.join(incident_capabilities)}")
        print(f"   ✅ Built into system prompt template ({len(system_prompt)} characters)")
    else:
        print("   ❌ No incident engineering capabilities detected in system prompt")
        return
    
    print("=== Incident Engineering Deep Agents Demo ===\n")
    
    # Demonstrate YAML configuration loading
    print("📄 DEEP AGENT CONFIGURATION LOADING")
    print("-" * 40)
    
    print(f"Agent Name: {loader.agent_name}")
    print(f"Configuration loaded from: {loader.config_path}")
    print(f"Available incident engineering capabilities: {incident_capabilities}")
    
    # Show incident engineering section from system prompt template
    system_prompt_lower = system_prompt.lower()
    if 'incident engineering' in system_prompt_lower:
        incident_section_start = system_prompt_lower.find('incident engineering')
        incident_section = system_prompt[incident_section_start:incident_section_start + 500]
        print(f"\nIncident Engineering section (first 500 chars): {incident_section}...")
    else:
        print("\nIncident Engineering section: Not found in system prompt template")
    
    # Show available agent prompts (these would be for other agents like jira, github, etc.)
    available_agents = loader.list_configured_agents()
    print(f"\nOther available agents: {available_agents[:5]}{'...' if len(available_agents) > 5 else ''}")
    
    print("\n" + "="*60 + "\n")
    
    # Example 1: Active Incident Response
    print("1. ACTIVE INCIDENT RESPONSE SCENARIO")
    print("-" * 40)
    
    incident_query = """
    We have a critical incident: API response times spiked to >5 seconds starting at 14:30 UTC.
    PagerDuty alert shows high latency, and users are reporting login failures.
    Jira ticket PROD-1234 has been created. Can you investigate the root cause?
    """
    
    print(f"Query: {incident_query}")
    print("\nAgent Response:")
    print("→ Deep agent with built-in incident engineering capabilities would handle this")
    print("→ Expected: Root cause analysis with confidence levels and remediation options")
    print("→ Built-in incident investigator functionality")
    
    # Example 2: Proactive Analysis Request  
    print("\n\n2. PROACTIVE RELIABILITY ANALYSIS")
    print("-" * 40)
    
    analysis_query = """
    Can you generate our monthly MTTR report for December 2024?
    We had 23 incidents with an average recovery time of 35 minutes.
    I'd like to see improvement opportunities and action items.
    """
    
    print(f"Query: {analysis_query}")
    print("\nAgent Response:")
    print("→ Deep agent with built-in MTTR analysis capabilities")
    print("→ Expected: Comprehensive MTTR report + improvement recommendations")
    print("→ Built-in MTTR analyst functionality")
    
    # Example 3: Post-Incident Documentation
    print("\n\n3. POST-INCIDENT DOCUMENTATION")  
    print("-" * 40)
    
    documentation_query = """
    Please create a comprehensive postmortem for yesterday's database connection pool outage.
    The incident lasted 45 minutes and affected 15% of users.
    Root cause was a connection leak in user-service v2.3.1.
    """
    
    print(f"Query: {documentation_query}")
    print("\nAgent Response:")
    print("→ Deep agent with built-in incident documentation capabilities")
    print("→ Expected: Structured postmortem + follow-up tickets + notifications")
    print("→ Built-in incident documenter functionality")
    
    # Example 4: Multi-Capability Workflow
    print("\n\n4. INTEGRATED INCIDENT ENGINEERING WORKFLOW")
    print("-" * 40)
    
    complex_query = """
    We need a complete incident analysis for the Q4 2024 outages.
    Can you investigate patterns, create documentation, and provide reliability recommendations?
    """
    
    print(f"Query: {complex_query}")
    print("\nAgent Response:")
    print("→ Single deep agent handles all incident engineering capabilities:")
    print("  • Investigation and pattern analysis")
    print("  • MTTR analysis and trends") 
    print("  • Uptime analysis and SLO compliance")
    print("  • Comprehensive documentation and reporting")
    print("→ Result: Complete reliability assessment with strategic recommendations")

def demonstrate_capabilities():
    """
    Show the incident engineering capabilities now built into the deep agent.
    """
    print("\n\n=== BUILT-IN INCIDENT ENGINEERING CAPABILITIES ===\n")
    
    print("The deep agent now includes these capabilities in system_prompt_template:")
    print("├── Incident Investigator: Deep root cause analysis")
    print("├── Incident Documenter: Comprehensive post-incident documentation") 
    print("├── MTTR Analyst: Recovery time analysis and improvement")
    print("└── Uptime Analyst: Service availability and SLO compliance")
    
    print("\nAdvantages of integrated approach:")
    print("• No separate sub-agent configuration needed")
    print("• Always available when using deep agent system") 
    print("• Seamless workflow integration")
    print("• Simplified architecture")
    print("• Built-in incident engineering expertise")

def show_meta_prompt_triggers():
    """
    Display the meta-prompt trigger phrases for automatic capability selection.
    """
    print("\n\n=== INCIDENT ENGINEERING TRIGGERS ===\n")
    
    triggers = {
        "Incident Investigation": [
            "root cause analysis", "investigate incident", "why did this happen", 
            "analyze outage", "troubleshoot issue"
        ],
        "Incident Documentation": [
            "create postmortem", "document incident", "write up the outage",
            "incident report", "post-incident documentation"  
        ],
        "MTTR Analysis": [
            "MTTR report", "recovery time analysis", "how long to fix",
            "incident response time", "time to resolution"
        ],
        "Uptime Analysis": [
            "uptime report", "availability analysis", "SLO compliance", 
            "service reliability", "downtime analysis"
        ]
    }
    
    print("These phrases automatically trigger the appropriate incident engineering capabilities:")
    for capability, phrases in triggers.items():
        print(f"\n{capability}:")
        for phrase in phrases:
            print(f"  • '{phrase}'")

if __name__ == "__main__":
    print("Running Incident Engineering Deep Agent Integration Demo...\n")
    
    # Run the demo
    main()
    
    # Show additional information
    demonstrate_capabilities() 
    show_meta_prompt_triggers()
    
    print("\n=== INTEGRATION COMPLETE ===")
    print("The incident engineering capabilities have been successfully")
    print("integrated into the deep agent system with:")
    print("• Built-in incident engineering specialists in system_prompt_template")
    print("• Centralized prompt management through prompt_config.deep_agent.yaml") 
    print("• Integrated workflow orchestration capabilities")
    print("• No separate sub-agent configuration needed")
    print("• Incident capabilities always available when using deep agent system")
    print("• Clean architecture with incident engineering as core capability")