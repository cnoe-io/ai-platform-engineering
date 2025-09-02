import asyncio
import hashlib
import json
import os
import time
from typing import List
import redis.asyncio as redis
from core import utils as utils
import agent_graph_gen.helpers as helpers
from core.models import PropertyMapping, Entity, ExampleEntityMatch, FkeyEvaluation, FkeyHeuristic, FkeyRelationManualIntervention, RelationCandidate

from core.graph_db.base import GraphDB

RELATION_ID_KEY = "_relation_id"
RELATION_CONFIDENCE_KEY = "_relation_confidence"
HSET_KEY = "fkey_rel_candidates"
HSET_NEW_KEY = "fkey_rel_candidates_new"


class RelationCandidateManager:
    """
    Heuristic class for determining foreign key relations between tables.
    This class implements a set of functions to identify potential foreign key relationships
    """

    def __init__(self, graph_db: GraphDB, acceptance_threshold: float, rejection_threshold: float, new_candidates: bool = False):

        self.graph_db = graph_db        
        ## TODO: define the right abstract class/apis for key-value store
        self.redis = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379)

        self.logger = utils.get_logger("rc_manager")
        self.max_relation_examples = 3
        self.heuristics_locks = {} # A dictionary to hold locks for each worker, to avoid evaluating while a worker is processing heuristics
        self.acceptance_threshold = acceptance_threshold
        self.rejection_threshold = rejection_threshold
        self.new_candidates = new_candidates


    async def set_new_candidates_to_current(self):
        """
        Sets the new candidates to the current candidates by renaming the hset key.
        This is used to reset the relation candidates, e.g. when starting a new dataset.
        """
        self.logger.debug("Setting new candidates to current candidates.")
        await self.redis.rename(HSET_NEW_KEY, HSET_KEY)

    
    def hset_key(self) -> str:
        if self.new_candidates:
            return HSET_NEW_KEY
        return HSET_KEY


    async def delete_all_candidates(self):
        """
        Deletes all relation candidates from the Redis database.
        This is used to reset the relation candidates, e.g. when starting a new dataset.
        """
        self.logger.info(f"Deleting all relation candidates from the database. {self.hset_key()}")
        await self.redis.delete(self.hset_key())


    async def _set_heuristic(self, relation_id: str, candidate: RelationCandidate):
        """
        Sets a relation candidate in the Redis database.
        """
        self.logger.debug(f"Updating relation candidate, relation_id={relation_id}")
        candidate.relation_id = relation_id # Ensure the relation_id is set
        await self.redis.hset(self.hset_key(), mapping={relation_id: str(candidate.model_dump_json())}) # type: ignore

    async def fetch_all_candidates(self) -> dict[str, RelationCandidate]:
        """
        Fetches all relation candidates from the Redis database.
        """
        self.logger.debug("Fetching all heuristics from the database.")
        heuristics_raw = await self.redis.hgetall(self.hset_key()) # type: ignore
        if not heuristics_raw:
            self.logger.warning("No heuristics found in the database.")
            return {}

        heuristics = {}
        for relation_id, heuristic in heuristics_raw.items():
            heuristics[relation_id.decode('utf-8')] = RelationCandidate.model_validate_json(heuristic)

        return heuristics

    async def fetch_candidate(self, relation_id: str) -> RelationCandidate|None:
        """
        Fetches a relation candidate from the Redis database.
        """
        self.logger.debug(f"Fetching heuristic for relation_id={relation_id}")
        h_raw = await self.redis.hget(self.hset_key(), relation_id) # type: ignore
        if not h_raw:
            self.logger.warning(f"Heuristic {relation_id} not found in the database.")
            return None
        heuristic = RelationCandidate.model_validate_json(h_raw)
        return heuristic

    async def generate_relation_id(self, entity: Entity, entity_property_key: str, matched_entity: Entity, matched_entity_property_key: str, 
                                   property_mappings: List[PropertyMapping]) -> str:
        """
        Generates a unique relation ID for the given entity, matched entity and properties that are being matched.
        """
        props_dict = {}
        for prop in property_mappings:
            props_dict[prop.entity_a_property] = prop.entity_b_idkey_property
        
        prop_json = json.dumps(props_dict, sort_keys=True, cls=utils.ObjEncoder)
        prop_md5 = hashlib.md5(prop_json.encode())
        return f"{entity.entity_type}.{entity_property_key} -> {matched_entity.entity_type} [{prop_md5.hexdigest()}]"

    async def update_heuristic(self, 
                               entity: Entity, 
                               entity_property_key: str,  
                               matched_entity: Entity, 
                               matched_entity_property_key: str, 
                               count: int, 
                               property_mappings: List[PropertyMapping],
                               matching_entity_id_key: List[str]):
        """
        Updates the heuristics for the given entity and matched entity. If the relation candidate does not exist, it creates a new one.
        :param entity: The entity for which the heuristic is being created/updated.
        :param entity_property_key: The property key of the entity that is being matched.
        :param matched_entity: The matched entity.
        :param matched_entity_property_key: The property key of the matched entity that is being matched
        :param count: The count of matches for the heuristic. This will be added to the existing count if the heuristic already exists.
        :param property_mappings: A list of property mappings that map properties from the entity to the matched entity.
        :param matching_entity_id_key: The identity key of the entity that is being matched.
        :return: None
        """
        relation_id = await self.generate_relation_id(entity, entity_property_key, matched_entity, matched_entity_property_key, property_mappings)
        self.logger.info("Creating/Updating relation_id=%s", relation_id)

        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
        if relation_id not in self.heuristics_locks:
            self.heuristics_locks[relation_id] = asyncio.Lock()
        
        async with self.heuristics_locks[relation_id]:
            # Fetch the heuristic for the relation_id
            self.logger.debug(f"Fetching heuristic for relation_id={relation_id}")
            candidate = await self.fetch_candidate(relation_id)

            # If the heuristic does not exist, we create a new one
            if candidate is None:
                self.logger.info(f"Relation candidate '{relation_id}' doesnt exist, Creating new one.")
                candidate = RelationCandidate(
                    relation_id=relation_id,
                    heuristic=FkeyHeuristic(
                        entity_a_type=entity.entity_type,
                        entity_b_type=matched_entity.entity_type,
                        entity_a_property=entity_property_key,
                        properties_in_composite_idkey=frozenset(matching_entity_id_key),
                        count=count,
                        property_mappings=property_mappings,
                        example_matches= [ExampleEntityMatch(entity_a_id=entity.generate_primary_key(), entity_b_id=matched_entity.generate_primary_key())]
                    )
                )
            else:
                # If the heuristic already exists, we update the count and example matches
                if len(candidate.heuristic.example_matches) < self.max_relation_examples:
                    candidate.heuristic.example_matches.append(ExampleEntityMatch(entity_a_id=entity.generate_primary_key(), entity_b_id=matched_entity.generate_primary_key()))

                candidate.heuristic.count += count

            # Save the heuristic to the Redis database
            await self._set_heuristic(relation_id, candidate)

    async def update_evaluation_error(self, relation_id: str, error_message: str):
        """
        Updates the evaluation error message for the given relation_id. This is mostly used to make it easier to debug issues with evaluation.
        :param relation_id: The ID of the relation to update.
        :param error_message: The error message to set.
        """
        self.logger.debug(f"Updating evaluation error for {relation_id}")
        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
        if relation_id not in self.heuristics_locks:
            self.heuristics_locks[relation_id] = asyncio.Lock()

        async with self.heuristics_locks[relation_id]:
            candidate = await self.fetch_candidate(relation_id)
            if candidate is None:
                self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
                return
            candidate.evaluation_error_message = error_message
            await self._set_heuristic(relation_id, candidate)

    async def update_evaluation(self, relation_id: str, 
                                relation_name: str, 
                                relation_confidence: float, 
                                justification: str, 
                                thought: str,
                                values: List[str],
                                entity_a_with_property_count: int,
                                entity_a_with_property_percentage: float,
                                evaluation_count: int):
        """
        Updates the evaluation for the given relation_id.
        :param relation_id: The ID of the relation to update.
        :param relation_name: The name of the relation.
        :param relation_direction: The direction of the relation.
        :param relation_confidence: The confidence of the relation.
        :param justification: Justification for the relation and the confidence.
        :param thought: The agent's thoughts about the relation.
        """
        self.logger.debug(f"Updating evaluation for {relation_id}")
        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
        if relation_id not in self.heuristics_locks:
            self.heuristics_locks[relation_id] = asyncio.Lock()
        async with self.heuristics_locks[relation_id]:
            candidate = await self.fetch_candidate(relation_id)
            if candidate is None:
                self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
                return
            candidate.evaluation = FkeyEvaluation(
                relation_name=relation_name,
                relation_confidence=relation_confidence,
                justification=justification,
                thought=thought,
                values=values,
                entity_a_with_property_count=entity_a_with_property_count,
                entity_a_with_property_percentage=entity_a_with_property_percentage,
                last_evaluated=int(time.time()),
                last_evaluation_count=evaluation_count
            )

            await self._set_heuristic(relation_id, candidate)

    async def update_candidate_metadata(self, relation_id: str,
                                        is_applied: bool,
                                        manual_intervention: FkeyRelationManualIntervention):
        """
        Update the metadata for the relation candidate.
        """
        self.logger.debug(f"Updating metadata for {relation_id}")
        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
        if relation_id not in self.heuristics_locks:
            self.heuristics_locks[relation_id] = asyncio.Lock()
        async with self.heuristics_locks[relation_id]:
            candidate = await self.fetch_candidate(relation_id)
            if candidate is None:
                self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
                return

            # Update the metadata
            candidate.is_applied = is_applied
            candidate.manually_intervened = manual_intervention

            await self._set_heuristic(relation_id, candidate)

    async def apply_relation(self, client_name: str, relation_id: str, manual: bool=False):
        """
        Applies the relation by creating a relation in the graph database.
        This function is used to accept a relation candidate, effectively creating the relation in the graph.
        """
        candidate = await self.fetch_candidate(relation_id)
        if candidate is None:
            self.logger.warning(f"Relation {relation_id} not found")
            return
        if candidate.evaluation is None:
            self.logger.warning(f"Relation {relation_id} has no evaluation, cannot apply relation.")
            return
        self.logger.info(f"Applying relation {relation_id}, {candidate.model_dump_json()}")
        if candidate.evaluation.relation_name is None or candidate.evaluation.relation_name == "":
            self.logger.error(f"Relation {relation_id} has no relation name, cannot apply.")
            return

        matching_properties = {}
        for prop in candidate.heuristic.property_mappings:
            matching_properties[prop.entity_a_property] = prop.entity_b_idkey_property

        # Sanity check if its a composite key, we have all the properties
        # if candidate.heuristic.is_entity_b_idkey_composite and len(matching_properties) != len(candidate.heuristic.properties_in_composite_idkey):
        #     # THIS SHOULD NEVER HAPPEN, but if it does, we log an error and exit, allow for debugging
        #     self.logger.error(f"THIS SHOULD NEVER HAPPEN - Relation {relation_id} is a composite key, but not all properties are accepted: {matching_properties}, {candidate.heuristic.properties_in_composite_idkey}")
        #     self.logger.error(candidate.model_dump_json())
        #     return

        # remove relation if it is already applied
        await self.graph_db.remove_relation("", {RELATION_ID_KEY: relation_id})

         # If there are no wildcards, we can just relate the entities by property
        await self.graph_db.relate_entities_by_property(
            client_name=client_name,
            entity_a_type=candidate.heuristic.entity_a_type,
            entity_b_type=candidate.heuristic.entity_b_type,
            relation_type=candidate.evaluation.relation_name,
            matching_properties=matching_properties,
            relation_properties={RELATION_ID_KEY: relation_id, 
                                 RELATION_CONFIDENCE_KEY: candidate.evaluation.relation_confidence}
        )
        candidate.is_applied = True
        if manual:
            candidate.manually_intervened = FkeyRelationManualIntervention.ACCEPTED
        else:
            candidate.manually_intervened = FkeyRelationManualIntervention.NONE
        await self.update_candidate_metadata(relation_id, is_applied=candidate.is_applied, manual_intervention=candidate.manually_intervened)

    async def unapply_relation(self, relation_id: str, manual: bool=False):
        """
        Unapplies the relation by removing it from the graph database.
        This function is used to reject a relation candidate, effectively removing the relation from the graph.
        """
        self.logger.info(f"Rejecting relation {relation_id}")
        candidate = await self.fetch_candidate(relation_id)
        if candidate is None:
            self.logger.warning(f"Relation {relation_id} not found")
            return  
        if candidate.evaluation is None:
            self.logger.warning(f"Relation {relation_id} has no evaluation, cannot unapply relation.")
            return
        self.logger.info(f"Unapplying relation {relation_id}, {candidate.model_dump_json()}")

        if candidate.evaluation.relation_name is None or candidate.evaluation.relation_name == "":
            self.logger.error(f"Relation {relation_id} has no relation name, cannot undo.")
            return
        await self.graph_db.remove_relation(candidate.evaluation.relation_name, {RELATION_ID_KEY: relation_id})

        candidate.is_applied = False
        if manual:
            candidate.manually_intervened = FkeyRelationManualIntervention.REJECTED
        else:
            candidate.manually_intervened = FkeyRelationManualIntervention.NONE
        await self.update_candidate_metadata(relation_id, is_applied=candidate.is_applied, manual_intervention=candidate.manually_intervened)


    async def sync_relation(self, client_name: str, relation_id: str):
        """
        Syncs the relation with the graph database based on the heuristic evaluation.
        This function checks the relation confidence and applies or unapplies the relation accordingly.
        """

        self.logger.debug(f"Syncing relation {relation_id}")
        # Fetch the heuristic for the relation_id
        candidate = await self.fetch_candidate(relation_id)
        if candidate is None:
            self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
            return

        if candidate.evaluation is None:
            self.logger.warning(f"Relation candidate {relation_id} has no evaluation, cannot sync relation.")
            return
        
        if helpers.is_accepted(candidate.evaluation.relation_confidence, self.acceptance_threshold):
            # If the relation confidence is above the acceptance threshold, we apply the relation
            await self.apply_relation(client_name, relation_id)
            return
        
        if helpers.is_rejected(candidate.evaluation.relation_confidence, self.rejection_threshold):
            # If the relation confidence is below the acceptance threshold, we reject the relation
            await self.unapply_relation(relation_id)
            return

        # If the relation confidence is between the acceptance and rejection thresholds, we set it to pending
        await self.unapply_relation(relation_id)  # reject the relation 