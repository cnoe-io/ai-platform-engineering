import os
from typing import List

import requests

from core.constants import PRIMARY_ID_KEY
from core import utils
from core.models import Relation, EntityIdentifier, Entity
from core.utils import get_default_fresh_until
import dotenv

# Load environment variables from .env file
dotenv.load_dotenv()

logging = utils.get_logger(__name__)


class Client:
    """
    Client bindings for the server
    """
    def __init__(self, name: str):
        """
        :param name: plugin name
        """
        self.server_addr = os.getenv("SERVER_ADDR", "http://localhost:8095")
        self.name = name
        self.api_key = os.environ["API_KEY"]
        utils.retry_function(lambda: requests.get(self.server_addr + "/healthz").raise_for_status(), 10, 10)

    def update_entity(self, entity: Entity, fresh_until: int=0):
        """
        Update an entity, create if it does not exist
        :param entity: the entity to update/create
        :param fresh_until: fresh until timestamp
        """
        if fresh_until == 0:
            fresh_until = get_default_fresh_until()

        resp = requests.post(url=f"{self.server_addr}/entities/",
                      params={"client_name": self.name, "fresh_until":fresh_until},
                      headers={'Content-Type': 'application/json', 'X-Api-Key': self.api_key},
                      data=entity.model_dump_json())
        resp.raise_for_status()

    def update_relationship(self, relation: Relation, fresh_until: int=0):
        """
        Update a relationship, create if it does not exist
        :param relation: the relation to update/create
        :param fresh_until: fresh until timestamp
        """
        if fresh_until == 0:
            fresh_until = get_default_fresh_until()

        resp = requests.post(url=f"{self.server_addr}/relations",
                      params={"client_name": self.name, "fresh_until":fresh_until},
                      headers={'Content-Type': 'application/json', 'X-Api-Key': self.api_key},
                      data=relation.model_dump_json())
        resp.raise_for_status()

    def find_entity(self, entity_type: str, props: dict[str, str]) -> (List[Entity]):
        """
        Find an entity by type and properties
        :param entity_type: the type of the entity
        :param props: the properties of the entity
        """
        resp = requests.get(url=f"{self.server_addr}/entity/{entity_type}", headers={'X-Api-Key': self.api_key}, json=props)
        resp.raise_for_status()
        entities_raw = resp.json()
        entities = []
        for entity_raw in entities_raw:
            entities.append(Entity.model_validate(entity_raw))
        return entities

    def get_entity(self, entity: EntityIdentifier) -> (Entity|None):
        """
        Fetches a single entity
        :param entity: the entity to create
        :return:
        """
        entities = self.find_entity(entity.entity_type, {
            PRIMARY_ID_KEY: entity.primary_key
        })
        if len(entities) == 0:
            return None
        return entities[0]

