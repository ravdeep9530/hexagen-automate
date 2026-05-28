#!/bin/bash
# Postgres image runs files in /docker-entrypoint-initdb.d/ on first boot.
# Create the auxiliary `n8n` database alongside the default `agentic` one.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE n8n;
EOSQL
