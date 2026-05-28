-- Design preferences captured at pipeline launch.
-- Consumed by stages 1 (requirements), 4 (design), 6 (implementation) as
-- additional input. Schema:
--   { preset: 'material-ui' | 'tailwind-shadcn' | 'custom',
--     ideas: string,                  -- free-form notes from the user
--     references: [{kind:'website'|'github', url:string, note?:string}] }

ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS design_preferences JSONB;

COMMENT ON COLUMN pipeline_runs.design_preferences IS
  'User-selected design intent: preset + free-form ideas + reference URLs. Forwarded to Dify on stages 1/4/6.';
