"""
Locust benchmark — caipe-ui API latency before/after audit backend switch.

Measures the endpoints most affected by audit log writes under concurrent load.
Run this against main (MongoDB writes) for the baseline, then against this PR
with AUDIT_LOG_BACKEND=local to see the improvement.

Prerequisites:
    pip install locust          # or: uv pip install locust
    cd <repo-root>

Baseline (main branch — MongoDB audit):
    NEXTAUTH_SECRET=<secret> \\
      locust -f scripts/locustfile.py --headless \\
             -u 20 -r 5 --run-time 60s \\
             --host http://localhost:3000 \\
             --html reports/benchmark-mongodb.html

After (this PR — local file audit):
    AUDIT_LOG_BACKEND=local AUDIT_LOG_LOCAL_PATH=/tmp/caipe-audit \\
    NEXTAUTH_SECRET=<secret> \\
      locust -f scripts/locustfile.py --headless \\
             -u 20 -r 5 --run-time 60s \\
             --host http://localhost:3000 \\
             --html reports/benchmark-local.html

Compare the two HTML reports for p50/p95/p99 differences.

Environment variables:
    NEXTAUTH_SECRET       required — must match the running server
    LOCUST_USER_EMAIL     optional — defaults to locust@benchmark.local
    CAIPE_ORG_KEY         optional — org key injected into the JWT
"""

import os
import subprocess
import sys
import logging
from locust import HttpUser, task, between, events

log = logging.getLogger(__name__)

# ── Session cookie minted once at startup ────────────────────────────────────

_SESSION_COOKIE: str | None = None


@events.init.add_listener
def on_locust_init(environment, **kwargs):
    """Mint a NextAuth session token before any users start."""
    global _SESSION_COOKIE

    secret = os.environ.get("NEXTAUTH_SECRET")
    if not secret:
        log.error(
            "NEXTAUTH_SECRET is not set. "
            "Export it before running: export NEXTAUTH_SECRET=<your-secret>"
        )
        sys.exit(1)

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    mint_script = os.path.join(repo_root, "ui", "mint-test-session.mjs")
    # next-auth is installed in ui/node_modules — run from there
    ui_dir = os.path.join(repo_root, "ui")

    try:
        result = subprocess.run(
            ["node", mint_script],
            capture_output=True,
            text=True,
            check=True,
            cwd=ui_dir,
            env={**os.environ},
        )
        _SESSION_COOKIE = result.stdout.strip()
        log.info("Session token minted successfully (length=%d)", len(_SESSION_COOKIE))
    except subprocess.CalledProcessError as exc:
        log.error("Failed to mint session token: %s", exc.stderr)
        sys.exit(1)
    except FileNotFoundError:
        log.error(
            "node not found. Make sure Node.js is installed and on PATH."
        )
        sys.exit(1)


# ── User behaviour ────────────────────────────────────────────────────────────

class CaipeUser(HttpUser):
    """
    Simulates a logged-in user browsing the admin/chat UI.

    Task weights approximate real-world traffic:
      - Conversation list is polled frequently (5×)
      - Auth session checked on every page load (4×)
      - RBAC gate check on admin tab open (3×)
      - Admin stats loaded once on dashboard visit (2×)
      - Dynamic agents polled on chat open (2×)
      - Single conversation fetch when user opens one (1×)
    """

    wait_time = between(0.5, 2.0)

    def on_start(self) -> None:
        assert _SESSION_COOKIE, "Session cookie was not minted"
        self.client.cookies.set("next-auth.session-token", _SESSION_COOKIE)

    # ── Conversation endpoints (most affected by audit writes) ────────────

    @task(5)
    def list_conversations(self) -> None:
        self.client.get(
            "/api/chat/conversations?page=1&page_size=20",
            name="/api/chat/conversations [list]",
        )

    @task(1)
    def get_single_conversation(self) -> None:
        # Use a stable fake ID — expect a 404, but the auth + audit path still runs
        with self.client.get(
            "/api/chat/conversations/benchmark-conv-id",
            name="/api/chat/conversations [get]",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 404):
                resp.success()

    # ── Auth / session (runs on every page load) ──────────────────────────

    @task(4)
    def auth_session(self) -> None:
        self.client.get("/api/auth/session", name="/api/auth/session")

    # ── RBAC gate check (triggers audit write in old MongoDB path) ────────

    @task(3)
    def admin_tab_gates(self) -> None:
        self.client.get("/api/rbac/admin-tab-gates", name="/api/rbac/admin-tab-gates")

    # ── Admin / stats (heavy MongoDB aggregation) ─────────────────────────

    @task(2)
    def admin_stats(self) -> None:
        with self.client.get(
            "/api/admin/stats",
            name="/api/admin/stats",
            catch_response=True,
        ) as resp:
            # 403 is expected if audit_logs feature flag is off — still counts
            if resp.status_code in (200, 403):
                resp.success()

    # ── Dynamic agents (chat open) ────────────────────────────────────────

    @task(2)
    def dynamic_agents_available(self) -> None:
        self.client.get("/api/dynamic-agents/available", name="/api/dynamic-agents/available")

    # ── Platform config (fetched once on first load) ──────────────────────

    @task(1)
    def platform_config(self) -> None:
        self.client.get("/api/admin/platform-config", name="/api/admin/platform-config")
