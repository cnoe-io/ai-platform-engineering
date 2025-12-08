import os
import time
import logging
from typing import List
from pydantic import BaseModel

from common.ingestor import IngestorBuilder, Client
from common.models.graph import Entity
from common.models.rag import DataSourceInfo
from common.job_manager import JobStatus
import common.utils as utils

"""
This is a dummy plugin that creates a number of dummy entities and relations using the new IngestorBuilder pattern.
It loads entities from a JSON file and ingests them with automatic batching and job management.
"""

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)

class EntityList(BaseModel):
    entities: List[Entity]

async def sync_entities(client: Client):
    """
    Sync function that loads entities from file and ingests them with job tracking
    """
    logging.info("Starting entity sync...")
    
    # Get configuration from environment
    file_path = os.getenv("DUMMY_ENTITIES_FILE", "entities_dummy.json")
    
    # Load entities from JSON file
    with open(file_path, "r") as f:
        entities = EntityList.model_validate_json(f.read()).entities
        logging.info(f"Loaded {len(entities)} entities from {file_path}")
    
    # 1. Create/Update the datasource first
    datasource_id = "dummy_entities"
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description="Dummy entities",
        source_type="dummy_graph_entites",
        last_updated=int(time.time()),
        default_chunk_size=0,  # Skip chunking for graph entities
        default_chunk_overlap=0,
        metadata={"file_path": file_path}
    )
    await client.upsert_datasource(datasource_info)
    logging.info(f"Created/updated datasource: {datasource_id}")

    # 2. Then create a job for this ingestion
    job_response = await client.create_job(
        datasource_id=datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message="Starting entity ingestion",
        total=len(entities)
    )
    job_id = job_response["job_id"]
    logging.info(f"Created job {job_id} for datasource={datasource_id} with {len(entities)} entities")
    
    # 3. Ingest entities using automatic batching
    try:
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
        
    except Exception as e:
        # Mark job as failed
        await client.add_job_error(job_id, [str(e)])
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.FAILED,
            message=f"Ingestion failed: {e}"
        )
        logging.error(f"Entity ingestion failed: {e}")
        raise

if __name__ == "__main__":
    try:
        logging.info("Starting dummy graph ingestor using IngestorBuilder...")
        
        sync_interval = int(os.getenv("SYNC_INTERVAL_SECONDS", "300"))
        init_delay = int(os.getenv("INIT_DELAY_SECONDS", "0"))

        # Use IngestorBuilder for simplified ingestor creation
        IngestorBuilder()\
            .name("test_dummy_graph")\
            .type("test")\
            .description("Ingestor for dummy graph entities")\
            .metadata({
                "source_file": os.getenv("DUMMY_ENTITIES_FILE", "entities_dummy.json"),
                "sync_interval": sync_interval,
                "init_delay": init_delay
            })\
            .sync_with_fn(sync_entities)\
            .every(sync_interval)\
            .with_init_delay(init_delay)\
            .run()
            
    except KeyboardInterrupt:
        logging.info("Ingestor execution interrupted by user")
    except Exception as e:
        logging.error(f"Ingestor failed: {e}", exc_info=True)