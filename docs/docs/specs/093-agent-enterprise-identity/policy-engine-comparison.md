# Policy Engine Comparison for Agentic AI, OBO & Impersonation Workflows

**Focus**: Enterprise authorization for AI agents with Keycloak identity federation
**Date**: March 2026
**Context**: Multi-agent platform engineering with OAuth 2.0 Token Exchange, service account impersonation, and deterministic boundaries

---

## Executive Summary

For **agentic AI platforms with identity federation** (Keycloak + OAuth 2.0 Token Exchange + OBO flows), your choice hinges on:

| Criterion | Cedar | CEL | Casbin | OPA/Rego |
|-----------|-------|-----|--------|----------|
| **Best for agents** | ✅ Excellent | ⚠️ Good (embedding) | ❌ Weak | ✅ Strong (complex rules) |
| **Keycloak integration** | 🟡 Manual | 🟡 Manual | ✅ Native | 🟡 Manual |
| **OBO/Impersonation** | ✅ Built-in (PARC) | ✅ Via JWT claims | ⚠️ Role-based only | ✅ Full support |
| **Determinism** | ✅ Formal verification | ⚠️ Four-valued logic | ✅ Predictable | ⚠️ Flexible |
| **Latency (critical)** | ✅ Sub-millisecond | ✅ Nanosecond-µs | ✅ Fast | ❌ Variable |
| **Self-hosted** | ✅ Cedar Agent + OPAL | ✅ Native | ✅ Embedded | ✅ OPA daemon |
| **Learning curve** | 🟡 Moderate | ✅ Low | 🟡 Moderate | ❌ Steep |

---

## Detailed Analysis

### 0. **AgentGateway** — Purpose-Built Agent Proxy with CEL + External Auth

#### What It Is
An open source data plane built on AI-native protocols (A2A & MCP) to connect, secure, and observe agent-to-agent and agent-to-tool communication across any framework and environment, hosted by the Linux Foundation.

#### For Agentic Workflows
**Strengths:**
- **MCP-native**: Direct support for Model Context Protocol servers; aggregates multiple MCP servers behind a single endpoint
- **CEL expressions built-in**: CEL expressions can access request context, JWT claims, and other variables to make dynamic decisions
- **External authorization**: Can send requests to an external authorization service (such as Open Policy Agent) which decides whether the request is allowed or denied, using the External Authorization gRPC service or HTTP requests
- **MCP Authorization spec compliant**: Automatically handles OAuth 2.0 Protected Resource Metadata (RFC9728) for MCP servers, simplifying MCP server-side authorization compliance

**Example AgentGateway Policy:**
```yaml
listeners:
  - routes:
      - backends:
          - mcp:
              targets:
                - name: hello-world
                  stdio:
                    cmd: uv
                    args: ['run', 'src/main.py']
        policies:
          jwt:
            jwks:
              url: http://keycloak:7080/protocol/openid-connect/certs
            claims:
              sub: "*"  # Any authenticated user
              scope: "agents:execute"  # Must have scope
```

#### For Identity Federation
- **Keycloak native**: Agentgateway can act as a resource server, validating JWT tokens and can adapt traffic for authorization servers like Keycloak
- **OBO support**: JWT claims fully accessible in CEL expressions for actor delegation checks
- **MCP authentication**: MCP authentication enables OAuth 2.0 protection for MCP servers, implementing the MCP Authorization specification

#### Advantages
- **Zero-trust agent access**: Built-in JWT authentication and a robust RBAC system allow you to control access to MCP servers, tools and agents, and protect against tool poisoning attacks
- **Policy flexibility**: Combine CEL expressions, external auth services (OPA, Cedar, custom), and JWT validation
- **Kubernetes-native**: Built-in Kubernetes Gateway API support with dynamic provisioning
- **Observable**: Built-in UI for testing, OpenTelemetry metrics/tracing, structured logging

#### Gaps
- **Not a policy engine**: Orchestrates policies via external services or CEL; doesn't replace Cedar/OPA
- **Newer project**: Less mature than Cedar/OPA (still Linux Foundation incubation)
- **Learning curve**: Requires understanding MCP, A2A protocols, and CEL expressions

#### Deployment
- **Standalone**: Binary, Docker, or Kubernetes with Gateway API
- **External auth integration**: Works with OPA, Cedar Agent via gRPC/HTTP
- **MCP servers**: Manages stdio, HTTP/SSE, Streamable HTTP transports

#### Best For
- **AI agent platforms** using MCP servers (CAIPE's primary use case)
- **Keycloak integration** with OAuth 2.0 Token Exchange (OBO workflows)
- **Multi-tenant agent access** with per-MCP-server authorization
- **Production observability** for agent-to-tool communication

---

### 1. **Cedar** (AWS) — Best for Deterministic Agent Boundaries

#### What It Is
An open source policy language for fine-grained permissions designed specifically for application-level authorization with formal verification capabilities.

#### For Agentic Workflows
**Strengths:**
- Enables identity-aware controls so agents only access tools and data authorized for their users, applied through AgentCore Gateway intercepting every agent-to-tool request at runtime
- Policies are deterministic code that blocks unauthorized actions before they happen
- **PARC model** (Principal, Action, Resource, Conditions) maps perfectly to agent impersonation:
  - **Principal**: Service account or OBO token issuer
  - **Action**: Tool/MCP server method
  - **Resource**: Data or external system
  - **Conditions**: JWT claims (role, scope, actor delegation)

**Example Cedar Policy for OBO:**
```cedar
// Service account alice-svc acting on behalf of user-123 can read documents
permit(
  principal == SA::"alice-svc",
  action == Action::"read_document",
  resource == Document::"doc-456"
) when {
  // OBO check: verify the requesting actor
  context.jwt_claims.actor == User::"user-123" &&
  context.jwt_claims.scope.contains("documents:read")
};
```

#### For Identity Federation
- **Keycloak → Cedar flow**: Extract JWT claims (actor, sub, role, org) from Keycloak token, pass to Cedar policy evaluator
- **No native Keycloak integration**, but straightforward via:
  1. Keycloak issues JWT with custom claims (`actor`, `act_on_behalf_of`)
  2. Agent gateway validates JWT, extracts context
  3. Cedar evaluator checks policy against principal, action, resource, and JWT claims
  4. Decision cached per identity

#### Performance & Safety
- 42–60 times faster than Rego (sub-millisecond)
- Default-deny posture and forbid wins over permit
- Formal verification: Policies checked for contradictions, unreachable rules, shadowing

#### Deployment
- **Open Source**: Cedar language + Cedar Agent (eval engine)
- **Managed**: AWS Verified Permissions (API-only, tight AWS integration)
- **Self-Hosted**: Cedar Agent + OPAL (control plane) for policy distribution
- **MCP Support**: Natural language-to-Cedar policy generation via MCP server

#### Gaps
- Lacks standard APIs for managing policies and data (unlike OPA); designed to be embedded in AWS Verified Permissions; requires user to design architecture for self-hosted use
- No built-in role manager—must handle role hierarchies in conditions or via external lookup
- Limited tooling for policy testing outside AWS ecosystem

---

### 2. **Common Expression Language (CEL)** — Best for Lightweight Embedding & Portability

#### What It Is
A fast, portable, and safe expression language for performance-critical applications, designed to be embedded in applications — not a standalone policy engine, but an **expression evaluator**.

#### For Agentic Workflows
**Strengths:**
- **Portable & lightweight**: Single-file expressions inline into configs; no external policy service needed
- **Subsetting**: Supports subsetting which preserves predictable compute/memory impacts (critical for low-latency agents)
- **Four-valued logic**: Supports partial evaluation to determine cases definitely allowed, denied, or conditional on additional inputs

**Example CEL for OBO with JWT:**
```cel
// Check if agent can act on behalf of user
request.auth.jwt.actor == 'user-123' &&
request.auth.jwt.scope.contains('agents:execute') &&
resource.owner == request.auth.jwt.sub
```

#### For Identity Federation
- CEL can access request context, JWT claims, and other variables to make dynamic decisions
- **AgentGateway** (open-source) uses CEL natively: typically accessed as request, jwt variables in YAML policy configs
- **Keycloak → CEL**: JWT claims automatically available as `jwt.*` variables

#### Use Cases
- Kubernetes ValidatingAdmissionPolicy and CustomResourceDefinitions without needing external policy engine
- Google Cloud IAM conditions
- API request validation (certificates, SAN constraints)

#### Advantages
- **No external service**: Evaluate inside your agent gateway (lower latency, fewer moving parts)
- **Kubernetes-native**: Familiar syntax for platform engineers
- **Interoperability**: Used across Google, Kubernetes, and many platforms

#### Gaps
- **Not a full policy engine**: CEL is expressions only; you still need:
  - Policy storage & versioning (external)
  - Role manager for hierarchies
  - Audit/logging scaffolding
- **Limited agentic focus**: No built-in tool/resource schema, no formal verification
- **Less readable than Cedar**: More like SQL conditions than business rules

#### Deployment
- **Embedded**: No separate service; linked as library (Go, Java, Python, C++)
- **AgentGateway**: Open-source agent proxy with CEL policy support

---

### 3. **Casbin** — Best for Simple, Pluggable RBAC

#### What It Is
An authorization library using CONF files to define access control models based on the PERM metamodel (Policy, Effect, Request, Matchers).

#### For Agentic Workflows
**Strengths:**
- Supports access control models like ACL, RBAC, ABAC
- Can change or upgrade authorization by modifying config; policies stored in memory, files, or databases (MySQL, Postgres, MongoDB, Redis, S3)
- **Multi-tenant**: RBAC with domains/tenants enables users to have different role sets per domain

**Example Casbin RBAC Model:**
```conf
[request_definition]
r = sub, obj, act, domain

[role_definition]
g = _, _, _

[policy_definition]
p = sub, obj, act, domain, eft

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub, r.domain) && r.obj == p.obj && r.act == p.act
```

**Policy Rule:**
```
p, alice-svc, documents, read, acme, allow
g, alice-svc, data-engineer, acme
```

#### For Identity Federation
- **Keycloak integration**: Not native; requires custom adapters
- **OBO/impersonation**: Role-based only; no built-in JWT claim inspection
- **Workaround**: Extract actor from JWT, load actor's roles into Casbin, check `g(actor, role)` + resource + action

#### Advantages
- **Easy setup**: Config-driven, minimal code
- **Embedded**: Library for Go, Java, Python, Node.js, Rust, PHP
- **Flexible storage**: Use any DB adapter (e.g., PostgreSQL for Keycloak-integrated role sync)
- **Large community**: Fortune 500 adoption

#### Gaps
- **Weak for fine-grained federation**: No native JWT/OIDC support
- **Limited agentic semantics**: Roles are static; no context-aware conditions on tool arguments
- **No formal verification**: Can't validate policy correctness before deploy
- **OBO complexity**: Actor delegation requires external orchestration (extract actor, re-query roles)

#### Deployment
- **Embedded library**: No separate service; initialize Casbin enforcer with model + policy
- **Role manager**: Can pull roles from LDAP, Okta, Auth0, Azure AD (via plugin)
- **Policy persistence**: Adapters handle DB sync

#### Best For
- **Simple RBAC** where agents have **static role assignments**
- **Multi-tenant SaaS** with domain-based role scoping
- **Keycloak light integration** (roles from Keycloak, policies stored separately)

---

### 4. **OPA/Rego** — Best for Complex, Infrastructure-Wide Policies

#### What It Is
A declarative query language extending Datalog used with Open Policy Agent to write policies for decision-making across applications, accessed via HTTP API or embedded SDK.

#### For Agentic Workflows
**Strengths:**
- Can express simple and complex application authorization policies with ease for RBAC, ABAC, ReBAC models
- **Datalog power**: Complex graph/relationship queries, transitive reasoning
- Rego has many built-in tools for parsing GraphQL, JWT, JSON graph searching
- **General-purpose**: Works for admission control, network policy, supply-chain security—not just app authz

**Example Rego for OBO:**
```rego
package agent_authz

allow_tool_call {
    input.agent.actor == data.actors[input.jwt_claims.actor]
    data.actors[input.jwt_claims.actor].can_delegate_to[input.principal]
    tool := input.tool
    action := input.action
    can_access(input.principal, tool, action)
}

can_access(principal, tool, action) {
    role := input.roles[principal]
    data.permissions[role][tool][action] == true
}

can_access(principal, tool, action) {
    # ABAC: check attributes
    attr := input.attributes[principal]
    data.abac_rules[tool][action][attr.org] == true
}
```

#### For Identity Federation
- **Keycloak → OPA**: Extract JWT, query OPA with full JWT context
- **OBO support**: Full—Rego can reason over actor delegation chains, organizational hierarchies
- **No native Keycloak plugin**, but OPA is a general-purpose policy engine deployable on any public/private cloud

#### Performance & Complexity
- **Latency**: Variable (depends on policy complexity); millisecond range typical
- **Learning curve**: Steep—Datalog/Prolog paradigm requires 30–40 hour investment
- **Flexibility**: High—can express anything Cedar/Casbin cannot

#### Advantages
- **Infrastructure-wide**: OPA mostly used for infrastructure-level access control (service-to-service, Kubernetes admission control)
- **Mature ecosystem**: OPA's user community includes 50% Fortune 100 and Global 100 companies
- **Multiple deployment models**: Daemon, sidecar, embedded, WebAssembly, SQL compilation
- **Enterprise platform**: Styra Enterprise OPA with compliance, governance, no-code policies

#### Gaps for Agents
- **Not purpose-built**: Cedar/CEL more readable for application-level authz
- **Determinism concerns**: Rego is fantastic for non-latency critical, single-tenant solutions but difficult to safely embed
- **Recent uncertainty**: In August 2025, Apple hired OPA maintainers with plans to sunset enterprise offerings, raising doubts about OPA's future

#### Deployment
- **OPA daemon**: HTTP API, sidecar pattern
- **Embedded**: Go SDK with in-process evaluation
- **Enterprise**: Styra Enterprise OPA with control plane, audit, governance

#### Best For
- **Complex, multi-service policy as code** (infrastructure + app)
- **Relationship-based authorization** (graph traversal, delegation chains)
- **Organizations with Rego expertise** already deployed

---

### 5. **IBAC (Intent-Based Access Control)** — Best for Prompt-Injection Resilient Agents

#### What It Is
A security framework that parses user intent from natural language requests, extracts required capabilities, and checks those capabilities against OpenFGA relationship tuples before every tool call, protecting against prompt injection attacks on agents.

#### For Agentic Workflows
**Strengths:**
- **Prompt-injection resistant**: Authorization tuples are fixed before untrusted content (injected instructions) is processed; injected instructions fail at the authorization boundary
- **Intent parsing**: Dedicated LLM call with conservative system prompt analyzes user's message, produces structured capabilities and execution plan
- **Scope modes**: Strict mode (minimal permissions, more escalations) vs. Permissive mode (wider surface, fewer escalations)
- **TTL enforcement**: Capabilities expire via configurable TTL enforced natively by OpenFGA conditional tuples

**Example IBAC Workflow:**
```
User: "Send email to bob@company.com summarizing the report"
    ↓
Intent Parser (Claude):
  Capabilities: [email:send#bob@company.com, file:read#/docs/report.pdf]
    ↓
OpenFGA Tuple Check:
  - user:alice can email:send#bob@company.com? YES (within TTL)
  - user:alice can file:read#/docs/report.pdf? YES
    ↓
Allow email + file read (injected commands blocked)
```

#### For Identity Federation
- **User identity as principal**: Direct integration with Keycloak via JWT claims (`sub`, `act`)
- **OBO context**: Actor claim extracted and checked before capability evaluation
- **Fine-grained control**: Per-resource tuple checks (e.g., can only read specific files)

#### Advantages
- **Security against agent abuse**: Blocked all 240 prompt injection attempts in AgentDojo benchmark (strict mode)
- **Minimal overhead**: One extra LLM call for intent parsing, ~9ms authorization check per tool call
- **Simple to deploy**: One Docker container (OpenFGA), no external dependencies
- **Transparent escalation**: Denied calls trigger escalation prompts; user sees exact resource requested
- **No framework changes**: Works with any agent framework (Claude, OpenAI, etc.)

#### Gaps
- **Parser accuracy dependency**: IBAC's security depends on intent parser correctly identifying required capabilities
- **Limited to tuple-based reasoning**: Complex RBAC hierarchies still need OpenFGA (parent roles, transitive relationships)
- **Research-stage maturity**: IBAC paper published 2025; production deployments emerging

#### Deployment
- **OpenFGA + Intent Parser**: OpenFGA as singleton, intent parsing via LLM call per request
- **Authorization model**: Minimal—two types (user, tool_invocation), one relation (can_invoke), one condition (within_ttl)

**OpenFGA Model for IBAC:**
```
type user
type tool_invocation
  relations
    define blocked: [user]
    define can_invoke: [user with within_ttl]

condition within_ttl(current_turn: int, created_turn: int, ttl: int) {
  current_turn - created_turn <= ttl
}
```

#### Best For
- **Production agents handling untrusted inputs** (susceptible to prompt injection)
- **User-facing AI agents** requiring transparency (escalation prompts)
- **Compliance-sensitive workflows** (demonstrated security against injection attacks)
- **Keycloak + agent platforms** wanting minimal operational overhead

---

### 6. **OpenFGA** — Best for Relationship-Based Authorization at Scale

#### What It Is
An open source authorization engine inspired by Google Zanzibar that uses Relationship-Based Access Control (ReBAC) to store and query relationships between users, objects, and actions via simple tuples.

#### For Agentic Workflows
**Strengths:**
- **Relationship-based**: Users have relationships with objects (owner, editor, viewer, etc.); inheritance and delegation naturally supported
- **Multi-model support**: Combines ReBAC (primary), RBAC (via roles as relations), and ABAC (via Contextual Tuples and Conditional Relationship Tuples)
- **Agent collaboration**: Easily implement "share" buttons, "request access" workflows, and granular permissions per agent/tool
- **Sub-millisecond latency**: High-performance authorization checks (50–75% cache hit ratios in production)

**Example OpenFGA Model for Agent Tool Access:**
```
type user
type mcp_server
  relations
    define operator: [user]
    define can_call: [user, user with has_scope]

type tool
  relations
    define server: [mcp_server]
    define can_invoke: [user] (via operator from server)

condition has_scope(actor: string, scope: string) {
  // JWT scope validation
  actor.startsWith("user:") && scope == "agents:*"
}

// Tuple example:
// (user:alice, operator, mcp_server:github)
// (tool:get_repos, server, mcp_server:github)
// => user:alice can_invoke tool:get_repos (via operator relation)
```

#### For Identity Federation
- **Keycloak integration**: Store user roles and relationships from Keycloak as tuples; sync roles via Keycloak event publisher
- **OBO support**: User and actor both stored in tuple context; check relationships for delegation chains
- **JWT context**: Contextual tuples can include JWT claims (scope, org, team)

**Integration with Keycloak:**
```
Keycloak (user roles, relationships)
    ↓ [Event Publisher]
    ↓
OpenFGA (stores tuples: user:alice, role:agent-runner, org:acme)
    ↓
Authorization check: can user:alice invoke tool:data-access?
    (traverses: alice->agent-runner->data-access via role relation)
```

#### Advantages
- **Battle-tested**: Inspired by Google Zanzibar (handles trillions of objects, billions of users)
- **CNCF Incubation**: Strong governance; backed by Okta/Grafana; 5+ SDKs (Java, .NET, JS, Go, Python)
- **Declarative, readable**: Non-technical stakeholders can understand relationships
- **Hierarchical permissions**: Naturally express parent-child relationships (folder permissions inherit to files)
- **Audit trail**: Relationship tuples are explicit, auditable, version-controlled

#### Gaps
- **Tuple management complexity**: At scale, managing millions of tuples becomes operational burden
- **Not a policy language**: Cannot express complex conditional logic without Contextual Tuples (simpler than Cedar/Rego)
- **Keycloak sync overhead**: Requires custom event publisher or polling to keep Keycloak roles in sync with OpenFGA

#### Deployment
- **Service or library**: Run as Postgres-backed service or embed as Go library
- **Storage**: Postgres, MySQL, SQLite, in-memory
- **Kubernetes**: Helm charts available

#### Best For
- **Multi-tenant SaaS** with complex resource hierarchies and sharing workflows
- **Collaborative AI platforms** (agents sharing tool access, delegation chains)
- **Enterprise data platforms** with organizational hierarchies
- **Teams needing auditability** (relationship tuples as change history)

---

## Comparison Matrix: Agentic AI + OBO + Keycloak

| Feature | AgentGateway | Cedar | CEL | IBAC | OpenFGA | Casbin | OPA/Rego |
|---------|--------------|-------|-----|------|---------|--------|----------|
| **Agent tool call boundaries** | ✅ Excellent (MCP native) | ✅ Excellent (PARC) | ✅ Good | ✅ Excellent (intent-based) | ✅ Excellent (ReBAC) | ⚠️ Basic | ✅ Excellent |
| **OBO/impersonation** | ✅ JWT claim access | ✅ Native (PARC conditions) | ✅ Via JWT claims | ✅ Native (actor in context) | ✅ Tuple-based delegation | ⚠️ Manual (role lookup) | ✅ Native (Datalog) |
| **Keycloak native support** | ✅ Resource server + token validation | ❌ No | ❌ No | ✅ JWT + Keycloak event publisher | ✅ Via event publisher | ✅ Role manager plugins | ❌ No |
| **Prompt injection resistant** | ⚠️ Via external auth | ❌ No | ❌ No | ✅ YES (intent parser + fixed tuples) | ❌ No | ❌ No | ❌ No |
| **MCP-native** | ✅ YES (aggregates MCP) | ❌ No | ❌ No | ⚠️ Via OpenFGA | ⚠️ Via custom code | ❌ No | ❌ No |
| **Determinism** | ⚠️ Policy-dependent | ✅ Formal verification | ✅ Four-valued logic | ✅ Intent + OpenFGA tuples | ✅ Deterministic tuples | ✅ Predictable | ⚠️ Flexible |
| **Latency** | ⚠️ Variable (gateway overhead) | ✅ <1ms | ✅ Nanosecond–µs | ✅ ~9ms (LLM + check) | ✅ Sub-millisecond | ✅ <1ms | ⚠️ 1–100ms |
| **Self-hosted** | ✅ Binary/Docker/K8s | ✅ Cedar Agent + OPAL | ✅ Embedded library | ✅ OpenFGA service | ✅ Postgres-backed service | ✅ Embedded library | ✅ OPA daemon |
| **Policy storage** | ⚠️ Delegates to external auth | 🟡 Bring-your-own | 🟡 Bring-your-own | ✅ OpenFGA tuples | ✅ Built-in (Postgres) | ✅ Built-in adapters | ✅ Built-in (bundles) |
| **Readability** | ✅ YAML + CEL | ✅ High (PARC) | ✅ High (SQL-like) | ✅ High (intent parsing) | ✅ High (tuples) | ✅ Config-based | ❌ Steep (Datalog) |
| **Learning curve** | 🟡 Moderate (MCP/A2A) | 🟡 Moderate | ✅ Low | ✅ Low (OpenFGA simple) | 🟡 Moderate (relationships) | 🟡 Moderate | ❌ High |
| **Cost (self-hosted)** | $ Low (OSS) | $ Low (OPAL) | $ Low (library) | $ Low (OpenFGA) | $ Low (Postgres) | $ Low (library) | $ Low (daemon) |
| **Production maturity** | 🟡 Linux Foundation incubation | ✅ Production (AWS) | ✅ Production (Google) | 🟡 Research (2025 paper) | ✅ CNCF Incubation | ✅ Mature | ✅ Mature (CNCF) |

---

## Comparison Matrix (Simplified): Agentic AI + OBO + Keycloak

---

## Recommendation by Use Case

### **Use AgentGateway if:**
- You're building an **AI agent platform with MCP servers**
- You need **built-in Keycloak integration** and MCP Authorization spec compliance
- You want **external policy service** flexibility (connect Cedar/OPA via gRPC)
- You need **production observability** for agent-to-tool communication
- Kubernetes with **Gateway API** is your deployment target

**Integration pattern:**
```
Agent → AgentGateway (MCP proxy)
           ├─ JWT validation (Keycloak)
           ├─ CEL expression checks
           └─ External auth: Cedar/OPA for complex policies
           ↓
        MCP servers
```

---

### **Use Cedar if:**
- You need **deterministic agent boundaries** at scale (production multi-agent platform)
- Your agents **invoke external tools/MCP servers** with fine-grained RBAC/ABAC
- You want **formal verification** of policies before deploy
- You can self-host via Cedar Agent + OPAL or use AWS Verified Permissions
- Team is comfortable with AWS ecosystem or investing in newer tech
- **Latency is critical** (<1ms decision time)

**Integration pattern with Keycloak:**
```
Keycloak JWT (with actor, scope claims)
    ↓
Agent Gateway (validates JWT sig)
    ↓
Cedar Policy Evaluator (checks PARC + conditions)
    ↓
Allow/Deny (cached per identity)
```

---

### **Use CEL if:**
- You're **embedding policies in a lightweight gateway** (no external service)
- You need **sub-microsecond latency** and predictable resource usage
- You're **already on Kubernetes** or use Google Cloud (native support)
- You want **simple conditional expressions** on JWT claims
- You can manage **policy versioning externally** (Git + reload)

**Integration pattern with Keycloak:**
```
Keycloak JWT (with claims)
    ↓
AgentGateway (CEL expression evaluator)
    ├─ request, jwt, resource variables
    └─ Evaluate: jwt.actor == resource.owner && jwt.scope.contains("agents:*")
    ↓
Allow/Deny (inline decision)
```

---

### **Use Casbin if:**
- You have **simple RBAC with role hierarchies** (no need for fine-grained ABAC)
- You need **multi-tenant isolation** via domains
- You're **embedding authz in your app code** (library, not service)
- You want **easy config-driven policies** (CONF files)
- **Keycloak role sync** is your only federation requirement
- Team has **no policy expertise** and wants minimal learning

**Integration pattern with Keycloak:**
```
Keycloak (manages roles & users)
    ↓ [Role Manager plugin]
    ↓
Casbin Enforcer (in-memory or DB-backed)
    ├─ RBAC model: g(actor, role, domain)
    ├─ Policy: p(role, resource, action, domain)
    └─ Decide: enforce(actor, resource, action)
    ↓
Allow/Deny (role-based)
```

---

### **Use IBAC + OpenFGA if:**
- You're deploying **production agents exposed to untrusted inputs** (prompt injection risk)
- You need **security guarantees** against agent abuse (intent-parsing + tuple authorization)
- You want **minimal operational overhead** (one OpenFGA service, one LLM call per request)
- Compliance requirements mandate **auditable permission decisions**
- You're using **Keycloak for user identity** and need per-resource fine-grained control

**Integration pattern:**
```
User Natural Language Request
    ↓
Intent Parser (Claude with conservative prompt)
    ├─ Extracts capabilities: [tool:email#bob, resource:file#/report.pdf]
    └─ Scope mode: strict (fewer escalations) or permissive
    ↓
OpenFGA Relationship Tuple Check
    ├─ user:alice can email:send#bob? YES
    └─ user:alice can file:read#/report.pdf? YES (via owner relation)
    ↓
Allowed (injected commands blocked at authorization layer)
```

**Key advantage**: Passed 240/240 prompt injection attacks (AgentDojo benchmark, strict mode).

---

### **Use OpenFGA if:**
- You have **multi-tenant agent platforms** with complex resource hierarchies
- You need **granular, relationship-based permissions** (sharing, delegation, inheritance)
- You want **auditability via tuples** (version control, change tracking)
- You're managing **teams of agents** with dynamic access patterns (share buttons, request access)
- You already have **Keycloak for identity** and want to sync roles as relationships

**Integration pattern:**
```
Keycloak (user roles)
    ↓ [Event Publisher]
    ↓
OpenFGA Tuples
    ├─ (user:alice, agent-operator, mcp_server:github)
    ├─ (tool:get-repos, server, mcp_server:github)
    └─ (user:bob, team-member, team:data-team)
    ↓
Authorization Check
    └─ Can alice invoke get-repos?
       (traverses: alice-operator→github ∧ get-repos via github)
```

**Key advantage**: Relationship inheritance handles organizational hierarchies naturally (parent folder permissions cascade to files).

---

### **Use OPA/Rego if:**
- You have **complex, multi-service authorization** (policy as code across stack)
- You need **relationship-based reasoning** (delegation chains, graph traversal)
- You already **have OPA deployed** for infrastructure policy
- You have **Rego expertise** in-house
- You can absorb **1–100ms latency**
- **Enterprise Styra platform** support is valuable

**Integration pattern with Keycloak:**
```
Keycloak JWT (full context)
    ↓
OPA HTTP API (or embedded SDK)
    ├─ Query: data.agent_authz.allow_tool_call
    ├─ Input: {jwt_claims, principal, action, tool, attributes}
    └─ Evaluate: Rego policy (Datalog reasoning)
    ↓
Allow/Deny (complex rules)
```

---

## Keycloak Integration Patterns

### **Pattern 1: JWT Claims → Policy Engine** (Cedar, CEL, OPA)
1. **Keycloak** issues JWT with custom claims:
   ```json
   {
     "sub": "alice-svc",
     "act": {"sub": "user-123"},  // OBO actor
     "scope": "agents:read agents:write",
     "org": "acme",
     "roles": ["agent-runner", "data-access"]
   }
   ```

2. **Agent Gateway** validates JWT, extracts claims
3. **Policy Engine** evaluates claims against policy (actor, scope, role, org)
4. **Decision**: Allow/Deny + log

**Best for**: Cedar (PARC conditions), CEL (jwt variables), OPA (full context)

---

### **Pattern 2: Keycloak Role Manager → Casbin**
1. **Keycloak** maintains roles & user-role mappings
2. **Casbin Role Manager** plugin syncs roles:
   ```python
   casbin.role_manager().addLink('alice-svc', 'agent-runner', 'acme')
   casbin.enforce('alice-svc', 'documents', 'read')
   ```

3. **Casbin Policy** defines RBAC rules:
   ```
   p, agent-runner, documents, read, acme, allow
   ```

**Best for**: Casbin (no other engine supports this pattern)

---

### **Pattern 3: OAuth 2.0 Token Exchange (OBO) via Keycloak**
For true **on-behalf-of (OBO)** with service account impersonation:

1. **Client** (user context) requests token exchange:
   ```
   POST /protocol/openid-connect/token
   grant_type=urn:ietf:params:oauth:grant-type:token-exchange
   subject_token=<user_jwt>
   actor_token=<service_account_jwt>
   requested_token_use=access_token
   ```

2. **Keycloak** validates both tokens, issues new token with both `sub` and `act` claims

3. **Agent Gateway** validates token, extracts `act` (actor)

4. **Policy Engine** checks:
   - Is principal authorized to act on behalf of actor?
   - Does actor have permission for action?

**Best implementation**: Cedar (PARC conditions) or OPA (Datalog delegation logic)

---

## Implementation Checklist for CAIPE

### Quick Start (Agentic AI Platform)

**Option A: AgentGateway + Cedar (Recommended for MCP Agent Platform)**
- [ ] Deploy AgentGateway (standalone or Kubernetes)
- [ ] Configure Keycloak issuer & JWKS endpoint for MCP auth
- [ ] Set up AgentGateway policy with Keycloak JWT validation
- [ ] Connect external Cedar service or use CEL expressions for authorization
- [ ] Route MCP servers through AgentGateway (aggregate multiple servers)
- [ ] Test via built-in AgentGateway UI on port 15000
- [ ] Set up OpenTelemetry for observability

**Option B: Cedar (Recommended for Deterministic Boundaries)**
- [ ] Deploy Cedar Agent + OPAL (open-source)
- [ ] Configure Keycloak to issue JWT with `actor`, `scope`, `roles` claims
- [ ] Write Cedar PARC policies for agent tool calls
- [ ] Integrate gateway to extract JWT, query Cedar, cache decisions
- [ ] Set up policy versioning in Git (OPAL pulls on update)
- [ ] Test with MCP server policy generation

**Option C: IBAC + OpenFGA (Recommended for Prompt Injection Resilience)**
- [ ] Deploy OpenFGA service (Docker: `docker run -p 8080:8080 openfga/openfga run`)
- [ ] Define OpenFGA authorization model (user, tool_invocation types, can_invoke relation with TTL)
- [ ] Create intent parser (Claude with conservative prompt)
- [ ] Integrate into agent gateway:
  1. Parse user intent → extract capabilities
  2. Create OpenFGA tuples for authorized actions
  3. Before each tool call, check OpenFGA tuples
- [ ] Set up Keycloak event publisher to sync roles → OpenFGA tuples
- [ ] Test against prompt injection attacks

**Option D: OpenFGA (Recommended for Multi-Tenant Collaboration)**
- [ ] Deploy OpenFGA with Postgres backend
- [ ] Design relationship-based authorization model (user/agent roles, sharing, delegation)
- [ ] Create Keycloak event publisher to sync user roles as tuples
- [ ] Implement tuple management API (share button, request access workflows)
- [ ] Set up SDKs (Go, Python, .NET, JS) in agent services
- [ ] Manage relationship tuples via Git + CI/CD

**Option E: CEL (Lightweight)**
- [ ] Integrate CEL library in agent gateway (Go, Python, etc.)
- [ ] Write CEL expressions in YAML policy config
- [ ] Keycloak JWT claims available as `jwt.*`
- [ ] Deploy to Kubernetes (native ValidatingAdmissionPolicy support)
- [ ] Manage policy versions in Git, reload on change

**Option F: Casbin (Simple RBAC)**
- [ ] Initialize Casbin with RBAC model + Keycloak role manager
- [ ] Define policy rules (role, resource, action, domain)
- [ ] Sync roles from Keycloak on startup/periodic
- [ ] Embed enforcer in agent code
- [ ] Limited to role-based decisions (no OBO conditions)

**Option G: OPA (Complex Infrastructure)**
- [ ] Deploy OPA daemon (or sidecar per agent)
- [ ] Write Rego policies for agent authz + infrastructure
- [ ] Configure policy bundles (versioning, distribution)
- [ ] Keycloak JWT → OPA query with full context
- [ ] Build authorization service wrapper for agent gateway

---

## Security Considerations

### Default-Deny Posture
- **Cedar**: Default-deny with forbid wins over permit ✅
- **CEL**: Must implement in expressions (no engine-level guarantee)
- **Casbin**: Configurable via policy_effect; not default
- **OPA**: Configurable; not default (explicit allow required)

### Formal Verification
- **Cedar**: Provides formal verification capabilities ✅
- **CEL**: Four-valued logic aids reasoning but no proof ⚠️
- **Casbin**: No verification
- **OPA**: No formal verification (Styra Enterprise adds governance)

### Audit & Logging
- **Cedar**: AWS Verified Permissions logs to CloudTrail; self-hosted needs custom logging
- **CEL**: Depends on embedding (AgentGateway has logging)
- **Casbin**: Policy changes logged via adapter (DB)
- **OPA**: Built-in decision logging; Styra Enterprise adds audit

---

## Migration Path

**Current State**: Keycloak + identity federation (OAuth 2.0 Token Exchange, OBO flows)

**Path 1 → Cedar**:
```
Keycloak OAuth2 → JWT with (sub, act, scope, roles)
    ↓
Agent Gateway validates + extracts claims
    ↓
Cedar Agent queries policy with (Principal, Action, Resource, Conditions)
    ↓
Decision cached per identity
```

**Path 2 → CEL (lightweight)**:
```
Same as Cedar but:
    ↓
CEL expression evaluator (embedded in gateway)
    ↓
Inline decision (no external service)
```

**Path 3 → Casbin + Keycloak role sync**:
```
Keycloak (role manager)
    ↓ [Plugin sync]
    ↓
Casbin enforcer (in-process)
    ↓
RBAC decision only (no OBO conditions)
```

---

## Conclusion

For **CAIPE agentic AI platform with Keycloak identity federation**:

### **Primary Recommendations**

1. **Best overall**: **AgentGateway + Cedar**
   - Deploy AgentGateway as MCP proxy (Linux Foundation project)
   - Configure Keycloak JWT validation + MCP auth spec compliance
   - Connect external Cedar service for fine-grained PARC policies
   - Get production observability + built-in UI out of the box
   - Native MCP server aggregation and OAuth 2.0 Token Exchange support

2. **Best for deterministic boundaries**: **Cedar** (standalone)
   - Deploy Cedar Agent + OPAL (self-hosted, open-source)
   - Keycloak JWT → Cedar PARC policies
   - Production-ready for multi-agent scenarios
   - Formal verification of policies

3. **Best for prompt-injection resilience**: **IBAC + OpenFGA**
   - Blocked 240/240 prompt injection attacks (AgentDojo benchmark)
   - Minimal operational overhead (one OpenFGA service)
   - Auditable permission decisions via relationship tuples
   - Perfect for user-facing agents

4. **Best for multi-tenant collaboration**: **OpenFGA**
   - Relationship-based authorization (Google Zanzibar inspired)
   - Natural expression of delegation chains and hierarchies
   - Keycloak event publisher syncs roles → tuples
   - CNCF Incubation project, battle-tested

### **Secondary Recommendations**

5. **Lightweight alternative**: **CEL** (if gateway latency is critical and policies are simple)
   - Embedded library, no external service
   - Native to Kubernetes/cloud platforms

6. **Simple RBAC**: **Casbin** (if teams prefer config-driven, minimal learning)
   - Easy Keycloak role sync via plugins
   - Limited to role hierarchies (no fine-grained OBO conditions)

7. **Complex infrastructure**: **OPA/Rego** (if managing policies across multiple services)
   - Powerful but requires Datalog expertise
   - Overkill for pure agent authz (Cedar is better fit)
   - ⚠️ Note: Recent uncertainty about OPA's future (Apple hired maintainers in Aug 2025)

---

## References

- [Cedar Policy (AWS)](https://www.cedarpolicy.com/)
- [CEL Language (Google)](https://cel.dev/)
- [Apache Casbin](https://casbin.org/)
- [Open Policy Agent (OPA/Rego)](https://www.openpolicyagent.org/)
- [AgentGateway (Linux Foundation)](https://agentgateway.dev/)
- [IBAC - Intent-Based Access Control](https://ibac.dev/)
- [OpenFGA (Zanzibar-inspired, CNCF Sandbox)](https://openfga.dev/)
- [AWS Bedrock AgentCore Policy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html)
- [AgentGateway MCP Authorization](https://agentgateway.dev/docs/standalone/latest/mcp/mcp-authn/)
- [Keycloak Identity Federation](https://www.keycloak.org/)
- [OpenFGA + Keycloak Integration](https://medium.com/@embesozzi/keycloak-integration-with-openfga-based-on-zanzibar-for-fine-grained-authorization-at-scale-d3376de00f9a)