"""
Proposed patched version of:
  ai_platform_engineering/knowledge_bases/rag/ingestors/src/ingestors/backstage/ingestor.py

Changes from upstream (marked with # CHANGED / # NEW):
  1. BACKSTAGE_API_TOKEN is no longer unconditionally required at startup;
     requirement depends on BACKSTAGE_AUTH_MODE.
  2. New BACKSTAGE_AUTH_MODE env var selects auth strategy (default: static).
  3. New oauth2 env vars: BACKSTAGE_OIDC_TOKEN_URL, BACKSTAGE_OIDC_CLIENT_ID,
     BACKSTAGE_OIDC_CLIENT_SECRET, BACKSTAGE_OIDC_SCOPES.
  4. New _get_oauth2_token() function with in-process token caching.
  5. New get_auth_headers() function replaces the inline header construction.
  6. fetch_backstage_entities() uses get_auth_headers() instead of the hardcoded
     BACKSTAGE_API_TOKEN reference.
  7. The guard validation at module level is mode-aware.

All other logic (pagination, entity conversion, job tracking, IngestorBuilder)
is unchanged from upstream.
"""

import os
import time
import logging
import requests
from typing import Dict, List, Optional

from common.ingestor import IngestorBuilder, Client
from common.models.graph import Entity
from common.models.rag import DataSourceInfo
from common.job_manager import JobStatus
import common.utils as utils

"""
Backstage Ingestor - Ingests entities from Backstage catalog into the RAG system.
Uses the IngestorBuilder pattern for simplified ingestor creation with automatic
job management and batching.
"""

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)

# ── Backstage configuration ───────────────────────────────────────────────────

BACKSTAGE_URL = os.getenv("BACKSTAGE_URL")
IGNORE_TYPES = os.getenv("IGNORE_TYPES", "template,api,resource").lower().split(",")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 86400))  # sync every day by default

# CHANGED: auth mode selection — default "static" preserves existing behaviour
BACKSTAGE_AUTH_MODE = os.getenv("BACKSTAGE_AUTH_MODE", "static").lower()

# static mode (existing)
BACKSTAGE_API_TOKEN = os.getenv("BACKSTAGE_API_TOKEN")

# NEW: oauth2 mode — client_credentials grant
BACKSTAGE_OIDC_TOKEN_URL    = os.getenv("BACKSTAGE_OIDC_TOKEN_URL")
BACKSTAGE_OIDC_CLIENT_ID    = os.getenv("BACKSTAGE_OIDC_CLIENT_ID")
BACKSTAGE_OIDC_CLIENT_SECRET = os.getenv("BACKSTAGE_OIDC_CLIENT_SECRET")
BACKSTAGE_OIDC_SCOPES       = os.getenv("BACKSTAGE_OIDC_SCOPES", "openid")

# CHANGED: startup guard is now mode-aware instead of always requiring API_TOKEN
if BACKSTAGE_URL is None:
    raise ValueError("BACKSTAGE_URL environment variable must be set")

if BACKSTAGE_AUTH_MODE == "static":
    if not BACKSTAGE_API_TOKEN:
        raise ValueError(
            "BACKSTAGE_API_TOKEN must be set when BACKSTAGE_AUTH_MODE=static"
        )
elif BACKSTAGE_AUTH_MODE == "oauth2":
    missing = [
        name for name, val in [
            ("BACKSTAGE_OIDC_TOKEN_URL",     BACKSTAGE_OIDC_TOKEN_URL),
            ("BACKSTAGE_OIDC_CLIENT_ID",     BACKSTAGE_OIDC_CLIENT_ID),
            ("BACKSTAGE_OIDC_CLIENT_SECRET", BACKSTAGE_OIDC_CLIENT_SECRET),
        ] if not val
    ]
    if missing:
        raise ValueError(
            f"BACKSTAGE_AUTH_MODE=oauth2 requires: {', '.join(missing)}"
        )
else:
    raise ValueError(
        f"Unknown BACKSTAGE_AUTH_MODE: {BACKSTAGE_AUTH_MODE!r}. "
        f"Valid values: static, oauth2"
    )

backstage_instance_name = "backstage_" + BACKSTAGE_URL.replace("://", "_").replace("/", "_")

# ── Auth helpers ──────────────────────────────────────────────────────────────

# NEW: in-process token cache for oauth2 mode
_oauth2_token_cache: Dict[str, object] = {"token": None, "expires_at": 0.0}


def _get_oauth2_token() -> str:
    """
    Obtain or refresh an OAuth2 client_credentials token.
    Caches the token in memory and refreshes it 60 seconds before expiry.
    """
    now = time.time()
    cached_token: Optional[str] = _oauth2_token_cache["token"]
    expires_at: float = _oauth2_token_cache["expires_at"]

    if cached_token and now < expires_at - 60:
        return cached_token

    logging.info("Requesting new OAuth2 client_credentials token from %s", BACKSTAGE_OIDC_TOKEN_URL)
    resp = requests.post(
        BACKSTAGE_OIDC_TOKEN_URL,
        data={
            "grant_type":    "client_credentials",
            "client_id":     BACKSTAGE_OIDC_CLIENT_ID,
            "client_secret": BACKSTAGE_OIDC_CLIENT_SECRET,
            "scope":         BACKSTAGE_OIDC_SCOPES,
        },
        timeout=10,
    )
    resp.raise_for_status()
    token_data = resp.json()

    access_token: str = token_data["access_token"]
    expires_in: int   = token_data.get("expires_in", 300)

    _oauth2_token_cache["token"]      = access_token
    _oauth2_token_cache["expires_at"] = now + expires_in

    logging.info("OAuth2 token obtained (expires_in=%ds)", expires_in)
    return access_token


def get_auth_headers() -> Dict[str, str]:
    """
    Return the Authorization header dict for the configured auth mode.

    static: sends BACKSTAGE_API_TOKEN directly as a Bearer token.
            Requires Backstage to have backend.auth.externalAccess configured
            for this token value.

    oauth2: obtains a JWT via client_credentials grant and sends that.
            Backstage validates the JWT via its configured OIDC provider.
            Token is cached in-process and refreshed before expiry.
    """
    if BACKSTAGE_AUTH_MODE == "static":
        return {"Authorization": f"Bearer {BACKSTAGE_API_TOKEN}"}
    elif BACKSTAGE_AUTH_MODE == "oauth2":
        return {"Authorization": f"Bearer {_get_oauth2_token()}"}
    # unreachable — validated at module load, but satisfies type checkers
    raise ValueError(f"Unknown BACKSTAGE_AUTH_MODE: {BACKSTAGE_AUTH_MODE!r}")


# ── Ingestor logic (unchanged from upstream) ─────────────────────────────────

def fetch_backstage_entities() -> List[dict]:
    """
    Fetch all entities from Backstage catalog, handling pagination.

    Returns:
        list: A list of all entities from the Backstage catalog.
    """
    url = f"{BACKSTAGE_URL}/api/catalog/entities/by-query"
    headers = get_auth_headers()  # CHANGED: was {"Authorization": f"Bearer {BACKSTAGE_API_TOKEN}"}
    params = {"limit": 250, "fields": "metadata,kind,spec"}
    all_items = []
    cursor = None

    logging.info(
        "Fetching entities from Backstage API: %s (auth_mode=%s)", url, BACKSTAGE_AUTH_MODE
    )

    while True:
        if cursor:
            params["cursor"] = cursor

        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        print(response.text)
        data = response.json()

        items = data.get("items", [])
        all_items.extend(items)
        logging.debug("Fetched %d items, total so far: %d", len(items), len(all_items))

        cursor = data.get("pageInfo", {}).get("nextCursor")
        if not cursor:
            break

    logging.info("Fetched total of %d entities from Backstage", len(all_items))
    return all_items


async def sync_backstage_entities(client: Client):
    """
    Sync function that fetches Backstage entities and ingests them with job tracking.
    This function is called periodically by the IngestorBuilder.
    """
    logging.info("Starting Backstage entity sync...")

    items = fetch_backstage_entities()

    filtered_items = []
    for item in items:
        kind = item.get("kind", "").lower()
        if kind in IGNORE_TYPES:
            logging.debug("Skipping entity of type '%s' (in ignore list)", kind)
            continue
        filtered_items.append(item)

    logging.info(
        "Processing %d entities (filtered from %d total)",
        len(filtered_items), len(items)
    )

    if not filtered_items:
        logging.info("No entities to process after filtering")
        return

    datasource_id = backstage_instance_name

    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description="Backstage catalog entities",
        source_type="backstage",
        last_updated=int(time.time()),
        default_chunk_size=0,
        default_chunk_overlap=0,
        metadata={
            "backstage_url":   BACKSTAGE_URL,
            "ignored_types":   IGNORE_TYPES,
            "auth_mode":       BACKSTAGE_AUTH_MODE,  # NEW: surfaced in metadata
        }
    )
    await client.upsert_datasource(datasource_info)
    logging.info("Created/updated datasource: %s", datasource_id)

    job_response = await client.create_job(
        datasource_id=datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message="Starting Backstage entity ingestion",
        total=len(filtered_items)
    )
    job_id = job_response["job_id"]
    logging.info(
        "Created job %s for datasource=%s with %d entities",
        job_id, datasource_id, len(filtered_items)
    )

    entities = []
    for item in filtered_items:
        try:
            kind = item.get("kind", "Unknown")
            props = item.copy()
            entity = Entity(
                entity_type=f"Backstage{kind}",
                all_properties=props,
                primary_key_properties=["metadata.uid"],
                additional_key_properties=[["metadata.name"]]
            )
            entities.append(entity)
        except Exception as e:
            logging.error("Error converting Backstage item to Entity: %s", e, exc_info=True)
            await client.add_job_error(job_id, [f"Error converting item: {str(e)}"])
            await client.increment_job_failure(job_id, 1)

    logging.info("Converted %d Backstage items to Entity objects", len(entities))

    try:
        if entities:
            logging.info("Ingesting %d entities with automatic batching", len(entities))
            await client.ingest_entities(
                job_id=job_id,
                datasource_id=datasource_id,
                entities=entities,
                fresh_until=utils.get_default_fresh_until()
            )
            await client.increment_job_progress(job_id, len(entities))
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message=f"Successfully ingested {len(entities)} entities"
            )
            logging.info("Successfully completed ingestion of %d entities", len(entities))
        else:
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message="No entities to ingest after filtering"
            )
            logging.info("No entities to ingest")

    except Exception as e:
        error_msg = f"Entity ingestion failed: {str(e)}"
        await client.add_job_error(job_id, [error_msg])
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.FAILED,
            message=error_msg
        )
        logging.error(error_msg, exc_info=True)
        raise


if __name__ == "__main__":
    try:
        logging.info(
            "Starting Backstage ingestor (auth_mode=%s) using IngestorBuilder...",
            BACKSTAGE_AUTH_MODE
        )
        IngestorBuilder()\
            .name(backstage_instance_name)\
            .type("backstage")\
            .description("Ingestor for Backstage catalog entities")\
            .metadata({
                "backstage_url":   BACKSTAGE_URL,
                "ignored_types":   IGNORE_TYPES,
                "sync_interval":   SYNC_INTERVAL,
                "auth_mode":       BACKSTAGE_AUTH_MODE,
            })\
            .sync_with_fn(sync_backstage_entities)\
            .every(SYNC_INTERVAL)\
            .with_init_delay(int(os.getenv("INIT_DELAY_SECONDS", "0")))\
            .run()

    except KeyboardInterrupt:
        logging.info("Backstage ingestor execution interrupted by user")
    except Exception as e:
        logging.error("Backstage ingestor failed: %s", e, exc_info=True)
