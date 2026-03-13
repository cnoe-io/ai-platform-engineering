# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AIGateway Tools for managing LLM access via LiteLLM with Vault-backed key storage."""

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx
from langchain_core.tools import tool

from ai_platform_engineering.agents.aigateway.agent_aigateway.vault_utils import (
  VaultAuthenticationError,
  VaultConnectionError,
  delete_user_key as vault_delete_user_key,
  retrieve_user_key as vault_retrieve_user_key,
  store_user_key as vault_store_user_key,
)

logger = logging.getLogger(__name__)

LITELLM_API_URL = os.getenv("LITELLM_API_URL") or os.getenv("LITELLM_PROXY_URL", "")
LITELLM_API_KEY = os.getenv("LITELLM_API_KEY") or os.getenv("LITELLM_MASTER_KEY", "")
WEBEX_TOKEN = os.getenv("WEBEX_TOKEN", "")
LITELLM_DOCS_URL = os.getenv("LITELLM_DOCS_URL", f"{LITELLM_API_URL}/")


def _vault_store(user_email: str, key: str, metadata: dict | None = None) -> bool:
  """Store a key in Vault. Returns True on success, False on failure."""
  try:
    return vault_store_user_key(user_email, key, metadata)
  except (VaultAuthenticationError, VaultConnectionError) as e:
    logger.error(f"Failed to store API key in Vault: {e}")
  except Exception as e:
    logger.error(f"Unexpected error storing API key in Vault for {user_email}: {e}")
  return False


def _vault_retrieve(user_email: str) -> Optional[dict]:
  """Retrieve a key from Vault. Returns None if not found or on error."""
  try:
    return vault_retrieve_user_key(user_email)
  except (VaultAuthenticationError, VaultConnectionError) as e:
    logger.warning(f"Vault not accessible: {e}. Falling back to API lookup.")
  except Exception as e:
    logger.warning(f"Error retrieving key from Vault for {user_email}: {e}")
  return None


def _vault_delete(user_email: str) -> bool:
  """Delete a key from Vault. Returns True on success, False on failure."""
  try:
    return vault_delete_user_key(user_email)
  except (VaultAuthenticationError, VaultConnectionError) as e:
    logger.error(f"Vault not accessible while deleting key for {user_email}: {e}")
  except Exception as e:
    logger.error(f"Error deleting key from Vault for {user_email}: {e}")
  return False


async def _send_webex_message(to_email: str, markdown: str) -> bool:
  """Send a Webex direct message. Returns True on success."""
  if not WEBEX_TOKEN:
    logger.warning("WEBEX_TOKEN not set — skipping Webex notification")
    return False

  MAX_WEBEX_LENGTH = 7439
  if len(markdown.encode("utf-8")) > MAX_WEBEX_LENGTH:
    truncation = "\n\n_Message truncated due to length._"
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


def _format_embedding_code_examples(base_url: str, model: str, api_key: str) -> str:
  """Build cURL and Python sample code blocks for embeddings."""
  s = "**Sample cURL:**\n```bash\n"
  s += f"curl -X POST '{base_url}/v1/embeddings' \\\n"
  s += f"  -H 'Authorization: Bearer {api_key}' \\\n"
  s += "  -H 'Content-Type: application/json' \\\n"
  s += f"  -d '{{\"model\": \"{model}\", \"input\": [\"test\"]}}'\n"
  s += "```\n\n"
  s += "**Python:**\n```python\n"
  s += "import openai\n"
  s += f"client = openai.OpenAI(api_key=\"{api_key}\", base_url=\"{base_url}\")\n"
  s += f"response = client.embeddings.create(model=\"{model}\", input=[\"test\"])\n"
  s += "```\n\n"
  return s


def _format_chat_code_examples(base_url: str, model: str, api_key: str) -> str:
  """Build cURL, Python OpenAI, and Python LangChain sample code blocks for chat completions."""
  s = "**Sample cURL:**\n```bash\n"
  s += f"curl -X POST '{base_url}/v1/chat/completions' \\\n"
  s += f"  -H 'Authorization: Bearer {api_key}' \\\n"
  s += "  -H 'Content-Type: application/json' \\\n"
  s += f"  -d '{{\"model\": \"{model}\", \"messages\": [{{\"role\": \"user\", \"content\": \"Hello\"}}]}}'\n"
  s += "```\n\n"
  s += "**Python OpenAI:**\n```python\n"
  s += "import openai\n\n"
  s += "client = openai.OpenAI(\n"
  s += f"    api_key=\"{api_key}\",\n"
  s += f"    base_url=\"{base_url}\"\n"
  s += ")\n"
  s += "response = client.chat.completions.create(\n"
  s += f"    model=\"{model}\",\n"
  s += "    messages=[{\"role\": \"user\", \"content\": \"tell me a joke\"}]\n"
  s += ")\n"
  s += "print(response.choices[0].message.content)\n"
  s += "```\n\n"
  s += "**Python LangChain:**\n```python\n"
  s += "from langchain_openai import ChatOpenAI\n"
  s += "from langchain_core.messages import HumanMessage\n\n"
  s += "chat = ChatOpenAI(\n"
  s += f"    openai_api_base=\"{base_url}\",\n"
  s += f"    openai_api_key=\"{api_key}\",\n"
  s += f"    model=\"{model}\"\n"
  s += ")\n"
  s += "response = chat.invoke([HumanMessage(content=\"tell me a joke\")])\n"
  s += "print(response.content)\n"
  s += "```\n\n"
  return s


def _build_webex_message(
  *,
  user_email: str,
  provider_name: str,
  model_name: str,
  full_model_name: str,
  api_key: str,
  models: list[str] | None = None,
  status: str = "created",
  user_max_budget: float = 100.0,
) -> str:
  """Build a deterministic Webex message with API key, curl, Python, and LangChain examples."""
  if status == "already_configured":
    header = "### LLM Access Request - Using Existing Key\n\n"
    header += f"You already have access to model `{full_model_name}`.\n\n"
  elif status == "model_added":
    header = "### LLM Access Request Successful - Model Added\n\n"
    header += f"New model `{full_model_name}` has been added to your existing key.\n\n"
  elif status == "key_regenerated":
    header = "### LLM Access Request Successful - Key Regenerated\n\n"
    header += "Your previous key was no longer valid and has been replaced with a new key.\n\n"
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
  msg += f"Budget: ${user_max_budget}/month (resets monthly)\n"
  msg += "_Note: Each user gets one virtual key. Budget resets monthly._\n\n"

  msg += "**Your API Key:**\n```\n" + api_key + "\n```\n\n"

  is_embedding = "embed" in model_name.lower()

  if is_embedding:
    msg += _format_embedding_code_examples(LITELLM_API_URL, full_model_name, api_key)
  else:
    msg += _format_chat_code_examples(LITELLM_API_URL, full_model_name, api_key)

  msg += f"For further instructions, see [LiteLLM Docs]({LITELLM_DOCS_URL})."
  return msg


def _validate_config() -> str | None:
  """Validate configuration and return error message if invalid."""
  if not LITELLM_API_URL:
    return "LiteLLM API URL not configured. Set LITELLM_API_URL or LITELLM_PROXY_URL environment variable."
  if not LITELLM_API_URL.startswith(("http://", "https://")):
    return f"LiteLLM API URL must start with http:// or https://, got: {LITELLM_API_URL}"
  return None


def _litellm_headers() -> dict:
  """Return standard LiteLLM API headers."""
  headers = {"Content-Type": "application/json"}
  if LITELLM_API_KEY:
    headers["Authorization"] = f"Bearer {LITELLM_API_KEY}"
  return headers


async def _list_models() -> dict:
  """Fetch available models from LiteLLM."""
  config_error = _validate_config()
  if config_error:
    logger.error(config_error)
    return {}

  async with httpx.AsyncClient() as client:
    response = await client.get(f"{LITELLM_API_URL}/v1/models", headers=_litellm_headers())
    if response.status_code != 200:
      logger.error(f"Failed to fetch models: {response.text}")
      return {}

    data = response.json()

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


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

async def _get_or_create_user(user_email: str, max_budget: float = 100.0) -> str | None:
  """Get or create a user in LiteLLM, preserving admin-set budgets."""
  headers = _litellm_headers()

  async with httpx.AsyncClient() as client:
    response = await client.get(
      f"{LITELLM_API_URL}/user/info",
      headers=headers,
      params={"user_id": user_email},
    )

    if response.status_code == 200:
      data = response.json()
      user_info = data.get("user_info", data)
      user_id = data.get("user_id", user_email)
      logger.info(f"User {user_email} already exists with id {user_id}")

      current_budget = user_info.get("max_budget") if user_info.get("max_budget") is not None else data.get("max_budget")
      if current_budget is None:
        await client.post(
          f"{LITELLM_API_URL}/user/update",
          headers=headers,
          json={"user_id": user_id, "max_budget": max_budget},
        )
        logger.info(f"Set initial max_budget for user {user_id} to ${max_budget}")
      else:
        logger.info(f"Preserving existing max_budget ${current_budget} for user {user_id}")
      return user_id

    username = user_email.split("@")[0] if "@" in user_email else user_email
    payload = {
      "user_id": user_email,
      "user_email": user_email,
      "max_budget": max_budget,
      "key_alias": username,
      "budget_duration": "1mo",
      "metadata": {"created_by": "platform_engineer_agent"},
    }

    response = await client.post(f"{LITELLM_API_URL}/user/new", headers=headers, json=payload)

    if response.status_code in [200, 201]:
      data = response.json()
      user_id = data.get("user_id", user_email)
      api_key = data.get("key") or data.get("api_key")

      if api_key:
        logger.info(f"Created user {user_id} with new API key")
        _vault_store(user_email, api_key, {"user_id": user_id})

      return user_id
    else:
      logger.error(f"Failed to create user: {response.text}")
      return None


async def _get_user_budget_info(user_email: str) -> dict:
  """Gets the user's budget information from LiteLLM."""
  headers = _litellm_headers()
  try:
    async with httpx.AsyncClient() as client:
      response = await client.get(
        f"{LITELLM_API_URL}/user/info",
        headers=headers,
        params={"user_id": user_email},
      )
      if response.status_code == 200:
        data = response.json()
        user_info = data.get("user_info", data)
        max_budget = user_info.get("max_budget") if user_info.get("max_budget") is not None else data.get("max_budget")
        return {
          "max_budget": max_budget,
          "spend": user_info.get("spend", data.get("spend", 0)),
          "budget_duration": user_info.get("budget_duration", data.get("budget_duration")),
          "budget_reset_at": user_info.get("budget_reset_at", data.get("budget_reset_at")),
        }
  except Exception as e:
    logger.warning(f"Error getting user budget info for {user_email}: {e}")
  return {}


# ---------------------------------------------------------------------------
# Key management (Vault-backed)
# ---------------------------------------------------------------------------

async def _get_existing_key(user_email: str, preserve_budget: dict | None = None) -> Optional[dict]:
  """
  Gets the existing key for a user.

  Checks Vault first (source of truth), then falls back to LiteLLM API.
  If a user exists in LiteLLM but not in Vault, the user is deleted and
  recreated with Vault storage. Budget is preserved.

  Args:
      user_email: User's email address
      preserve_budget: Optional dict to capture user's budget before migration deletion

  Returns:
      Key info dict or None
  """
  vault_has_key = False

  vault_data = _vault_retrieve(user_email)
  if vault_data and vault_data.get("key"):
    logger.info(f"Retrieved key for {user_email} from Vault")
    vault_has_key = True
    return {
      "key": vault_data["key"],
      "user_id": vault_data.get("user_id", user_email),
    }

  # Fallback to LiteLLM API
  headers = _litellm_headers()
  try:
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

      # Migration: legacy user in API but not in Vault
      if not vault_has_key:
        if preserve_budget is not None:
          budget_info = await _get_user_budget_info(user_email)
          if budget_info.get("max_budget") is not None:
            preserve_budget["max_budget"] = budget_info["max_budget"]
            logger.info(f"MIGRATION: Preserved budget ${preserve_budget['max_budget']} for {user_email}")

        logger.warning(f"MIGRATION: Legacy user {user_email} found without Vault storage. Deleting to enable Vault.")
        await _delete_user_from_litellm(user_email)
        logger.info(f"MIGRATION: Deleted legacy user {user_email}. Will be recreated with Vault storage.")
        return None

      if isinstance(key_info, str):
        return {"token": key_info}
      if isinstance(key_info, dict):
        return key_info

  except Exception as e:
    logger.warning(f"Error getting existing key for {user_email}: {e}")
  return None


async def _get_key_info(token: str) -> Optional[dict]:
  """Fetch key details (models, metadata) via /key/info."""
  headers = _litellm_headers()
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
    logger.warning("Key does not exist in LiteLLM (404). Cannot update models.")
    return {"key_not_found": True, "models": []}

  current_models = key_info.get("models") or []
  if new_model in current_models:
    logger.info(f"Model {new_model} already in key's models list")
    return {"models": current_models, "already_exists": True}

  updated_models = current_models + [new_model]
  headers = _litellm_headers()

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


async def _generate_key(user_id: str, user_email: str, models: list[str], max_budget: float = 100.0) -> dict:
  """Generate a virtual key for the user and store it in Vault."""
  headers = _litellm_headers()
  username = user_email.split("@")[0] if "@" in user_email else user_email

  payload = {
    "user_id": user_id,
    "key_alias": username,
    "models": models,
    "metadata": {
      "user_email": user_email,
      "key_name": username,
      "created_by": "platform_engineer_agent",
    },
  }

  async with httpx.AsyncClient() as client:
    response = await client.post(
      f"{LITELLM_API_URL}/key/generate",
      headers=headers,
      json=payload,
    )

    if response.status_code == 200:
      data = response.json()
      generated_key = data.get("key", "")

      if generated_key:
        _vault_store(user_email, generated_key, {"user_id": user_id})

      return data
    else:
      logger.error(f"Failed to generate key: {response.text}")
      return {"error": response.text}


async def _delete_user_keys_from_litellm(user_email: str) -> bool:
  """Deletes all keys for a user from LiteLLM (keeps the user account)."""
  headers = _litellm_headers()
  try:
    async with httpx.AsyncClient() as client:
      response = await client.get(
        f"{LITELLM_API_URL}/key/list",
        headers=headers,
        params={"user_id": user_email},
      )
      if response.status_code != 200:
        return False

      data = response.json()
      keys = data.get("keys", data.get("data", []))
      if not keys:
        return True

      key_values = []
      for key_info in keys:
        if isinstance(key_info, str):
          key_values.append(key_info)
        elif isinstance(key_info, dict):
          k = key_info.get("key") or key_info.get("token")
          if k:
            key_values.append(k)

      if not key_values:
        return True

      response = await client.post(
        f"{LITELLM_API_URL}/key/delete",
        headers=headers,
        json={"keys": key_values},
      )
      return response.status_code == 200
  except Exception as e:
    logger.error(f"Error deleting keys for user {user_email}: {e}")
    return False


async def _delete_user_from_litellm(user_email: str) -> bool:
  """Deletes a user from LiteLLM. Used for migrating legacy users to Vault storage."""
  headers = _litellm_headers()
  try:
    async with httpx.AsyncClient() as client:
      response = await client.post(
        f"{LITELLM_API_URL}/user/delete",
        headers=headers,
        json={"user_ids": [user_email]},
      )
      if response.status_code == 200:
        logger.info(f"Deleted user {user_email} from LiteLLM")
        return True
      return False
  except Exception as e:
    logger.error(f"Error deleting user {user_email}: {e}")
    return False


# ---------------------------------------------------------------------------
# Public Tools
# ---------------------------------------------------------------------------

@tool
async def create_llm_api_key(provider_name: str, model_name: str, user_email: str) -> str:
  """
  Create or update an LLM API key for a user.

  Supports multiple model selection via comma-separated model names from the same provider
  in a single request (e.g., "gpt-4o, gpt-4o-mini").

  Args:
      provider_name: LLM provider (e.g., openai, anthropic, bedrock)
      model_name: Model name (e.g., gpt-4o, claude-3-sonnet). Supports comma-separated values.
      user_email: User's corporate email address

  Returns:
      Result message with API key information.
  """
  try:
    config_error = _validate_config()
    if config_error:
      return f"**Configuration Error:** {config_error}"

    model_names = [m.strip().lower() for m in model_name.split(",") if m.strip()]
    provider_name = provider_name.lower()

    provider_model_map = await _list_models()

    if provider_name not in provider_model_map:
      available = ", ".join(provider_model_map.keys())
      return f"Provider '{provider_name}' not supported. Available providers: {available}"

    validated_models = []
    errors = []
    for m in model_names:
      if m not in provider_model_map[provider_name]:
        available = ", ".join(provider_model_map[provider_name])
        errors.append(f"Model '{m}' not available for {provider_name}. Available: {available}")
      else:
        full_name = f"{provider_name}/{m}"
        if full_name not in validated_models:
          validated_models.append(full_name)

    if not validated_models:
      return "\n".join(errors) if errors else "No valid models specified."

    primary_model = model_names[0]
    full_model_name = f"{provider_name}/{primary_model}"

    user_max_budget = 100.0
    preserved_budget: dict = {}
    initial_existing_key = await _get_existing_key(user_email, preserve_budget=preserved_budget)

    if preserved_budget.get("max_budget") is not None:
      user_max_budget = preserved_budget["max_budget"]

    user_id = await _get_or_create_user(user_email, max_budget=user_max_budget)
    if not user_id:
      return f"Failed to create/get user {user_email}"

    budget_info = await _get_user_budget_info(user_email)
    actual_budget = budget_info.get("max_budget")
    if actual_budget is not None:
      user_max_budget = actual_budget

    existing_key = await _get_existing_key(user_email)

    if existing_key:
      token = existing_key.get("key") or existing_key.get("token", "")
      if not token:
        logger.warning(f"Existing key found for {user_email} but no token available")
      else:
        all_models_result = {"models": [], "already_exists": False}
        key_not_found = False

        for vm in validated_models:
          update_result = await _update_key_models(token, vm)

          if update_result.get("key_not_found"):
            key_not_found = True
            break
          if update_result.get("error"):
            return f"Failed to update existing key: {update_result.get('message', 'Unknown error')}"

          all_models_result["models"] = update_result.get("models", [])
          if not update_result.get("already_exists"):
            all_models_result["already_exists"] = False

        if key_not_found:
          logger.warning(f"Stale key detected for {user_email}. Cleaning up and regenerating.")
          _vault_delete(user_email)
          await _delete_user_keys_from_litellm(user_email)
        else:
          models = all_models_result.get("models", [])
          all_already_existed = all(
            vm in (existing_key.get("models") or [])
            for vm in validated_models
          )
          status = "already_configured" if all_already_existed else "model_added"

          webex_msg = _build_webex_message(
            user_email=user_email, provider_name=provider_name,
            model_name=primary_model, full_model_name=full_model_name,
            api_key=token, models=models, status=status,
            user_max_budget=user_max_budget,
          )
          await _send_webex_message(user_email, webex_msg)

          if all_already_existed:
            return (
              f"You already have access to model(s) {', '.join(f'`{m}`' for m in validated_models)}. "
              f"All models on your key: {', '.join(f'`{m}`' for m in models)}. "
              f"Your API key and usage instructions have been sent to {user_email} via Webex."
            )
          else:
            return (
              f"Model(s) added to your existing API key. "
              f"All models on your key: {', '.join(f'`{m}`' for m in models)}. "
              f"Your API key and usage instructions have been sent to {user_email} via Webex."
            )

    key_response = await _generate_key(
      user_id=user_id,
      user_email=user_email,
      models=validated_models,
      max_budget=user_max_budget,
    )

    if "error" in key_response:
      return f"Failed to generate API key: {key_response['error']}"

    api_key = key_response.get("key", "")
    status = "key_regenerated" if initial_existing_key else "created"

    webex_msg = _build_webex_message(
      user_email=user_email, provider_name=provider_name,
      model_name=primary_model, full_model_name=full_model_name,
      api_key=api_key, models=validated_models, status=status,
      user_max_budget=user_max_budget,
    )
    await _send_webex_message(user_email, webex_msg)

    if errors:
      error_note = " Some models could not be added: " + "; ".join(errors)
    else:
      error_note = ""

    return (
      f"LLM API key for model(s) {', '.join(f'`{m}`' for m in validated_models)} has been created successfully. "
      f"Your API key and usage instructions have been sent to {user_email} via Webex.{error_note}"
    )

  except Exception as e:
    error_msg = f"Failed to create LLM API key: {e}"
    logger.error(error_msg)
    return error_msg


@tool
async def get_user_spend_activity(
  user_email: str,
  start_date: Optional[str] = None,
  end_date: Optional[str] = None,
  days_back: int = 7,
) -> str:
  """
  Get user's LLM usage and spending activity.

  Args:
      user_email: User's corporate email address
      start_date: Optional start date (YYYY-MM-DD format). Overrides days_back if provided.
      end_date: Optional end date (YYYY-MM-DD format). Defaults to today.
      days_back: Number of days to look back if start_date not provided. Default 7.

  Returns:
      User's usage statistics and spending breakdown.
  """
  try:
    config_error = _validate_config()
    if config_error:
      return f"**Configuration Error:** {config_error}"

    if not end_date:
      end_date = datetime.now().strftime("%Y-%m-%d")
    if not start_date:
      start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")

    headers = _litellm_headers()

    async with httpx.AsyncClient() as client:
      user_response = await client.get(
        f"{LITELLM_API_URL}/user/info",
        headers=headers,
        params={"user_id": user_email},
      )

      if user_response.status_code != 200:
        return f"User {user_email} not found. Please create an API key first."

      user_data = user_response.json()
      user_info = user_data.get("user_info", user_data)
      max_budget = user_info.get("max_budget", 100.0)
      current_spend = user_info.get("spend", 0)

      params: dict = {}
      if start_date:
        params["start_date"] = start_date
      if end_date:
        params["end_date"] = end_date

      activity_response = await client.get(
        f"{LITELLM_API_URL}/user/daily/activity",
        headers=headers,
        params=params,
      )

      budget_section = f"""## LLM Usage Report for {user_email}

### Budget Status
- **Max Budget**: ${max_budget}/month
- **Current Spend**: ${current_spend:.2f}
- **Remaining**: ${(max_budget - current_spend):.2f}
"""

      if activity_response.status_code != 200:
        return budget_section + "\n_Note: Detailed activity data not available._\n"

      activity_data = activity_response.json()
      results = activity_data.get("results", [])

      message = budget_section + "\n### Recent Activity\n"

      if not results:
        message += "\n_No activity recorded in the selected period._"
      else:
        total_requests = 0
        total_tokens = 0
        for day in results[:7]:
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
    error_msg = f"Failed to get user activity: {e}"
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
    error_msg = f"Failed to list models: {e}"
    logger.error(error_msg)
    return error_msg


@tool
async def rotate_llm_api_key(user_email: str, requesting_user_email: str) -> str:
  """
  Rotate (delete and regenerate) a user's LLM API key. The old key is revoked
  and a new key is generated, preserving the user's existing models and budget.
  The new key is sent via Webex.

  Only the key owner can rotate their own key. The requesting_user_email must
  match user_email.

  Args:
      user_email: The email of the user whose key should be rotated.
      requesting_user_email: The email of the authenticated user making the request.

  Returns:
      A message indicating the result of the key rotation.
  """
  try:
    config_error = _validate_config()
    if config_error:
      return f"**Configuration Error:** {config_error}"

    if requesting_user_email.lower() != user_email.lower():
      logger.warning(f"Unauthorized key rotation attempt: {requesting_user_email} tried to rotate key for {user_email}")
      return (
        f"Access denied. You ({requesting_user_email}) can only rotate your own LLM key. "
        f"You cannot rotate the key for {user_email}."
      )

    existing_key = await _get_existing_key(user_email)
    if not existing_key:
      return (
        f"No LLM key found for {user_email}. Nothing to rotate. "
        f"Please request a new key first by asking for LLM access."
      )

    api_key = existing_key.get("key") or existing_key.get("token", "")
    preserved_models: list[str] = []

    if api_key:
      key_info = await _get_key_info(api_key)
      if key_info:
        preserved_models = key_info.get("models") or []

    budget_info = await _get_user_budget_info(user_email)
    user_max_budget = budget_info.get("max_budget") or 100.0

    user_id = await _get_or_create_user(user_email, max_budget=user_max_budget)

    await _delete_user_keys_from_litellm(user_email)
    _vault_delete(user_email)

    if not preserved_models:
      preserved_models = ["openai/gpt-4o"]

    key_response = await _generate_key(
      user_id=user_id,
      user_email=user_email,
      models=preserved_models,
      max_budget=user_max_budget,
    )

    if key_response.get("error"):
      error_msg = key_response.get("message", key_response.get("error", "Unknown error"))
      logger.error(f"Failed to generate new key during rotation for {user_email}: {error_msg}")
      return (
        f"Failed to rotate LLM key for {user_email}. The old key was deleted but "
        f"a new key could not be generated. Please contact your administrator. "
        f"Error: {error_msg}"
      )

    new_api_key = key_response.get("key", "")

    message = "### LLM Key Rotated Successfully\n\n"
    message += "Your old LLM API key has been revoked and a new one has been generated.\n\n"
    message += "**Key Details:**\n"
    message += f"- Budget: ${user_max_budget}/month (resets monthly)\n"
    message += f"- Approved Models: {', '.join(preserved_models)}\n"
    message += f"- Base URL: {LITELLM_API_URL}\n\n"

    if new_api_key:
      message += "**Your NEW API Key:**\n```\n"
      message += f"{new_api_key}\n"
      message += "```\n\n"
      if preserved_models:
        message += _format_chat_code_examples(LITELLM_API_URL, preserved_models[0], new_api_key)
      message += "_Please update your applications with this new key. The old key is no longer valid._\n"
    else:
      message += "Could not retrieve the new API key. Please contact your administrator.\n"

    message += f"\nFor further instructions, see [LiteLLM Docs]({LITELLM_DOCS_URL})."

    await _send_webex_message(user_email, message)
    logger.info(f"Rotated LLM key for {user_email}, preserved {len(preserved_models)} model(s)")

    return f"LLM key for {user_email} has been rotated successfully. The new key and details have been sent via Webex."

  except Exception as e:
    error_msg = f"Failed to rotate LLM API key: {e}"
    logger.error(error_msg)
    return error_msg


@tool
async def add_litellm_user(
  user_email: str,
  max_budget: float = 100.0,
  models: Optional[str] = None,
) -> str:
  """
  Add a new user to LiteLLM and optionally generate an API key with specified models.

  If the user already exists, their information is returned without modification.
  If models are provided, an API key is generated and sent to the user via Webex.

  Args:
      user_email: User's corporate email address.
      max_budget: Monthly budget limit in USD. Default is 100.0.
      models: Optional comma-separated list of full model IDs to grant access to
              (e.g., "openai/gpt-4o, anthropic/claude-3-sonnet").

  Returns:
      Result message with user creation status and optional key information.
  """
  try:
    config_error = _validate_config()
    if config_error:
      return f"**Configuration Error:** {config_error}"

    user_id = await _get_or_create_user(user_email, max_budget=max_budget)
    if not user_id:
      return f"Failed to create user {user_email} in LiteLLM."

    if not models:
      return (
        f"User `{user_email}` has been added to LiteLLM successfully.\n"
        f"- User ID: `{user_id}`\n"
        f"- Budget: ${max_budget}/month\n\n"
        f"No models were specified, so no API key was generated. "
        f"Use the `create_llm_api_key` tool to grant model access and generate a key."
      )

    model_list = [m.strip() for m in models.split(",") if m.strip()]

    provider_model_map = await _list_models()
    validated_models: list[str] = []
    errors: list[str] = []

    for model_id in model_list:
      if "/" in model_id:
        provider, model_name = model_id.split("/", 1)
        provider = provider.lower()
        model_name = model_name.lower()
      else:
        errors.append(f"Model '{model_id}' must include provider prefix (e.g., 'openai/gpt-4o').")
        continue

      if provider not in provider_model_map:
        available = ", ".join(provider_model_map.keys())
        errors.append(f"Provider '{provider}' not found. Available: {available}")
      elif model_name not in provider_model_map[provider]:
        available = ", ".join(provider_model_map[provider])
        errors.append(f"Model '{model_name}' not available for {provider}. Available: {available}")
      else:
        full_name = f"{provider}/{model_name}"
        if full_name not in validated_models:
          validated_models.append(full_name)

    if not validated_models:
      error_detail = "\n".join(errors)
      return (
        f"User `{user_email}` was added but no API key was generated — "
        f"no valid models specified.\n\n{error_detail}"
      )

    key_response = await _generate_key(
      user_id=user_id,
      user_email=user_email,
      models=validated_models,
      max_budget=max_budget,
    )

    if "error" in key_response:
      return (
        f"User `{user_email}` was added but key generation failed: "
        f"{key_response['error']}"
      )

    api_key = key_response.get("key", "")
    primary_model = validated_models[0]
    provider_name = primary_model.split("/")[0]
    model_name_only = primary_model.split("/", 1)[1] if "/" in primary_model else primary_model

    webex_msg = _build_webex_message(
      user_email=user_email,
      provider_name=provider_name,
      model_name=model_name_only,
      full_model_name=primary_model,
      api_key=api_key,
      models=validated_models,
      status="created",
      user_max_budget=max_budget,
    )
    await _send_webex_message(user_email, webex_msg)

    error_note = ""
    if errors:
      error_note = "\n\nSome models could not be added:\n" + "\n".join(f"- {e}" for e in errors)

    return (
      f"User `{user_email}` has been added to LiteLLM with an API key.\n"
      f"- User ID: `{user_id}`\n"
      f"- Budget: ${max_budget}/month\n"
      f"- Models: {', '.join(f'`{m}`' for m in validated_models)}\n\n"
      f"API key and usage instructions have been sent to {user_email} via Webex.{error_note}"
    )

  except Exception as e:
    error_msg = f"Failed to add user to LiteLLM: {e}"
    logger.error(error_msg)
    return error_msg


@tool
async def add_bulk_litellm_users(
  user_emails: str,
  max_budget: float = 100.0,
  models: Optional[str] = None,
) -> str:
  """
  Add multiple users to LiteLLM in bulk. Optionally generate API keys with
  specified models for each user. Each user's key and instructions are sent
  via Webex individually.

  Args:
      user_emails: Comma-separated list of user email addresses.
      max_budget: Monthly budget limit in USD applied to all users. Default is 100.0.
      models: Optional comma-separated list of full model IDs to grant access to
              (e.g., "openai/gpt-4o, anthropic/claude-3-sonnet"). Applied to all users.

  Returns:
      Summary of bulk user creation results.
  """
  try:
    config_error = _validate_config()
    if config_error:
      return f"**Configuration Error:** {config_error}"

    emails = [e.strip() for e in user_emails.split(",") if e.strip()]
    if not emails:
      return "No valid email addresses provided."

    validated_models: list[str] = []
    model_errors: list[str] = []

    if models:
      model_list = [m.strip() for m in models.split(",") if m.strip()]
      provider_model_map = await _list_models()

      for model_id in model_list:
        if "/" in model_id:
          provider, model_name = model_id.split("/", 1)
          provider = provider.lower()
          model_name = model_name.lower()
        else:
          model_errors.append(f"Model '{model_id}' must include provider prefix (e.g., 'openai/gpt-4o').")
          continue

        if provider not in provider_model_map:
          available = ", ".join(provider_model_map.keys())
          model_errors.append(f"Provider '{provider}' not found. Available: {available}")
        elif model_name not in provider_model_map[provider]:
          available = ", ".join(provider_model_map[provider])
          model_errors.append(f"Model '{model_name}' not available for {provider}. Available: {available}")
        else:
          full_name = f"{provider}/{model_name}"
          if full_name not in validated_models:
            validated_models.append(full_name)

    succeeded: list[str] = []
    failed: list[tuple[str, str]] = []

    for email in emails:
      try:
        user_id = await _get_or_create_user(email, max_budget=max_budget)
        if not user_id:
          failed.append((email, "Failed to create user"))
          continue

        if validated_models:
          key_response = await _generate_key(
            user_id=user_id,
            user_email=email,
            models=validated_models,
            max_budget=max_budget,
          )

          if "error" in key_response:
            failed.append((email, f"User created but key generation failed: {key_response['error']}"))
            continue

          api_key = key_response.get("key", "")
          if api_key:
            primary_model = validated_models[0]
            provider_name = primary_model.split("/")[0]
            model_name_only = primary_model.split("/", 1)[1] if "/" in primary_model else primary_model

            webex_msg = _build_webex_message(
              user_email=email,
              provider_name=provider_name,
              model_name=model_name_only,
              full_model_name=primary_model,
              api_key=api_key,
              models=validated_models,
              status="created",
              user_max_budget=max_budget,
            )
            await _send_webex_message(email, webex_msg)

        succeeded.append(email)

      except Exception as e:
        failed.append((email, str(e)))

    message = "## Bulk User Addition Results\n\n"
    message += f"**Total:** {len(emails)} | **Succeeded:** {len(succeeded)} | **Failed:** {len(failed)}\n\n"

    if validated_models:
      message += f"**Models assigned:** {', '.join(f'`{m}`' for m in validated_models)}\n"
      message += f"**Budget:** ${max_budget}/month per user\n\n"
    else:
      message += f"**Budget:** ${max_budget}/month per user\n"
      message += "_No models specified — users were added without API keys._\n\n"

    if succeeded:
      message += "### Succeeded\n"
      for email in succeeded:
        message += f"- {email}\n"
      message += "\n"

    if failed:
      message += "### Failed\n"
      for email, reason in failed:
        message += f"- {email}: {reason}\n"
      message += "\n"

    if model_errors:
      message += "### Model Validation Warnings\n"
      for err in model_errors:
        message += f"- {err}\n"

    return message

  except Exception as e:
    error_msg = f"Failed to add bulk users: {e}"
    logger.error(error_msg)
    return error_msg


@tool
async def get_keys_for_multiple_users(user_emails: str) -> str:
  """
  Retrieve LLM API key status, model access, and budget information for
  multiple users. API key values are not included in the response for
  security — they are only sent to each user directly via Webex.

  Args:
      user_emails: Comma-separated list of user email addresses.

  Returns:
      Summary of key status and budget information for each user.
  """
  try:
    config_error = _validate_config()
    if config_error:
      return f"**Configuration Error:** {config_error}"

    emails = [e.strip() for e in user_emails.split(",") if e.strip()]
    if not emails:
      return "No valid email addresses provided."

    message = "## LLM API Key Report\n\n"
    found_count = 0
    not_found_count = 0

    for email in emails:
      try:
        existing_key = await _get_existing_key(email)
        if not existing_key:
          message += f"### {email}\n- **Status:** No key found\n\n"
          not_found_count += 1
          continue

        token = existing_key.get("key") or existing_key.get("token", "")
        models: list[str] = []

        if token:
          key_info = await _get_key_info(token)
          if key_info:
            models = key_info.get("models") or []

        budget_info = await _get_user_budget_info(email)

        message += f"### {email}\n"
        message += "- **Status:** Active\n"

        if models:
          message += f"- **Models:** {', '.join(f'`{m}`' for m in models)}\n"

        if budget_info:
          max_b = budget_info.get("max_budget")
          spend = budget_info.get("spend", 0)
          if max_b is not None:
            message += f"- **Budget:** ${max_b}/month\n"
            message += f"- **Spend:** ${spend:.2f}\n"
            message += f"- **Remaining:** ${(max_b - spend):.2f}\n"

        message += "\n"
        found_count += 1

      except Exception as e:
        message += f"### {email}\n- **Status:** Error — {e}\n\n"
        not_found_count += 1

    message += f"---\n**Summary:** {found_count} active key(s), {not_found_count} not found or errored.\n"

    return message

  except Exception as e:
    error_msg = f"Failed to retrieve keys for multiple users: {e}"
    logger.error(error_msg)
    return error_msg
