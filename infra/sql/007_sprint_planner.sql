-- Sprint planner: per-ticket human vs system assignment and workspace member registry.

CREATE TABLE IF NOT EXISTS workspace_members (
  id           SERIAL PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email        TEXT,
  avatar_color TEXT NOT NULL DEFAULT '#2563eb',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workspace_members (username, display_name, email, avatar_color)
VALUES ('system', 'System (AI)', NULL, '#2563eb')
ON CONFLICT (username) DO NOTHING;

-- One row per (run, ticket); absent rows default to system assignment.
CREATE TABLE IF NOT EXISTS sprint_task_assignments (
  run_id      UUID    NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  ticket_id   TEXT    NOT NULL,
  assignee    TEXT    NOT NULL DEFAULT 'system',
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_sprint_task_assignments_run
  ON sprint_task_assignments (run_id);
