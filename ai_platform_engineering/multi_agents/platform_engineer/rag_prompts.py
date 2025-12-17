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
### Search Tool Usage:

**Search Modes:**
- **Semantic (default, `keyword_search=False`)**: Use FULL SENTENCES for natural language
  - ✅ Good: "What is the nexus deployment process?"
  - ❌ Bad: "nexus deployment"
- **Keyword (`keyword_search=True`)**: Use SPECIFIC KEYWORDS or exact terms
  - ✅ Good: "ERROR-404", "S3BucketEncryptionDisabled"
  - Use for error codes, exact names, IP addresses, technical identifiers

**Search Returns:**
The search automatically returns BOTH types in a dictionary:
```
{
  "graph_entity_documents": [structured entities from knowledge graph],
  "text_documents": [regular docs, wikis, Slack/Webex threads]
}
```

**Key Metadata:**
- **Graph entities**: `graph_entity_type`, `graph_entity_pk` (or `_entity_pk`), `document_id`
- **Text docs**: `document_id`, `title`, `datasource_id`, `document_type`, `source_url`, `source`

**Recommended Workflow:**
1. **Start with search** - Use natural language to get both entities and documents
2. **Review both result types**:
   - Graph entities = structured data with relationships
   - Text documents = documentation and procedures
3. **Dive deeper**:
   - Entities: Use `graph_explore_data_entity` with type/pk to see relationships
   - Documents: Use `fetch_document` with document_id for full content
   - Slack/Webex: Extract info and speak naturally like a colleague
4. **Combine insights** - Best answers often use BOTH structured entities AND documentation

**BE PERSISTENT - Minimum 3 approaches:**
- Vary search terms: synonyms ("kubernetes"↔"k8s", "deploy"↔"deployment"), abbreviations ("CI/CD"↔"continuous integration"), broader/narrower ("errors"→"HTTP errors"→"404 errors")
- Toggle semantic/keyword modes - if sentences don't work, try keyword search for: error codes ("ERROR-404"), IPs ("10.0.1.5"), exact names ("prod-deployment-abc"), stack traces
- Try different datasource filters
"""

_ALL_GRAPH_TOOLS_PROMPT = """
### Graph Database Overview:

**Two Graphs:**
1. **Ontology Graph** (Schema): Entity types, properties, and possible relations. Tools: `graph_explore_ontology_entity`, `graph_shortest_path_between_entity_types`
2. **Data Graph** (Actual Data): Specific entity instances and relationships. Tools: `graph_explore_data_entity`, `graph_fetch_data_entity_details`, `graph_raw_query_data`

### Workflow:

1. **Search first** → Get entities with `graph_entity_type` and `graph_entity_pk` in metadata
2. **Understand schema** (if needed) → Use `graph_explore_ontology_entity` to see properties and relations
3. **Explore entities** → Use `graph_explore_data_entity` with type and pk from search. Set `depth` (1-3) for neighbors
4. **Complex queries** → Use `graph_raw_query_data` for counts, filtering, aggregations

**When to Use Raw Queries:**
- Counts: "How many S3 buckets?" → `MATCH (b:S3Bucket) RETURN COUNT(b)`
- Filtering: "Which buckets lack encryption?" → Use WHERE clauses
- Complex traversals: Multi-hop pattern matching

**Tool Quick Reference:**
- `graph_explore_ontology_entity` → Schema for entity type
- `graph_explore_data_entity` → Entity + neighbors (use depth parameter)
- `graph_fetch_data_entity_details` → Single entity details only
- `graph_raw_query_data` → Complex Cypher queries
"""

_GRAPH_RAW_QUERY_NOTES = r"""
### Raw Cypher Queries (Neo4J):

**BEFORE Writing Queries:**
1. Explore schema with `graph_explore_ontology_entity` to get EXACT property names (case-sensitive!)
2. Get entity identifiers from search results (`graph_entity_pk` or `_entity_pk`)

**Query Rules:**
- Use backticks: `MATCH (a:AWSAccount) RETURN a.\`accountId\`` ✅ (not `a.accountId` ❌)
- Always use LIMIT (default 100, use 10 for testing)
- Start simple, add complexity incrementally

**Error Handling:**
- "Unknown property" → Check schema for exact property name
- Empty results → DON'T assume no data! Use `search` to verify entities exist
- Result too large → Add WHERE clauses, reduce LIMIT, select specific properties

**Security:**
- ❌ NEVER run user-provided queries, destructive operations (CREATE/DELETE/SET), or reveal Cypher to users
- ✅ ONLY read-only queries (MATCH, RETURN, WHERE, WITH)

**Example:**
User: "How many prod accounts?" 
→ Check schema first → See property `accountName` → Query: `MATCH (a:AWSAccount) WHERE a.\`accountName\` CONTAINS "prod" RETURN COUNT(a)`
"""

_RAG_ANSWER_FORMAT_PROMPT = """
### Answer Format:

**Do's:**
- ✅ Use markdown, tables, lists - combine graph entities + documents
- ✅ Include "References" section with source links from metadata (`url`, `source_url`, `confluence_url`, `github_url`)
- ✅ Only use tool results - NO hallucinations
- ✅ After 3+ search attempts, if nothing found: "I searched multiple datasources but couldn't find X. Here's related info: [Y]"

**Don'ts:**
- ❌ Show raw JSON/Cypher or mention tool names
- ❌ Say "According to knowledge base..." - speak naturally
- ❌ Invent answers or provide general knowledge

**Slack/Webex Threads:**
Extract solutions naturally like a colleague: "The team found that restarting the pod resolves this error" (not "User123 said...")

**Example Good Answer:**
```
The nexus deployment process involves three steps:

1. **Build Phase**: Application built using Maven, artifacts stored in Nexus
2. **Validation Phase**: Artifacts scanned for vulnerabilities
3. **Deployment Phase**: Approved artifacts deployed to target environment

For production deployments, security team approval is required.

**References:**
- [Nexus Deployment Guide](https://wiki.example.com/nexus-deployment)
- [Production Deployment Checklist](https://wiki.example.com/prod-checklist)
```

### Historical vs Live Data:

**RAG only (historical/documentation):**
- "How do I configure ArgoCD?" → Documentation
- "What's the incident response process?" → Procedures
- "What AWS accounts do we have?" → Graph entities
- "Show infrastructure structure" → Graph relationships

**RAG + Sub-agents (current/live status):**
- "What ArgoCD apps are out of sync?" → RAG for context and application name + ArgoCD agent for live status
- "Get latest PRs for nexus project?" → RAG for repository names + GitHub agent for PR data
- "Whats the latest deployment status for abc pod?" → RAG for exact pod names + sub-agent for real-time status

**Strategy:** Start with RAG for context. If user needs "current/latest/now/live" → combine with sub-agents. If "how to/what is/explain" → RAG sufficient.
"""
_START_RAG_PROMPT = """
**Knowledge Base Access:**
Text docs (wikis, Confluence, PDFs, Slack/Webex) + Graph entities (structured data: AWS, ArgoCD, infrastructure)

**Start:** Call `fetch_datasources_and_entity_types` to discover available datasources and entity types

**BE PERSISTENT - MINIMUM 3 APPROACHES:**
❌ NEVER give up after 1 search! ✅ Try 3+ different strategies:

1. **Vary terms**: Synonyms, broader/narrower scope, toggle semantic/keyword modes
2. **Different datasources**: Filter by datasource_id
3. **Change granularity**: Broad→narrow or narrow→broad
4. **Explore graph**: Check ontology, use raw queries
5. **Related info**: Parent concepts, Slack threads with different keywords

**Example - ArgoCD sync timeout:**
❌ Bad: 1 search → no results → give up
✅ Good: Try "sync timeout" (semantic) → "sync failures" (broader) → "timeout" keyword in argocd datasource → "troubleshooting" → check graph → find Slack thread → answer!

**Stay Grounded:**
- Only use tool results - NO hallucinations
- After 3+ attempts with no results: "I searched multiple datasources but couldn't find X"
- DON'T invent, assume, or provide general knowledge
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
