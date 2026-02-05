#!/bin/sh
# Entrypoint script to inject runtime environment variables into Next.js

# Create runtime config that will be served to the browser
# NEXT_PUBLIC_A2A_BASE_URL is the URL browsers use to reach the CAIPE agent
# (defaults to localhost:8000 for local Docker development)
cat > /app/public/env-config.js << EOF
window.__ENV__ = {
  NEXT_PUBLIC_A2A_BASE_URL: "${NEXT_PUBLIC_A2A_BASE_URL:-http://localhost:8000}",
  NEXT_PUBLIC_SSO_ENABLED: "${NEXT_PUBLIC_SSO_ENABLED:-false}",
  NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS: "${NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS:-true}"
};
EOF

# Start Next.js server
exec node server.js
