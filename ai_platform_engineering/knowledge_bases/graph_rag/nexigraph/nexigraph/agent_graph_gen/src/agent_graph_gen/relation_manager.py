import hashlib
import json
import time
from typing import List
from core import utils
from core import constants
import agent_graph_gen.helpers as helpers
from core.models import PropertyMapping, Entity, ExampleEntityMatch, FkeyEvaluation, FkeyHeuristic, FkeyRelationManualIntervention, Relation, RelationCandidate
from core.graph_db.base import GraphDB


class RelationCandidateManager:
    """
    Heuristic class for determining foreign key relations between tables.
    This class implements a set of functions to identify potential foreign key relationships
    """

    def __init__(self, graph_db: GraphDB, ontology_graph_db: GraphDB, acceptance_threshold: float, rejection_threshold: float, heuristics_version_id: str):

        self.data_graph_db = graph_db
        self.ontology_graph_db = ontology_graph_db
        self.logger = utils.get_logger("rc_manager")
        self.max_relation_examples = 10
        self.acceptance_threshold = acceptance_threshold
        self.rejection_threshold = rejection_threshold
        self.heuristics_version_id = heuristics_version_id


    async def cleanup(self):
        """
        Deletes all relation candidates that are not from the current heuristics version.
        This is used to reset the relation candidates, e.g. when starting a new dataset.
        """
        self.logger.info("Cleaning up relation candidates from the database")
        await self.ontology_graph_db.raw_query(f"MATCH ()-[r]->() WHERE r.heuristics_version_id <> '{self.heuristics_version_id}' DELETE r")
        await self.ontology_graph_db.raw_query(f"MATCH (n) WHERE n.heuristics_version_id <> '{self.heuristics_version_id}' DETACH DELETE n")


    async def _set_heuristic(self, relation_id: str, candidate: RelationCandidate, recreate: bool = False):
        """
        Sets a relation candidate in the ontology graph database.
        """
        self.logger.debug(f"[{relation_id}] Updating relation candidate")

        self.logger.debug(f"[{relation_id}] Updating entities in ontology, entity_type={candidate.heuristic.entity_a_type}")
        # Update entity a and b (if not already present)
        entity_a = Entity(
            primary_key_properties=["entity_type_name", "heuristics_version_id"],
            entity_type=candidate.heuristic.entity_a_type,
            all_properties={
                "entity_type_name": candidate.heuristic.entity_a_type,
                "heuristics_version_id": self.heuristics_version_id
            })
        await self.ontology_graph_db.update_entity(entity_a, fresh_until=utils.get_default_fresh_until(), client_name="relation_manager")
        entity_b = Entity(
            primary_key_properties=["entity_type_name", "heuristics_version_id"],
            entity_type=candidate.heuristic.entity_b_type,
            all_properties={
                "entity_type_name": candidate.heuristic.entity_b_type,
                "heuristics_version_id": self.heuristics_version_id
            })
        await self.ontology_graph_db.update_entity(entity_b, fresh_until=utils.get_default_fresh_until(), client_name="relation_manager")

        # Use the evaluation relation name if available (and accepted)
        relation_name = constants.PLACEHOLDER_RELATION_NAME
        if candidate.evaluation and candidate.evaluation.relation_name and helpers.is_accepted(candidate.evaluation.relation_confidence, self.acceptance_threshold):
            relation_name = candidate.evaluation.relation_name

        if recreate:
            self.logger.info(f"[{relation_id}] Recreating relation in ontology")
            # Check if the relation already exists
            existing_relation = await self.ontology_graph_db.find_relations(from_entity_type=entity_a.entity_type, 
                            to_entity_type=entity_b.entity_type, properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, "heuristics_version_id": self.heuristics_version_id})
            
            self.logger.debug(f"[{relation_id}] Found existing relation: {existing_relation}")
            # Remove the existing relation if it exists
            if existing_relation:
                await self.ontology_graph_db.remove_relation(constants.PLACEHOLDER_RELATION_NAME, properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, "heuristics_version_id": self.heuristics_version_id})
                await self.ontology_graph_db.remove_relation(relation_name, properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, "heuristics_version_id": self.heuristics_version_id})

        self.logger.debug(f"[{relation_id}] Updating relation in ontology, count: {candidate.heuristic.count}")
        # Update the relation
        await self.ontology_graph_db.update_relation(
            Relation(
                from_entity=entity_a.get_identifier(),
                to_entity=entity_b.get_identifier(),
                relation_name=relation_name,
                primary_key_properties=[constants.ONTOLOGY_RELATION_ID_KEY, "heuristics_version_id"],
                relation_properties={
                    constants.ONTOLOGY_RELATION_ID_KEY: relation_id,
                    "heuristics_version_id": self.heuristics_version_id,
                    "heuristic": candidate.heuristic.model_dump_json(),
                    "is_applied": candidate.is_applied,
                    "manually_intervened": candidate.manually_intervened,
                    "evaluation_error_message": candidate.evaluation_error_message if candidate.evaluation_error_message else "",
                    "evaluation": candidate.evaluation.model_dump_json() if candidate.evaluation else ""
                }
            ),
            fresh_until=utils.get_default_fresh_until(),
            client_name="relation_manager"
        )

    async def fetch_all_candidates(self) -> dict[str, RelationCandidate]:
        """
        Fetches all relation candidates from the ontology graph database.
        """
        self.logger.debug("Fetching all heuristics from the database.")
        
        # Get all relations and filter for those with relation_id property (these are our candidates)
        candidate_relations = await self.ontology_graph_db.find_relations(properties={"heuristics_version_id": self.heuristics_version_id})
        
        if not candidate_relations:
            self.logger.warning("No heuristics found in the database.")
            return {}

        heuristics = {}
        for relation in candidate_relations:
            if not relation.relation_properties:
                self.logger.warning(f"Relation {relation} has no relation properties.")
                continue
            relation_id = relation.relation_properties.get(constants.ONTOLOGY_RELATION_ID_KEY)
            if not relation_id:
                continue
                
            heuristic_json = relation.relation_properties.get("heuristic", "")
            evaluation_json = relation.relation_properties.get("evaluation", "")
            is_applied = relation.relation_properties.get("is_applied", False)
            manually_intervened = relation.relation_properties.get("manually_intervened", None)
            evaluation_error_message = relation.relation_properties.get("evaluation_error_message", None)
            
            # Reconstruct the RelationCandidate object
            heuristic = FkeyHeuristic.model_validate_json(heuristic_json)
            evaluation = FkeyEvaluation.model_validate_json(evaluation_json) if evaluation_json else None
            
            candidate = RelationCandidate(
                relation_id=relation_id,
                heuristic=heuristic,
                evaluation=evaluation,
                is_applied=is_applied,
                manually_intervened=manually_intervened,
                evaluation_error_message=evaluation_error_message
            )
            
            heuristics[relation_id] = candidate

        return heuristics

    async def fetch_candidate(self, relation_id: str) -> RelationCandidate|None:
        """
        Fetches a relation candidate from the ontology graph database.
        """
        self.logger.debug(f"Fetching heuristic for relation_id={relation_id}")
        
        # Find relations with the specific relation_id
        relations = await self.ontology_graph_db.find_relations(properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, "heuristics_version_id": self.heuristics_version_id})
        
        if not relations:
            self.logger.warning(f"Heuristic {relation_id} not found in the database.")
            return None
        
        # Get the first matching relation (should be unique by relation_id)
        relation = relations[0]

        if not relation.relation_properties:
            self.logger.warning(f"Relation {relation} has no relation properties.")
            return None
        
        heuristic_json = relation.relation_properties.get("heuristic", "")
        evaluation_json = relation.relation_properties.get("evaluation", "")
        is_applied = relation.relation_properties.get("is_applied", False)
        manually_intervened = relation.relation_properties.get("manually_intervened", None)
        evaluation_error_message = relation.relation_properties.get("evaluation_error_message", None)
        
        # Reconstruct the RelationCandidate object
        heuristic = FkeyHeuristic.model_validate_json(heuristic_json)
        evaluation = FkeyEvaluation.model_validate_json(evaluation_json) if evaluation_json else None
        
        candidate = RelationCandidate(
            relation_id=relation_id,
            heuristic=heuristic,
            evaluation=evaluation,
            is_applied=is_applied,
            manually_intervened=manually_intervened,
            evaluation_error_message=evaluation_error_message
        )
        
        return candidate

    def generate_relation_id(self, entity_type: str, matched_entity_type: str, property_mappings: List[PropertyMapping]) -> str:
        """
        Generates a unique relation ID for the given entity, matched entity and properties that are being matched.
        """
        props_dict = {}
        for prop in property_mappings:
            props_dict[prop.entity_a_property] = prop.entity_b_idkey_property
        rc_dict = {
            "entity_type": entity_type,
            "matched_entity_type": matched_entity_type,
            "property_mappings": props_dict
        }
        prop_json = json.dumps(rc_dict, sort_keys=True, cls=utils.ObjEncoder)
        prop_md5 = hashlib.md5(prop_json.encode())
        relation_id = prop_md5.hexdigest()
        self.logger.debug(f"JSON:{prop_json}\n\tGenerated relation ID: {relation_id}")
        return relation_id

    async def update_heuristic(self, 
                               relation_id: str,
                               entity: Entity, 
                               entity_property_key: str,  
                               matched_entity: Entity, 
                               additional_count: int, 
                               property_mappings: List[PropertyMapping],
                               matching_entity_id_key: List[str]):
        """
        Updates the heuristics for the given relation_id and matched entity. If the relation candidate does not exist, it creates a new one.
        :param relation_id: The relation_id for the heuristic.
        :param entity: The entity for which the heuristic is being created/updated.
        :param entity_property_key: The property key of the entity that is being matched.
        :param matched_entity: The matched entity.
        :param additional_count: The count of matches for the heuristic. This will be added to the existing count if the heuristic already exists.
        :param property_mappings: A list of property mappings that map properties from the entity to the matched entity.
        :param matching_entity_id_key: The identity key of the entity that is being matched.
        :return: None
        """
        self.logger.debug("Creating/Updating relation_id=%s", relation_id)
        # Fetch the heuristic for the relation_id
        self.logger.debug(f"Fetching heuristic for relation_id={relation_id}")
        # await asyncio.sleep(1)
        candidate = await self.fetch_candidate(relation_id)
        self.logger.debug(f"Fetched heuristic for relation_id={relation_id}, count: {candidate.heuristic.count if candidate else 0}")

        # If the heuristic does not exist, we create a new one
        if candidate is None:
            self.logger.debug(f"Relation candidate '{relation_id}' doesnt exist, Creating new one.")
            candidate = RelationCandidate(
                relation_id=relation_id,
                heuristic=FkeyHeuristic(
                    entity_a_type=entity.entity_type,
                    entity_b_type=matched_entity.entity_type,
                    entity_a_property=entity_property_key,
                    properties_in_composite_idkey=frozenset(matching_entity_id_key),
                    count=additional_count,
                    property_mappings=property_mappings,
                    example_matches= [ExampleEntityMatch(entity_a_id=entity.generate_primary_key(), entity_b_id=matched_entity.generate_primary_key())]
                )
            )
        else:
            # If the heuristic already exists, we update the count and example matches
            if len(candidate.heuristic.example_matches) < self.max_relation_examples:
                candidate.heuristic.example_matches.append(ExampleEntityMatch(entity_a_id=entity.generate_primary_key(), entity_b_id=matched_entity.generate_primary_key()))

            candidate.heuristic.count += additional_count

        # Save the heuristic to the database
        self.logger.debug(f"Saving heuristic for relation_id={relation_id}, heuristic: {candidate.heuristic}")
        await self._set_heuristic(relation_id, candidate)

        # Debugging: fetch the heuristic to make sure it was saved correctly
        fetched_candidate = await self.fetch_candidate(relation_id)
        self.logger.debug(f"Debug: Checking saved heuristic for relation_id={relation_id}, count: {fetched_candidate.heuristic.count}")


    async def update_evaluation_error(self, relation_id: str, error_message: str):
        """
        Updates the evaluation error message for the given relation_id. This is mostly used to make it easier to debug issues with evaluation.
        :param relation_id: The ID of the relation to update.
        :param error_message: The error message to set.
        """
        self.logger.debug(f"Updating evaluation error for {relation_id}")
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
                                entity_a_property_values: dict[str, List[str]],
                                entity_a_property_counts: dict[str, int],
                                evaluation_count: int):
        """
        Updates the evaluation for the given relation_id.
        :param relation_id: The ID of the relation to update.
        :param relation_name: The name of the relation.
        :param relation_confidence: The confidence of the relation.
        :param justification: Justification for the relation and the confidence.
        :param thought: The agent's thoughts about the relation.
        :param entity_a_property_values: The values of the properties of entity_a that were used to evaluate the relation.
        :param entity_a_property_counts: The counts of the properties of entity_a that were used to evaluate the relation.
        :param evaluation_count: The count of the evaluation.
        """
        self.logger.debug(f"Updating evaluation for {relation_id}")
        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
        candidate = await self.fetch_candidate(relation_id)
        if candidate is None:
            self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
            return
        candidate.evaluation = FkeyEvaluation(
            relation_name=relation_name,
            relation_confidence=relation_confidence,
            justification=justification,
            thought=thought,
            entity_a_property_values=entity_a_property_values,
            entity_a_property_counts=entity_a_property_counts,
            last_evaluated=int(time.time()),
            last_evaluation_count=evaluation_count
        )

        await self._set_heuristic(relation_id, candidate, recreate=True)

    async def update_candidate_metadata(self, relation_id: str,
                                        is_applied: bool,
                                        manual_intervention: FkeyRelationManualIntervention):
        """
        Update the metadata for the relation candidate.
        """
        self.logger.debug(f"Updating metadata for {relation_id}")
        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
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
        self.logger.info(f"Applying relation {relation_id}")
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
        await self.data_graph_db.remove_relation("", {constants.ONTOLOGY_RELATION_ID_KEY: relation_id})

         # If there are no wildcards, we can just relate the entities by property
        await self.data_graph_db.relate_entities_by_property(
            client_name=client_name,
            entity_a_type=candidate.heuristic.entity_a_type,
            entity_b_type=candidate.heuristic.entity_b_type,
            relation_type=candidate.evaluation.relation_name,
            matching_properties=matching_properties,
            relation_properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, 
                                 constants.RELATION_CONFIDENCE_KEY: candidate.evaluation.relation_confidence}
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
        await self.data_graph_db.remove_relation(candidate.evaluation.relation_name, {constants.ONTOLOGY_RELATION_ID_KEY: relation_id})

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

# if __name__ == "__main__":
    # rc = RelationCandidateManager(graph_db=Neo4jDB(), ontology_graph_db=Neo4jDB(uri=os.getenv("NEO4J_ONTOLOGY_ADDR", "bolt://localhost:7688")), acceptance_threshold=0.75, rejection_threshold=0.3)
