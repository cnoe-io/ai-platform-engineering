
import asyncio
import os
import logging
import sys

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Set environment variables for Single Graph Mode
os.environ["SINGLE_GRAPH_MODE"] = "true"
os.environ["ENABLE_ARGOCD"] = "true"
os.environ["ENABLE_JIRA"] = "true"
os.environ["ENABLE_KOMODOR"] = "true"
os.environ["ENABLE_GITHUB"] = "true"
os.environ["ENABLE_CONFLUENCE"] = "true"
os.environ["ENABLE_PAGERDUTY"] = "true"
os.environ["ENABLE_SLACK"] = "true"
os.environ["ENABLE_SPLUNK"] = "true"
os.environ["ENABLE_WEATHER"] = "true"
os.environ["ENABLE_WEBEX"] = "true"
os.environ["ENABLE_BACKSTAGE"] = "true"

# Dummy credentials for local MCP startup verification
os.environ["ARGOCD_TOKEN"] = "dummy_token"
os.environ["ARGOCD_API_URL"] = "https://argocd.example.com"
os.environ["ATLASSIAN_TOKEN"] = "dummy_token"
os.environ["ATLASSIAN_API_URL"] = "https://jira.example.com" 
os.environ["CONFLUENCE_API_URL"] = "https://confluence.example.com"
os.environ["KOMODOR_TOKEN"] = "dummy_token"
os.environ["KOMODOR_API_URL"] = "https://komodor.example.com"
os.environ["PAGERDUTY_API_KEY"] = "dummy_key"
os.environ["PAGERDUTY_API_URL"] = "https://api.pagerduty.com"
os.environ["SLACK_BOT_TOKEN"] = "xoxb-dummy"
os.environ["SLACK_TEAM_ID"] = "T123456"
os.environ["SPLUNK_TOKEN"] = "dummy_token"
os.environ["SPLUNK_API_URL"] = "https://splunk.example.com"
os.environ["WEATHER_MCP_API_URL"] = "https://weather.example.com"
os.environ["WEBEX_TOKEN"] = "dummy_token"
os.environ["BACKSTAGE_API_TOKEN"] = "dummy_token"
os.environ["BACKSTAGE_URL"] = "https://backstage.example.com"
os.environ["GITHUB_PERSONAL_ACCESS_TOKEN"] = "dummy_token"

os.environ["A2A_TRANSPORT"] = "p2p"

# Add project root to path
sys.path.append(os.getcwd())

async def main():
    logger.info("🧪 Starting Single Graph Mode Verification...")
    
    try:
        from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import AIPlatformEngineerMAS
        
        # Instantiate MAS
        mas = AIPlatformEngineerMAS()
        logger.info("✅ MAS Instantiated")
        
        # Initialize Graph (this triggers _inject_local_graphs)
        logger.info("🔄 Calling ensure_initialized()...")
        await mas.ensure_initialized()
        logger.info("✅ ensure_initialized() completed")
        
        # Get graph
        graph = mas.get_graph()
        
        if graph:
            logger.info("✅ Graph successfully built and retrieved")
        else:
            logger.error("❌ Graph is None!")
            return
            
        # Verify injection logic by checking logs (manually) or inspecting internal state if possible
        # Since we can't easily inspect the internal 'subagents' local to _build_graph, 
        # we strictly rely on the fact that ensure_initialized succeeded 
        # and checking the output logs for "Loading local graph for argocd"
        
        logger.info("🎉 Verification Script Complete.")
        
    except Exception as e:
        logger.error(f"❌ Verification Failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
