-- Ensure integration_connections are indexed by org for fast per-org lookups.
-- The org_id column already exists (added in 008); this migration adds the index
-- and back-fills any rows that were created before org scoping was enforced.

CREATE INDEX IF NOT EXISTS idx_integration_connections_org_id
    ON integration_connections(org_id);
