# Graph DB constants

# Special properties for entities
FRESH_UNTIL_KEY = '_fresh_until'
PRIMARY_ID_KEY = '_primary_key'
ALL_IDS_KEY = '_all_ids' # The values of the identity keys
ALL_IDS_PROPS_KEY = '_all_ids_props' # The properties that make up the identity keys
PROP_DELIMITER=" ||| "
ENTITY_TYPE_KEY = '_entity_type'
LAST_UPDATED_KEY = '_last_updated'
UPDATED_BY_KEY = '_updated_by'
JSON_ENCODED_KEY='_json_encoded'

# Entity constants
DEFAULT_LABEL = 'NxEntity' 
PROPERTY_VALUE_MAX_LENGTH = 200  # Maximum length for a property value

# Relation constants
RELATION_CONFIDENCE_KEY = "_relation_confidence"
PLACEHOLDER_RELATION_NAME = "TBD"
ONTOLOGY_RELATION_ID_KEY= "_ontology_relation_id" # The id used to track relations in data graph and the reference to the relation in ontology graph

# Constants for ontology entities and relations
HEURISTICS_VERSION_ID_KEY = "_heuristics_version_id" # The id used to track the heuristics version
ENTITY_TYPE_NAME_KEY = "entity_type_name" # The name of the entity type

# Key-value store constants
KV_HEURISTICS_VERSION_ID_KEY = "graph_rag/heuristics_version_id" # Heuristics version id key for kv store
