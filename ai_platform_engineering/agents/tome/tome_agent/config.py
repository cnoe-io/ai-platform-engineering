from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchor relative paths and the .env lookup at the project root regardless of
# where the process was launched. Without this, running uvicorn from a child
# directory silently splits state into a separate sqlite db / git repo.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_PROJECT_ROOT / ".env"), extra="ignore")

    anthropic_api_key: str = ""
    anthropic_auth_token: str = ""
    anthropic_base_url: str = ""  # set to proxy URL e.g. http://localhost:8099

    github_token: str = ""
    github_client_id: str = "Iv23liNCDywTsOb0TJBA"
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:3000/apps/ttt/oauth/github/callback"
    confluence_base_url: str = ""
    confluence_user: str = ""
    confluence_token: str = ""
    webex_token: str = ""
    webex_client_id: str = "Cfc1a9f01289f8e16eefd3cd1ecabf8a96f2fdbbc7f62c726efaf9e12ca96ad00"
    webex_client_secret: str = ""
    webex_redirect_uri: str = "http://localhost:3000/apps/ttt/oauth/webex/callback"
    webex_scopes: str = "meeting:schedules_read meeting:transcripts_read meeting:preferences_read"

    confluence_client_id: str = "KW10oZsb59RJBnTsj2D14sxMThYKoM0O"
    confluence_client_secret: str = ""
    confluence_redirect_uri: str = "http://localhost:3000/apps/ttt/oauth/confluence/callback"
    confluence_scopes: str = "offline_access read:confluence-space.summary read:confluence-props read:confluence-content.all read:confluence-content.summary search:confluence"

    ttt_database_url: str = ""
    ttt_postgres_db: str = "ttt"
    ttt_db_path: Path = _PROJECT_ROOT / "data" / "ttt.db"
    # Filesystem cache mirroring the latest page state — sqlite is authoritative.
    # The chat agent's Read/Edit/Write tools operate on these files directly.
    ttt_wiki_dir: Path = _PROJECT_ROOT / "data" / "wiki"
    # Per-project Claude Agent SDK transcript store. Mounted into the agent
    # container at `/home/agent/.claude` so chat `resume` survives container
    # restarts. FS-authoritative (the CLI owns the jsonl format); sqlite's
    # `ChatSession.sdk_session_id` is just the pointer/index into it.
    ttt_sessions_dir: Path = _PROJECT_ROOT / "data" / "agent-sessions"

    ingest_model: str = "claude-haiku-4-5"
    chat_model: str = "claude-sonnet-4-6"
    log_level: str = "INFO"

    @field_validator("log_level")
    @classmethod
    def _valid_log_level(cls, v: str) -> str:
        v = v.upper()
        if v not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(f"log_level must be DEBUG|INFO|WARNING|ERROR|CRITICAL, got {v!r}")
        return v

    caipe_proxy: bool = False
    ttt_jwt_disabled: bool = False
    # When CAIPE_PROXY is False, inject this identity as the current user so
    # that creator tracking, project listing, and chat role resolution work
    # consistently in local dev without requiring JWT auth.
    ttt_dev_user_email: str = ""
    ttt_dev_user_name: str = ""
    ttt_jwt_jwks_uri: str = ""
    ttt_jwt_issuer: str = ""
    ttt_jwt_audience: str = ""

    # Base URL of the CAIPE UI/API (e.g. https://caipe.example.com). When set,
    # the /caipe/projects endpoint forwards the signed-in user's bearer token to
    # CAIPE's GET /api/projects so LLM Wiki can list the projects that user can
    # access. Empty disables the feature.
    caipe_api_url: str = ""

    # Role assigned to the creating user on new projects. Defaults to "admin".
    # Override to "editor" or "viewer" for testing non-admin creator flows.
    ttt_project_creator_role: str = "admin"

    @field_validator("ttt_project_creator_role")
    @classmethod
    def _valid_creator_role(cls, v: str) -> str:
        if v not in {"viewer", "editor", "admin"}:
            raise ValueError(f"ttt_project_creator_role must be viewer|editor|admin, got {v!r}")
        return v

    # Per-project agent containers. `docker` for local; `k8s` for hosted.
    ttt_orchestrator: str = "docker"
    @field_validator("ttt_orchestrator")
    @classmethod
    def _valid_orchestrator(cls, v: str) -> str:
        if v not in {"docker", "k8s"}:
            raise ValueError(f"ttt_orchestrator must be docker|k8s, got {v!r}")
        return v

    # Where the agent container should reach this backend's `/internal/...`
    # callback endpoints. Defaults assume docker compose's `backend` service.
    # On macOS dev (backend on host), set TTT_BACKEND_URL=http://host.docker.internal:8765.
    ttt_backend_url: str = "http://backend:8765"
    ttt_agent_image: str = "ttt-agent:local"
    # Storage class for per-project agent PVCs (wiki + sessions).
    # Empty string uses the cluster's default storage class.
    ttt_k8s_storage_class: str = ""

    # Local-dev only: publish each agent's port to a random host port and
    # talk to it via localhost. Required when backend runs on the host (not
    # on the same docker network as the agents) — that's the macOS dev
    # workflow. Production deploys keep this False.
    ttt_orchestrator_publish_to_host: bool = False


settings = Settings()
