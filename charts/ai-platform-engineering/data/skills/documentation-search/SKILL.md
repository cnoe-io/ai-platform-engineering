---
name: documentation-search
description: Search the internal knowledge base for runbooks, architecture documentation, ADRs, best practices, and troubleshooting guides using RAG. Use when looking for internal documentation, deployment procedures, architecture decisions, or operational runbooks.
---

# Documentation Search

Search the internal knowledge base using RAG (Retrieval-Augmented Generation) to find relevant runbooks, architecture docs, ADRs, and best practices.

## Instructions

### Phase 1: Query Understanding
1. **Parse the user's intent**:
   - Are they looking for a specific document?
   - Are they asking a question the docs can answer?
   - Are they exploring a topic?
2. **Formulate search queries**:
   - Extract key terms from the user's question
   - Generate 2-3 variant queries to improve recall
   - Include relevant synonyms

### Phase 2: Knowledge Base Search (RAG Agent)
1. **Search across document sources**:
   - Architecture Decision Records (ADRs) in \`docs/docs/changes/\`
   - Spec Kit documents in \`.specify/specs/\`
   - Runbooks and operational guides
   - README files and inline documentation
2. **Rank results** by relevance

### Phase 3: Answer Synthesis
1. **Direct answer**: If the docs contain a clear answer, provide it directly
2. **Compiled answer**: If information is spread across multiple docs, synthesize
3. **Source attribution**: Always cite which document(s) the answer came from
4. **Gaps identified**: Note if the question is only partially answered

## Examples

- "Search our knowledge base for deployment best practices"
- "How do we handle rollbacks?"
- "Find the runbook for EKS cluster upgrades"
- "What ADRs do we have about streaming?"

## Guidelines

- Always cite sources - never present information without attribution
- If no relevant documents are found, say so clearly and suggest alternatives
- Prefer internal documentation over general knowledge when both exist
- For runbooks, include the full procedure steps rather than just linking
- Flag outdated documentation (>6 months old) with a freshness warning