import importlib.util
from pathlib import Path

import pytest


SERVER_PATH = Path(__file__).parents[1] / "server.py"


def _load_server():
    spec = importlib.util.spec_from_file_location("mcp_aws_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def server(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("AWS_ACCOUNT_LIST", "dev:111111111111,prod:222222222222")
    monkeypatch.delenv("AWS_CREDENTIAL_SOURCE", raising=False)
    monkeypatch.delenv("AWS_CONTAINER_CREDENTIALS_FULL_URI", raising=False)
    monkeypatch.delenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", raising=False)
    monkeypatch.delenv("AWS_ROLE_ARN", raising=False)
    monkeypatch.delenv("AWS_WEB_IDENTITY_TOKEN_FILE", raising=False)
    return _load_server()


def _config(tmp_path):
    return (tmp_path / ".aws" / "config").read_text()


def test_profiles_default_to_environment_credentials(server, tmp_path):
    server._setup_aws_profiles()

    config = _config(tmp_path)
    assert config.count("credential_source = Environment") == 2


def test_profiles_auto_detect_eks_pod_identity(server, monkeypatch, tmp_path):
    monkeypatch.setenv(
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "http://169.254.170.23/v1/credentials",
    )

    server._setup_aws_profiles()

    config = _config(tmp_path)
    assert config.count("credential_source = EcsContainer") == 2
    assert "AWS_ACCESS_KEY_ID" not in config


def test_profiles_chain_through_irsa_web_identity(server, monkeypatch, tmp_path):
    monkeypatch.setenv("AWS_ROLE_ARN", "arn:aws:iam::111111111111:role/mcp-aws")
    monkeypatch.setenv(
        "AWS_WEB_IDENTITY_TOKEN_FILE",
        "/var/run/secrets/eks.amazonaws.com/serviceaccount/token",
    )

    server._setup_aws_profiles()

    config = _config(tmp_path)
    assert "[profile mcp-workload-identity]" in config
    assert "web_identity_token_file = /var/run/secrets/eks.amazonaws.com/serviceaccount/token" in config
    assert config.count("source_profile = mcp-workload-identity") == 2
    assert "credential_source" not in config


def test_explicit_credential_source_override(server, monkeypatch, tmp_path):
    monkeypatch.setenv("AWS_CREDENTIAL_SOURCE", "Ec2InstanceMetadata")

    server._setup_aws_profiles()

    assert _config(tmp_path).count("credential_source = Ec2InstanceMetadata") == 2


def test_invalid_credential_source_is_rejected(server, monkeypatch):
    monkeypatch.setenv("AWS_CREDENTIAL_SOURCE", "ArbitraryProvider")

    with pytest.raises(ValueError, match="Unsupported AWS_CREDENTIAL_SOURCE"):
        server._setup_aws_profiles()


def test_web_identity_values_must_be_single_line(server, monkeypatch):
    monkeypatch.setenv("AWS_ROLE_ARN", "arn:aws:iam::111111111111:role/mcp-aws\n[profile injected]")
    monkeypatch.setenv("AWS_WEB_IDENTITY_TOKEN_FILE", "/var/run/token")

    with pytest.raises(ValueError, match="AWS_ROLE_ARN must be a single-line"):
        server._setup_aws_profiles()


def test_list_aws_accounts_returns_profile_mappings(server):
    assert server.list_aws_accounts() == {
        "accounts": [
            {"name": "dev", "id": "111111111111"},
            {"name": "prod", "id": "222222222222"},
        ],
        "usage": "Pass an account name as profile (preferred) or account (legacy alias).",
    }


@pytest.mark.parametrize(
    ("profile", "account", "expected"),
    [
        ("dev", None, "dev"),
        (None, "dev", "dev"),
        ("dev", "dev", "dev"),
    ],
)
def test_account_selection_accepts_profile_and_legacy_alias(server, profile, account, expected):
    selected, error = server._resolve_account_profile(profile, account)

    assert selected == expected
    assert error is None


def test_account_selection_rejects_empty_multi_account_fallback(server):
    selected, error = server._resolve_account_profile(None, None)

    assert selected is None
    assert error == "An AWS profile is required. Available profiles: dev, prod."


def test_account_selection_rejects_unknown_profile(server):
    selected, error = server._resolve_account_profile("missing", None)

    assert selected is None
    assert error == "Unknown AWS profile 'missing'. Available profiles: dev, prod."


def test_account_selection_rejects_conflicting_aliases(server):
    selected, error = server._resolve_account_profile("dev", "prod")

    assert selected is None
    assert error == (
        "Conflicting account selectors: profile='dev' and account='prod'. "
        "Pass only one value or make them identical."
    )


def test_account_selection_preserves_environment_fallback(server, monkeypatch):
    monkeypatch.delenv("AWS_ACCOUNT_LIST")
    server._get_configured_profiles.cache_clear()

    selected, error = server._resolve_account_profile(None, None)

    assert selected is None
    assert error is None
    assert server.list_aws_accounts() == {
        "accounts": [],
        "usage": "No account profiles are configured; environment credentials are used directly.",
    }


def test_aws_cli_rejects_empty_profile_before_using_bootstrap_credentials(server):
    result = server.asyncio.run(server.aws_cli_execute("sts get-caller-identity"))

    assert result == "❌ An AWS profile is required. Available profiles: dev, prod."


def test_aws_cli_legacy_account_alias_adds_profile(server, monkeypatch):
    captured: list[tuple[str, ...]] = []

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b'{"Account": "111111111111"}', b""

    async def fake_subprocess(*command: str, **_kwargs: object) -> FakeProcess:
        captured.append(command)
        return FakeProcess()

    monkeypatch.setattr(server.asyncio, "create_subprocess_exec", fake_subprocess)
    server._aws_cli_semaphore = server.asyncio.Semaphore(1)

    result = server.asyncio.run(
        server.aws_cli_execute("sts get-caller-identity", account="dev")
    )

    assert result == '{"Account": "111111111111"}'
    assert captured == [(
        "aws",
        "--profile",
        "dev",
        "sts",
        "get-caller-identity",
        "--region",
        "us-west-2",
        "--output",
        "json",
    )]


def test_aws_cli_allows_quoted_jmespath_pipe(server):
    command = (
        "ec2 describe-instances "
        "--query \"Reservations[].Instances[].{"
        "Name:Tags[?Key=='Name']|[0].Value}\""
    )

    is_valid, error = server._validate_aws_command(command)

    assert is_valid is True
    assert error == ""


@pytest.mark.parametrize(
    "command",
    [
        "ec2 describe-instances | cat",
        "ec2 describe-instances|cat",
        "ec2 describe-instances && whoami",
        "ec2 describe-instances; whoami",
        "ec2 describe-instances > /tmp/output",
    ],
)
def test_aws_cli_rejects_real_shell_operators(server, command):
    is_valid, error = server._validate_aws_command(command)

    assert is_valid is False
    assert "shell operator" in error


def test_aws_cli_passes_jmespath_query_as_single_argv(server, monkeypatch):
    captured: list[tuple[str, ...]] = []

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b"[]", b""

    async def fake_subprocess(*command: str, **_kwargs: object) -> FakeProcess:
        captured.append(command)
        return FakeProcess()

    monkeypatch.setattr(server.asyncio, "create_subprocess_exec", fake_subprocess)
    server._aws_cli_semaphore = server.asyncio.Semaphore(1)
    query = (
        "Reservations[].Instances[?contains(InstanceType, 'xlarge')]."
        "{Name:Tags[?Key=='Name']|[0].Value}"
    )

    result = server.asyncio.run(
        server.aws_cli_execute(
            f'ec2 describe-instances --query "{query}"',
            profile="dev",
        )
    )

    assert result == "[]"
    assert query in captured[0]
    assert "|" not in captured[0]
