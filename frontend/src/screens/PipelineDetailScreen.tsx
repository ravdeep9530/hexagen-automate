import React from 'react';
import { I } from '../icons';
import { AgentAvatar } from '../components/agents';
import {
  usePipelineRun, useDeploymentLogs, useFixAgentLog, useDeployControls, useCreatePRs,
  useRerunPipeline, useRerunStage, useRequirementsClarify, useChangeRequests,
  Stage, StageStatus, PipelineRun,
} from '../api/pipelinesApi';
import { ChangeRequestsSection } from '../features/pipelines/ChangeRequestsSection';
import { STAGE_META, StageMeta } from '../data/mockData';
import { StatusPill, relTime, toUiStatus } from './PipelinesScreen';
import { StageVisualization } from '../features/pipelines/StageVisualizations';

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcElapsed(started: string | null, finished: string | null): string {
  if (!started) return '—';
  const end = finished ? new Date(finished).getTime() : Date.now();
  const s = Math.floor((end - new Date(started).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function uiStatus(s: string) { return toUiStatus(s); }

function flowEdgeCls(a: string, b: string): string {
  const ua = uiStatus(a), ub = uiStatus(b);
  if (ua === 'approved' && (ub === 'running' || ub === 'approval' || ub === 'clarify')) return 'is-active';
  if (ua === 'approved') return 'is-done';
  if (ua === 'running')  return 'is-active';
  return '';
}

// ── StageCard ────────────────────────────────────────────────────────────────

// ── StageCard ────────────────────────────────────────────────────────────────

interface StageCardProps {
  idx: number;
  meta: StageMeta;
  stageData: StageStatus;
  open: boolean;
  onToggle: () => void;
  onOpenLogs: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onRerun?: () => void;
  onViewPlanner?: () => void;
  onViewDesigner?: () => void;
  onViewSprintPlanner?: () => void;
  onViewRequirements?: () => void;
  onCreateChangeRequest?: () => void;
  runId: string;
}

const StageCard: React.FC<StageCardProps> = ({
  idx, meta, stageData, open, onToggle, onOpenLogs, onApprove, onReject, onRerun, onViewPlanner, onViewDesigner, onViewSprintPlanner, onViewRequirements, onCreateChangeRequest, runId,
}) => {
  const ui = uiStatus(stageData.status);
  const cls =
    ui === 'approved' ? 'is-done' :
    ui === 'running'  ? 'is-current' :
    ui === 'approval' ? 'is-awaiting' :
    ui === 'clarify'  ? 'is-clarify' :
    ui === 'failed'   ? 'is-failed' :
    ui === 'rejected' ? 'is-rejected' : '';

  const IconEl = I[meta.icon];
  const elapsed = calcElapsed(stageData.started_at, stageData.finished_at);

  // Clarify answers state
  const { submit: submitClarify, loading: clarifyLoading } = useRequirementsClarify();
  const [clarifyAnswers, setClarifyAnswers] = React.useState<Record<string, string>>({});

  const openQuestions: string[] = React.useMemo(() => {
    if (ui !== 'clarify') return [];
    const art = stageData.artifact_json as any;
    if (!art) return [];
    return art.parsed?.open_questions ?? art.open_questions ?? [];
  }, [stageData.artifact_json, ui]);

  return (
    <div className={'stage-card ' + cls}>
      <div className="stage-card__hd" onClick={onToggle}>
        <div className="stage-num">
          {ui === 'approved' ? <I.Check size={14}/> :
           (ui === 'rejected' || ui === 'failed') ? <I.X size={14}/> :
           idx + 1}
        </div>
        <div style={{minWidth: 0}}>
          <div className="row" style={{gap: 8}}>
            <span className="stage-name">{meta.name}</span>
            {IconEl && <IconEl size={13} style={{color: 'var(--text-3)'}}/>}
          </div>
          <div className="stage-meta">
            <span className="mono">{meta.model}</span>
            <span>·</span>
            <span><I.Clock size={11}/> {elapsed}</span>
            {stageData.current_activity && (
              <>
                <span>·</span>
                <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{stageData.current_activity}</span>
              </>
            )}
            {stageData.error && (
              <>
                <span>·</span>
                <span style={{color: 'var(--danger-fg)'}}>{stageData.error}</span>
              </>
            )}
          </div>
        </div>
        <div className="stage-card__hd-right">
          <StatusPill status={stageData.status}/>
          <button className="btn btn--ghost btn--sm btn--icon">
            <I.ChevronDown size={14} style={{transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms'}}/>
          </button>
        </div>
      </div>

      {open && (
        <div className="stage-card__bd">
          <>{stageData.artifact_url && (
            <div style={{ marginBottom: 10 }}>
              <a href={stageData.artifact_url} target="_blank" rel="noreferrer"
                className="btn btn--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <I.External size={12}/> Open SharePoint document
              </a>
            </div>
          )}

          {stageData.artifact_json && (
            <StageVisualization stage={meta.key as Stage} artifactJson={stageData.artifact_json} runId={runId}/>
          )}

          {ui === 'clarify' && openQuestions.length > 0 && (
            <div className="clarify-form" style={{ marginTop: 14 }}>
              <h4><I.Question size={14}/> The agent needs your input — {openQuestions.length} question{openQuestions.length !== 1 ? 's' : ''}</h4>
              {openQuestions.map((q, i) => (
                <div key={i} style={{marginBottom: 10}}>
                  <div className="clarify-q">{q}</div>
                  <textarea
                    className="textarea"
                    rows={2}
                    placeholder="Your answer…"
                    value={clarifyAnswers[String(i)] ?? ''}
                    onChange={e => setClarifyAnswers(prev => ({ ...prev, [String(i)]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="row mt-8">
                <button
                  className="btn btn--sm"
                  disabled={clarifyLoading}
                  onClick={() => submitClarify(runId, {}, { force_proceed: true })}
                >
                  Skip &amp; let agent decide
                </button>
                <button
                  className="btn btn--primary btn--sm"
                  disabled={clarifyLoading}
                  onClick={() => {
                    const answers: Record<string, string> = {};
                    openQuestions.forEach((q, i) => { answers[q] = clarifyAnswers[String(i)] ?? ''; });
                    submitClarify(runId, answers);
                  }}
                >
                  {clarifyLoading ? 'Submitting…' : 'Submit answers'}
                </button>
              </div>
            </div>
          )}

          <div className="action-row">
            <button className="btn btn--sm" onClick={onOpenLogs}>
              <I.Logs size={13}/> View logs
            </button>
            {stageData.artifact_url && (
              <a href={stageData.artifact_url} target="_blank" rel="noreferrer" className="btn btn--sm">
                <I.Folder size={13}/> Open artifact
              </a>
            )}
            {stageData.dify_run_id && (
              <a
                href={`${process.env.REACT_APP_DIFY_BASE || 'http://docker-vm-dev-01:8080'}/app`}
                target="_blank" rel="noreferrer" className="btn btn--sm">
                <I.External size={13}/> Open in Dify
              </a>
            )}
            {meta.key === 'requirements' && stageData.artifact_json != null && onViewRequirements && (
              <button className="btn btn--primary btn--sm" onClick={onViewRequirements}>
                ✎ View / Edit Requirements
              </button>
            )}
            {meta.key === 'plan' && stageData.artifact_json != null && onViewPlanner && (
              <button className="btn btn--primary btn--sm" onClick={onViewPlanner}>
                ✎ View in Planner
              </button>
            )}
            {meta.key === 'design' && stageData.artifact_json != null && onViewDesigner && (
              <button className="btn btn--primary btn--sm" onClick={onViewDesigner}>
                ✎ Open Design Studio
              </button>
            )}
            {meta.key === 'sprint' && stageData.artifact_json != null && onViewSprintPlanner && (
              <button className="btn btn--primary btn--sm" onClick={onViewSprintPlanner}>
                ⚡ Sprint Planner
              </button>
            )}
            {(['requirements', 'plan', 'design'] as const).includes(meta.key as any)
              && stageData.status === 'approved'
              && onCreateChangeRequest ? (
              <button className="btn btn--sm" onClick={onCreateChangeRequest}
                style={{ background: 'var(--warning-soft)', color: '#92400e', border: '1px solid rgba(245,158,11,0.35)' }}>
                ↩ Change Request
              </button>
            ) : null}
            {onRerun && (
              <button className="btn btn--sm" onClick={onRerun}>
                <I.Refresh size={13}/> Rerun stage
              </button>
            )}

            {meta.key === 'implementation' && (
              <>
                <button className="btn btn--sm"><I.Cloud size={13}/> Deploy preview</button>
                <button className="btn btn--sm"><I.PR size={13}/> Create draft PR</button>
              </>
            )}

            <div className="action-row__spacer"/>

            {ui === 'approval' && onApprove && onReject && (
              <>
                <button className="btn btn--danger btn--sm" onClick={onReject}>
                  <I.X size={13}/> Reject
                </button>
                <button className="btn btn--success btn--sm" onClick={onApprove}>
                  <I.Check size={13}/> Approve &amp; advance
                </button>
              </>
            )}
            {ui === 'approved' && stageData.finished_at && (
              <span className="text-3" style={{fontSize: 11.5}}>
                Approved · {relTime(stageData.finished_at)}
              </span>
            )}
            {(ui === 'pending' || ui === 'queued') && (
              <span className="text-3" style={{fontSize: 11.5}}>Awaiting upstream</span>
            )}
          </div>
          </>
        </div>
      )}
    </div>
  );
};

// ── Agent Graph ───────────────────────────────────────────────────────────────

interface AgentNodeProps {
  idx: number;
  meta: StageMeta;
  stageData: StageStatus;
  selected: boolean;
  onSelect: (key: string) => void;
}

const AgentNode: React.FC<AgentNodeProps> = ({ idx, meta, stageData, selected, onSelect }) => {
  const ui = uiStatus(stageData.status);
  const cls =
    ui === 'approved' ? 'is-done' :
    ui === 'running'  ? 'is-current' :
    ui === 'approval' ? 'is-awaiting' :
    ui === 'clarify'  ? 'is-clarify' :
    ui === 'failed'   ? 'is-failed' :
    ui === 'rejected' ? 'is-rejected' : '';

  const modelShort = meta.model.replace('claude-', '').replace('gpt-', 'GPT ');

  return (
    <div
      className={'agent-node ' + cls + (selected ? ' is-selected' : '')}
      onClick={() => onSelect(meta.key)}
    >
      <div className="agent-node__hd">
        <span className="pill__dot"/>
        {ui === 'approved' ? 'Done' : ui === 'running' ? 'Running' : ui === 'approval' ? 'Awaiting' :
         ui === 'clarify' ? 'Clarify' : ui === 'pending' ? 'Queued' : ui === 'failed' ? 'Failed' :
         ui === 'rejected' ? 'Rejected' : ui}
        <span className="agent-node__num">#{idx + 1}</span>
      </div>
      <div className="agent-node__body">
        <div className="agent-node__avatar"><AgentAvatar kind={meta.key} size={44}/></div>
        <div className="agent-node__name">{meta.name}</div>
        <div className="agent-node__model" title={meta.model}>{modelShort}</div>
        <div className="agent-node__elapsed">
          <I.Clock size={10}/> {calcElapsed(stageData.started_at, stageData.finished_at)}
        </div>
      </div>
      <div className="agent-node__ft" title={stageData.current_activity ?? ''}>
        {ui === 'running'  && <I.Sparkles size={11}/>}
        {ui === 'approval' && <I.Question size={11}/>}
        {ui === 'clarify'  && <I.Question size={11}/>}
        {ui === 'approved' && <I.CheckCircle size={11}/>}
        {(ui === 'pending' || ui === 'queued') && <I.Clock size={11}/>}
        <span>{stageData.current_activity ?? meta.desc}</span>
      </div>
    </div>
  );
};

const ShipNode: React.FC<{ ready: boolean }> = ({ ready }) => (
  <div className={'agent-node agent-node--ship' + (ready ? ' is-selected' : '')}>
    <div className="agent-node__hd">
      <span className="pill__dot"/>
      {ready ? 'Ready' : 'Pending'}
      <span className="agent-node__num">END</span>
    </div>
    <div className="agent-node__body">
      <div className="agent-node__avatar"><AgentAvatar kind="ship" size={44}/></div>
      <div className="agent-node__name">Ship</div>
      <div className="agent-node__model">draft PR · deploy</div>
      <div className="agent-node__elapsed"><I.PR size={10}/> on approve</div>
    </div>
    <div className="agent-node__ft">
      <I.Github size={11}/>
      <span>{ready ? 'Open draft PR on GitHub' : 'Awaiting all stages'}</span>
    </div>
  </div>
);

const FlowConnector: React.FC<{ status: string; direction?: 'right' | 'left' }> = ({ status, direction = 'right' }) => (
  <div className={'flow-edge ' + status + (direction === 'left' ? ' flow-edge--left' : '')}>
    <div className="flow-edge__line"/>
    <div className="flow-edge__arrow"/>
  </div>
);

interface GraphViewProps {
  stages: StageStatus[];
  selectedKey: string;
  onSelect: (key: string) => void;
}

const GraphView: React.FC<GraphViewProps> = ({ stages, selectedKey, onSelect }) => {
  const row1 = stages.slice(0, 4);
  const row2 = stages.slice(4);
  const lastDone = stages.every(s => uiStatus(s.status) === 'approved');
  const doneCount = stages.filter(s => uiStatus(s.status) === 'approved').length;

  return (
    <div className="agent-flow-wrap">
      <div className="agent-flow-meta">
        <I.GitGraph size={14}/>
        <span><b>Agent workflow</b> · 7 stages · {doneCount}/7 complete</span>
        <div className="agent-flow-meta__legend">
          <span><i style={{background: 'var(--success)'}}/> Done</span>
          <span><i style={{background: 'var(--primary)'}}/> Running</span>
          <span><i style={{background: 'var(--warning)'}}/> Awaiting</span>
          <span><i style={{background: '#8b5cf6'}}/> Clarify</span>
          <span><i style={{background: 'var(--neutral-100)', border: '1px solid var(--border-strong)'}}/> Queued</span>
        </div>
      </div>

      <div className="agent-flow">
        <div className="agent-flow__row">
          {row1.map((s, i) => (
            <React.Fragment key={s.stage}>
              <AgentNode idx={i} meta={STAGE_META[i]} stageData={s} selected={selectedKey === s.stage} onSelect={onSelect}/>
              {i < row1.length - 1 && <FlowConnector status={flowEdgeCls(s.status, row1[i + 1].status)}/>}
            </React.Fragment>
          ))}
        </div>

        <div className={'agent-flow__joint ' + flowEdgeCls(row1[3]?.status ?? 'pending', row2[0]?.status ?? 'pending')}>
          <span className="joint-dash"/>
        </div>

        <div className="agent-flow__row agent-flow__row--reverse">
          {row2.map((s, i) => (
            <React.Fragment key={s.stage}>
              <AgentNode idx={i + 4} meta={STAGE_META[i + 4]} stageData={s} selected={selectedKey === s.stage} onSelect={onSelect}/>
              {i < row2.length - 1 && <FlowConnector status={flowEdgeCls(s.status, row2[i + 1].status)} direction="left"/>}
            </React.Fragment>
          ))}
          <FlowConnector
            status={flowEdgeCls(row2[row2.length - 1]?.status ?? 'pending', lastDone ? 'approved' : 'pending')}
            direction="left"
          />
          <ShipNode ready={lastDone}/>
        </div>
      </div>
    </div>
  );
};

// ── Rail components ───────────────────────────────────────────────────────────

const RailLogs: React.FC<{ runId: string; enabled: boolean }> = ({ runId, enabled }) => {
  const logContent = useDeploymentLogs(runId, enabled);
  const scrollRef = React.useRef<HTMLPreElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logContent]);

  return (
    <>
      <div className="deploy-bar">
        <span className="pill pill--running"><span className="pill__dot"/> Live</span>
        <span className="text-3 mono" style={{fontSize: 11}}>{runId}</span>
      </div>
      <pre ref={scrollRef} className="logs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {logContent || <span style={{ color: 'var(--text-3)' }}>Waiting for log output…</span>}
      </pre>
    </>
  );
};

const RailArtifacts: React.FC<{ run: PipelineRun; stages: StageStatus[] }> = ({ run, stages }) => {
  const items = stages
    .filter(s => s.artifact_url || s.artifact_json)
    .map(s => {
      const meta = STAGE_META.find(m => m.key === s.stage);
      return { stage: meta?.name ?? s.stage, url: s.artifact_url, has_json: !!s.artifact_json };
    });

  if (items.length === 0) {
    return <div style={{ padding: '16px 14px', color: 'var(--text-3)', fontSize: 13 }}>No artifacts yet.</div>;
  }

  return (
    <div style={{padding: '8px 0'}}>
      {items.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <I.Code size={13} style={{color: 'var(--text-3)'}}/>
          <div style={{flex: 1, minWidth: 0}}>
            <div className="mono" style={{fontSize: 12, color: 'var(--text-1)', fontWeight: 500}}>{a.stage}</div>
            <div style={{fontSize: 11, color: 'var(--text-3)'}}>{a.has_json ? 'JSON artifact' : ''}</div>
          </div>
          {a.url && (
            <a href={a.url} target="_blank" rel="noreferrer" className="btn btn--ghost btn--sm btn--icon">
              <I.External size={12}/>
            </a>
          )}
        </div>
      ))}
    </div>
  );
};

const RailDeploy: React.FC<{ run: PipelineRun }> = ({ run }) => {
  const { deploy, stop, loading } = useDeployControls();
  const dep = run.deployment;
  const isAutoFix = dep?.status === 'auto-fixing';
  const isCrashed = dep?.status === 'crashed';
  const isRunning = dep?.status === 'running';
  const [showLog, setShowLog] = React.useState(false);
  const fixLog = useFixAgentLog(run.run_id, isAutoFix || isCrashed);
  const deployLog = useDeploymentLogs(run.run_id, isRunning && showLog);

  const statusPill = dep?.status === 'running'      ? 'pill--approved' :
                     dep?.status === 'installing'   ? 'pill--running' :
                     dep?.status === 'starting'     ? 'pill--running' :
                     dep?.status === 'auto-fixing'  ? 'pill--running' :
                     dep?.status === 'crashed'      ? 'pill--failed' :
                     dep?.status === 'failed'       ? 'pill--failed' :
                     dep?.status === 'stopped'      ? 'pill--skipped' : null;

  const statusLabel = dep?.status === 'auto-fixing' ? '⚙ Auto-fixing crash…'
                    : dep?.status === 'crashed'     ? '✗ Crashed'
                    : dep?.status;

  const canDeploy = !dep || dep.status === 'stopped' || dep.status === 'failed';
  const canStop   = dep && (dep.status === 'running' || dep.status === 'installing' || dep.status === 'starting');

  return (
    <>
      <div className="deploy-bar">
        {dep && statusPill
          ? <span className={'pill ' + statusPill} style={isAutoFix ? {animation:'pl-pulse 1.4s infinite'} : undefined}>
              <span className="pill__dot"/> {statusLabel}
            </span>
          : <span className="pill pill--skipped"><span className="pill__dot"/> Not deployed</span>}
        {dep?.url && (
          <a className="deploy-url" href={dep.url} target="_blank" rel="noreferrer">{dep.url}</a>
        )}
      </div>

      <div style={{padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10}}>
        {/* Crash error excerpt */}
        {dep?.error && !isAutoFix && (
          <div style={{ fontSize: 12, color: 'var(--danger-fg)', padding: '6px 8px', background: 'var(--danger-soft)', borderRadius: 6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
            {dep.error.slice(0, 600)}
          </div>
        )}

        {/* Auto-fix progress section */}
        {(isAutoFix || (isCrashed && fixLog)) && (
          <div style={{ border: '1px solid var(--primary-border, #3b82f680)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '8px 10px', background: 'var(--primary-soft, #eff6ff)', fontSize: 12, fontWeight: 600, color: 'var(--primary, #2563eb)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {isAutoFix && <span style={{width:8,height:8,borderRadius:'50%',background:'var(--primary,#2563eb)',display:'inline-block',animation:'pl-pulse 1.4s infinite'}}/>}
              {isAutoFix ? 'Fix agent running — reading source files and applying patches' : 'Fix agent log'}
            </div>
            {fixLog && (
              <pre style={{ margin: 0, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', background: '#0f172a', color: '#e2e8f0', maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {fixLog.slice(-6000)}
              </pre>
            )}
          </div>
        )}

        {/* Live deployment log for running state */}
        {isRunning && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div
              onClick={() => setShowLog(v => !v)}
              style={{ padding: '6px 10px', background: 'var(--bg-2)', fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}
            >
              <span>▸ App logs</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{showLog ? 'click to hide' : 'click to show'}</span>
            </div>
            {showLog && (
              <pre style={{ margin: 0, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', background: '#0f172a', color: '#e2e8f0', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {deployLog ? deployLog.slice(-5000) : '… waiting for logs …'}
              </pre>
            )}
          </div>
        )}

        <div className="row" style={{gap: 6, flexWrap: 'wrap'}}>
          {canDeploy && (
            <button className="btn btn--sm" disabled={loading} onClick={() => deploy(run.run_id)}>
              <I.Play size={13}/> {loading ? 'Deploying…' : 'Deploy preview'}
            </button>
          )}
          {canStop && (
            <button className="btn btn--sm" disabled={loading} onClick={() => stop(run.run_id)}>
              <I.Stop size={13}/> {loading ? 'Stopping…' : 'Stop deploy'}
            </button>
          )}
          {isAutoFix && (
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>Auto-fix in progress…</span>
          )}
        </div>
      </div>
    </>
  );
};

const RailPR: React.FC<{ run: PipelineRun }> = ({ run }) => {
  const { createPRs, loading, error } = useCreatePRs();
  const implStage = run.stages.find(s => s.stage === 'implementation');
  const impl = implStage?.artifact_json as any;

  return (
    <div style={{padding: 16}}>
      <div className="row mb-12" style={{gap: 8}}>
        <I.PR size={18} style={{color: 'var(--primary)'}}/>
        <div>
          <div style={{fontWeight: 600, fontSize: 14, color: 'var(--text)'}}>Create draft PRs</div>
          <div style={{fontSize: 12, color: 'var(--text-3)'}}>{run.repo_full_name}</div>
        </div>
      </div>
      {impl?.pr_title && (
        <>
          <div className="form-row mb-8">
            <label>PR title</label>
            <input className="input" defaultValue={impl.pr_title} readOnly/>
          </div>
          {impl.pr_body_markdown && (
            <div className="form-row mb-8">
              <label>Body</label>
              <textarea className="textarea" rows={5} defaultValue={impl.pr_body_markdown} readOnly/>
            </div>
          )}
          {impl.branch_name && (
            <div className="form-row mb-12">
              <label>Branch</label>
              <span className="branch">{impl.branch_name}</span>
            </div>
          )}
        </>
      )}
      {error && <div style={{color: 'var(--danger-fg)', fontSize: 12, marginBottom: 8}}>{error}</div>}
      <button
        className="btn btn--primary"
        style={{width: '100%'}}
        disabled={loading}
        onClick={() => createPRs(run.run_id)}
      >
        <I.PR size={14}/> {loading ? 'Creating PRs…' : 'Open draft PR on GitHub'}
      </button>
    </div>
  );
};

// Pad run.stages to always contain all 7 STAGE_META entries (missing ones = pending)
function padStages(stages: StageStatus[]): StageStatus[] {
  return STAGE_META.map(m => {
    const found = stages.find(s => s.stage === m.key);
    if (found) return found;
    return {
      stage: m.key as Stage,
      status: 'pending' as const,
      dify_run_id: null,
      resume_webhook_url: null,
      artifact_url: null,
      artifact_json: null,
      started_at: null,
      finished_at: null,
      error: null,
      current_activity: null,
    };
  });
}

// ── Main screen ───────────────────────────────────────────────────────────────

interface PipelineDetailScreenProps {
  runId: string;
  onBack: () => void;
  onOpenPlanner?: () => void;
  onOpenDesigner?: () => void;
  onOpenSprintPlanner?: () => void;
  onOpenRequirementsEditor?: () => void;
  onNavigate?: (runId: string) => void;
}

export const PipelineDetailScreen: React.FC<PipelineDetailScreenProps> = ({ runId, onBack, onOpenPlanner, onOpenDesigner, onOpenSprintPlanner, onOpenRequirementsEditor, onNavigate }) => {
  const { run, connected, decide } = usePipelineRun(runId);
  const { rerun } = useRerunPipeline();
  const { rerunStage } = useRerunStage();
  const { changeRequests, refetch: refetchCRs } = useChangeRequests(runId);

  const [viewMode, setViewMode]   = React.useState<'graph' | 'stepper'>('graph');
  const [openStage, setOpenStage] = React.useState<string>('');
  const [railTab, setRailTab]     = React.useState('logs');

  // Auto-open the current stage when run loads
  React.useEffect(() => {
    if (run && !openStage) {
      const cur = run.current_stage ?? run.stages[run.stages.length - 1]?.stage ?? '';
      setOpenStage(cur);
    }
  }, [run, openStage]);

  if (!run) {
    return (
      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-3)', padding: '40px 0' }}>
          <I.Sparkles size={16}/>
          {connected ? 'Waiting for pipeline data…' : `Connecting to run ${runId}…`}
        </div>
      </div>
    );
  }

  const allStages = padStages(run.stages);
  const totalApproved = allStages.filter(s => uiStatus(s.status) === 'approved').length;
  const currentStageMeta = STAGE_META.find(m => m.key === run.current_stage) ?? STAGE_META[0];

  const handleDecide = async (stage: Stage, decision: 'approved' | 'rejected') => {
    await decide(stage, decision);
  };

  return (
    <div className="page page--wide">
      <div className="detail-hd">
        <div className="detail-hd__top">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>
            <I.ArrowLeft size={14}/>
          </button>
          <span className="mono" style={{fontSize: 12, fontWeight: 500, color: 'var(--text-2)'}}>
            {run.run_id}
          </span>
          <StatusPill status={run.status}/>
          {connected && <span className="live"><span className="live__dot"/> live · SSE connected</span>}

          <div className="ml-auto row" style={{gap: 6}}>
            <button className="btn btn--sm" onClick={() => rerun(run.run_id)}>
              <I.Refresh size={13}/> Rerun
            </button>
            {run.stages.find(s => s.stage === 'requirements')?.dify_run_id && (
              <a
                href={`${process.env.REACT_APP_N8N_BASE || 'http://docker-vm-dev-01:5678'}`}
                target="_blank" rel="noreferrer" className="btn btn--sm">
                <I.External size={13}/> Open in n8n
              </a>
            )}
            <button className="btn btn--sm btn--icon"><I.Cog size={14}/></button>
          </div>
        </div>

        <h1 style={{fontSize: 18, fontWeight: 700, margin: '8px 0 4px', lineHeight: 1.3}}>
          {run.raw_request.split('\n')[0].slice(0, 100)}
        </h1>

        <div className="detail-hd__meta">
          <span><I.Repo size={13}/> <b className="mono" style={{color: 'var(--text-1)'}}>{run.repo_full_name}</b></span>
          {run.requester_id && <span><I.User size={13}/> {run.requester_id}</span>}
          <span><I.Calendar size={13}/> Created {relTime(run.created_at)}</span>
          {run.current_stage && <span><I.Sparkles size={13}/> Stage: <b>{currentStageMeta.name}</b></span>}
        </div>

        <div className="progress">
          <div className="progress__bar">
            <div className="progress__fill" style={{width: ((totalApproved / 7) * 100) + '%'}}/>
          </div>
          <div className="progress__text">
            <span><b style={{color: 'var(--text-1)'}}>{totalApproved}/7</b> stages approved</span>
          </div>
        </div>
      </div>

      {run.current_stage && (
        <div className="activity-strip">
          <span className="live"><span className="live__dot"/> active</span>
          <div className="activity-strip__body">
            <b>Stage · {currentStageMeta.name}</b>
            {allStages.find(s => s.stage === run.current_stage)?.current_activity && (
              <> — {allStages.find(s => s.stage === run.current_stage)?.current_activity}</>
            )}
          </div>
          <span className="text-3" style={{fontSize: 11.5}}>updated just now</span>
        </div>
      )}

      <div className="row mb-12" style={{justifyContent: 'space-between'}}>
        <div className="tabs">
          <button className={'tab ' + (viewMode === 'graph' ? 'is-active' : '')} onClick={() => setViewMode('graph')}>
            <I.GitGraph size={13}/> Agent flow
          </button>
          <button className={'tab ' + (viewMode === 'stepper' ? 'is-active' : '')} onClick={() => setViewMode('stepper')}>
            <I.Layers size={13}/> Stepper
          </button>
        </div>
        <div className="row" style={{gap: 6}}>
          <button className="btn btn--sm btn--danger" onClick={() => { /* TODO: abort API */ }}>
            <I.Stop size={13}/> Abort run
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          {viewMode === 'graph' && (
            <>
              <GraphView
                stages={allStages}
                selectedKey={openStage}
                onSelect={k => setOpenStage(k)}
              />
              {openStage && (() => {
                const idx = allStages.findIndex(s => s.stage === openStage);
                const sd = allStages[idx];
                const meta = STAGE_META[idx];
                if (!sd || !meta) return null;
                return (
                  <StageCard
                    key={openStage}
                    idx={idx}
                    meta={meta}
                    stageData={sd}
                    open={true}
                    onToggle={() => {}}
                    onOpenLogs={() => setRailTab('logs')}
                    onApprove={() => handleDecide(sd.stage, 'approved')}
                    onReject={() => handleDecide(sd.stage, 'rejected')}
                    onRerun={() => rerunStage(run.run_id, sd.stage)}
                    onViewPlanner={sd.stage === 'plan' ? onOpenPlanner : undefined}
                    onViewDesigner={sd.stage === 'design' ? onOpenDesigner : undefined}
                    onViewSprintPlanner={sd.stage === 'sprint' ? onOpenSprintPlanner : undefined}
                    onViewRequirements={sd.stage === 'requirements' ? onOpenRequirementsEditor : undefined}
                    onCreateChangeRequest={
                      (['requirements', 'plan', 'design'] as const).includes(sd.stage as any)
                        ? (sd.stage === 'requirements' ? onOpenRequirementsEditor : sd.stage === 'plan' ? onOpenPlanner : onOpenDesigner)
                        : undefined
                    }
                    runId={run.run_id}
                  />
                );
              })()}
            </>
          )}

          {viewMode === 'stepper' && allStages.map((sd, i) => {
            const meta = STAGE_META[i];
            if (!meta) return null;
            return (
              <StageCard
                key={sd.stage}
                idx={i}
                meta={meta}
                stageData={sd}
                open={openStage === sd.stage}
                onToggle={() => setOpenStage(openStage === sd.stage ? '' : sd.stage)}
                onOpenLogs={() => setRailTab('logs')}
                onApprove={() => handleDecide(sd.stage, 'approved')}
                onReject={() => handleDecide(sd.stage, 'rejected')}
                onRerun={() => rerunStage(run.run_id, sd.stage)}
                onViewPlanner={sd.stage === 'plan' ? onOpenPlanner : undefined}
                onViewDesigner={sd.stage === 'design' ? onOpenDesigner : undefined}
                onViewSprintPlanner={sd.stage === 'sprint' ? onOpenSprintPlanner : undefined}
                onViewRequirements={sd.stage === 'requirements' ? onOpenRequirementsEditor : undefined}
                onCreateChangeRequest={
                  (['requirements', 'plan', 'design'] as const).includes(sd.stage as any)
                    ? (sd.stage === 'requirements' ? onOpenRequirementsEditor : sd.stage === 'plan' ? onOpenPlanner : onOpenDesigner)
                    : undefined
                }
                runId={run.run_id}
              />
            );
          })}

          {/* Change Requests */}
          {run.source_change_request_id ? (
            <div style={{ margin: '12px 0', padding: '8px 14px', background: 'var(--primary-soft)',
              border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8, fontSize: 13, color: 'var(--primary)' }}>
              This run was created from a Change Request.
            </div>
          ) : null}
          <ChangeRequestsSection
            runId={runId}
            changeRequests={changeRequests}
            onApplied={(newRunId) => {
              if (onNavigate) onNavigate(newRunId);
              else refetchCRs();
            }}
            onDismissed={refetchCRs}
          />
        </div>

        <aside className="rail">
          <div className="card" style={{overflow: 'hidden'}}>
            <div className="tab-bar">
              {[
                { k: 'logs',      label: 'Logs',       icon: 'Logs' },
                { k: 'artifacts', label: 'Artifacts',  icon: 'Folder' },
                { k: 'deploy',    label: 'Deployment', icon: 'Cloud' },
                { k: 'pr',        label: 'Draft PR',   icon: 'PR' },
              ].map(t => {
                const IconEl = I[t.icon];
                return (
                  <button key={t.k}
                    className={railTab === t.k ? 'is-active' : ''}
                    onClick={() => setRailTab(t.k)}>
                    {IconEl && <IconEl size={13}/>} {t.label}
                  </button>
                );
              })}
            </div>
            {railTab === 'logs'      && <RailLogs runId={run.run_id} enabled={railTab === 'logs'}/>}
            {railTab === 'artifacts' && <RailArtifacts run={run} stages={allStages}/>}
            {railTab === 'deploy'    && <RailDeploy run={run}/>}
            {railTab === 'pr'        && <RailPR run={run}/>}
          </div>

          <div className="card">
            <div className="card__hd"><h3>Agents &amp; models</h3></div>
            <div className="card__bd" style={{padding: 0}}>
              {STAGE_META.map((meta, i) => {
                const sd = allStages[i];
                const IconEl = I[meta.icon];
                return (
                  <div key={meta.key} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    borderBottom: i < 6 ? '1px solid var(--border)' : 'none',
                  }}>
                    {IconEl && <IconEl size={14} style={{color: 'var(--text-3)'}}/>}
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{fontSize: 12.5, fontWeight: 500}}>{meta.name}</div>
                      <div className="mono" style={{fontSize: 11, color: 'var(--text-3)'}}>{meta.model}</div>
                    </div>
                    {sd && <StatusPill status={sd.status}/>}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
