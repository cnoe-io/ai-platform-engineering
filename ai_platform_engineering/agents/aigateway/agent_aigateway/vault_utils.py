# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Utility functions for HashiCorp Vault integration.

Provides secure storage and retrieval of LiteLLM API keys
using HashiCorp Vault KV secrets engine with AppRole authentication.
"""

import logging
import os
from typing import Optional

import hvac
from hvac.exceptions import InvalidPath, VaultError

logger = logging.getLogger(__name__)

VAULT_ADDR = os.getenv("VAULT_ADDR", "")
VAULT_ROLE_ID = os.getenv("VAULT_ROLE_ID", "")
VAULT_SECRET_ID = os.getenv("VAULT_SECRET_ID", "")
VAULT_NAMESPACE = os.getenv("VAULT_NAMESPACE", "")
VAULT_MOUNT_POINT = os.getenv("VAULT_MOUNT_POINT", "secret")
VAULT_APPROLE_PATH = os.getenv("VAULT_APPROLE_PATH", "approle")
VAULT_PATH_PREFIX = os.getenv(
  "VAULT_PATH_PREFIX",
  "projects/litellm/dev/jarvis-agent/litellm-keys",
)


class VaultAuthenticationError(Exception):
  """Raised when Vault authentication fails."""


class VaultConnectionError(Exception):
  """Raised when Vault connection fails."""


def _get_vault_client() -> hvac.Client:
  """
  Creates and returns an authenticated Vault client using AppRole authentication.

  Returns:
      hvac.Client: Authenticated Vault client

  Raises:
      VaultAuthenticationError: If AppRole credentials are missing or authentication fails
      VaultConnectionError: If Vault server is not accessible
  """
  if not VAULT_ADDR:
    raise VaultAuthenticationError(
      "VAULT_ADDR environment variable is not set. "
      "Cannot connect to HashiCorp Vault."
    )

  if not VAULT_ROLE_ID or not VAULT_SECRET_ID:
    raise VaultAuthenticationError(
      "VAULT_ROLE_ID and VAULT_SECRET_ID environment variables must be set. "
      "Cannot authenticate with HashiCorp Vault using AppRole."
    )

  try:
    client = hvac.Client(
      url=VAULT_ADDR,
      namespace=VAULT_NAMESPACE if VAULT_NAMESPACE else None,
    )

    try:
      auth_response = client.auth.approle.login(
        role_id=VAULT_ROLE_ID,
        secret_id=VAULT_SECRET_ID,
        mount_point=VAULT_APPROLE_PATH,
      )

      if not auth_response or "auth" not in auth_response:
        raise VaultAuthenticationError(
          "Vault AppRole authentication failed: Invalid response. "
          "Please verify your VAULT_ROLE_ID and VAULT_SECRET_ID."
        )

      logger.info(f"Successfully authenticated with Vault at {VAULT_ADDR}")

    except VaultAuthenticationError:
      raise
    except Exception as auth_error:
      raise VaultAuthenticationError(
        f"Vault AppRole authentication failed: {auth_error}. "
        f"Please verify your VAULT_ROLE_ID and VAULT_SECRET_ID."
      )

    if not client.is_authenticated():
      raise VaultAuthenticationError(
        "Vault authentication check failed after AppRole login."
      )

    return client

  except VaultAuthenticationError:
    raise
  except ConnectionError as e:
    raise VaultConnectionError(
      f"Cannot connect to Vault at {VAULT_ADDR}: {e}. "
      f"Please verify Vault is running and accessible."
    )
  except Exception as e:
    raise VaultConnectionError(
      f"Failed to create Vault client: {e}."
    )


def store_user_key(user_email: str, key: str, metadata: Optional[dict] = None) -> bool:
  """
  Stores a user's LiteLLM API key in HashiCorp Vault.

  The key is stored at: {VAULT_PATH_PREFIX}/{sanitized_email}

  Args:
      user_email: User's email address (used as the secret path key)
      key: The LiteLLM API key to store
      metadata: Additional metadata to store with the key

  Returns:
      True if successfully stored

  Raises:
      VaultAuthenticationError: If Vault authentication fails
      VaultConnectionError: If Vault is not accessible
  """
  if not key:
    logger.error(f"Cannot store empty API key for user {user_email}")
    return False

  try:
    client = _get_vault_client()

    safe_email = user_email.replace("@", "-").replace(".", "-")
    secret_path = f"{VAULT_PATH_PREFIX}/{safe_email}"

    secret_data = {"key": key}
    if metadata:
      secret_data.update(metadata)

    client.secrets.kv.v2.create_or_update_secret(
      path=secret_path,
      secret=secret_data,
      mount_point=VAULT_MOUNT_POINT,
    )
    logger.info(f"Stored API key for {user_email} in Vault at {secret_path}")
    return True

  except (VaultAuthenticationError, VaultConnectionError):
    logger.error(f"Vault not accessible while storing key for {user_email}")
    raise
  except VaultError as e:
    error_msg = f"Vault error storing key for {user_email}: {e}"
    logger.error(error_msg)
    raise VaultError(error_msg)
  except Exception as e:
    error_msg = f"Unexpected error storing key for {user_email}: {e}"
    logger.error(error_msg)
    raise RuntimeError(error_msg)


def retrieve_user_key(user_email: str) -> Optional[dict]:
  """
  Retrieves a user's LiteLLM API key from HashiCorp Vault.

  Args:
      user_email: User's email address

  Returns:
      Dictionary containing 'key' and metadata if found, None if not found

  Raises:
      VaultAuthenticationError: If Vault authentication fails
      VaultConnectionError: If Vault is not accessible
  """
  try:
    client = _get_vault_client()

    safe_email = user_email.replace("@", "-").replace(".", "-")
    secret_path = f"{VAULT_PATH_PREFIX}/{safe_email}"

    secret_version = client.secrets.kv.v2.read_secret_version(
      path=secret_path,
      mount_point=VAULT_MOUNT_POINT,
    )
    secret_data = secret_version.get("data", {}).get("data", {})

    if secret_data and "key" in secret_data:
      logger.info(f"Retrieved API key for {user_email} from Vault")
      return secret_data

    return None

  except InvalidPath:
    logger.info(f"No API key found in Vault for {user_email}")
    return None
  except (VaultAuthenticationError, VaultConnectionError):
    logger.error(f"Vault not accessible while retrieving key for {user_email}")
    raise
  except VaultError as e:
    error_msg = f"Vault error retrieving key for {user_email}: {e}"
    logger.error(error_msg)
    raise VaultError(error_msg)
  except Exception as e:
    error_msg = f"Unexpected error retrieving key for {user_email}: {e}"
    logger.error(error_msg)
    raise RuntimeError(error_msg)


def delete_user_key(user_email: str) -> bool:
  """
  Deletes a user's LiteLLM API key from HashiCorp Vault.

  Args:
      user_email: User's email address

  Returns:
      True if successfully deleted, False if key not found

  Raises:
      VaultAuthenticationError: If Vault authentication fails
      VaultConnectionError: If Vault is not accessible
  """
  try:
    client = _get_vault_client()

    safe_email = user_email.replace("@", "-").replace(".", "-")
    secret_path = f"{VAULT_PATH_PREFIX}/{safe_email}"

    client.secrets.kv.v2.delete_latest_version_of_secret(
      path=secret_path,
      mount_point=VAULT_MOUNT_POINT,
    )
    logger.info(f"Deleted API key for {user_email} from Vault")
    return True

  except InvalidPath:
    logger.warning(f"No API key found to delete for {user_email}")
    return False
  except (VaultAuthenticationError, VaultConnectionError):
    logger.error(f"Vault not accessible while deleting key for {user_email}")
    raise
  except VaultError as e:
    error_msg = f"Vault error deleting key for {user_email}: {e}"
    logger.error(error_msg)
    raise VaultError(error_msg)
  except Exception as e:
    error_msg = f"Unexpected error deleting key for {user_email}: {e}"
    logger.error(error_msg)
    raise RuntimeError(error_msg)


def check_vault_health() -> bool:
  """
  Checks if Vault is accessible and properly configured.

  Returns:
      True if Vault is healthy and accessible

  Raises:
      VaultAuthenticationError: If Vault authentication fails
      VaultConnectionError: If Vault is not accessible
  """
  try:
    client = _get_vault_client()
    health = client.sys.read_health_status()

    if health:
      logger.info(f"Vault health check passed: {health}")
      return True

    raise VaultConnectionError("Vault health check returned empty response")

  except (VaultAuthenticationError, VaultConnectionError):
    raise
  except Exception as e:
    error_msg = f"Vault health check failed: {e}"
    logger.error(error_msg)
    raise VaultConnectionError(error_msg)
