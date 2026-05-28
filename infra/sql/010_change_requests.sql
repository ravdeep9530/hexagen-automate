-- Change Requests: user-proposed edits to already-approved stages.
-- Linked to a source pipeline run + stage. Applying one spawns a new run
-- with prior stages pre-seeded as approved so n8n skips them.

CREATE TABLE IF NOT EXISTS change_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  stage             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
                    -- pending | applied | dismissed
  proposed_artifact JSONB NOT NULL,
  stage_snapshots   JSONB NOT NULL DEFAULT '{}',
                    -- { requirements: {...}, optimize: {...}, plan: {...}, design: {...} }
                    -- snapshot of every approved stage artifact at CR creation time
  sharepoint_url    TEXT,
  applied_run_id    UUID REFERENCES pipeline_runs(run_id) ON DELETE SET NULL,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_requests_run_id
  ON change_requests (run_id, stage);

-- Track that a run was spawned by applying a change request.
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS source_change_request_id UUID REFERENCES change_requests(id) ON DELETE SET NULL;
