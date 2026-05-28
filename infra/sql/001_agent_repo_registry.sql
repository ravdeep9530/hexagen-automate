-- Registry of GitHub repos the agent pipeline operates on.
-- One row per repo; n8n looks this up at pipeline start to resolve Dify app IDs,
-- Slack channel, SharePoint drive, and GitHub App installation.

CREATE TABLE IF NOT EXISTS agent_repo_registry (
  id                      SERIAL PRIMARY KEY,
  repo_full_name          TEXT UNIQUE NOT NULL,           -- "org/repo"
  repo_url                TEXT,
  default_branch          TEXT NOT NULL DEFAULT 'main',
  github_app_install_id   BIGINT,
  dify_workflow_app_ids   JSONB NOT NULL DEFAULT '{}'::jsonb,
                          -- e.g. {"requirements":"app-uuid","optimize":"...","plan":"...",
                          --       "design":"...","sprint":"...","implementation":"...","test":"..."}
  dify_kb_id              TEXT,
  slack_channel_id        TEXT,
  sharepoint_drive_id     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_repo_registry_repo
  ON agent_repo_registry (repo_full_name);
