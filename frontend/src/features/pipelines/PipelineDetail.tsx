import React, { useEffect, useState } from 'react';
import { STAGES, usePipelineRun, Stage, useRepos, useRerunPipeline, useRerunStage, useDeployControls, useCreatePRs, useFixWithDeployError, useDiagnoseDeployError, type DeployDiagnosis, useRequirementsClarify, useSyncRequirementsFromSharePoint, useChangeRequests } from '../../api/pipelinesApi';
import { StageCard } from './StageCard';
import { tokens, statusStyle } from './design';
import { PipelineGraph } from './PipelineGraph';
import { DeploymentLogs } from './DeploymentLogs';
import { ChangeRequestsSection } from './ChangeRequestsSection';

// Public-facing URLs used by the "Open ↗" new-tab buttons.
const N8N_PUBLIC_BASE = process.env.REACT_APP_N8N_BASE || 'http://docker-vm-dev-01:5678';
const DIFY_PUBLIC_BASE = process.env.REACT_APP_DIFY_BASE || 'http://docker-vm-dev-01:8080';

// Iframe proxy ports — nginx pass-through that strips X-Frame-Options so the
// browser allows embedding. Same content, different port, no SPA path issues.
const N8N_IFRAME_BASE = process.env.REACT_APP_N8N_IFRAME_BASE || 'http://docker-vm-dev-01:5679';
const DIFY_IFRAME_BASE = process.env.REACT_APP_DIFY_IFRAME_BASE || 'http://docker-vm-dev-01:8081';

const RUN_STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
    queued:                 { bg: tokens.color.slateSoft,   fg: tokens.color.slate },
    running:                { bg: tokens.color.primarySoft, fg: tokens.color.primary },
    awaiting_clarification: { bg: '#ede9fe',                fg: '#5b21b6' },
    awaiting_approval:      { bg: tokens.color.warningSoft, fg: '#92400e' },
    completed:              { bg: tokens.color.successSoft, fg: '#166534' },
    rejected:               { bg: tokens.color.dangerSoft,  fg: '#991b1b' },
    failed:                 { bg: tokens.color.dangerSoft,  fg: '#991b1b' },
};

const ERROR_TYPE_ICON: Record<string, string> = {
    docker_daemon:    '🐳',
    port_conflict:    '🔌',
    dockerfile_error: '📦',
    missing_module:   '📦',
    code_error:       '🐛',
    startup_timeout:  '⏱',
    unknown:          '⚠️',
};

function FileChangeDiff({ change }: { change: import('../../api/pipelinesApi').DeployFileChange }) {
    const [open, setOpen] = React.useState(false);
    const lines = change.new_content.split('\n');
    return (
        <div style={{
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            overflow: 'hidden',
            marginBottom: 8,
        }}>
            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                    padding: '8px 12px',
                    background: open ? '#0f172a' : tokens.color.slateSoft,
                }}
            >
                <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, flexShrink: 0 }}>M</span>
                <span style={{ fontSize: 12, fontFamily: tokens.font.mono, color: open ? '#94a3b8' : tokens.color.text, flex: 1 }}>
                    {change.path}
                </span>
                <span style={{ fontSize: 11, color: open ? '#475569' : tokens.color.textMuted }}>
                    {lines.length} lines {open ? '▾' : '▸'}
                </span>
            </button>
            <div style={{ padding: '6px 12px', background: '#f0fdf4', borderTop: `1px solid ${tokens.color.border}` }}>
                <span style={{ fontSize: 11, color: '#166534' }}>{change.explanation}</span>
            </div>
            {open ? (
                <div style={{ display: 'flex', background: '#0f172a', maxHeight: 280, overflow: 'auto' }}>
                    <div style={{ padding: '8px 8px', minWidth: 36, textAlign: 'right', color: '#334155', fontSize: 11, fontFamily: tokens.font.mono, lineHeight: 1.6, userSelect: 'none', flexShrink: 0, borderRight: '1px solid #1e293b' }}>
                        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
                    </div>
                    <pre style={{ margin: 0, padding: '8px 14px', flex: 1, fontSize: 11, lineHeight: 1.6, fontFamily: tokens.font.mono, color: '#e2e8f0', whiteSpace: 'pre', background: 'transparent' }}>
                        {change.new_content}
                    </pre>
                </div>
            ) : null}
        </div>
    );
}

function DeployDiagnosisPanel({
    diagnosis, fixBusy, onApply, onDismiss,
}: {
    diagnosis: DeployDiagnosis;
    fixBusy: boolean;
    onApply: (strategy: string, fileChanges?: import('../../api/pipelinesApi').DeployFileChange[]) => void;
    onDismiss: () => void;
}) {
    const icon = ERROR_TYPE_ICON[diagnosis.error_type] ?? '⚠️';
    const hasFileChanges = diagnosis.file_changes && diagnosis.file_changes.length > 0;

    return (
        <div className="pl-fade-in" style={{
            marginTop: 10,
            border: '1.5px solid #c4b5fd',
            borderRadius: tokens.radius.lg,
            overflow: 'hidden',
            background: 'white',
            boxShadow: '0 4px 20px #7c3aed18',
        }}>
            {/* Header */}
            <div style={{
                padding: '12px 16px',
                background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
                borderBottom: '1px solid #c4b5fd',
                display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7c3aed', marginBottom: 2 }}>
                        AI Diagnosis
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#3b0764' }}>
                        {diagnosis.summary}
                    </div>
                </div>
                <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
            </div>

            {/* Root cause explanation */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #ede9fe', background: '#faf5ff' }}>
                <p style={{ margin: 0, fontSize: 13, color: tokens.color.text, lineHeight: 1.65 }}>
                    {diagnosis.detail}
                </p>
            </div>

            <div style={{ padding: '14px 16px' }}>
                {/* Proposed file changes */}
                {hasFileChanges ? (
                    <>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.color.textMuted, marginBottom: 10 }}>
                            Proposed Changes — {diagnosis.file_changes.length} file{diagnosis.file_changes.length === 1 ? '' : 's'}
                        </div>
                        {diagnosis.file_changes.map((change, i) => (
                            <FileChangeDiff key={i} change={change} />
                        ))}
                    </>
                ) : (
                    <div style={{
                        padding: '10px 14px', marginBottom: 12,
                        background: diagnosis.strategy === 'redeploy' ? '#f0fdf4' : '#fff7ed',
                        border: `1.5px solid ${diagnosis.strategy === 'redeploy' ? '#86efac' : '#fdba74'}`,
                        borderRadius: tokens.radius.md,
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: diagnosis.strategy === 'redeploy' ? '#166534' : '#9a3412', marginBottom: 3 }}>
                            {diagnosis.strategy_label}
                        </div>
                        <div style={{ fontSize: 12, color: tokens.color.text, lineHeight: 1.5 }}>
                            {diagnosis.strategy_description}
                        </div>
                    </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button
                        onClick={() => onApply(
                            hasFileChanges ? 'patch_files' : diagnosis.strategy,
                            hasFileChanges ? diagnosis.file_changes : undefined
                        )}
                        disabled={fixBusy}
                        style={{
                            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                            color: 'white', border: 'none',
                            padding: '8px 18px', borderRadius: tokens.radius.sm,
                            fontWeight: 700, fontSize: 12,
                            cursor: fixBusy ? 'wait' : 'pointer',
                            opacity: fixBusy ? 0.6 : 1,
                            boxShadow: '0 2px 8px #7c3aed33',
                        }}
                    >
                        {fixBusy ? '…' : hasFileChanges ? `✓ Apply ${diagnosis.file_changes.length} change${diagnosis.file_changes.length === 1 ? '' : 's'} & Redeploy` : `✓ ${diagnosis.strategy_label}`}
                    </button>
                    {diagnosis.strategy !== 'full_reimplementation' ? (
                        <button
                            onClick={() => onApply('full_reimplementation')}
                            disabled={fixBusy}
                            title="Re-run ALL sprint tickets with the crash log fed to Dify — use only when the targeted fix isn't enough"
                            style={{
                                background: 'transparent', color: tokens.color.textMuted,
                                border: `1px solid ${tokens.color.border}`,
                                padding: '8px 14px', borderRadius: tokens.radius.sm,
                                fontSize: 12, cursor: fixBusy ? 'wait' : 'pointer',
                            }}
                        >
                            Rerun all sprint tickets
                        </button>
                    ) : null}
                    <button
                        onClick={onDismiss}
                        style={{
                            background: 'transparent', color: tokens.color.textMuted,
                            border: `1px solid ${tokens.color.border}`,
                            padding: '8px 12px', borderRadius: tokens.radius.sm,
                            fontSize: 12, cursor: 'pointer',
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

interface Props {
    runId: string;
    onBack: () => void;
    onNavigate?: (runId: string) => void;
    onOpenPlanner?: () => void;
    onOpenDesigner?: () => void;
}

type SidePanel =
    | { kind: 'none' }
    | { kind: 'n8n'; stage: Stage }
    | { kind: 'dify'; stage: Stage; appId: string };
type ActiveSidePanel = Exclude<SidePanel, { kind: 'none' }>;

export function PipelineDetail({ runId, onBack, onNavigate, onOpenPlanner, onOpenDesigner }: Props) {
    const { run, connected, error, decide } = usePipelineRun(runId);
    const { repos } = useRepos();
    const { rerun: rerunPipeline, loading: rerunning } = useRerunPipeline();
    const { rerunStage } = useRerunStage();
    const { deploy: startDeploy, stop: stopDeploy, loading: deployBusy } = useDeployControls();
    const { createPRs, loading: createPRsBusy } = useCreatePRs();
    const { fix: fixWithDeployError, loading: fixBusy } = useFixWithDeployError();
    const { diagnose: diagnoseDeployError, loading: diagnoseBusy } = useDiagnoseDeployError();
    const { changeRequests, refetch: refetchCRs } = useChangeRequests(runId);
    const [diagnosis, setDiagnosis] = useState<DeployDiagnosis | null>(null);
    const [diagnosisError, setDiagnosisError] = useState<string | null>(null);

    async function handleFixWithDeployError() {
        if (diagnoseBusy || fixBusy) return;
        setDiagnosis(null);
        setDiagnosisError(null);
        try {
            const d = await diagnoseDeployError(runId);
            setDiagnosis(d);
        } catch (e) {
            setDiagnosisError(e instanceof Error ? e.message : 'diagnosis failed');
        }
    }

    async function applyDiagnosisFix(strategy: string, fileChanges?: import('../../api/pipelinesApi').DeployFileChange[]) {
        setDiagnosis(null);
        try {
            await fixWithDeployError(runId, strategy, fileChanges);
        } catch (e) {
            alert(`Fix failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }

    async function handleCreatePRs() {
        if (createPRsBusy) return;
        const impl = run?.stages.find(s => s.stage === 'implementation');
        const outcomes: any[] = (impl?.artifact_json as any)?.sprint?.outcomes ?? [];
        const toCreate = outcomes.filter(o => !o.skipped && o.implementation_json && (!o.final_errors || o.final_errors.length === 0) && !o.pr_url);
        if (toCreate.length === 0) {
            alert('No tickets ready to push (all are either already on GitHub, blocked, or failed).');
            return;
        }
        if (!window.confirm(`Push ${toCreate.length} ticket${toCreate.length === 1 ? '' : 's'} as draft PR${toCreate.length === 1 ? '' : 's'} to GitHub?`)) return;
        try {
            const result = await createPRs(runId);
            const msg = [
                `${result.created.length} PR${result.created.length === 1 ? '' : 's'} created`,
                result.skipped.length > 0 ? `${result.skipped.length} skipped` : '',
                result.failed.length > 0 ? `${result.failed.length} failed` : '',
            ].filter(Boolean).join(' · ');
            alert(msg);
        } catch (e) {
            alert(`Create PRs failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }
    const { submit: submitClarification } = useRequirementsClarify();
    const { sync: syncFromSharePoint } = useSyncRequirementsFromSharePoint();
    const [side, setSide] = useState<SidePanel>({ kind: 'none' });
    const [viewMode, setViewMode] = useState<'stepper' | 'graph'>('stepper');
    const [showLogs, setShowLogs] = useState(false);

    function scrollToStage(stage: Stage) {
        const el = document.getElementById(`stage-card-${stage}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function handleDeploy(version?: number) {
        if (deployBusy) return;
        try {
            await startDeploy(runId, version);
        } catch (e) {
            alert(`Deploy failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }
    async function handleStopDeploy() {
        if (deployBusy) return;
        if (!window.confirm('Stop the running deployment? The URL will go offline.')) return;
        try {
            await stopDeploy(runId);
        } catch (e) {
            alert(`Stop failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }

    async function handleRerunPipeline() {
        if (rerunning) return;
        if (!window.confirm('Start a fresh run with the same input? The current run will not be affected.')) return;
        try {
            const r = await rerunPipeline(runId);
            if (onNavigate) onNavigate(r.run_id);
        } catch (e) {
            alert(`Rerun failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }

    async function handleRerunStage(stage: Stage) {
        if (stage !== 'implementation') {
            alert(`Stage-level rerun is currently only supported for the implementation stage. Use "Rerun pipeline" or update the n8n workflow to support start_stage.`);
            return;
        }
        if (!window.confirm(`Re-run the ${stage} stage in place? Existing artifacts for this stage will be cleared.`)) return;
        try {
            await rerunStage(runId, stage);
        } catch (e) {
            alert(`Rerun stage failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }

    // App-ID lookup for the current repo's Dify mapping (so we can deep-link
    // into the correct Dify app's logs).
    const repoMeta = run ? repos.find(r => r.repo_full_name === run.repo_full_name) : undefined;

    // Close side panel if the active stage isn't in the latest run anymore.
    useEffect(() => {
        if (side.kind === 'none') return;
        if (!run) { setSide({ kind: 'none' }); return; }
    }, [run, side]);

    if (!run) {
        return (
            <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
                <BackBtn onBack={onBack} />
                <p style={{ color: tokens.color.textMuted }}>Loading run {runId}…</p>
                {error && <p style={{ color: tokens.color.danger }}>{error}</p>}
            </div>
        );
    }

    const stagesByName = new Map(run.stages.map(s => [s.stage, s]));
    const runSty = RUN_STATUS_STYLES[run.status] || { bg: tokens.color.slateSoft, fg: tokens.color.slate };

    // Progress numerator: count any stage past 'pending'
    const stageOrder = STAGES;
    const reached = stageOrder.filter(s => {
        const st = stagesByName.get(s);
        return st && st.status !== 'pending';
    }).length;
    const completed = stageOrder.filter(s => {
        const st = stagesByName.get(s);
        return st && (st.status === 'approved' || st.status === 'skipped');
    }).length;
    const progressPct = Math.round((completed / stageOrder.length) * 100);

    // Stage that's actively doing something — for the sticky top strip.
    // Priority: running > awaiting_clarification > awaiting_approval > first pending.
    const activeStage = (() => {
        const byPriority: Array<typeof run.stages[0]['status']> = ['running', 'awaiting_clarification', 'awaiting_approval'];
        for (const wanted of byPriority) {
            for (const s of stageOrder) {
                const st = stagesByName.get(s);
                if (st?.status === wanted) return { stage: s, st };
            }
        }
        return null;
    })();

    function openN8nForStage(stage: Stage) {
        setSide({ kind: 'n8n', stage });
    }
    function openDifyForStage(stage: Stage) {
        const appId = repoMeta?.dify_workflow_app_ids?.[stage];
        if (!appId) return;
        setSide({ kind: 'dify', stage, appId });
    }

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: side.kind === 'none' ? '1fr' : '1fr 520px',
            gap: 16,
            padding: '16px 24px',
            maxWidth: 1600, margin: '0 auto',
        }}>
            {/* MAIN COLUMN */}
            <div>
                {/* Sticky "what's happening now" strip — pins on scroll so the
                    user can always see which stage is active and what it's doing. */}
                {activeStage ? (
                    <StickyActivityStrip
                        run={run}
                        activeStage={activeStage}
                        reached={reached}
                        totalStages={stageOrder.length}
                        progressPct={progressPct}
                        stagesByName={stagesByName}
                    />
                ) : null}

                <BackBtn onBack={onBack} />

                {/* Header card */}
                <div style={{
                    background: tokens.color.card, borderRadius: tokens.radius.lg,
                    border: `1px solid ${tokens.color.border}`, padding: 20,
                    boxShadow: tokens.shadow.sm, marginBottom: 20,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 11, color: tokens.color.textSubtle, fontFamily: tokens.font.mono }}>
                                {run.run_id}
                            </div>
                            <h2 style={{ margin: '6px 0 6px 0', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: tokens.color.text }}>
                                {run.repo_full_name}
                            </h2>
                            <div style={{ display: 'flex', gap: 14, fontSize: 13, color: tokens.color.textMuted, flexWrap: 'wrap' }}>
                                <span>👤 {run.requester_id || '—'}</span>
                                <span>📅 {new Date(run.created_at).toLocaleString()}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{
                                        width: 8, height: 8, borderRadius: '50%',
                                        background: connected ? tokens.color.success : tokens.color.textSubtle,
                                    }} className={connected ? 'pl-pulse' : ''} />
                                    {connected ? 'live' : 'reconnecting'}
                                </span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                onClick={handleRerunPipeline}
                                disabled={rerunning}
                                title="Clone this run with the same input and start fresh"
                                style={{
                                    background: 'white', color: tokens.color.text,
                                    border: `1px solid ${tokens.color.border}`,
                                    padding: '6px 12px', borderRadius: tokens.radius.sm,
                                    fontWeight: 500, fontSize: 12, cursor: rerunning ? 'wait' : 'pointer',
                                    opacity: rerunning ? 0.6 : 1,
                                }}
                            >
                                {rerunning ? '…' : '↻ Rerun pipeline'}
                            </button>
                            <span style={{
                                background: runSty.bg, color: runSty.fg,
                                padding: '6px 14px', borderRadius: tokens.radius.pill,
                                fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                {run.status.replace('_', ' ')}
                            </span>
                        </div>
                    </div>

                    <DeploymentStrip
                        deployment={run.deployment}
                        busy={deployBusy}
                        onDeploy={handleDeploy}
                        onStop={handleStopDeploy}
                        onToggleLogs={() => setShowLogs(v => !v)}
                        logsShown={showLogs}
                        onFixDeployError={handleFixWithDeployError}
                        fixBusy={fixBusy}
                    />
                    {(() => {
                        const ds = run.deployment?.status;
                        const live = ds === 'installing' || ds === 'starting' || ds === 'running';
                        // Auto-open during installing/failed so the user immediately
                        // sees what's happening; respect manual toggle otherwise.
                        const autoOpen = ds === 'installing' || ds === 'failed';
                        const open = showLogs || autoOpen;
                        if (!open || !run.deployment) return null;
                        return (
                            <DeploymentLogs
                                runId={run.run_id}
                                enabled={live}
                                onClose={() => setShowLogs(false)}
                            />
                        );
                    })()}

                    {/* Diagnosis panel — shown after "Fix with deploy error" is clicked */}
                    {diagnosisError ? (
                        <div style={{
                            marginTop: 10, padding: '10px 14px',
                            background: tokens.color.dangerSoft,
                            border: `1px solid #fca5a5`,
                            borderRadius: tokens.radius.md,
                            fontSize: 12, color: '#991b1b',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                            <span>Diagnosis failed: {diagnosisError}</span>
                            <button onClick={() => setDiagnosisError(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: 14 }}>✕</button>
                        </div>
                    ) : null}
                    {diagnoseBusy ? (
                        <div style={{
                            marginTop: 10, padding: '10px 14px',
                            background: tokens.color.primarySoft,
                            border: `1px solid ${tokens.color.primary}33`,
                            borderRadius: tokens.radius.md,
                            fontSize: 12, color: tokens.color.primary,
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <span className="pl-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: tokens.color.primary, display: 'inline-block' }} />
                            Analysing deployment error…
                        </div>
                    ) : null}
                    {diagnosis ? (
                        <DeployDiagnosisPanel
                            diagnosis={diagnosis}
                            fixBusy={fixBusy}
                            onApply={applyDiagnosisFix}
                            onDismiss={() => setDiagnosis(null)}
                        />
                    ) : null}

                    {/* Progress bar */}
                    <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: tokens.color.textMuted, marginBottom: 4 }}>
                            <span>Progress</span>
                            <span>{completed}/{stageOrder.length} stages approved</span>
                        </div>
                        <div style={{
                            height: 6, background: tokens.color.slateSoft, borderRadius: tokens.radius.pill, overflow: 'hidden',
                        }}>
                            <div style={{
                                width: `${progressPct}%`, height: '100%',
                                background: `linear-gradient(90deg, ${tokens.color.primary}, ${tokens.color.success})`,
                                transition: 'width .3s',
                            }} />
                        </div>
                    </div>

                    {/* View toggle: linear stepper vs. interactive graph */}
                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                        <button
                            onClick={() => setViewMode('stepper')}
                            style={{
                                background: viewMode === 'stepper' ? tokens.color.primary : 'transparent',
                                color: viewMode === 'stepper' ? 'white' : tokens.color.textMuted,
                                border: `1px solid ${viewMode === 'stepper' ? tokens.color.primary : tokens.color.border}`,
                                padding: '4px 10px', borderRadius: tokens.radius.sm,
                                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            }}
                        >Stepper</button>
                        <button
                            onClick={() => setViewMode('graph')}
                            style={{
                                background: viewMode === 'graph' ? tokens.color.primary : 'transparent',
                                color: viewMode === 'graph' ? 'white' : tokens.color.textMuted,
                                border: `1px solid ${viewMode === 'graph' ? tokens.color.primary : tokens.color.border}`,
                                padding: '4px 10px', borderRadius: tokens.radius.sm,
                                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            }}
                        >Graph</button>
                    </div>

                    {viewMode === 'stepper' ? (
                        <Stepper run={run} stagesByName={stagesByName} reached={reached} />
                    ) : (
                        <div style={{ marginTop: 12 }}>
                            <PipelineGraph run={run} onSelectStage={() => scrollToStage('implementation')} />
                        </div>
                    )}

                    {/* Original request */}
                    <details style={{ marginTop: 16, fontSize: 13 }}>
                        <summary style={{ cursor: 'pointer', color: tokens.color.textMuted, userSelect: 'none' }}>
                            View original request
                        </summary>
                        <pre style={{
                            marginTop: 8, padding: 12,
                            background: tokens.color.slateSoft, borderRadius: tokens.radius.sm,
                            fontSize: 12, color: tokens.color.text,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            fontFamily: tokens.font.body,
                        }}>{run.raw_request}</pre>
                    </details>

                    {/* Design preferences (only shown if the launcher captured any) */}
                    {run.design_preferences && (
                        run.design_preferences.preset ||
                        run.design_preferences.ideas ||
                        (run.design_preferences.references && run.design_preferences.references.length > 0)
                    ) ? (
                        <DesignPreferencesCard prefs={run.design_preferences} />
                    ) : null}
                </div>

                {/* Stage cards */}
                {STAGES.map((stage, i) => {
                    let prsToCreate: number | undefined;
                    let prsAlreadyCreated: number | undefined;
                    if (stage === 'implementation') {
                        const implStage = stagesByName.get('implementation');
                        const outcomes: any[] = (implStage?.artifact_json as any)?.sprint?.outcomes ?? [];
                        prsToCreate = outcomes.filter(o => !o.skipped && o.implementation_json && (!o.final_errors || o.final_errors.length === 0) && !o.pr_url).length;
                        prsAlreadyCreated = outcomes.filter(o => !!o.pr_url).length;
                    }
                    return (
                        <StageCard
                            key={stage}
                            index={i + 1}
                            stage={stage}
                            runId={runId}
                            status={stagesByName.get(stage)}
                            onApprove={async () => decide(stage, 'approved')}
                            onReject={async (reason) => decide(stage, 'rejected', reason)}
                            onOpenN8n={() => openN8nForStage(stage)}
                            onOpenDify={() => openDifyForStage(stage)}
                            onRerun={() => handleRerunStage(stage)}
                            deployment={stage === 'implementation' ? run.deployment ?? null : null}
                            onDeploy={stage === 'implementation' ? handleDeploy : undefined}
                            onStopDeploy={stage === 'implementation' ? handleStopDeploy : undefined}
                            onFixDeployError={stage === 'implementation' ? handleFixWithDeployError : undefined}
                            deployBusy={stage === 'implementation' ? deployBusy : undefined}
                            onCreatePRs={stage === 'implementation' ? handleCreatePRs : undefined}
                            prsToCreate={prsToCreate}
                            prsAlreadyCreated={prsAlreadyCreated}
                            createPRsBusy={stage === 'implementation' ? createPRsBusy : undefined}
                            onSubmitClarification={stage === 'requirements'
                                ? async (answers, opts) => { await submitClarification(runId, answers, opts); }
                                : undefined}
                            onSyncFromSharePoint={stage === 'requirements'
                                ? async () => { await syncFromSharePoint(runId); }
                                : undefined}
                            onViewPlanner={stage === 'plan' ? onOpenPlanner : undefined}
                            onViewDesigner={stage === 'design' ? onOpenDesigner : undefined}
                            onCreateChangeRequest={
                                (['requirements', 'plan', 'design'] as const).includes(stage as any)
                                    ? (stage === 'requirements' ? undefined : stage === 'plan' ? onOpenPlanner : onOpenDesigner)
                                    : undefined
                            }
                        />
                    );
                })}

                {/* Change Requests section */}
                {run.source_change_request_id ? (
                    <div style={{
                        margin: '12px 0', padding: '10px 14px',
                        background: tokens.color.primarySoft, border: `1px solid ${tokens.color.primary}33`,
                        borderRadius: tokens.radius.md, fontSize: 13, color: tokens.color.primary,
                    }}>
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

            {/* SIDE PANEL: iframe to n8n or Dify */}
            {side.kind !== 'none' ? (
                <aside className="pl-fade-in" style={{
                    background: tokens.color.card, borderRadius: tokens.radius.lg,
                    border: `1px solid ${tokens.color.border}`, boxShadow: tokens.shadow.md,
                    height: 'calc(100vh - 120px)', position: 'sticky', top: 16,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}>
                    <SidePanelHeader
                        side={side}
                        onClose={() => setSide({ kind: 'none' })}
                    />
                    <SidePanelBody side={side} />
                </aside>
            ) : null}
        </div>
    );
}

const PRESET_LABEL: Record<string, { label: string; accent: string; bg: string }> = {
    'material-ui':     { label: 'Material UI 3',       accent: '#1976d2', bg: 'linear-gradient(135deg, #e3f2fd 0%, #fce4ec 100%)' },
    'tailwind-shadcn': { label: 'Tailwind + shadcn',   accent: '#0f172a', bg: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' },
    'custom':          { label: 'Custom / no preset',  accent: '#7c3aed', bg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' },
};

function DesignPreferencesCard({ prefs }: { prefs: any }) {
    const preset = prefs.preset ? PRESET_LABEL[prefs.preset] : null;
    const refs = (prefs.references || []) as Array<{ kind: 'website' | 'github'; url: string; note?: string }>;
    return (
        <div className="pl-fade-in" style={{
            marginTop: 16,
            padding: 16,
            background: preset?.bg || 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
            borderRadius: tokens.radius.lg,
            border: `1px solid ${preset?.accent || '#7c3aed'}33`,
            boxShadow: `0 4px 12px ${preset?.accent || '#7c3aed'}11`,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>🎨</span>
                <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: tokens.color.textMuted,
                }}>
                    Design preferences
                </span>
                {preset ? (
                    <span style={{
                        background: preset.accent, color: 'white',
                        padding: '3px 10px', borderRadius: tokens.radius.pill,
                        fontSize: 11, fontWeight: 700,
                    }}>{preset.label}</span>
                ) : null}
            </div>
            {prefs.ideas ? (
                <div style={{
                    marginBottom: refs.length > 0 ? 10 : 0,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.6)',
                    borderRadius: tokens.radius.sm,
                    fontSize: 13, color: tokens.color.text, whiteSpace: 'pre-wrap', lineHeight: 1.4,
                }}>
                    {prefs.ideas}
                </div>
            ) : null}
            {refs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {refs.map((r, i) => (
                        <a
                            key={i}
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 10px',
                                background: 'rgba(255,255,255,0.6)',
                                borderRadius: tokens.radius.sm,
                                textDecoration: 'none', color: tokens.color.text,
                                fontSize: 12,
                            }}
                        >
                            <span>{r.kind === 'github' ? '🐙' : '🌐'}</span>
                            <span style={{ fontFamily: tokens.font.mono, fontWeight: 500 }}>{r.url}</span>
                            {r.note ? (
                                <span style={{ color: tokens.color.textMuted, fontStyle: 'italic' }}>— {r.note}</span>
                            ) : null}
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

const STAGE_LABEL: Record<Stage, string> = {
    requirements: 'Requirements',
    optimize: 'Optimize',
    plan: 'Plan',
    design: 'Design',
    sprint: 'Sprint',
    implementation: 'Implementation',
    test: 'Test',
};

const STAGE_DEFAULT_HINT: Record<string, string> = {
    awaiting_clarification: 'Awaiting your answers',
    awaiting_approval: 'Awaiting your approval',
    running: 'Working…',
};

/**
 * Compact pinned strip at the top of the run page. Shows which stage is
 * currently active and what it's doing (current_activity from the DB), plus
 * an overall progress bar. Pins on scroll so the user never loses context.
 */
function StickyActivityStrip({ run, activeStage, reached, totalStages, progressPct, stagesByName }: {
    run: any;
    activeStage: { stage: Stage; st: any };
    reached: number;
    totalStages: number;
    progressPct: number;
    stagesByName: Map<Stage, any>;
}) {
    const { stage, st } = activeStage;
    const sty = statusStyle[st.status as keyof typeof statusStyle] || statusStyle.pending;
    const hint = st.current_activity || STAGE_DEFAULT_HINT[st.status] || '';
    const isRunning = st.status === 'running';
    const stageIdx = STAGES.indexOf(stage) + 1;

    function jump(s: Stage) {
        const el = document.getElementById(`stage-card-${s}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    return (
        <div
            style={{
                position: 'sticky', top: 0, zIndex: 30,
                margin: '0 -24px 16px -24px',
                background: `linear-gradient(135deg, ${sty.ring}18 0%, rgba(255,255,255,0.95) 60%)`,
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderBottom: `2px solid ${sty.ring}`,
                boxShadow: `0 4px 24px ${sty.ring}22`,
                transition: 'all .3s ease',
            }}
        >
            {/* Top row — big status of the active stage */}
            <div
                onClick={() => jump(stage)}
                style={{
                    padding: '14px 24px 10px 24px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                }}
            >
                <span className={isRunning ? 'pl-pulse' : ''} style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 42, height: 42, borderRadius: '50%',
                    background: sty.iconBg, color: sty.iconFg,
                    fontWeight: 800, fontSize: 18, flexShrink: 0,
                    boxShadow: isRunning ? `0 0 0 6px ${sty.ring}33` : `0 2px 8px ${sty.ring}55`,
                }}>{stageIdx}</span>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{
                            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: tokens.color.textMuted,
                        }}>
                            Stage {stageIdx}/{totalStages}
                        </span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: tokens.color.text, letterSpacing: '-0.01em' }}>
                            {STAGE_LABEL[stage]}
                        </span>
                        <span style={{
                            background: sty.bg, color: sty.fg,
                            padding: '3px 12px', borderRadius: tokens.radius.pill,
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>{sty.label}</span>
                    </div>
                    {hint ? (
                        <span style={{
                            fontFamily: tokens.font.mono, fontSize: 13, color: tokens.color.text,
                            fontWeight: 500, lineHeight: 1.3,
                        }}>
                            {isRunning ? '› ' : '⏸ '}{hint}
                            {isRunning ? <span className="pl-blink" aria-hidden style={{ marginLeft: 2 }}>▍</span> : null}
                        </span>
                    ) : null}
                </div>

                <div style={{
                    flexShrink: 0, marginLeft: 'auto',
                    display: 'flex', alignItems: 'center', gap: 12,
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: tokens.color.text, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                            {progressPct}<span style={{ fontSize: 13, color: tokens.color.textMuted, fontWeight: 600 }}>%</span>
                        </span>
                        <span style={{ fontSize: 10, color: tokens.color.textMuted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            {reached}/{totalStages} reached
                        </span>
                    </div>
                </div>
            </div>

            {/* Mini stepper — every stage as a clickable dot, full pipeline visible at a glance */}
            <div style={{
                padding: '0 24px 12px 24px',
                display: 'flex', alignItems: 'center', gap: 0,
            }}>
                {STAGES.map((s, i) => {
                    const stRow = stagesByName.get(s);
                    const statusName = (stRow?.status || 'pending') as keyof typeof statusStyle;
                    const dotSty = statusStyle[statusName];
                    const isActive = s === stage;
                    const isDoing = statusName === 'running' || statusName === 'awaiting_clarification' || statusName === 'awaiting_approval';
                    return (
                        <React.Fragment key={s}>
                            <div
                                onClick={() => jump(s)}
                                title={`${STAGE_LABEL[s]} — ${dotSty.label}`}
                                style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                    cursor: 'pointer',
                                    transform: isActive ? 'scale(1.0)' : 'scale(0.92)',
                                    transition: 'transform .2s',
                                    minWidth: 0,
                                }}
                            >
                                <div
                                    className={isDoing && isActive ? 'pl-pulse' : ''}
                                    style={{
                                        width: isActive ? 28 : 22, height: isActive ? 28 : 22,
                                        borderRadius: '50%',
                                        background: dotSty.iconBg, color: dotSty.iconFg,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: isActive ? 12 : 10, fontWeight: 700,
                                        boxShadow: isActive ? `0 0 0 4px ${dotSty.ring}33` : 'none',
                                        transition: 'all .2s',
                                        border: statusName === 'pending' ? `2px dashed ${tokens.color.borderStrong}` : 'none',
                                    }}
                                >
                                    {statusName === 'approved' ? '✓' : statusName === 'rejected' || statusName === 'failed' ? '×' : (i + 1)}
                                </div>
                                <span style={{
                                    fontSize: 10, fontWeight: isActive ? 700 : 500,
                                    color: isActive ? tokens.color.text : tokens.color.textMuted,
                                    letterSpacing: '0.02em', whiteSpace: 'nowrap',
                                }}>
                                    {STAGE_LABEL[s]}
                                </span>
                            </div>
                            {i < STAGES.length - 1 ? (
                                <div style={{
                                    flex: 1, height: 2, margin: '0 4px',
                                    background: stagesByName.get(s)?.status === 'approved'
                                        ? tokens.color.success
                                        : tokens.color.borderStrong,
                                    transition: 'background .3s',
                                    transform: 'translateY(-8px)',
                                }} />
                            ) : null}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Bottom edge — chunky progress bar */}
            <div style={{
                height: 4, background: tokens.color.slateSoft, position: 'relative',
            }}>
                <div className={isRunning ? 'pl-shimmer' : ''} style={{
                    width: `${progressPct}%`, height: '100%',
                    background: progressPct === 100
                        ? `linear-gradient(90deg, ${tokens.color.success}, #22c55e)`
                        : `linear-gradient(90deg, ${tokens.color.primary}, ${sty.ring})`,
                    transition: 'width .4s ease-out',
                    boxShadow: isRunning ? `0 0 8px ${tokens.color.primary}88` : 'none',
                }} />
            </div>
        </div>
    );
}

function Stepper({ run, stagesByName, reached: _reached }: { run: any; stagesByName: Map<Stage, any>; reached: number }) {
    return (
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {STAGES.map((stage, i) => {
                const st = stagesByName.get(stage);
                const sName = st?.status || 'pending';
                const sty = statusStyle[sName as keyof typeof statusStyle];
                const isCurrent = run.current_stage === stage;
                return (
                    <React.Fragment key={stage}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 10px',
                            borderRadius: tokens.radius.pill,
                            background: sty.bg,
                            border: isCurrent ? `1.5px solid ${sty.ring}` : '1px solid transparent',
                        }}>
                            <span
                                className={sty.animate === 'pulse' ? 'pl-pulse' : ''}
                                style={{
                                    width: 16, height: 16, borderRadius: '50%',
                                    background: sty.iconBg, color: sty.iconFg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 10, fontWeight: 700,
                                }}
                            >
                                {sName === 'approved' ? '✓' : sName === 'rejected' || sName === 'failed' ? '×' : i + 1}
                            </span>
                            <span style={{ fontSize: 12, color: sty.fg, fontWeight: isCurrent ? 600 : 500, textTransform: 'capitalize' }}>
                                {stage}
                            </span>
                        </div>
                        {i < STAGES.length - 1 ? (
                            <span style={{ color: tokens.color.borderStrong, fontSize: 12 }}>›</span>
                        ) : null}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function SidePanelHeader({ side, onClose }: { side: ActiveSidePanel; onClose: () => void }) {
    const isN8n = side.kind === 'n8n';
    const tool = isN8n ? 'n8n' : 'Dify';
    const stage = side.stage;
    const externalUrl = isN8n
        ? `${N8N_PUBLIC_BASE}/workflow/UGzLMeO04q4sbYRP/executions`
        : `${DIFY_PUBLIC_BASE}/app/${(side as any).appId}/logs`;
    return (
        <div style={{
            padding: '12px 16px', borderBottom: `1px solid ${tokens.color.border}`,
            display: 'flex', alignItems: 'center', gap: 10, background: tokens.color.bg,
        }}>
            <div style={{
                width: 28, height: 28, borderRadius: tokens.radius.sm,
                background: isN8n ? '#EA4B71' : '#0066FF',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 12,
            }}>{isN8n ? 'n8' : 'D'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: tokens.color.text }}>
                    {tool} · <span style={{ textTransform: 'capitalize' }}>{stage}</span>
                </div>
                <div style={{ fontSize: 11, color: tokens.color.textMuted }}>
                    Live console (may require login in the same browser)
                </div>
            </div>
            <a
                href={externalUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                    padding: '6px 10px', borderRadius: tokens.radius.sm,
                    border: `1px solid ${tokens.color.border}`, color: tokens.color.text,
                    fontSize: 12, textDecoration: 'none', background: 'white',
                }}
            >
                Open ↗
            </a>
            <button
                onClick={onClose}
                style={{
                    padding: '6px 10px', borderRadius: tokens.radius.sm,
                    border: `1px solid ${tokens.color.border}`, color: tokens.color.text,
                    fontSize: 12, background: 'white', cursor: 'pointer',
                }}
            >✕</button>
        </div>
    );
}

function SidePanelBody({ side }: { side: Exclude<SidePanel, { kind: 'none' }> }) {
    // Use the iframe-proxy ports (5679 / 8081) which strip X-Frame-Options.
    const url = side.kind === 'n8n'
        ? `${N8N_IFRAME_BASE}/workflow/UGzLMeO04q4sbYRP/executions`
        : `${DIFY_IFRAME_BASE}/app/${(side as any).appId}/logs`;
    return (
        <div style={{ flex: 1, position: 'relative', background: '#fff' }}>
            <iframe
                title={side.kind === 'n8n' ? 'n8n console' : 'Dify console'}
                src={url}
                style={{ width: '100%', height: '100%', border: 'none' }}
                referrerPolicy="origin"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
            <div style={{
                position: 'absolute', bottom: 10, left: 10, right: 10,
                background: '#0f172aE6', color: '#e2e8f0',
                padding: '8px 12px', borderRadius: tokens.radius.sm,
                fontSize: 11, pointerEvents: 'none',
                backdropFilter: 'blur(4px)',
            }}>
                If the panel is blank, the service refused embedding. Click <strong>Open ↗</strong> above to open in a new tab.
            </div>
        </div>
    );
}

function DeploymentStrip({
    deployment,
    busy,
    onDeploy,
    onStop,
    onToggleLogs,
    logsShown,
    onFixDeployError,
    fixBusy,
}: {
    deployment: any;
    busy: boolean;
    onDeploy: (version?: number) => void;
    onStop: () => void;
    onToggleLogs?: () => void;
    logsShown?: boolean;
    onFixDeployError?: () => void;
    fixBusy?: boolean;
}) {
    const status: string | undefined = deployment?.status;
    const live = status === 'starting' || status === 'installing' || status === 'running';
    const dotColor =
        status === 'running' ? tokens.color.success :
        status === 'installing' || status === 'starting' ? tokens.color.warning :
        status === 'failed' ? tokens.color.danger :
        tokens.color.textSubtle;
    const label = status ? status.replace('_', ' ') : 'not deployed';

    return (
        <div style={{
            marginTop: 14, padding: '10px 12px',
            background: tokens.color.bg, border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
            <span style={{
                width: 9, height: 9, borderRadius: '50%', background: dotColor,
            }} className={status === 'installing' || status === 'starting' ? 'pl-pulse' : ''} />
            <span style={{ fontSize: 12, fontWeight: 600, color: tokens.color.text, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                Local deploy
            </span>
            <span style={{ fontSize: 12, color: tokens.color.textMuted, textTransform: 'capitalize' }}>
                {label}
            </span>
            {deployment?.url && status === 'running' ? (
                <a
                    href={deployment.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                        color: tokens.color.primary, fontSize: 12, fontWeight: 600,
                        textDecoration: 'none', padding: '4px 10px',
                        background: tokens.color.primarySoft,
                        border: `1px solid ${tokens.color.primary}33`,
                        borderRadius: tokens.radius.sm,
                    }}
                >
                    🌐 {deployment.url} ↗
                </a>
            ) : null}
            {deployment?.error ? (
                <span style={{ fontSize: 11, color: tokens.color.danger, fontFamily: tokens.font.mono, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={deployment.error}>
                    {deployment.error}
                </span>
            ) : null}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {status === 'failed' && onFixDeployError ? (
                    <button
                        onClick={onFixDeployError}
                        disabled={!!fixBusy}
                        title="Re-run the implementation stage with the crash log fed back to Dify as context"
                        style={{
                            background: '#7c3aed', color: 'white', border: 'none',
                            padding: '5px 12px', borderRadius: tokens.radius.sm,
                            fontWeight: 600, fontSize: 12,
                            cursor: fixBusy ? 'wait' : 'pointer',
                            opacity: fixBusy ? 0.6 : 1,
                        }}
                    >
                        {fixBusy ? '…' : '🔧 Fix with deploy error'}
                    </button>
                ) : null}
                {status && onToggleLogs ? (
                    <button
                        onClick={onToggleLogs}
                        style={{
                            background: 'transparent', color: tokens.color.text,
                            border: `1px solid ${tokens.color.border}`,
                            padding: '5px 10px', borderRadius: tokens.radius.sm, fontWeight: 500, fontSize: 12,
                            cursor: 'pointer',
                        }}
                    >
                        {logsShown ? '▾ Hide logs' : '▸ View logs'}
                    </button>
                ) : null}
                {!live ? (
                    <button
                        onClick={() => onDeploy()}
                        disabled={busy}
                        style={{
                            background: tokens.color.primary, color: 'white', border: 'none',
                            padding: '5px 12px', borderRadius: tokens.radius.sm, fontWeight: 600, fontSize: 12,
                            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                        }}
                    >
                        {busy ? '…' : (status ? '↻ Redeploy' : '▶ Deploy locally')}
                    </button>
                ) : (
                    <button
                        onClick={onStop}
                        disabled={busy}
                        style={{
                            background: 'white', color: tokens.color.danger,
                            border: `1px solid ${tokens.color.danger}55`,
                            padding: '5px 12px', borderRadius: tokens.radius.sm, fontWeight: 600, fontSize: 12,
                            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                        }}
                    >
                        ■ Stop
                    </button>
                )}
            </div>
        </div>
    );
}

function BackBtn({ onBack }: { onBack: () => void }) {
    return (
        <button
            className="pl-btn-ghost"
            onClick={onBack}
            style={{
                background: 'transparent', border: 'none',
                color: tokens.color.primary, cursor: 'pointer',
                fontSize: 13, marginBottom: 14, padding: '4px 8px', borderRadius: tokens.radius.sm,
            }}
        >
            ← All runs
        </button>
    );
}
