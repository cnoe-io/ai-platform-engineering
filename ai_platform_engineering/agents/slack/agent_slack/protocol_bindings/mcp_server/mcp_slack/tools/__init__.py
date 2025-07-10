from dotenv import load_dotenv
from pathlib import Path

# Get the correct path to the .env file
# channels.py is in agent-argocd/agent_slack/slack_mcp/tools/
# We need to go up 4 levels to get to agent-argocd
file_path = Path(__file__)
project_root = file_path.parent.parent.parent.parent.parent  # This should be agent-argocd
env_path = project_root / '.env'


# Load environment variables from .env file
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
    print("Loaded .env file")
else:
    print("WARNING: .env file not found at", env_path)
