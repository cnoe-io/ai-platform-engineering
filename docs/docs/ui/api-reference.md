---
sidebar_position: 5
---

# API Reference

The CAIPE UI exposes several API endpoints for programmatic access and integration with external systems.

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: `https://your-domain.com`

## Authentication

All API endpoints (except `/api/health`) require authentication via NextAuth session cookies or Bearer tokens.

### Session Cookie Authentication

```bash
# Authenticate and get session cookie
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Use session cookie in subsequent requests
curl http://localhost:3000/api/usecases \
  -H "Cookie: next-auth.session-token=..."
```

### Bearer Token Authentication (Coming Soon)

```bash
curl http://localhost:3000/api/usecases \
  -H "Authorization: Bearer <token>"
```

## Endpoints

### Health Check

#### `GET /api/health`

Check if the API is running and healthy.

**Request:**

```bash
curl http://localhost:3000/api/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-27T10:00:00.000Z",
  "version": "0.2.12",
  "caipe": {
    "url": "http://localhost:8000",
    "connected": true
  }
}
```

**Status Codes:**
- `200 OK` - Service is healthy
- `503 Service Unavailable` - Service is down

---

### Use Cases

#### `GET /api/usecases`

Retrieve all saved use cases.

**Request:**

```bash
curl http://localhost:3000/api/usecases
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Filter by category |
| `tags` | string | No | Comma-separated tags to filter by |
| `difficulty` | string | No | Filter by difficulty: `beginner`, `intermediate`, `advanced` |
| `limit` | number | No | Maximum number of results (default: 100) |
| `offset` | number | No | Pagination offset (default: 0) |

**Example with filters:**

```bash
curl "http://localhost:3000/api/usecases?category=deployment&difficulty=beginner&limit=10"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uc_123abc",
      "title": "Check Deployment Status",
      "description": "Monitor ArgoCD application sync status and health",
      "category": "deployment",
      "tags": ["argocd", "kubernetes", "deployment"],
      "prompt": "Check the status of all ArgoCD applications in production",
      "expectedAgents": ["argocd"],
      "difficulty": "beginner",
      "createdAt": "2026-01-27T10:00:00.000Z",
      "updatedAt": "2026-01-27T10:00:00.000Z"
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `500 Internal Server Error` - Server error

---

#### `POST /api/usecases`

Create a new use case.

**Request:**

```bash
curl -X POST http://localhost:3000/api/usecases \
  -H "Content-Type: application/json" \
  -d '{
    "title": "AWS Cost Analysis",
    "description": "Analyze AWS spending by service and region",
    "category": "cloud",
    "tags": ["aws", "cost", "finops"],
    "prompt": "Show me AWS costs for the last 30 days broken down by service",
    "expectedAgents": ["aws"],
    "difficulty": "intermediate"
  }'
```

**Request Body:**

```typescript
interface CreateUseCaseRequest {
  title: string;              // Required, 3-200 chars
  description: string;        // Required, 10-1000 chars
  category: string;           // Required: deployment|incident|development|cloud|other
  tags: string[];             // Required, 1-10 tags
  prompt: string;             // Required, 10-2000 chars
  expectedAgents: string[];   // Required, 1-10 agents
  difficulty: string;         // Required: beginner|intermediate|advanced
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uc_456def",
    "title": "AWS Cost Analysis",
    "description": "Analyze AWS spending by service and region",
    "category": "cloud",
    "tags": ["aws", "cost", "finops"],
    "prompt": "Show me AWS costs for the last 30 days broken down by service",
    "expectedAgents": ["aws"],
    "difficulty": "intermediate",
    "createdAt": "2026-01-27T10:30:00.000Z",
    "updatedAt": "2026-01-27T10:30:00.000Z"
  }
}
```

**Status Codes:**
- `201 Created` - Use case created
- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Not authenticated
- `500 Internal Server Error` - Server error

**Validation Errors:**

```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "title",
      "message": "Title must be between 3 and 200 characters"
    },
    {
      "field": "tags",
      "message": "At least one tag is required"
    }
  ]
}
```

---

#### `GET /api/usecases/:id`

Get a specific use case by ID.

**Request:**

```bash
curl http://localhost:3000/api/usecases/uc_123abc
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uc_123abc",
    "title": "Check Deployment Status",
    "description": "Monitor ArgoCD application sync status and health",
    "category": "deployment",
    "tags": ["argocd", "kubernetes", "deployment"],
    "prompt": "Check the status of all ArgoCD applications in production",
    "expectedAgents": ["argocd"],
    "difficulty": "beginner",
    "createdAt": "2026-01-27T10:00:00.000Z",
    "updatedAt": "2026-01-27T10:00:00.000Z"
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Use case not found
- `401 Unauthorized` - Not authenticated

---

#### `PUT /api/usecases/:id`

Update an existing use case.

**Request:**

```bash
curl -X PUT http://localhost:3000/api/usecases/uc_123abc \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Check ArgoCD Deployment Status (Updated)",
    "tags": ["argocd", "kubernetes", "deployment", "monitoring"]
  }'
```

**Request Body:**

All fields are optional. Only include fields you want to update.

```typescript
interface UpdateUseCaseRequest {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  prompt?: string;
  expectedAgents?: string[];
  difficulty?: string;
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uc_123abc",
    "title": "Check ArgoCD Deployment Status (Updated)",
    "tags": ["argocd", "kubernetes", "deployment", "monitoring"],
    "updatedAt": "2026-01-27T11:00:00.000Z"
  }
}
```

**Status Codes:**
- `200 OK` - Updated successfully
- `400 Bad Request` - Invalid input
- `404 Not Found` - Use case not found
- `401 Unauthorized` - Not authenticated

---

#### `DELETE /api/usecases/:id`

Delete a use case.

**Request:**

```bash
curl -X DELETE http://localhost:3000/api/usecases/uc_123abc
```

**Response:**

```json
{
  "success": true,
  "message": "Use case deleted successfully"
}
```

**Status Codes:**
- `200 OK` - Deleted successfully
- `404 Not Found` - Use case not found
- `401 Unauthorized` - Not authenticated

---

### Chat

#### `POST /api/chat`

Send a message to the CAIPE agent system.

**Request:**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Check the status of all ArgoCD applications",
    "session_id": "session_123",
    "stream": true
  }'
```

**Request Body:**

```typescript
interface ChatRequest {
  message: string;           // Required, user message
  session_id?: string;       // Optional, for conversation continuity
  stream?: boolean;          // Optional, enable SSE streaming (default: true)
  agent?: string;            // Optional, target specific agent
  metadata?: object;         // Optional, additional context
}
```

**Response (Non-streaming):**

```json
{
  "success": true,
  "data": {
    "session_id": "session_123",
    "task_id": "task_456",
    "response": "Found 15 applications. All are synced and healthy.",
    "artifacts": [
      {
        "name": "final_result",
        "type": "text",
        "data": "..."
      }
    ],
    "metadata": {
      "agents_used": ["argocd"],
      "execution_time_ms": 1234
    }
  }
}
```

**Response (Streaming):**

With `stream: true`, the response is a Server-Sent Events (SSE) stream:

```
Content-Type: text/event-stream

event: task
data: {"kind":"task","data":{"state":"running","session_id":"session_123","task_id":"task_456"}}

event: artifact-update
data: {"kind":"artifact-update","data":{"artifact":{"name":"streaming_result","text":"Checking...","append":false}}}

event: artifact-update
data: {"kind":"artifact-update","data":{"artifact":{"name":"tool_notification_start","description":"Calling ArgoCD API"}}}

event: artifact-update
data: {"kind":"artifact-update","data":{"artifact":{"name":"final_result","text":"Found 15 applications..."}}}

event: status-update
data: {"kind":"status-update","data":{"final":true,"state":"completed","result":{...}}}
```

**Status Codes:**
- `200 OK` - Success (streaming or non-streaming)
- `400 Bad Request` - Invalid message
- `401 Unauthorized` - Not authenticated
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - CAIPE supervisor not available

---

### Agent Card

#### `GET /api/agent-card`

Get the CAIPE supervisor agent card (capabilities, version, etc.).

**Request:**

```bash
curl http://localhost:3000/api/agent-card
```

**Response:**

```json
{
  "success": true,
  "data": {
    "name": "CAIPE Supervisor",
    "version": "0.2.12",
    "description": "Multi-agent supervisor for platform engineering",
    "capabilities": {
      "streaming": true,
      "a2a_protocol": "1.0",
      "supported_agents": [
        "argocd",
        "aws",
        "github",
        "jira",
        "pagerduty",
        "slack"
      ]
    },
    "endpoints": {
      "chat": "/v1/chat",
      "stream": "/v1/chat/stream",
      "health": "/.well-known/health"
    }
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `503 Service Unavailable` - CAIPE supervisor not available

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | External service unavailable |

## Rate Limiting

API endpoints are rate-limited to prevent abuse:

- **Default**: 100 requests per minute per user
- **Chat**: 20 requests per minute per user
- **Use Cases Write**: 10 requests per minute per user

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706349600
```

When rate limit is exceeded:

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retry_after": 42
}
```

## Pagination

Endpoints that return lists support pagination:

```bash
# Get first page
curl "http://localhost:3000/api/usecases?limit=10&offset=0"

# Get second page
curl "http://localhost:3000/api/usecases?limit=10&offset=10"
```

**Response with pagination:**

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 42,
    "limit": 10,
    "offset": 0,
    "has_more": true
  }
}
```

## Webhooks (Coming Soon)

Future versions will support webhooks for real-time event notifications:

- Chat message received
- Use case created/updated
- Agent status changed
- Task completed

## Client Libraries

### JavaScript/TypeScript

```typescript
import { CaipeClient } from '@caipe/client';

const client = new CaipeClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
});

// Send chat message
const response = await client.chat.send({
  message: 'Check deployment status',
  stream: false,
});

// List use cases
const useCases = await client.useCases.list({
  category: 'deployment',
  limit: 10,
});

// Create use case
const newUseCase = await client.useCases.create({
  title: 'My Custom Use Case',
  // ...
});
```

### Python

```python
from caipe_client import CaipeClient

client = CaipeClient(
    base_url="http://localhost:3000",
    api_key="your-api-key"
)

# Send chat message
response = client.chat.send(
    message="Check deployment status",
    stream=False
)

# List use cases
use_cases = client.use_cases.list(
    category="deployment",
    limit=10
)

# Create use case
new_use_case = client.use_cases.create(
    title="My Custom Use Case",
    # ...
)
```

## OpenAPI Specification

A full OpenAPI 3.0 specification is available:

```bash
# Download OpenAPI spec
curl http://localhost:3000/api/openapi.json > openapi.json

# Generate client code
openapi-generator generate \
  -i openapi.json \
  -g typescript-fetch \
  -o ./generated-client
```

## Examples

### Complete Chat Flow

```bash
#!/bin/bash

# 1. Authenticate
SESSION=$(curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}' \
  -c cookies.txt)

# 2. Send chat message
RESPONSE=$(curl -X POST http://localhost:3000/api/chat \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Check ArgoCD applications",
    "stream": false
  }')

echo $RESPONSE | jq '.data.response'

# 3. Create use case from successful interaction
curl -X POST http://localhost:3000/api/usecases \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Quick ArgoCD Check",
    "description": "Fast check of all ArgoCD apps",
    "category": "deployment",
    "tags": ["argocd", "quick"],
    "prompt": "Check ArgoCD applications",
    "expectedAgents": ["argocd"],
    "difficulty": "beginner"
  }'
```

### Streaming Chat with curl

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Investigate PagerDuty incident #123",
    "stream": true
  }' | while read line; do
  echo "$line"
done
```

### Batch Create Use Cases

```bash
#!/bin/bash

# Read use cases from JSON file
cat use_cases.json | jq -c '.[]' | while read usecase; do
  curl -X POST http://localhost:3000/api/usecases \
    -H "Content-Type: application/json" \
    -d "$usecase"
  sleep 0.1  # Respect rate limits
done
```

## Next Steps

- [Development Guide](development.md) - Build and extend the API
- [Configuration Guide](configuration.md) - Production setup
- [Features Guide](features.md) - UI features and capabilities
