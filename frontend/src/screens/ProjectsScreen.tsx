import React, { useState } from 'react';
import { I } from '../icons';
import { useCreateProject, useDeleteProject, type Project } from '../api/orgsApi';
import { useOrgProject } from '../contexts/OrgProjectContext';

interface Props {
    onSelectProject: (project: Project) => void;
}

export const ProjectsScreen: React.FC<Props> = ({ onSelectProject }) => {
    const { activeOrg, projects, loading, activeProject, setActiveProject, refetchProjects } = useOrgProject();
    const { create, loading: creating, error: createError } = useCreateProject(activeOrg?.id ?? null);
    const { remove, loading: deleting } = useDeleteProject(activeOrg?.id ?? null);

    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [repoUrl, setRepoUrl] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setFormError('Name is required'); return; }
        setFormError(null);
        try {
            const proj = await create({
                name: name.trim(),
                description: description.trim() || undefined,
                repo_url: repoUrl.trim() || undefined,
            });
            setName('');
            setDescription('');
            setRepoUrl('');
            setShowForm(false);
            await refetchProjects();
            setActiveProject(proj);
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
                    <button className="btn btn--primary btn--sm" onClick={() => { setShowForm(v => !v); setFormError(null); }}>
                        <I.Plus size={14}/> New Project
                    </button>
                </div>
            </div>

            {deleteError && <div className="alert alert--error">{deleteError}</div>}

            {showForm && (
                <div className="int-card" style={{ marginBottom: 16 }}>
                    <form onSubmit={handleCreate}>
                        <div className="form-row">
                            <label>Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                className="input"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Customer Portal"
                                autoFocus
                            />
                        </div>
                        <div className="form-row" style={{ marginTop: 10 }}>
                            <label>Description</label>
                            <input
                                className="input"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Optional description"
                            />
                        </div>
                        <div className="form-row" style={{ marginTop: 10 }}>
                            <label>Repository URL</label>
                            <input
                                className="input"
                                value={repoUrl}
                                onChange={e => setRepoUrl(e.target.value)}
                                placeholder="https://github.com/org/repo"
                            />
                        </div>
                        {(formError || createError) && (
                            <div className="alert alert--error" style={{ marginTop: 8 }}>{formError || createError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                            <button type="submit" className="btn btn--primary btn--sm" disabled={creating}>
                                {creating ? 'Creating…' : 'Create Project'}
                            </button>
                            <button type="button" className="btn btn--sm" onClick={() => { setShowForm(false); setFormError(null); setName(''); setDescription(''); setRepoUrl(''); }}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading && <div className="empty-state"><p>Loading…</p></div>}

            {!loading && projects.length === 0 && !showForm && (
                <div className="empty-state">
                    <I.Folder size={32} style={{ opacity: 0.3, marginBottom: 8 }}/>
                    <p>No projects yet in <strong>{activeOrg.name}</strong>. Create one to get started.</p>
                </div>
            )}

            <div className="int-grid">
                {projects.map(proj => {
                    const isActive = activeProject?.id === proj.id;
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
                                {isActive && (
                                    <span className="pill pill--approved"><span className="pill__dot"/> Active</span>
                                )}
                            </div>

                            {proj.description && (
                                <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px 0 0' }}>{proj.description}</p>
                            )}

                            <dl className="int-card__meta">
                                <dt>Pipelines</dt><dd>{proj.pipeline_count ?? 0}</dd>
                                <dt>Repos</dt><dd>{proj.repo_count ?? 0}</dd>
                                <dt>Created</dt><dd>{new Date(proj.created_at).toLocaleDateString()}</dd>
                                {proj.repo_url && <><dt>Repo</dt><dd style={{ fontFamily: 'monospace', fontSize: 11 }}>{proj.repo_url}</dd></>}
                            </dl>

                            <div className="int-card__actions">
                                <button
                                    className="btn btn--primary btn--sm"
                                    onClick={() => onSelectProject(proj)}
                                >
                                    <I.Pipeline size={13}/> Open Pipelines
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
        </div>
    );
};
