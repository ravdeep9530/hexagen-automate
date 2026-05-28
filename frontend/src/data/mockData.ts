// Stage display metadata — keeps icon, model name, and description for the UI.
// Stage key names and API types live in src/api/pipelinesApi.tsx.

export interface StageMeta {
  key: string;
  name: string;
  icon: string;
  model: string;
  desc: string;
}

export const STAGE_META: StageMeta[] = [
  { key: 'requirements',   name: 'Requirements',   icon: 'Requirements', model: 'claude-sonnet-4-5', desc: 'Distill user intent into structured requirements' },
  { key: 'optimize',       name: 'Optimize',       icon: 'Sparkles',     model: 'claude-sonnet-4-5', desc: 'Refine scope, resolve ambiguity, score effort' },
  { key: 'plan',           name: 'Plan',           icon: 'Layers',       model: 'gpt-5-pro',         desc: 'Generate technical plan & architectural notes' },
  { key: 'design',         name: 'Design',         icon: 'Brush',        model: 'claude-sonnet-4-5', desc: 'Draft UI/UX, component contracts, schemas' },
  { key: 'sprint',         name: 'Sprint',         icon: 'Sprint',       model: 'gpt-5-pro',         desc: 'Break work into tickets, estimate, sequence' },
  { key: 'implementation', name: 'Implementation', icon: 'Code',         model: 'claude-sonnet-4-5', desc: 'Author code changes, run build & validation' },
  { key: 'test',           name: 'Test',           icon: 'Test',         model: 'claude-sonnet-4-5', desc: 'Generate & execute tests, capture coverage' },
];

// Maps every status name (API + UI) to a human-readable label.
export const STATUS_LABEL: Record<string, string> = {
  pending:                 'Pending',
  queued:                  'Queued',
  running:                 'Running',
  awaiting_clarification:  'Awaiting clarification',
  awaiting_approval:       'Awaiting approval',
  clarify:                 'Awaiting clarification',
  approval:                'Awaiting approval',
  approved:                'Approved',
  completed:               'Completed',
  rejected:                'Rejected',
  failed:                  'Failed',
  skipped:                 'Skipped',
};
