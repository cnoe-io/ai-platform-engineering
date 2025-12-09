#!/usr/bin/env python3
"""
Webex message ingestor for RAG.
Fetches messages from configured Webex spaces and ingests them as documents.
Each space becomes a datasource, and messages are grouped into thread-based documents.
"""

import os
import json
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from langchain_core.documents import Document

from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.job_manager import JobStatus
from common import utils

logger = utils.get_logger(__name__)


# Get sync interval
sync_interval = int(os.environ.get("SYNC_INTERVAL", "900"))  # Default 15 minutes
init_delay = int(os.environ.get("INIT_DELAY_SECONDS", "0"))


# Get Webex configuration
bot_name = os.environ.get("WEBEX_BOT_NAME") # used for ingestor identification, e.g., "mybot"
if not bot_name:
    raise ValueError("WEBEX_BOT_NAME environment variable is required")

webex_token = os.environ.get("WEBEX_ACCESS_TOKEN")
if not webex_token:
    raise ValueError("WEBEX_ACCESS_TOKEN environment variable is required")

# Spaces configuration - JSON object mapping space IDs to configuration
spaces_json = os.environ.get("WEBEX_SPACES", "{}")
spaces = json.loads(spaces_json)
if not spaces:
    raise ValueError("No spaces configured. Set WEBEX_SPACES environment variable.")

# Webex API base URL
WEBEX_API_BASE = "https://webexapis.com/v1"


def iso_to_timestamp(iso_string: str) -> int:
    """Convert ISO 8601 timestamp to Unix timestamp."""
    try:
        dt = datetime.fromisoformat(iso_string.replace('Z', '+00:00'))
        return int(dt.timestamp())
    except (ValueError, TypeError):
        return 0


def timestamp_to_iso(timestamp: int) -> str:
    """Convert Unix timestamp to ISO 8601 string."""
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    return dt.strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def iso_to_readable(iso_string: str) -> str:
    """Convert ISO 8601 timestamp to human-readable datetime string."""
    try:
        dt = datetime.fromisoformat(iso_string.replace('Z', '+00:00'))
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, TypeError):
        return 'invalid'


class WebexSpaceSyncer:
    """Handles syncing messages from Webex spaces"""
    
    def __init__(self, access_token: str):
        self.access_token = access_token
        self.session = self._create_session()
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
    
    def _create_session(self) -> requests.Session:
        """Create a requests session with retry logic."""
        session = requests.Session()
        retry_strategy = Retry(
            total=5,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("https://", adapter)
        return session
    
    def _make_request(self, method: str, endpoint: str, params: Optional[Dict] = None, json_data: Optional[Dict] = None) -> Dict:
        """Make a request to Webex API with error handling."""
        url = f"{WEBEX_API_BASE}/{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = self.session.get(url, headers=self.headers, params=params, timeout=30)
            elif method.upper() == "POST":
                response = self.session.post(url, headers=self.headers, params=params, json=json_data, timeout=30)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                # Rate limit - get retry-after header
                retry_after = int(e.response.headers.get('Retry-After', 60))
                logger.warning(f"Rate limited. Waiting {retry_after}s before retry")
                time.sleep(retry_after)
                # Retry once after rate limit
                response = self.session.request(method, url, headers=self.headers, params=params, json=json_data, timeout=30)
                response.raise_for_status()
                return response.json()
            else:
                logger.error(f"HTTP error: {e}")
                raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error: {e}")
            raise
    
    def get_space_details(self, space_id: str) -> Dict:
        """Get details about a specific space."""
        return self._make_request("GET", f"rooms/{space_id}")
    
    def fetch_space_messages(self, space_id: str, space_name: str, lookback_days: int, 
                            last_message_time: Optional[str] = None) -> tuple[List[Dict], str]:
        """Fetch messages from a Webex space since last sync."""
        messages = []
        
        # Build query parameters
        params = {
            "roomId": space_id,
            "max": 100  # Webex max is 100 per request
        }
        
        # Calculate lookback time
        if last_message_time:
            # Use last sync time for incremental sync
            params["mentionedPeople"] = "me"  # Optional: can be removed to get all messages
            logger.info(f"Incremental sync for space '{space_name}' - using timestamp: {last_message_time} ({iso_to_readable(last_message_time)})")
            # Note: Webex API doesn't have a direct "since" parameter, we'll filter after fetching
        elif lookback_days > 0:
            lookback_seconds = lookback_days * 24 * 60 * 60
            current_time = int(time.time())
            before_time = current_time - lookback_seconds
            before_iso = timestamp_to_iso(before_time)
            params["before"] = before_iso
            logger.info(f"First sync for space '{space_name}' - looking back {lookback_days} days")
        else:
            logger.info(f"First sync for space '{space_name}' - fetching all history")
        
        try:
            # Verify space exists and bot has access
            try:
                space_info = self.get_space_details(space_id)
                logger.debug(f"Space verified - title: {space_info.get('title')}, type: {space_info.get('type')}")
            except Exception as e:
                logger.warning(f"Space verification failed: {e}")
            
            # Fetch messages with pagination
            newest_time = last_message_time or ""
            
            while True:
                response = self._make_request("GET", "messages", params=params)
                
                batch_messages = response.get("items", [])
                logger.debug(f"Fetched {len(batch_messages)} messages in this batch")
                
                # Filter messages by time if doing incremental sync
                if last_message_time:
                    batch_messages = [
                        msg for msg in batch_messages 
                        if msg.get("created", "") > last_message_time
                    ]
                
                messages.extend(batch_messages)
                
                # Track newest timestamp
                for msg in batch_messages:
                    msg_time = msg.get("created", "")
                    if msg_time > newest_time:
                        newest_time = msg_time
                
                # Check for more pages
                # Webex uses Link header for pagination, but SDK provides cursor
                # For simplicity, we'll use the "before" parameter with oldest message
                if len(batch_messages) >= 100 and batch_messages:
                    # Get oldest message in this batch
                    oldest_msg = min(batch_messages, key=lambda m: m.get("created", ""))
                    params["before"] = oldest_msg.get("created")
                else:
                    break
            
            logger.info(f"Fetched {len(messages)} messages from space '{space_name}'")
            return messages, newest_time
        
        except Exception as e:
            logger.error(f"Error fetching messages from space '{space_name}': {e}")
            return [], last_message_time or ""
    
    def get_message_details(self, message_id: str) -> Dict:
        """Get detailed information about a message."""
        return self._make_request("GET", f"messages/{message_id}")
    
    def group_messages_into_documents(self, messages: List[Dict], space_id: str, space_name: str, 
                                     include_bots: bool, datasource_id: str, ingestor_id: str) -> List[Document]:
        """Group messages into documents for RAG ingestion."""
        documents = []
        
        # Webex doesn't have native threading like Slack, so we'll group messages by time windows
        # or create individual message documents
        
        # Option 1: Create a document per message (simpler approach)
        # Option 2: Group messages by conversation windows (more complex)
        
        # We'll use Option 1 for now - each message becomes a document
        for msg in sorted(messages, key=lambda m: m.get("created", "")):
            # Skip bot messages if not included
            person_email = msg.get("personEmail", "")
            if not include_bots and "@webex.bot" in person_email:
                continue
            
            doc = self._create_message_document(msg, space_id, space_name, datasource_id, ingestor_id)
            if doc:
                documents.append(doc)
        
        return documents
    
    def _create_message_document(self, msg: Dict, space_id: str, space_name: str, 
                                 datasource_id: str, ingestor_id: str) -> Optional[Document]:
        """Create a document from a Webex message."""
        message_id = msg.get("id", "")
        person_email = msg.get("personEmail", "Unknown")
        text = msg.get("text", "")
        html = msg.get("html", "")
        created = msg.get("created", "")
        
        if not text and not html:
            return None
        
        # Use text content, fallback to HTML if text not available
        content_text = text or html
        
        # Format document content
        formatted_lines = []
        formatted_lines.append(f"# Message in {space_name}\n\n")
        formatted_lines.append(f"**From:** {person_email}\n")
        formatted_lines.append(f"**Time:** {iso_to_readable(created)}\n\n")
        formatted_lines.append(f"{content_text}\n\n")
        
        # Add file attachments info if present
        files = msg.get("files", [])
        if files:
            formatted_lines.append(f"**Attachments:** {len(files)} file(s)\n")
            for file_url in files:
                formatted_lines.append(f"- {file_url}\n")
        
        content = "".join(formatted_lines)
        
        # Create metadata
        message_preview = content_text[:100] if len(content_text) > 100 else content_text
        metadata = DocumentMetadata(
            datasource_id=datasource_id,
            ingestor_id=ingestor_id,
            document_type="webex_message",
            document_ingested_at=int(time.time()),
            document_id=f"webex-message-{space_id}-{message_id}",
            title=f"Message: {message_preview}",
            description=f"Webex message from {person_email}",
            is_graph_entity=False,
            fresh_until=0,
            metadata={
                "space_name": space_name,
                "space_id": space_id,
                "message_id": message_id,
                "person_email": person_email,
                "created": created,
                "has_files": len(files) > 0,
                "type": "webex_message",
                "source_uri": f"https://web.webex.com/spaces/{space_id}",
                "last_modified": iso_to_timestamp(created)
            }
        )
        
        return Document(
            page_content=content,
            metadata=metadata.model_dump()
        )


async def sync_webex_spaces(client: Client):
    """Sync function that processes all configured Webex spaces"""
    
    # Validate token
    if not webex_token:
        raise ValueError("WEBEX_ACCESS_TOKEN environment variable is required")
    
    # Initialize Webex syncer
    syncer = WebexSpaceSyncer(webex_token)
    
    # Load timestamps from previous runs (stored in datasource metadata)
    existing_datasources = await client.list_datasources(ingestor_id=client.ingestor_id)
    timestamp_map = {}
    for ds in existing_datasources:
        if ds.metadata and "last_message_time" in ds.metadata:
            # Extract space_id from datasource_id (format: webex-space-{space_id})
            space_id = ds.datasource_id.replace("webex-space-", "")
            timestamp_map[space_id] = ds.metadata["last_message_time"]
    
    # Process each space
    for space_id, config in spaces.items():
        space_name = config.get("name", space_id)
        lookback_days = config.get("lookback_days", 30)
        include_bots = config.get("include_bots", False)
        
        logger.info(f"Processing space: '{space_name}' (ID: {space_id})")
        
        # Create or update datasource
        datasource_id = f"webex-space-{space_id}"
        last_message_time = timestamp_map.get(space_id)
        
        # Fetch messages
        messages, newest_time = syncer.fetch_space_messages(
            space_id,
            space_name,
            lookback_days,
            last_message_time
        )
        
        if not messages:
            logger.info(f"No new messages for space '{space_name}'")
            continue
        
        # Create datasource
        datasource = DataSourceInfo(
            datasource_id=datasource_id,
            ingestor_id=client.ingestor_id or "",
            description=f"Webex messages from space '{space_name}'",
            source_type="webex",
            last_updated=int(time.time()),
            default_chunk_size=10000,
            default_chunk_overlap=2000,
            metadata={
                "space_id": space_id,
                "space_name": space_name,
                "last_message_time": newest_time,
                "bot_name": bot_name
            }
        )
        await client.upsert_datasource(datasource)
        
        # Convert messages to documents
        documents = syncer.group_messages_into_documents(
            messages, space_id, space_name, include_bots, datasource_id, client.ingestor_id or ""
        )
        
        if not documents:
            logger.info(f"No documents created for space '{space_name}'")
            continue
        
        logger.info(f"Created {len(documents)} documents for space '{space_name}'")
        
        # Create job
        job_response = await client.create_job(
            datasource_id=datasource_id,
            job_status=JobStatus.IN_PROGRESS,
            message=f"Ingesting {len(documents)} messages from space '{space_name}'",
            total=len(documents)
        )
        job_id = job_response["job_id"]
        
        try:
            # Ingest documents with fresh_until timestamp
            fresh_until = iso_to_timestamp(newest_time) if newest_time else int(time.time())
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
                message=f"Successfully ingested {len(documents)} documents from space '{space_name}'"
            )
            
            logger.info(f"✓ Successfully ingested {len(documents)} documents from space '{space_name}'")
            
        except Exception as e:
            logger.error(f"Error ingesting documents for space '{space_name}': {e}")
            await client.add_job_error(job_id, [str(e)])
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.FAILED,
                message=f"Failed to ingest documents: {str(e)}"
            )


def main():
    """Main entry point for the Webex ingestor"""
    
    # Build and run ingestor
    IngestorBuilder() \
        .name(f"webex-{bot_name}") \
        .type("webex") \
        .description(f"Webex ingestor for bot {bot_name}") \
        .metadata({
            "bot_name": bot_name,
            "sync_interval": sync_interval,
            "init_delay": init_delay,
            "spaces": spaces
        }) \
        .sync_with_fn(sync_webex_spaces) \
        .every(sync_interval) \
        .with_init_delay(init_delay) \
        .run()


if __name__ == "__main__":
    main()

