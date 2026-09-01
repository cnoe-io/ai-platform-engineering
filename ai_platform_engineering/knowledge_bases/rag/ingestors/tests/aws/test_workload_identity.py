from __future__ import annotations

import importlib
import os
from pathlib import Path
from unittest.mock import patch

import pytest


BASE_ENV = {
  "AWS_ACCOUNT_LIST": "dev:111111111111,prod:222222222222",
  "AWS_REGION": "us-east-2",
}


def _load_ingestor(env: dict[str, str] | None = None):
  merged_env = {**BASE_ENV, **(env or {})}
  with patch.dict(os.environ, merged_env, clear=True):
    import ingestors.aws.ingestor as mod

    return importlib.reload(mod)


def _generated_config(mod, tmp_path: Path, env: dict[str, str] | None = None) -> str:
  merged_env = {**BASE_ENV, **(env or {})}
  config_dir = tmp_path / "aws-config"
  config_dir.mkdir()
  with (
    patch.dict(os.environ, merged_env, clear=True),
    patch.object(mod.tempfile, "mkdtemp", return_value=str(config_dir)),
  ):
    mod.setup_aws_profiles(mod.parse_account_list())
    return (config_dir / "config").read_text()


def test_profiles_preserve_environment_credentials_fallback(tmp_path):
  mod = _load_ingestor()

  config = _generated_config(mod, tmp_path)

  assert config.count("credential_source = Environment") == 2


def test_profiles_auto_detect_eks_pod_identity(tmp_path):
  env = {"AWS_CONTAINER_CREDENTIALS_FULL_URI": "http://169.254.170.23/v1/credentials"}
  mod = _load_ingestor(env)

  config = _generated_config(mod, tmp_path, env)

  assert config.count("credential_source = EcsContainer") == 2
  assert "AWS_ACCESS_KEY_ID" not in config


def test_profiles_chain_through_irsa_web_identity(tmp_path):
  env = {
    "AWS_ROLE_ARN": "arn:aws:iam::111111111111:role/rag-ingestor",
    "AWS_WEB_IDENTITY_TOKEN_FILE": "/var/run/secrets/eks.amazonaws.com/serviceaccount/token",
  }
  mod = _load_ingestor(env)

  config = _generated_config(mod, tmp_path, env)

  assert "[profile rag-workload-identity]" in config
  assert "role_arn = arn:aws:iam::111111111111:role/rag-ingestor" in config
  assert "web_identity_token_file = /var/run/secrets/eks.amazonaws.com/serviceaccount/token" in config
  assert config.count("source_profile = rag-workload-identity") == 2
  assert "credential_source" not in config


def test_explicit_credential_source_override(tmp_path):
  env = {"AWS_CREDENTIAL_SOURCE": "Ec2InstanceMetadata"}
  mod = _load_ingestor(env)

  config = _generated_config(mod, tmp_path, env)

  assert config.count("credential_source = Ec2InstanceMetadata") == 2


def test_invalid_credential_source_is_rejected(tmp_path):
  env = {"AWS_CREDENTIAL_SOURCE": "ArbitraryProvider"}
  mod = _load_ingestor(env)

  with pytest.raises(ValueError, match="Unsupported AWS_CREDENTIAL_SOURCE"):
    _generated_config(mod, tmp_path, env)


def test_irsa_values_must_be_single_line(tmp_path):
  env = {
    "AWS_ROLE_ARN": "arn:aws:iam::111111111111:role/rag\n[profile injected]",
    "AWS_WEB_IDENTITY_TOKEN_FILE": "/var/run/token",
  }
  mod = _load_ingestor(env)

  with pytest.raises(ValueError, match="AWS_ROLE_ARN must be a single-line"):
    _generated_config(mod, tmp_path, env)
