# Knowledge Bases

RAG (Retrieval-Augmented Generation) knowledge base with SSO-based RBAC.

## Auth Flow

```
User Browser
    ↓ (authenticates via SSO)
NextAuth Session (stores email + groups)
    ↓ (makes API call)
/api/rag/* Proxy (injects X-Forwarded-Email, X-Forwarded-Groups)
    ↓ (forwards with headers)
RAG Server (validates headers → determines role → enforces permissions)
    ↓
Vector DB + Graph DB
```

## Pages

### Ingest (`/knowledge-bases/ingest`)
- **INGESTONLY+**: Ingest URLs, Confluence pages
- **ADMIN**: Delete datasources, delete ingestors

### Search (`/knowledge-bases/search`)
- **All authenticated users**: Semantic search

### Graph (`/knowledge-bases/graph`)
- **All authenticated users**: View ontology and data relationships
- **INGESTONLY+**: Re-analyse ontology
- **ADMIN**: Delete ontology

| Role | View/Query | Ingest | Delete |
|------|-----------|--------|--------|
| **READONLY** | ✅ | ❌ | ❌ |
| **INGESTONLY** | ✅ | ✅ | ❌ |
| **ADMIN** | ✅ | ✅ | ✅ |

**How it works**: NextAuth session → API proxy injects `X-Forwarded-Email` and `X-Forwarded-Groups` headers → RAG server validates and enforces permissions.

## Main Components

### API Proxy (`src/app/api/rag/[...path]/route.ts`)
Server-side proxy that injects RBAC headers from NextAuth session to all RAG server requests.

### User Info Endpoint (`src/app/api/user/info/route.ts`)
Returns user's role and permissions based on SSO groups.

### API Client (`src/lib/rag-api.ts`)
Type-safe client library for all RAG operations. Automatically includes session credentials.

### Permissions Hook (`src/hooks/useRagPermissions.ts`)
React hook that fetches and caches user permissions. Use for conditional rendering.

```typescript
import { useRagPermissions, Permission } from '@/hooks/useRagPermissions';

const { userInfo, hasPermission, isLoading } = useRagPermissions();

<button disabled={!hasPermission(Permission.INGEST)}>Ingest</button>
<button disabled={!hasPermission(Permission.DELETE)}>Delete</button>
```

### IngestView (`src/components/rag/IngestView.tsx`)
Main UI for document ingestion with permission-based feature visibility.

## Usage

```typescript
import { useRagPermissions, Permission } from '@/hooks/useRagPermissions';
import { ingestUrl } from '@/lib/rag-api';

function MyComponent() {
  const { hasPermission } = useRagPermissions();

  // Conditional UI rendering
  return (
    <>
      {hasPermission(Permission.INGEST) && <IngestButton />}
      <button disabled={!hasPermission(Permission.DELETE)}>Delete</button>
    </>
  );
}
  );
}

// API calls (headers injected server-side automatically)
await ingestUrl({ url: 'https://example.com/docs' });
```

## Development

```bash
# Start RAG server
cd ai_platform_engineering/knowledge_bases/rag && docker compose up

# Configure .env.local with RBAC groups

# Start UI
npm run dev

# Test: http://localhost:3000/api/user/info
```

## Troubleshooting

- **403 Forbidden**: User lacks required role. Check groups in `/api/user/info`.
- **401 Unauthorized**: Session expired. Re-authenticate via `/api/auth/signin`.
- **Wrong role**: Verify `OIDC_GROUP_CLAIM` matches your provider and groups are in claims. Supports comma-separated values (e.g., `groups,members,roles`).
