// Shared design tokens used across the pipelines UI.
// Inline-style based to match the rest of the codebase.

export const tokens = {
    color: {
        bg: '#f6f7fb',
        card: '#ffffff',
        border: '#e5e8ef',
        borderStrong: '#d4d8e0',
        text: '#0f172a',
        textMuted: '#64748b',
        textSubtle: '#94a3b8',
        primary: '#2563eb',
        primaryHover: '#1d4ed8',
        primarySoft: '#dbeafe',
        success: '#16a34a',
        successSoft: '#dcfce7',
        warning: '#f59e0b',
        warningSoft: '#fef3c7',
        danger: '#dc2626',
        dangerSoft: '#fee2e2',
        info: '#0ea5e9',
        infoSoft: '#e0f2fe',
        slate: '#475569',
        slateSoft: '#f1f5f9',
    },
    radius: { sm: 6, md: 10, lg: 14, pill: 999 },
    shadow: {
        sm: '0 1px 2px rgba(15,23,42,.05)',
        md: '0 4px 12px rgba(15,23,42,.08)',
        lg: '0 8px 24px rgba(15,23,42,.10)',
        focus: '0 0 0 3px rgba(37,99,235,.18)',
    },
    space: (n: number) => n * 4,
    font: {
        body: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif`,
        mono: `"SF Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace`,
    },
};

export type StageStatusName =
    | 'pending' | 'running' | 'awaiting_clarification' | 'awaiting_approval' | 'approved' | 'rejected' | 'failed' | 'skipped';

export const statusStyle: Record<StageStatusName, {
    label: string; bg: string; fg: string; ring: string; iconBg: string; iconFg: string; animate?: 'pulse' | 'spin';
}> = {
    pending:                { label: 'Pending',              bg: tokens.color.slateSoft,   fg: tokens.color.slate,    ring: '#cbd5e1', iconBg: '#cbd5e1', iconFg: '#fff' },
    running:                { label: 'Running',              bg: tokens.color.primarySoft, fg: tokens.color.primary,  ring: tokens.color.primary, iconBg: tokens.color.primary, iconFg: '#fff', animate: 'pulse' },
    awaiting_clarification: { label: 'Awaiting clarification', bg: '#ede9fe',              fg: '#5b21b6',             ring: '#8b5cf6', iconBg: '#8b5cf6', iconFg: '#fff', animate: 'pulse' },
    awaiting_approval:      { label: 'Awaiting approval',    bg: tokens.color.warningSoft, fg: '#92400e',             ring: tokens.color.warning, iconBg: tokens.color.warning, iconFg: '#fff' },
    approved:               { label: 'Approved',             bg: tokens.color.successSoft, fg: '#166534',             ring: tokens.color.success, iconBg: tokens.color.success, iconFg: '#fff' },
    rejected:               { label: 'Rejected',             bg: tokens.color.dangerSoft,  fg: '#991b1b',             ring: tokens.color.danger,  iconBg: tokens.color.danger,  iconFg: '#fff' },
    failed:                 { label: 'Failed',               bg: tokens.color.dangerSoft,  fg: '#991b1b',             ring: tokens.color.danger,  iconBg: tokens.color.danger,  iconFg: '#fff' },
    skipped:                { label: 'Skipped',              bg: tokens.color.slateSoft,   fg: tokens.color.slate,    ring: '#cbd5e1', iconBg: '#cbd5e1', iconFg: '#fff' },
};

// CSS injected once by PipelinesManager so we can use @keyframes / :hover etc.
export const PIPELINE_CSS = `
@keyframes pl-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.08); opacity: 0.85; }
}
@keyframes pl-spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes pl-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pl-blink {
  0%, 50%, 100% { opacity: 1; }
  25%, 75%      { opacity: 0; }
}
@keyframes pl-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.pl-pulse { animation: pl-pulse 1.4s ease-in-out infinite; }
.pl-spin  { animation: pl-spin 1.0s linear infinite; }
.pl-fade-in { animation: pl-fade-in .25s ease-out both; }
.pl-blink { animation: pl-blink 1.0s steps(1, end) infinite; color: #2563eb; font-weight: bold; }
.pl-shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(37,99,235,.12) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: pl-shimmer 1.8s linear infinite;
}
.pl-card:hover { box-shadow: 0 6px 18px rgba(15,23,42,.10); transform: translateY(-1px); transition: all .15s; }
.pl-btn-primary:hover:not(:disabled)   { background: #1d4ed8 !important; }
.pl-btn-success:hover:not(:disabled)   { background: #15803d !important; }
.pl-btn-danger:hover:not(:disabled)    { background: #b91c1c !important; }
.pl-btn-ghost:hover:not(:disabled)     { background: #f1f5f9 !important; }
.pl-row:hover { background: #f8fafc; }
.pl-link:hover { text-decoration: underline; }
.pl-stage-row:hover .pl-stage-actions { opacity: 1; }
input.pl-input:focus, textarea.pl-input:focus, select.pl-input:focus {
  outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.18);
}
`;
