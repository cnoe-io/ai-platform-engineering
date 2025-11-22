import hashlib
import json
import time
from typing import Any, List
from common import utils
from common import constants
from common.models.ontology import PropertyMapping, ExampleEntityMatch, FkeyEvaluation, FkeyHeuristic, RelationCandidate, FkeyEvaluationResult
from common.models.graph import Entity, Relation
from common.graph_db.base import GraphDB


class RelationCandidateManager:
    """
    Heuristic class for determining foreign key relations between tables.
    This class implements a set of functions to identify potential foreign key relationships
    """
    def __init__(self, graph_db: GraphDB, ontology_graph_db: GraphDB, ontology_version_id: str, client_name: str):

        self.data_graph_db = graph_db
        self.ontology_graph_db = ontology_graph_db
        self.logger = utils.get_logger("rc_manager")
        self.max_relation_examples = 10
        self.ontology_version_id = ontology_version_id
        self.client_name = client_name


    def generate_placeholder_relation_name(self, relation_id: str) -> str:
        """
        Generates a placeholder relation name for a relation candidate.
        :param relation_id: The relation ID for which to generate the placeholder name.
        :return: str
        """
        return f"TBD_{relation_id}"

    async def cleanup(self):
        """
        Deletes all relation candidates that are not from the current heuristics version, as well as any applied relations.
        TODO: Move to the GraphDB class
        """
        self.logger.info("Cleaning up relation candidates from the database")
        await self.ontology_graph_db.raw_query(f"MATCH ()-[r]->() WHERE r.`{constants.ONTOLOGY_VERSION_ID_KEY}` <> '{self.ontology_version_id}' DELETE r")
        await self.ontology_graph_db.raw_query(f"MATCH (n) WHERE n.`{constants.ONTOLOGY_VERSION_ID_KEY}` <> '{self.ontology_version_id}' DETACH DELETE n")
        await self.data_graph_db.raw_query(f"MATCH ()-[r]-() WHERE r.`{constants.RELATION_UPDATED_BY_KEY}`=\"{self.client_name}\" AND r.`{constants.ONTOLOGY_VERSION_ID_KEY}` <> '{self.ontology_version_id}' DELETE r")


    async def _set_heuristic(self, relation_id: str, candidate: RelationCandidate, recreate: bool = False):
        """
        Sets a relation candidate in the ontology graph database.
        """
        self.logger.info(f"[{relation_id}] Updating relation candidate - {candidate}, recreate={recreate}")

        self.logger.debug(f"[{relation_id}] Updating entities in ontology, entity_type={candidate.heuristic.entity_a_type}")
        # Update entity a and b (if not already present)
        entity_a = Entity(
            primary_key_properties=[constants.ENTITY_TYPE_NAME_KEY, constants.ONTOLOGY_VERSION_ID_KEY],
            entity_type=candidate.heuristic.entity_a_type,
            all_properties={
                constants.ENTITY_TYPE_NAME_KEY: candidate.heuristic.entity_a_type,
                constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id
            })
        await self.ontology_graph_db.update_entity(candidate.heuristic.entity_a_type, [entity_a])
        entity_b = Entity(
            primary_key_properties=[constants.ENTITY_TYPE_NAME_KEY, constants.ONTOLOGY_VERSION_ID_KEY],
            entity_type=candidate.heuristic.entity_b_type,
            all_properties={
                constants.ENTITY_TYPE_NAME_KEY: candidate.heuristic.entity_b_type,
                constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id
            })
        await self.ontology_graph_db.update_entity(candidate.heuristic.entity_b_type, [entity_b])


        if recreate:
            self.logger.info(f"[{relation_id}] Recreating relation in ontology")
            # Check if the relation already exists
            existing_relation = await self.ontology_graph_db.find_relations(
                            from_entity_type=entity_a.entity_type, 
                            to_entity_type=entity_b.entity_type, 
                            properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id})

            self.logger.debug(f"[{relation_id}] Found existing relation, removing it first before recreating." if existing_relation else f"[{relation_id}] No existing relation found, proceeding to create new one.")
            # Remove the existing relation if it exists - name agnostic
            if existing_relation:
                await self.ontology_graph_db.remove_relation(None, properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id})

        self.logger.debug(f"[{relation_id}] Updating relation in ontology, count: {candidate.heuristic.count}")
            
        heuristic_dict = candidate.heuristic.model_dump()
        
        props = {
            constants.ONTOLOGY_RELATION_ID_KEY: relation_id,
            constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id,
            "heuristic_entity_a_type": candidate.heuristic.entity_a_type,
            "heuristic_entity_b_type": candidate.heuristic.entity_b_type,
            "heuristic_entity_a_property": candidate.heuristic.entity_a_property,
            "heuristic_count": candidate.heuristic.count,
            "heuristic_example_matches": utils.json_encode(heuristic_dict["example_matches"]),
            "heuristic_properties_in_composite_idkey": list(candidate.heuristic.properties_in_composite_idkey),
            "heuristic_property_mappings": utils.json_encode(heuristic_dict["property_mappings"]),
            "heuristic_last_processed": candidate.heuristic.last_processed,

            "error_message": candidate.error_message if candidate.error_message else "",
            "is_synced": candidate.is_synced,
            "last_synced": candidate.last_synced if candidate.last_synced else 0,
        }

        if candidate.evaluation:
            if candidate.evaluation.relation_name:
                relation_name = candidate.evaluation.relation_name
            else:
                raise ValueError(f"[{relation_id}] Evaluation provided but no relation name found. Evaluation must have a relation name. Evaluation: {candidate.evaluation}")

            evaluation = {
                "evaluation_relation_name": candidate.evaluation.relation_name,
                "evaluation_result": candidate.evaluation.result.value,
                "evaluation_justification": candidate.evaluation.justification,
                "evaluation_thought": candidate.evaluation.thought,
                "evaluation_last_evaluated": candidate.evaluation.last_evaluated,
                "evaluation_is_manual": candidate.evaluation.is_manual,
            }
            
            props.update(evaluation)
        else:
            relation_name = self.generate_placeholder_relation_name(relation_id)  # Use placeholder if no evaluation

        # Update the relation
        await self.ontology_graph_db.update_relation(
            Relation(
                from_entity=entity_a.get_identifier(),
                to_entity=entity_b.get_identifier(),
                relation_name=relation_name,
                relation_properties=props
            ),
        )


    async def _parse_relation_candidate(self, relation_properties: dict[str, Any]) -> RelationCandidate:
        """
        Parses a RelationCandidate from flattened relation properties.
        """
        relation_id = relation_properties.get(constants.ONTOLOGY_RELATION_ID_KEY)
        if not relation_id:
            raise ValueError("Missing relation_id in relation properties")
        
        # Reconstruct FkeyHeuristic
        heuristic_data = {
            "entity_a_type": relation_properties.get("heuristic_entity_a_type", ""),
            "entity_b_type": relation_properties.get("heuristic_entity_b_type", ""),
            "entity_a_property": relation_properties.get("heuristic_entity_a_property", ""),
            "count": relation_properties.get("heuristic_count", 0),
            "example_matches": json.loads(relation_properties.get("heuristic_example_matches", "[]")),
            "properties_in_composite_idkey": frozenset(relation_properties.get("heuristic_properties_in_composite_idkey", [])),
            "property_mappings": json.loads(relation_properties.get("heuristic_property_mappings", "[]")),
            "last_processed": relation_properties.get("heuristic_last_processed", 0)
        }
        heuristic = FkeyHeuristic.model_validate(heuristic_data)
        
        # Reconstruct FkeyEvaluation (if exists)
        evaluation = None
        if relation_properties.get("evaluation_last_evaluated", 0) > 0:
            evaluation_data = {
                "relation_name": relation_properties.get("evaluation_relation_name"),
                "result": relation_properties.get("evaluation_result", FkeyEvaluationResult.UNSURE),
                "justification": relation_properties.get("evaluation_justification", ""),
                "thought": relation_properties.get("evaluation_thought", ""),
                "last_evaluated": relation_properties.get("evaluation_last_evaluated", 0),
                "is_manual": relation_properties.get("evaluation_is_manual", False)
            }
            evaluation = FkeyEvaluation.model_validate(evaluation_data)
        
        return RelationCandidate(
            relation_id=relation_id,
            heuristic=heuristic,
            evaluation=evaluation,
            is_synced=relation_properties.get("is_synced", False),
            last_synced=relation_properties.get("last_synced", 0),
            error_message=relation_properties.get("error_message", "")
        )

    async def fetch_all_candidates(self) -> dict[str, RelationCandidate]:
        """
        Fetches all relation candidates from the ontology graph database.
        """
        self.logger.debug("Fetching all relation candidates from the database.")
        
        # Get all relations and filter for those with relation_id property (these are our candidates)
        candidate_relations = await self.ontology_graph_db.find_relations(properties={constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id})

        if not candidate_relations:
            self.logger.warning("No relation candidates found in the database.")
            return {}

        relation_candidates = {}
        for relation in candidate_relations:
            if not relation.relation_properties:
                self.logger.warning(f"Relation {relation} has no relation properties.")
                continue
            relation_id = relation.relation_properties.get(constants.ONTOLOGY_RELATION_ID_KEY)
            if not relation_id:
                continue
            
            candidate = await self._parse_relation_candidate(relation.relation_properties)
            
            relation_candidates[relation_id] = candidate

        return relation_candidates

    async def fetch_candidate(self, relation_id: str) -> RelationCandidate|None:
        """
        Fetches a relation candidate from the ontology graph database.
        """
        self.logger.debug(f"Fetching relation candidate for relation_id={relation_id}")
        
        # Find relations with the specific relation_id
        relations = await self.ontology_graph_db.find_relations(properties={constants.ONTOLOGY_RELATION_ID_KEY: relation_id, constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id})
        
        if not relations:
            return None
        
        # Get the first matching relation (should be unique by relation_id)
        relation = relations[0]

        if not relation.relation_properties:
            return None
        
        candidate = await self._parse_relation_candidate(relation.relation_properties)
        
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
                               matching_entity_idkey: List[str]):
        """
        Updates the heuristics for the given relation_id and matched entity. If the relation candidate does not exist, it creates a new one.
        :param relation_id: The relation_id for the heuristic.
        :param entity: The entity for which the heuristic is being created/updated.
        :param entity_property_key: The property key of the entity that is being matched.
        :param matched_entity: The matched entity.
        :param additional_count: The count of matches for the heuristic. This will be added to the existing count if the heuristic already exists.
        :param property_mappings: A list of property mappings that map properties from the entity to the matched entity.
        :param matching_entity_idkey: The identity key of the entity that is being matched.
        :return: None
        """
        self.logger.debug("Creating/Updating relation_id=%s", relation_id)
        # Fetch the heuristic for the relation_id
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
                    properties_in_composite_idkey=frozenset(matching_entity_idkey),
                    count=additional_count,
                    property_mappings=property_mappings,
                    example_matches= [ExampleEntityMatch(entity_a_pk=entity.generate_primary_key(), entity_b_pk=matched_entity.generate_primary_key())]
                ),
                evaluation=None,
            )
        else:
            # If the heuristic already exists, we update the count and example matches
            if len(candidate.heuristic.example_matches) < self.max_relation_examples:
                candidate.heuristic.example_matches.append(ExampleEntityMatch(entity_a_pk=entity.generate_primary_key(), entity_b_pk=matched_entity.generate_primary_key()))

            candidate.heuristic.count += additional_count


        # Set the synced flag to false as the heuristic has changed
        candidate.is_synced = False

        # Save the heuristic to the database
        self.logger.debug(f"Saving heuristic for relation_id={relation_id}, heuristic: {candidate.heuristic}")
        await self._set_heuristic(relation_id, candidate)


    async def update_evaluation(self, relation_id: str, 
                                relation_name: str, 
                                result: FkeyEvaluationResult, 
                                justification: str|None, 
                                thought: str,
                                is_manual: bool):
        """
        Updates the evaluation for the given relation_id.
        :param relation_id: The ID of the relation to update.
        :param relation_name: The name of the relation.
        :param result: The result of the evaluation.
        :param justification: Justification for the relation and the confidence.
        :param thought: The agent's thoughts about the relation.
        :param is_manual: Whether the evaluation was done manually.
        :return: None
        """
        self.logger.debug(f"Updating evaluation for {relation_id}")
        # Acquire a lock for the relation_id to avoid concurrent updates to the same heuristic
        candidate = await self.fetch_candidate(relation_id)
        if candidate is None:
            self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
            return

        if (relation_name is None or relation_name == ""):
            raise ValueError(f"Cannot update evaluation for relation {relation_id} without a relation name.")

        candidate.evaluation = FkeyEvaluation(
            relation_name=relation_name,
            result=result,
            justification=justification,
            thought=thought,
            last_evaluated=int(time.time()),
            is_manual=is_manual,
        )
        # Set the synced flag to false as the evaluation has changed
        candidate.is_synced = False

        # Save the updated evaluation to the database
        await self._set_heuristic(relation_id, candidate, recreate=True)

    async def remove_evaluation(self, relation_id: str):
        """
        Removes the evaluation for a relation candidate.
        This function is used to remove the evaluation for a relation candidate, effectively setting it back to unevaluated state.
        """
        self.logger.info(f"Removing evaluation for relation {relation_id}")
        candidate = await self.fetch_candidate(relation_id)
        if candidate is None:
            self.logger.warning(f"Relation candidate {relation_id} not found in the database.")
            return

        # Remove the evaluation
        candidate.evaluation = None
        candidate.is_synced = False

        # Update the relation candidate in the database, setting it as unevaluated
        await self._set_heuristic(relation_id, candidate, recreate=True)

    async def sync_relation(self, relation_id: str):
        """
        Syncs the relation with the graph database based on the heuristic evaluation.
        Checks the relation confidence and applies or unapplies the relation accordingly.
        This function checks the relation confidence and applies or unapplies the relation accordingly.
        """

        self.logger.info(f"Syncing relation {relation_id}")

        # Fetch the relation candidate if not provided
        self.logger.debug(f"Fetching relation candidate for relation_id={relation_id} for syncing.")
        candidate = await self.fetch_candidate(relation_id)

        # If the candidate does not exist, we cannot sync
        if candidate is None:
            self.logger.debug(f"Relation candidate {relation_id} does not exist. Removing any applied relation in the data graph.")
            await self._unapply_relation(relation_id)  # remove the relation if it existed
            return
        
        if candidate.evaluation is None: # No evaluation, unapply any existing relation
            self.logger.debug(f"Relation candidate {relation_id} has no evaluation. Removing any applied relation in the data graph.")
            await self._unapply_relation(relation_id)  # remove the relation if it existed

        else: # Evaluation exists, apply or unapply based on the result
            if candidate.evaluation.result == FkeyEvaluationResult.ACCEPTED:
                self.logger.debug(f"Relation candidate {relation_id} accepted. Applying relation to the data graph.")

                # sanity check for relation name
                if candidate.evaluation.relation_name is None or candidate.evaluation.relation_name == "":
                    self.logger.error(f"Relation {relation_id} has no relation name, cannot apply.")
                    candidate.error_message = "Cannot apply relation, no relation name provided in evaluation."

                else:
                    # Apply the relation
                    await self._apply_relation(relation_id, 
                                            candidate.evaluation.relation_name, 
                                            candidate.heuristic.property_mappings, 
                                            candidate.heuristic.entity_a_type, 
                                            candidate.heuristic.entity_b_type)
                    
            elif candidate.evaluation.result == FkeyEvaluationResult.REJECTED:
                self.logger.debug(f"Relation candidate {relation_id} rejected. Removing any applied relation in the data graph.")
                # Unapply the relation
                await self._unapply_relation(relation_id)
                candidate.evaluation.relation_name = self.generate_placeholder_relation_name(relation_id) # set to placeholder to indicate rejection
            else:
                self.logger.debug(f"Relation candidate {relation_id} neither accepted nor rejected, in unsure state, removing any applied relation in the data graph.")
                await self._unapply_relation(relation_id)  # remove the relation if it existed

        # Update the candidate synced status
        candidate.is_synced = True
        candidate.last_synced = int(time.time())

        await self._set_heuristic(relation_id, candidate, recreate=True)

    async def _apply_relation(self, 
                              relation_id: str, 
                              relation_name: str, 
                              property_mappings: List[PropertyMapping], 
                              entity_a_type: str, 
                              entity_b_type: str):
        """
        Applies the relation by creating a relation in the data graph database.
        This function is used to accept a relation candidate, effectively creating the relation in the graph.
        """
        self.logger.debug(f"Applying relation {relation_id}")
        if relation_name is None or relation_name == "":
            self.logger.error(f"Relation {relation_id} has no relation name, cannot apply.")
            return

        matching_properties = {}
        for prop in property_mappings:
            matching_properties[prop.entity_a_property] = prop.entity_b_idkey_property

        # remove relation if it is already applied
        await self._unapply_relation(relation_id)

         # If there are no wildcards, we can just relate the entities by property
        await self.data_graph_db.relate_entities_by_property(
            entity_a_type=entity_a_type,
            entity_b_type=entity_b_type,
            relation_type=relation_name,
            matching_properties=matching_properties,
            relation_properties={
                constants.ONTOLOGY_RELATION_ID_KEY: relation_id,
                constants.ONTOLOGY_VERSION_ID_KEY: self.ontology_version_id,
                constants.RELATION_UPDATED_BY_KEY: self.client_name
            }
        )
 
    async def _unapply_relation(self, relation_id: str):
        """
        Unapplies the relation by removing it from the data graph database.
        This function is used to reject a relation candidate, effectively removing the relation from the graph.
        """
        await self.data_graph_db.remove_relation(None, {constants.ONTOLOGY_RELATION_ID_KEY: relation_id})
