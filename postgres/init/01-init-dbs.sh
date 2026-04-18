#!/bin/bash
# Runs once, the first time Postgres starts with an empty data volume.
# Creates a separate logical database for each service so they don't
# collide on tables or extensions.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE ${N8N_DB};
    CREATE DATABASE ${OPENWEBUI_DB};
    GRANT ALL PRIVILEGES ON DATABASE ${N8N_DB}       TO ${POSTGRES_USER};
    GRANT ALL PRIVILEGES ON DATABASE ${OPENWEBUI_DB} TO ${POSTGRES_USER};
EOSQL

echo "Created databases: ${N8N_DB}, ${OPENWEBUI_DB}"
