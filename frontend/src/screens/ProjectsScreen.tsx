import React, { useEffect, useState } from 'react';
import { I } from '../icons';
import { useCreateProject, useDeleteProject, type Project } from '../api/orgsApi';
import { useIntegrations } from '../api/agentApi';
import { useOrgProject } from '../contexts/OrgProjectContext';

interface Props {
    onSelectProject: (project: Project) => void;
}

export const ProjectsScreen: React.FC<Props> = ({ onSelectProject }) => {
    const { activeOrg, projects, loading, activeProject, setActiveProject, refetchProjects } = useOrgProject();
    const { create, loading: creating } = useCreateProject(activeOrg?.id ?? null);
    const { remove, loading: deleting } = useDeleteProject(activeOrg?.id ?? null);
    const { connections, fetchConnections } = useIntegrations(activeOrg?.id);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [projectType, setProjectType] = useState<'new' | 'existing'>('new');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [selectedConnectionId, setSelectedConnectionId] = useState('');
    const [repoUrl, setRepoUrl] = useState('');
    const [validating, setValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<{ success: boolean; message: string } | null>(null);
    const [formError, setFormError] = useState<string | null>(null);

    const [deleteError, setDeleteError] = useState<string | null>(null);

    const githubConnections = connections.filter(c => c.type === 'github' && c.status === 'active');

    useEffect(() => {
        if (showModal) fetchConnections();
    }, [showModal, fetchConnections]);

    const openModal = () => {
        setStep(1);
        setProjectType('new');
        setName('');
        setDescription('');
        setSelectedConnectionId('');
        setRepoUrl('');
        setValidationResult(null);
        setFormError(null);
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setFormError(null);
        setValidationResult(null);
    };

    const handleValidate = async () => {
        if (!selectedConnectionId) { setFormError('Select a GitHub connection first'); return; }
        if (!repoUrl.trim()) { setFormError('Repository URL is required'); return; }
        setFormError(null);
        setValidating(true);
        setValidationResult(null);
        try {
            const r = await fetch(`/api/orgs/${activeOrg?.id}/integrations/${selectedConnectionId}/test`, { method: 'POST' });
            const data = await r.json();
            setValidationResult(data);
        } catch {
            setValidationResult({ success: false, message: 'Validation request failed. Check your connection.' });
        } finally {
            setValidating(false);
        }
    };

    const handleCreate = async () => {
        if (!name.trim()) { setFormError('Project name is required'); return; }
        if (!repoUrl.trim()) { setFormError('Repository URL is required'); return; }
        if (!selectedConnectionId) { setFormError('Select a GitHub connection'); return; }
        if (!validationResult?.success) { setFormError('Please validate your GitHub connection first'); return; }
        setFormError(null);
        try {
            const proj = await create({
                name: name.trim(),
                description: description.trim() || undefined,
                repo_url: repoUrl.trim(),
                github_connection_id: selectedConnectionId,
                project_type: projectType,
            });
            await refetchProjects();
            setActiveProject(proj);
            closeModal();
            onSelectProject(proj);
        } catch (err) {
            setFormError((err as Error).message);
        }
    };

    const handleDelete = async (proj: Project) => {
        if (!window.confirm(`Delete "${proj.name}"? This cannot be undone.`)) return;
        setDeleteError(null);
        try {
            await remove(proj.id);
            await refetchProjects();
        } catch (err) {
            setDeleteError((err as Error).message);
        }
    };

    if (!activeOrg) {
        return (
            <div className="page">
                <div className="empty-state">
                    <I.Layers size={32} style={{ opacity: 0.3, marginBottom: 8 }}/>
                    <p>No organization selected. Go to Organizations and select one first.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Projects</h1>
                    <p className="page-header__subtitle">Projects in <strong>{activeOrg.name}</strong></p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary btn--sm" onClick={openModal}>
                        <I.Plus size={14}/> New Project
                    </button>
                </div>
            </div>

            {deleteError && <div className="alert alert--error">{deleteError}</div>}
            {loading && <div className="empty-state"><p>Loading…</p></div>}

            {!loading && projects.length === 0 && (
                <div className="empty-state">
                    <I.Folder size={32} style={{ opacity: 0.3, marginBottom: 8 }}/>
                    <p>No projects yet in <strong>{activeOrg.name}</strong>. Create one to get started.</p>
                </div>
            )}

            <div className="int-grid">
                {projects.map(proj => {
                    const isActive = activeProject?.id === proj.id;
                    const analysisStatus = (proj.config as any)?.analysis_status as string | undefined;
                    const isSyncing = analysisStatus === 'pending' || analysisStatus === 'running';
                    return (
                        <div key={proj.id} className={'int-card' + (isActive ? ' int-card--active' : '')}>
                            <div className="int-card__hd">
                                <div className="int-card__logo" style={{ background: 'var(--neutral-50)', color: 'var(--text-2)' }}>
                                    <I.Folder size={18}/>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="int-card__name">{proj.name}</div>
                                    <div className="int-card__type">{proj.slug ?? proj.id.slice(0, 8)}</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {isSyncing && (
                                        <span className="pill" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                            <div className="ghpr-spinner dark" style={{ width: 10, height: 10, flexShrink: 0 }}/>
                                            Syncing
                                        </span>
                                    )}
                                    {proj.project_type === 'existing' && (
                                        <span className="pill pill--skipped">Existing</span>
                                    )}
                                    {isActive && (
                                        <span className="pill pill--approved"><span className="pill__dot"/> Active</span>
                                    )}
                                </div>
                            </div>

                            {proj.description && (
                                <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px 0 0' }}>{proj.description}</p>
                            )}

                            <dl className="int-card__meta">
                                <dt>Pipelines</dt><dd>{proj.pipeline_count ?? 0}</dd>
                                <dt>Repos</dt><dd>{proj.repo_count ?? 0}</dd>
                                <dt>Created</dt><dd>{new Date(proj.created_at).toLocaleDateString()}</dd>
                                {proj.repo_url && <><dt>Repo</dt><dd style={{ fontFamily: 'monospace', fontSize: 11 }}>{proj.repo_url.replace('https://github.com/', '')}</dd></>}
                            </dl>

                            <div className="int-card__actions">
                                <button
                                    className="btn btn--primary btn--sm"
                                    onClick={() => onSelectProject(proj)}
                                >
                                    <I.Dashboard size={13}/> Open Overview
                                </button>
                                {!isActive && (
                                    <button
                                        className="btn btn--sm"
                                        onClick={() => setActiveProject(proj)}
                                    >
                                        Set Active
                                    </button>
                                )}
                                <button
                                    className="btn btn--danger btn--sm"
                                    onClick={() => handleDelete(proj)}
                                    disabled={deleting || (proj.pipeline_count ?? 0) > 0}
                                    title={(proj.pipeline_count ?? 0) > 0 ? 'Cannot delete project with pipeline runs' : 'Delete project'}
                                >
                                    <I.Trash size={13}/>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Create Project Modal ── */}
            {showModal && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 999,
                        background: 'rgba(0,0,0,0.5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
                >
                    <div style={{
                        background: 'var(--surface)',
                        borderRadius: 12,
                        padding: 28,
                        width: 520,
                        maxWidth: '95vw',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                    }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Create Project</h2>
                                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
                                    Step {step} of 3 — {step === 1 ? 'Project type' : step === 2 ? 'Details' : 'GitHub repository'}
                                </p>
                            </div>
                            <button
                                className="btn btn--sm"
                                style={{ padding: '4px 8px' }}
                                onClick={closeModal}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Step 1: Project type */}
                        {step === 1 && (
                            <div>
                                <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
                                    Is this a brand-new project or an existing codebase?
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    {([
                                        {
                                            key: 'new' as const,
                                            title: 'New Project',
                                            icon: '✨',
                                            desc: 'Start fresh. Use AI pipelines to build your first feature from scratch.',
                                        },
                                        {
                                            key: 'existing' as const,
                                            title: 'Existing Project',
                                            icon: '🔍',
                                            desc: 'Link an existing codebase. Claude will analyze it and populate your Overview.',
                                        },
                                    ] as const).map(opt => (
                                        <button
                                            key={opt.key}
                                            onClick={() => { setProjectType(opt.key); setStep(2); }}
                                            style={{
                                                textAlign: 'left',
                                                padding: 16,
                                                borderRadius: 8,
                                                border: `2px solid ${projectType === opt.key ? 'var(--primary)' : 'var(--border)'}`,
                                                background: projectType === opt.key ? 'var(--primary-50, #eff6ff)' : 'var(--surface)',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <div style={{ fontSize: 22, marginBottom: 8 }}>{opt.icon}</div>
                                            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{opt.title}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Step 2: Name and description */}
                        {step === 2 && (
                            <div>
                                <div className="form-row">
                                    <label>Project Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                                    <input
                                        className="input"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        placeholder="e.g. Customer Portal"
                                        autoFocus
                                    />
                                </div>
                                <div className="form-row" style={{ marginTop: 12 }}>
                                    <label>Description <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
                                    <input
                                        className="input"
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="Brief description of the project"
                                    />
                                </div>
                                {formError && <div className="alert alert--error" style={{ marginTop: 12 }}>{formError}</div>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                                    <button className="btn btn--sm" onClick={() => { setStep(1); setFormError(null); }}>← Back</button>
                                    <button
                                        className="btn btn--primary btn--sm"
                                        onClick={() => {
                                            if (!name.trim()) { setFormError('Project name is required'); return; }
                                            setFormError(null);
                                            setStep(3);
                                        }}
                                    >
                                        Next →
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 3: GitHub linking */}
                        {step === 3 && (
                            <div>
                                <div className="form-row">
                                    <label>GitHub Connection <span style={{ color: 'var(--danger)' }}>*</span></label>
                                    {githubConnections.length === 0 ? (
                                        <div className="alert alert--error" style={{ marginTop: 4 }}>
                                            No active GitHub connections found. Add one in the Integrations page first.
                                        </div>
                                    ) : (
                                        <select
                                            className="input"
                                            value={selectedConnectionId}
                                            onChange={e => { setSelectedConnectionId(e.target.value); setValidationResult(null); }}
                                        >
                                            <option value="">— Select a GitHub connection —</option>
                                            {githubConnections.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                <div className="form-row" style={{ marginTop: 12 }}>
                                    <label>Repository URL <span style={{ color: 'var(--danger)' }}>*</span></label>
                                    <input
                                        className="input"
                                        value={repoUrl}
                                        onChange={e => { setRepoUrl(e.target.value); setValidationResult(null); }}
                                        placeholder="https://github.com/owner/repository"
                                    />
                                </div>

                                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <button
                                        className="btn btn--sm"
                                        onClick={handleValidate}
                                        disabled={validating || !selectedConnectionId || !repoUrl.trim()}
                                    >
                                        {validating ? 'Validating…' : 'Validate Connection'}
                                    </button>
                                    {validationResult && (
                                        <span style={{
                                            fontSize: 13,
                                            color: validationResult.success ? 'var(--success, #16a34a)' : 'var(--danger)',
                                            display: 'flex', alignItems: 'center', gap: 4,
                                        }}>
                                            {validationResult.success ? '✓' : '✕'} {validationResult.message}
                                        </span>
                                    )}
                                </div>

                                {!validationResult?.success && validationResult !== null && (
                                    <div className="alert alert--error" style={{ marginTop: 8 }}>
                                        GitHub access validation failed. Check your connection and repository URL.
                                    </div>
                                )}

                                {projectType === 'existing' && (
                                    <div style={{
                                        marginTop: 12,
                                        padding: '10px 14px',
                                        background: 'var(--neutral-50)',
                                        borderRadius: 6,
                                        fontSize: 12,
                                        color: 'var(--text-2)',
                                        lineHeight: 1.6,
                                    }}>
                                        🔍 After creation, Claude will automatically analyze your repository — reading its structure, README, and key files — to populate the Overview page.
                                    </div>
                                )}

                                {formError && <div className="alert alert--error" style={{ marginTop: 10 }}>{formError}</div>}

                                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                                    <button className="btn btn--sm" onClick={() => { setStep(2); setFormError(null); }}>← Back</button>
                                    <button
                                        className="btn btn--primary btn--sm"
                                        onClick={handleCreate}
                                        disabled={creating || !validationResult?.success}
                                        title={!validationResult?.success ? 'Validate your GitHub connection first' : undefined}
                                    >
                                        {creating ? 'Creating…' : 'Create Project'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
