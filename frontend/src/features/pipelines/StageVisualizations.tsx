import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Stage, useRetryTicket } from '../../api/pipelinesApi';
import { tokens } from './design';
import { DeploymentLogs } from './DeploymentLogs';
import { FileManager } from './FileManager';

// Mermaid is initialised once for the whole app.
let mermaidInitialised = false;
function ensureMermaidInit() {
    if (mermaidInitialised) return;
    mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: tokens.font.body,
    });
    mermaidInitialised = true;
}

/**
 * Renders a mermaid diagram. Generates a unique id per render to avoid
 * mermaid's internal cache returning a stale node.
 */
export function MermaidDiagram({ source, fallbackLabel }: { source: string; fallbackLabel?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        ensureMermaidInit();
        if (!ref.current) return;
        const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
        const cleaned = (source || '').trim();
        if (!cleaned) return;
        let cancelled = false;
        mermaid.render(id, cleaned)
            .then(({ svg }) => {
                if (cancelled || !ref.current) return;
                ref.current.innerHTML = svg;
                setError(null);
            })
            .catch((e) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : String(e));
            });
        return () => { cancelled = true; };
    }, [source]);

    if (!source || !source.trim()) {
        return <em style={{ color: tokens.color.textSubtle, fontSize: 12 }}>{fallbackLabel || '(no diagram)'}</em>;
    }
    if (error) {
        return (
            <div>
                <div style={{ color: tokens.color.danger, fontSize: 12, marginBottom: 4 }}>
                    Mermaid render failed: {error}
                </div>
                <pre style={{
                    fontSize: 11, padding: 8, background: tokens.color.slateSoft,
                    borderRadius: tokens.radius.sm, overflowX: 'auto',
                }}>{source}</pre>
            </div>
        );
    }
    return (
        <div
            ref={ref}
            style={{
                background: '#fff', padding: 12,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.md,
                overflowX: 'auto',
            }}
        />
    );
}

// ─── Generic table styling helpers ────────────────────────────────────────────

const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: tokens.color.textMuted,
    background: tokens.color.slateSoft,
    borderBottom: `1px solid ${tokens.color.border}`,
    position: 'sticky',
    top: 0,
};
const td: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: 13,
    color: tokens.color.text,
    borderBottom: `1px solid ${tokens.color.border}`,
    verticalAlign: 'top',
};

function tableShell(children: React.ReactNode, maxHeight = 360): React.ReactElement {
    return (
        <div style={{
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            overflow: 'auto',
            maxHeight,
            background: 'white',
        }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: tokens.font.body }}>
                {children}
            </table>
        </div>
    );
}

function sectionTitle(title: string, count?: number): React.ReactElement {
    return (
        <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8,
            margin: '14px 0 6px 0',
        }}>
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: tokens.color.text, letterSpacing: '-0.01em' }}>
                {title}
            </h4>
            {typeof count === 'number' ? (
                <span style={{
                    background: tokens.color.slateSoft, color: tokens.color.textMuted,
                    fontSize: 11, padding: '1px 8px', borderRadius: tokens.radius.pill,
                    fontFamily: tokens.font.mono,
                }}>{count}</span>
            ) : null}
        </div>
    );
}

function pill(text: string, color: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple'): React.ReactElement {
    const palette: Record<typeof color, { bg: string; fg: string }> = {
        gray:   { bg: tokens.color.slateSoft,   fg: tokens.color.slate },
        green:  { bg: tokens.color.successSoft, fg: '#166534' },
        amber:  { bg: tokens.color.warningSoft, fg: '#92400e' },
        red:    { bg: tokens.color.dangerSoft,  fg: '#991b1b' },
        blue:   { bg: tokens.color.primarySoft, fg: tokens.color.primary },
        purple: { bg: '#f3e8ff',                fg: '#6b21a8' },
    };
    const p = palette[color];
    return (
        <span style={{
            background: p.bg, color: p.fg,
            padding: '2px 8px', borderRadius: tokens.radius.pill,
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            display: 'inline-block',
        }}>{text}</span>
    );
}

// ─── Per-stage visualizations ─────────────────────────────────────────────────

function RequirementsViz({ json }: { json: any }) {
    return (
        <div>
            {json.title ? (
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{json.title}</div>
            ) : null}
            {Array.isArray(json.user_stories) && json.user_stories.length > 0 ? (
                <>
                    {sectionTitle('User stories', json.user_stories.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.text }}>
                        {json.user_stories.map((us: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{us}</li>)}
                    </ul>
                </>
            ) : null}
            {Array.isArray(json.acceptance_criteria) && json.acceptance_criteria.length > 0 ? (
                <>
                    {sectionTitle('Acceptance criteria', json.acceptance_criteria.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.text }}>
                        {json.acceptance_criteria.map((c: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}
                    </ul>
                </>
            ) : null}
            {Array.isArray(json.open_questions) && json.open_questions.length > 0 ? (
                <>
                    {sectionTitle('Open questions', json.open_questions.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.warning }}>
                        {json.open_questions.map((q: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{q}</li>)}
                    </ul>
                </>
            ) : null}
        </div>
    );
}

function OptimizeViz({ json }: { json: any }) {
    const m = json.moscow || {};
    const cols: Array<{ key: string; label: string; color: 'red' | 'amber' | 'blue' | 'gray' }> = [
        { key: 'must',   label: 'Must',   color: 'red'   },
        { key: 'should', label: 'Should', color: 'amber' },
        { key: 'could',  label: 'Could',  color: 'blue'  },
        { key: 'wont',   label: "Won't",  color: 'gray'  },
    ];
    const hasMoscow = cols.some(c => Array.isArray(m[c.key]) && m[c.key].length > 0);

    return (
        <div>
            {hasMoscow ? (
                <>
                    {sectionTitle('MoSCoW prioritization')}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                        {cols.map(c => {
                            const items: string[] = Array.isArray(m[c.key]) ? m[c.key] : [];
                            return (
                                <div key={c.key} style={{
                                    border: `1px solid ${tokens.color.border}`,
                                    borderRadius: tokens.radius.md,
                                    background: 'white',
                                    padding: 10,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        {pill(c.label, c.color)}
                                        <span style={{ fontSize: 11, color: tokens.color.textMuted }}>{items.length}</span>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: tokens.color.text }}>
                                        {items.length === 0 ? (
                                            <li style={{ listStyle: 'none', color: tokens.color.textSubtle, marginLeft: -16 }}>(none)</li>
                                        ) : (
                                            items.map((x, i) => <li key={i} style={{ marginBottom: 3 }}>{x}</li>)
                                        )}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : null}

            {Array.isArray(json.risks) && json.risks.length > 0 ? (
                <>
                    {sectionTitle('Risks', json.risks.length)}
                    {tableShell(
                        <>
                            <thead><tr>
                                <th style={th}>Risk</th>
                                <th style={th}>Likelihood</th>
                                <th style={th}>Impact</th>
                                <th style={th}>Mitigation</th>
                            </tr></thead>
                            <tbody>
                                {json.risks.map((r: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={td}>{r.risk}</td>
                                        <td style={td}>{pill(r.likelihood || '—', r.likelihood === 'high' ? 'red' : r.likelihood === 'medium' ? 'amber' : 'gray')}</td>
                                        <td style={td}>{pill(r.impact || '—', r.impact === 'high' ? 'red' : r.impact === 'medium' ? 'amber' : 'gray')}</td>
                                        <td style={td}>{r.mitigation}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </>,
                        260
                    )}
                </>
            ) : null}
        </div>
    );
}

function PlanViz({ json }: { json: any }) {
    return (
        <div>
            {Array.isArray(json.affected_repos) && json.affected_repos.length > 0 ? (
                <>
                    {sectionTitle('Affected repos', json.affected_repos.length)}
                    {tableShell(
                        <>
                            <thead><tr><th style={th}>Repo</th><th style={th}>Reason</th></tr></thead>
                            <tbody>
                                {json.affected_repos.map((r: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={{ ...td, fontFamily: tokens.font.mono, color: tokens.color.primary }}>{r.repo}</td>
                                        <td style={td}>{r.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </>
                    )}
                </>
            ) : null}

            {Array.isArray(json.phases) && json.phases.length > 0 ? (
                <>
                    {sectionTitle('Phases', json.phases.length)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {json.phases.map((p: any, i: number) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '8px 10px', background: 'white',
                                border: `1px solid ${tokens.color.border}`,
                                borderRadius: tokens.radius.sm, fontSize: 13,
                            }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: '50%',
                                    background: tokens.color.primary, color: 'white',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 13, flexShrink: 0,
                                }}>{i + 1}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                                    <div style={{ fontSize: 12, color: tokens.color.textMuted }}>{p.description}</div>
                                </div>
                                {Array.isArray(p.depends_on_phases) && p.depends_on_phases.length > 0 ? (
                                    <span style={{ fontSize: 11, color: tokens.color.textMuted, fontFamily: tokens.font.mono }}>
                                        ← {p.depends_on_phases.join(', ')}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

            {Array.isArray(json.milestones) && json.milestones.length > 0 ? (
                <>
                    {sectionTitle('Milestones', json.milestones.length)}
                    {tableShell(
                        <>
                            <thead><tr><th style={th}>Milestone</th><th style={th}>Phase</th><th style={th}>Acceptance</th></tr></thead>
                            <tbody>
                                {json.milestones.map((m: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={{ ...td, fontWeight: 600 }}>{m.name}</td>
                                        <td style={td}>{pill(m.phase || '—', 'blue')}</td>
                                        <td style={td}>{m.acceptance}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </>
                    )}
                </>
            ) : null}

            {Array.isArray(json.blockers) && json.blockers.length > 0 ? (
                <>
                    {sectionTitle('Blockers', json.blockers.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.danger }}>
                        {json.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
                    </ul>
                </>
            ) : null}
        </div>
    );
}

function DesignViz({ json }: { json: any }) {
    return (
        <div>
            {json.architecture_diagram_mermaid ? (
                <>
                    {sectionTitle('Architecture')}
                    <MermaidDiagram source={json.architecture_diagram_mermaid} fallbackLabel="(no architecture diagram)" />
                </>
            ) : null}

            {Array.isArray(json.data_model) && json.data_model.length > 0 ? (
                <>
                    {sectionTitle('Data model', json.data_model.length)}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                        {json.data_model.map((e: any, i: number) => (
                            <div key={i} style={{
                                background: 'white',
                                border: `1px solid ${tokens.color.border}`,
                                borderRadius: tokens.radius.md,
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    padding: '8px 10px', background: tokens.color.primarySoft,
                                    color: tokens.color.primary, fontWeight: 700,
                                    fontFamily: tokens.font.mono, fontSize: 13,
                                    borderBottom: `1px solid ${tokens.color.border}`,
                                }}>
                                    {e.entity}
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                    <tbody>
                                        {(e.fields || []).map((f: any, j: number) => (
                                            <tr key={j} style={{ borderBottom: `1px solid ${tokens.color.slateSoft}` }}>
                                                <td style={{ padding: '4px 10px', fontFamily: tokens.font.mono, color: tokens.color.text }}>{f.name}</td>
                                                <td style={{ padding: '4px 10px', color: tokens.color.textMuted, fontFamily: tokens.font.mono }}>{f.type}</td>
                                                <td style={{ padding: '4px 10px', color: tokens.color.textSubtle, fontSize: 11 }}>
                                                    {f.nullable ? 'null' : 'not null'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {Array.isArray(e.relationships) && e.relationships.length > 0 ? (
                                    <div style={{ padding: '4px 10px', fontSize: 11, color: tokens.color.textMuted, borderTop: `1px solid ${tokens.color.slateSoft}` }}>
                                        → {e.relationships.join(', ')}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

            {Array.isArray(json.api_contracts) && json.api_contracts.length > 0 ? (
                <>
                    {sectionTitle('API contracts', json.api_contracts.length)}
                    {tableShell(
                        <>
                            <thead><tr>
                                <th style={th}>Method</th>
                                <th style={th}>Path</th>
                                <th style={th}>Request</th>
                                <th style={th}>Response</th>
                                <th style={th}>Errors</th>
                            </tr></thead>
                            <tbody>
                                {json.api_contracts.map((c: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={td}>{pill(c.method || '', c.method === 'GET' ? 'green' : c.method === 'POST' ? 'blue' : c.method === 'DELETE' ? 'red' : 'amber')}</td>
                                        <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 12 }}>{c.path}</td>
                                        <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 11, color: tokens.color.textMuted, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {typeof c.request === 'object' ? JSON.stringify(c.request).slice(0, 120) : String(c.request || '')}
                                        </td>
                                        <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 11, color: tokens.color.textMuted, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {typeof c.response === 'object' ? JSON.stringify(c.response).slice(0, 120) : String(c.response || '')}
                                        </td>
                                        <td style={td}>
                                            {Array.isArray(c.errors) ? c.errors.map((e: string, ei: number) => <div key={ei} style={{ fontSize: 11, color: tokens.color.danger }}>{e}</div>) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </>,
                        400
                    )}
                </>
            ) : null}

            {Array.isArray(json.sequence_diagrams_mermaid) && json.sequence_diagrams_mermaid.length > 0 ? (
                <>
                    {sectionTitle('Sequence diagrams', json.sequence_diagrams_mermaid.length)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {json.sequence_diagrams_mermaid.map((m: any, i: number) => (
                            <MermaidDiagram key={i} source={typeof m === 'string' ? m : (m.diagram ?? '')} fallbackLabel={`(sequence ${i + 1} empty)`} />
                        ))}
                    </div>
                </>
            ) : null}

            {Array.isArray(json.security_considerations) && json.security_considerations.length > 0 ? (
                <>
                    {sectionTitle('Security considerations', json.security_considerations.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.text }}>
                        {json.security_considerations.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                </>
            ) : null}

            {Array.isArray(json.adrs) && json.adrs.length > 0 ? (
                <>
                    {sectionTitle('ADRs', json.adrs.length)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {json.adrs.map((adr: any, i: number) => (
                            <details key={i} style={{
                                background: 'white',
                                border: `1px solid ${tokens.color.border}`,
                                borderRadius: tokens.radius.sm,
                                padding: '8px 12px', fontSize: 13,
                            }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 600, color: tokens.color.text }}>{adr.title}</summary>
                                <div style={{ marginTop: 6, color: tokens.color.textMuted }}>
                                    <div><strong>Context:</strong> {adr.context}</div>
                                    <div><strong>Decision:</strong> {adr.decision}</div>
                                    <div><strong>Consequences:</strong> {adr.consequences}</div>
                                </div>
                            </details>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    );
}

function SprintViz({ json }: { json: any }) {
    const tickets: any[] = Array.isArray(json.tickets) ? json.tickets : [];
    if (tickets.length === 0) return null;

    // Group by sprint_assignment
    const sprints = new Map<number, any[]>();
    for (const t of tickets) {
        const sa = typeof t.sprint_assignment === 'number' ? t.sprint_assignment : 0;
        if (!sprints.has(sa)) sprints.set(sa, []);
        sprints.get(sa)!.push(t);
    }
    const sprintKeys = Array.from(sprints.keys()).sort((a, b) => a - b);

    return (
        <div>
            {sectionTitle('Tickets', tickets.length)}
            <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 12, color: tokens.color.textMuted }}>
                <span>Total points: <strong style={{ color: tokens.color.text }}>{tickets.reduce((s, t) => s + (t.estimate_points || 0), 0)}</strong></span>
                <span>·</span>
                <span>Sprints: <strong style={{ color: tokens.color.text }}>{sprintKeys.length}</strong></span>
            </div>
            {sprintKeys.map(sk => {
                const list = sprints.get(sk)!;
                const sprintPts = list.reduce((s, t) => s + (t.estimate_points || 0), 0);
                return (
                    <div key={sk} style={{ marginBottom: 14 }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            margin: '6px 0',
                        }}>
                            {pill(`Sprint ${sk || '?'}`, 'blue')}
                            <span style={{ fontSize: 11, color: tokens.color.textMuted }}>
                                {list.length} tickets · {sprintPts} pts
                            </span>
                        </div>
                        {tableShell(
                            <>
                                <thead><tr>
                                    <th style={{ ...th, width: 90 }}>ID</th>
                                    <th style={th}>Title</th>
                                    <th style={{ ...th, width: 70 }}>Points</th>
                                    <th style={th}>Files</th>
                                    <th style={th}>Deps</th>
                                </tr></thead>
                                <tbody>
                                    {list.map((t: any, i: number) => (
                                        <tr key={i} className="pl-row">
                                            <td style={{ ...td, fontFamily: tokens.font.mono, color: tokens.color.primary, fontSize: 12 }}>
                                                {t.id}
                                            </td>
                                            <td style={td}>
                                                <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.title}</div>
                                                <div style={{ fontSize: 12, color: tokens.color.textMuted }}>{t.description}</div>
                                                {Array.isArray(t.acceptance_criteria) && t.acceptance_criteria.length > 0 ? (
                                                    <details style={{ marginTop: 4 }}>
                                                        <summary style={{ cursor: 'pointer', fontSize: 11, color: tokens.color.textMuted }}>
                                                            {t.acceptance_criteria.length} acceptance criteria
                                                        </summary>
                                                        <ul style={{ margin: '4px 0 0 0', paddingLeft: 18, fontSize: 12, color: tokens.color.textMuted }}>
                                                            {t.acceptance_criteria.map((ac: string, ai: number) => <li key={ai}>{ac}</li>)}
                                                        </ul>
                                                    </details>
                                                ) : null}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <span style={{
                                                    background: tokens.color.slateSoft,
                                                    fontFamily: tokens.font.mono,
                                                    padding: '2px 8px',
                                                    borderRadius: tokens.radius.pill,
                                                    fontSize: 11, fontWeight: 700,
                                                }}>{t.estimate_points ?? '?'}</span>
                                            </td>
                                            <td style={{ ...td, fontSize: 11, fontFamily: tokens.font.mono, color: tokens.color.textMuted }}>
                                                {Array.isArray(t.files_likely_touched) ? t.files_likely_touched.slice(0, 3).map((f: string, fi: number) => (
                                                    <div key={fi}>{f}</div>
                                                )) : null}
                                                {Array.isArray(t.files_likely_touched) && t.files_likely_touched.length > 3 ? (
                                                    <div style={{ color: tokens.color.textSubtle }}>+{t.files_likely_touched.length - 3} more</div>
                                                ) : null}
                                            </td>
                                            <td style={{ ...td, fontSize: 11, fontFamily: tokens.font.mono }}>
                                                {Array.isArray(t.dependencies) ? t.dependencies.join(', ') : null}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </>,
                            500
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Renders the live agent attempt history (validation → sandbox install/typecheck/
 * build/test → retry → PR). Shared between solo `finalizeImplementation` runs and
 * the per-ticket live view inside a multi-ticket sprint.
 */
function AgentAttemptHistory({ agent }: { agent: any }) {
    if (!agent || !Array.isArray(agent.attempt_history) || agent.attempt_history.length === 0) {
        return null;
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {agent.attempt_history.map((h: any, i: number) => {
                const sb = h.sandbox;
                return (
                    <div key={i} style={{
                        background: 'white',
                        border: `1px solid ${h.valid ? tokens.color.successSoft : tokens.color.warningSoft}`,
                        borderRadius: tokens.radius.sm,
                        padding: '8px 12px', fontSize: 12,
                    }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: tokens.font.mono, color: tokens.color.textMuted }}>#{h.attempt}</span>
                            {pill(h.valid ? 'valid' : 'invalid', h.valid ? 'green' : 'amber')}
                            {h.branch_name ? (
                                <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.color.primary }}>{h.branch_name}</span>
                            ) : null}
                            {typeof h.files_count === 'number' ? (
                                <span style={{ fontSize: 11, color: tokens.color.textMuted }}>· {h.files_count} files</span>
                            ) : null}
                            {sb ? (
                                sb.ran
                                    ? pill(
                                        `tests: ${sb.passed ? 'pass' : 'fail'}${typeof sb.test_count === 'number' ? ` ${(sb.test_count - (sb.failure_count || 0))}/${sb.test_count}` : ''}`,
                                        sb.passed ? 'green' : 'red',
                                    )
                                    : pill(`tests: ${sb.note || 'skipped'}`, 'gray')
                            ) : null}
                        </div>
                        {!h.valid && Array.isArray(h.errors) && h.errors.length > 0 ? (
                            <ul style={{ margin: '6px 0 0 0', paddingLeft: 18, color: tokens.color.danger }}>
                                {h.errors.slice(0, 5).map((e: any, ei: number) => (
                                    <li key={ei}><code>{e.code}</code> {String(e.message).slice(0, 280)}</li>
                                ))}
                            </ul>
                        ) : null}
                        {sb && sb.ran && !sb.passed && (sb.stdout_tail || sb.stderr_tail) ? (
                            <details style={{ marginTop: 6 }}>
                                <summary style={{ cursor: 'pointer', fontSize: 11, color: tokens.color.textMuted }}>
                                    view test output
                                </summary>
                                <pre style={{
                                    marginTop: 4, padding: 8,
                                    background: '#0f172a', color: '#e2e8f0',
                                    borderRadius: tokens.radius.sm,
                                    fontSize: 11, fontFamily: tokens.font.mono,
                                    overflowX: 'auto', maxHeight: 220,
                                    whiteSpace: 'pre-wrap',
                                }}>{(sb.stdout_tail || '') + (sb.stderr_tail ? `\n--- stderr ---\n${sb.stderr_tail}` : '')}</pre>
                            </details>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

const AGENT_STATUS_LABEL: Record<string, string> = {
    calling_dify:         'Calling Dify for implementation…',
    calling_agent:        'Starting agent…',
    'agent:exploring':    'Exploring codebase…',
    'agent:writing':      'Writing code…',
    'agent:testing':      'Running tests…',
    'agent:fixing':       'Fixing errors…',
    'agent:finishing':    'Finalising implementation…',
    validating:           'Validating output…',
    'sandbox:install':    'Sandbox: installing dependencies…',
    'sandbox:typecheck':  'Sandbox: type-checking…',
    'sandbox:build':      'Sandbox: building…',
    'sandbox:test':       'Sandbox: running unit tests…',
    'sandbox:smoke':      'Sandbox: smoke-starting app…',
    retrying:             'Retrying with feedback…',
    creating_pr:          'Creating GitHub branch + PR…',
};

// ── Agent-mode stepper (GPT / Claude path) ─────────────────────────────────
const AGENT_GATE_STEPS: Array<{ key: string; label: string }> = [
    { key: 'exploring', label: 'explore' },
    { key: 'writing',   label: 'write'   },
    { key: 'testing',   label: 'test'    },
    { key: 'fixing',    label: 'fix'     },
    { key: 'finishing', label: 'finish'  },
    { key: 'validate',  label: 'validate'},
    { key: 'pr',        label: 'PR'      },
];

const AGENT_STATUS_TO_STEP: Record<string, string> = {
    calling_agent:       'exploring',
    'agent:exploring':   'exploring',
    'agent:writing':     'writing',
    'agent:testing':     'testing',
    'agent:fixing':      'fixing',
    'agent:finishing':   'finishing',
    validating:          'validate',
    'sandbox:install':   'validate',
    'sandbox:typecheck': 'validate',
    'sandbox:build':     'validate',
    'sandbox:test':      'validate',
    'sandbox:smoke':     'validate',
    creating_pr:         'pr',
    done:                '_done_',
};

// ── Dify-mode stepper (legacy fallback) ────────────────────────────────────
const DIFY_GATE_STEPS: Array<{ key: string; label: string }> = [
    { key: 'dify',      label: 'Dify'    },
    { key: 'install',   label: 'install' },
    { key: 'typecheck', label: 'tsc'     },
    { key: 'build',     label: 'build'   },
    { key: 'test',      label: 'test'    },
    { key: 'smoke',     label: 'smoke'   },
    { key: 'pr',        label: 'PR'      },
];

const DIFY_STATUS_TO_STEP: Record<string, string> = {
    calling_dify:        'dify',
    validating:          'dify',
    retrying:            'dify',
    'sandbox:install':   'install',
    'sandbox:typecheck': 'typecheck',
    'sandbox:build':     'build',
    'sandbox:test':      'test',
    'sandbox:smoke':     'smoke',
    creating_pr:         'pr',
    done:                '_done_',
};

function isAgentPath(status: string | null | undefined): boolean {
    if (!status) return false;
    return status === 'calling_agent' || status.startsWith('agent:');
}

function gateStateForStep(
    stepKey: string,
    status: string | null | undefined,
    steps: Array<{ key: string }>,
    statusToStep: Record<string, string>,
): 'pending' | 'active' | 'done' {
    if (!status || status === 'failed') return 'pending';
    const activeStep = statusToStep[status];
    if (activeStep === '_done_') return 'done';
    if (!activeStep) return 'pending';
    const order = steps.map(s => s.key);
    const stepIdx = order.indexOf(stepKey);
    const activeIdx = order.indexOf(activeStep);
    if (stepIdx < activeIdx) return 'done';
    if (stepIdx === activeIdx) return 'active';
    return 'pending';
}

function GateStepper({ status }: { status: string | null | undefined }) {
    const useAgent = isAgentPath(status)
        || (status != null && !['calling_dify', 'retrying'].includes(status)
            && !status.startsWith('sandbox:'));
    const steps      = useAgent ? AGENT_GATE_STEPS : DIFY_GATE_STEPS;
    const statusMap  = useAgent ? AGENT_STATUS_TO_STEP : DIFY_STATUS_TO_STEP;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            marginTop: 10, marginBottom: 4, flexWrap: 'wrap',
        }}>
            {steps.map((step, i) => {
                const s = gateStateForStep(step.key, status, steps, statusMap);
                const bg    = s === 'done' ? tokens.color.successSoft  : s === 'active' ? tokens.color.primarySoft  : tokens.color.slateSoft;
                const fg    = s === 'done' ? '#166534'                 : s === 'active' ? tokens.color.primary      : tokens.color.textSubtle;
                const dotBg = s === 'done' ? tokens.color.success      : s === 'active' ? tokens.color.primary      : tokens.color.borderStrong;
                return (
                    <React.Fragment key={step.key}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '3px 8px', borderRadius: tokens.radius.pill,
                            background: bg,
                            border: s === 'active' ? `1px solid ${tokens.color.primary}55` : '1px solid transparent',
                        }}>
                            <span className={s === 'active' ? 'pl-pulse' : ''} style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: dotBg, display: 'inline-block',
                            }} />
                            <span style={{ fontSize: 11, color: fg, fontWeight: s === 'active' ? 600 : 500 }}>
                                {s === 'done' ? '✓ ' : ''}{step.label}
                            </span>
                        </div>
                        {i < steps.length - 1 ? (
                            <span style={{ color: tokens.color.borderStrong, fontSize: 10 }}>›</span>
                        ) : null}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

/**
 * Live "current ticket" banner — shows what the sprint runner is doing right
 * now (which ticket, which attempt, which sandbox gate).
 */
function SprintLiveProgress({ sprint, agent, runId }: { sprint: any; agent: any; runId?: string }) {
    const ct = sprint?.current_ticket;
    if (!ct) return null;
    const status: string | null = agent?.status ?? null;
    const liveStatus = status && status !== 'done' && status !== 'failed' ? status : null;
    const attemptNum = agent?.attempts ?? 1;
    const inSandbox   = typeof status === 'string' && status.startsWith('sandbox:');
    const inAgentLoop = typeof status === 'string' && (status.startsWith('agent:') || status === 'calling_agent');
    const showLog     = inSandbox || inAgentLoop;
    const currentTurn = agent?.current_turn ?? null;
    const maxTurns    = agent?.max_turns ?? null;
    const progress = ct.total > 0 ? Math.round(((ct.index - 1) / ct.total) * 100) : 0;

    return (
        <div className="pl-fade-in" style={{
            marginBottom: 16,
            borderRadius: tokens.radius.lg,
            overflow: 'hidden',
            border: `1px solid ${tokens.color.primary}33`,
            boxShadow: `0 4px 16px ${tokens.color.primary}11`,
        }}>
            {/* Header */}
            <div style={{
                padding: '12px 16px',
                background: `linear-gradient(135deg, ${tokens.color.primary}18 0%, ${tokens.color.primarySoft} 100%)`,
                borderBottom: `1px solid ${tokens.color.primary}22`,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
                <span className="pl-pulse" style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: tokens.color.primary, flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: tokens.color.text }}>
                            Ticket {ct.index} of {ct.total}
                        </span>
                        <code style={{
                            fontSize: 12, fontFamily: tokens.font.mono,
                            background: tokens.color.primary + '22', color: tokens.color.primary,
                            padding: '1px 7px', borderRadius: tokens.radius.pill,
                        }}>{ct.id}</code>
                        <span style={{ fontSize: 11, color: tokens.color.textMuted }}>
                            attempt {attemptNum}/3
                        </span>
                        {currentTurn != null ? (
                            <span style={{
                                fontSize: 11, color: tokens.color.textMuted,
                                fontFamily: tokens.font.mono,
                            }}>
                                · turn {currentTurn}{maxTurns ? `/${maxTurns}` : ''}
                            </span>
                        ) : null}
                    </div>
                    {ct.title ? (
                        <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ct.title}
                        </div>
                    ) : null}
                </div>
                {liveStatus ? (
                    <div style={{
                        fontSize: 11, color: tokens.color.primary, fontWeight: 600,
                        background: 'white', padding: '3px 10px', borderRadius: tokens.radius.pill,
                        border: `1px solid ${tokens.color.primary}33`,
                    }}>
                        {AGENT_STATUS_LABEL[liveStatus] || liveStatus}
                    </div>
                ) : null}
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: tokens.color.slateSoft }}>
                <div style={{
                    height: '100%', width: `${progress}%`,
                    background: `linear-gradient(90deg, ${tokens.color.primary}, ${tokens.color.primary}bb)`,
                    transition: 'width 0.6s ease',
                }} />
            </div>

            {/* Gate stepper */}
            <div style={{ padding: '10px 16px', background: 'white' }}>
                <GateStepper status={status} />
            </div>

            {/* Agent / sandbox log — shown while running and persistently after */}
            {runId ? (
                <div style={{ padding: '0 12px 12px' }}>
                    <DeploymentLogs
                        runId={runId}
                        enabled={showLog}
                        source="sandbox"
                        label={inAgentLoop ? 'Agent tool log' : 'Live sandbox output'}
                        height={260}
                        defaultExpanded={false}
                    />
                </div>
            ) : null}

            {/* Attempt history */}
            {agent && Array.isArray(agent.attempt_history) && agent.attempt_history.length > 0 ? (
                <div style={{ padding: '0 12px 12px' }}>
                    <AgentAttemptHistory agent={agent} />
                </div>
            ) : null}
        </div>
    );
}

function FailedTicketErrors({ errors }: { errors: any[] }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div style={{ fontSize: 11, color: tokens.color.danger, marginTop: 4 }}>
            {errors.map((e: any, ei: number) => {
                const msg = String(e.message ?? '');
                const isLong = msg.length > 220;
                const shown = expanded || !isLong ? msg : msg.slice(0, 220) + '…';
                return (
                    <div key={ei} style={{ marginBottom: 4 }}>
                        <code style={{ background: tokens.color.dangerSoft, padding: '0 4px', borderRadius: 3 }}>{e.code}</code>{' '}
                        <span style={{
                            whiteSpace: expanded ? 'pre-wrap' : 'normal',
                            wordBreak: 'break-word',
                            fontFamily: expanded ? tokens.font.mono : tokens.font.body,
                        }}>{shown}</span>
                    </div>
                );
            })}
            {errors.some((e: any) => String(e.message ?? '').length > 220) ? (
                <button
                    onClick={() => setExpanded(v => !v)}
                    style={{
                        background: 'transparent', border: 'none',
                        color: tokens.color.primary, cursor: 'pointer',
                        fontSize: 11, padding: 0, marginTop: 2,
                    }}
                >
                    {expanded ? '▾ Show less' : '▸ Show full error'}
                </button>
            ) : null}
        </div>
    );
}

type OutcomeStatus = 'shipped' | 'ready' | 'blocked' | 'failed';
function classifyOutcome(o: any): OutcomeStatus {
    if (o?.pr_url) return 'shipped';
    if (o?.skipped) return 'blocked';
    const hasImpl = !!o?.implementation_json;
    const errs = Array.isArray(o?.final_errors) ? o.final_errors : [];
    if (hasImpl && errs.length === 0) return 'ready';
    return 'failed';
}

const OUTCOME_STYLE: Record<OutcomeStatus, {
    border: string; bg: string; headerBg: string;
    idColor: string; label: string; labelBg: string; labelFg: string;
}> = {
    shipped: {
        border: '#86efac', bg: '#f0fdf4', headerBg: '#dcfce7',
        idColor: '#166534', label: 'shipped', labelBg: '#dcfce7', labelFg: '#166534',
    },
    ready: {
        border: '#93c5fd', bg: '#eff6ff', headerBg: '#dbeafe',
        idColor: tokens.color.primary, label: 'ready', labelBg: '#dbeafe', labelFg: tokens.color.primary,
    },
    failed: {
        border: '#fca5a5', bg: '#fff1f2', headerBg: '#fee2e2',
        idColor: '#dc2626', label: 'failed', labelBg: '#fee2e2', labelFg: '#991b1b',
    },
    blocked: {
        border: tokens.color.border, bg: '#f8fafc', headerBg: tokens.color.slateSoft,
        idColor: tokens.color.textMuted, label: 'blocked', labelBg: tokens.color.slateSoft, labelFg: tokens.color.textMuted,
    },
};

function TicketCard({ outcome, runId }: { outcome: any; runId?: string }) {
    const status = classifyOutcome(outcome);
    const sty = OUTCOME_STYLE[status];
    const [expanded, setExpanded] = useState(false);
    const [retryError, setRetryError] = useState<string | null>(null);
    const { retryTicket, loading: retryLoading } = useRetryTicket();
    const errors: any[] = Array.isArray(outcome.final_errors) ? outcome.final_errors : [];
    const isRetrying = outcome._retrying || retryLoading === outcome.ticket_id;

    return (
        <div style={{
            border: `1.5px solid ${sty.border}`,
            borderRadius: tokens.radius.md,
            background: sty.bg,
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            transition: 'box-shadow 0.15s',
        }}>
            {/* Card header */}
            <div style={{
                padding: '8px 12px',
                background: sty.headerBg,
                borderBottom: `1px solid ${sty.border}`,
                display: 'flex', alignItems: 'center', gap: 8,
            }}>
                <code style={{
                    fontSize: 11, fontFamily: tokens.font.mono,
                    color: sty.idColor, fontWeight: 700, flex: 1,
                }}>{outcome.ticket_id}</code>
                <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.05em', padding: '2px 7px',
                    background: sty.labelBg, color: sty.labelFg,
                    borderRadius: tokens.radius.pill,
                    border: `1px solid ${sty.border}`,
                }}>{sty.label}</span>
            </div>

            {/* Card body */}
            <div style={{ padding: '10px 12px', flex: 1 }}>
                <div style={{
                    fontSize: 12, fontWeight: 600, color: tokens.color.text,
                    lineHeight: 1.4, marginBottom: 6,
                }}>
                    {outcome.title}
                </div>

                {typeof outcome.attempts === 'number' ? (
                    <div style={{ fontSize: 11, color: tokens.color.textMuted, marginBottom: 4 }}>
                        {outcome.attempts} attempt{outcome.attempts === 1 ? '' : 's'}
                    </div>
                ) : null}

                {outcome.skipped ? (
                    <div style={{ fontSize: 11, color: tokens.color.textMuted, fontStyle: 'italic' }}>
                        {outcome.skipped}
                    </div>
                ) : null}

                {(status === 'failed' || isRetrying) && errors.length > 0 ? (
                    <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginBottom: 4 }}>
                            {errors[0]?.code && (
                                <code style={{
                                    background: '#fee2e2', padding: '1px 5px',
                                    borderRadius: 3, marginRight: 4,
                                }}>{errors[0].code}</code>
                            )}
                            {String(errors[0]?.message ?? '').slice(0, expanded ? 600 : 120)}
                            {!expanded && String(errors[0]?.message ?? '').length > 120 ? '…' : ''}
                        </div>
                        {String(errors[0]?.message ?? '').length > 120 ? (
                            <button
                                onClick={() => setExpanded(v => !v)}
                                style={{
                                    background: 'transparent', border: 'none',
                                    color: '#dc2626', cursor: 'pointer',
                                    fontSize: 11, padding: 0,
                                }}
                            >{expanded ? '▾ less' : '▸ more'}</button>
                        ) : null}
                    </div>
                ) : null}

                {status === 'failed' && runId ? (
                    <div style={{ marginTop: 8 }}>
                        <button
                            disabled={isRetrying}
                            onClick={async () => {
                                setRetryError(null);
                                try {
                                    await retryTicket(runId, outcome.ticket_id);
                                } catch (e) {
                                    setRetryError((e as Error).message);
                                }
                            }}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                fontSize: 11, fontWeight: 600,
                                padding: '4px 10px', borderRadius: 6,
                                background: isRetrying ? '#fef2f2' : '#fff',
                                border: '1.5px solid #dc2626',
                                color: '#dc2626', cursor: isRetrying ? 'default' : 'pointer',
                                opacity: isRetrying ? 0.7 : 1,
                            }}
                        >
                            {isRetrying ? '⟳ Retrying…' : '↻ Retry'}
                        </button>
                        {retryError && (
                            <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{retryError}</div>
                        )}
                    </div>
                ) : null}

                {isRetrying && runId ? (
                    <div style={{ marginTop: 8 }}>
                        <DeploymentLogs
                            runId={runId}
                            enabled={true}
                            source="sandbox"
                            label="Retry agent log"
                            height={180}
                        />
                    </div>
                ) : null}

                {status === 'shipped' && outcome.pr_url ? (
                    <a href={outcome.pr_url} target="_blank" rel="noreferrer" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, color: '#166534', fontWeight: 600,
                        textDecoration: 'none', marginTop: 4,
                    }}>
                        🐙 PR #{outcome.pr_number} ↗
                    </a>
                ) : null}

                {status === 'ready' && Array.isArray(outcome.implementation_json?.files_changed) ? (
                    <div style={{ fontSize: 11, color: tokens.color.textMuted, marginTop: 4 }}>
                        {outcome.implementation_json.files_changed.length} files changed
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function SprintImplementationViz({ sprint, agent, runId }: { sprint: any; agent?: any; runId?: string }) {
    const outcomes: any[] = Array.isArray(sprint?.outcomes) ? sprint.outcomes : [];
    const scaffold = sprint?.scaffold;
    const shipped = outcomes.filter(o => classifyOutcome(o) === 'shipped').length;
    const ready   = outcomes.filter(o => classifyOutcome(o) === 'ready').length;
    const failed  = outcomes.filter(o => classifyOutcome(o) === 'failed').length;
    const blocked = outcomes.filter(o => classifyOutcome(o) === 'blocked').length;
    const isLive  = !!sprint?.current_ticket;
    const total   = outcomes.length;
    const done    = shipped + ready;

    const GROUPS: Array<{ key: OutcomeStatus; label: string; icon: string }> = [
        { key: 'failed',  label: 'Failed',  icon: '✕' },
        { key: 'blocked', label: 'Blocked', icon: '⊘' },
        { key: 'ready',   label: 'Ready to push', icon: '●' },
        { key: 'shipped', label: 'On GitHub', icon: '🐙' },
    ];

    return (
        <div>
            <SprintLiveProgress sprint={sprint} agent={agent} runId={runId} />

            {/* Summary bar */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8, marginBottom: 14,
            }}>
                {[
                    { count: ready,   label: 'Ready',   color: tokens.color.primary, bg: tokens.color.primarySoft },
                    { count: shipped, label: 'Shipped',  color: tokens.color.success, bg: tokens.color.successSoft },
                    { count: failed,  label: 'Failed',   color: tokens.color.danger,  bg: tokens.color.dangerSoft  },
                    { count: blocked, label: 'Blocked',  color: tokens.color.textMuted, bg: tokens.color.slateSoft },
                ].map(({ count, label, color, bg }) => (
                    <div key={label} style={{
                        padding: '10px 12px', borderRadius: tokens.radius.md,
                        background: bg, textAlign: 'center',
                    }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                        <div style={{ fontSize: 10, color, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                            {label}
                        </div>
                    </div>
                ))}
            </div>

            {/* Progress bar — only shown when total > 0 */}
            {total > 0 ? (
                <div style={{ marginBottom: 14 }}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: 11, color: tokens.color.textMuted, marginBottom: 4,
                    }}>
                        <span>{isLive ? 'In progress…' : 'Completed'}</span>
                        <span>{done}/{total} tickets done</span>
                    </div>
                    <div style={{ height: 6, background: tokens.color.slateSoft, borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{
                            height: '100%',
                            width: `${total > 0 ? (done / total) * 100 : 0}%`,
                            background: failed > 0
                                ? `linear-gradient(90deg, ${tokens.color.success} ${(shipped / total) * 100}%, ${tokens.color.primary} ${(shipped / total) * 100}%)`
                                : tokens.color.success,
                            transition: 'width 0.5s ease',
                            borderRadius: 99,
                        }} />
                    </div>
                </div>
            ) : null}

            {scaffold && scaffold.pr_url ? (
                <a href={scaffold.pr_url} target="_blank" rel="noreferrer" style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', marginBottom: 12,
                    background: '#0f172a', color: 'white',
                    borderRadius: tokens.radius.md, textDecoration: 'none', fontSize: 13,
                }}>
                    <span style={{ fontSize: 18 }}>🏗️</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>Scaffold PR #{scaffold.pr_number}: {scaffold.template_id}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {scaffold.files_count} files · <code style={{ fontFamily: tokens.font.mono }}>{scaffold.branch_name}</code>
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>open ↗</span>
                </a>
            ) : null}

            {/* Ticket cards grouped by status */}
            {GROUPS.map(({ key, label, icon }) => {
                const group = outcomes.filter(o => classifyOutcome(o) === key);
                if (group.length === 0) return null;
                const sty = OUTCOME_STYLE[key];
                return (
                    <div key={key} style={{ marginBottom: 14 }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                        }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: sty.idColor }}>{icon}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: tokens.color.text }}>{label}</span>
                            <span style={{
                                fontSize: 11, background: sty.headerBg, color: sty.idColor,
                                padding: '1px 8px', borderRadius: tokens.radius.pill,
                                fontWeight: 600,
                            }}>{group.length}</span>
                        </div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: 8,
                        }}>
                            {group.map((o, i) => <TicketCard key={i} outcome={o} runId={runId} />)}
                        </div>
                    </div>
                );
            })}

            {/* File manager — shown when run has generated code and is not actively live */}
            {runId && !isLive ? <FileManagerSection runId={runId} /> : null}
        </div>
    );
}

function FileManagerSection({ runId }: { runId: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ marginTop: 16 }}>
            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', textAlign: 'left',
                    padding: '10px 14px',
                    background: open ? '#0f172a' : tokens.color.slateSoft,
                    border: `1px solid ${open ? '#1e293b' : tokens.color.border}`,
                    borderRadius: open ? `${tokens.radius.md} ${tokens.radius.md} 0 0` : tokens.radius.md,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                }}
            >
                <span style={{ fontSize: 14 }}>📂</span>
                <span style={{
                    flex: 1, fontSize: 13, fontWeight: 600,
                    color: open ? '#e2e8f0' : tokens.color.text,
                }}>
                    Source Files
                </span>
                <span style={{
                    fontSize: 11,
                    color: open ? '#64748b' : tokens.color.textMuted,
                    fontFamily: tokens.font.mono,
                }}>
                    {open ? '▾ collapse' : '▸ browse code'}
                </span>
            </button>
            {open ? (
                <div style={{ borderRadius: `0 0 ${tokens.radius.md} ${tokens.radius.md}`, overflow: 'hidden' }}>
                    <FileManager runId={runId} />
                </div>
            ) : null}
        </div>
    );
}

function ImplementationViz({ json, agent, sprint, runId }: { json: any; agent?: any; sprint?: any; runId?: string }) {
    // Multi-ticket sprint mode: backend returned outcomes array. Render sprint view.
    if (sprint && Array.isArray(sprint.outcomes)) {
        return <SprintImplementationViz sprint={sprint} agent={agent} runId={runId} />;
    }
    const liveStatus: string | null = agent?.status && agent.status !== 'done' && agent.status !== 'failed' ? agent.status : null;
    const currentTurn: number | null = agent?.current_turn ?? null;
    const maxTurns: number | null    = agent?.max_turns ?? null;
    const inAgentLoop = typeof liveStatus === 'string' && (liveStatus.startsWith('agent:') || liveStatus === 'calling_agent');
    return (
        <div>
            {liveStatus ? (
                <div className="pl-fade-in" style={{
                    marginBottom: 10, borderRadius: tokens.radius.md, overflow: 'hidden',
                    border: `1px solid ${tokens.color.primary}33`,
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        background: `linear-gradient(90deg, ${tokens.color.primarySoft}, ${tokens.color.card} 80%)`,
                    }}>
                        <span className="pl-pulse" style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: tokens.color.primary, display: 'inline-block', flexShrink: 0,
                        }} />
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: tokens.color.primary }}>
                            {AGENT_STATUS_LABEL[liveStatus] || liveStatus}
                        </span>
                        {currentTurn != null ? (
                            <span style={{
                                fontSize: 11, color: tokens.color.textMuted,
                                fontFamily: tokens.font.mono,
                                background: 'white', padding: '2px 8px',
                                borderRadius: tokens.radius.pill,
                                border: `1px solid ${tokens.color.border}`,
                            }}>
                                turn {currentTurn}{maxTurns ? `/${maxTurns}` : ''}
                            </span>
                        ) : null}
                    </div>
                    <GateStepper status={liveStatus} />
                    {inAgentLoop && runId ? (
                        <div style={{ padding: '0 4px 8px' }}>
                            <DeploymentLogs runId={runId} enabled={true} source="sandbox" label="Agent tool log" height={260} />
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* Persistent agent log — visible after completion when no liveStatus */}
            {!liveStatus && runId ? (
                <div style={{ marginBottom: 10 }}>
                    <DeploymentLogs runId={runId} enabled={false} source="sandbox" label="Agent tool log" height={220} />
                </div>
            ) : null}

            {/* Agent retry history if present */}
            {agent && Array.isArray(agent.attempt_history) && agent.attempt_history.length > 0 ? (
                <>
                    {sectionTitle('Agent attempts', agent.attempts)}
                    <AgentAttemptHistory agent={agent} />
                </>
            ) : null}

            {/* PR link card */}
            {agent?.pr_url ? (
                <a
                    href={agent.pr_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        background: '#0f172a', color: 'white',
                        borderRadius: tokens.radius.md,
                        textDecoration: 'none',
                        marginBottom: 12,
                        fontSize: 13,
                    }}
                >
                    <span style={{ fontSize: 18 }}>🐙</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>Draft PR #{agent.pr_number} on GitHub</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: tokens.font.mono }}>{agent.branch_name}</div>
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>open ↗</span>
                </a>
            ) : null}

            {/* Files changed */}
            {Array.isArray(json.files_changed) && json.files_changed.length > 0 ? (
                <>
                    {sectionTitle('Files changed', json.files_changed.length)}
                    {tableShell(
                        <>
                            <thead><tr>
                                <th style={{ ...th, width: 90 }}>Action</th>
                                <th style={th}>Path</th>
                                <th style={th}>Why</th>
                            </tr></thead>
                            <tbody>
                                {json.files_changed.map((f: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={td}>{pill(f.action || 'create', f.action === 'delete' ? 'red' : f.action === 'modify' ? 'amber' : 'green')}</td>
                                        <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 12, color: tokens.color.primary }}>{f.path}</td>
                                        <td style={{ ...td, fontSize: 12, color: tokens.color.textMuted }}>{f.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </>
                    )}
                </>
            ) : null}

            {/* Self review */}
            {Array.isArray(json.self_review_notes) && json.self_review_notes.length > 0 ? (
                <>
                    {sectionTitle('Self review notes', json.self_review_notes.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.text }}>
                        {json.self_review_notes.map((n: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}
                    </ul>
                </>
            ) : null}

            {/* File manager */}
            {runId && !liveStatus ? <FileManagerSection runId={runId} /> : null}
        </div>
    );
}

function TestViz({ json }: { json: any }) {
    const status = (json.ci_status as string) || 'unknown';
    const statusColor: 'green' | 'red' | 'amber' = status === 'passed' ? 'green' : status === 'failed' ? 'red' : 'amber';

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>CI status:</span>
                {pill(status, statusColor)}
                {json.ci_run_id ? (
                    <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.color.textMuted }}>{json.ci_run_id}</span>
                ) : null}
            </div>

            {Array.isArray(json.pass_fail_matrix) && json.pass_fail_matrix.length > 0 ? (
                <>
                    {sectionTitle('Test suites')}
                    {tableShell(
                        <>
                            <thead><tr>
                                <th style={th}>Suite</th>
                                <th style={{ ...th, textAlign: 'right' }}>Passed</th>
                                <th style={{ ...th, textAlign: 'right' }}>Failed</th>
                                <th style={{ ...th, textAlign: 'right' }}>Skipped</th>
                            </tr></thead>
                            <tbody>
                                {json.pass_fail_matrix.map((row: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 12 }}>{row.suite}</td>
                                        <td style={{ ...td, textAlign: 'right', color: tokens.color.success, fontWeight: 600 }}>{row.passed}</td>
                                        <td style={{ ...td, textAlign: 'right', color: row.failed ? tokens.color.danger : tokens.color.textMuted, fontWeight: row.failed ? 600 : 400 }}>{row.failed}</td>
                                        <td style={{ ...td, textAlign: 'right', color: tokens.color.textMuted }}>{row.skipped}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </>
                    )}
                </>
            ) : null}

            {Array.isArray(json.acceptance_criteria_coverage) && json.acceptance_criteria_coverage.length > 0 ? (
                <>
                    {sectionTitle('Acceptance criteria coverage', json.acceptance_criteria_coverage.length)}
                    {tableShell(
                        <>
                            <thead><tr>
                                <th style={th}>Criterion</th>
                                <th style={{ ...th, width: 100 }}>Status</th>
                                <th style={th}>Tests covering</th>
                            </tr></thead>
                            <tbody>
                                {json.acceptance_criteria_coverage.map((c: any, i: number) => (
                                    <tr key={i} className="pl-row">
                                        <td style={td}>{c.criterion}</td>
                                        <td style={td}>{pill(c.status || 'unknown', c.status === 'covered' ? 'green' : c.status === 'partial' ? 'amber' : 'red')}</td>
                                        <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 11, color: tokens.color.textMuted }}>
                                            {Array.isArray(c.covered_by) ? c.covered_by.join(', ') : ''}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </>
                    )}
                </>
            ) : null}

            {Array.isArray(json.uncovered_criteria) && json.uncovered_criteria.length > 0 ? (
                <>
                    {sectionTitle('Uncovered criteria', json.uncovered_criteria.length)}
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: tokens.color.danger }}>
                        {json.uncovered_criteria.map((c: string, i: number) => <li key={i}>{c}</li>)}
                    </ul>
                </>
            ) : null}
        </div>
    );
}

// ─── Public dispatcher ────────────────────────────────────────────────────────

interface Props {
    stage: Stage;
    artifactJson: any;
    runId?: string;
}

export function StageVisualization({ stage, artifactJson, runId }: Props) {
    if (!artifactJson || typeof artifactJson !== 'object') return null;

    // The artifact_json envelope is { answer, parsed, usage, agent }. The
    // "parsed" key holds the actual structured Dify output. Older runs may
    // store the parsed object at the top level, so support both.
    const parsed = artifactJson.parsed && typeof artifactJson.parsed === 'object'
        ? artifactJson.parsed
        : artifactJson;
    const agent = artifactJson.agent ?? null;

    const inner = (() => {
        switch (stage) {
            case 'requirements':   return <RequirementsViz json={parsed} />;
            case 'optimize':       return <OptimizeViz json={parsed} />;
            case 'plan':           return <PlanViz json={parsed} />;
            case 'design':         return <DesignViz json={parsed} />;
            case 'sprint':         return <SprintViz json={parsed} />;
            case 'implementation': return <ImplementationViz json={parsed} agent={agent} sprint={artifactJson.sprint} runId={runId} />;
            case 'test':           return <TestViz json={parsed} />;
            default:               return null;
        }
    })();

    if (!inner) return null;
    return <div style={{ marginTop: 14 }}>{inner}</div>;
}
