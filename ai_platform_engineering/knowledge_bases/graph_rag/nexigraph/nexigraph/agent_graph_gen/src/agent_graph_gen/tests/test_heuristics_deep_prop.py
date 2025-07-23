
from typing import List, Tuple
import pytest

from core.models import PropertyMapping

from ..heuristics import HeuristicsProcessor
from core.models import Entity
import logging

class DeepSearchTestCase:
    def __init__(self, entity_to_search: Entity, test_matches: List[Tuple[Entity, float]], property_to_search: str, expected_mappings: List[List[PropertyMapping]]):
        self.entity_to_search = entity_to_search
        self.test_matches = test_matches
        self.property_to_search = property_to_search
        self.expected_mappings = expected_mappings

test_cases = [
    DeepSearchTestCase(
        entity_to_search=Entity(
            entity_type="resource",
            primary_key_properties=["arn"],
            additional_key_properties=[],
            all_properties={
                "arn": "arn:aws:resource:us-west-2:123456789012:resource/johnsbucket",
                "name": "johnsbucket",
                "tag.owner": "jdoe",
                "tag.owner.username": "jdoe",
                "account_id": "123456789012"
            }
        ),
        test_matches=[
            (Entity(
                entity_type="user",
                primary_key_properties=["id"],
                additional_key_properties=[["email"]],
                all_properties={
                    "id": "jdoe",
                    "name": "John Doe",
                    "email": "john.doe@example.com"
                }
            ), 1.0)
        ],
        property_to_search="tag.owner",
        expected_mappings=[
            [
                PropertyMapping(
                    entity_a_property="tag.owner",
                    entity_b_idkey_property="id",
                )
            ]
        ]
    ),

    DeepSearchTestCase(
        entity_to_search=Entity(
            entity_type="deployment",
            primary_key_properties=["name", "namespace", "cluster_name"],
            additional_key_properties=[],
            all_properties={
                "name": "test_app",
                "namespace": "app1",
                "cluster_name": "dev-cluster",
                "spec.replicas": 3,
            }
        ),
        test_matches=[
            (Entity(
                entity_type="namespace",
                primary_key_properties=["name", "cluster_name"],
                additional_key_properties=[],
                all_properties={
                    "name": "app1",
                    "cluster_name": "dev-cluster",
                    "labels": "xyz"
                }
            ), 1.0)
        ],
        property_to_search="namespace",
        expected_mappings=[
            [
                PropertyMapping(
                    entity_a_property="namespace",
                    entity_b_idkey_property="name",
                ),
                PropertyMapping(
                    entity_a_property="cluster_name",
                    entity_b_idkey_property="cluster_name",
                )
            ]
        ]
    ),
    DeepSearchTestCase(
        entity_to_search=Entity(
            entity_type="ingress",
            primary_key_properties=["name", "namespace", "cluster_name"],
            additional_key_properties=[],
            all_properties={
                "name": "test_app_ingress",
                "namespace": "app1",
                "cluster_name": "dev-cluster",
                "spec.target.svc": "app1_svc",
                "spec.irrelavant.property": "dev-cluster"
            }
        ),
        test_matches=[
            (Entity(
                entity_type="service",
                primary_key_properties=["name", "namespace", "cluster_name"],
                additional_key_properties=[],
                all_properties={
                    "name": "app1_svc",
                    "namespace": "app1",
                    "cluster_name": "dev-cluster",
                    "labels": "xyz"
                }
            ), 1.0)
        ],
        property_to_search="spec.target.svc",
        expected_mappings=[
        [
            PropertyMapping(
                entity_a_property="spec.target.svc",
                entity_b_idkey_property="name",
            ),
            PropertyMapping(
                entity_a_property="namespace",
                entity_b_idkey_property="namespace",
            ),
            PropertyMapping(
                entity_a_property="cluster_name",
                entity_b_idkey_property="cluster_name",
            )
        ],
        [
            PropertyMapping(
                entity_a_property="spec.target.svc",
                entity_b_idkey_property="name",
            ),
            PropertyMapping(
                entity_a_property="namespace",
                entity_b_idkey_property="namespace",
            ),
            PropertyMapping(
                entity_a_property="spec.irrelavant.property",
                entity_b_idkey_property="cluster_name",
            )
        ]]
    ),
    DeepSearchTestCase(
        entity_to_search=Entity(
            entity_type="ingress",
            primary_key_properties=["name", "namespace", "cluster_name"],
            additional_key_properties=[],
            all_properties={
                "name": "test_app_ingress",
                "namespace": "app1",
                "cluster_name": "dev-cluster",
                "spec.target.svc": "app1_svc",
            }
        ),
        test_matches=[
            (Entity(
                entity_type="cluster",
                primary_key_properties=["name"],
                additional_key_properties=[],
                all_properties={
                    "name": "dev-cluster",
                    "labels": "xyz"
                }
            ), 1.0),
            (Entity(
                entity_type="namespace",
                primary_key_properties=["name", "cluster_name"],
                additional_key_properties=[],
                all_properties={
                    "name": "app1",
                    "cluster_name": "dev-cluster",
                    "labels": "abc"
                }
            ), 1.0)
        ],
        property_to_search="cluster_name",
        expected_mappings=[
            [  # match for cluster type
                PropertyMapping(
                    entity_a_property="cluster_name",
                    entity_b_idkey_property="name",
                )
            ],
            [  # match for namespace type
                PropertyMapping(
                    entity_a_property="cluster_name",
                    entity_b_idkey_property="cluster_name",
                ),
                PropertyMapping(
                    entity_a_property="namespace",
                    entity_b_idkey_property="name",
                )
            ]
        ]
    )
]


@pytest.mark.asyncio(loop_scope="session")
async def test_deep_property_match():
    logger = logging.getLogger("test_logger")
    logger.setLevel(logging.DEBUG)

    hp = HeuristicsProcessor(graph_db=None, rc_manager=None) # type:ignore Mocked for testing
    for test_case in test_cases:
        entity_property_value = test_case.entity_to_search.all_properties.get(test_case.property_to_search, None)
        if entity_property_value is None:
            raise ValueError(f"Property '{test_case.property_to_search}' not found in entity {test_case.entity_to_search.entity_type} with properties {test_case.entity_to_search.all_properties}")
        res = await hp.deep_property_match(
            entity=test_case.entity_to_search,
            entity_property=test_case.property_to_search,
            entity_property_value=entity_property_value,
            logger=logger,
            matches=test_case.test_matches
        )
        assert len(res) == len(test_case.expected_mappings), f"Expected {len(test_case.expected_mappings)} mappings, got {len(res)}"
        expected_mappings = set()
        for tcm in test_case.expected_mappings:
            mappings_for_one_test_case = set()
            for m in tcm:
                mappings_for_one_test_case.add((m.entity_a_property, m.entity_b_idkey_property))
            expected_mappings.add(frozenset(mappings_for_one_test_case))

        actual_mappings = set()
        for result in res:
            result_mappings = set()
            for m in result.matching_properties:
                result_mappings.add((m.entity_a_property, m.entity_b_idkey_property))
            actual_mappings.add(frozenset(result_mappings))
        assert len(expected_mappings.difference(actual_mappings)) == 0, f"Expected mappings {expected_mappings}, got {actual_mappings} for entity {test_case.entity_to_search.entity_type} with property {test_case.property_to_search}"
