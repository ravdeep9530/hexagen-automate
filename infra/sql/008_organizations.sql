-- Organizations & Projects hierarchy.
-- Run on Docker first boot for new installs.
-- For existing installs the server.ts initDB IIFE applies the same changes idempotently.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);

-- projects: add uuid as stable external ID alongside the existing SERIAL PK.
-- New FKs reference uuid so the SERIAL id is never exposed in the API.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS uuid        UUID UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug        TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();
UPDATE projects SET uuid = gen_random_uuid() WHERE uuid IS NULL;

ALTER TABLE agent_repo_registry     ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(uuid) ON DELETE SET NULL;
ALTER TABLE pipeline_runs           ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(uuid) ON DELETE SET NULL;
ALTER TABLE workspace_members       ADD COLUMN IF NOT EXISTS org_id     UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS org_id     UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_id        ON projects (org_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project  ON pipeline_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_repos_project          ON agent_repo_registry (project_id);
