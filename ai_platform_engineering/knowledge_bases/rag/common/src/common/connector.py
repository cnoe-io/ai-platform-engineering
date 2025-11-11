import os
from typing import List
import requests
from common.constants import PRIMARY_ID_KEY
from common.models.graph import Entity, Relation, EntityIdentifier
import common.utils as utils
import dotenv

# Load environment variables from .env file
dotenv.load_dotenv()

logger = utils.get_logger(__name__)


class Connector():
    """
    Bindings for graph entities and relations 
    """
    def __init__(self, connector_name: str, connector_type: str = "generic"):
        self.server_addr = os.getenv("RAG_SERVER_URL", "http://localhost:9446")
        self.connector_type = connector_type
        self.connector_name = connector_name
        # API key is currently not used by the server, but kept for future compatibility
        utils.retry_function(lambda: requests.get(self.server_addr + "/healthz").raise_for_status(), 10, 10)
    

    def update_entity(self, entity_type: str, entities: List[Entity], fresh_until: int=0):
        """
        Update an entity, create if it does not exist
        :param entity_type: the type of the entity
        :param entities: the entities to update/create
        :param fresh_until: fresh until timestamp
        """
        if fresh_until == 0:
            fresh_until = utils.get_default_fresh_until()

        # Create the request body using the new Pydantic model structure
        request_body = {
            "entity_type": entity_type,
            "connector_name": self.connector_name,
            "connector_type": self.connector_type,
            "entities": [entity.model_dump() for entity in entities],
            "fresh_until": fresh_until
        }
        json_str = utils.json_encode(request_body)
        print(json_str)
        resp = requests.post(url=f"{self.server_addr}/v1/graph/ingest/entities",
                      headers={'Content-Type': 'application/json'},
                      data=json_str)
        resp.raise_for_status()

    def find_entity(self, entity_type: str, props: dict[str, str]) -> (List[Entity]):
        """
        Find an entity by type and properties
        :param entity_type: the type of the entity
        :param props: the properties of the entity
        """
        resp = requests.get(url=f"{self.server_addr}/v1/graph/explore/data/entity/{entity_type}", 
                           headers={'Content-Type': 'application/json'},
                           json=props)
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

    def find_relations(self, from_type: str, to_type: str, relation_name: str, props: dict[str, str]) -> List[Relation]:
        """
        Find relations by type and properties
        :param from_type: the from entity type
        :param to_type: the to entity type  
        :param relation_name: the relation name
        :param props: the properties to filter by
        :return: List of relations
        """
        resp = requests.get(url=f"{self.server_addr}/v1/graph/explore/data/relations",
                           params={"from_type": from_type, "to_type": to_type, "relation_name": relation_name},
                           headers={'Content-Type': 'application/json'},
                           json=props)
        resp.raise_for_status()
        relations_raw = resp.json()
        relations = []
        for relation_raw in relations_raw:
            relations.append(Relation.model_validate(relation_raw))
        return relations

    def get_entity_types(self) -> List[str]:
        """
        Get all entity types in the database
        :return: List of entity type names
        """
        resp = requests.get(url=f"{self.server_addr}/v1/graph/explore/entity_type",
                           headers={'Content-Type': 'application/json'})
        resp.raise_for_status()
        return resp.json()

    def health_check(self) -> dict:
        """
        Check API health status
        :return: Health status response
        """
        resp = requests.get(url=f"{self.server_addr}/healthz")
        resp.raise_for_status()
        return resp.json()
