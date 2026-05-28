-- Local-deployment tracking. The platform spawns a child process per run that
-- serves the generated app on an allocated port; the row keeps the state the
-- UI needs (status, URL) and lets us cleanly shut things down.

CREATE TABLE IF NOT EXISTS pipeline_deployments (
  run_id          UUID PRIMARY KEY REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
                  -- starting | installing | running | stopped | failed
  port            INTEGER,
  pid             INTEGER,
  url             TEXT,
  work_dir        TEXT,
  log_path        TEXT,
  start_command   TEXT,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_deployments_status
  ON pipeline_deployments (status);

-- Reuse the pipeline_event notification channel so the SSE stream picks up
-- deploy lifecycle changes without a separate listener.
CREATE OR REPLACE FUNCTION notify_pipeline_deployment_event() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  PERFORM pg_notify('pipeline_event', NEW.run_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipeline_deployments_notify ON pipeline_deployments;
CREATE TRIGGER trg_pipeline_deployments_notify
  BEFORE INSERT OR UPDATE ON pipeline_deployments
  FOR EACH ROW EXECUTE FUNCTION notify_pipeline_deployment_event();
