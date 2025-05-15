# debug_client.py

import os
from dotenv import load_dotenv

from agent_slack.slack_mcp.tools import messages

# Load environment variables
load_dotenv()

# Prepare environment dictionary
env = {
    "SLACK_BOT_TOKEN": os.getenv("SLACK_BOT_TOKEN"),
    "SLACK_APP_TOKEN": os.getenv("SLACK_APP_TOKEN"),
    "SLACK_SIGNING_SECRET": os.getenv("SLACK_SIGNING_SECRET"),
    "SLACK_CLIENT_SECRET": os.getenv("SLACK_CLIENT_SECRET"),
    "SLACK_TEAM_ID": os.getenv("SLACK_TEAM_ID"),
}

# Check if token is valid before proceeding
if not env["SLACK_BOT_TOKEN"]:
    print("❌ SLACK_BOT_TOKEN not set in environment.")
    exit(1)

# Call send_message directly
response = messages.send_message(
    channel_id="C08RQPSH4KD",
    text="✅ Message from direct tool call in debug_client.py",
    env=env
)

# Print the result
print("🟢 Tool Response:", response)
