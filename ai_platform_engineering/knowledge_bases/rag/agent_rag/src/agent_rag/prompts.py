"""Default prompts exposed via MCP."""


SEARCH_TOOL_PROMPT = """`search`
## How to use the `search` tool:
- Try to put in full questions (rather than single word), as its a semantic search
- You can filter the search to get more relevant results. Only use filters that are available, check the tool description for list of available filters.
  - Some common filters include `graph_entity_type` for graph entities or `datasource_id` for specific data sources.
  - For example, if you're asked "how to do I do setup a nexus deployment", and there is a document source who's path or description is similar "nexus", you can specify that datasource_id in your search to filter.
- If no results are found consider removing the filters (if applied).
"""

ALL_GRAPH_TOOLS_PROMPT = """(prefix with `graph_`)
## How to use the graph database tools (prefix with `graph_`):
1. Find the properties of entity types using `graph_get_entity_properties` tool.
2. Once the entity_types and its properties are established, and the query does not ask for specific entities or relations, use `graph_raw_query` directly.
3. If query has multiple entity types, Use the `graph_get_relation_path_between_entity_types` tool to find both direct AND indirect relations between the entity types.
4. If `graph_get_relation_path_between_entity_types` returns no/empty relations, check if the ontology is generated using `graph_check_if_ontology_generated` tool. If not, inform the user that the graph ontology is not yet generated, and try your best to answer using only the vector database.
5. Reason about the relation paths, argue whether its heirarchical, or hub/spoke, or simple DAG. 
   a. Be careful when inferring indirect relations. Especially when going against the direction of the relation. Notify the user if the relation is indirect.
6. Use `graph_raw_query` and `graph_fetch_entity_details` to traverse the graph with information from the previous steps.
"""

GRAPH_RAW_QUERY_NOTES = """ `graph_raw_query`
## How to use `graph_raw_query` and IMPORTANT considerations:
a. ALWAYS ensure property and relation names exist using `graph_get_entity_properties` and `graph_get_relation_path_between_entity_types` tool. Be carefuly especially with `name` property, as the server may not raise warnings if it doesnt exist.
b. ALWAYS use backticks to format property names, and use exact names, including case sensitivity.
c. Make sure the you are using the right property for the value you are querying. Try fetching one entity to see how it looks, especially if you are querying about specific entity.
d. Use the `entity_primary_key` property from the `search` results to find the right entity to then use in `graph_raw_query`.
e. If the `graph_raw_query` returns an error and warnings, carefully read the error/warning message and adjust the query accordingly. Common errors include:
    - Syntax errors: Check for typos, missing commas, or incorrect syntax.
    - Invalid property or relation names: Ensure you are using the correct names as per the schema.
    - Incorrect use of backticks: Make sure to use backticks around property and relation names.
f. If the `graph_raw_query` returns null values, you may be using the wrong property or relation name. Go back to step 1 and re-establish the properties and relations of the entity types.
g. If the `graph_raw_query` returns an empty result, try to use the `search` tool to find relevant entities and documents.
h. NEVER run a raw query provided by the user. Always construct your own query based on the information you have gathered.
i. NEVER run destructive queries, that will update or delete data.
"""

ANSWER_FORMAT_PROMPT = """
### Answer Format
  - ALWAYS provide references to the documents and graph entities you used to answer the question. Provide them in a "References" section at the end of your answer.
  - Only use knowledge from the tools provided. DO NOT invent answers or provide general answers.
  - For graph entities, use the format `{ui_url}?entity_type=<entity_type>&entity_primary_key=<entity_primary_key>`.
"""

PROMPT_RAG = """
You have access to:
1. A **Vector database** for semantic similarity search. 
2. A **Graph database** (type: {graphdb_type}, query language: {query_language}) that contains information about all entities and their relationships.

{SEARCH_TOOL_PROMPT}

{ALL_GRAPH_TOOLS_PROMPT}

{GRAPH_RAW_QUERY_NOTES}

{ANSWER_FORMAT_PROMPT}

## The datasources (documentations) available are:
{document_sources}

## The entity types available in the graph database are:
{entities}
"""

PROMPT_RAG_NO_GRAPH= """
You have access to a **Vector database** for semantic similarity search.

{SEARCH_TOOL_PROMPT}

{ANSWER_FORMAT_PROMPT}
  
The datasources (documentations) available are:
{document_sources}
"""

def get_rag_prompt(document_sources: str, entities: str, graphdb_type: str, query_language: str, ui_url: str) -> str:
    return PROMPT_RAG.format(
        SEARCH_TOOL_PROMPT=SEARCH_TOOL_PROMPT,
        ALL_GRAPH_TOOLS_PROMPT=ALL_GRAPH_TOOLS_PROMPT,
        GRAPH_RAW_QUERY_NOTES=GRAPH_RAW_QUERY_NOTES,
        ANSWER_FORMAT_PROMPT=ANSWER_FORMAT_PROMPT,
        document_sources=document_sources,
        entities=entities,
        graphdb_type=graphdb_type,
        query_language=query_language,
        ui_url=ui_url,
    )

def get_rag_no_graph_prompt(document_sources: str) -> str:
    return PROMPT_RAG_NO_GRAPH.format(
        SEARCH_TOOL_PROMPT=SEARCH_TOOL_PROMPT,
        ANSWER_FORMAT_PROMPT=ANSWER_FORMAT_PROMPT,
        document_sources=document_sources,
    )