# ============================================================================
# Common constants used across the application
# ============================================================================

# =============================
# Graph database constants
# =============================
PRIMARY_ID_KEY = '_entity_pk'  # The primary identity key
ALL_IDS_KEY = '_all_ids' # The key to store the values of the identity keys
ALL_IDS_PROPS_KEY = '_all_ids_props' # The key to store property names of the identity keys - the first one is always the primary identity key
FRESH_UNTIL_KEY = '_fresh_until'
ENTITY_TYPE_KEY = '_entity_type'
PROP_DELIMITER="_|||_" # Delimiter used for concatenating multiple property values (like identity properties)
LAST_UPDATED_KEY = '_last_updated'
INGESTOR_ID_KEY = '_ingestor_id'
DATASOURCE_ID_KEY = '_datasource_id'
JSON_ENCODED_KEY='_json_encoded'
RELATION_UPDATED_BY_KEY = '_relation_updated_by'

# Entity constants
DEFAULT_LABEL = 'NxEntity' 
PROPERTY_VALUE_MAX_LENGTH = 200  # Maximum length for a property value

# Relation constants
ONTOLOGY_RELATION_ID_KEY= "_ontology_relation_id" # The id used to track relations in data graph and the reference to the relation in ontology graph
ONTOLOGY_VERSION_ID_KEY = "_ontology_version_id" # The id used to track the ontology version
ENTITY_TYPE_NAME_KEY = "entity_type_name" # The name of the entity type - used in ontology database to track entity types

# =============================
# Redis constants
# =============================
KV_ONTOLOGY_VERSION_ID_KEY = "graph_rag/ontology_version_id" # Ontology version id key

# Redis key prefixes for metadata storage
REDIS_DATASOURCE_PREFIX = "rag/datasource:"
REDIS_DATASOURCE_DOCUMENTS_PREFIX = "rag/datasource_documents:"
REDIS_INGESTOR_PREFIX = "rag/ingestor:"

# Redis key prefixes for job management
REDIS_JOB_PREFIX = "job:"
REDIS_JOB_DATASOURCE_INDEX_PREFIX = "jobs:by_datasource:"
REDIS_JOB_ERRORS_SUFFIX = ":errors"


# =============================
# Other constants
# =============================
WEBLOADER_INGESTOR_REDIS_QUEUE = "ingestor:webloader:requests"
WEBLOADER_INGESTOR_TYPE = "webloader"
WEBLOADER_INGESTOR_NAME = "default_webloader" 


