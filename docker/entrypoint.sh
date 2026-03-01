#!/bin/sh

set -e

echo "=== Client - Configuring runtime environment ==="

# Set default values if not provided
export VITE_PB_URL=${VITE_PB_URL:-/db}
export VITE_SERVER_URL=${VITE_SERVER_URL:-/api}

echo "Replacing environment variables in built files..."
echo "  - VITE_PB_URL: ${VITE_PB_URL}"
echo "  - VITE_SERVER_URL: ${VITE_SERVER_URL}"

# Replace placeholders in all JS and HTML files
find /usr/share/nginx/html -type f \( -name "*.js" -o -name "*.html" \) -exec sed -i \
  -e "s|__VITE_PB_URL_PLACEHOLDER__|${VITE_PB_URL}|g" \
  -e "s|__VITE_SERVER_URL_PLACEHOLDER__|${VITE_SERVER_URL}|g" \
  {} \;

echo "=== Client ready ==="

echo "=== PocketBase - Initialization ==="
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  echo "Creating/updating admin account (${PB_SUPERUSER_EMAIL})..."
  pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" --dir=/app/db/pb_data 2>&1 || {
    echo "Warning: failed to create admin account"
  }
else
  echo "PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD not set, skipping admin creation"
fi
echo "=== PocketBase ready ==="

# Execute CMD
exec "$@"
