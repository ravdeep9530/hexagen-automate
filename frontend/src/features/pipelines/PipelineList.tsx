import React, { useMemo, useState } from 'react';
import { usePipelineList, RunStatus } from '../../api/pipelinesApi';
import { tokens } from './design';

const STATUS_STYLE: Record<RunStatus, { bg: string; fg: string; label: string; dot: string }> = {
    queued:                 { bg: tokens.color.slateSoft,   fg: tokens.color.slate,    label: 'Queued',     dot: tokens.color.slate },
    running:                { bg: tokens.color.primarySoft, fg: tokens.color.primary,  label: 'Running',    dot: tokens.color.primary },
    awaiting_clarification: { bg: '#ede9fe',                fg: '#5b21b6',             label: 'Awaiting',   dot: '#8b5cf6' },
    awaiting_approval:      { bg: tokens.color.warningSoft, fg: '#92400e',             label: 'Awaiting',   dot: tokens.color.warning },
    approved:          { bg: tokens.color.successSoft, fg: '#166534',             label: 'Approved',   dot: tokens.color.success },
    rejected:          { bg: tokens.color.dangerSoft,  fg: '#991b1b',             label: 'Rejected',   dot: tokens.color.danger },
    completed:         { bg: tokens.color.successSoft, fg: '#166534',             label: 'Completed',  dot: tokens.color.success },
    failed:            { bg: tokens.color.dangerSoft,  fg: '#991b1b',             label: 'Failed',     dot: tokens.color.danger },
};

interface Props {
    onSelect: (run_id: string) => void;
    onStartNew: () => void;
}

type Filter = 'all' | 'active' | 'completed' | 'rejected';

export function PipelineList({ onSelect, onStartNew }: Props) {
    const { runs, loading, refetch } = usePipelineList(5000);
    const [filter, setFilter] = useState<Filter>('all');
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        let xs = runs;
        if (filter === 'active') {
            xs = xs.filter(r => r.status === 'running' || r.status === 'awaiting_approval' || r.status === 'queued');
        } else if (filter === 'completed') {
            xs = xs.filter(r => r.status === 'completed');
        } else if (filter === 'rejected') {
            xs = xs.filter(r => r.status === 'rejected' || r.status === 'failed');
        }
        if (search) {
            const q = search.toLowerCase();
            xs = xs.filter(r =>
                r.repo_full_name.toLowerCase().includes(q) ||
                r.raw_request.toLowerCase().includes(q) ||
                (r.requester_id || '').toLowerCase().includes(q),
            );
        }
        return xs;
    }, [runs, filter, search]);

    // Compact stats
    const stats = useMemo(() => {
        return {
            total: runs.length,
            active: runs.filter(r => r.status === 'running' || r.status === 'awaiting_approval' || r.status === 'queued').length,
            completed: runs.filter(r => r.status === 'completed').length,
            failed: runs.filter(r => r.status === 'rejected' || r.status === 'failed').length,
        };
    }, [runs]);

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: tokens.color.text }}>
                        SDLC Pipelines
                    </h2>
                    <p style={{ margin: '4px 0 0 0', color: tokens.color.textMuted, fontSize: 13 }}>
                        Every run with live status. Updates every 5 seconds.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        className="pl-btn-ghost"
                        onClick={refetch}
                        disabled={loading}
                        style={{
                            padding: '8px 14px', borderRadius: tokens.radius.md,
                            border: `1px solid ${tokens.color.border}`, background: 'white',
                            color: tokens.color.text, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                        }}
                    >
                        {loading ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                    <button
                        className="pl-btn-primary"
                        onClick={onStartNew}
                        style={{
                            background: tokens.color.primary, color: 'white', border: 'none',
                            padding: '8px 18px', borderRadius: tokens.radius.md, fontWeight: 600, fontSize: 13,
                            cursor: 'pointer', boxShadow: tokens.shadow.sm,
                        }}
                    >
                        ＋ New pipeline
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                <Stat label="Total" value={stats.total} color={tokens.color.text} />
                <Stat label="Active" value={stats.active} color={tokens.color.primary} />
                <Stat label="Completed" value={stats.completed} color={tokens.color.success} />
                <Stat label="Failed / Rejected" value={stats.failed} color={tokens.color.danger} />
            </div>

            {/* Filter + search bar */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                background: tokens.color.card, padding: 10,
                border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md,
                marginBottom: 16,
            }}>
                <div style={{ display: 'flex', gap: 4 }}>
                    {(['all','active','completed','rejected'] as Filter[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            style={{
                                background: filter === f ? tokens.color.primary : 'transparent',
                                color: filter === f ? 'white' : tokens.color.text,
                                border: 'none', padding: '6px 14px',
                                borderRadius: tokens.radius.sm,
                                fontSize: 13, fontWeight: filter === f ? 600 : 500,
                                cursor: 'pointer', textTransform: 'capitalize',
                            }}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                <input
                    className="pl-input"
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by repo, request, or requester"
                    style={{
                        padding: '7px 12px', border: `1px solid ${tokens.color.border}`,
                        borderRadius: tokens.radius.sm, fontSize: 13, minWidth: 280, flex: 1, maxWidth: 360,
                        background: '#fafbfc',
                    }}
                />
            </div>

            {/* Run list */}
            {filtered.length === 0 ? (
                <div style={{
                    padding: 40, textAlign: 'center', background: tokens.color.card,
                    borderRadius: tokens.radius.lg, border: `1px dashed ${tokens.color.border}`,
                    color: tokens.color.textMuted,
                }}>
                    {loading ? 'Loading…' : runs.length === 0 ? 'No runs yet — kick off your first pipeline!' : 'No runs match the current filter.'}
                </div>
            ) : (
                <div style={{
                    background: tokens.color.card, borderRadius: tokens.radius.lg,
                    border: `1px solid ${tokens.color.border}`, overflow: 'hidden',
                    boxShadow: tokens.shadow.sm,
                }}>
                    {filtered.map((r, idx) => {
                        const sty = STATUS_STYLE[r.status] || STATUS_STYLE.queued;
                        const title = (() => {
                            const m = r.raw_request.match(/^#\s+(.+)$/m);
                            return m ? m[1] : r.raw_request.split('\n')[0].slice(0, 100);
                        })();
                        return (
                            <div
                                key={r.run_id}
                                className="pl-row"
                                onClick={() => onSelect(r.run_id)}
                                style={{
                                    padding: '14px 18px',
                                    display: 'grid',
                                    gridTemplateColumns: 'auto 1fr auto auto',
                                    gap: 16,
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    borderTop: idx === 0 ? 'none' : `1px solid ${tokens.color.border}`,
                                    transition: 'background .12s',
                                }}
                            >
                                {/* Status dot */}
                                <div style={{
                                    width: 10, height: 10, borderRadius: '50%',
                                    background: sty.dot,
                                    boxShadow: r.status === 'running' || r.status === 'awaiting_approval' ? `0 0 0 4px ${sty.bg}` : 'none',
                                }} />
                                {/* Repo + title */}
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.color.textMuted }}>
                                            {r.repo_full_name}
                                        </span>
                                        {r.current_stage ? (
                                            <span style={{
                                                fontSize: 11, color: tokens.color.textSubtle,
                                                textTransform: 'capitalize',
                                            }}>
                                                · stage {r.current_stage}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div style={{
                                        fontSize: 14, fontWeight: 500, color: tokens.color.text,
                                        marginTop: 2,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {title}
                                    </div>
                                    <div style={{ fontSize: 11, color: tokens.color.textSubtle, marginTop: 2 }}>
                                        {r.requester_id ? `${r.requester_id} · ` : ''}{new Date(r.created_at).toLocaleString()}
                                    </div>
                                </div>
                                {/* Status pill */}
                                <span style={{
                                    background: sty.bg, color: sty.fg,
                                    padding: '4px 12px', borderRadius: tokens.radius.pill,
                                    fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                                }}>
                                    {sty.label}
                                </span>
                                <span style={{ color: tokens.color.textSubtle, fontSize: 16 }}>→</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="pl-card" style={{
            background: tokens.color.card,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.lg,
            padding: 16,
            transition: 'all .15s',
        }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4, letterSpacing: '-0.02em' }}>
                {value}
            </div>
        </div>
    );
}
