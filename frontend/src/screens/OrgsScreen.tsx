import React, { useState } from 'react';
import { I } from '../icons';
import { useOrgs, useCreateOrg, useDeleteOrg, type Organization } from '../api/orgsApi';
import { useOrgProject } from '../contexts/OrgProjectContext';

interface Props {
    onSelectOrg: (org: Organization) => void;
}

export const OrgsScreen: React.FC<Props> = ({ onSelectOrg }) => {
    const { orgs, loading, error, refetch } = useOrgs();
    const { create, loading: creating, error: createError } = useCreateOrg();
    const { remove, loading: deleting } = useDeleteOrg();
    const { activeOrg, setActiveOrg } = useOrgProject();

    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setFormError('Name is required'); return; }
        setFormError(null);
        try {
            const org = await create({ name: name.trim(), description: description.trim() || undefined });
            setName('');
            setDescription('');
            setShowForm(false);
            await refetch();
            setActiveOrg(org);
        } catch (err) {
            setFormError((err as Error).message);
        }
    };

    const handleDelete = async (org: Organization) => {
        if (!window.confirm(`Delete "${org.name}"? This cannot be undone.`)) return;
        setDeleteError(null);
        try {
            await remove(org.id);
            await refetch();
        } catch (err) {
            setDeleteError((err as Error).message);
        }
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Organizations</h1>
                    <p className="page-header__subtitle">Group projects and resources by organization.</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary btn--sm" onClick={() => { setShowForm(v => !v); setFormError(null); }}>
                        <I.Plus size={14}/> New Organization
                    </button>
                </div>
            </div>

            {(error || deleteError) && (
                <div className="alert alert--error">{error || deleteError}</div>
            )}

            {showForm && (
                <div className="int-card" style={{ marginBottom: 16 }}>
                    <form onSubmit={handleCreate}>
                        <div className="form-row">
                            <label>Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input
                                className="input"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Acme Corp"
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
                        {(formError || createError) && (
                            <div className="alert alert--error" style={{ marginTop: 8 }}>{formError || createError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                            <button type="submit" className="btn btn--primary btn--sm" disabled={creating}>
                                {creating ? 'Creating…' : 'Create Organization'}
                            </button>
                            <button type="button" className="btn btn--sm" onClick={() => { setShowForm(false); setFormError(null); setName(''); setDescription(''); }}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading && <div className="empty-state"><p>Loading…</p></div>}

            {!loading && orgs.length === 0 && !showForm && (
                <div className="empty-state">
                    <I.Layers size={32} style={{ opacity: 0.3, marginBottom: 8 }}/>
                    <p>No organizations yet. Create one to get started.</p>
                </div>
            )}

            <div className="int-grid">
                {orgs.map(org => {
                    const isActive = activeOrg?.id === org.id;
                    return (
                        <div key={org.id} className={'int-card' + (isActive ? ' int-card--active' : '')}>
                            <div className="int-card__hd">
                                <div className="int-card__logo" style={{ background: 'var(--primary-50)', color: 'var(--primary)' }}>
                                    <I.Layers size={18}/>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="int-card__name">{org.name}</div>
                                    <div className="int-card__type">{org.slug}</div>
                                </div>
                                {isActive && (
                                    <span className="pill pill--approved"><span className="pill__dot"/> Active</span>
                                )}
                            </div>

                            {org.description && (
                                <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px 0 0' }}>{org.description}</p>
                            )}

                            <dl className="int-card__meta">
                                <dt>Projects</dt><dd>{org.project_count ?? 0}</dd>
                                <dt>Created</dt><dd>{new Date(org.created_at).toLocaleDateString()}</dd>
                            </dl>

                            <div className="int-card__actions">
                                <button
                                    className="btn btn--primary btn--sm"
                                    onClick={() => onSelectOrg(org)}
                                >
                                    <I.Folder size={13}/> View Projects
                                </button>
                                {!isActive && (
                                    <button
                                        className="btn btn--sm"
                                        onClick={() => setActiveOrg(org)}
                                    >
                                        Set Active
                                    </button>
                                )}
                                <button
                                    className="btn btn--danger btn--sm"
                                    onClick={() => handleDelete(org)}
                                    disabled={deleting || (org.project_count ?? 0) > 0}
                                    title={(org.project_count ?? 0) > 0 ? 'Cannot delete org with projects' : 'Delete organization'}
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
