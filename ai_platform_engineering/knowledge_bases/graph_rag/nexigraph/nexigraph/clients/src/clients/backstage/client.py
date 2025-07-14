import asyncio
import logging
import os

from core import utils
from clients.common import Client
from core.models import Entity

import requests

CLIENT_NAME = "backstage"

backstage_api_url = os.getenv("BACKSTAGE_API_URL")
backstage_api_token = os.getenv("BACKSTAGE_API_TOKEN")
ignore_types = os.getenv("IGNORE_TYPES", "template,api,resource").lower().split(",")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
EXIT_AFTER_SYNC = os.getenv("EXIT_AFTER_SYNC", "false").lower() == "true"


logging.basicConfig(level=LOG_LEVEL)


def sync_all():
    """
     Fetch all entities of a specific kind from Backstage, handling pagination.

     Returns:
         list: A list of all entities of the specified kind.
     """
    url = f"{backstage_api_url}/catalog/entities/by-query"
    headers = {"Authorization": f"Bearer {backstage_api_token}"}
    params = {"limit": 250, "fields": "metadata,kind,spec"}
    all_items = []
    cursor = None

    while True:
        if cursor:
            params["cursor"] = cursor

        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

        items = data.get("items", [])
        all_items.extend(items)

        cursor = data.get("pageInfo", {}).get("nextCursor")
        if not cursor:
            break

    return all_items

async def run():
    #  create a plugin object
    p = Client(CLIENT_NAME)

    # sync periodically
    async def periodic_sync():
        while True:
            logging.info("syncing...")
            items = sync_all()

            for item in items:
                if item["kind"].lower() in ignore_types:
                    logging.info(f"skipping {item['kind']}")
                    continue
                props = utils.flatten_dict(item)
                p.update_entity(Entity(
                    entity_type="Backstage"+item["kind"],
                    all_properties=props,
                    primary_key_properties=["metadata.uid"],
                    additional_key_properties=[["metadata.name"], ["metadata.title"]],
                ))
            logging.info("syncing... done")
            if EXIT_AFTER_SYNC:
                logging.info("Exiting after sync as per configuration.")
                exit(0)
            logging.info(f"Next sync in {SYNC_INTERVAL} seconds")
            await asyncio.sleep(SYNC_INTERVAL)

    # run the plugin in asyncio loop
    await asyncio.gather(
        periodic_sync(),
    )


if __name__ == "__main__":
    try:
        logging.info(f"Running client {CLIENT_NAME}...")
        asyncio.run(run())
    except KeyboardInterrupt:
        logging.info("Client execution interrupted")