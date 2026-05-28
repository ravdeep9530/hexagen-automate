-- Live activity ticker — what the stage is doing RIGHT NOW.
-- Free-form text, only meaningful while status='running'. n8n writes it as
-- the workflow advances ('Calling Dify (gpt-4.1)…', 'Parsing response…').
-- Backend writes it during clarification rounds and SharePoint upload/sync.
-- Cleared (set NULL) when the stage transitions to awaiting_* or approved/rejected.

ALTER TABLE pipeline_stage_status
  ADD COLUMN IF NOT EXISTS current_activity TEXT;

COMMENT ON COLUMN pipeline_stage_status.current_activity IS
  'Live activity ticker — free-form text shown in the UI while status=running. Backend/n8n update it as the workflow advances.';
