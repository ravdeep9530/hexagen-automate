import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { tokens } from '../features/pipelines/design';
import { updatePlanArtifact, createChangeRequest, StageApprovedError } from '../api/pipelinesApi';

const API_URL = process.env.REACT_APP_API_URL || '/api';

interface AffectedRepo { repo: string; reason: string; }
interface Phase { name: string; description: string; depends_on_phases: string[]; }
interface Milestone { name: string; phase: string; acceptance: string; }

interface PlanDraft {
    affected_repos: AffectedRepo[];
    phases: Phase[];
    milestones: Milestone[];
    blockers: string[];
    estimated_team_size: number | '';
}

function emptyDraft(): PlanDraft {
    return { affected_repos: [], phases: [], milestones: [], blockers: [], estimated_team_size: '' };
}

function toDraft(json: any): PlanDraft {
    return {
        affected_repos: Array.isArray(json?.affected_repos)
            ? json.affected_repos.map((r: any) => ({ repo: r.repo ?? '', reason: r.reason ?? '' }))
            : [],
        phases: Array.isArray(json?.phases)
            ? json.phases.map((p: any) => ({
                name: p.name ?? '',
                description: p.description ?? '',
                depends_on_phases: Array.isArray(p.depends_on_phases) ? p.depends_on_phases : [],
            }))
            : [],
        milestones: Array.isArray(json?.milestones)
            ? json.milestones.map((m: any) => ({ name: m.name ?? '', phase: m.phase ?? '', acceptance: m.acceptance ?? '' }))
            : [],
        blockers: Array.isArray(json?.blockers) ? json.blockers.map((b: any) => String(b)) : [],
        estimated_team_size: typeof json?.estimated_team_size === 'number' ? json.estimated_team_size : '',
    };
}

function fromDraft(draft: PlanDraft): object {
    const out: any = { ...draft };
    if (draft.estimated_team_size === '') delete out.estimated_team_size;
    // normalise depends_on_phases stored as comma-split strings back to arrays
    out.phases = draft.phases.map(p => ({ ...p }));
    return out;
}

// ── Shared input styles ────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
    padding: '6px 9px',
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.sm,
    fontSize: 13,
    fontFamily: tokens.font.body,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
};
const monoInputStyle: React.CSSProperties = { ...inputStyle, fontFamily: tokens.font.mono };
const taStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 52 };

function SectionHeader({ title, count }: { title: string; count?: number }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.color.textMuted }}>
                {title}
            </span>
            {count !== undefined ? (
                <span style={{
                    fontSize: 11, fontWeight: 600, color: tokens.color.primary,
                    background: tokens.color.primarySoft, borderRadius: tokens.radius.pill,
                    padding: '1px 7px',
                }}>
                    {count}
                </span>
            ) : null}
        </div>
    );
}

function AddRowButton({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            style={{
                marginTop: 8, background: 'transparent', border: `1px dashed ${tokens.color.border}`,
                color: tokens.color.primary, borderRadius: tokens.radius.sm,
                padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
            }}
        >
            + {label}
        </button>
    );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            title="Remove"
            style={{
                flexShrink: 0, background: 'transparent', border: 'none',
                color: tokens.color.textSubtle, cursor: 'pointer',
                fontSize: 16, lineHeight: 1, padding: '4px 6px',
                borderRadius: tokens.radius.sm,
            }}
        >
            ×
        </button>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
    runId: string;
    onBack: () => void;
}

export function PlannerScreen({ runId, onBack }: Props) {
    const [draft, setDraft] = useState<PlanDraft>(emptyDraft());
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);
    const [stageApproved, setStageApproved] = useState(false);
    const [crCreated, setCrCreated] = useState(false);
    const [noStageYet, setNoStageYet] = useState(false);

    useEffect(() => {
        let cancelled = false;
        axios.get(`${API_URL}/pipelines/${runId}`)
            .then(r => {
                if (cancelled) return;
                const stages: any[] = r.data?.stages ?? [];
                const planStage = stages.find((s: any) => s.stage === 'plan');
                if (!planStage || !planStage.artifact_json) {
                    setNoStageYet(true);
                    setLoading(false);
                    return;
                }
                const rawArtifact = planStage.artifact_json as any;
                let planData: any = {};
                if (rawArtifact?.parsed && typeof rawArtifact.parsed === 'object') {
                    planData = rawArtifact.parsed;
                } else if (rawArtifact?.answer && typeof rawArtifact.answer === 'string') {
                    try { planData = JSON.parse(rawArtifact.answer); } catch { planData = rawArtifact; }
                } else {
                    planData = rawArtifact;
                }
                setDraft(toDraft(planData));
                setStageApproved(planStage?.status === 'approved');
                setLoading(false);
            })
            .catch(e => {
                if (cancelled) return;
                setLoadError(e?.response?.data?.error ?? e.message ?? 'Failed to load plan');
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [runId]);

    function update(fn: (d: PlanDraft) => PlanDraft) {
        setDraft(prev => fn(prev));
        setDirty(true);
        setSaveError(null);
    }

    async function handleSave() {
        if (saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            if (stageApproved) {
                await createChangeRequest(runId, 'plan', fromDraft(draft));
                setDirty(false);
                setCrCreated(true);
            } else {
                await updatePlanArtifact(runId, fromDraft(draft));
                setDirty(false);
                setSavedFlash(true);
                setTimeout(() => setSavedFlash(false), 2000);
            }
        } catch (e: any) {
            if (e instanceof StageApprovedError) {
                setStageApproved(true);
                setSaveError('Stage is already approved — use "Save as Change Request" instead.');
            } else {
                setSaveError(e?.response?.data?.error ?? e.message ?? 'Save failed');
            }
        } finally {
            setSaving(false);
        }
    }

    function handleBack() {
        if (dirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
        onBack();
    }

    // ── Repo helpers ──
    function updateRepo(i: number, field: keyof AffectedRepo, val: string) {
        update(d => {
            const repos = d.affected_repos.map((r, j) => j === i ? { ...r, [field]: val } : r);
            return { ...d, affected_repos: repos };
        });
    }
    function addRepo() { update(d => ({ ...d, affected_repos: [...d.affected_repos, { repo: '', reason: '' }] })); }
    function removeRepo(i: number) { update(d => ({ ...d, affected_repos: d.affected_repos.filter((_, j) => j !== i) })); }

    // ── Phase helpers ──
    function updatePhase(i: number, field: keyof Phase, val: string | string[]) {
        update(d => {
            const phases = d.phases.map((p, j) => j === i ? { ...p, [field]: val } : p);
            return { ...d, phases };
        });
    }
    function addPhase() { update(d => ({ ...d, phases: [...d.phases, { name: '', description: '', depends_on_phases: [] }] })); }
    function removePhase(i: number) { update(d => ({ ...d, phases: d.phases.filter((_, j) => j !== i) })); }

    // ── Milestone helpers ──
    function updateMilestone(i: number, field: keyof Milestone, val: string) {
        update(d => {
            const milestones = d.milestones.map((m, j) => j === i ? { ...m, [field]: val } : m);
            return { ...d, milestones };
        });
    }
    function addMilestone() { update(d => ({ ...d, milestones: [...d.milestones, { name: '', phase: '', acceptance: '' }] })); }
    function removeMilestone(i: number) { update(d => ({ ...d, milestones: d.milestones.filter((_, j) => j !== i) })); }

    // ── Blocker helpers ──
    function updateBlocker(i: number, val: string) {
        update(d => {
            const blockers = d.blockers.map((b, j) => j === i ? val : b);
            return { ...d, blockers };
        });
    }
    function addBlocker() { update(d => ({ ...d, blockers: [...d.blockers, ''] })); }
    function removeBlocker(i: number) { update(d => ({ ...d, blockers: d.blockers.filter((_, j) => j !== i) })); }

    // ── Render ──

    if (loading) return (
        <div style={{ padding: 40, color: tokens.color.textMuted, fontSize: 14 }}>Loading plan…</div>
    );

    if (loadError) return (
        <div style={{ padding: 40, color: tokens.color.danger, fontSize: 14 }}>Error: {loadError}</div>
    );

    if (noStageYet) return (
        <div style={{ padding: 40 }}>
            <button
                onClick={onBack}
                style={{
                    background: 'transparent', border: `1px solid ${tokens.color.border}`,
                    color: tokens.color.text, cursor: 'pointer', borderRadius: tokens.radius.sm,
                    padding: '5px 12px', fontSize: 13, fontWeight: 500, marginBottom: 24,
                }}
            >
                ← Back to Pipeline
            </button>
            <div style={{
                padding: '24px 28px', background: tokens.color.card,
                border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.lg,
                color: tokens.color.textMuted, fontSize: 14,
            }}>
                The plan stage hasn't been generated yet for this pipeline run.
                Come back once the Plan stage completes and is awaiting approval.
            </div>
        </div>
    );

    return (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 48px' }}>

            {/* Sticky header */}
            <div style={{
                position: 'sticky', top: 0, zIndex: 10,
                background: tokens.color.bg,
                borderBottom: `1px solid ${tokens.color.border}`,
                padding: '14px 0 12px',
                display: 'flex', alignItems: 'center', gap: 12,
                marginBottom: 28,
            }}>
                <button
                    onClick={handleBack}
                    style={{
                        background: 'transparent', border: `1px solid ${tokens.color.border}`,
                        color: tokens.color.text, cursor: 'pointer', borderRadius: tokens.radius.sm,
                        padding: '5px 12px', fontSize: 13, fontWeight: 500,
                    }}
                >
                    ← Back to Pipeline
                </button>
                <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: tokens.color.text }}>Plan Editor</span>
                    {stageApproved ? (
                        <span style={{ marginLeft: 10, fontSize: 11, color: tokens.color.warning, fontWeight: 500,
                            background: tokens.color.warningSoft, padding: '2px 8px', borderRadius: tokens.radius.pill }}>
                            Approved — edits create a Change Request
                        </span>
                    ) : dirty ? (
                        <span style={{ marginLeft: 10, fontSize: 11, color: tokens.color.warning, fontWeight: 500 }}>
                            ● Unsaved changes
                        </span>
                    ) : null}
                </div>
                {savedFlash ? (
                    <span style={{ fontSize: 12, color: tokens.color.success, fontWeight: 600 }}>Saved ✓</span>
                ) : null}
                <button
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    style={{
                        background: dirty ? (stageApproved ? tokens.color.warning : tokens.color.primary) : tokens.color.borderStrong,
                        color: 'white', border: 'none',
                        padding: '7px 18px', borderRadius: tokens.radius.sm,
                        fontSize: 13, fontWeight: 600,
                        cursor: !dirty || saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                        transition: 'background .15s',
                    }}
                >
                    {saving ? 'Saving…' : stageApproved ? '↩ Save as Change Request' : 'Save Changes'}
                </button>
            </div>

            {crCreated ? (
                <div style={{
                    marginBottom: 16, padding: '10px 14px',
                    background: tokens.color.successSoft ?? '#f0fdf4', border: `1px solid ${tokens.color.success}55`,
                    borderRadius: tokens.radius.md, fontSize: 13, color: tokens.color.success,
                }}>
                    Change Request created. View and apply it from the Pipeline detail page.
                </div>
            ) : null}
            {saveError ? (
                <div style={{
                    marginBottom: 16, padding: '10px 14px',
                    background: tokens.color.dangerSoft, border: `1px solid ${tokens.color.danger}55`,
                    borderRadius: tokens.radius.md, fontSize: 13, color: tokens.color.danger,
                }}>
                    {saveError}
                </div>
            ) : null}

            {/* Team Size */}
            <Section>
                <SectionHeader title="Team Size" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                        type="number"
                        min={1}
                        value={draft.estimated_team_size}
                        onChange={e => update(d => ({ ...d, estimated_team_size: e.target.value === '' ? '' : parseInt(e.target.value, 10) || '' }))}
                        placeholder="e.g. 4"
                        style={{ ...inputStyle, width: 100 }}
                    />
                    <span style={{ fontSize: 13, color: tokens.color.textMuted }}>developers</span>
                </div>
            </Section>

            {/* Affected Repos */}
            <Section>
                <SectionHeader title="Affected Repos" count={draft.affected_repos.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {draft.affected_repos.map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ flex: '0 0 220px' }}>
                                <input
                                    value={r.repo}
                                    onChange={e => updateRepo(i, 'repo', e.target.value)}
                                    placeholder="owner/repo"
                                    style={monoInputStyle}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <input
                                    value={r.reason}
                                    onChange={e => updateRepo(i, 'reason', e.target.value)}
                                    placeholder="Reason this repo is affected"
                                    style={inputStyle}
                                />
                            </div>
                            <DeleteBtn onClick={() => removeRepo(i)} />
                        </div>
                    ))}
                </div>
                <AddRowButton onClick={addRepo} label="Add repo" />
            </Section>

            {/* Phases */}
            <Section>
                <SectionHeader title="Phases" count={draft.phases.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {draft.phases.map((p, i) => (
                        <div key={i} style={{
                            padding: '12px 14px', background: 'white',
                            border: `1px solid ${tokens.color.border}`,
                            borderRadius: tokens.radius.md,
                        }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: '50%',
                                    background: tokens.color.primary, color: 'white',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 13, flexShrink: 0, marginTop: 2,
                                }}>{i + 1}</div>
                                <div style={{ flex: 1 }}>
                                    <input
                                        value={p.name}
                                        onChange={e => updatePhase(i, 'name', e.target.value)}
                                        placeholder="Phase name"
                                        style={{ ...inputStyle, fontWeight: 600, marginBottom: 6 }}
                                    />
                                    <textarea
                                        value={p.description}
                                        onChange={e => updatePhase(i, 'description', e.target.value)}
                                        placeholder="Description"
                                        style={taStyle}
                                    />
                                    <div style={{ marginTop: 6 }}>
                                        <label style={{ fontSize: 11, color: tokens.color.textMuted, display: 'block', marginBottom: 3 }}>
                                            Depends on phases (comma-separated)
                                        </label>
                                        <input
                                            value={p.depends_on_phases.join(', ')}
                                            onChange={e => {
                                                const val = e.target.value;
                                                updatePhase(i, 'depends_on_phases',
                                                    val.trim() === '' ? [] : val.split(',').map(s => s.trim()).filter(Boolean)
                                                );
                                            }}
                                            placeholder="e.g. Phase 1, Phase 2"
                                            style={{ ...inputStyle, fontFamily: tokens.font.mono, fontSize: 12 }}
                                        />
                                    </div>
                                </div>
                                <DeleteBtn onClick={() => removePhase(i)} />
                            </div>
                        </div>
                    ))}
                </div>
                <AddRowButton onClick={addPhase} label="Add phase" />
            </Section>

            {/* Milestones */}
            <Section>
                <SectionHeader title="Milestones" count={draft.milestones.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {draft.milestones.map((m, i) => (
                        <div key={i} style={{
                            padding: '10px 12px', background: 'white',
                            border: `1px solid ${tokens.color.border}`,
                            borderRadius: tokens.radius.md,
                        }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                                <div style={{ flex: 1 }}>
                                    <input
                                        value={m.name}
                                        onChange={e => updateMilestone(i, 'name', e.target.value)}
                                        placeholder="Milestone name"
                                        style={{ ...inputStyle, fontWeight: 600 }}
                                    />
                                </div>
                                <div style={{ flex: '0 0 180px' }}>
                                    <input
                                        value={m.phase}
                                        onChange={e => updateMilestone(i, 'phase', e.target.value)}
                                        placeholder="Phase"
                                        style={inputStyle}
                                    />
                                </div>
                                <DeleteBtn onClick={() => removeMilestone(i)} />
                            </div>
                            <textarea
                                value={m.acceptance}
                                onChange={e => updateMilestone(i, 'acceptance', e.target.value)}
                                placeholder="Acceptance criteria"
                                style={taStyle}
                            />
                        </div>
                    ))}
                </div>
                <AddRowButton onClick={addMilestone} label="Add milestone" />
            </Section>

            {/* Blockers */}
            <Section>
                <SectionHeader title="Blockers" count={draft.blockers.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {draft.blockers.map((b, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                                value={b}
                                onChange={e => updateBlocker(i, e.target.value)}
                                placeholder="Describe the blocker…"
                                style={{ ...inputStyle, color: tokens.color.danger }}
                            />
                            <DeleteBtn onClick={() => removeBlocker(i)} />
                        </div>
                    ))}
                </div>
                <AddRowButton onClick={addBlocker} label="Add blocker" />
            </Section>

        </div>
    );
}

function Section({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            marginBottom: 28,
            padding: '18px 20px',
            background: tokens.color.card,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.lg,
            boxShadow: tokens.shadow.sm,
        }}>
            {children}
        </div>
    );
}
