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
# Support both naming conventions for flexibility
LITELLM_API_URL = os.getenv("LITELLM_API_URL") or os.getenv("LITELLM_PROXY_URL", "")
LITELLM_API_KEY = os.getenv("LITELLM_API_KEY") or os.getenv("LITELLM_MASTER_KEY", "")
WEBEX_TOKEN = os.getenv("WEBEX_TOKEN", "")
LITELLM_DOCS_URL = os.getenv("LITELLM_DOCS_URL", f"{LITELLM_API_URL}/")


async def _send_webex_message(to_email: str, markdown: str) -> bool:
    """Send a Webex direct message. Returns True on success."""
    if not WEBEX_TOKEN:
        logger.warning("WEBEX_TOKEN not set — skipping Webex notification")
        return False

    MAX_WEBEX_LENGTH = 7439
    if len(markdown.encode("utf-8")) > MAX_WEBEX_LENGTH:
        truncation = "\n\n⚠️ _Message truncated due to length._"
        max_len = MAX_WEBEX_LENGTH - len(truncation.encode("utf-8"))
        markdown = markdown.encode("utf-8")[:max_len].decode("utf-8", errors="ignore") + truncation

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                "https://webexapis.com/v1/messages",
                headers={"Authorization": f"Bearer {WEBEX_TOKEN}", "Content-Type": "application/json"},
                json={"toPersonEmail": to_email, "markdown": markdown},
            )
            if resp.status_code < 300:
                logger.info(f"Webex message sent to {to_email}")
                return True
            logger.error(f"Webex send failed ({resp.status_code}): {resp.text}")
        except Exception as e:
            logger.error(f"Webex send error: {e}")
    return False


def _build_webex_message(
    *,
    user_email: str,
    provider_name: str,
    model_name: str,
    full_model_name: str,
    api_key: str,
    models: list[str] | None = None,
    status: str = "created",
) -> str:
    """Build a deterministic Webex message with API key, curl, and Python examples."""
    if status == "already_configured":
        header = "### LLM Access Request - Using Existing Key\n\n"
        header += f"✅ **You already have access to model `{full_model_name}`.**\n\n"
    elif status == "model_added":
        header = "### LLM Access Request Successful - Model Added\n\n"
        header += f"✅ **New model `{full_model_name}` has been added to your existing key.**\n\n"
    else:
        header = "### LLM Access Request Successful - New Key Created\n\n"

    msg = header
    msg += f"User ID: {user_email}\n"
    msg += f"Provider: {provider_name}\n"
    msg += f"Model: {model_name}\n"
    msg += f"Full Model ID: {full_model_name}\n"
    msg += f"Base URL: {LITELLM_API_URL}\n\n"

    if models:
        msg += f"Approved Models: {', '.join(models)}\n"
    msg += "Budget: $100/month (resets monthly)\n"
    msg += "_Note: Each user gets one virtual key. Budget resets monthly._\n\n"

    msg += "**🔑 Your API Key:**\n```\n" + api_key + "\n```\n\n"

    is_embedding = "embed" in model_name.lower()

    if is_embedding:
        msg += "**Sample cURL:**\n```bash\n"
        msg += f"curl -X POST '{LITELLM_API_URL}/v1/embeddings' \\\n"
        msg += f"  -H 'Authorization: Bearer {api_key}' \\\n"
        msg += "  -H 'Content-Type: application/json' \\\n"
        msg += f"  -d '{{\"model\": \"{full_model_name}\", \"input\": [\"test\"]}}'\n"
        msg += "```\n\n"
        msg += "**Python:**\n```python\n"
        msg += "import openai\n"
        msg += f"client = openai.OpenAI(api_key=\"{api_key}\", base_url=\"{LITELLM_API_URL}\")\n"
        msg += f"response = client.embeddings.create(model=\"{full_model_name}\", input=[\"test\"])\n"
        msg += "```\n\n"
    else:
        msg += "**Sample cURL:**\n```bash\n"
        msg += f"curl -X POST '{LITELLM_API_URL}/v1/chat/completions' \\\n"
        msg += f"  -H 'Authorization: Bearer {api_key}' \\\n"
        msg += "  -H 'Content-Type: application/json' \\\n"
        msg += f"  -d '{{\"model\": \"{full_model_name}\", \"messages\": [{{\"role\": \"user\", \"content\": \"Hello\"}}]}}'\n"
        msg += "```\n\n"
        msg += "**Python:**\n```python\n"
        msg += "import openai\n\n"
        msg += "client = openai.OpenAI(\n"
        msg += f"    api_key=\"{api_key}\",\n"
        msg += f"    base_url=\"{LITELLM_API_URL}\"\n"
        msg += ")\n"
        msg += "response = client.chat.completions.create(\n"
        msg += f"    model=\"{full_model_name}\",\n"
        msg += "    messages=[{\"role\": \"user\", \"content\": \"Hello\"}]\n"
        msg += ")\n"
        msg += "print(response.choices[0].message.content)\n"
        msg += "```\n\n"

    msg += f"For further instructions, see [LiteLLM Docs]({LITELLM_DOCS_URL})."
    return msg


def _validate_config() -> str | None:
    """Validate configuration and return error message if invalid."""
    if not LITELLM_API_URL:
        return "LiteLLM API URL not configured. Set LITELLM_API_URL or LITELLM_PROXY_URL environment variable."
    if not LITELLM_API_URL.startswith(("http://", "https://")):
        return f"LiteLLM API URL must start with http:// or https://, got: {LITELLM_API_URL}"
    return None


async def _list_models() -> dict:
    """Fetch available models from LiteLLM."""
    config_error = _validate_config()
    if config_error:
        logger.error(config_error)
        return {}
    
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


async def _get_existing_key(user_email: str) -> Optional[dict]:
    """Look up existing keys for a user via /key/list."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_API_KEY}",
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{LITELLM_API_URL}/key/list",
            headers=headers,
            params={"user_id": user_email},
        )
        if response.status_code != 200:
            logger.warning(f"Failed to list keys for {user_email}: {response.text}")
            return None

        data = response.json()
        keys = data.get("keys", data.get("data", []))
        if not keys:
            return None

        key_info = keys[0]
        if isinstance(key_info, str):
            return {"token": key_info}
        if isinstance(key_info, dict):
            return key_info
    return None


async def _get_key_info(token: str) -> Optional[dict]:
    """Fetch key details (models, metadata) via /key/info."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_API_KEY}",
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{LITELLM_API_URL}/key/info",
            headers=headers,
            params={"key": token},
        )
        if response.status_code != 200:
            logger.warning(f"Could not get key info: {response.text}")
            return None

        data = response.json()
        return data.get("info", data)


async def _update_key_models(token: str, new_model: str) -> dict:
    """Add a model to an existing key's allowed models list."""
    key_info = await _get_key_info(token)
    if key_info is None:
        logger.warning("Key not found in LiteLLM, cannot update models")
        return {"key_not_found": True}

    current_models = key_info.get("models") or []
    if new_model in current_models:
        logger.info(f"Model {new_model} already in key's models list")
        return {"models": current_models, "already_exists": True}

    updated_models = current_models + [new_model]
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_API_KEY}",
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{LITELLM_API_URL}/key/update",
            headers=headers,
            json={"key": token, "models": updated_models},
        )

        if response.status_code != 200:
            logger.error(f"Error updating key models: {response.text}")
            return {"error": True, "message": response.text}

    logger.info(f"Added model {new_model} to key. Total models: {len(updated_models)}")
    return {"models": updated_models, "model_added": new_model}


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
        # Validate configuration
        config_error = _validate_config()
        if config_error:
            return f"**Configuration Error:** {config_error}"
        
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
        
        # Check for existing key before generating
        existing_key = await _get_existing_key(user_email)
        
        if existing_key:
            token = existing_key.get("token") or existing_key.get("key", "")
            if not token:
                logger.warning(f"Existing key found for {user_email} but no token available")
            else:
                update_result = await _update_key_models(token, full_model_name)
                
                if update_result.get("key_not_found"):
                    logger.warning(f"Existing key for {user_email} is stale, generating new key")
                elif update_result.get("error"):
                    return f"Failed to update existing key: {update_result.get('message', 'Unknown error')}"
                elif update_result.get("already_exists"):
                    models = update_result.get("models", [])
                    webex_msg = _build_webex_message(
                        user_email=user_email, provider_name=provider_name,
                        model_name=model_name, full_model_name=full_model_name,
                        api_key=token, models=models, status="already_configured",
                    )
                    await _send_webex_message(user_email, webex_msg)
                    return (
                        f"You already have access to model `{full_model_name}`. "
                        f"All models on your key: {', '.join(f'`{m}`' for m in models)}. "
                        f"Your API key and usage instructions have been sent to {user_email} via Webex."
                    )
                else:
                    models = update_result.get("models", [])
                    webex_msg = _build_webex_message(
                        user_email=user_email, provider_name=provider_name,
                        model_name=model_name, full_model_name=full_model_name,
                        api_key=token, models=models, status="model_added",
                    )
                    await _send_webex_message(user_email, webex_msg)
                    return (
                        f"Model `{full_model_name}` has been added to your existing API key. "
                        f"All models on your key: {', '.join(f'`{m}`' for m in models)}. "
                        f"Your API key and usage instructions have been sent to {user_email} via Webex."
                    )
        
        # No existing key or stale key — generate new
        key_response = await _generate_key(
            user_id=user_id,
            user_email=user_email,
            models=[full_model_name],
            max_budget=100.0
        )
        
        if "error" in key_response:
            return f"Failed to generate API key: {key_response['error']}"
        
        api_key = key_response.get("key", "")
        
        webex_msg = _build_webex_message(
            user_email=user_email, provider_name=provider_name,
            model_name=model_name, full_model_name=full_model_name,
            api_key=api_key, models=[full_model_name], status="created",
        )
        await _send_webex_message(user_email, webex_msg)
        return (
            f"LLM API key for model `{full_model_name}` has been created successfully. "
            f"Your API key and usage instructions have been sent to {user_email} via Webex."
        )
        
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
        # Validate configuration
        config_error = _validate_config()
        if config_error:
            return f"**Configuration Error:** {config_error}"
        
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
        # Validate configuration
        config_error = _validate_config()
        if config_error:
            return f"**Configuration Error:** {config_error}"
        
        provider_model_map = await _list_models()
        
        if not provider_model_map:
            return "No models available or unable to fetch model list. Check LiteLLM service status."
        
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
