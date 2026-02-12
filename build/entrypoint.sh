#!/bin/sh
# Entrypoint script for CAIPE UI Next.js application
#
# Runtime environment variables (NEXT_PUBLIC_*) are injected by the
# PublicEnvScript server component in layout.tsx. It reads process.env
# at request time and renders an inline <script> tag with all NEXT_PUBLIC_*
# values into window.__RUNTIME_ENV__. No static file generation needed.
#
# This entrypoint simply starts the Next.js standalone server.

# Log available NEXT_PUBLIC_* vars for debugging
echo "🚀 Starting CAIPE UI..."
echo "   NEXT_PUBLIC_* variables detected:"
env | grep '^NEXT_PUBLIC_' | sort | while read -r line; do
  key="${line%%=*}"
  echo "   - ${key}"
done
echo ""

# Start Next.js server
exec node server.js
