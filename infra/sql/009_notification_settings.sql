-- Notification settings per channel (teams | email).
-- One row per channel; absent = fall back to env-var behaviour.

CREATE TABLE IF NOT EXISTS notification_settings (
  channel        TEXT        PRIMARY KEY,  -- 'teams' | 'email'
  enabled        BOOLEAN     NOT NULL DEFAULT false,
  config         JSONB       NOT NULL DEFAULT '{}',
  -- teams config shape: { "webhook_url": "https://..." }
  -- email config shape: { "smtp_host": "", "smtp_port": 587, "smtp_secure": false,
  --                        "smtp_user": "", "smtp_pass": "", "recipients": [] }
  triggers       TEXT[]      NOT NULL DEFAULT '{}',
  -- valid: 'stage_approval' | 'pipeline_complete' | 'pipeline_rejected'
  context_fields TEXT[]      NOT NULL DEFAULT '{}',
  -- valid: 'artifact_summary' | 'stage_details' | 'run_id' | 'pr_link'
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
