#!/usr/bin/env python3
"""
Slack conversation ingestor for RAG.
Fetches messages from configured Slack channels and ingests them as documents.
Each channel becomes a datasource, and each thread becomes a document.
"""

import os
import json
import time
from datetime import datetime
from typing import Dict, List, Optional
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from langchain_core.documents import Document

from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.job_manager import JobStatus
from common import utils

logger = utils.get_logger(__name__)


# Get sync interval
sync_interval = int(os.environ.get("SYNC_INTERVAL", "900"))  # Default 15 minutes
init_delay = int(os.environ.get("INIT_DELAY_SECONDS", "0"))


# Get Slack configuration
bot_name = os.environ.get("SLACK_BOT_NAME")
if not bot_name:
    raise ValueError("SLACK_BOT_NAME environment variable is required")

workspace_url = os.environ.get("SLACK_WORKSPACE_URL", "https://slack.com")
channels_json = os.environ.get("SLACK_CHANNELS", "{}")
channels = json.loads(channels_json)
if not channels:
    raise ValueError("No channels configured. Set SLACK_CHANNELS environment variable.")
slack_token = os.environ.get("SLACK_BOT_TOKEN")
if not slack_token:
    raise ValueError("SLACK_BOT_TOKEN environment variable is required")

def ts_to_readable(timestamp):
    """Convert Unix timestamp to human-readable datetime string."""
    try:
        if isinstance(timestamp, str):
            timestamp = float(timestamp)
        dt = datetime.fromtimestamp(timestamp)
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, TypeError):
        return 'invalid'


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
                error_code = e.response.get('error', '')
                if error_code == 'ratelimited' and attempt < max_retries:
                    retry_after = int(e.response.headers.get('Retry-After', base_delay * (2 ** attempt)))
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
                if channel_info.get('ok'):
                    channel = channel_info.get('channel', {})
                    logger.debug(f"Channel verified - name: {channel.get('name')}, is_member: {channel.get('is_member')}")
            except Exception as e:
                logger.warning(f"Channel verification failed: {e}")

            # Fetch conversations
            cursor = None
            newest_ts = oldest_ts

            while True:
                response = self._api_call_with_retry(
                    self.slack_client.conversations_history,
                    channel=channel_id,
                    oldest=oldest_ts,
                    limit=200,
                    cursor=cursor
                )

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
                        replies_response = self._api_call_with_retry(
                            self.slack_client.conversations_replies,
                            channel=channel_id,
                            ts=msg["ts"]
                        )
                        enriched_msg["thread_replies"] = replies_response.get("messages", [])[1:]  # Exclude parent
                        logger.debug(f"Fetched {len(enriched_msg['thread_replies'])} thread replies for message {msg['ts']}")
                    except SlackApiError as e:
                        logger.warning(f"Could not fetch thread replies: {e}")

                enriched_messages.append(enriched_msg)

            return enriched_messages, newest_ts

        except SlackApiError as e:
            logger.error(f"Error fetching messages from {channel_name}: {e}")
            return [], oldest_ts

    def group_messages_by_thread(self, messages: List[Dict], channel_id: str, channel_name: str, include_bots: bool, datasource_id: str, ingestor_id: str) -> List[Document]:
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
            doc = self._create_thread_document(thread_messages, channel_id, channel_name, thread_ts, datasource_id, ingestor_id)
            if doc:
                documents.append(doc)
        
        # Create documents for standalone messages
        for msg in standalone:
            doc = self._create_standalone_document(msg, channel_id, channel_name, datasource_id, ingestor_id)
            if doc:
                documents.append(doc)
        
        return documents

    def _create_thread_document(self, thread_messages: List[Dict], channel_id: str, channel_name: str, thread_ts: str, datasource_id: str, ingestor_id: str) -> Optional[Document]:
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
            fresh_until=sync_interval*3,
            title=f"Thread: {parent_text}",
            metadata={
                "channel_name": channel_name,
                "channel_id": channel_id,
                "thread_ts": thread_ts,
                "message_count": len(thread_messages),
                "type": "slack_thread",
                "source_uri": thread_url,
                "last_modified": int(float(thread_messages[-1].get("ts", "0"))),

            }
        )
        
        logger.debug(f"Creating thread document for {channel_id} {thread_ts}: \n {metadata.model_dump()}")

        return Document(
            page_content=content,
            metadata=metadata.model_dump()
        )

    def _create_standalone_document(self, msg: Dict, channel_id: str, channel_name: str, datasource_id: str, ingestor_id: str) -> Optional[Document]:
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
            fresh_until=sync_interval*3,
            metadata={
                "channel_name": channel_name,
                "channel_id": channel_id,
                "ts": ts,
                "type": "slack_message",
                "source_uri": slack_url,
                "last_modified": int(float(ts)),
            }
        )
        
        return Document(
            page_content=content,
            metadata=metadata.model_dump()
        )


async def sync_slack_channels(client: Client):
    """Sync function that processes all configured Slack channels"""
    
    # Initialize Slack client and syncer
    slack_client = WebClient(token=slack_token)
    syncer = SlackChannelSyncer(slack_client, workspace_url)
    
    # Load timestamps from previous runs (stored in datasource metadata)
    existing_datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
    timestamp_map = {}
    for ds in existing_datasources:
        if ds.metadata and "last_ts" in ds.metadata:
            # Extract channel_id from datasource_id (format: slack-channel-{channel_id})
            channel_id = ds.datasource_id.replace("slack-channel-", "")
            timestamp_map[channel_id] = ds.metadata["last_ts"]
    
    # Process each channel
    for channel_id, config in channels.items():
        channel_name = config.get("name", channel_id)
        lookback_days = config.get("lookback_days", 30)
        include_bots = config.get("include_bots", False)
        
        logger.info(f"Processing channel: #{channel_name} (ID: {channel_id})")
        
        # Create or update datasource
        datasource_id = f"slack-channel-{channel_id}"
        last_ts = timestamp_map.get(channel_id)
        
        # Fetch messages
        messages, newest_ts = syncer.fetch_channel_messages(
            channel_id, 
            channel_name, 
            lookback_days,
            last_ts
        )
        
        if not messages:
            logger.info(f"No new messages for #{channel_name}")
            continue
        
        # Create datasource
        datasource = DataSourceInfo(
            datasource_id=datasource_id,
            ingestor_id=client.ingestor_id or "",
            description=f"Slack conversations from #{channel_name}",
            source_type="slack",
            last_updated=int(time.time()),
            metadata={
                "channel_id": channel_id,
                "channel_name": channel_name,
                "last_ts": newest_ts,
                "workspace_url": workspace_url
            }
        )
        await client.upsert_datasource(datasource)
        
        # Convert messages to thread documents
        documents = syncer.group_messages_by_thread(messages, channel_id, channel_name, include_bots, datasource_id, client.ingestor_id or "")
        
        if not documents:
            logger.info(f"No documents created for #{channel_name}")
            continue
        
        logger.info(f"Created {len(documents)} documents (threads/messages) for #{channel_name}")
        
        # Create job
        job_response = await client.create_job(
            datasource_id=datasource_id,
            job_status=JobStatus.IN_PROGRESS,
            message=f"Ingesting {len(documents)} threads/messages from #{channel_name}",
            total=len(documents)
        )
        job_id = job_response["job_id"]
        
        try:
            # Ingest documents with fresh_until timestamp
            fresh_until = int(float(newest_ts))
            await client.ingest_documents(
                job_id=job_id,
                datasource_id=datasource_id,
                documents=documents,
                fresh_until=fresh_until
            )
            
            # Update job status
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message=f"Successfully ingested {len(documents)} documents from #{channel_name}"
            )
            
            logger.info(f"✓ Successfully ingested {len(documents)} documents from #{channel_name}")
            
        except Exception as e:
            logger.error(f"Error ingesting documents for #{channel_name}: {e}")
            await client.add_job_error(job_id, [str(e)])
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.FAILED,
                message=f"Failed to ingest documents: {str(e)}"
            )


def main():
    """Main entry point for the Slack ingestor"""
    
    # Build and run ingestor
    IngestorBuilder() \
        .name(f"slack-{bot_name}") \
        .type("slack") \
        .description(f"Slack ingestor for {workspace_url}") \
        .metadata({
            "workspace_url": workspace_url, 
            "bot_name": bot_name, 
            "sync_interval": sync_interval,
            "init_delay": init_delay,
            "channels": channels
        }) \
        .sync_with_fn(sync_slack_channels) \
        .every(sync_interval) \
        .with_init_delay(init_delay) \
        .run()


if __name__ == "__main__":
    main()
