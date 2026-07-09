#!/usr/bin/env python3
"""
Slack conversation ingestor for RAG.
Fetches messages from configured Slack channels and ingests them as documents.
Each channel becomes a datasource, and each thread becomes a document.
"""

import os
import json
import time
import asyncio
import traceback
from datetime import datetime
from typing import Dict, List, Optional, Set
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from langchain_core.documents import Document
from redis.asyncio import Redis

from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.models.server import (
  IngestorRequest,
  SlackChannelIngestRequest,
  SlackReloadRequest,
  SlackIngestorCommand,
)
from common.job_manager import JobStatus, JobManager
from common.constants import SLACK_INGESTOR_REDIS_QUEUE
from common.utils import get_logger, get_fresh_until, derive_friendly_name

logger = get_logger(__name__)


# Sync interval (also used to calculate fresh_until)
sync_interval = int(os.environ.get("SYNC_INTERVAL", "86400"))  # Default 24 hours
init_delay = int(os.environ.get("INIT_DELAY_SECONDS", "0"))
max_ingestion_tasks = int(os.environ.get("SLACK_MAX_INGESTION_TASKS", "5"))

# Redis configuration - used for the on-demand ingestion listener (mirrors
# the webloader/confluence ingestors, which accept ad-hoc requests from the
# RAG server's REST API in addition to their periodic env-configured sync).
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = Redis.from_url(REDIS_URL, decode_responses=True)


def get_message_fresh_until(message_ts: str, lookback_days: int) -> int:
  """Calculate fresh_until based on when the message was posted.

  A message should remain in the system until it falls outside the lookback window.
  For example, with lookback_days=30, a message posted 5 days ago expires in 25 days.
  """
  return int(float(message_ts)) + (lookback_days * 86400)


def ts_to_readable(timestamp):
  """Convert Unix timestamp to human-readable datetime string."""
  try:
    if isinstance(timestamp, str):
      timestamp = float(timestamp)
    dt = datetime.fromtimestamp(timestamp)
    return dt.strftime("%Y-%m-%d %H:%M:%S")
  except (ValueError, TypeError):
    return "invalid"


class SlackChannelSyncer:
  """Handles syncing messages from a single Slack channel"""

  def __init__(self, slack_client: WebClient, workspace_url: str):
    self.slack_client = slack_client
    self.workspace_url = workspace_url
    self.timestamps: Dict[str, str] = {}

  def _api_call_with_retry(self, api_func, max_retries=10, base_delay=1.0, **kwargs):
    """Make Slack API calls with exponential backoff retry on rate limits."""
    api_name = api_func.__name__
    for attempt in range(max_retries + 1):
      try:
        response = api_func(**kwargs)
        return response
      except SlackApiError as e:
        error_code = e.response.get("error", "")
        if error_code == "ratelimited" and attempt < max_retries:
          retry_after = int(e.response.headers.get("Retry-After", base_delay * (2**attempt)))
          logger.warning(f"{api_name} rate limited. Waiting {retry_after}s before retry {attempt + 1}/{max_retries}")
          time.sleep(retry_after)
          continue
        raise
    raise SlackApiError(f"Max retries exceeded for {api_name}", response={})

  def fetch_channel_messages(self, channel_id: str, channel_name: str, lookback_days: int, last_ts: Optional[str] = None) -> tuple[List[Dict], str]:
    """Fetch messages from a Slack channel since last sync."""
    messages = []

    # Calculate lookback timestamp
    if last_ts:
      oldest_ts = last_ts
      logger.info(f"Incremental sync for #{channel_name} - using timestamp: {oldest_ts} ({ts_to_readable(oldest_ts)})")
    elif lookback_days > 0:
      lookback_seconds = lookback_days * 24 * 60 * 60
      current_time = round(time.time(), 6)
      oldest_ts = str(round(current_time - lookback_seconds, 6))
      logger.info(f"First sync for #{channel_name} - looking back {lookback_days} days")
    else:
      oldest_ts = "0"
      logger.info(f"First sync for #{channel_name} - fetching all history")

    try:
      # Verify bot has access to channel
      try:
        channel_info = self.slack_client.conversations_info(channel=channel_id)
        if channel_info.get("ok"):
          channel = channel_info.get("channel", {})
          logger.debug(f"Channel verified - name: {channel.get('name')}, is_member: {channel.get('is_member')}")
      except Exception as e:
        logger.warning(f"Channel verification failed: {e}")

      # Fetch conversations
      cursor = None
      newest_ts = oldest_ts

      while True:
        response = self._api_call_with_retry(self.slack_client.conversations_history, channel=channel_id, oldest=oldest_ts, limit=200, cursor=cursor)

        batch_messages = response.get("messages", [])
        logger.debug(f"Fetched {len(batch_messages)} messages in this batch")

        messages.extend(batch_messages)

        # Track newest timestamp
        for msg in batch_messages:
          if msg.get("ts", "0") > newest_ts:
            newest_ts = msg["ts"]

        # Check if there are more messages
        response_metadata = response.get("response_metadata", {})
        cursor = response_metadata.get("next_cursor")
        if not cursor:
          break

      logger.info(f"Fetched {len(messages)} messages from #{channel_name}")

      # Fetch thread replies for messages that have them
      enriched_messages = []
      for msg in messages:
        enriched_msg = msg.copy()

        if msg.get("thread_ts") and msg.get("thread_ts") == msg.get("ts"):
          # This is a parent message with replies
          try:
            replies_response = self._api_call_with_retry(self.slack_client.conversations_replies, channel=channel_id, ts=msg["ts"])
            enriched_msg["thread_replies"] = replies_response.get("messages", [])[1:]  # Exclude parent
            logger.debug(f"Fetched {len(enriched_msg['thread_replies'])} thread replies for message {msg['ts']}")
          except SlackApiError as e:
            logger.warning(f"Could not fetch thread replies: {e}")

        enriched_messages.append(enriched_msg)

      return enriched_messages, newest_ts

    except SlackApiError as e:
      logger.error(f"Error fetching messages from {channel_name}: {e}")
      return [], oldest_ts

  def group_messages_by_thread(self, messages: List[Dict], channel_id: str, channel_name: str, include_bots: bool, datasource_id: str, ingestor_id: str, lookback_days: int = 30) -> List[Document]:
    """Group messages into thread documents for RAG ingestion."""
    documents = []

    # Separate thread parent messages from standalone messages
    threads = {}  # thread_ts -> list of messages
    standalone = []  # messages without threads

    for msg in sorted(messages, key=lambda m: m.get("ts", "0")):
      # Skip system messages
      if msg.get("subtype") in ["channel_join", "channel_leave"]:
        continue

      # Skip bot messages if not included for this channel
      if not include_bots and (msg.get("bot_id") or msg.get("subtype") == "bot_message"):
        continue

      thread_ts = msg.get("thread_ts")

      # Check if this is a parent message with replies
      if msg.get("thread_replies"):
        # This is a thread parent with replies - use the enriched thread_replies
        parent_thread_ts = msg.get("ts")
        threads[parent_thread_ts] = [msg] + msg.get("thread_replies", [])
      elif thread_ts:
        # Part of a thread (but not the parent)
        if thread_ts not in threads:
          threads[thread_ts] = []
        threads[thread_ts].append(msg)
      else:
        # Standalone message
        standalone.append(msg)

    # Create documents for threads
    for thread_ts, thread_messages in threads.items():
      doc = self._create_thread_document(thread_messages, channel_id, channel_name, thread_ts, datasource_id, ingestor_id, lookback_days)
      if doc:
        documents.append(doc)

    # Create documents for standalone messages
    for msg in standalone:
      doc = self._create_standalone_document(msg, channel_id, channel_name, datasource_id, ingestor_id, lookback_days)
      if doc:
        documents.append(doc)

    return documents

  def _create_thread_document(self, thread_messages: List[Dict], channel_id: str, channel_name: str, thread_ts: str, datasource_id: str, ingestor_id: str, lookback_days: int = 30) -> Optional[Document]:
    """Create a document from a thread of messages."""
    if not thread_messages:
      return None

    # Format thread content
    formatted_lines = []
    parent_msg = thread_messages[0]

    # Thread title/summary
    parent_text = parent_msg.get("text", "")[:100]  # First 100 chars as title
    formatted_lines.append(f"# Thread in #{channel_name}: {parent_text}\n\n")

    # Format each message in the thread
    for msg in thread_messages:
      user = msg.get("user", "Unknown")
      text = msg.get("text", "")
      ts = msg.get("ts", "0")
      dt = datetime.fromtimestamp(float(ts))

      # Build Slack message URL
      ts_clean = ts.replace(".", "")
      slack_url = f"{self.workspace_url}/archives/{channel_id}/p{ts_clean}"

      formatted_lines.append(f"**[{dt.strftime('%Y-%m-%d %H:%M:%S')}] {user}:**\n")
      formatted_lines.append(f"{text}\n")
      formatted_lines.append(f"[View in Slack]({slack_url})\n\n")

    content = "".join(formatted_lines)

    # Build thread URL (points to parent message)
    thread_ts_clean = thread_ts.replace(".", "")
    thread_url = f"{self.workspace_url}/archives/{channel_id}/p{thread_ts_clean}"

    # Create metadata
    metadata = DocumentMetadata(
      datasource_id=datasource_id,
      ingestor_id=ingestor_id,
      document_type="slack_thread",
      document_ingested_at=int(time.time()),
      document_id=f"slack-thread-{channel_id}-{thread_ts}",
      fresh_until=get_message_fresh_until(thread_messages[-1].get("ts", "0"), lookback_days),
      title=f"Thread: {parent_text}",
      metadata={
        "channel_name": channel_name,
        "channel_id": channel_id,
        "thread_ts": thread_ts,
        "message_count": len(thread_messages),
        "type": "slack_thread",
        "source_uri": thread_url,
        "last_modified": int(float(thread_messages[-1].get("ts", "0"))),
      },
    )

    logger.debug(f"Creating thread document for {channel_id} {thread_ts}: \n {metadata.model_dump()}")

    return Document(page_content=content, metadata=metadata.model_dump())

  def _create_standalone_document(self, msg: Dict, channel_id: str, channel_name: str, datasource_id: str, ingestor_id: str, lookback_days: int = 30) -> Optional[Document]:
    """Create a document from a standalone message."""
    user = msg.get("user", "Unknown")
    text = msg.get("text", "")
    ts = msg.get("ts", "0")

    if not text:
      return None

    dt = datetime.fromtimestamp(float(ts))

    # Build Slack message URL
    ts_clean = ts.replace(".", "")
    slack_url = f"{self.workspace_url}/archives/{channel_id}/p{ts_clean}"

    # Format content
    content = f"# Message in #{channel_name}\n\n"
    content += f"**[{dt.strftime('%Y-%m-%d %H:%M:%S')}] {user}:**\n"
    content += f"{text}\n"
    content += f"[View in Slack]({slack_url})\n"

    # Create metadata
    message_preview = text[:100] if len(text) > 100 else text
    metadata = DocumentMetadata(
      datasource_id=datasource_id,
      ingestor_id=ingestor_id,
      document_type="slack_message",
      document_ingested_at=int(time.time()),
      document_id=f"slack-message-{channel_id}-{ts}",
      title=f"Message: {message_preview}",
      fresh_until=get_message_fresh_until(ts, lookback_days),
      metadata={
        "channel_name": channel_name,
        "channel_id": channel_id,
        "ts": ts,
        "type": "slack_message",
        "source_uri": slack_url,
        "last_modified": int(float(ts)),
      },
    )

    return Document(page_content=content, metadata=metadata.model_dump())


def get_slack_client_and_syncer() -> tuple[WebClient, "SlackChannelSyncer", str]:
  """Build a Slack WebClient + channel syncer from env config.

  Shared by the periodic env-configured sync and the on-demand (Redis-triggered)
  ingestion paths so both use the same bot token / workspace URL.
  """
  slack_token = os.environ.get("SLACK_BOT_TOKEN")
  if not slack_token:
    raise ValueError("SLACK_BOT_TOKEN environment variable is required")
  workspace_url = os.environ.get("SLACK_WORKSPACE_URL", "https://slack.com")
  slack_client = WebClient(token=slack_token)
  syncer = SlackChannelSyncer(slack_client, workspace_url)
  return slack_client, syncer, workspace_url


def fetch_and_build_documents(
  syncer: "SlackChannelSyncer",
  channel_id: str,
  channel_name: str,
  lookback_days: int,
  include_bots: bool,
  last_ts: Optional[str],
  datasource_id: str,
  ingestor_id: str,
) -> tuple[List[Document], str]:
  """Fetch channel messages since last_ts and build thread/message documents."""
  messages, newest_ts = syncer.fetch_channel_messages(channel_id, channel_name, lookback_days, last_ts)
  if not messages:
    return [], newest_ts
  documents = syncer.group_messages_by_thread(messages, channel_id, channel_name, include_bots, datasource_id, ingestor_id, lookback_days)
  return documents, newest_ts


async def sync_slack_channels(client: Client):
  """Sync function that processes all configured Slack channels"""

  # Read and validate config at runtime so missing creds don't crash the container at import
  bot_name = os.environ.get("SLACK_BOT_NAME")
  if not bot_name:
    raise ValueError("SLACK_BOT_NAME environment variable is required")

  if not os.environ.get("SLACK_BOT_TOKEN"):
    logger.warning("SLACK_BOT_TOKEN not set — skipping sync")
    return

  channels_json = os.environ.get("SLACK_CHANNELS", "{}")
  try:
    channels = json.loads(channels_json)
  except json.JSONDecodeError:
    channels = {}
  if not channels:
    logger.info("No statically-configured channels (SLACK_CHANNELS not set or empty) — will still check on-demand channels")

  # Initialize Slack client and syncer
  slack_client, syncer, workspace_url = get_slack_client_and_syncer()

  # Load timestamps and lookback_days from previous runs (stored in datasource metadata)
  existing_datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
  timestamp_map = {}
  stored_lookback_map = {}
  for ds in existing_datasources:
    if ds.metadata:
      # Extract channel_id from datasource_id (format: slack-channel-{channel_id})
      ch_id = ds.datasource_id.replace("slack-channel-", "")
      if "last_ts" in ds.metadata:
        timestamp_map[ch_id] = ds.metadata["last_ts"]
      if "lookback_days" in ds.metadata:
        stored_lookback_map[ch_id] = ds.metadata["lookback_days"]

  # Process each statically-configured channel
  for channel_id, config in channels.items():
    channel_name = config.get("name", channel_id)
    lookback_days = config.get("lookback_days", 30)
    include_bots = config.get("include_bots", False)

    logger.info(f"Processing channel: #{channel_name} (ID: {channel_id})")

    # Create or update datasource
    datasource_id = f"slack-channel-{channel_id}"
    last_ts = timestamp_map.get(channel_id)

    # Detect lookback_days change — if it changed, reset last_ts to force
    # a full re-fetch with the new lookback window instead of incremental sync
    stored_lookback = stored_lookback_map.get(channel_id)
    if stored_lookback is not None and stored_lookback != lookback_days:
      logger.info(f"lookback_days changed from {stored_lookback} to {lookback_days} for #{channel_name}, resetting last_ts for full re-ingestion")
      last_ts = None

    # Fetch messages
    messages, newest_ts = syncer.fetch_channel_messages(channel_id, channel_name, lookback_days, last_ts)

    # ALWAYS create/update datasource to record we checked this channel
    # This prevents infinite sync loops when there are no new messages
    datasource = DataSourceInfo(
      datasource_id=datasource_id,
      name=derive_friendly_name(source_type="slack", channel_name=channel_name),
      ingestor_id=client.ingestor_id or "",
      description=f"Slack conversations from #{channel_name}",
      source_type="slack",
      last_updated=int(time.time()),
      reload_interval=sync_interval,
      metadata={
        "channel_id": channel_id,
        "channel_name": channel_name,
        "last_ts": newest_ts if newest_ts else last_ts,  # Keep old ts if no new messages
        "workspace_url": workspace_url,
        "lookback_days": lookback_days,
      },
    )
    await client.upsert_datasource(datasource)

    if not messages:
      logger.info(f"No new messages for #{channel_name} - datasource timestamp updated")
      continue

    # Convert messages to thread documents
    documents = syncer.group_messages_by_thread(messages, channel_id, channel_name, include_bots, datasource_id, client.ingestor_id or "", lookback_days)

    if not documents:
      logger.info(f"No documents created for #{channel_name}")
      continue

    logger.info(f"Created {len(documents)} documents (threads/messages) for #{channel_name}")

    # Create job
    job_response = await client.create_job(datasource_id=datasource_id, job_status=JobStatus.IN_PROGRESS, message=f"Ingesting {len(documents)} threads/messages from #{channel_name}", total=len(documents))
    job_id = job_response["job_id"]

    try:
      # Ingest documents with fresh_until based on sync interval (not message timestamp)
      fresh_until = get_fresh_until(sync_interval)
      await client.ingest_documents(job_id=job_id, datasource_id=datasource_id, documents=documents, fresh_until=fresh_until)

      # Update job status
      await client.update_job(job_id=job_id, job_status=JobStatus.COMPLETED, message=f"Successfully ingested {len(documents)} documents from #{channel_name}")

      logger.info(f"✓ Successfully ingested {len(documents)} documents from #{channel_name}")

    except Exception as e:
      logger.error(f"Error ingesting documents for #{channel_name}: {e}")
      await client.add_job_error(job_id, [str(e)])
      await client.update_job(job_id=job_id, job_status=JobStatus.FAILED, message=f"Failed to ingest documents: {str(e)}")

  # Also reload channels added on-demand via the REST API (not present in
  # SLACK_CHANNELS) that haven't been refreshed within the sync interval —
  # mirrors the confluence ingestor's periodic_reload behavior.
  job_manager = JobManager(redis_client)
  existing_datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
  current_time = int(time.time())
  configured_channel_ids = set(channels.keys())
  for ds in existing_datasources:
    channel_id = (ds.metadata or {}).get("channel_id")
    if not channel_id or channel_id in configured_channel_ids:
      continue
    if (current_time - ds.last_updated) < sync_interval:
      continue
    try:
      await reload_slack_datasource(client, job_manager, ds)
    except Exception as e:
      logger.error(f"Error reloading on-demand datasource {ds.datasource_id}: {e}")


async def process_channel_ingestion(client: Client, job_manager: JobManager, ingest_request: SlackChannelIngestRequest):
  """Process on-demand channel ingestion from Redis (server already created datasource and job)."""
  datasource_id = f"slack-channel-{ingest_request.channel_id}"
  job_id = None
  try:
    datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
    datasource_info = next((ds for ds in datasources if ds.datasource_id == datasource_id), None)
    if not datasource_info:
      raise ValueError(f"Datasource not found: {datasource_id}")

    jobs = await job_manager.get_jobs_by_datasource(datasource_id)
    if not jobs:
      raise ValueError(f"No job found for datasource: {datasource_id}")
    job_id = jobs[0].job_id

    if jobs[0].status == JobStatus.TERMINATED:
      logger.info(f"Job {job_id} was already terminated, skipping processing")
      return

    await job_manager.upsert_job(job_id=job_id, status=JobStatus.IN_PROGRESS, message=f"Starting Slack channel ingestion for #{ingest_request.channel_name or ingest_request.channel_id}")

    _, syncer, workspace_url = get_slack_client_and_syncer()
    channel_name = ingest_request.channel_name or (datasource_info.metadata or {}).get("channel_name", ingest_request.channel_id)
    last_ts = (datasource_info.metadata or {}).get("last_ts")

    documents, newest_ts = fetch_and_build_documents(
      syncer,
      ingest_request.channel_id,
      channel_name,
      ingest_request.lookback_days,
      ingest_request.include_bots,
      last_ts,
      datasource_id,
      client.ingestor_id or "",
    )

    datasource_info.metadata = {
      **(datasource_info.metadata or {}),
      "channel_id": ingest_request.channel_id,
      "channel_name": channel_name,
      "last_ts": newest_ts if newest_ts else last_ts,
      "workspace_url": workspace_url,
      "lookback_days": ingest_request.lookback_days,
    }
    datasource_info.last_updated = int(time.time())
    await client.upsert_datasource(datasource_info)

    if not documents:
      await job_manager.upsert_job(job_id=job_id, status=JobStatus.COMPLETED, message=f"No new messages for #{channel_name}")
      return

    await job_manager.upsert_job(job_id=job_id, total=len(documents), message=f"Ingesting {len(documents)} threads/messages from #{channel_name}")
    fresh_until = get_fresh_until(sync_interval)
    await client.ingest_documents(job_id=job_id, datasource_id=datasource_id, documents=documents, fresh_until=fresh_until)
    await job_manager.upsert_job(job_id=job_id, status=JobStatus.COMPLETED, message=f"Successfully ingested {len(documents)} documents from #{channel_name}")

  except Exception as e:
    error_msg = f"Error processing Slack channel {ingest_request.channel_id}: {e}"
    logger.error(error_msg)
    logger.error(traceback.format_exc())
    if job_id:
      await job_manager.add_error_msg(job_id, error_msg)
      await job_manager.upsert_job(job_id=job_id, status=JobStatus.FAILED, message=error_msg)
    raise


async def reload_slack_datasource(client: Client, job_manager: JobManager, datasource_info: DataSourceInfo):
  """Reload a single Slack channel datasource, refetching its full lookback window."""
  metadata = datasource_info.metadata or {}
  channel_id = metadata.get("channel_id")
  if not channel_id:
    logger.warning(f"No channel_id in metadata for {datasource_info.datasource_id}")
    return

  channel_name = metadata.get("channel_name", channel_id)
  lookback_days = metadata.get("lookback_days", 30)
  include_bots = metadata.get("include_bots", False)

  _, syncer, workspace_url = get_slack_client_and_syncer()
  documents, newest_ts = fetch_and_build_documents(syncer, channel_id, channel_name, lookback_days, include_bots, None, datasource_info.datasource_id, client.ingestor_id or "")

  job_response = await client.create_job(datasource_id=datasource_info.datasource_id, job_status=JobStatus.IN_PROGRESS, message=f"Reloading #{channel_name}", total=len(documents))
  job_id = job_response["job_id"]

  try:
    if documents:
      fresh_until = get_fresh_until(sync_interval)
      await client.ingest_documents(job_id=job_id, datasource_id=datasource_info.datasource_id, documents=documents, fresh_until=fresh_until)
    await job_manager.upsert_job(job_id=job_id, status=JobStatus.COMPLETED, message=f"Reloaded {len(documents)} documents from #{channel_name}")

    datasource_info.metadata = {**metadata, "last_ts": newest_ts, "workspace_url": workspace_url}
    datasource_info.last_updated = int(time.time())
    await client.upsert_datasource(datasource_info)
  except Exception as e:
    logger.error(f"Error reloading {datasource_info.datasource_id}: {e}")
    await job_manager.add_error_msg(job_id, str(e))
    await job_manager.upsert_job(job_id=job_id, status=JobStatus.FAILED, message=str(e))
    raise


async def redis_listener(client: Client):
  """Listen for Slack ingest requests on Redis queue (mirrors the confluence ingestor's listener)."""
  job_manager = JobManager(redis_client)
  active_tasks: Set[asyncio.Task] = set()

  logger.info(f"Starting Redis listener on queue: {SLACK_INGESTOR_REDIS_QUEUE}")

  async def handle_task(coro, task_name: str):
    try:
      await coro
    except Exception as e:
      logger.error(f"Error in {task_name}: {e}")
      logger.error(traceback.format_exc())

  try:
    while True:
      try:
        done_tasks = {task for task in active_tasks if task.done()}
        active_tasks -= done_tasks

        if len(active_tasks) >= max_ingestion_tasks:
          await asyncio.sleep(0.5)
          continue

        result = await redis_client.blpop([SLACK_INGESTOR_REDIS_QUEUE], timeout=1)
        if result is None:
          continue

        _, message = result
        try:
          ingestor_request = IngestorRequest.model_validate_json(message)
          if ingestor_request.ingestor_id != client.ingestor_id:
            continue

          if ingestor_request.command == SlackIngestorCommand.INGEST_CHANNEL:
            ingest_request = SlackChannelIngestRequest.model_validate(ingestor_request.payload)
            task = asyncio.create_task(handle_task(process_channel_ingestion(client, job_manager, ingest_request), f"Channel ingestion: {ingest_request.channel_id}"))
            active_tasks.add(task)

          elif ingestor_request.command == SlackIngestorCommand.RELOAD_ALL:
            task = asyncio.create_task(handle_task(sync_slack_channels(client), "Reload all Slack datasources"))
            active_tasks.add(task)

          elif ingestor_request.command == SlackIngestorCommand.RELOAD_DATASOURCE:
            reload_request = SlackReloadRequest.model_validate(ingestor_request.payload)
            datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
            datasource_info = next((ds for ds in datasources if ds.datasource_id == reload_request.datasource_id), None)
            if datasource_info:
              task = asyncio.create_task(handle_task(reload_slack_datasource(client, job_manager, datasource_info), f"Reload datasource: {reload_request.datasource_id}"))
              active_tasks.add(task)
            else:
              logger.warning(f"Datasource not found: {reload_request.datasource_id}")

        except Exception as e:
          logger.error(f"Error processing message: {e}")
          logger.error(traceback.format_exc())

      except asyncio.CancelledError:
        logger.info("Redis listener cancelled, waiting for tasks...")
        if active_tasks:
          await asyncio.gather(*active_tasks, return_exceptions=True)
        break
      except Exception as e:
        logger.error(f"Listener loop error: {e}")
        logger.error(traceback.format_exc())
        await asyncio.sleep(5)

  finally:
    if active_tasks:
      for task in active_tasks:
        task.cancel()
      await asyncio.gather(*active_tasks, return_exceptions=True)
    await redis_client.close()


def main():
  """Main entry point for the Slack ingestor"""

  bot_name = os.environ.get("SLACK_BOT_NAME", "slack")
  workspace_url = os.environ.get("SLACK_WORKSPACE_URL", "https://slack.com")
  channels_json = os.environ.get("SLACK_CHANNELS", "{}")
  try:
    channels = json.loads(channels_json)
  except json.JSONDecodeError:
    channels = {}

  # Build and run ingestor
  (
    IngestorBuilder()
    .name(f"slack-{bot_name}")
    .type("slack")
    .description(f"Slack ingestor for {workspace_url}")
    .metadata({"workspace_url": workspace_url, "bot_name": bot_name, "sync_interval": sync_interval, "init_delay": init_delay, "channels": channels})
    .sync_with_fn(sync_slack_channels)
    .with_startup(redis_listener)
    .every(sync_interval)
    .with_init_delay(init_delay)
    .run()
  )


if __name__ == "__main__":
  main()
