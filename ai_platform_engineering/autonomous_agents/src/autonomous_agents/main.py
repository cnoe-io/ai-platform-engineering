"""Autonomous Agents FastAPI Application."""

import asyncio
from contextlib import asynccontextmanager

from autonomous_agents.log_config import setup_logging

logger = setup_logging()

# ruff: noqa: E402
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from autonomous_agents.config import get_settings
from autonomous_agents.routes import health, tasks, webhooks
from autonomous_agents.routes.tasks import set_task_store
from autonomous_agents.routes.webhooks import register_webhook_tasks
from autonomous_agents.scheduler import (
    get_scheduler,
    register_tasks,
    set_chat_history_publisher,
    set_run_store,
    set_webex_thread_map,
)
from autonomous_agents.services.chat_history import NoopChatHistoryPublisher
from autonomous_agents.services.mongo import (
    MongoChatHistoryPublisherAdapter,
    MongoRunStoreAdapter,
    MongoTaskStoreAdapter,
    MongoWebexThreadMapAdapter,
    get_mongo_service,
    reset_mongo_service,
)


def fatal_exit(message: str, exit_code: int = 1) -> None:
    """Log a fatal error and terminate the process with ``exit_code``.

    Mirrors the helper in ``dynamic_agents/main.py``. We SystemExit
    rather than ``sys.exit`` so that `pytest` / reload loops can catch
    it without killing their whole harness, while `uvicorn main:app`
    still terminates normally (SystemExit propagates to the top level).
    """
    logger.error("FATAL: %s", message)
    raise SystemExit(exit_code)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting Autonomous Agents service...")

    # ------------------------------------------------------------------
    # MongoDB is REQUIRED. No in-memory fallback -- if the operator
    # mis-configures ``MONGODB_URI`` / ``MONGODB_DATABASE`` or the
    # cluster is unreachable, we surface the failure loudly at startup
    # rather than silently running on ephemeral stores that would lose
    # every task definition and run record on the next restart.
    # Mirrors the ``dynamic_agents`` supervisor's contract.
    # ------------------------------------------------------------------
    if not settings.mongodb_uri or not settings.mongodb_database:
        fatal_exit(
            "MONGODB_URI and MONGODB_DATABASE must both be set. "
            f"(MONGODB_URI={'set' if settings.mongodb_uri else 'UNSET'}, "
            f"MONGODB_DATABASE={'set' if settings.mongodb_database else 'UNSET'}). "
            "Configure them in your .env / environment before restarting."
        )

    mongo = get_mongo_service()
    max_attempts = settings.mongodb_connect_max_attempts
    delay = settings.mongodb_connect_retry_delay_seconds
    connected = False
    for attempt in range(1, max_attempts + 1):
        connected = await mongo.connect()
        if connected:
            break
        if attempt < max_attempts:
            logger.warning(
                "MongoDB connect attempt %d/%d failed; retrying in %.1fs",
                attempt,
                max_attempts,
                delay,
            )
            # Clear partial state and rebuild the singleton so the next
            # attempt gets a fresh client rather than reusing a broken
            # one.
            reset_mongo_service()
            mongo = get_mongo_service()
            await asyncio.sleep(delay)

    if not connected:
        fatal_exit(
            f"Failed to connect to MongoDB after {max_attempts} attempt(s). "
            "See prior error logs for the underlying driver exception. "
            "Verify MONGODB_URI, network reachability, and credentials, "
            "then restart."
        )

    task_store = MongoTaskStoreAdapter(mongo)
    run_store = MongoRunStoreAdapter(mongo)
    logger.info(
        "TaskStore + RunStore: MongoDB (db=%s, tasks=%s, runs=%s)",
        settings.mongodb_database,
        settings.mongodb_tasks_collection,
        settings.mongodb_collection,
    )
    if settings.chat_history_publish_enabled:
        chat_publisher = MongoChatHistoryPublisherAdapter(mongo)
        logger.info(
            "ChatHistoryPublisher: MongoDB (db=%s, owner=%s)",
            settings.chat_history_database or settings.mongodb_database,
            settings.chat_history_owner_email,
        )
    else:
        # Chat-history publishing stays opt-in even with Mongo connected:
        # some deployments route autonomous runs elsewhere (or suppress
        # them from the chat sidebar entirely) while still persisting
        # task/run state in Mongo. ``NoopChatHistoryPublisher`` gives the
        # scheduler a no-op target so it doesn't need a null check.
        chat_publisher = NoopChatHistoryPublisher()
        logger.info(
            "ChatHistoryPublisher: disabled (set "
            "CHAT_HISTORY_PUBLISH_ENABLED=true to surface autonomous "
            "runs in the chat sidebar)"
        )

    set_task_store(task_store)
    set_run_store(run_store)
    set_chat_history_publisher(chat_publisher)

    # Webex thread map: lets the scheduler record (messageId -> run_id)
    # for every Webex post_message tool call on a successful run, so a
    # later in-thread reply (delivered by the Webex bot bridge as a
    # /hooks/{task_id}/follow-up POST) can be routed back to the same
    # task. Plain Mongo-backed adapter -- no extra config required when
    # MongoDB is up, and the scheduler treats this as opt-in so tests
    # / deployments without a bot pay nothing for the seam.
    webex_thread_map = MongoWebexThreadMapAdapter(mongo)
    set_webex_thread_map(webex_thread_map)
    logger.info(
        "WebexThreadMap: MongoDB (db=%s, collection=%s, ttl_days=%d)",
        settings.mongodb_database,
        settings.mongodb_webex_thread_map_collection,
        settings.webex_thread_map_ttl_days,
    )

    # MongoDB is the single source of truth for task definitions.
    # At startup we read the persisted task set and register it with
    # the scheduler + webhook router; there is no YAML bootstrap path.
    runtime_tasks = await task_store.list_all()
    logger.info("Loaded %d persisted task(s) from MongoDB", len(runtime_tasks))
    register_webhook_tasks(runtime_tasks)
    register_tasks(runtime_tasks)

    yield

    # Shutdown
    logger.info("Shutting down Autonomous Agents service...")
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
    # Tear down the shared Mongo client so nothing leaks between
    # uvicorn reloads. reset_mongo_service() is idempotent and safe to
    # call regardless of whether connect() succeeded above.
    reset_mongo_service()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Autonomous Agents Service",
        description="Schedule and trigger AI agents to run in the background autonomously",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(tasks.router, prefix="/api/v1")
    app.include_router(webhooks.router, prefix="/api/v1")

    @app.get("/")
    async def root():
        return {
            "service": "autonomous-agents",
            "version": "0.1.0",
            "docs": "/docs",
        }

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "autonomous_agents.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
