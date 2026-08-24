---
title: Knowledge Bases
description: Ingest, search, organize, and govern enterprise knowledge in CAIPE.
---

# Knowledge Bases

Knowledge Bases connect agents and users to governed organizational knowledge.
The workspace appears when RAG is enabled and the RAG service is configured.

![Knowledge Base search workspace](/img/features/knowledge-bases.svg)

## Workspace Sections

| Section | Purpose |
|---|---|
| Search | Query knowledge sources available to you |
| Data Sources | Create, ingest, monitor, and manage sources |
| Collections | Group sources and delegate access |
| Graph | Explore extracted entity relationships when GraphRAG is enabled |
| MCP Tools | Configure retrieval tools exposed through MCP |

## Search and Ingest Are Separate Capabilities

CAIPE can grant a team permission to search without permission to ingest, or to
ingest without broad search access. The navigation can remain visible while an
individual action is denied.

If the workspace says that you have no Knowledge Base access, ask an
administrator to grant your team the appropriate search or ingest capability
and access to the required knowledge base.

## Add a Source

1. Open **Knowledge Bases → Data Sources**.
2. Choose a supported source type.
3. Supply the source location and required connection information.
4. Select ownership and sharing.
5. Start ingestion and monitor status.

Source availability depends on configured ingestors. A platform-defined source
can require adoption before a team can manage it.

## Security Model

- Source management, ingestion, search, and publication are distinct actions.
- Team and resource relationships are enforced by OpenFGA when RBAC is enabled.
- Credentials used by an ingestor are not returned to the browser after being
  stored.
- A collection does not make a restricted source globally searchable.

## Related Documentation

- [Knowledge Bases overview](../knowledge_bases/index.md)
- [Ingestors](../knowledge_bases/ingestors.md)
- [Authentication](../knowledge_bases/authentication-overview.md)
- [RAG API](../api/rag-knowledge-bases.md)
