import httpx
import json
import os
from enum import Enum


class BudgetDuration(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"

    def to_litellm_format(self) -> str:
        """Convert to LiteLLM duration format"""
        mapping = {
            self.DAILY: "1d",
            self.WEEKLY: "7d",
            self.MONTHLY: "30d",
            self.YEARLY: "365d",
        }
        return mapping[self]

    @classmethod
    def from_litellm_format(cls, litellm_duration: str) -> "BudgetDuration":
        """Convert from LiteLLM duration format to BudgetDuration"""
        mapping = {
            "1d": cls.DAILY,
            "7d": cls.WEEKLY,
            "30d": cls.MONTHLY,
            "365d": cls.YEARLY,
        }
        if litellm_duration not in mapping:
            raise ValueError(f"Unsupported LiteLLM duration format: {litellm_duration}")
        return mapping[litellm_duration]


# Configuration - these would need to be set from environment or config
LITELLM_PROXY_URL = os.getenv("LITELLM_PROXY_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-1234")


async def generate_key(
    user_id: str,
    team_id: str,
    model: str,
    budget: float = 50.0,
    duration: BudgetDuration = BudgetDuration.MONTHLY,
) -> str:
    """Generate a new API key in LiteLLM with budget and duration limits.

    Args:
        user_id: The user ID to associate with the key
        team_id: The team/project ID to associate with the key
        model: The model name (e.g. gpt-4o, mistral-small-latest, etc)
        budget: The budget limit for the key (defaults to 50, clamped to 0-100)
        duration: The budget duration - daily, weekly, monthly, yearly (defaults to monthly)

    Returns:
        JSON string with key generation result
    """

    # Clamp budget to 0-100 range
    budget = max(0.0, min(100.0, budget))

    # Prepare request body for LiteLLM /key/generate endpoint
    key_payload = {
        "user_id": user_id,
        "team_id": team_id,
        "models": [model],
        "max_budget": budget,
        "duration": duration.to_litellm_format(),
    }

    # Set headers
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
    }

    try:
        # Call the LiteLLM /key/generate endpoint
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{LITELLM_PROXY_URL}/key/generate", json=key_payload, headers=headers
            )

            if resp.status_code != 200:
                return json.dumps(
                    {
                        "success": False,
                        "error": f"API Error {resp.status_code}: {resp.text}",
                    },
                    indent=2,
                )

            key_response = resp.json()

            # Return the whole LiteLLM response
            return json.dumps({"success": True, "result": key_response}, indent=2)

    except Exception as e:
        return json.dumps(
            {"success": False, "error": f"Error generating key: {str(e)}"}, indent=2
        )
