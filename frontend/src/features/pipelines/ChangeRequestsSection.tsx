import React, { useState } from 'react';
import { tokens } from './design';
import { ChangeRequest, applyChangeRequest, dismissChangeRequest } from '../../api/pipelinesApi';

interface Props {
    runId: string;
    changeRequests: ChangeRequest[];
    onApplied: (newRunId: string) => void;
    onDismissed: () => void;
}

const STAGE_LABELS: Record<string, string> = {
    requirements: 'Requirements',
    plan: 'Plan',
    design: 'Design',
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
    pending:   { bg: tokens.color.warningSoft, fg: '#92400e' },
    applied:   { bg: tokens.color.successSoft, fg: '#166534' },
    dismissed: { bg: tokens.color.slateSoft,   fg: tokens.color.slate },
};

export function ChangeRequestsSection({ changeRequests, onApplied, onDismissed }: Props) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [applying, setApplying] = useState<string | null>(null);
    const [dismissing, setDismissing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (changeRequests.length === 0) return null;

    const pendingCount = changeRequests.filter(cr => cr.status === 'pending').length;

    async function handleApply(crId: string) {
        if (applying) return;
        setApplying(crId);
        setError(null);
        try {
            const { run_id } = await applyChangeRequest(crId);
            onApplied(run_id);
        } catch (e: any) {
            setError(e?.response?.data?.error ?? e.message ?? 'Apply failed');
        } finally {
            setApplying(null);
        }
    }

    async function handleDismiss(crId: string) {
        if (dismissing) return;
        setDismissing(crId);
        setError(null);
        try {
            await dismissChangeRequest(crId);
            onDismissed();
        } catch (e: any) {
            setError(e?.response?.data?.error ?? e.message ?? 'Dismiss failed');
        } finally {
            setDismissing(null);
        }
    }

    return (
        <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: tokens.color.textMuted }}>
                    Change Requests
                </span>
                {pendingCount > 0 ? (
                    <span style={{
                        fontSize: 11, fontWeight: 700, color: '#92400e',
                        background: tokens.color.warningSoft, borderRadius: tokens.radius.pill,
                        padding: '1px 8px',
                    }}>
                        {pendingCount} pending
                    </span>
                ) : null}
            </div>

            {error ? (
                <div style={{
                    marginBottom: 12, padding: '8px 12px',
                    background: tokens.color.dangerSoft, border: `1px solid ${tokens.color.danger}55`,
                    borderRadius: tokens.radius.md, fontSize: 13, color: tokens.color.danger,
                }}>
                    {error}
                </div>
            ) : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {changeRequests.map(cr => {
                    const ss = STATUS_STYLE[cr.status] ?? STATUS_STYLE.dismissed;
                    const isExpanded = expandedId === cr.id;
                    const createdDate = new Date(cr.created_at).toLocaleString();

                    return (
                        <div key={cr.id} style={{
                            border: `1px solid ${tokens.color.border}`,
                            borderRadius: tokens.radius.lg,
                            background: tokens.color.card,
                            overflow: 'hidden',
                        }}>
                            {/* Header row */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '12px 16px',
                            }}>
                                <span style={{
                                    fontSize: 12, fontWeight: 600, padding: '2px 8px',
                                    borderRadius: tokens.radius.pill,
                                    background: ss.bg, color: ss.fg,
                                }}>
                                    {STAGE_LABELS[cr.stage] ?? cr.stage}
                                </span>
                                <span style={{
                                    fontSize: 11, padding: '2px 7px',
                                    borderRadius: tokens.radius.pill,
                                    background: ss.bg, color: ss.fg, fontWeight: 500,
                                }}>
                                    {cr.status}
                                </span>
                                <span style={{ fontSize: 12, color: tokens.color.textMuted, flex: 1 }}>
                                    {cr.created_by ? `by ${cr.created_by} · ` : ''}{createdDate}
                                </span>

                                {/* View toggle */}
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : cr.id)}
                                    style={{
                                        background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                        borderRadius: tokens.radius.sm, padding: '3px 10px',
                                        fontSize: 12, cursor: 'pointer', color: tokens.color.text, fontWeight: 500,
                                    }}
                                >
                                    {isExpanded ? 'Hide' : 'View'}
                                </button>

                                {cr.status === 'pending' ? (
                                    <>
                                        <button
                                            onClick={() => handleApply(cr.id)}
                                            disabled={!!applying}
                                            style={{
                                                background: tokens.color.primary, color: 'white',
                                                border: 'none', borderRadius: tokens.radius.sm,
                                                padding: '4px 12px', fontSize: 12, fontWeight: 600,
                                                cursor: applying ? 'not-allowed' : 'pointer',
                                                opacity: applying === cr.id ? 0.7 : 1,
                                            }}
                                        >
                                            {applying === cr.id ? 'Applying…' : 'Apply →'}
                                        </button>
                                        <button
                                            onClick={() => handleDismiss(cr.id)}
                                            disabled={!!dismissing}
                                            style={{
                                                background: 'transparent', color: tokens.color.textMuted,
                                                border: `1px solid ${tokens.color.border}`,
                                                borderRadius: tokens.radius.sm,
                                                padding: '4px 10px', fontSize: 12,
                                                cursor: dismissing ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {dismissing === cr.id ? '…' : 'Dismiss'}
                                        </button>
                                    </>
                                ) : null}

                                {cr.status === 'applied' && cr.applied_run_id ? (
                                    <span style={{ fontSize: 11, color: tokens.color.success, fontWeight: 500 }}>
                                        → Run #{cr.applied_run_id.slice(0, 8)}
                                    </span>
                                ) : null}
                            </div>

                            {/* Expanded artifact diff */}
                            {isExpanded ? (
                                <div style={{
                                    borderTop: `1px solid ${tokens.color.border}`,
                                    padding: '12px 16px',
                                    background: tokens.color.bg,
                                }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: tokens.color.textMuted,
                                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                                        Proposed Changes
                                    </div>
                                    <pre style={{
                                        fontSize: 11, fontFamily: tokens.font.mono, lineHeight: 1.6,
                                        margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                        color: tokens.color.text,
                                        maxHeight: 320, overflow: 'auto',
                                    }}>
                                        {JSON.stringify(cr.proposed_artifact, null, 2)}
                                    </pre>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
