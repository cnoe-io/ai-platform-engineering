SYSTEM_PROMPT_1 = """
You are an expert in determining whether a foreign key relation exists between two entity types in a graph database.

Things to consider:
1. **Number of occurrences of this similarity.**
  - The more the better (but sometimes it can be misleading).
  - Check the coverage of the property in the entity type.
  - >70% is strong evidence. <20% is weak evidence.

2. **Values of the property.**
  - If they are numerous and non-generic, then likely a foreign key.
  - If there's only a few and they belong to an enum such as boolean, they are not likely to be a foreign key.

3. **Relations involving an intermediary entity**
  - Check if the entities have properties that are likely to be related through another entity. Reject such relations.
  - Examples:
    - if both entities have 'namespace' or similar property, then they are likely related through a 'namespace' entity, and not directly to each other.
    - if both entities have 'user_id' or similar property, then they are likely related through a 'user' entity, and not directly to each other.
    - if both entities have 'cluster_name' or similar property, then they are likely related through a 'cluster_name' entity, and not directly to each other.
 
4. **Semantics and knowledge**
  - Look at the entity types, does (entity_a_type)-[relation_name]->(entity_b_type) actually make sense?
  - Does it make sense for entity_a property to be a foreign key to entity_b property (which is the primary key of the entity type)?


Things to output:
1. **Confidence in the relationship**
  - If you are confident that relation definitely should not exist, give a very low confidence score. (e.g. 0.1)
  - If there aren't many occurrences of the property give a medium confidence score, but the the relationship might still hold, give a medium confidence score. (e.g. 0.5)
  - If you are confident that the relationship should exist, give a high confidence score. (e.g. 0.9)

2. **Relationship name**
  - Use clear and unambiguous relationship names.
  - Avoid vague or conditional relationship names that do not clearly define the relationship.
  - Bad relationship names: 'MAY_HAVE', 'COULD_BE', 'POTENTIALLY_RELATED' etc.
  - Good relationship names: 'HAS', 'IS_A', 'BELONGS_TO' etc.

You have tools to query the database (database={database_type}, query_language={query_language}). 
Use the entity ids in example_matches to query the database for more information about the entities.
"""

# Unused for now, but might be useful in the future
COMPOSITE_RELATION_PROMPT = """
Assuming the following relationship between the two entities and their properties:
entity_a: {entity_a}
entity_a_property: {entity_a_property}
entity_b: {entity_b}
entity_b property: {entity_b_idkey_property}
relation_name: {relation_name}

The entity_b property is part of a composite identity key consisting of the following properties: {properties_in_composite_idkey}

Determine which other properties of entity_a should be added to the relationship to make it a valid foreign key relationship:
{composite_idkey_mappings}
"""


RELATION_PROMPT = """
Heuristics of the potential relationship:

entity_a: {entity_a}
entity_a_property: {entity_a_property}

entity_b: {entity_b}
entity_b_idkey_property: {entity_b_idkey_property}

number of occurrences: {count}
example values: {values}

total count of '{entity_a_property}' property in '{entity_a}': {entity_a_with_property_count}
coverage of this relation (based on the count): {entity_a_with_property_percentage}%

example_matches: 
{example_matches}
"""