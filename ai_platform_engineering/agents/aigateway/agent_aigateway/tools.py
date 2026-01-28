# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AIGateway Tools for managing LLM access via LiteLLM."""

import logging
import os
from typing import Optional

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# Configuration - set these environment variables
LITELLM_API_URL = os.getenv("LITELLM_API_URL", "")
LITELLM_API_KEY = os.getenv("LITELLM_API_KEY", "")


async def _list_models() -> dict:
    """Fetch available models from LiteLLM."""
    headers = {"Content-Type": "application/json"}
    if LITELLM_API_KEY:
        headers["Authorization"] = f"Bearer {LITELLM_API_KEY}"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{LITELLM_API_URL}/v1/models", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to fetch models: {response.text}")
            return {}
        
        data = response.json()
    
    # Parse provider/model map
    provider_model_map: dict[str, list[str]] = {}
    if "data" in data:
        for model_obj in data["data"]:
            model_id = model_obj.get("id", "")
            if not model_id:
                continue
            
            if "/" in model_id:
                provider, model_name = model_id.split("/", 1)
            else:
                model_name = model_id.lower()
                if model_name.startswith("gpt"):
                    provider = "openai"
                elif model_name.startswith("claude"):
                    provider = "anthropic"
                else:
                    provider = "unknown"
            
            provider = provider.lower()
            model_name = model_name.lower()
            
            if provider not in provider_model_map:
                provider_model_map[provider] = []
            if model_name not in provider_model_map[provider]:
                provider_model_map[provider].append(model_name)
    
    return provider_model_map


async def _get_or_create_user(user_email: str, max_budget: float = 100.0) -> str:
    """Get or create a user in LiteLLM."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_API_KEY}",
    }
    
    async with httpx.AsyncClient() as client:
        # Check if user exists
        response = await client.get(
            f"{LITELLM_API_URL}/user/info",
            headers=headers,
            params={"user_id": user_email}
        )
        
        if response.status_code == 200:
            data = response.json()
            user_id = data.get("user_id", user_email)
            logger.info(f"User {user_email} already exists")
            return user_id
        
        # Create new user
        username = user_email.split("@")[0] if "@" in user_email else user_email
        payload = {
            "user_id": user_email,
            "user_email": user_email,
            "max_budget": max_budget,
            "key_alias": username,
            "budget_duration": "1mo",
            "metadata": {"created_by": "platform_engineer_agent"},
        }
        
        response = await client.post(
            f"{LITELLM_API_URL}/user/new",
            headers=headers,
            json=payload
        )
        
        if response.status_code in [200, 201]:
            data = response.json()
            return data.get("user_id", user_email)
        else:
            logger.error(f"Failed to create user: {response.text}")
            return None


async def _generate_key(user_id: str, user_email: str, models: list[str], max_budget: float) -> dict:
    """Generate a virtual key for the user."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_API_KEY}",
    }
    
    username = user_email.split("@")[0] if "@" in user_email else user_email
    
    payload = {
        "user_id": user_id,
        "key_alias": username,
        "models": models,
        "max_budget": max_budget,
        "budget_duration": "1mo",
        "duration": "30d",
        "metadata": {
            "user_email": user_email,
            "created_by": "platform_engineer_agent",
        },
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{LITELLM_API_URL}/key/generate",
            headers=headers,
            json=payload
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            logger.error(f"Failed to generate key: {response.text}")
            return {"error": response.text}


@tool
async def create_llm_api_key(provider_name: str, model_name: str, user_email: str) -> str:
    """
    Create or update an LLM API key for a user.
    
    Args:
        provider_name: LLM provider (e.g., openai, anthropic, bedrock)
        model_name: Model name (e.g., gpt-4o, claude-3-sonnet)
        user_email: User's corporate email address
    
    Returns:
        Result message with API key information.
    """
    try:
        # Validate provider and model
        provider_model_map = await _list_models()
        
        provider_name = provider_name.lower()
        model_name = model_name.lower()
        
        if provider_name not in provider_model_map:
            available = ", ".join(provider_model_map.keys())
            return f"Provider '{provider_name}' not supported. Available providers: {available}"
        
        if model_name not in provider_model_map[provider_name]:
            available = ", ".join(provider_model_map[provider_name])
            return f"Model '{model_name}' not available for {provider_name}. Available models: {available}"
        
        full_model_name = f"{provider_name}/{model_name}"
        
        # Get or create user
        user_id = await _get_or_create_user(user_email)
        if not user_id:
            return f"Failed to create/get user {user_email}"
        
        # Generate key
        key_response = await _generate_key(
            user_id=user_id,
            user_email=user_email,
            models=[full_model_name],
            max_budget=100.0
        )
        
        if "error" in key_response:
            return f"Failed to generate API key: {key_response['error']}"
        
        api_key = key_response.get("key", "")
        
        # Format response
        message = f"""## LLM Access Created Successfully

**User**: {user_email}
**Provider**: {provider_name}
**Model**: {model_name}
**Full Model ID**: {full_model_name}
**Base URL**: {LITELLM_API_URL}

**API Key**: `{api_key}`

### Usage Example (Python)

```python
import openai

client = openai.OpenAI(
    api_key="{api_key}",
    base_url="{LITELLM_API_URL}"
)

response = client.chat.completions.create(
    model="{full_model_name}",
    messages=[{{"role": "user", "content": "Hello!"}}]
)
print(response.choices[0].message.content)
```

**Budget**: $100/month (resets monthly)
"""
        return message
        
    except Exception as e:
        error_msg = f"Failed to create LLM API key: {str(e)}"
        logger.error(error_msg)
        return error_msg


@tool
async def get_user_spend_activity(user_email: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> str:
    """
    Get user's LLM usage and spending activity.
    
    Args:
        user_email: User's corporate email address
        start_date: Optional start date (YYYY-MM-DD format)
        end_date: Optional end date (YYYY-MM-DD format)
    
    Returns:
        User's usage statistics and spending breakdown.
    """
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LITELLM_API_KEY}",
        }
        
        async with httpx.AsyncClient() as client:
            # Get user info for budget
            user_response = await client.get(
                f"{LITELLM_API_URL}/user/info",
                headers=headers,
                params={"user_id": user_email}
            )
            
            if user_response.status_code != 200:
                return f"User {user_email} not found. Please create an API key first."
            
            user_data = user_response.json()
            user_info = user_data.get("user_info", user_data)
            max_budget = user_info.get("max_budget", 100.0)
            current_spend = user_info.get("spend", 0)
            
            # Get activity data
            params = {}
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            
            activity_response = await client.get(
                f"{LITELLM_API_URL}/user/daily/activity",
                headers=headers,
                params=params
            )
            
            if activity_response.status_code != 200:
                return f"""## User Budget Status

**User**: {user_email}
**Max Budget**: ${max_budget}/month
**Current Spend**: ${current_spend:.2f}
**Remaining**: ${(max_budget - current_spend):.2f}

_Note: Detailed activity data not available._
"""
            
            activity_data = activity_response.json()
            results = activity_data.get("results", [])
            
            # Format response
            message = f"""## LLM Usage Report for {user_email}

### Budget Status
- **Max Budget**: ${max_budget}/month
- **Current Spend**: ${current_spend:.2f}
- **Remaining**: ${(max_budget - current_spend):.2f}

### Recent Activity
"""
            
            if not results:
                message += "\n_No activity recorded in the selected period._"
            else:
                total_requests = 0
                total_tokens = 0
                for day in results[:7]:  # Last 7 days
                    date = day.get("date", "unknown")
                    metrics = day.get("metrics", {})
                    requests = metrics.get("api_requests", 0)
                    tokens = metrics.get("prompt_tokens", 0) + metrics.get("completion_tokens", 0)
                    spend = metrics.get("spend", 0)
                    
                    total_requests += requests
                    total_tokens += tokens
                    
                    if requests > 0:
                        message += f"\n- **{date}**: {requests} requests, {tokens:,} tokens, ${spend:.4f}"
                
                message += f"""

### Summary
- **Total Requests**: {total_requests:,}
- **Total Tokens**: {total_tokens:,}
"""
            
            return message
            
    except Exception as e:
        error_msg = f"Failed to get user activity: {str(e)}"
        logger.error(error_msg)
        return error_msg


@tool
async def list_available_models() -> str:
    """
    List all available LLM providers and models.
    
    Returns:
        Formatted list of available providers and their models.
    """
    try:
        provider_model_map = await _list_models()
        
        if not provider_model_map:
            return "No models available or unable to fetch model list."
        
        message = "## Available LLM Models\n\n"
        
        for provider, models in sorted(provider_model_map.items()):
            message += f"### {provider.title()}\n"
            for model in sorted(models):
                message += f"- `{provider}/{model}`\n"
            message += "\n"
        
        message += """### Usage Notes
- Use the full model ID (e.g., `openai/gpt-4o`) when making API calls
- Contact admin for access to restricted models
- Default budget is $100/month per user
"""
        
        return message
        
    except Exception as e:
        error_msg = f"Failed to list models: {str(e)}"
        logger.error(error_msg)
        return error_msg
