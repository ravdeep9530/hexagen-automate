import React from 'react';
import { I } from '../icons';
import { usePipelineList, PipelineRunSummary, RunStatus } from '../api/pipelinesApi';
import { useOrgProject } from '../contexts/OrgProjectContext';
import { STAGE_META } from '../data/mockData';

const STAGE_KEYS = STAGE_META.map(s => s.key);

// Map API status names to CSS class suffixes used by index.css pills/dots.
export function toUiStatus(s: string): string {
  if (s === 'awaiting_clarification') return 'clarify';
  if (s === 'awaiting_approval')      return 'approval';
  if (s === 'completed')              return 'approved';
  if (s === 'queued')                 return 'pending';
  return s;
}

const PILL_MAP: Record<string, { cls: string; label: string }> = {
  pending:                { cls: 'pill--pending',   label: 'Queued' },
  queued:                 { cls: 'pill--pending',   label: 'Queued' },
  running:                { cls: 'pill--running',   label: 'Running' },
  clarify:                { cls: 'pill--clarify',   label: 'Awaiting clarification' },
  awaiting_clarification: { cls: 'pill--clarify',   label: 'Awaiting clarification' },
  approval:               { cls: 'pill--approval',  label: 'Awaiting approval' },
  awaiting_approval:      { cls: 'pill--approval',  label: 'Awaiting approval' },
  approved:               { cls: 'pill--approved',  label: 'Approved' },
  completed:              { cls: 'pill--approved',  label: 'Completed' },
  rejected:               { cls: 'pill--rejected',  label: 'Rejected' },
  failed:                 { cls: 'pill--failed',    label: 'Failed' },
  skipped:                { cls: 'pill--skipped',   label: 'Skipped' },
};

export const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const m = PILL_MAP[status] ?? { cls: 'pill--pending', label: status };
  return (
    <span className={'pill ' + m.cls}>
      <span className="pill__dot"/>
      {m.label}
    </span>
  );
};

export const PriorityDot: React.FC<{ p: string }> = ({ p }) => {
  const color = p === 'high' || p === 'urgent' ? 'var(--danger-fg)'
              : p === 'medium' ? 'var(--warning-fg)'
              : 'var(--text-3)';
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}/>;
};

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Derive approximate per-stage statuses from the run-level status + current_stage.
// Used for the mini stage bar in the list — not exact but a good approximation.
function deriveStageStatuses(run: PipelineRunSummary): string[] {
  const currentIdx = run.current_stage ? STAGE_KEYS.indexOf(run.current_stage) : -1;
  return STAGE_KEYS.map((_, i) => {
    if (run.status === 'completed') return 'approved';
    if (run.status === 'rejected' || run.status === 'failed') {
      if (i < currentIdx) return 'approved';
      if (i === currentIdx) return run.status === 'rejected' ? 'rejected' : 'failed';
      return 'pending';
    }
    if (i < currentIdx) return 'approved';
    if (i === currentIdx) {
      if (run.status === 'awaiting_clarification') return 'clarify';
      if (run.status === 'awaiting_approval')      return 'approval';
      return 'running';
    }
    return 'pending';
  });
}

const STAGE_DOT_COLOR: Record<string, string> = {
  approved:  'var(--success-fg)',
  running:   'var(--primary)',
  approval:  'var(--warning-fg)',
  clarify:   '#8b5cf6',
  rejected:  'var(--danger-fg)',
  failed:    'var(--danger-fg)',
  skipped:   'var(--text-3)',
  pending:   'var(--border-strong)',
};

function titleFromRequest(raw: string): string {
  const first = raw.split('\n')[0].trim();
  return first.length > 80 ? first.slice(0, 78) + '…' : first;
}

type FilterTab = 'all' | 'active' | 'completed' | 'rejected';

const isActive    = (s: RunStatus) => s === 'running' || s === 'awaiting_approval' || s === 'awaiting_clarification' || s === 'queued';
const isCompleted = (s: RunStatus) => s === 'completed' || s === 'approved';
const isRejected  = (s: RunStatus) => s === 'rejected'  || s === 'failed';

interface PipelinesScreenProps {
  onOpen: (runId: string) => void;
  onNew: () => void;
}

export const PipelinesScreen: React.FC<PipelinesScreenProps> = ({ onOpen, onNew }) => {
  const { activeProject } = useOrgProject();
  const { runs, loading, refetch } = usePipelineList(5000, activeProject?.id);
  const [filter, setFilter] = React.useState<FilterTab>('all');
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    let xs = runs;
    if (filter === 'active')    xs = xs.filter(r => isActive(r.status));
    if (filter === 'completed') xs = xs.filter(r => isCompleted(r.status));
    if (filter === 'rejected')  xs = xs.filter(r => isRejected(r.status));
    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter(r =>
        r.repo_full_name.toLowerCase().includes(q) ||
        r.raw_request.toLowerCase().includes(q) ||
        r.run_id.toLowerCase().includes(q),
      );
    }
    return xs;
  }, [runs, filter, search]);

  const stats = React.useMemo(() => ({
    active:    runs.filter(r => isActive(r.status)).length,
    completed: runs.filter(r => isCompleted(r.status)).length,
    rejected:  runs.filter(r => isRejected(r.status)).length,
    total:     runs.length,
  }), [runs]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">SDLC Pipelines</h1>
          <p className="page-header__subtitle">
            {activeProject ? <>Project: <strong>{activeProject.name}</strong> — </> : ''}Every run — live status, auto-refreshes every 5 s.
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn" onClick={refetch} disabled={loading}>
            <I.Refresh size={14}/> Refresh
          </button>
          <button className="btn btn--primary" onClick={onNew}>
            <I.Plus size={14}/> New pipeline
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat__value">{stats.total}</div>
          <div className="stat__label">Total runs</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{color: 'var(--primary)'}}>{stats.active}</div>
          <div className="stat__label">Active</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{color: 'var(--success-fg)'}}>{stats.completed}</div>
          <div className="stat__label">Completed</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{color: 'var(--danger-fg)'}}>{stats.rejected}</div>
          <div className="stat__label">Failed / rejected</div>
        </div>
      </div>

      <div className="card">
        <div className="card__hd" style={{flexWrap: 'wrap', gap: 10}}>
          <div className="tabs">
            {(['all', 'active', 'completed', 'rejected'] as FilterTab[]).map(f => (
              <button key={f} className={'tab ' + (filter === f ? 'is-active' : '')} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
                {f !== 'all' && (
                  <span className="nav-item__count" style={{marginLeft: 4}}>
                    {f === 'active' ? stats.active : f === 'completed' ? stats.completed : stats.rejected}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="search-wrap" style={{marginLeft: 'auto'}}>
            <I.Search size={13}/>
            <input
              className="search-wrap__input"
              placeholder="Search repo, request…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Repository</th>
                <th>Request</th>
                <th>Status</th>
                <th>Stages</th>
                <th>Created</th>
                <th/>
              </tr>
            </thead>
            <tbody>
              {loading && runs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{textAlign: 'center', padding: '28px 0', color: 'var(--text-3)', fontSize: 13}}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{textAlign: 'center', padding: '28px 0', color: 'var(--text-3)', fontSize: 13}}>
                    No runs found.
                  </td>
                </tr>
              )}
              {filtered.map(run => {
                const stageDots = deriveStageStatuses(run);
                const parts = run.repo_full_name.split('/');
                const org  = parts.length > 1 ? parts[0] : '';
                const repo = parts.length > 1 ? parts[1] : parts[0];
                return (
                  <tr key={run.run_id} className="table-row--clickable" onClick={() => onOpen(run.run_id)}>
                    <td>
                      <span className="mono" style={{fontSize: 12, fontWeight: 500, color: 'var(--text-2)'}}>
                        {run.run_id.length > 14 ? run.run_id.slice(0, 12) + '…' : run.run_id}
                      </span>
                    </td>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                        <I.Repo size={13} style={{color: 'var(--text-3)', flexShrink: 0}}/>
                        <span className="mono" style={{fontSize: 12}}>
                          {org && <span style={{color: 'var(--text-3)'}}>{org}/</span>}
                          <b style={{color: 'var(--text-1)'}}>{repo}</b>
                        </span>
                      </div>
                    </td>
                    <td style={{maxWidth: 340}}>
                      <div style={{fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                        {titleFromRequest(run.raw_request)}
                      </div>
                      {run.requester_id && (
                        <div style={{fontSize: 11.5, color: 'var(--text-3)', marginTop: 2}}>
                          <I.User size={11}/> {run.requester_id}
                        </div>
                      )}
                    </td>
                    <td><StatusPill status={run.status}/></td>
                    <td>
                      <div style={{display: 'flex', gap: 3, alignItems: 'center'}}>
                        {stageDots.map((s, i) => (
                          <span key={i} title={(STAGE_META[i]?.name ?? '') + ': ' + s} style={{
                            width: 9, height: 9, borderRadius: 2,
                            background: STAGE_DOT_COLOR[s] ?? 'var(--border-strong)',
                            border: s === 'pending' ? '1px solid var(--border-strong)' : 'none',
                            flexShrink: 0,
                          }}/>
                        ))}
                      </div>
                    </td>
                    <td style={{fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap'}}>
                      {relTime(run.created_at)}
                    </td>
                    <td>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={e => { e.stopPropagation(); onOpen(run.run_id); }}
                      >
                        View <I.ChevronRight size={12}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
