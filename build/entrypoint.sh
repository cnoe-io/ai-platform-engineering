#!/bin/sh
# Entrypoint script for CAIPE UI Next.js application
#
# Generates /app/public/env-config.js at container start with all NEXT_PUBLIC_*
# environment variables. This file is loaded synchronously in <head> before any
# React/Next.js code, guaranteeing runtime env vars are available to client JS.
#
# This is the PRIMARY mechanism for runtime env injection in Docker/K8s.
# PublicEnvScript in layout.tsx is a SECONDARY mechanism for dynamic SSR pages.

set -e

echo "🚀 Starting CAIPE UI..."
echo "   Generating runtime environment config..."

# Generate env-config.js with all NEXT_PUBLIC_* variables
# This file is served as a static asset and loaded before any client JS
ENV_FILE="/app/public/env-config.js"

# Start the JS object
printf 'window.__RUNTIME_ENV__ = {\n' > "$ENV_FILE"

# Collect all NEXT_PUBLIC_* env vars
env | grep '^NEXT_PUBLIC_' | sort | while IFS='=' read -r key value; do
  # JSON-escape the value (handle quotes, backslashes, newlines)
  escaped=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g')
  printf '  "%s": "%s",\n' "$key" "$escaped" >> "$ENV_FILE"
  echo "   ✓ ${key}"
done

# Close the JS object
printf '};\n' >> "$ENV_FILE"

echo ""
echo "   env-config.js written with $(env | grep -c '^NEXT_PUBLIC_' || echo 0) variables"
echo ""

# Start Next.js server
exec node server.js
