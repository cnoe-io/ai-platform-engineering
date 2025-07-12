import asyncio
import logging
import os
import json

from clients.common import Client
from core.models import Entity, EntityIdentifier, Relation


"""
This is a dummy plugin that creates a number of dummy entities and relations.
It also listens for entity update notifications and sleeps for a few seconds before responding.
Its both an ingestor and a processor plugin.
"""

CLIENT_NAME = "test_dummy"

SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)


def generate_dummy_entity(p: Client, count: int, skip: int):
    # create a dummy entities
    for i in range(skip, count):
        logging.info(f"Creating entity {i}...")
        p.update_entity(
            Entity(
                entity_type="DummyEntity",
                primary_key_properties=["name"],
                all_properties={
                    "name": f"test_{i}",
                    "foo": "bar",
                    "foo1": "bar1",
        }))

        if i > 2:
            logging.info(f"Creating relation test_{i - 1} -> test_{i} -...")
            p.update_relationship(relation=Relation(
                from_entity=EntityIdentifier(
                    entity_type="DummyEntity",
                    primary_key=f"test_{i - 1}",
                ),
                to_entity=EntityIdentifier(
                    entity_type="DummyEntity",
                    primary_key=f"test_{i}",
                ),
                relation_name="TEST_RELATION",
                relation_properties={}
            ))


def sync_entities_from_file(p: Client, file_path: str):
    # load entities from json file
    with open(file_path, "r") as f:
        data = json.load(f)
        for entity in data["entities"]:
            logging.info(f"Creating entity {entity}...")
            p.update_entity(
                Entity(
                    entity_type=entity["entity_type"],
                    additional_labels=entity.get("additional_labels", []),
                    primary_key_properties=entity["primary_key_properties"],
                    additional_key_properties=entity.get("additional_key_properties", []),
                    all_properties=entity["all_properties"]
                ))

def sync(p: Client):
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
    p = Client(CLIENT_NAME)

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
        logging.info(f"Running client {CLIENT_NAME}...")
        asyncio.run(run())
    except KeyboardInterrupt:
        logging.info("Client execution interrupted")