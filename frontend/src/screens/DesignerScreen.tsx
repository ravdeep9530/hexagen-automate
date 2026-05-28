import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { tokens } from '../features/pipelines/design';
import { MermaidDiagram } from '../features/pipelines/StageVisualizations';
import {
    updateDesignArtifact, updateDesignPreferences,
    createChangeRequest, StageApprovedError,
    DesignPreferences, DesignEntity, DesignField, DesignAdr, SequenceDiagram,
} from '../api/pipelinesApi';

const API_URL = process.env.REACT_APP_API_URL || '/api';

// ── Draft types ───────────────────────────────────────────────────────────────

interface DraftContract {
    method: string;
    path: string;
    _reqRaw: string;
    _resRaw: string;
    errors: string[];
}

interface DesignDraft {
    preset: 'material-ui' | 'tailwind-shadcn' | 'custom' | null;
    ideas: string;
    references: { kind: 'website' | 'github'; url: string; note: string }[];
    architecture_diagram_mermaid: string;
    data_model: DesignEntity[];
    api_contracts: DraftContract[];
    sequence_diagrams_mermaid: SequenceDiagram[];
    security_considerations: string[];
    adrs: DesignAdr[];
}

function emptyDraft(): DesignDraft {
    return {
        preset: null, ideas: '', references: [],
        architecture_diagram_mermaid: '',
        data_model: [], api_contracts: [],
        sequence_diagrams_mermaid: [],
        security_considerations: [], adrs: [],
    };
}

function toDraft(artifactJson: any, prefs: any): DesignDraft {
    const a = artifactJson ?? {};
    return {
        preset: prefs?.preset ?? null,
        ideas: prefs?.ideas ?? '',
        references: Array.isArray(prefs?.references)
            ? prefs.references.map((r: any) => ({ kind: r.kind ?? 'website', url: r.url ?? '', note: r.note ?? '' }))
            : [],
        architecture_diagram_mermaid: a.architecture_diagram_mermaid ?? '',
        data_model: Array.isArray(a.data_model)
            ? a.data_model.map((e: any) => ({
                name: e.name ?? '',
                fields: Array.isArray(e.fields)
                    ? e.fields.map((f: any) => ({ name: f.name ?? '', type: f.type ?? '', description: f.description ?? '' }))
                    : [],
                relationships: Array.isArray(e.relationships) ? e.relationships : [],
            }))
            : [],
        api_contracts: Array.isArray(a.api_contracts)
            ? a.api_contracts.map((c: any) => ({
                method: c.method ?? 'GET',
                path: c.path ?? '',
                _reqRaw: c.request_body ? (typeof c.request_body === 'string' ? c.request_body : JSON.stringify(c.request_body, null, 2)) : '',
                _resRaw: c.response_schema ? (typeof c.response_schema === 'string' ? c.response_schema : JSON.stringify(c.response_schema, null, 2)) : '',
                errors: Array.isArray(c.errors) ? c.errors : [],
            }))
            : [],
        sequence_diagrams_mermaid: Array.isArray(a.sequence_diagrams_mermaid)
            ? a.sequence_diagrams_mermaid.map((s: any, i: number) =>
                typeof s === 'string'
                    ? { title: `Diagram ${i + 1}`, diagram: s }
                    : { title: s.title ?? '', diagram: s.diagram ?? '' }
              )
            : [],
        security_considerations: Array.isArray(a.security_considerations)
            ? a.security_considerations.map((s: any) => String(s))
            : [],
        adrs: Array.isArray(a.adrs)
            ? a.adrs.map((adr: any) => ({
                title: adr.title ?? '',
                context: adr.context ?? '',
                decision: adr.decision ?? '',
                consequences: adr.consequences ?? '',
            }))
            : [],
    };
}

function safeParse(raw: string): object | undefined {
    if (!raw.trim()) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
}

function fromDraft(d: DesignDraft): { artifactJson: object; prefs: DesignPreferences } {
    return {
        artifactJson: {
            architecture_diagram_mermaid: d.architecture_diagram_mermaid,
            data_model: d.data_model,
            api_contracts: d.api_contracts.map(c => ({
                method: c.method,
                path: c.path,
                ...(c._reqRaw.trim() ? { request_body: safeParse(c._reqRaw) ?? c._reqRaw } : {}),
                ...(c._resRaw.trim() ? { response_schema: safeParse(c._resRaw) ?? c._resRaw } : {}),
                ...(c.errors.length > 0 ? { errors: c.errors } : {}),
            })),
            sequence_diagrams_mermaid: d.sequence_diagrams_mermaid,
            security_considerations: d.security_considerations,
            adrs: d.adrs,
        },
        prefs: {
            ...(d.preset ? { preset: d.preset } : {}),
            ...(d.ideas.trim() ? { ideas: d.ideas } : {}),
            ...(d.references.length > 0
                ? { references: d.references.map(r => ({ kind: r.kind, url: r.url, ...(r.note.trim() ? { note: r.note } : {}) })) }
                : {}),
        },
    };
}

// ── Shared input styles ───────────────────────────────────────────────────────

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

// ── Shared sub-components ─────────────────────────────────────────────────────

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

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '4px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${active ? tokens.color.primary : tokens.color.border}`,
                background: active ? tokens.color.primarySoft : 'transparent',
                color: active ? tokens.color.primary : tokens.color.textMuted,
                borderRadius: tokens.radius.sm,
            }}
        >
            {label}
        </button>
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

// ── Template card mini-previews ───────────────────────────────────────────────

function MaterialPreview() {
    return (
        <div style={{ width: '100%', height: 110, background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: 28, background: '#1976d2', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6 }}>
                <div style={{ width: 44, height: 5, background: 'rgba(255,255,255,0.9)', borderRadius: 2 }} />
                <div style={{ flex: 1 }} />
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
            </div>
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ height: 6, background: '#bdbdbd', borderRadius: 3, width: '65%' }} />
                <div style={{ height: 4, background: '#e0e0e0', borderRadius: 2, width: '85%' }} />
                <div style={{ height: 4, background: '#e0e0e0', borderRadius: 2, width: '55%' }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <div style={{ height: 20, width: 52, background: '#1976d2', borderRadius: 3 }} />
                    <div style={{ height: 20, width: 52, background: 'transparent', border: '1px solid #1976d2', borderRadius: 3 }} />
                </div>
            </div>
        </div>
    );
}

function ShadcnPreview() {
    return (
        <div style={{ width: '100%', height: 110, background: '#ffffff', borderRadius: 4, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            <div style={{ height: 32, background: '#fff', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 12 }}>
                <div style={{ width: 30, height: 4, background: '#d1d5db', borderRadius: 2 }} />
                <div style={{ width: 30, height: 4, background: '#d1d5db', borderRadius: 2 }} />
                <div style={{ width: 30, height: 4, background: '#d1d5db', borderRadius: 2 }} />
            </div>
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ height: 5, background: '#111827', borderRadius: 2, width: '50%' }} />
                <div style={{ height: 3, background: '#9ca3af', borderRadius: 2, width: '80%' }} />
                <div style={{ height: 3, background: '#9ca3af', borderRadius: 2, width: '60%' }} />
                <div style={{ marginTop: 4, height: 20, width: 68, background: '#111827', borderRadius: 6 }} />
            </div>
        </div>
    );
}

function CustomPreview() {
    return (
        <div style={{ width: '100%', height: 110, background: '#faf9f7', borderRadius: 4, overflow: 'hidden', border: '1px solid #e8e3da' }}>
            <div style={{ height: 20, background: '#7c3aed', width: '100%' }} />
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ height: 5, background: '#1c1917', borderRadius: 2, width: '55%' }} />
                <div style={{ height: 3, background: '#78716c', borderRadius: 2, width: '78%' }} />
                <div style={{ height: 3, background: '#78716c', borderRadius: 2, width: '48%' }} />
                <div style={{ marginTop: 5, height: 20, width: 60, background: 'transparent', border: '1px solid #7c3aed', borderRadius: 4 }} />
            </div>
        </div>
    );
}

const TEMPLATES: Array<{
    key: 'material-ui' | 'tailwind-shadcn' | 'custom';
    label: string;
    sub: string;
    Preview: React.FC;
}> = [
    { key: 'material-ui',     label: 'Material UI v5',     sub: 'MUI + Emotion, light theme', Preview: MaterialPreview },
    { key: 'tailwind-shadcn', label: 'Tailwind + shadcn',  sub: 'shadcn/ui, neutral tokens',  Preview: ShadcnPreview },
    { key: 'custom',          label: 'Minimal / Custom',   sub: 'No library — custom styles', Preview: CustomPreview },
];

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
    runId: string;
    onBack: () => void;
}

export function DesignerScreen({ runId, onBack }: Props) {
    const [draft, setDraft]           = useState<DesignDraft>(emptyDraft());
    const [loading, setLoading]       = useState(true);
    const [loadError, setLoadError]   = useState<string | null>(null);
    const [dirty, setDirty]           = useState(false);
    const [saving, setSaving]         = useState(false);
    const [saveError, setSaveError]   = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);
    const [stageApproved, setStageApproved] = useState(false);
    const [crCreated, setCrCreated]   = useState(false);
    const [archTab, setArchTab]       = useState<'preview' | 'edit'>('preview');
    const [seqTabs, setSeqTabs]       = useState<Record<number, 'preview' | 'edit'>>({});
    const [expandedAdrs, setExpandedAdrs] = useState<Set<number>>(new Set());

    useEffect(() => {
        let cancelled = false;
        axios.get(`${API_URL}/pipelines/${runId}`)
            .then(r => {
                if (cancelled) return;
                const stages: any[] = r.data?.stages ?? [];
                const designStage = stages.find((s: any) => s.stage === 'design');
                const rawArtifact = designStage?.artifact_json;
                const artifactJson = (rawArtifact as any)?.parsed ?? rawArtifact ?? {};
                const prefs = r.data?.design_preferences ?? {};
                setDraft(toDraft(artifactJson, prefs));
                setStageApproved(designStage?.status === 'approved');
                setLoading(false);
            })
            .catch(e => {
                if (cancelled) return;
                setLoadError(e?.response?.data?.error ?? e.message ?? 'Failed to load design');
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [runId]);

    function update(fn: (d: DesignDraft) => DesignDraft) {
        setDraft(prev => fn(prev));
        setDirty(true);
        setSaveError(null);
    }

    async function handleSave() {
        if (saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            const { artifactJson, prefs } = fromDraft(draft);
            if (stageApproved) {
                await createChangeRequest(runId, 'design', artifactJson);
                // Always persist design prefs (not a stage artifact, no CR needed)
                await updateDesignPreferences(runId, prefs).catch(() => {});
                setDirty(false);
                setCrCreated(true);
            } else {
                await Promise.all([
                    updateDesignArtifact(runId, artifactJson),
                    updateDesignPreferences(runId, prefs),
                ]);
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

    // ── Reference helpers ──
    function addReference(kind: 'website' | 'github') {
        update(d => ({ ...d, references: [...d.references, { kind, url: '', note: '' }] }));
    }
    function updateReference(i: number, field: 'url' | 'note', val: string) {
        update(d => ({ ...d, references: d.references.map((r, j) => j === i ? { ...r, [field]: val } : r) }));
    }
    function removeReference(i: number) {
        update(d => ({ ...d, references: d.references.filter((_, j) => j !== i) }));
    }

    // ── Data model helpers ──
    function addEntity() {
        update(d => ({ ...d, data_model: [...d.data_model, { name: '', fields: [], relationships: [] }] }));
    }
    function removeEntity(i: number) {
        update(d => ({ ...d, data_model: d.data_model.filter((_, j) => j !== i) }));
    }
    function updateEntityName(i: number, val: string) {
        update(d => ({ ...d, data_model: d.data_model.map((e, j) => j === i ? { ...e, name: val } : e) }));
    }
    function addField(ei: number) {
        update(d => ({
            ...d,
            data_model: d.data_model.map((e, j) => j === ei
                ? { ...e, fields: [...e.fields, { name: '', type: '', description: '' }] }
                : e),
        }));
    }
    function updateField(ei: number, fi: number, field: keyof DesignField, val: string) {
        update(d => ({
            ...d,
            data_model: d.data_model.map((e, j) => j === ei
                ? { ...e, fields: e.fields.map((f, k) => k === fi ? { ...f, [field]: val } : f) }
                : e),
        }));
    }
    function removeField(ei: number, fi: number) {
        update(d => ({
            ...d,
            data_model: d.data_model.map((e, j) => j === ei
                ? { ...e, fields: e.fields.filter((_, k) => k !== fi) }
                : e),
        }));
    }
    function updateRelationships(ei: number, val: string) {
        update(d => ({
            ...d,
            data_model: d.data_model.map((e, j) => j === ei
                ? { ...e, relationships: val.trim() === '' ? [] : val.split(',').map(s => s.trim()).filter(Boolean) }
                : e),
        }));
    }

    // ── API contract helpers ──
    function addContract() {
        update(d => ({ ...d, api_contracts: [...d.api_contracts, { method: 'GET', path: '', _reqRaw: '', _resRaw: '', errors: [] }] }));
    }
    function removeContract(i: number) {
        update(d => ({ ...d, api_contracts: d.api_contracts.filter((_, j) => j !== i) }));
    }
    function updateContract(i: number, field: 'method' | 'path' | '_reqRaw' | '_resRaw', val: string) {
        update(d => ({ ...d, api_contracts: d.api_contracts.map((c, j) => j === i ? { ...c, [field]: val } : c) }));
    }
    function updateContractErrors(i: number, val: string) {
        update(d => ({
            ...d,
            api_contracts: d.api_contracts.map((c, j) => j === i
                ? { ...c, errors: val.trim() === '' ? [] : val.split(',').map(s => s.trim()).filter(Boolean) }
                : c),
        }));
    }

    // ── Sequence diagram helpers ──
    function addSequenceDiagram() {
        update(d => ({ ...d, sequence_diagrams_mermaid: [...d.sequence_diagrams_mermaid, { title: '', diagram: '' }] }));
    }
    function removeSequenceDiagram(i: number) {
        update(d => ({ ...d, sequence_diagrams_mermaid: d.sequence_diagrams_mermaid.filter((_, j) => j !== i) }));
    }
    function updateSequenceDiagram(i: number, field: 'title' | 'diagram', val: string) {
        update(d => ({ ...d, sequence_diagrams_mermaid: d.sequence_diagrams_mermaid.map((s, j) => j === i ? { ...s, [field]: val } : s) }));
    }

    // ── Security helpers ──
    function addSecurity() { update(d => ({ ...d, security_considerations: [...d.security_considerations, ''] })); }
    function updateSecurity(i: number, val: string) {
        update(d => ({ ...d, security_considerations: d.security_considerations.map((s, j) => j === i ? val : s) }));
    }
    function removeSecurity(i: number) {
        update(d => ({ ...d, security_considerations: d.security_considerations.filter((_, j) => j !== i) }));
    }

    // ── ADR helpers ──
    function addAdr() {
        const newIdx = draft.adrs.length;
        setExpandedAdrs(prev => new Set(prev).add(newIdx));
        update(d => ({ ...d, adrs: [...d.adrs, { title: '', context: '', decision: '', consequences: '' }] }));
    }
    function removeAdr(i: number) {
        update(d => ({ ...d, adrs: d.adrs.filter((_, j) => j !== i) }));
        setExpandedAdrs(prev => {
            const next = new Set<number>();
            prev.forEach(idx => { if (idx !== i) next.add(idx > i ? idx - 1 : idx); });
            return next;
        });
    }
    function updateAdr(i: number, field: keyof DesignAdr, val: string) {
        update(d => ({ ...d, adrs: d.adrs.map((a, j) => j === i ? { ...a, [field]: val } : a) }));
    }
    function toggleAdr(i: number) {
        setExpandedAdrs(prev => {
            const next = new Set(prev);
            next.has(i) ? next.delete(i) : next.add(i);
            return next;
        });
    }

    // ── Loading / error states ──

    if (loading) return (
        <div style={{ padding: 40, color: tokens.color.textMuted, fontSize: 14 }}>Loading design…</div>
    );

    if (loadError) return (
        <div style={{ padding: 40, color: tokens.color.danger, fontSize: 14 }}>Error: {loadError}</div>
    );

    const methodColor: Record<string, string> = {
        GET: '#16a34a', POST: '#2563eb', PUT: '#d97706', PATCH: '#7c3aed', DELETE: '#dc2626',
    };

    return (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>

            {/* ── Sticky header ── */}
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
                    <span style={{ fontSize: 16, fontWeight: 700, color: tokens.color.text }}>Design Studio</span>
                    <span style={{ fontSize: 12, color: tokens.color.textMuted, marginLeft: 8, fontFamily: tokens.font.mono }}>
                        Run #{runId.slice(0, 8)}
                    </span>
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
                    background: '#f0fdf4', border: `1px solid ${tokens.color.success}55`,
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

            {/* ══════════════════════════════════════
                SECTION 1: UI Design
            ══════════════════════════════════════ */}
            <Section>
                <SectionHeader title="UI Design" />

                {/* Template picker */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: tokens.color.text, marginBottom: 10 }}>
                        Choose a UI template
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                        {TEMPLATES.map(({ key, label, sub, Preview }) => {
                            const selected = draft.preset === key;
                            return (
                                <div
                                    key={key}
                                    onClick={() => update(d => ({ ...d, preset: selected ? null : key }))}
                                    style={{
                                        border: `2px solid ${selected ? tokens.color.primary : tokens.color.border}`,
                                        borderRadius: tokens.radius.md,
                                        padding: 10,
                                        cursor: 'pointer',
                                        background: selected ? tokens.color.primarySoft : tokens.color.card,
                                        boxShadow: selected ? tokens.shadow.focus : tokens.shadow.sm,
                                        transition: 'all .15s',
                                        userSelect: 'none',
                                    }}
                                >
                                    <Preview />
                                    <div style={{ marginTop: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{
                                                width: 12, height: 12, borderRadius: '50%',
                                                border: `2px solid ${selected ? tokens.color.primary : tokens.color.border}`,
                                                background: selected ? tokens.color.primary : 'transparent',
                                                flexShrink: 0,
                                            }} />
                                            <span style={{ fontSize: 13, fontWeight: 600, color: tokens.color.text }}>{label}</span>
                                        </div>
                                        <div style={{ fontSize: 11, color: tokens.color.textMuted, marginTop: 2, paddingLeft: 18 }}>{sub}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* References */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: tokens.color.text }}>
                            References &amp; Inspiration
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => addReference('website')}
                                style={{
                                    background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                    color: tokens.color.primary, borderRadius: tokens.radius.sm,
                                    padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
                                }}
                            >
                                + Website URL
                            </button>
                            <button
                                onClick={() => addReference('github')}
                                style={{
                                    background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                    color: tokens.color.primary, borderRadius: tokens.radius.sm,
                                    padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
                                }}
                            >
                                + GitHub Repo
                            </button>
                        </div>
                    </div>
                    {draft.references.length === 0 ? (
                        <div style={{ fontSize: 12, color: tokens.color.textSubtle, fontStyle: 'italic', padding: '8px 0' }}>
                            No references added yet. Add website URLs or GitHub repos for design inspiration.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {draft.references.map((ref, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <span style={{ fontSize: 15, flexShrink: 0, width: 22, textAlign: 'center' }}>
                                        {ref.kind === 'website' ? '🌐' : '⎇'}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <input
                                            value={ref.url}
                                            onChange={e => updateReference(i, 'url', e.target.value)}
                                            placeholder={ref.kind === 'website' ? 'https://example.com' : 'github.com/org/repo'}
                                            style={monoInputStyle}
                                        />
                                    </div>
                                    <div style={{ flex: '0 0 200px' }}>
                                        <input
                                            value={ref.note}
                                            onChange={e => updateReference(i, 'note', e.target.value)}
                                            placeholder="optional note"
                                            style={inputStyle}
                                        />
                                    </div>
                                    <DeleteBtn onClick={() => removeReference(i)} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Ideas */}
                <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: tokens.color.text, marginBottom: 6 }}>
                        Additional suggestions &amp; ideas
                    </div>
                    <textarea
                        value={draft.ideas}
                        onChange={e => update(d => ({ ...d, ideas: e.target.value }))}
                        placeholder="e.g. Modern dark sidebar, card-based layout, animate page transitions, mobile-first…"
                        style={{ ...taStyle, minHeight: 72 }}
                    />
                </div>
            </Section>

            {/* ══════════════════════════════════════
                SECTION 2: Technical Design
            ══════════════════════════════════════ */}

            {/* Architecture Diagram */}
            <Section>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <SectionHeader title="Architecture Diagram" />
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        <TabBtn active={archTab === 'preview'} onClick={() => setArchTab('preview')} label="Preview" />
                        <TabBtn active={archTab === 'edit'}    onClick={() => setArchTab('edit')}    label="Edit" />
                    </div>
                </div>
                {archTab === 'preview' ? (
                    <div style={{ border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, padding: 16, background: '#fff', overflowX: 'auto' }}>
                        <MermaidDiagram source={draft.architecture_diagram_mermaid} fallbackLabel="(no architecture diagram)" />
                    </div>
                ) : (
                    <textarea
                        value={draft.architecture_diagram_mermaid}
                        onChange={e => update(d => ({ ...d, architecture_diagram_mermaid: e.target.value }))}
                        placeholder="graph TD&#10;  A[Client] --> B[API Gateway]&#10;  B --> C[Service]"
                        style={{ ...monoInputStyle, resize: 'vertical', minHeight: 200, fontSize: 12 }}
                    />
                )}
            </Section>

            {/* Data Model */}
            <Section>
                <SectionHeader title="Data Model" count={draft.data_model.length} />
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 14,
                }}>
                    {draft.data_model.map((entity, ei) => (
                        <div key={ei} style={{
                            border: `1px solid ${tokens.color.border}`,
                            borderRadius: tokens.radius.md,
                            background: '#fff',
                            overflow: 'hidden',
                        }}>
                            {/* Entity header */}
                            <div style={{
                                background: tokens.color.primarySoft,
                                borderBottom: `1px solid ${tokens.color.border}`,
                                padding: '8px 10px',
                                display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                                <input
                                    value={entity.name}
                                    onChange={e => updateEntityName(ei, e.target.value)}
                                    placeholder="EntityName"
                                    style={{ ...monoInputStyle, fontWeight: 700, fontSize: 13, background: 'transparent', border: 'none', padding: '2px 4px' }}
                                />
                                <DeleteBtn onClick={() => removeEntity(ei)} />
                            </div>
                            {/* Fields */}
                            <div style={{ padding: '8px 10px' }}>
                                {entity.fields.map((f, fi) => (
                                    <div key={fi} style={{ display: 'flex', gap: 4, marginBottom: 5, alignItems: 'center' }}>
                                        <input
                                            value={f.name}
                                            onChange={e => updateField(ei, fi, 'name', e.target.value)}
                                            placeholder="fieldName"
                                            style={{ ...monoInputStyle, flex: '0 0 100px', fontSize: 12, padding: '4px 6px' }}
                                        />
                                        <input
                                            value={f.type}
                                            onChange={e => updateField(ei, fi, 'type', e.target.value)}
                                            placeholder="type"
                                            style={{ ...monoInputStyle, flex: '0 0 72px', fontSize: 12, padding: '4px 6px' }}
                                        />
                                        <input
                                            value={f.description ?? ''}
                                            onChange={e => updateField(ei, fi, 'description', e.target.value)}
                                            placeholder="desc"
                                            style={{ ...inputStyle, flex: 1, fontSize: 11, padding: '4px 6px' }}
                                        />
                                        <DeleteBtn onClick={() => removeField(ei, fi)} />
                                    </div>
                                ))}
                                <button
                                    onClick={() => addField(ei)}
                                    style={{
                                        background: 'transparent', border: `1px dashed ${tokens.color.border}`,
                                        color: tokens.color.textMuted, borderRadius: tokens.radius.sm,
                                        padding: '3px 10px', fontSize: 11, cursor: 'pointer', width: '100%', marginTop: 4,
                                    }}
                                >
                                    + field
                                </button>
                                {/* Relationships */}
                                <div style={{ marginTop: 8 }}>
                                    <label style={{ fontSize: 10, color: tokens.color.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Relationships
                                    </label>
                                    <input
                                        value={entity.relationships.join(', ')}
                                        onChange={e => updateRelationships(ei, e.target.value)}
                                        placeholder="e.g. belongs to User, has many Orders"
                                        style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <AddRowButton onClick={addEntity} label="Add entity" />
            </Section>

            {/* API Contracts */}
            <Section>
                <SectionHeader title="API Contracts" count={draft.api_contracts.length} />
                {draft.api_contracts.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Header row */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '90px 1fr 1fr 1fr 140px 36px',
                            gap: 6,
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.05em', color: tokens.color.textMuted,
                            padding: '0 2px',
                        }}>
                            <span>Method</span>
                            <span>Path</span>
                            <span>Request Body</span>
                            <span>Response</span>
                            <span>Errors</span>
                            <span />
                        </div>
                        {draft.api_contracts.map((c, i) => (
                            <div key={i} style={{
                                display: 'grid',
                                gridTemplateColumns: '90px 1fr 1fr 1fr 140px 36px',
                                gap: 6,
                                alignItems: 'start',
                                padding: '10px 10px',
                                background: '#fff',
                                border: `1px solid ${tokens.color.border}`,
                                borderRadius: tokens.radius.md,
                            }}>
                                <select
                                    value={c.method}
                                    onChange={e => updateContract(i, 'method', e.target.value)}
                                    style={{
                                        ...inputStyle,
                                        fontWeight: 700, fontSize: 12,
                                        color: methodColor[c.method] ?? tokens.color.text,
                                        padding: '5px 6px',
                                    }}
                                >
                                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                                <input
                                    value={c.path}
                                    onChange={e => updateContract(i, 'path', e.target.value)}
                                    placeholder="/api/resource"
                                    style={monoInputStyle}
                                />
                                <textarea
                                    value={c._reqRaw}
                                    onChange={e => updateContract(i, '_reqRaw', e.target.value)}
                                    placeholder='{ "key": "value" }'
                                    style={{ ...monoInputStyle, resize: 'vertical', minHeight: 52, fontSize: 11 }}
                                />
                                <textarea
                                    value={c._resRaw}
                                    onChange={e => updateContract(i, '_resRaw', e.target.value)}
                                    placeholder='{ "id": 1, ... }'
                                    style={{ ...monoInputStyle, resize: 'vertical', minHeight: 52, fontSize: 11 }}
                                />
                                <input
                                    value={c.errors.join(', ')}
                                    onChange={e => updateContractErrors(i, e.target.value)}
                                    placeholder="404, 403"
                                    style={{ ...monoInputStyle, fontSize: 12 }}
                                />
                                <DeleteBtn onClick={() => removeContract(i)} />
                            </div>
                        ))}
                    </div>
                ) : null}
                <AddRowButton onClick={addContract} label="Add endpoint" />
            </Section>

            {/* Sequence Diagrams */}
            <Section>
                <SectionHeader title="Sequence Diagrams" count={draft.sequence_diagrams_mermaid.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {draft.sequence_diagrams_mermaid.map((sd, i) => {
                        const tab = seqTabs[i] ?? 'preview';
                        return (
                            <div key={i} style={{
                                border: `1px solid ${tokens.color.border}`,
                                borderRadius: tokens.radius.md,
                                overflow: 'hidden',
                                background: '#fff',
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 10px',
                                    borderBottom: `1px solid ${tokens.color.border}`,
                                    background: tokens.color.slateSoft,
                                }}>
                                    <input
                                        value={sd.title}
                                        onChange={e => updateSequenceDiagram(i, 'title', e.target.value)}
                                        placeholder="Diagram title"
                                        style={{ ...inputStyle, fontWeight: 600 }}
                                    />
                                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                        <TabBtn active={tab === 'preview'} onClick={() => setSeqTabs(t => ({ ...t, [i]: 'preview' }))} label="Preview" />
                                        <TabBtn active={tab === 'edit'}    onClick={() => setSeqTabs(t => ({ ...t, [i]: 'edit' }))}    label="Edit" />
                                    </div>
                                    <DeleteBtn onClick={() => removeSequenceDiagram(i)} />
                                </div>
                                <div style={{ padding: 12 }}>
                                    {tab === 'preview' ? (
                                        <MermaidDiagram source={sd.diagram} fallbackLabel="(no diagram)" />
                                    ) : (
                                        <textarea
                                            value={sd.diagram}
                                            onChange={e => updateSequenceDiagram(i, 'diagram', e.target.value)}
                                            placeholder="sequenceDiagram&#10;  Alice ->> Bob: Hello"
                                            style={{ ...monoInputStyle, resize: 'vertical', minHeight: 160, fontSize: 12 }}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <AddRowButton onClick={addSequenceDiagram} label="Add sequence diagram" />
            </Section>

            {/* Security Considerations */}
            <Section>
                <SectionHeader title="Security Considerations" count={draft.security_considerations.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {draft.security_considerations.map((s, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ color: tokens.color.textMuted, flexShrink: 0 }}>•</span>
                            <input
                                value={s}
                                onChange={e => updateSecurity(i, e.target.value)}
                                placeholder="e.g. All endpoints require JWT auth"
                                style={inputStyle}
                            />
                            <DeleteBtn onClick={() => removeSecurity(i)} />
                        </div>
                    ))}
                </div>
                <AddRowButton onClick={addSecurity} label="Add consideration" />
            </Section>

            {/* ADRs */}
            <Section>
                <SectionHeader title="Architecture Decision Records (ADRs)" count={draft.adrs.length} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {draft.adrs.map((adr, i) => {
                        const expanded = expandedAdrs.has(i);
                        return (
                            <div key={i} style={{
                                border: `1px solid ${tokens.color.border}`,
                                borderRadius: tokens.radius.md,
                                overflow: 'hidden',
                                background: '#fff',
                            }}>
                                {/* ADR header */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 10px',
                                    background: tokens.color.card,
                                    borderBottom: expanded ? `1px solid ${tokens.color.border}` : 'none',
                                    cursor: 'pointer',
                                }}
                                    onClick={() => toggleAdr(i)}
                                >
                                    <span style={{ fontSize: 11, color: tokens.color.textMuted, userSelect: 'none' }}>
                                        {expanded ? '▼' : '▶'}
                                    </span>
                                    <input
                                        value={adr.title}
                                        onClick={e => e.stopPropagation()}
                                        onChange={e => updateAdr(i, 'title', e.target.value)}
                                        placeholder="ADR title…"
                                        style={{ ...inputStyle, fontWeight: 600, background: 'transparent', border: 'none', padding: '2px 4px', flex: 1 }}
                                    />
                                    <span onClick={e => e.stopPropagation()}>
                                        <DeleteBtn onClick={() => removeAdr(i)} />
                                    </span>
                                </div>
                                {/* ADR body */}
                                {expanded ? (
                                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {(['context', 'decision', 'consequences'] as const).map(field => (
                                            <div key={field}>
                                                <label style={{ fontSize: 11, color: tokens.color.textMuted, display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'capitalize' }}>
                                                    {field}
                                                </label>
                                                <textarea
                                                    value={adr[field]}
                                                    onChange={e => updateAdr(i, field, e.target.value)}
                                                    placeholder={`Describe the ${field}…`}
                                                    style={{ ...taStyle, minHeight: 64 }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
                <AddRowButton onClick={addAdr} label="Add ADR" />
            </Section>

        </div>
    );
}
