-- Step 1 clarification loop + SharePoint round-trip.
--
-- pipeline_stage_status.status now also supports 'awaiting_clarification'
-- (after the first Dify call returned a non-empty open_questions[]). The
-- backend drives this row through one or more clarification rounds and
-- finally flips it to 'awaiting_approval'.
--
-- dify_conversation_id holds the Dify chat conversation id so follow-up
-- turns continue the same context. (dify_run_id stores the *message* id,
-- which is per-turn and not reusable.)
--
-- pipeline_runs.requirements_resume_url stores the n8n resume URL minted
-- by the continuation webhook, kept at the run level so a "Sync from
-- SharePoint" that resets the stage row preserves it.

ALTER TABLE pipeline_stage_status
  ADD COLUMN IF NOT EXISTS dify_conversation_id TEXT;

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS requirements_resume_url TEXT;

COMMENT ON COLUMN pipeline_stage_status.status IS
  'pending | running | awaiting_clarification | awaiting_approval | approved | rejected | failed | skipped';

COMMENT ON COLUMN pipeline_runs.status IS
  'queued | running | awaiting_clarification | awaiting_approval | approved | rejected | completed | failed';
