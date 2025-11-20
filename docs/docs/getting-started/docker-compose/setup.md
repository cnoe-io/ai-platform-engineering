---
sidebar_position: 1
---

# Run with Docker Compose 🚀🧑‍💻

Setup CAIPE to run in a docker environment on a laptop or a virtual machine like EC2 instance.

## Prerequisites

1. **Clone the repository**

   ```bash
   git clone https://github.com/cnoe-io/ai-platform-engineering.git
   cd ai-platform-engineering
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Update `.env` with your configuration. For detailed `.env` examples and LLM provider setup, see:
   - [Setup LLM Providers](configure-llms.md) for LLM configuration
   - [Quick Start Guide](../quick-start.md) for detailed `.env` examples and agent-specific configurations

3. **Configure A2A Authentication (Optional)**

   The A2A protocol supports two authentication methods. Choose one based on your security requirements:

   **Option A: OAuth2 Authentication (Recommended for Production)**

   Add the following to your `.env` file:
   ```bash
   A2A_AUTH_OAUTH2=true
   JWKS_URI=https://your-identity-provider.com/.well-known/jwks.json
   AUDIENCE=your-audience
   ISSUER=https://your-identity-provider.com
   OAUTH2_CLIENT_ID=your-client-id
   ```

   **Getting OAuth2 Tokens:**

   Use the provided utility to obtain OAuth2 JWT tokens:
   ```bash
   # Add these additional environment variables for token generation
   OAUTH2_CLIENT_SECRET=your-client-secret
   TOKEN_ENDPOINT=https://your-identity-provider.com/oauth/token

   # Run the utility to get a token
   python ai_platform_engineering/utils/oauth/get_oauth_jwt_token.py
   ```

   **Local Development with Keycloak:**

   For local development, you can run a Keycloak OAuth server:

   ```bash
   # Start local Keycloak server
   cd deploy/keycloak
   docker compose up
   ```

   Then configure your environment:
   ```bash
   A2A_AUTH_OAUTH2=true
   JWKS_URI=http://localhost:7080/realms/caipe/protocol/openid-connect/certs
   AUDIENCE=caipe
   ISSUER=http://localhost:7080/realms/caipe
   OAUTH2_CLIENT_ID=caipe-cli
   OAUTH2_CLIENT_SECRET=your-client-secret-from-keycloak
   TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token
   ```

   **Keycloak Setup Steps:**
   1. Access Keycloak admin console at http://localhost:7080
   2. Login with `admin/admin`
   3. Switch to the `caipe` realm
   4. Create a new client called `caipe-cli`
   5. Copy the client secret and use it in your environment variables

   **Generate JWT Token with Keycloak:**

   After setting up Keycloak, generate a JWT token using your client credentials:

   ```bash
   export OAUTH2_CLIENT_ID=caipe-cli
   export OAUTH2_CLIENT_SECRET=<YOUR CLIENT SECRET>  # randomly generated from Keycloak
   export TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token

   python ai_platform_engineering/utils/oauth/get_oauth_jwt_token.py
   ```

   **Option B: Shared Key Authentication (For Development/Testing)**

   Add the following to your `.env` file:
   ```bash
   A2A_AUTH_SHARED_KEY=your-secret-key
   ```

   > **Note:** If neither authentication method is enabled, the A2A agent will run without authentication. This is not recommended for production environments.

---

## 🏁 Getting Started

4. **Launch with Docker Compose**

   ```bash
   docker compose up
   ```

5. **Connect to the A2A agent**

   Once the Docker Compose services are running, connect using one of these methods:

   **Option A: Using Docker (host network)**
   ```bash
   docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
   ```

   **Option B: Using uvx**
   ```bash
   uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a
   ```

   > 💡 For more connection options and troubleshooting, see the [Quick Start Guide](../quick-start.md).

6. **[Optional] Connect via Backstage Agent-Forge Plugin**

   Run the Agent Forge plugin with Docker:

   ```bash
   docker run -d \
     --name backstage-agent-forge \
     -p 13000:3000 \
     -e NODE_ENV=development \
     ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
   ```

   **Or with Docker Compose:**

   ```bash
   COMPOSE_PROFILES="agentforge" docker compose up
   ```

   Once the container is started, open agent-forge in your browser:
   ```
   http://localhost:13000
   ```

   > 💡 Learn more about [Agent Forge Backstage Plugin](../user-interfaces.md#agent-forge-backstage-plugin).

---

> 🛠️ *For Docker Compose profiles, agent selection, and advanced configuration, check out the [Quick Start Guide](../quick-start.md).*

