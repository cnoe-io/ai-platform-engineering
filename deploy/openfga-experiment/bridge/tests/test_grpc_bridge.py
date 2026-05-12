import base64
import importlib.util
import json
from pathlib import Path


def _load_bridge_module():
    module_path = Path(__file__).resolve().parents[1] / "main.py"
    spec = importlib.util.spec_from_file_location("openfga_bridge_main", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _unsigned_token(sub: str) -> str:
    def encode(part: dict[str, str]) -> str:
        raw = json.dumps(part, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode({'sub': sub})}."


def test_extracts_subject_from_envoy_authorization_header() -> None:
    bridge = _load_bridge_module()
    token = _unsigned_token("user-sub-123")
    request = bridge.build_check_request(
        headers={"authorization": f"Bearer {token}"},
        path="/mcp",
        method="GET",
    )

    assert bridge.subject_from_check_request(request) == "user-sub-123"


def test_prefers_gateway_forwarded_subject_header() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={
            "authorization": f"Bearer {_unsigned_token('token-sub')}",
            "x-authenticated-sub": "gateway-sub",
        },
        path="/mcp",
        method="GET",
    )

    assert bridge.subject_from_check_request(request) == "gateway-sub"


def test_extracts_subject_from_agentgateway_grpc_metadata() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={"accept": "application/json"},
        path="/mcp",
        method="GET",
        metadata_subject="metadata-sub",
    )

    assert bridge.subject_from_check_request(request) == "metadata-sub"


def test_builds_allow_and_deny_check_responses() -> None:
    bridge = _load_bridge_module()

    allowed = bridge.build_check_response(allowed=True)
    denied = bridge.build_check_response(allowed=False)

    assert allowed.status.code == 0
    assert allowed.HasField("ok_response")
    assert denied.status.code != 0
    assert "OpenFGA" in denied.status.message
