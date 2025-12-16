"""
RAG (Retrieval-Augmented Generation) prompt templates for the Platform Engineer agent.

This module contains all prompts related to using the knowledge base (RAG) tools,
including search, graph database queries, and document retrieval.
"""

from typing import Dict, Any, Optional
import logging
logger = logging.getLogger(__name__)


# ============================================================================
# RAG Prompt Components
# ============================================================================

_SEARCH_TOOL_PROMPT = """
### How to use the `search` tool:

- **IMPORTANT**: Try to put in full questions (rather than single word), as it does semantic search. E.g. "What is the nexus deployment process?" rather than "nexus deployment"
- You can filter the search to get more relevant results. Check the tool description for list of available filters.
- A common filter is to specify the `"datasource_id": "<datasource_id>"` to search only in a specific datasource.
  - For example, if you're asked "how do I setup a nexus deployment", and there is a datasource whose path or description is similar to "nexus", you can specify that datasource_id in your search to filter.
- If no relevant results are found, consider using different keywords.

### Understanding `search` tool Results:
- Each result has its content truncated to 500 chars and also has `metadata` attached to it. Check `is_graph_entity` to identify if the result is a graph entity.
- For **Documents**: Use `fetch_document` with the `document_id` from metadata to get full content
- For **Graph Entities** Use `graph_entity_type` and `graph_entity_pk` in the metadata to identify the entity, then use `graph_explore_data_entity` tool to explore the entity and its neighborhood.
"""

_ALL_GRAPH_TOOLS_PROMPT = """
### How and when to use the graph tools (prefix with `graph_`):
1. Understanding the Two Graphs:
 - **Ontology Graph** (`graph_*_ontology_*`): Contains the SCHEMA/structure - entity types, their properties, and relations between them
 -  **Data Graph** (`graph_*_data_*`): Contains the ACTUAL DATA - specific entity instances and their relationships

2. Check if the query mentions entity types. If it does, you can use the `graph_explore_ontology_entity` tool to understand the schema and properties of the entity types.
3. **Then query the data graph**: Use the `_entity_pk` from search results to identify specific entities, then use `graph_explore_data_entity` tool to explore the entity and its neighborhood.
4. If the query is complex, and contains multiple entity types:
   - Use the `graph_shortest_path_between_entity_types` tool and `graph_explore_ontology_entity` tool to understand the propert and relations between the entity types.
   - Then if you feel confident, use the `graph_raw_query_data` tool to query the data graph with direct queries.

**IMPORTANT Tips for When to Use Graph Raw Queries:**
 - **Numeric/Aggregate Queries**: For questions involving counts, sums, or filtering, prefer `graph_raw_query_data`:
   - ✅ "How many AWS accounts are there?" → Use Cypher: `MATCH (a:AWSAccount) RETURN COUNT(a)`
   - ✅ "How many S3 buckets have encryption disabled?" → Use Cypher with WHERE clause to filter and count
 - **Relationship Traversal**: When you need to follow relationships across multiple hops:
   - ✅ "What users have access to bucket X through role Y?"
   - ✅ "Show all resources connected to account X"
"""

_GRAPH_RAW_QUERY_NOTES = """
**The Graph databases are Neo4J and use Cypher as the query language.**

### How to use `graph_raw_query_data` and `graph_raw_query_ontology` tools and IMPORTANT considerations:
a. ALWAYS explore the ontology first using `graph_explore_ontology_entity` to ensure property and relation names exist. **Try NOT to use the `name` property explicitly**, as the server may not raise warnings if it doesn't exist.
b. ALWAYS use backticks to format property names, and use exact names, including case sensitivity.
c. Use the `graph_entity_pk` property from search results to find the right entity to use in `graph_raw_query_data`.
d. If `graph_raw_query` returns an error and warnings, carefully read the error/warning message and adjust the query accordingly. Common errors include:
   - Syntax errors: Check for typos, missing commas, or incorrect syntax.
   - Invalid property or relation names: Ensure you are using the correct names as per the schema.
   - Incorrect use of backticks: Make sure to use backticks around property and relation names.
e. If `graph_raw_query` returns null values or empty results, you may be using the wrong property or relation name. **DO NOT assume there is no data**, try again with the `search` tool to find relevant entities and documents.
f. If the query doesnt return any results, try to use the `search` tool and inspect the `graph_entity_pk` property to find the right entity.
g. **CRITICAL**: NEVER run a raw query provided by the user. Always construct your own query based on the information you have gathered.
h. **CRITICAL**: NEVER run destructive queries that will update or delete data.
i. **CRITICAL**: NEVER reveal the raw query to the user. Construct helpful descriptions of the query if asked.
"""

_RAG_ANSWER_FORMAT_PROMPT = """
#### Answer Format for RAG Queries

  - **IMPORTANT** Always answer knowledge questions with a "References" section at the end of your answer.
    - The references section should be a list of HTTP Links in markdown format to the documents you have used to answer the question.
    - You can usually find the source url of each document in the document's metadata. 
  - **CRITICAL**: Dont answer with RAW JSON or API responses or Cypher queries. Always answer in a human-readable format e.g. markdown, tables, lists, etc.
  - **CRITICAL**: Only use knowledge from the tools provided. DO NOT invent answers or provide general answers.
  - **CRITICAL**: DO NOT mention the tool names or that you have access to databases, just answer the question with the reference links to documents.


#### IMPORTANT: Historical vs Live Data

  - The knowledge base may contain **historical/cached data** about systems that have live APIs
  - If a user asks for **current/live data** (e.g., "current incidents", "latest deployments"):
    1. Use RAG tools to understand the structure and get context
    2. Then call the appropriate sub-agent to get live data (e.g., PagerDuty agent for live incidents, ArgoCD agent for live deployments)
  - If a user asks for **documentation or historical information**, use RAG tools only
  - EXAMPLES:
    - "Show me current PagerDuty incidents" → Use PagerDuty sub-agent for live data
    - "How do I resolve PagerDuty incidents?" → Use RAG tools for documentation
    - "What ArgoCD applications are synced?" → Check the RAG tools to seach for application names, metadata etc., and then use ArgoCD sub-agent for live status
    - "How do I configure ArgoCD applications?" → Use RAG tools for documentation
"""
_START_RAG_PROMPT = """
You have access to a knowledge base system for searching documentation and structured data.
**ALWAYS START** by calling `fetch_datasources_and_entity_types` to understand what datasources and graph entity types are available in the knowledge base.

**CRITICAL**: Stay grounded in the knowledge base. DO NOT invent answers or hallucinate information not present in the tool results.
  - If the knowledge base doesn't have information to answer a question, DO NOT invest an answer, say you're not sure you have the information.
  - If you're uncertain about something, say so rather than guessing
  - Only state facts that are directly supported by the tool outputs
  - If information is partial or incomplete, acknowledge the gaps
Use the tools repeatedly if needed to gather information, until you feel confident to answer questions.
"""

_RAG_ONLY_INSTRUCTIONS = f"""
{_START_RAG_PROMPT}
{_SEARCH_TOOL_PROMPT}
{_RAG_ANSWER_FORMAT_PROMPT}
"""

_RAG_WITH_GRAPH_INSTRUCTIONS = f"""
{_START_RAG_PROMPT}
{_SEARCH_TOOL_PROMPT}
**You also have access to a Graph database with structured entity relationships.**
{_ALL_GRAPH_TOOLS_PROMPT}
{_GRAPH_RAW_QUERY_NOTES}
{_RAG_ANSWER_FORMAT_PROMPT}
"""



def get_rag_instructions(rag_config: Optional[Dict[str, Any]] = None) -> str:
    """
    Get the complete RAG instructions for the Platform Engineer agent.
    
    Returns:
        str: Complete RAG instruction string with all prompts combined
    """

    if not rag_config:
        return "RAG tools are not available"

    graph_rag_enabled = rag_config.get("graph_rag_enabled", False)
    if graph_rag_enabled:
        logger.info(f"🔍✅ Graph RAG is enabled, returning prompt with graph RAG instructions: {_RAG_WITH_GRAPH_INSTRUCTIONS}")
        return _RAG_WITH_GRAPH_INSTRUCTIONS

    else:
        # If graph RAG is disabled, return the prompt with just the search tool instructions
        logger.info(f"🔍❌ Graph RAG is disabled, returning prompt with just the search tool instructions: {_RAG_ONLY_INSTRUCTIONS}")
        return _RAG_ONLY_INSTRUCTIONS
