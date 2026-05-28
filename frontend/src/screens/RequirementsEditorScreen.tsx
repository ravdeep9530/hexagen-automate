import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { tokens } from '../features/pipelines/design';
import { updateRequirementsArtifact, createChangeRequest, StageApprovedError } from '../api/pipelinesApi';

const API_URL = process.env.REACT_APP_API_URL || '/api';

interface RequirementsDraft {
    title: string;
    user_stories: string[];
    functional_requirements: string[];
    non_functional_requirements: string[];
    acceptance_criteria: string[];
    open_questions: string[];
    assumptions: string[];
    out_of_scope: string[];
}

function emptyDraft(): RequirementsDraft {
    return {
        title: '',
        user_stories: [],
        functional_requirements: [],
        non_functional_requirements: [],
        acceptance_criteria: [],
        open_questions: [],
        assumptions: [],
        out_of_scope: [],
    };
}

function toDraft(json: any): RequirementsDraft {
    const toStrArr = (v: any) => Array.isArray(v) ? v.map((x: any) => String(x)) : [];
    return {
        title: typeof json?.title === 'string' ? json.title : '',
        user_stories: toStrArr(json?.user_stories),
        functional_requirements: toStrArr(json?.functional_requirements),
        non_functional_requirements: toStrArr(json?.non_functional_requirements),
        acceptance_criteria: toStrArr(json?.acceptance_criteria),
        open_questions: toStrArr(json?.open_questions),
        assumptions: toStrArr(json?.assumptions),
        out_of_scope: toStrArr(json?.out_of_scope),
    };
}

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

const taStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 48 };

function Section({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            marginBottom: 28,
            padding: '18px 20px',
            background: 'white',
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.lg,
        }}>
            {children}
        </div>
    );
}

function SectionHeader({ title, count, warning }: { title: string; count?: number; warning?: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
                fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: warning ? tokens.color.warning : tokens.color.textMuted,
            }}>
                {title}
            </span>
            {count !== undefined ? (
                <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: warning ? tokens.color.warning : tokens.color.primary,
                    background: warning ? '#fef9c3' : tokens.color.primarySoft,
                    borderRadius: tokens.radius.pill,
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
                marginTop: 8, background: 'transparent',
                border: `1px dashed ${tokens.color.border}`,
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

function ListSection({
    title,
    items,
    onUpdate,
    onAdd,
    onRemove,
    placeholder,
    warning,
}: {
    title: string;
    items: string[];
    onUpdate: (i: number, val: string) => void;
    onAdd: () => void;
    onRemove: (i: number) => void;
    placeholder: string;
    warning?: boolean;
}) {
    return (
        <Section>
            <SectionHeader title={title} count={items.length} warning={warning} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <textarea
                            value={item}
                            onChange={e => onUpdate(i, e.target.value)}
                            placeholder={placeholder}
                            rows={2}
                            style={{
                                ...taStyle,
                                borderColor: warning ? `${tokens.color.warning}66` : tokens.color.border,
                            }}
                        />
                        <DeleteBtn onClick={() => onRemove(i)} />
                    </div>
                ))}
            </div>
            <AddRowButton onClick={onAdd} label={`Add ${title.toLowerCase().replace('open ', '').replace(/s$/, '')}`} />
        </Section>
    );
}

interface Props {
    runId: string;
    onBack: () => void;
}

export function RequirementsEditorScreen({ runId, onBack }: Props) {
    const [draft, setDraft] = useState<RequirementsDraft>(emptyDraft());
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);
    const [stageApproved, setStageApproved] = useState(false);
    const [crCreated, setCrCreated] = useState(false);

    useEffect(() => {
        let cancelled = false;
        axios.get(`${API_URL}/pipelines/${runId}`)
            .then(r => {
                if (cancelled) return;
                const stages: any[] = r.data?.stages ?? [];
                const reqStage = stages.find((s: any) => s.stage === 'requirements');
                const raw = reqStage?.artifact_json;
                const data = (raw as any)?.parsed ?? raw ?? {};
                setDraft(toDraft(data));
                setStageApproved(reqStage?.status === 'approved');
                setLoading(false);
            })
            .catch(e => {
                if (cancelled) return;
                setLoadError(e?.response?.data?.error ?? e.message ?? 'Failed to load requirements');
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [runId]);

    function update(fn: (d: RequirementsDraft) => RequirementsDraft) {
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
                await createChangeRequest(runId, 'requirements', draft);
                setDirty(false);
                setCrCreated(true);
            } else {
                await updateRequirementsArtifact(runId, draft);
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

    function listHandlers(field: keyof RequirementsDraft) {
        return {
            onUpdate: (i: number, val: string) => update(d => {
                const arr = [...(d[field] as string[])];
                arr[i] = val;
                return { ...d, [field]: arr };
            }),
            onAdd: () => update(d => ({ ...d, [field]: [...(d[field] as string[]), ''] })),
            onRemove: (i: number) => update(d => ({ ...d, [field]: (d[field] as string[]).filter((_, j) => j !== i) })),
        };
    }

    if (loading) return (
        <div style={{ padding: 40, color: tokens.color.textMuted, fontSize: 14 }}>Loading requirements…</div>
    );

    if (loadError) return (
        <div style={{ padding: 40, color: tokens.color.danger, fontSize: 14 }}>Error: {loadError}</div>
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
                    <span style={{ fontSize: 16, fontWeight: 700, color: tokens.color.text }}>Requirements Editor</span>
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

            {/* Title */}
            <Section>
                <SectionHeader title="Feature Title" />
                <input
                    value={draft.title}
                    onChange={e => update(d => ({ ...d, title: e.target.value }))}
                    placeholder="e.g. User authentication with OAuth"
                    style={{ ...inputStyle, fontSize: 15, fontWeight: 600 }}
                />
            </Section>

            <ListSection
                title="User Stories"
                items={draft.user_stories}
                placeholder="As a [user], I want to [action] so that [benefit]"
                {...listHandlers('user_stories')}
            />

            <ListSection
                title="Functional Requirements"
                items={draft.functional_requirements}
                placeholder="The system shall…"
                {...listHandlers('functional_requirements')}
            />

            <ListSection
                title="Non-Functional Requirements"
                items={draft.non_functional_requirements}
                placeholder="e.g. Response time under 200ms"
                {...listHandlers('non_functional_requirements')}
            />

            <ListSection
                title="Acceptance Criteria"
                items={draft.acceptance_criteria}
                placeholder="Given… When… Then…"
                {...listHandlers('acceptance_criteria')}
            />

            <ListSection
                title="Open Questions"
                items={draft.open_questions}
                placeholder="Unresolved question or ambiguity…"
                warning
                {...listHandlers('open_questions')}
            />

            <ListSection
                title="Assumptions"
                items={draft.assumptions}
                placeholder="We assume that…"
                {...listHandlers('assumptions')}
            />

            <ListSection
                title="Out of Scope"
                items={draft.out_of_scope}
                placeholder="This feature will NOT include…"
                {...listHandlers('out_of_scope')}
            />
        </div>
    );
}
