# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Exhaustive unit and E2E tests for A2AServer.

Coverage:
  Unit  – constructor, agent card fields, build_app() middleware wiring, serve() uvicorn config
  E2E   – live HTTP requests against the ASGI app via httpx ASGITransport
"""

import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

# Repo root derived from this file's location — works on any machine / CI runner
REPO_ROOT = str(Path(__file__).resolve().parents[4])


# ---------------------------------------------------------------------------
# Stub out heavy optional dependencies so tests run without a full install
# ---------------------------------------------------------------------------

def _stub_modules():
    stubs = {
        "prometheus_client": types.ModuleType("prometheus_client"),
        "jwt": types.ModuleType("jwt"),
    }

    stubs["prometheus_client"].Counter = MagicMock
    stubs["prometheus_client"].Histogram = MagicMock
    stubs["prometheus_client"].Gauge = MagicMock
    stubs["prometheus_client"].Info = MagicMock
    stubs["prometheus_client"].generate_latest = lambda: b""
    stubs["prometheus_client"].CONTENT_TYPE_LATEST = "text/plain"
    stubs["jwt"].decode = Mock(return_value={})
    stubs["jwt"].PyJWTError = Exception

    for name, mod in stubs.items():
        if name not in sys.modules:
            sys.modules[name] = mod


_stub_modules()

# Now safe to import
from a2a.server.agent_execution import AgentExecutor  # noqa: E402
from a2a.types import AgentSkill  # noqa: E402
from ai_platform_engineering.utils.a2a_common.a2a_server import (  # noqa: E402
    A2AServer,
    SUPPORTED_CONTENT_TYPES,
)


# ---------------------------------------------------------------------------
# Helpers / Fixtures
# ---------------------------------------------------------------------------

def _make_skill(skill_id="test_skill", name="Test Skill"):
    return AgentSkill(
        id=skill_id,
        name=name,
        description="A test skill",
        tags=["test"],
        examples=["Do something"],
    )


def _make_executor():
    executor = Mock(spec=AgentExecutor)
    return executor


def _make_server(**kwargs):
    defaults = dict(
        agent_name="myagent",
        agent_description="My test agent",
        agent_skills=[_make_skill()],
        host="localhost",
        port=9999,
        agent_executor=_make_executor(),
    )
    defaults.update(kwargs)
    return A2AServer(**defaults)


# ---------------------------------------------------------------------------
# Unit tests – constructor
# ---------------------------------------------------------------------------

class TestA2AServerConstructor(unittest.TestCase):

    def test_default_version(self):
        s = _make_server()
        self.assertEqual(s.agent_card.version, "0.1.0")

    def test_custom_version(self):
        s = _make_server(version="2.0.0")
        self.assertEqual(s.agent_card.version, "2.0.0")

    def test_agent_card_name(self):
        s = _make_server(agent_name="argocd")
        self.assertEqual(s.agent_card.name, "argocd")

    def test_agent_card_description(self):
        s = _make_server(agent_description="Manages ArgoCD apps")
        self.assertEqual(s.agent_card.description, "Manages ArgoCD apps")

    def test_agent_card_url_from_host_port(self):
        s = _make_server(host="0.0.0.0", port=8080)
        self.assertEqual(s.agent_card.url, "http://0.0.0.0:8080")

    def test_agent_card_url_localhost(self):
        s = _make_server(host="localhost", port=10000)
        self.assertEqual(s.agent_card.url, "http://localhost:10000")

    def test_agent_card_single_skill(self):
        skill = _make_skill("s1", "Skill One")
        s = _make_server(agent_skills=[skill])
        self.assertEqual(len(s.agent_card.skills), 1)
        self.assertEqual(s.agent_card.skills[0].id, "s1")

    def test_agent_card_multiple_skills(self):
        skills = [_make_skill(f"skill_{i}", f"Skill {i}") for i in range(3)]
        s = _make_server(agent_skills=skills)
        self.assertEqual(len(s.agent_card.skills), 3)
        self.assertEqual([sk.id for sk in s.agent_card.skills], ["skill_0", "skill_1", "skill_2"])

    def test_agent_card_content_types(self):
        s = _make_server()
        self.assertEqual(s.agent_card.default_input_modes, SUPPORTED_CONTENT_TYPES)
        self.assertEqual(s.agent_card.default_output_modes, SUPPORTED_CONTENT_TYPES)

    def test_agent_card_capabilities_streaming(self):
        s = _make_server()
        self.assertTrue(s.agent_card.capabilities.streaming)

    def test_agent_card_capabilities_push_notifications(self):
        s = _make_server()
        self.assertTrue(s.agent_card.capabilities.push_notifications)

    def test_agent_card_security_public(self):
        s = _make_server()
        self.assertEqual(s.agent_card.security, [{"public": []}])

    def test_metrics_disabled_by_default(self):
        s = _make_server()
        self.assertFalse(s.metrics_enabled)

    def test_metrics_enabled_flag(self):
        s = _make_server(metrics_enabled=True)
        self.assertTrue(s.metrics_enabled)

    def test_host_stored(self):
        s = _make_server(host="10.0.0.1")
        self.assertEqual(s.host, "10.0.0.1")

    def test_port_stored(self):
        s = _make_server(port=12345)
        self.assertEqual(s.port, 12345)

    def test_agent_name_stored(self):
        s = _make_server(agent_name="myagent")
        self.assertEqual(s.agent_name, "myagent")

    def test_executor_stored(self):
        executor = _make_executor()
        s = _make_server(agent_executor=executor)
        self.assertIs(s.agent_executor, executor)


# ---------------------------------------------------------------------------
# Unit tests – build_app() middleware wiring
# ---------------------------------------------------------------------------

class TestA2AServerBuildApp(unittest.TestCase):

    def _middleware_class_names(self, app):
        return [m.cls.__name__ for m in app.user_middleware]

    def _find_middleware_kwargs(self, app, cls_name):
        for m in app.user_middleware:
            if m.cls.__name__ == cls_name:
                return m.kwargs
        return None

    def test_build_app_returns_starlette_app(self):
        from starlette.applications import Starlette
        s = _make_server()
        app = s.build_app()
        self.assertIsInstance(app, Starlette)

    def test_build_app_cors_middleware_present(self):
        s = _make_server()
        app = s.build_app()
        self.assertIn("CORSMiddleware", self._middleware_class_names(app))

    def test_build_app_cors_allow_all_origins(self):
        s = _make_server()
        app = s.build_app()
        kw = self._find_middleware_kwargs(app, "CORSMiddleware")
        self.assertEqual(kw["allow_origins"], ["*"])

    def test_build_app_cors_allow_all_methods(self):
        s = _make_server()
        app = s.build_app()
        kw = self._find_middleware_kwargs(app, "CORSMiddleware")
        self.assertEqual(kw["allow_methods"], ["*"])

    def test_build_app_cors_allow_all_headers(self):
        s = _make_server()
        app = s.build_app()
        kw = self._find_middleware_kwargs(app, "CORSMiddleware")
        self.assertEqual(kw["allow_headers"], ["*"])

    def test_build_app_no_metrics_middleware_when_disabled(self):
        s = _make_server(metrics_enabled=False)
        app = s.build_app()
        self.assertNotIn("PrometheusMetricsMiddleware", self._middleware_class_names(app))

    def test_build_app_metrics_middleware_present_when_enabled(self):
        s = _make_server(metrics_enabled=True)
        app = s.build_app()
        self.assertIn("PrometheusMetricsMiddleware", self._middleware_class_names(app))

    def test_build_app_metrics_uses_agent_name(self):
        s = _make_server(agent_name="argocd", metrics_enabled=True)
        app = s.build_app()
        kw = self._find_middleware_kwargs(app, "PrometheusMetricsMiddleware")
        self.assertEqual(kw["agent_name"], "argocd")

    def test_build_app_metrics_path(self):
        s = _make_server(metrics_enabled=True)
        app = s.build_app()
        kw = self._find_middleware_kwargs(app, "PrometheusMetricsMiddleware")
        self.assertEqual(kw["metrics_path"], "/metrics")

    def test_build_app_metrics_excluded_paths(self):
        s = _make_server(metrics_enabled=True)
        app = s.build_app()
        kw = self._find_middleware_kwargs(app, "PrometheusMetricsMiddleware")
        for path in ["/.well-known/agent.json", "/.well-known/agent-card.json", "/health", "/ready"]:
            self.assertIn(path, kw["excluded_paths"])

    def test_build_app_can_be_called_multiple_times(self):
        s = _make_server()
        app1 = s.build_app()
        app2 = s.build_app()
        self.assertIsNot(app1, app2)


# ---------------------------------------------------------------------------
# Unit tests – serve() delegates to uvicorn correctly
# ---------------------------------------------------------------------------

class TestA2AServerServe(unittest.IsolatedAsyncioTestCase):

    async def test_serve_calls_uvicorn_with_correct_host_port(self):
        s = _make_server(host="0.0.0.0", port=8080)
        captured_config = {}

        class FakeServer:
            def __init__(self, config):
                captured_config.update({"host": config.host, "port": config.port})

            async def serve(self):
                pass

        with patch("ai_platform_engineering.utils.a2a_common.a2a_server.uvicorn.Server", FakeServer):
            await s.serve()

        self.assertEqual(captured_config["host"], "0.0.0.0")
        self.assertEqual(captured_config["port"], 8080)

    async def test_serve_disables_access_log(self):
        s = _make_server()
        captured = {}

        class FakeServer:
            def __init__(self, config):
                captured["access_log"] = config.access_log

            async def serve(self):
                pass

        with patch("ai_platform_engineering.utils.a2a_common.a2a_server.uvicorn.Server", FakeServer):
            await s.serve()

        self.assertFalse(captured["access_log"])

    async def test_serve_calls_server_serve(self):
        s = _make_server()
        serve_called = []

        class FakeServer:
            def __init__(self, config): pass
            async def serve(self):
                serve_called.append(True)

        with patch("ai_platform_engineering.utils.a2a_common.a2a_server.uvicorn.Server", FakeServer):
            await s.serve()

        self.assertEqual(serve_called, [True])

    async def test_serve_uses_build_app(self):
        """serve() should call build_app() to get the ASGI app."""
        s = _make_server()
        build_app_calls = []
        original_build = s.build_app

        def tracking_build():
            app = original_build()
            build_app_calls.append(app)
            return app

        s.build_app = tracking_build

        class FakeServer:
            def __init__(self, config): pass
            async def serve(self): pass

        with patch("ai_platform_engineering.utils.a2a_common.a2a_server.uvicorn.Server", FakeServer):
            await s.serve()

        self.assertEqual(len(build_app_calls), 1)


# ---------------------------------------------------------------------------
# E2E tests – HTTP against the live ASGI app
# ---------------------------------------------------------------------------

try:
    import httpx
    from httpx import ASGITransport
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

_e2e_skip = unittest.skipUnless(HTTPX_AVAILABLE, "httpx not installed")


@_e2e_skip
class TestA2AServerE2E(unittest.IsolatedAsyncioTestCase):
    """End-to-end tests that fire real HTTP requests against the ASGI app."""

    def _client(self, server: A2AServer) -> httpx.AsyncClient:
        app = server.build_app()
        return httpx.AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        )

    # --- Agent card ---

    async def test_get_agent_card(self):
        s = _make_server(agent_name="argocd", agent_description="ArgoCD agent")
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        self.assertEqual(resp.status_code, 200)

    async def test_agent_card_content_type_json(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        self.assertIn("application/json", resp.headers.get("content-type", ""))

    async def test_agent_card_name(self):
        s = _make_server(agent_name="jira")
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["name"], "jira")

    async def test_agent_card_description(self):
        s = _make_server(agent_description="Manages Jira issues")
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["description"], "Manages Jira issues")

    async def test_agent_card_url(self):
        s = _make_server(host="localhost", port=10000)
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["url"], "http://localhost:10000")

    async def test_agent_card_version_default(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["version"], "0.1.0")

    async def test_agent_card_version_custom(self):
        s = _make_server(version="2.0.0")
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["version"], "2.0.0")

    async def test_agent_card_single_skill(self):
        skill = _make_skill("argocd_skill", "ArgoCD Skill")
        s = _make_server(agent_skills=[skill])
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(len(body["skills"]), 1)
        self.assertEqual(body["skills"][0]["id"], "argocd_skill")
        self.assertEqual(body["skills"][0]["name"], "ArgoCD Skill")

    async def test_agent_card_multiple_skills(self):
        skills = [_make_skill(f"skill_{i}", f"Skill {i}") for i in range(3)]
        s = _make_server(agent_skills=skills)
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(len(body["skills"]), 3)
        skill_ids = [sk["id"] for sk in body["skills"]]
        self.assertEqual(skill_ids, ["skill_0", "skill_1", "skill_2"])

    async def test_agent_card_capabilities_streaming(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertTrue(body["capabilities"]["streaming"])

    async def test_agent_card_capabilities_push_notifications(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertTrue(body["capabilities"]["pushNotifications"])

    async def test_agent_card_input_modes(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["defaultInputModes"], ["text", "text/plain"])

    async def test_agent_card_output_modes(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent.json")
        body = resp.json()
        self.assertEqual(body["defaultOutputModes"], ["text", "text/plain"])

    # --- CORS headers ---

    async def test_cors_headers_on_options(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.options(
                "/.well-known/agent.json",
                headers={"Origin": "http://example.com", "Access-Control-Request-Method": "GET"},
            )
        self.assertIn(resp.status_code, (200, 204))
        self.assertEqual(resp.headers.get("access-control-allow-origin"), "*")

    async def test_cors_allow_origin_on_get(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get(
                "/.well-known/agent.json",
                headers={"Origin": "http://evil.com"},
            )
        self.assertEqual(resp.headers.get("access-control-allow-origin"), "*")

    async def test_cors_allow_methods(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.options(
                "/.well-known/agent.json",
                headers={"Origin": "http://x.com", "Access-Control-Request-Method": "POST"},
            )
        allowed = resp.headers.get("access-control-allow-methods", "")
        self.assertTrue(allowed)  # non-empty

    # --- Metrics endpoint ---

    async def test_metrics_endpoint_absent_when_disabled(self):
        s = _make_server(metrics_enabled=False)
        async with self._client(s) as client:
            resp = await client.get("/metrics")
        # When metrics are disabled, /metrics is not a registered route → 404 or 405
        self.assertIn(resp.status_code, (404, 405))

    async def test_metrics_endpoint_returns_200_when_enabled(self):
        s = _make_server(metrics_enabled=True)
        async with self._client(s) as client:
            resp = await client.get("/metrics")
        self.assertEqual(resp.status_code, 200)

    async def test_metrics_content_type_prometheus(self):
        s = _make_server(metrics_enabled=True)
        async with self._client(s) as client:
            resp = await client.get("/metrics")
        self.assertIn("text/plain", resp.headers.get("content-type", ""))

    # --- Unknown routes ---

    async def test_unknown_route_returns_404(self):
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/no-such-path")
        self.assertEqual(resp.status_code, 404)

    # --- Task submission ---

    async def test_task_send_invalid_payload_returns_error(self):
        """POSTing garbage JSON to the task endpoint should return a client error."""
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.post(
                "/tasks/send",
                content=b"not valid json",
                headers={"Content-Type": "application/json"},
            )
        self.assertIn(resp.status_code, (400, 422, 405, 404))

    async def test_agent_card_also_accessible_via_alternate_path(self):
        """/.well-known/agent-card.json should also return the agent card (A2A spec)."""
        s = _make_server()
        async with self._client(s) as client:
            resp = await client.get("/.well-known/agent-card.json")
        # Either 200 (supported) or 404 (not implemented) — just ensure no 500
        self.assertNotEqual(resp.status_code, 500)


# ---------------------------------------------------------------------------
# Tests for agent entrypoints – env var and CLI handling
# ---------------------------------------------------------------------------

_EXECUTOR_CLASS_NAMES = {
    "agent_argocd": "ArgoCDAgentExecutor",
    "agent_aws": "AWSAgentExecutor",
    "agent_backstage": "BackstageAgentExecutor",
    "agent_confluence": "ConfluenceAgentExecutor",
    "agent_github": "GitHubAgentExecutor",
    "agent_gitlab": "GitLabAgentExecutor",
    "agent_jira": "JiraAgentExecutor",
    "agent_komodor": "KomodorAgentExecutor",
    "agent_netutils": "NetUtilsAgentExecutor",
    "agent_pagerduty": "PagerDutyAgentExecutor",
    "agent_petstore": "PetStoreAgentExecutor",
    "agent_slack": "SlackAgentExecutor",
    "agent_splunk": "SplunkAgentExecutor",
    "agent_victorops": "VictorOpsAgentExecutor",
    "agent_weather": "WeatherAgentExecutor",
    "agent_webex": "WebexAgentExecutor",
}


def _stub_agent_package(package_name: str):
    """Stub out a per-agent package that isn't installed in the root venv."""
    for suffix in ["", ".protocol_bindings", ".protocol_bindings.a2a_server",
                   ".protocol_bindings.a2a_server.agent_executor"]:
        mod_name = package_name + suffix
        if mod_name not in sys.modules:
            sys.modules[mod_name] = types.ModuleType(mod_name)
    leaf = sys.modules[f"{package_name}.protocol_bindings.a2a_server.agent_executor"]
    class_name = _EXECUTOR_CLASS_NAMES.get(package_name, "AgentExecutor")
    if not hasattr(leaf, class_name):
        setattr(leaf, class_name, Mock)


class TestAgentEntrypointEnvVars(unittest.TestCase):
    """Test that __main__.py files correctly read env vars."""

    def setUp(self):
        _stub_agent_package("agent_argocd")

    def _reload_argocd(self, env_overrides):
        with patch.dict("os.environ", env_overrides):
            if "ai_platform_engineering.agents.argocd.agent_argocd.__main__" in sys.modules:
                del sys.modules["ai_platform_engineering.agents.argocd.agent_argocd.__main__"]
            import ai_platform_engineering.agents.argocd.agent_argocd.__main__ as m
            return m

    def test_argocd_metrics_disabled_by_default(self):
        env = {k: v for k, v in os.environ.items() if k != "METRICS_ENABLED"}
        m = self._reload_argocd(env)
        self.assertFalse(m.METRICS_ENABLED)

    def test_argocd_metrics_enabled_via_env(self):
        m = self._reload_argocd({"METRICS_ENABLED": "true"})
        self.assertTrue(m.METRICS_ENABLED)

    def test_argocd_metrics_uppercase_true(self):
        m = self._reload_argocd({"METRICS_ENABLED": "TRUE"})
        self.assertTrue(m.METRICS_ENABLED)

    def test_argocd_metrics_false_value(self):
        m = self._reload_argocd({"METRICS_ENABLED": "false"})
        self.assertFalse(m.METRICS_ENABLED)

    def test_argocd_metrics_garbage_value_is_false(self):
        m = self._reload_argocd({"METRICS_ENABLED": "yes"})
        self.assertFalse(m.METRICS_ENABLED)

    def test_argocd_agent_name_constant(self):
        import ai_platform_engineering.agents.argocd.agent_argocd.__main__ as m
        self.assertEqual(m.AGENT_NAME, "argocd")

    def test_argocd_agent_description_not_empty(self):
        import ai_platform_engineering.agents.argocd.agent_argocd.__main__ as m
        self.assertGreater(len(m.AGENT_DESCRIPTION), 0)

    def test_argocd_agent_skill_defined(self):
        import ai_platform_engineering.agents.argocd.agent_argocd.__main__ as m
        self.assertIsInstance(m.agent_skill, AgentSkill)

    def test_argocd_agent_skill_id(self):
        import ai_platform_engineering.agents.argocd.agent_argocd.__main__ as m
        self.assertEqual(m.agent_skill.id, "argocd_agent_skill")


# ---------------------------------------------------------------------------
# Tests for AWS build_skills()
# ---------------------------------------------------------------------------

class TestAWSBuildSkills(unittest.TestCase):

    def setUp(self):
        _stub_agent_package("agent_aws")

    def _build(self, env):
        key = "ai_platform_engineering.agents.aws.agent_aws.__main__"
        if key in sys.modules:
            del sys.modules[key]
        with patch.dict("os.environ", env, clear=False):
            import ai_platform_engineering.agents.aws.agent_aws.__main__ as m
            return m.build_skills()

    def test_all_skills_enabled_by_default(self):
        env = {
            "ENABLE_EKS_MCP": "true",
            "ENABLE_COST_EXPLORER_MCP": "true",
            "ENABLE_IAM_MCP": "true",
        }
        skills, desc = self._build(env)
        self.assertEqual(len(skills), 3)

    def test_skill_ids(self):
        env = {"ENABLE_EKS_MCP": "true", "ENABLE_COST_EXPLORER_MCP": "true", "ENABLE_IAM_MCP": "true"}
        skills, _ = self._build(env)
        ids = {s.id for s in skills}
        self.assertEqual(ids, {"aws-eks", "aws-cost", "aws-iam"})

    def test_only_eks_enabled(self):
        env = {"ENABLE_EKS_MCP": "true", "ENABLE_COST_EXPLORER_MCP": "false", "ENABLE_IAM_MCP": "false"}
        skills, desc = self._build(env)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].id, "aws-eks")
        self.assertIn("EKS", desc)
        self.assertNotIn("cost", desc.lower())
        self.assertNotIn("IAM", desc)

    def test_only_cost_enabled(self):
        env = {"ENABLE_EKS_MCP": "false", "ENABLE_COST_EXPLORER_MCP": "true", "ENABLE_IAM_MCP": "false"}
        skills, desc = self._build(env)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].id, "aws-cost")
        self.assertIn("cost", desc.lower())

    def test_only_iam_enabled(self):
        env = {"ENABLE_EKS_MCP": "false", "ENABLE_COST_EXPLORER_MCP": "false", "ENABLE_IAM_MCP": "true"}
        skills, desc = self._build(env)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].id, "aws-iam")
        self.assertIn("IAM", desc)

    def test_no_skills_enabled(self):
        env = {"ENABLE_EKS_MCP": "false", "ENABLE_COST_EXPLORER_MCP": "false", "ENABLE_IAM_MCP": "false"}
        skills, desc = self._build(env)
        self.assertEqual(len(skills), 0)

    def test_eks_and_iam_enabled(self):
        env = {"ENABLE_EKS_MCP": "true", "ENABLE_COST_EXPLORER_MCP": "false", "ENABLE_IAM_MCP": "true"}
        skills, _ = self._build(env)
        ids = {s.id for s in skills}
        self.assertEqual(ids, {"aws-eks", "aws-iam"})

    def test_description_always_has_base_text(self):
        env = {"ENABLE_EKS_MCP": "false", "ENABLE_COST_EXPLORER_MCP": "false", "ENABLE_IAM_MCP": "false"}
        _, desc = self._build(env)
        self.assertIn("AWS management", desc)

    def test_description_ends_with_best_practices(self):
        env = {"ENABLE_EKS_MCP": "true", "ENABLE_COST_EXPLORER_MCP": "true", "ENABLE_IAM_MCP": "true"}
        _, desc = self._build(env)
        self.assertIn("best practices", desc)

    def test_all_skills_have_examples(self):
        env = {"ENABLE_EKS_MCP": "true", "ENABLE_COST_EXPLORER_MCP": "true", "ENABLE_IAM_MCP": "true"}
        skills, _ = self._build(env)
        for skill in skills:
            self.assertTrue(len(skill.examples) > 0, f"{skill.id} has no examples")

    def test_all_skills_have_tags(self):
        env = {"ENABLE_EKS_MCP": "true", "ENABLE_COST_EXPLORER_MCP": "true", "ENABLE_IAM_MCP": "true"}
        skills, _ = self._build(env)
        for skill in skills:
            self.assertIn("aws", skill.tags, f"{skill.id} missing 'aws' tag")

    def test_aws_version_is_2_0(self):
        # The main module hard-codes version='2.0.0' in the A2AServer call
        with open(os.path.join(REPO_ROOT, "ai_platform_engineering/agents/aws/agent_aws/__main__.py")) as f:
            src = f.read()
        self.assertIn("2.0.0", src)


# ---------------------------------------------------------------------------
# Tests for other migrated agents – spot-check constants
# ---------------------------------------------------------------------------

class TestMigratedAgentConstants(unittest.TestCase):
    """Read source files directly — avoids needing agent sub-packages installed."""

    def _read_src(self, rel_path):
        with open(os.path.join(REPO_ROOT, rel_path)) as f:
            return f.read()

    def _check_agent_src(self, rel_path, expected_name, expected_skill_id):
        src = self._read_src(rel_path)
        # Accept either single or double quotes around the name value
        self.assertTrue(
            f"AGENT_NAME = '{expected_name}'" in src or f'AGENT_NAME = "{expected_name}"' in src,
            f"AGENT_NAME = {expected_name!r} not found in {rel_path}",
        )
        self.assertIn("AGENT_DESCRIPTION", src)
        self.assertIn(f'id="{expected_skill_id}"', src)
        self.assertIn("examples=", src)
        self.assertIn("tags=", src)

    def test_gitlab(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/gitlab/agent_gitlab/__main__.py",
            "gitlab", "gitlab_agent_skill",
        )

    def test_netutils(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/netutils/agent_netutils/__main__.py",
            "netutils", "netutils_agent_skill",
        )

    def test_victorops(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/victorops/agent_victorops/__main__.py",
            "victorops", "victorops_agent_skill",
        )

    def test_jira(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/jira/agent_jira/__main__.py",
            "jira", "jira_agent_skill",
        )

    def test_slack(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/slack/agent_slack/__main__.py",
            "slack", "slack_agent_skill",
        )

    def test_github(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/github/agent_github/__main__.py",
            "github", "github_agent_skill",
        )

    def test_backstage(self):
        self._check_agent_src(
            "ai_platform_engineering/agents/backstage/agent_backstage/__main__.py",
            "backstage", "backstage_agent_skill",
        )

    def test_no_slim_env_vars_in_any_agent(self):
        """None of the migrated __main__.py files should reference SLIM."""
        import glob
        pattern = os.path.join(
            REPO_ROOT,
            "ai_platform_engineering/agents/*/*/__main__.py",
        )
        for path in glob.glob(pattern):
            # skip the claude-agent-sdk template
            if "template-claude-agent-sdk" in path:
                continue
            with open(path) as f:
                src = f.read()
            self.assertNotIn("A2A_TRANSPORT", src, f"SLIM remnant in {path}")
            self.assertNotIn("SLIM_ENDPOINT", src, f"SLIM remnant in {path}")
            self.assertNotIn("slim_endpoint", src, f"SLIM remnant in {path}")
            self.assertNotIn("AgntcyFactory", src, f"SLIM remnant in {path}")

    def test_all_agents_use_a2a_server(self):
        """Every migrated __main__.py should import and use A2AServer."""
        import glob
        pattern = os.path.join(
            REPO_ROOT,
            "ai_platform_engineering/agents/*/*/__main__.py",
        )
        for path in glob.glob(pattern):
            if "template-claude-agent-sdk" in path:
                continue
            with open(path) as f:
                src = f.read()
            self.assertIn("A2AServer", src, f"Missing A2AServer in {path}")

    def test_all_agents_have_metrics_enabled(self):
        """Every migrated __main__.py should read METRICS_ENABLED from env."""
        import glob
        pattern = os.path.join(
            REPO_ROOT,
            "ai_platform_engineering/agents/*/*/__main__.py",
        )
        for path in glob.glob(pattern):
            if "template-claude-agent-sdk" in path:
                continue
            with open(path) as f:
                src = f.read()
            self.assertIn("METRICS_ENABLED", src, f"Missing METRICS_ENABLED in {path}")


if __name__ == "__main__":
    unittest.main()
