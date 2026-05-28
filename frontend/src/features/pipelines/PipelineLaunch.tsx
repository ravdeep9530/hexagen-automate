import React, { useState } from 'react';
import { useRepos, useStartPipeline } from '../../api/pipelinesApi';
import { tokens } from './design';

interface Props {
    onStarted: (run_id: string) => void;
}

type Priority = 'low' | 'medium' | 'high' | 'critical';
type ChangeType = 'feature' | 'bug' | 'refactor' | 'chore' | 'spike';
type DesignPreset = 'material-ui' | 'tailwind-shadcn' | 'custom';
type ReferenceKind = 'website' | 'github';

interface DesignReferenceInput {
    kind: ReferenceKind;
    url: string;
    note: string;
}

interface LaunchForm {
    repo: string;
    repoUrl: string;
    branch: string;
    title: string;
    description: string;
    requester: string;
    priority: Priority;
    changeType: ChangeType;
    stakeholders: string;
    teamVelocity: string;
    sprintCapacity: string;
    targetSprint: string;
    targetDeadline: string;
    designPreset: DesignPreset | null;
    designIdeas: string;
    designReferences: DesignReferenceInput[];
}

const DESIGN_PRESETS: Array<{
    id: DesignPreset;
    label: string;
    blurb: string;
    accent: string;
    bg: string;
    swatch: string[];
    font: string;
}> = [
    {
        id: 'material-ui',
        label: 'Material UI 3',
        blurb: 'Soft blues, elevation, rounded corners. Good fit for admin/CRUD apps.',
        accent: '#1976d2',
        bg: 'linear-gradient(135deg, #e3f2fd 0%, #fce4ec 100%)',
        swatch: ['#1976d2', '#9c27b0', '#ffffff'],
        font: 'Roboto, sans-serif',
    },
    {
        id: 'tailwind-shadcn',
        label: 'Tailwind + shadcn/ui',
        blurb: 'Developer-favorite stack — monochrome, sharp corners, lots of whitespace.',
        accent: '#0f172a',
        bg: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        swatch: ['#0f172a', '#64748b', '#ffffff'],
        font: '"Geist", "Inter", sans-serif',
    },
    {
        id: 'custom',
        label: 'Custom / no preset',
        blurb: 'Skip the preset and describe what you want in your own words below.',
        accent: '#7c3aed',
        bg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
        swatch: ['#7c3aed', '#a78bfa', '#ffffff'],
        font: 'system-ui',
    },
];

const PRIORITY_COLORS: Record<Priority, string> = {
    low:      '#64748b',
    medium:   '#2563eb',
    high:     '#f59e0b',
    critical: '#dc2626',
};

function buildRawRequest(f: LaunchForm): string {
    // Stage 1 (Requirements) reads the raw_request as a single string.
    // We serialize the form into a structured block so the LLM can parse it
    // without needing schema changes upstream.
    const lines: string[] = [];
    lines.push(`# ${f.title}`);
    lines.push('');
    if (f.changeType) lines.push(`Type: ${f.changeType}`);
    if (f.priority) lines.push(`Priority: ${f.priority}`);
    if (f.branch) lines.push(`Target branch: ${f.branch}`);
    if (f.repoUrl) lines.push(`Repo URL: ${f.repoUrl}`);
    if (f.stakeholders) lines.push(`Stakeholders: ${f.stakeholders}`);
    if (f.targetSprint) lines.push(`Target sprint: ${f.targetSprint}`);
    if (f.targetDeadline) lines.push(`Target deadline: ${f.targetDeadline}`);
    if (f.teamVelocity) lines.push(`Team velocity (pts/sprint): ${f.teamVelocity}`);
    if (f.sprintCapacity) lines.push(`Sprint capacity (sprints available): ${f.sprintCapacity}`);
    lines.push('');
    lines.push('## Description');
    lines.push(f.description.trim());
    return lines.join('\n');
}

export function PipelineLaunch({ onStarted }: Props) {
    const { repos, loading: reposLoading } = useRepos();
    const { start, loading: starting, error } = useStartPipeline();
    const [advanced, setAdvanced] = useState(false);

    const [form, setForm] = useState<LaunchForm>({
        repo: '',
        repoUrl: '',
        branch: 'main',
        title: '',
        description: '',
        requester: '',
        priority: 'medium',
        changeType: 'feature',
        stakeholders: '',
        teamVelocity: '30',
        sprintCapacity: '2',
        targetSprint: '',
        targetDeadline: '',
        designPreset: null,
        designIdeas: '',
        designReferences: [],
    });

    function update<K extends keyof LaunchForm>(key: K, val: LaunchForm[K]) {
        setForm(prev => ({ ...prev, [key]: val }));
    }

    // Auto-fill repoUrl when a registry repo is selected
    React.useEffect(() => {
        if (form.repo) {
            const match = repos.find(r => r.repo_full_name === form.repo);
            if (match?.repo_url && !form.repoUrl) update('repoUrl', match.repo_url);
            if (match?.default_branch && (!form.branch || form.branch === 'main')) update('branch', match.default_branch);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.repo, repos]);

    const canStart = !!form.repo && !!form.title.trim() && !!form.description.trim() && !starting;

    async function handleStart() {
        if (!canStart) return;
        const raw = buildRawRequest(form);
        // Only send design_preferences if the user actually filled something in.
        const cleanedRefs = form.designReferences
            .map(r => ({ kind: r.kind, url: r.url.trim(), note: r.note.trim() || undefined }))
            .filter(r => r.url.length > 0);
        const designPrefs = (form.designPreset || form.designIdeas.trim() || cleanedRefs.length > 0)
            ? {
                preset: form.designPreset,
                ideas: form.designIdeas.trim() || undefined,
                references: cleanedRefs.length > 0 ? cleanedRefs : undefined,
            }
            : null;
        try {
            const { run_id } = await start({
                repo: form.repo,
                raw_request: raw,
                requester_id: form.requester.trim() || 'ui',
                design_preferences: designPrefs,
            });
            onStarted(run_id);
        } catch { /* error already in state */ }
    }

    function addReference(kind: ReferenceKind) {
        update('designReferences', [...form.designReferences, { kind, url: '', note: '' }]);
    }
    function updateReference(i: number, patch: Partial<DesignReferenceInput>) {
        update('designReferences', form.designReferences.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    }
    function removeReference(i: number) {
        update('designReferences', form.designReferences.filter((_, idx) => idx !== i));
    }

    return (
        <div style={{ maxWidth: 780, margin: '0 auto', padding: 24 }}>
            <header style={{ marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: tokens.color.text }}>
                    Start a new SDLC pipeline
                </h2>
                <p style={{ color: tokens.color.textMuted, marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>
                    7 stages — Requirements → Optimize → Plan → Design → Sprint → Implementation → Test — with human approval between each.
                </p>
            </header>

            {/* Required fields */}
            <Section title="What & where">
                <Field label="Repository" required>
                    <select
                        className="pl-input"
                        value={form.repo}
                        onChange={e => update('repo', e.target.value)}
                        disabled={reposLoading || repos.length === 0}
                        style={inputStyle()}
                    >
                        <option value="">{reposLoading ? 'loading repos…' : repos.length === 0 ? 'no repos registered' : '— select a repo —'}</option>
                        {repos.map(r => (
                            <option key={r.repo_full_name} value={r.repo_full_name}>{r.repo_full_name}</option>
                        ))}
                    </select>
                </Field>

                <Row>
                    <Field label="Branch">
                        <input
                            className="pl-input"
                            type="text"
                            value={form.branch}
                            onChange={e => update('branch', e.target.value)}
                            style={inputStyle()}
                            placeholder="main"
                        />
                    </Field>
                    <Field label="Change type">
                        <select
                            className="pl-input"
                            value={form.changeType}
                            onChange={e => update('changeType', e.target.value as ChangeType)}
                            style={inputStyle()}
                        >
                            <option value="feature">✨ Feature</option>
                            <option value="bug">🐛 Bug fix</option>
                            <option value="refactor">♻️ Refactor</option>
                            <option value="chore">🧹 Chore</option>
                            <option value="spike">🔬 Spike</option>
                        </select>
                    </Field>
                </Row>
            </Section>

            <Section title="The ask">
                <Field label="Title" required>
                    <input
                        className="pl-input"
                        type="text"
                        value={form.title}
                        onChange={e => update('title', e.target.value)}
                        style={inputStyle()}
                        placeholder="Add OAuth login to the customer portal"
                        maxLength={140}
                    />
                </Field>

                <Field label="Description" required>
                    <textarea
                        className="pl-input"
                        value={form.description}
                        onChange={e => update('description', e.target.value)}
                        rows={6}
                        style={{ ...inputStyle(), fontFamily: tokens.font.body, resize: 'vertical' }}
                        placeholder={`Describe what to build, who it's for, and what success looks like.\n\nExample: Customers should be able to sign in with Google or Microsoft OIDC. After login, redirect to dashboard. Existing email/password must keep working.`}
                    />
                </Field>

                <Row>
                    <Field label="Priority">
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                            {(['low','medium','high','critical'] as Priority[]).map(p => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => update('priority', p)}
                                    style={{
                                        flex: 1,
                                        padding: '8px 6px',
                                        border: `1px solid ${form.priority === p ? PRIORITY_COLORS[p] : tokens.color.border}`,
                                        background: form.priority === p ? `${PRIORITY_COLORS[p]}18` : 'white',
                                        color: form.priority === p ? PRIORITY_COLORS[p] : tokens.color.text,
                                        borderRadius: tokens.radius.sm,
                                        cursor: 'pointer',
                                        fontWeight: form.priority === p ? 600 : 400,
                                        fontSize: 13,
                                        textTransform: 'capitalize',
                                    }}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label="Requested by">
                        <input
                            className="pl-input"
                            type="text"
                            value={form.requester}
                            onChange={e => update('requester', e.target.value)}
                            style={inputStyle()}
                            placeholder="your name / email"
                        />
                    </Field>
                </Row>
            </Section>

            {/* === Design preferences === */}
            <Section title="Design preferences (optional — used by stages 1, 4, 6)">
                <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: -4, marginBottom: 12 }}>
                    Pick a starting design language, drop in any ideas, and link references the agent should mimic.
                </div>

                {/* Preset cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 10, marginTop: 4,
                }}>
                    {DESIGN_PRESETS.map(p => {
                        const selected = form.designPreset === p.id;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => update('designPreset', selected ? null : p.id)}
                                style={{
                                    textAlign: 'left',
                                    padding: 14,
                                    background: selected ? p.bg : 'white',
                                    border: `2px solid ${selected ? p.accent : tokens.color.border}`,
                                    borderRadius: tokens.radius.md,
                                    cursor: 'pointer',
                                    transition: 'all .15s',
                                    boxShadow: selected ? `0 6px 18px ${p.accent}33` : tokens.shadow.sm,
                                    transform: selected ? 'translateY(-1px)' : 'none',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                            >
                                {selected ? (
                                    <span style={{
                                        position: 'absolute', top: 8, right: 10,
                                        background: p.accent, color: 'white',
                                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                                        padding: '2px 8px', borderRadius: tokens.radius.pill,
                                    }}>SELECTED</span>
                                ) : null}
                                <div style={{
                                    display: 'flex', gap: 4, marginBottom: 8,
                                }}>
                                    {p.swatch.map((c, i) => (
                                        <span key={i} style={{
                                            width: 18, height: 18, borderRadius: 4,
                                            background: c, border: '1px solid rgba(0,0,0,0.08)',
                                        }} />
                                    ))}
                                </div>
                                <div style={{
                                    fontSize: 14, fontWeight: 700, color: tokens.color.text,
                                    marginBottom: 4,
                                    fontFamily: p.font,
                                }}>{p.label}</div>
                                <div style={{ fontSize: 11, color: tokens.color.textMuted, lineHeight: 1.4 }}>
                                    {p.blurb}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Ideas textarea */}
                <Field label="Design ideas / notes">
                    <textarea
                        className="pl-input"
                        value={form.designIdeas}
                        onChange={e => update('designIdeas', e.target.value)}
                        rows={3}
                        placeholder={`Anything you want the design agent to keep in mind:\n• Brand colors: brand purple #6d28d9, off-white background\n• Tone: friendly, clean, minimal animation\n• Must look great on mobile`}
                        style={{ ...inputStyle(), fontFamily: tokens.font.body, resize: 'vertical' }}
                    />
                </Field>

                {/* References list */}
                <Field label="References (websites or GitHub repos to mimic)">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {form.designReferences.map((ref, i) => (
                            <div key={i} style={{
                                display: 'flex', gap: 6, alignItems: 'flex-start',
                                padding: 8, background: tokens.color.slateSoft,
                                borderRadius: tokens.radius.sm,
                                border: `1px solid ${tokens.color.border}`,
                            }}>
                                <select
                                    className="pl-input"
                                    value={ref.kind}
                                    onChange={e => updateReference(i, { kind: e.target.value as ReferenceKind })}
                                    style={{ ...inputStyle(), width: 110, flexShrink: 0 }}
                                >
                                    <option value="website">🌐 Website</option>
                                    <option value="github">🐙 GitHub</option>
                                </select>
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <input
                                        className="pl-input"
                                        type="url"
                                        value={ref.url}
                                        onChange={e => updateReference(i, { url: e.target.value })}
                                        placeholder={ref.kind === 'github' ? 'https://github.com/shadcn-ui/ui' : 'https://linear.app'}
                                        style={inputStyle()}
                                    />
                                    <input
                                        className="pl-input"
                                        type="text"
                                        value={ref.note}
                                        onChange={e => updateReference(i, { note: e.target.value })}
                                        placeholder="what to take from it (optional) — e.g. 'sidebar nav style'"
                                        style={{ ...inputStyle(), fontSize: 12 }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeReference(i)}
                                    title="Remove"
                                    style={{
                                        background: 'transparent', border: `1px solid ${tokens.color.border}`,
                                        color: tokens.color.danger, cursor: 'pointer',
                                        padding: '6px 10px', borderRadius: tokens.radius.sm,
                                        fontSize: 14, flexShrink: 0,
                                    }}
                                >×</button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                            <button
                                type="button"
                                onClick={() => addReference('website')}
                                style={{
                                    background: 'white', border: `1px dashed ${tokens.color.borderStrong}`,
                                    color: tokens.color.text, cursor: 'pointer',
                                    padding: '6px 12px', borderRadius: tokens.radius.sm,
                                    fontSize: 12, fontWeight: 500,
                                }}
                            >+ Add website</button>
                            <button
                                type="button"
                                onClick={() => addReference('github')}
                                style={{
                                    background: 'white', border: `1px dashed ${tokens.color.borderStrong}`,
                                    color: tokens.color.text, cursor: 'pointer',
                                    padding: '6px 12px', borderRadius: tokens.radius.sm,
                                    fontSize: 12, fontWeight: 500,
                                }}
                            >+ Add GitHub repo</button>
                        </div>
                    </div>
                </Field>
            </Section>

            <button
                type="button"
                onClick={() => setAdvanced(v => !v)}
                style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: tokens.color.primary, fontSize: 13, padding: 0, marginBottom: 12,
                }}
            >
                {advanced ? '▾' : '▸'} Advanced (stakeholders, sprint planning context)
            </button>

            {advanced ? (
                <div className="pl-fade-in">
                    <Section title="Planning context (optional, used by Stage 5)">
                        <Field label="Stakeholders">
                            <input
                                className="pl-input"
                                type="text"
                                value={form.stakeholders}
                                onChange={e => update('stakeholders', e.target.value)}
                                style={inputStyle()}
                                placeholder="customer-success-lead, security@company.com"
                            />
                        </Field>
                        <Row>
                            <Field label="Team velocity (pts/sprint)">
                                <input
                                    className="pl-input"
                                    type="number"
                                    min="1"
                                    value={form.teamVelocity}
                                    onChange={e => update('teamVelocity', e.target.value)}
                                    style={inputStyle()}
                                />
                            </Field>
                            <Field label="Sprint capacity (# sprints)">
                                <input
                                    className="pl-input"
                                    type="number"
                                    min="1"
                                    value={form.sprintCapacity}
                                    onChange={e => update('sprintCapacity', e.target.value)}
                                    style={inputStyle()}
                                />
                            </Field>
                        </Row>
                        <Row>
                            <Field label="Target sprint">
                                <input
                                    className="pl-input"
                                    type="text"
                                    value={form.targetSprint}
                                    onChange={e => update('targetSprint', e.target.value)}
                                    style={inputStyle()}
                                    placeholder="Sprint 24"
                                />
                            </Field>
                            <Field label="Target deadline">
                                <input
                                    className="pl-input"
                                    type="date"
                                    value={form.targetDeadline}
                                    onChange={e => update('targetDeadline', e.target.value)}
                                    style={inputStyle()}
                                />
                            </Field>
                        </Row>
                    </Section>
                </div>
            ) : null}

            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
                <button
                    className="pl-btn-primary"
                    onClick={handleStart}
                    disabled={!canStart}
                    style={{
                        background: tokens.color.primary, color: 'white',
                        border: 'none', padding: '12px 28px',
                        borderRadius: tokens.radius.md, fontSize: 14, fontWeight: 600,
                        cursor: canStart ? 'pointer' : 'not-allowed',
                        opacity: canStart ? 1 : 0.5,
                        boxShadow: tokens.shadow.md,
                        transition: 'all .15s',
                    }}
                >
                    {starting ? 'Starting…' : '▶ Start pipeline'}
                </button>
                {error ? (
                    <span style={{
                        color: tokens.color.danger, fontSize: 13,
                        background: tokens.color.dangerSoft, padding: '6px 12px',
                        borderRadius: tokens.radius.sm,
                    }}>{error}</span>
                ) : null}
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={{
            background: tokens.color.card,
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.border}`,
            padding: 20,
            marginBottom: 16,
            boxShadow: tokens.shadow.sm,
        }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 600, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {title}
            </h3>
            {children}
        </section>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div style={{ marginTop: 12, flex: 1, minWidth: 0 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: tokens.color.text, marginBottom: 4 }}>
                {label} {required && <span style={{ color: tokens.color.danger }}>*</span>}
            </label>
            {children}
        </div>
    );
}

function Row({ children }: { children: React.ReactNode }) {
    return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>;
}

function inputStyle(): React.CSSProperties {
    return {
        width: '100%',
        padding: '8px 10px',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.sm,
        fontSize: 14,
        color: tokens.color.text,
        background: 'white',
        fontFamily: tokens.font.body,
        boxSizing: 'border-box',
    };
}
