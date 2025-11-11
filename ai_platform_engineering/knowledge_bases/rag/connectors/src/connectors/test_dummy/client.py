import asyncio
import logging
import os
import json
from collections import defaultdict

from common.connector import Connector
from common.models.graph import Entity

"""
This is a dummy plugin that creates a number of dummy entities and relations.
It also listens for entity update notifications and sleeps for a few seconds before responding.
Its both an ingestor and a processor plugin.
"""

SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)


def sync_entities_from_file(p: Connector, file_path: str):
    # load entities from json file
    with open(file_path, "r") as f:
        data = json.load(f)
        
        # Group entities by entity_type
        grouped_entities = defaultdict(list)
        for entity_data in data["entities"]:
            entity = Entity(
                entity_type=entity_data["entity_type"],
                additional_labels=entity_data.get("additional_labels", []),
                primary_key_properties=entity_data["primary_key_properties"],
                additional_key_properties=entity_data.get("additional_key_properties", []),
                all_properties=entity_data["all_properties"]
            )
            grouped_entities[entity.entity_type].append(entity)

        # Batch update entities for each type
        for entity_type, entities in grouped_entities.items():
            logging.info(f"Creating {len(entities)} entities of type {entity_type}...")
            p.update_entity(entity_type=entity_type, entities=entities)

def sync(p: Connector):
    """
    Periodically sync entities
    """
    logging.info("Syncing entities...")
    # logging.info("Syncing entities...")
    # generate_dummy_entity(p, int(os.getenv("ENTITY_COUNT", 1000)), int(os.getenv("SKIP", 0)))

    # sync entities from file
    file_path = os.getenv("DUMMY_ENTITIES_FILE", "entities_dummy.json")
    sync_entities_from_file(p, file_path)


async def run():
    #  create a plugin object
    p = Connector(
        connector_name="test_dummy",
        connector_type="test"
    )

    init_delay = os.getenv("INIT_DELAY_SECONDS", 0)
    if init_delay:
        logging.info(f"Sleeping for {init_delay} seconds before starting the plugin...")
        await asyncio.sleep(int(init_delay))

    # sync periodically
    async def periodic_sync():
        while True:
            logging.info("syncing...")
            sync(p)
            await asyncio.sleep(SYNC_INTERVAL)

    # run the plugin in asyncio loop
    async with asyncio.TaskGroup() as tg:
        tg.create_task(periodic_sync())

if __name__ == "__main__":
    try:
        logging.info(f"Running client...")
        asyncio.run(run())
    except KeyboardInterrupt:
        logging.info("Client execution interrupted")