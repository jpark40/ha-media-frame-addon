#!/usr/bin/with-contenv bashio
set -e

bashio::log.info "Starting HA Media Frame on port 8099"
exec python3 /app/server.py
