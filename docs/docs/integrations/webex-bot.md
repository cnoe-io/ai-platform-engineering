# Webex Bot Integration

The CAIPE Webex bot connects to the Webex platform via WebSocket (WDM pattern) and forwards user messages to the CAIPE supervisor via the A2A protocol. Responses are streamed back using a hybrid approach with progress updates.

## Features

- **Real-time messaging** via WebSocket (no webhooks required)
- **A2A protocol** streaming with execution plan and tool progress
- **Adaptive Cards** for structured responses, HITL forms, and feedback
- **Space authorization** with MongoDB-backed registry and TTL cache
- **1:1 and group space** support with threading
- **Feedback collection** via Langfuse integration

## Setup

### Prerequisites

1. Create a Webex Bot at [developer.webex.com](https://developer.webex.com/my-apps/new/bot)
2. Copy the Bot Access Token
3. A running CAIPE supervisor instance

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEBEX_BOT_TOKEN` | Yes | - | Bot access token from developer.webex.com |
| `CAIPE_URL` | No | `http://caipe-supervisor:8000` | CAIPE supervisor URL |
| `WEBEX_INTEGRATION_ENABLE_AUTH` | No | `false` | Enable OAuth2 for A2A requests |
| `WEBEX_INTEGRATION_AUTH_TOKEN_URL` | If auth enabled | - | OAuth2 token URL |
| `WEBEX_INTEGRATION_AUTH_CLIENT_ID` | If auth enabled | - | OAuth2 client ID |
| `WEBEX_INTEGRATION_AUTH_CLIENT_SECRET` | If auth enabled | - | OAuth2 client secret |
| `WEBEX_INTEGRATION_AUTH_SCOPE` | No | - | OAuth2 scope |
| `WEBEX_INTEGRATION_AUTH_AUDIENCE` | No | - | OAuth2 audience |
| `MONGODB_URI` | No | - | MongoDB connection URI for persistent sessions |
| `MONGODB_DATABASE` | No | `caipe` | MongoDB database name |
| `CAIPE_UI_BASE_URL` | No | `http://localhost:3000` | CAIPE UI URL for auth links |
| `LANGFUSE_SCORING_ENABLED` | No | `false` | Enable Langfuse feedback |
| `LANGFUSE_PUBLIC_KEY` | If Langfuse enabled | - | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | If Langfuse enabled | - | Langfuse secret key |
| `LANGFUSE_HOST` | If Langfuse enabled | - | Langfuse host URL |
| `WEBEX_SPACE_AUTH_CACHE_TTL` | No | `300` | Space auth cache TTL (seconds) |

### Running with Docker Compose

```bash
# Add WEBEX_BOT_TOKEN to your .env file
echo "WEBEX_BOT_TOKEN=your-bot-token-here" >> .env

# Start the Webex bot
docker compose --profile webex-bot up -d
```

### Running Locally

```bash
cd ai_platform_engineering/integrations/webex_bot
pip install -r requirements.txt
WEBEX_BOT_TOKEN=your-token CAIPE_URL=http://localhost:8000 python -m app
```

## Space Authorization

Group spaces must be authorized before the bot will respond. Authorization can be done in two ways:

### Bot Command
1. Add the bot to a Webex space
2. Send `@BotName authorize` in the space
3. Click the "Connect to CAIPE" button in the Adaptive Card
4. Authenticate via OIDC in the CAIPE UI
5. The space is now authorized

### Admin Dashboard
1. Navigate to the CAIPE Admin Dashboard
2. Go to the "Integrations" tab
3. Click "Add Space" and enter the Webex Room ID
4. The space is immediately authorized

1:1 direct messages are allowed by default without authorization.

## Architecture

```
User (Webex) ──→ Webex Cloud ──→ WebSocket ──→ Webex Bot
                                                   │
                                            A2A Protocol (SSE)
                                                   │
                                                   ▼
                                           CAIPE Supervisor
```

The bot uses the WDM (Web Device Management) pattern to establish a WebSocket connection with Webex, avoiding the need for public endpoints or webhook servers.

## Troubleshooting

### Bot not responding
- Verify `WEBEX_BOT_TOKEN` is set and valid
- Check logs for WebSocket connection errors
- Ensure the CAIPE supervisor is reachable at `CAIPE_URL`

### Space authorization denied
- Verify the space is authorized in the admin dashboard
- Check MongoDB connectivity
- Wait up to 5 minutes for cache TTL to expire after authorization

### Rate limiting
- The bot throttles message updates to every 3 seconds
- Long responses are split into chunks of 7000 characters
