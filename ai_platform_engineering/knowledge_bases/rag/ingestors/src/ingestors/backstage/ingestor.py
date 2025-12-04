import os
import time
import logging
import requests
from typing import List

from common.ingestor import IngestorBuilder, Client
from common.models.graph import Entity
from common.models.rag import DataSourceInfo
from common.job_manager import JobStatus
import common.utils as utils

"""
Backstage Ingestor - Ingests entities from Backstage catalog into the RAG system.
Uses the IngestorBuilder pattern for simplified ingestor creation with automatic job management and batching.
"""

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)

# Backstage configuration
BACKSTAGE_URL = os.getenv("BACKSTAGE_URL")
BACKSTAGE_API_TOKEN = os.getenv("BACKSTAGE_API_TOKEN")
IGNORE_TYPES = os.getenv("IGNORE_TYPES", "template,api,resource").lower().split(",")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default

if BACKSTAGE_URL is None or BACKSTAGE_API_TOKEN is None:
    raise ValueError("BACKSTAGE_URL and BACKSTAGE_API_TOKEN environment variables must be set")

backstage_instance_name = "backstage_"+BACKSTAGE_URL.replace("://", "_").replace("/", "_")


def fetch_backstage_entities() -> List[dict]:
    """
    Fetch all entities from Backstage catalog, handling pagination.
    
    Returns:
        list: A list of all entities from the Backstage catalog.
    """
    if not BACKSTAGE_URL or not BACKSTAGE_API_TOKEN:
        raise ValueError("BACKSTAGE_URL and BACKSTAGE_API_TOKEN environment variables must be set")
    
    url = f"{BACKSTAGE_URL}/api/catalog/entities/by-query"
    headers = {"Authorization": f"Bearer {BACKSTAGE_API_TOKEN}"}
    params = {"limit": 250, "fields": "metadata,kind,spec"}
    all_items = []
    cursor = None

    logging.info(f"Fetching entities from Backstage API: {url}")
    
    while True:
        if cursor:
            params["cursor"] = cursor

        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        print(response.text)
        data = response.json()

        items = data.get("items", [])
        all_items.extend(items)
        logging.debug(f"Fetched {len(items)} items, total so far: {len(all_items)}")

        cursor = data.get("pageInfo", {}).get("nextCursor")
        if not cursor:
            break
    
    logging.info(f"Fetched total of {len(all_items)} entities from Backstage")
    return all_items


async def sync_backstage_entities(client: Client):
    """
    Sync function that fetches Backstage entities and ingests them with job tracking.
    This function is called periodically by the IngestorBuilder.
    """
    logging.info("Starting Backstage entity sync...")
    
    # Fetch all entities from Backstage
    items = fetch_backstage_entities()
    
    # Filter out ignored types
    filtered_items = []
    for item in items:
        kind = item.get("kind", "").lower()
        if kind in IGNORE_TYPES:
            logging.debug(f"Skipping entity of type '{kind}' (in ignore list)")
            continue
        filtered_items.append(item)
    
    logging.info(f"Processing {len(filtered_items)} entities (filtered from {len(items)} total)")
    
    if not filtered_items:
        logging.info("No entities to process after filtering")
        return
    
    datasource_id = backstage_instance_name
    
    # 1. Create/Update the datasource
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description="Backstage catalog entities",
        source_type="backstage",
        last_updated=int(time.time()),
        default_chunk_size=0,  # Skip chunking for graph entities
        default_chunk_overlap=0,
        metadata={
            "backstage_url": BACKSTAGE_URL,
            "ignored_types": IGNORE_TYPES,
        }
    )
    await client.upsert_datasource(datasource_info)
    logging.info(f"Created/updated datasource: {datasource_id}")

    # 2. Create a job for this ingestion
    job_response = await client.create_job(
        datasource_id=datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message="Starting Backstage entity ingestion",
        total=len(filtered_items)
    )
    job_id = job_response["job_id"]
    logging.info(f"Created job {job_id} for datasource={datasource_id} with {len(filtered_items)} entities")
    
    # 3. Convert Backstage items to Entity objects
    entities = []
    for item in filtered_items:
        try:
            kind = item.get("kind", "Unknown")
            # Copy item properties
            props = item.copy()
            
            # Create Entity with proper primary and additional keys using dot notation
            entity = Entity(
                entity_type=f"Backstage{kind}",
                all_properties=props,
                primary_key_properties=["metadata.uid"],
                additional_key_properties=[["metadata.name"], ["metadata.title"]]
            )
            entities.append(entity)
            
        except Exception as e:
            logging.error(f"Error converting Backstage item to Entity: {e}", exc_info=True)
            await client.add_job_error(job_id, [f"Error converting item: {str(e)}"])
            await client.increment_job_failure(job_id, 1)
    
    logging.info(f"Converted {len(entities)} Backstage items to Entity objects")
    
    # 4. Ingest entities using automatic batching
    try:
        if entities:
            logging.info(f"Ingesting {len(entities)} entities with automatic batching")
            
            # Use the client's ingest_entities method which handles batching automatically
            await client.ingest_entities(
                job_id=job_id,
                datasource_id=datasource_id,
                entities=entities,
                fresh_until=utils.get_default_fresh_until()
            )
            
            # Update job progress to reflect all entities processed
            await client.increment_job_progress(job_id, len(entities))
            
            # Mark job as complete
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message=f"Successfully ingested {len(entities)} entities"
            )
            logging.info(f"Successfully completed ingestion of {len(entities)} entities")
        else:
            # No entities to ingest
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message="No entities to ingest after filtering"
            )
            logging.info("No entities to ingest")
        
    except Exception as e:
        # Mark job as failed
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
        logging.info("Starting Backstage ingestor using IngestorBuilder...")
        
        # Use IngestorBuilder for simplified ingestor creation
        IngestorBuilder()\
            .name(backstage_instance_name)\
            .type("backstage")\
            .description("Ingestor for Backstage catalog entities")\
            .metadata({
                "backstage_url": BACKSTAGE_URL,
                "ignored_types": IGNORE_TYPES,
                "sync_interval": SYNC_INTERVAL
            })\
            .sync_with_fn(sync_backstage_entities)\
            .every(SYNC_INTERVAL)\
            .with_init_delay(int(os.getenv("INIT_DELAY_SECONDS", "0")))\
            .run()
            
    except KeyboardInterrupt:
        logging.info("Backstage ingestor execution interrupted by user")
    except Exception as e:
        logging.error(f"Backstage ingestor failed: {e}", exc_info=True)
