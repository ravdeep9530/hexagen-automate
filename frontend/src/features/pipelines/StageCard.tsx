import React, { useEffect, useState } from 'react';
import { Stage, StageStatus, VerificationResult, useRunVerification, useImplementationVersions } from '../../api/pipelinesApi';
import { tokens, statusStyle, StageStatusName } from './design';
import { StageVisualization } from './StageVisualizations';
import { DeploymentLogs } from './DeploymentLogs';

/**
 * Ticks every second while `runningSince` is set. Returns a formatted elapsed
 * string ('1.4s', '12s', '2m 14s') so running stage cards animate without
 * needing an SSE event per second.
 */
function useElapsed(runningSince: string | null | undefined): string | null {
    const [, force] = useState(0);
    useEffect(() => {
        if (!runningSince) return;
        const t = setInterval(() => force((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, [runningSince]);
    if (!runningSince) return null;
    const ms = Date.now() - new Date(runningSince).getTime();
    if (ms < 0) return '0s';
    const s = Math.floor(ms / 1000);
    if (s < 60) return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
}

const STAGE_META: Record<Stage, { label: string; sub: string; model: string }> = {
    requirements:   { label: 'Requirements', sub: 'Extract structured requirements',     model: 'gpt-5.5' },
    optimize:       { label: 'Optimize',     sub: 'Deduplicate, prioritize, MoSCoW',     model: 'gpt-5.5' },
    plan:           { label: 'Plan',         sub: 'Cross-repo execution plan',           model: 'gpt-5.5' },
    design:         { label: 'Design',       sub: 'Architecture, data model, APIs',      model: 'gpt-5.5' },
    sprint:         { label: 'Sprint',       sub: 'Decompose into tickets',              model: 'gpt-5.5' },
    implementation: { label: 'Implementation', sub: 'Code changes per ticket',           model: 'gpt-5.5' },
    test:           { label: 'Test',         sub: 'Verify acceptance coverage',          model: 'gpt-5.5' },
};

// ─── Per-stage artifact summary ───────────────────────────────────────────────

type Metric = { label: string; value: string | number; accent?: boolean };

function buildMetrics(stage: Stage, json: any): Metric[] {
    const m: Metric[] = [];
    if (!json || typeof json !== 'object') return m;
    switch (stage) {
        case 'requirements':
            if (json.title) m.push({ label: 'Feature', value: json.title });
            if (json.user_stories?.length)            m.push({ label: 'User stories',     value: json.user_stories.length });
            if (json.functional_requirements?.length) m.push({ label: 'Requirements',     value: json.functional_requirements.length });
            if (json.acceptance_criteria?.length)     m.push({ label: 'Acceptance criteria', value: json.acceptance_criteria.length });
            break;
        case 'optimize':
            if (json.deduped_requirements?.length) m.push({ label: 'Deduped reqs',  value: json.deduped_requirements.length });
            if (json.moscow?.must?.length)         m.push({ label: 'Must-have',     value: json.moscow.must.length, accent: true });
            if (json.moscow?.should?.length)       m.push({ label: 'Should-have',   value: json.moscow.should.length });
            if (json.risks?.length)                m.push({ label: 'Risks',         value: json.risks.length });
            break;
        case 'plan':
            if (json.affected_repos?.length)  m.push({ label: 'Repos',         value: json.affected_repos.length });
            if (json.phases?.length)           m.push({ label: 'Phases',        value: json.phases.length });
            if (json.milestones?.length)       m.push({ label: 'Milestones',    value: json.milestones.length });
            if (json.estimated_team_size)      m.push({ label: 'Team size',     value: `${json.estimated_team_size} devs` });
            if (json.blockers?.length)         m.push({ label: 'Blockers',      value: json.blockers.length });
            break;
        case 'design':
            if (json.data_model?.length)      m.push({ label: 'Entities',      value: json.data_model.length });
            if (json.api_contracts?.length)   m.push({ label: 'API endpoints', value: json.api_contracts.length });
            if (json.adrs?.length)            m.push({ label: 'ADRs',          value: json.adrs.length });
            break;
        case 'sprint': {
            const tickets = json.tickets ?? [];
            if (tickets.length) {
                const pts = tickets.reduce((s: number, t: any) => s + (t.estimate_points || 0), 0);
                const sprints = new Set(tickets.map((t: any) => t.sprint_assignment)).size;
                m.push({ label: 'Tickets', value: tickets.length, accent: true });
                if (pts)     m.push({ label: 'Story pts',  value: pts });
                if (sprints) m.push({ label: 'Sprints',    value: sprints });
            }
            break;
        }
        case 'implementation':
            if (json.branch_name)            m.push({ label: 'Branch',        value: json.branch_name });
            if (json.files_changed?.length)  m.push({ label: 'Files changed', value: json.files_changed.length, accent: true });
            if (json.pr_title)               m.push({ label: 'PR title',      value: json.pr_title });
            break;
        case 'test': {
            const status = json.ci_status;
            if (status) m.push({ label: 'CI',      value: status, accent: status === 'passed' });
            if (json.tests_added?.length) m.push({ label: 'Tests added', value: json.tests_added.length });
            const cov = json.acceptance_criteria_coverage ?? [];
            if (cov.length) {
                const covered = cov.filter((c: any) => c.status === 'covered').length;
                m.push({ label: 'Coverage', value: `${covered}/${cov.length}`, accent: covered === cov.length });
            }
            break;
        }
    }
    return m;
}

function ArtifactSummary({ stage, json }: { stage: Stage; json: any }) {
    const metrics = buildMetrics(stage, json);
    if (metrics.length === 0) return null;
    return (
        <div style={{
            marginTop: 12,
            padding: '10px 12px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: tokens.radius.md,
            display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start',
        }}>
            {metrics.map(({ label, value }) => (
                <div key={label} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '6px 12px',
                    background: 'white',
                    borderRadius: tokens.radius.sm,
                    border: `1px solid ${tokens.color.border}`,
                    minWidth: 64,
                }}>
                    <span style={{
                        fontSize: typeof value === 'number' ? 20 : 13,
                        fontWeight: 700,
                        color: tokens.color.text,
                        lineHeight: 1.2,
                        wordBreak: 'break-all',
                        textAlign: 'center',
                        maxWidth: 160,
                    }}>
                        {value}
                    </span>
                    <span style={{
                        fontSize: 10, color: tokens.color.textMuted,
                        marginTop: 3, textAlign: 'center', textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                    }}>
                        {label}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────────

interface Props {
    index: number;
    stage: Stage;
    runId?: string;
    status?: StageStatus;
    onApprove: (reason?: string) => Promise<void>;
    onReject: (reason: string) => Promise<void>;
    onOpenN8n?: () => void;
    onOpenDify?: () => void;
    onRerun?: () => Promise<void> | void;
    // Only meaningful on the implementation stage — the deploy hook lives
    // there so users don't have to scroll back to the header to launch it.
    deployment?: {
        status: string;
        url: string | null;
        error?: string | null;
        verification_status?: string | null;
        verification_result?: VerificationResult | null;
    } | null;
    onDeploy?: (version?: number) => void;
    onStopDeploy?: () => void;
    onFixDeployError?: () => void;
    deployBusy?: boolean;
    // "Create PRs" action — pushes the implemented (but-not-yet-pushed)
    // tickets to GitHub. The count tells the user what's about to happen.
    onCreatePRs?: () => void;
    prsToCreate?: number;
    prsAlreadyCreated?: number;
    createPRsBusy?: boolean;
    // Stage 1 only: submit clarification answers or sync from SharePoint.
    onSubmitClarification?: (answers: Record<string, string>, opts?: { force_proceed?: boolean }) => Promise<void>;
    onSyncFromSharePoint?: () => Promise<void>;
    // Plan stage only: open the interactive planner editor.
    onViewPlanner?: () => void;
    // Design stage only: open the Design Studio editor.
    onViewDesigner?: () => void;
    // requirements/plan/design only: create a change request (shown when stage is approved).
    onCreateChangeRequest?: () => void;
}

export function StageCard({ index, stage, runId, status, onApprove, onReject, onOpenN8n, onOpenDify, onRerun, deployment, onDeploy, onStopDeploy, onFixDeployError, deployBusy, onCreatePRs, prsToCreate, prsAlreadyCreated, createPRsBusy, onSubmitClarification, onSyncFromSharePoint, onViewPlanner, onViewDesigner, onCreateChangeRequest }: Props) {
    const [showJson, setShowJson] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});
    const [clarifyBusy, setClarifyBusy] = useState(false);
    const [syncBusy, setSyncBusy] = useState(false);
    const [showScreenshot, setShowScreenshot] = useState(false);
    const [selectedDeployVersion, setSelectedDeployVersion] = useState<number | null>(null);
    const { verify: triggerVerify, loading: verifyBusy } = useRunVerification();
    const { versions: implVersions } = useImplementationVersions(stage === 'implementation' ? (runId ?? null) : null);

    const s: StageStatusName = (status?.status as StageStatusName) || 'pending';
    const sty = statusStyle[s];
    const meta = STAGE_META[stage];

    // Live elapsed counter that ticks every second while the stage is running
    // (started_at set, no finished_at yet). For settled stages we render the
    // static total.
    const stillRunning = !!status?.started_at && !status?.finished_at;
    const liveElapsed = useElapsed(stillRunning ? status?.started_at ?? null : null);
    const elapsed = (() => {
        if (!status?.started_at) return null;
        if (stillRunning) return liveElapsed;
        const start = new Date(status.started_at).getTime();
        const end = new Date(status.finished_at!).getTime();
        return `${((end - start) / 1000).toFixed(1)}s`;
    })();

    async function handle(decision: 'approved' | 'rejected', reason?: string) {
        if (submitting) return;
        setSubmitting(true);
        try {
            if (decision === 'approved') await onApprove(reason);
            else await onReject(reason || '(no reason)');
        } catch (e) {
            alert(`Decision failed: ${e instanceof Error ? e.message : 'unknown'}`);
        } finally {
            setSubmitting(false);
            setShowRejectInput(false);
            setRejectReason('');
        }
    }

    const isActive = s === 'running' || s === 'awaiting_approval' || s === 'awaiting_clarification';

    async function handleClarifySubmit(force: boolean) {
        if (!onSubmitClarification || clarifyBusy) return;
        setClarifyBusy(true);
        try {
            await onSubmitClarification(clarifyAnswers, { force_proceed: force });
            setClarifyAnswers({});
        } catch (e) {
            alert(`Clarification failed: ${e instanceof Error ? e.message : 'unknown'}`);
        } finally {
            setClarifyBusy(false);
        }
    }

    async function handleSyncFromSharePoint() {
        if (!onSyncFromSharePoint || syncBusy) return;
        if (!window.confirm('Pull the latest requirements.json from SharePoint and replace the current draft? Any unapproved in-app edits will be lost.')) return;
        setSyncBusy(true);
        try {
            await onSyncFromSharePoint();
        } catch (e) {
            alert(`Sync failed: ${e instanceof Error ? e.message : 'unknown'}`);
        } finally {
            setSyncBusy(false);
        }
    }

    const requirementsArtifact = stage === 'requirements'
        ? ((status?.artifact_json as any) || null)
        : null;
    const openQuestions: string[] = requirementsArtifact?.parsed?.open_questions || [];
    const clarificationRounds: any[] = requirementsArtifact?.clarification_rounds || [];

    return (
        <div
            id={`stage-card-${stage}`}
            className="pl-card pl-fade-in"
            style={{
                // Active stages get a strong gradient + ring; settled cards
                // stay flat so the eye lands on what's happening now.
                background: isActive
                    ? `linear-gradient(135deg, ${sty.bg} 0%, ${tokens.color.card} 50%)`
                    : tokens.color.card,
                borderRadius: tokens.radius.lg,
                border: `1px solid ${isActive ? sty.ring + '88' : tokens.color.border}`,
                padding: '20px 20px 20px 28px',
                marginBottom: 12,
                boxShadow: isActive
                    ? `0 0 0 3px ${sty.ring}33, 0 8px 24px ${sty.ring}22`
                    : tokens.shadow.sm,
                position: 'relative',
                overflow: 'hidden',
                transition: 'all .25s ease',
            }}
        >
            {/* Left-edge accent stripe — bright status color, animated for running.
                Always visible regardless of status so progression down the page is obvious. */}
            <div
                className={s === 'running' ? 'pl-shimmer' : ''}
                style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: isActive ? 6 : 4,
                    background: s === 'pending'
                        ? `repeating-linear-gradient(180deg, ${tokens.color.borderStrong} 0 6px, transparent 6px 12px)`
                        : sty.iconBg,
                    transition: 'width .2s, background .3s',
                }}
            />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                {/* Stage index circle */}
                <div style={{ flexShrink: 0 }}>
                    <div
                        className={sty.animate === 'pulse' ? 'pl-pulse' : ''}
                        style={{
                            width: 40, height: 40, borderRadius: '50%',
                            background: sty.iconBg, color: sty.iconFg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 16,
                            boxShadow: isActive ? `0 0 0 4px ${sty.ring}22` : 'none',
                        }}
                    >
                        {s === 'approved' ? '✓' : s === 'rejected' || s === 'failed' ? '×' : index}
                    </div>
                </div>

                {/* Stage body */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: tokens.color.text, letterSpacing: '-0.01em' }}>
                            {meta.label}
                        </h3>
                        <span
                            style={{
                                background: sty.bg, color: sty.fg,
                                padding: '3px 10px', borderRadius: tokens.radius.pill,
                                fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
                                textTransform: 'uppercase',
                            }}
                        >
                            {sty.label}
                        </span>
                        <span style={{
                            background: tokens.color.slateSoft, color: tokens.color.slate,
                            padding: '2px 8px', borderRadius: tokens.radius.sm,
                            fontSize: 11, fontFamily: tokens.font.mono,
                        }}>
                            {meta.model}
                        </span>
                    </div>

                    <div style={{ color: tokens.color.textMuted, fontSize: 13, marginTop: 4 }}>
                        {meta.sub}
                    </div>

                    <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: tokens.color.textSubtle }}>
                        {status?.started_at ? (
                            <span>started {new Date(status.started_at).toLocaleTimeString()}</span>
                        ) : null}
                        {elapsed ? <span>· {elapsed}</span> : null}
                        {status?.dify_run_id ? (
                            <span style={{ fontFamily: tokens.font.mono }}>
                                · dify <code>{status.dify_run_id.slice(0, 8)}</code>
                            </span>
                        ) : null}
                    </div>

                    {/* Live activity ticker — what the stage is doing RIGHT NOW
                        or what it's waiting for. Always visible while the
                        stage is active (running OR awaiting_*), with a
                        status-appropriate fallback message when current_activity
                        isn't set. */}
                    {isActive ? (() => {
                        const tickerText = (() => {
                            if (status?.current_activity) return status.current_activity;
                            if (s === 'awaiting_clarification') return 'Awaiting your answers below…';
                            if (s === 'awaiting_approval') return 'Awaiting your approval below…';
                            if (s === 'running') return 'Working…';
                            return null;
                        })();
                        if (!tickerText) return null;
                        return (
                            <div className="pl-fade-in" style={{
                                marginTop: 12,
                                padding: '10px 14px',
                                background: `linear-gradient(90deg, ${sty.bg} 0%, ${tokens.color.card} 80%)`,
                                border: `1px solid ${sty.ring}55`,
                                borderRadius: tokens.radius.md,
                                display: 'flex', alignItems: 'center', gap: 10,
                                boxShadow: `inset 0 0 0 1px ${sty.ring}11`,
                            }}>
                                <span className={s === 'running' ? 'pl-pulse' : ''} style={{
                                    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                                    background: sty.iconBg, flexShrink: 0,
                                    boxShadow: s === 'running' ? `0 0 0 4px ${sty.iconBg}33` : 'none',
                                }} />
                                <span style={{
                                    fontSize: 14, color: tokens.color.text,
                                    fontFamily: tokens.font.mono,
                                    lineHeight: 1.3, flex: 1, minWidth: 0, fontWeight: 500,
                                }}>
                                    {tickerText}
                                    {s === 'running' ? <span className="pl-blink" aria-hidden style={{ marginLeft: 2 }}>▍</span> : null}
                                </span>
                            </div>
                        );
                    })() : null}

                    {status?.error ? (
                        <pre style={{
                            marginTop: 10, padding: 10,
                            background: tokens.color.dangerSoft, color: '#991b1b',
                            borderRadius: tokens.radius.sm, fontSize: 12,
                            overflowX: 'auto', whiteSpace: 'pre-wrap',
                        }}>{status.error}</pre>
                    ) : null}

                    {/* Artifact summary — metrics chips when stage has output.
                        artifact_json envelope is { answer, parsed, usage, agent }; pass the
                        parsed object to buildMetrics, falling back to the raw envelope for
                        older runs that stored the parsed payload at the top level. */}
                    {(status?.artifact_json != null && s !== 'running') ? (
                        <ArtifactSummary
                            stage={stage}
                            json={(status.artifact_json as any)?.parsed ?? status.artifact_json}
                        />
                    ) : null}

                    {/* Stage 1 only: clarification + source chips */}
                    {stage === 'requirements' && requirementsArtifact && s !== 'running' && (clarificationRounds.length > 0 || requirementsArtifact.source === 'sharepoint') ? (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {clarificationRounds.length > 0 ? (
                                <span style={{
                                    background: '#ede9fe', color: '#5b21b6',
                                    padding: '2px 8px', borderRadius: tokens.radius.pill,
                                    fontSize: 11, fontWeight: 600,
                                }}>
                                    ❓ Clarification rounds: {clarificationRounds.length}
                                </span>
                            ) : null}
                            {requirementsArtifact.source === 'sharepoint' ? (
                                <span style={{
                                    background: tokens.color.primarySoft, color: tokens.color.primary,
                                    padding: '2px 8px', borderRadius: tokens.radius.pill,
                                    fontSize: 11, fontWeight: 600,
                                }}>
                                    📎 Source: SharePoint{requirementsArtifact.version ? ` v${requirementsArtifact.version}` : ''}
                                </span>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Rich visualization — diagrams, tables, etc. per stage.
                        Implementation gets the live-progress view (gate stepper +
                        sandbox-log panel) even while the stage is running; other
                        stages stay hidden until they have a final artifact. */}
                    {(status?.artifact_json != null && (s !== 'running' || stage === 'implementation')) ? (
                        <StageVisualization stage={stage} artifactJson={status.artifact_json} runId={runId} />
                    ) : null}

                    {/* Deployment live URL banner — shown whenever a container is running */}
                    {stage === 'implementation' && deployment && (deployment.status === 'running' || deployment.status === 'installing') ? (() => {
                        const vStatus = deployment.verification_status;
                        const vResult = deployment.verification_result;
                        const verifyColor = vStatus === 'passed' ? '#166534'
                            : vStatus === 'failed' ? '#991b1b'
                            : vStatus === 'running' ? '#92400e'
                            : tokens.color.textMuted;
                        const verifyBg = vStatus === 'passed' ? '#f0fdf4'
                            : vStatus === 'failed' ? '#fef2f2'
                            : vStatus === 'running' ? '#fffbeb'
                            : tokens.color.slateSoft;
                        const verifyLabel = vStatus === 'passed' ? '✓ Browser test passed'
                            : vStatus === 'failed' ? '✗ Browser test failed'
                            : vStatus === 'running' ? '◌ Running browser test…'
                            : vStatus === 'pending' ? '⧖ Browser test queued'
                            : null;
                        const apiUrl = process.env.REACT_APP_API_URL || '/api';
                        const screenshotUrl = `${apiUrl}/pipelines/${runId}/deployment/screenshot`;
                        return (
                            <div className="pl-fade-in" style={{
                                marginTop: 12,
                                borderRadius: tokens.radius.md,
                                overflow: 'hidden',
                                border: `1px solid ${deployment.status === 'running' ? tokens.color.success + '66' : tokens.color.warning + '66'}`,
                            }}>
                                {/* Container status row */}
                                <div style={{
                                    padding: '10px 14px',
                                    background: deployment.status === 'running'
                                        ? `linear-gradient(90deg, ${tokens.color.successSoft}, #f0fdf4)`
                                        : `linear-gradient(90deg, ${tokens.color.warningSoft}, #fffbeb)`,
                                    display: 'flex', alignItems: 'center', gap: 10,
                                }}>
                                    <span
                                        className={deployment.status === 'installing' ? 'pl-pulse' : ''}
                                        style={{
                                            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                            background: deployment.status === 'running' ? tokens.color.success : tokens.color.warning,
                                        }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        {deployment.status === 'running' ? (
                                            <div style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>App is running</div>
                                        ) : (
                                            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>Building Docker container…</div>
                                        )}
                                        {deployment.url && deployment.status === 'running' ? (
                                            <div style={{ fontSize: 11, color: '#166534', fontFamily: tokens.font.mono, marginTop: 2 }}>
                                                {deployment.url}
                                            </div>
                                        ) : null}
                                    </div>
                                    {deployment.url && deployment.status === 'running' ? (
                                        <a
                                            href={deployment.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                                background: tokens.color.success, color: 'white',
                                                fontWeight: 700, fontSize: 12,
                                                padding: '6px 14px', borderRadius: tokens.radius.sm,
                                                textDecoration: 'none', flexShrink: 0,
                                            }}
                                        >
                                            Open app ↗
                                        </a>
                                    ) : null}
                                </div>

                                {/* Inline log tail when building */}
                                {deployment.status === 'installing' && runId ? (
                                    <DeploymentLogs runId={runId} enabled={true} height={120} source="deployment" />
                                ) : null}

                                {/* Browser verification row */}
                                {verifyLabel && deployment.status === 'running' ? (
                                    <div style={{
                                        padding: '8px 14px',
                                        background: verifyBg,
                                        borderTop: `1px solid ${tokens.color.border}`,
                                        display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
                                    }}>
                                        <span style={{
                                            fontSize: 11, fontWeight: 700, color: verifyColor,
                                            className: vStatus === 'running' ? 'pl-pulse' : undefined,
                                            flex: 1,
                                        } as React.CSSProperties}>
                                            {verifyLabel}
                                            {vResult?.load_time_ms ? ` (loaded in ${vResult.load_time_ms}ms)` : ''}
                                        </span>
                                        {/* Re-verify button */}
                                        {(vStatus === 'passed' || vStatus === 'failed') && runId ? (
                                            <button
                                                onClick={() => triggerVerify(runId).catch(() => {})}
                                                disabled={verifyBusy}
                                                style={{
                                                    background: 'transparent',
                                                    border: `1px solid ${tokens.color.border}`,
                                                    borderRadius: tokens.radius.sm,
                                                    color: tokens.color.textMuted,
                                                    fontSize: 11, cursor: verifyBusy ? 'wait' : 'pointer',
                                                    padding: '2px 8px',
                                                }}
                                            >
                                                {verifyBusy ? '…' : '↻ Re-test'}
                                            </button>
                                        ) : null}
                                        {/* Screenshot toggle */}
                                        {vStatus === 'passed' || vStatus === 'failed' ? (
                                            <button
                                                onClick={() => setShowScreenshot(s => !s)}
                                                style={{
                                                    background: 'transparent',
                                                    border: `1px solid ${tokens.color.border}`,
                                                    borderRadius: tokens.radius.sm,
                                                    color: tokens.color.textMuted,
                                                    fontSize: 11, cursor: 'pointer',
                                                    padding: '2px 8px',
                                                }}
                                            >
                                                {showScreenshot ? 'Hide screenshot' : 'Screenshot'}
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}

                                {/* Verification errors */}
                                {vStatus === 'failed' && vResult && vResult.errors.length > 0 ? (
                                    <div style={{
                                        padding: '8px 14px',
                                        background: '#fef2f2',
                                        borderTop: `1px solid #fecaca`,
                                    }}>
                                        {vResult.errors.map((e, i) => (
                                            <div key={i} style={{ fontSize: 11, color: '#991b1b', marginBottom: 3 }}>
                                                <strong>[{e.code}]</strong> {e.message}
                                            </div>
                                        ))}
                                        {vResult.warnings.map((w, i) => (
                                            <div key={`w${i}`} style={{ fontSize: 11, color: '#92400e', marginBottom: 3 }}>
                                                <strong>[{w.code}]</strong> {w.message}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                {/* Screenshot preview */}
                                {showScreenshot && (vStatus === 'passed' || vStatus === 'failed') ? (
                                    <div style={{
                                        borderTop: `1px solid ${tokens.color.border}`,
                                        background: '#0f172a',
                                        padding: 10,
                                        textAlign: 'center',
                                    }}>
                                        <img
                                            src={screenshotUrl}
                                            alt="App screenshot"
                                            style={{
                                                maxWidth: '100%',
                                                borderRadius: tokens.radius.sm,
                                                border: `1px solid ${tokens.color.border}`,
                                            }}
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        );
                    })() : null}

                    {/* Deployment error/crash/auto-fix banner */}
                    {stage === 'implementation' && (deployment?.status === 'failed' || deployment?.status === 'crashed' || deployment?.status === 'auto-fixing') ? (() => {
                        const isCrashed   = deployment.status === 'crashed';
                        const isAutoFix   = deployment.status === 'auto-fixing';
                        const borderColor = isAutoFix ? tokens.color.primary : tokens.color.danger;
                        const bgColor     = isAutoFix ? tokens.color.primarySoft : tokens.color.dangerSoft;
                        const dotColor    = isAutoFix ? tokens.color.primary : tokens.color.danger;
                        const label       = isAutoFix ? 'Auto-fixing crash…' : isCrashed ? 'Deployment crashed — agent fixing…' : 'Deployment failed';
                        const textColor   = isAutoFix ? tokens.color.primary : '#991b1b';
                        return (
                            <div className="pl-fade-in" style={{
                                marginTop: 12, borderRadius: tokens.radius.md,
                                border: `1px solid ${borderColor}55`, overflow: 'hidden',
                            }}>
                                <div style={{
                                    padding: '10px 14px', background: bgColor,
                                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                                }}>
                                    <span className={isAutoFix || isCrashed ? 'pl-pulse' : ''} style={{
                                        width: 10, height: 10, borderRadius: '50%',
                                        flexShrink: 0, background: dotColor,
                                    }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: textColor }}>{label}</div>
                                        {deployment.error && !isAutoFix ? (
                                            <div style={{
                                                fontSize: 11, color: textColor, fontFamily: tokens.font.mono,
                                                marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }} title={deployment.error}>{deployment.error.slice(0, 120)}</div>
                                        ) : null}
                                        {isAutoFix ? (
                                            <div style={{ fontSize: 11, color: tokens.color.primary, marginTop: 2 }}>
                                                Agent is reading source files and applying fixes — will redeploy when done
                                            </div>
                                        ) : null}
                                    </div>
                                    {!isAutoFix && !isCrashed ? (
                                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                            {onFixDeployError ? (
                                                <button onClick={onFixDeployError} style={{
                                                    background: '#7c3aed', color: 'white', border: 'none',
                                                    padding: '5px 12px', borderRadius: tokens.radius.sm,
                                                    fontWeight: 600, fontSize: 12, cursor: 'pointer',
                                                }}>🔧 Fix</button>
                                            ) : null}
                                            {onDeploy ? (
                                                <button onClick={() => onDeploy()} disabled={!!deployBusy} style={{
                                                    background: tokens.color.primary, color: 'white', border: 'none',
                                                    padding: '5px 12px', borderRadius: tokens.radius.sm,
                                                    fontWeight: 600, fontSize: 12,
                                                    cursor: deployBusy ? 'wait' : 'pointer',
                                                    opacity: deployBusy ? 0.6 : 1,
                                                }}>{deployBusy ? '…' : '↻ Redeploy'}</button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                                {runId ? (
                                    <DeploymentLogs
                                        runId={runId}
                                        enabled={isAutoFix || isCrashed}
                                        height={isAutoFix ? 200 : 120}
                                        source={isAutoFix || isCrashed ? 'fix-agent' : 'deployment'}
                                        label={isAutoFix || isCrashed ? 'Fix agent log' : 'Deployment log'}
                                    />
                                ) : null}
                            </div>
                        );
                    })() : null}

                    {/* Artifact actions row */}
                    {(status?.artifact_url || status?.artifact_json != null || onOpenDify || onOpenN8n || onRerun || onDeploy || onCreatePRs) ? (
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            {status?.artifact_url ? (
                                <a
                                    href={status.artifact_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                        color: tokens.color.primary, fontSize: 12,
                                        fontWeight: 500, textDecoration: 'none',
                                        padding: '4px 10px',
                                        border: `1px solid ${tokens.color.primary}44`,
                                        borderRadius: tokens.radius.sm,
                                        background: tokens.color.primarySoft,
                                    }}
                                >
                                    📎 SharePoint artifact
                                </a>
                            ) : null}
                            {stage === 'plan' && status?.artifact_json != null && onViewPlanner ? (
                                <button
                                    onClick={onViewPlanner}
                                    style={{
                                        background: tokens.color.primary, color: 'white', border: 'none',
                                        padding: '4px 12px', borderRadius: tokens.radius.sm,
                                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    ✎ View in Planner
                                </button>
                            ) : null}
                            {stage === 'design' && status?.artifact_json != null && onViewDesigner ? (
                                <button
                                    onClick={onViewDesigner}
                                    style={{
                                        background: tokens.color.primary, color: 'white', border: 'none',
                                        padding: '4px 12px', borderRadius: tokens.radius.sm,
                                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    ✎ Open Design Studio
                                </button>
                            ) : null}
                            {(['requirements', 'plan', 'design'] as const).includes(stage as any)
                                && status?.status === 'approved'
                                && onCreateChangeRequest ? (
                                <button
                                    onClick={onCreateChangeRequest}
                                    style={{
                                        background: tokens.color.warningSoft, color: '#92400e',
                                        border: `1px solid ${tokens.color.warning}55`,
                                        padding: '4px 12px', borderRadius: tokens.radius.sm,
                                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    ↩ Change Request
                                </button>
                            ) : null}
                            {status?.artifact_json != null ? (
                                <button
                                    onClick={() => setShowJson(v => !v)}
                                    style={{
                                        background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                        color: tokens.color.textMuted, cursor: 'pointer',
                                        fontSize: 12, padding: '4px 10px', borderRadius: tokens.radius.sm,
                                    }}
                                >
                                    {showJson ? '▾ Hide JSON' : '▸ Raw JSON'}
                                </button>
                            ) : null}
                            {(onOpenDify && status?.dify_run_id) ? (
                                <button
                                    onClick={onOpenDify}
                                    style={{
                                        background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                        color: tokens.color.text, cursor: 'pointer',
                                        fontSize: 12, padding: '4px 10px', borderRadius: tokens.radius.sm,
                                    }}
                                >
                                    Dify logs ↗
                                </button>
                            ) : null}
                            {onOpenN8n ? (
                                <button
                                    onClick={onOpenN8n}
                                    style={{
                                        background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                        color: tokens.color.text, cursor: 'pointer',
                                        fontSize: 12, padding: '4px 10px', borderRadius: tokens.radius.sm,
                                    }}
                                >
                                    n8n logs ↗
                                </button>
                            ) : null}
                            {stage === 'implementation' && onCreatePRs && (s === 'approved' || s === 'awaiting_approval') && (prsToCreate ?? 0) > 0 ? (
                                <button
                                    onClick={onCreatePRs}
                                    disabled={!!createPRsBusy}
                                    style={{
                                        background: '#0f172a', color: 'white', border: 'none',
                                        padding: '4px 12px', borderRadius: tokens.radius.sm,
                                        fontSize: 12, fontWeight: 600,
                                        cursor: createPRsBusy ? 'wait' : 'pointer',
                                        opacity: createPRsBusy ? 0.6 : 1,
                                    }}
                                    title={`Push ${prsToCreate} ticket${prsToCreate === 1 ? '' : 's'} as draft PR${prsToCreate === 1 ? '' : 's'} to GitHub${(prsAlreadyCreated ?? 0) > 0 ? `. ${prsAlreadyCreated} already pushed.` : ''}`}
                                >
                                    {createPRsBusy
                                        ? '…'
                                        : `🐙 Create PR${prsToCreate === 1 ? '' : 's'} on GitHub (${prsToCreate})`}
                                </button>
                            ) : null}
                            {stage === 'implementation' && (prsAlreadyCreated ?? 0) > 0 && (prsToCreate ?? 0) === 0 ? (
                                <span style={{ fontSize: 11, color: tokens.color.textMuted }}>
                                    {prsAlreadyCreated} PR{prsAlreadyCreated === 1 ? '' : 's'} on GitHub
                                </span>
                            ) : null}
                            {stage === 'implementation' && onDeploy && s === 'approved' ? (() => {
                                const dStatus = deployment?.status;
                                const live = dStatus === 'starting' || dStatus === 'installing' || dStatus === 'running';
                                const hasVersions = implVersions.length > 1;
                                // selectedDeployVersion=null means "current/latest"
                                const deployLabel = selectedDeployVersion != null
                                    ? `▶ Deploy v${selectedDeployVersion}`
                                    : (dStatus === 'stopped' || dStatus === 'failed' ? '↻ Redeploy' : '▶ Deploy');
                                return (
                                    <>
                                        {/* Version selector — only shown when archived versions exist */}
                                        {hasVersions && !live ? (
                                            <select
                                                value={selectedDeployVersion ?? ''}
                                                onChange={e => setSelectedDeployVersion(e.target.value === '' ? null : Number(e.target.value))}
                                                style={{
                                                    fontSize: 12, padding: '4px 8px',
                                                    borderRadius: tokens.radius.sm,
                                                    border: `1px solid ${tokens.color.border}`,
                                                    background: tokens.color.card,
                                                    color: tokens.color.text,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {implVersions.map(v => (
                                                    <option key={v.version} value={v.is_current ? '' : v.version}>
                                                        {v.label} — {v.succeeded_count}/{v.outcomes_count} passed
                                                        {v.archived_at ? ` · ${new Date(v.archived_at).toLocaleDateString()}` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : null}
                                        {!live ? (
                                            <button
                                                onClick={() => onDeploy(selectedDeployVersion ?? undefined)}
                                                disabled={!!deployBusy}
                                                style={{
                                                    background: tokens.color.primary, color: 'white', border: 'none',
                                                    padding: '4px 12px', borderRadius: tokens.radius.sm,
                                                    fontSize: 12, fontWeight: 600,
                                                    cursor: deployBusy ? 'wait' : 'pointer',
                                                    opacity: deployBusy ? 0.6 : 1,
                                                }}
                                            >
                                                {deployBusy ? '…' : deployLabel}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={onStopDeploy}
                                                disabled={!!deployBusy}
                                                style={{
                                                    background: 'white', color: tokens.color.danger,
                                                    border: `1px solid ${tokens.color.danger}55`,
                                                    padding: '4px 12px', borderRadius: tokens.radius.sm,
                                                    fontSize: 12, fontWeight: 600,
                                                    cursor: deployBusy ? 'wait' : 'pointer',
                                                    opacity: deployBusy ? 0.6 : 1,
                                                }}
                                            >
                                                ■ Stop
                                            </button>
                                        )}
                                        {building ? (
                                            <span style={{ fontSize: 11, color: tokens.color.textMuted }}>
                                                <span className="pl-pulse" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: tokens.color.warning, marginRight: 5 }} />
                                                Building container…
                                            </span>
                                        ) : null}
                                    </>
                                );
                            })() : null}
                            {onRerun && (s === 'approved' || s === 'rejected' || s === 'failed' || s === 'skipped') ? (() => {
                                const rerunSupported = stage === 'implementation' || stage === 'requirements';
                                const nextVersion = implVersions.length + 1;
                                const hasExisting = stage === 'implementation' && implVersions.length > 0;
                                return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <button
                                            onClick={onRerun}
                                            disabled={!rerunSupported}
                                            title={rerunSupported
                                                ? (hasExisting ? `Current code will be archived as v${nextVersion - 1}. New run becomes v${nextVersion}.` : 'Re-run this stage in place using cached upstream artifacts')
                                                : 'Stage-level rerun is only supported for implementation and requirements today.'}
                                            style={{
                                                background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                                color: rerunSupported ? tokens.color.text : tokens.color.textSubtle,
                                                cursor: rerunSupported ? 'pointer' : 'not-allowed',
                                                opacity: rerunSupported ? 1 : 0.55,
                                                fontSize: 12, padding: '4px 10px', borderRadius: tokens.radius.sm,
                                            }}
                                        >
                                            ↻ Rerun stage
                                        </button>
                                        {hasExisting ? (
                                            <span style={{ fontSize: 11, color: tokens.color.textMuted }}>
                                                archives current as v{nextVersion - 1}
                                            </span>
                                        ) : null}
                                    </div>
                                );
                            })() : null}
                            {stage === 'requirements' && onSyncFromSharePoint && (s === 'awaiting_approval' || s === 'awaiting_clarification') ? (
                                <button
                                    onClick={handleSyncFromSharePoint}
                                    disabled={syncBusy}
                                    title="Pull the latest requirements.json from SharePoint, validate it, and replace the in-app draft."
                                    style={{
                                        background: 'transparent', border: `1px solid ${tokens.color.primary}55`,
                                        color: tokens.color.primary,
                                        cursor: syncBusy ? 'wait' : 'pointer',
                                        opacity: syncBusy ? 0.6 : 1,
                                        fontSize: 12, padding: '4px 10px', borderRadius: tokens.radius.sm,
                                        fontWeight: 600,
                                    }}
                                >
                                    {syncBusy ? '…' : '↻ Sync from SharePoint'}
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {(showJson && status?.artifact_json != null) ? (
                        <pre className="pl-fade-in" style={{
                            marginTop: 10, padding: 12,
                            background: '#0f172a', color: '#e2e8f0',
                            borderRadius: tokens.radius.md, fontSize: 11,
                            fontFamily: tokens.font.mono,
                            overflowX: 'auto', maxHeight: 400, whiteSpace: 'pre',
                            lineHeight: 1.55,
                        }}>{JSON.stringify(status.artifact_json, null, 2)}</pre>
                    ) : null}

                    {/* Completion timestamp + token info */}
                    {(s === 'approved' || s === 'rejected') && status?.finished_at ? (
                        <div style={{ marginTop: 8, fontSize: 11, color: tokens.color.textSubtle }}>
                            {s === 'approved' ? '✓ Approved' : '✗ Rejected'} at {new Date(status.finished_at).toLocaleTimeString()}
                            {(status.artifact_json as any)?.usage?.completion_tokens ? (
                                <span> · {(status.artifact_json as any).usage.completion_tokens} tokens</span>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Stage 1 only: clarification round form */}
                    {stage === 'requirements' && s === 'awaiting_clarification' && onSubmitClarification ? (
                        <div className="pl-fade-in" style={{
                            marginTop: 14, padding: 14,
                            background: '#f5f3ff',
                            border: '1px solid #c4b5fd',
                            borderRadius: tokens.radius.md,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <span style={{ color: '#5b21b6', fontSize: 13, fontWeight: 600 }}>
                                    ❓ The agent has follow-up questions ({openQuestions.length})
                                </span>
                                {clarificationRounds.length > 0 ? (
                                    <span style={{ fontSize: 11, color: tokens.color.textMuted }}>
                                        · round {clarificationRounds.length + 1}
                                    </span>
                                ) : null}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {openQuestions.length === 0 ? (
                                    <div style={{ fontSize: 12, color: tokens.color.textMuted, fontStyle: 'italic' }}>
                                        No questions parsed. Click Proceed to skip the loop.
                                    </div>
                                ) : openQuestions.map((q, idx) => (
                                    <div key={`${q}-${idx}`}>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: tokens.color.text, marginBottom: 4 }}>
                                            {q}
                                        </label>
                                        <textarea
                                            className="pl-input"
                                            value={clarifyAnswers[q] || ''}
                                            onChange={(e) => setClarifyAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
                                            placeholder="Your answer…"
                                            rows={2}
                                            style={{
                                                width: '100%', resize: 'vertical', minHeight: 48,
                                                padding: '7px 10px', border: `1px solid ${tokens.color.border}`,
                                                borderRadius: tokens.radius.sm, fontSize: 13,
                                                fontFamily: tokens.font.body,
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => handleClarifySubmit(false)}
                                    disabled={clarifyBusy || Object.values(clarifyAnswers).every((a) => !a.trim())}
                                    style={{
                                        background: '#7c3aed', color: 'white', border: 'none',
                                        padding: '8px 18px', borderRadius: tokens.radius.sm,
                                        fontWeight: 600, fontSize: 13,
                                        cursor: clarifyBusy ? 'wait' : 'pointer',
                                        opacity: clarifyBusy ? 0.6 : 1,
                                    }}
                                >
                                    {clarifyBusy ? '…' : 'Submit answers'}
                                </button>
                                <button
                                    onClick={() => handleClarifySubmit(true)}
                                    disabled={clarifyBusy}
                                    title="Skip the clarification loop and move to approval with the current draft."
                                    style={{
                                        background: 'transparent', color: '#5b21b6',
                                        border: '1px solid #c4b5fd',
                                        padding: '8px 14px', borderRadius: tokens.radius.sm,
                                        fontWeight: 600, fontSize: 13,
                                        cursor: clarifyBusy ? 'wait' : 'pointer',
                                    }}
                                >
                                    Proceed Anyway →
                                </button>
                            </div>
                            {clarificationRounds.length > 0 ? (
                                <details style={{ marginTop: 12 }}>
                                    <summary style={{ cursor: 'pointer', fontSize: 12, color: tokens.color.textMuted }}>
                                        Previous rounds ({clarificationRounds.length})
                                    </summary>
                                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {clarificationRounds.map((r) => (
                                            <div key={r.round} style={{
                                                padding: 8, background: 'white', borderRadius: tokens.radius.sm,
                                                border: `1px solid ${tokens.color.border}`, fontSize: 12,
                                            }}>
                                                <div style={{ color: tokens.color.textMuted, marginBottom: 4 }}>
                                                    Round {r.round} · {new Date(r.answered_at).toLocaleString()}
                                                </div>
                                                {Object.entries(r.answers || {}).map(([q, a]) => (
                                                    <div key={q} style={{ marginTop: 4 }}>
                                                        <div style={{ fontWeight: 500 }}>{q}</div>
                                                        <div style={{ color: tokens.color.textMuted, paddingLeft: 8 }}>→ {a as string}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Approve / reject actions */}
                    {s === 'awaiting_approval' ? (
                        <div className="pl-fade-in" style={{
                            marginTop: 14, padding: 12,
                            background: '#fffbeb',
                            border: `1px solid ${tokens.color.warningSoft}`,
                            borderRadius: tokens.radius.md,
                            display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                        }}>
                            <span style={{ color: '#92400e', fontSize: 13, fontWeight: 500, marginRight: 6 }}>
                                ⚠ Awaiting your decision
                            </span>
                            <button
                                className="pl-btn-success"
                                onClick={() => handle('approved')}
                                disabled={submitting}
                                style={{
                                    background: tokens.color.success, color: 'white', border: 'none',
                                    padding: '8px 18px', borderRadius: tokens.radius.sm, fontWeight: 600, fontSize: 13,
                                    cursor: submitting ? 'wait' : 'pointer',
                                    boxShadow: tokens.shadow.sm,
                                }}
                            >
                                {submitting ? '…' : '✓ Approve'}
                            </button>
                            {!showRejectInput ? (
                                <button
                                    className="pl-btn-danger"
                                    onClick={() => setShowRejectInput(true)}
                                    disabled={submitting}
                                    style={{
                                        background: tokens.color.danger, color: 'white', border: 'none',
                                        padding: '8px 18px', borderRadius: tokens.radius.sm, fontWeight: 600, fontSize: 13,
                                        cursor: 'pointer', boxShadow: tokens.shadow.sm,
                                    }}
                                >
                                    × Reject
                                </button>
                            ) : (
                                <>
                                    <input
                                        autoFocus
                                        className="pl-input"
                                        type="text"
                                        value={rejectReason}
                                        onChange={e => setRejectReason(e.target.value)}
                                        placeholder="reason for rejection"
                                        style={{
                                            padding: '7px 10px', border: `1px solid ${tokens.color.border}`,
                                            borderRadius: tokens.radius.sm, fontSize: 13, minWidth: 240, flex: 1,
                                        }}
                                    />
                                    <button
                                        className="pl-btn-danger"
                                        onClick={() => handle('rejected', rejectReason)}
                                        disabled={submitting || !rejectReason.trim()}
                                        style={{
                                            background: tokens.color.danger, color: 'white', border: 'none',
                                            padding: '8px 14px', borderRadius: tokens.radius.sm, fontWeight: 600, fontSize: 13,
                                            cursor: 'pointer', opacity: submitting || !rejectReason.trim() ? 0.5 : 1,
                                        }}
                                    >
                                        Reject
                                    </button>
                                    <button
                                        className="pl-btn-ghost"
                                        onClick={() => { setShowRejectInput(false); setRejectReason(''); }}
                                        disabled={submitting}
                                        style={{
                                            background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                            padding: '8px 12px', borderRadius: tokens.radius.sm, fontSize: 13, cursor: 'pointer',
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
