-- Run-status tables driving the UI's per-stage visibility.
-- n8n writes status transitions; backend LISTENs on pipeline_event and pushes SSE frames.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_full_name  TEXT NOT NULL REFERENCES agent_repo_registry(repo_full_name),
  raw_request     TEXT NOT NULL,
  requester_id    TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',
                  -- queued | running | awaiting_approval | approved | rejected | completed | failed
  current_stage   TEXT,
                  -- requirements | optimize | plan | design | sprint | implementation | test
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_repo_created
  ON pipeline_runs (repo_full_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
  ON pipeline_runs (status);

CREATE TABLE IF NOT EXISTS pipeline_stage_status (
  id                    SERIAL PRIMARY KEY,
  run_id                UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  stage                 TEXT NOT NULL,
  status                TEXT NOT NULL,
                        -- pending | running | awaiting_approval | approved | rejected | failed | skipped
  dify_run_id           TEXT,
  resume_webhook_url    TEXT,
  artifact_url          TEXT,
  artifact_json         JSONB,
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  error                 TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stage_status_run
  ON pipeline_stage_status (run_id, stage);

-- NOTIFY on every row change so the backend can broadcast SSE without polling.
CREATE OR REPLACE FUNCTION notify_pipeline_event() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  PERFORM pg_notify('pipeline_event', NEW.run_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipeline_stage_status_notify ON pipeline_stage_status;
CREATE TRIGGER trg_pipeline_stage_status_notify
  BEFORE INSERT OR UPDATE ON pipeline_stage_status
  FOR EACH ROW EXECUTE FUNCTION notify_pipeline_event();

CREATE OR REPLACE FUNCTION notify_pipeline_run_event() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  PERFORM pg_notify('pipeline_event', NEW.run_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipeline_runs_notify ON pipeline_runs;
CREATE TRIGGER trg_pipeline_runs_notify
  BEFORE INSERT OR UPDATE ON pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION notify_pipeline_run_event();
