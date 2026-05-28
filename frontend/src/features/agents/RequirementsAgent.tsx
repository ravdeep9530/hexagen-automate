import React, { useState } from 'react';
import { useRequirementsAgent } from '../../api/agentApi';
import { I } from '../../icons';

export const RequirementsAgent: React.FC = () => {
    const { result, loading, error, optimize } = useRequirementsAgent();
    const [rawRequirements, setRawRequirements] = useState('');
    const [projectContext, setProjectContext] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await optimize(rawRequirements, projectContext).catch(console.error);
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Requirements Agent</h1>
                    <p className="page-header__subtitle">Transform raw requirements into structured user stories with acceptance criteria. Identifies gaps, ambiguities, and suggests improvements.</p>
                </div>
            </div>

            <div className="card mb-12">
                <div className="card__hd"><I.Requirements size={15}/><h3>Input</h3></div>
                <div className="card__bd">
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                            <div className="form-row">
                                <label>Raw Requirements</label>
                                <textarea className="textarea" value={rawRequirements} onChange={e => setRawRequirements(e.target.value)}
                                    rows={8} placeholder="Paste your raw requirements here..." required />
                            </div>
                            <div className="form-row">
                                <label>Project Context <span className="opt">optional</span></label>
                                <textarea className="textarea" value={projectContext} onChange={e => setProjectContext(e.target.value)}
                                    rows={3} placeholder="Existing system context, tech stack, constraints..." />
                            </div>
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={loading}>
                            <I.Sparkles size={14}/>{loading ? 'Optimizing…' : 'Optimize Requirements'}
                        </button>
                    </form>
                </div>
            </div>

            {error && (
                <div className="card mb-12" style={{ borderColor: 'var(--danger)' }}>
                    <div className="card__bd" style={{ color: 'var(--danger-fg)', fontSize: 13, display: 'flex', gap: 6 }}>
                        <I.Alert size={14}/> {error.message}
                    </div>
                </div>
            )}

            {result && (<>
                <div className="card mb-12">
                    <div className="card__hd">
                        <I.CheckCircle size={15}/>
                        <h3>User Stories</h3>
                        <span className="pill ml-auto">{result.userStories.length}</span>
                    </div>
                    <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {result.userStories.map(story => (
                            <div key={story.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', padding: '10px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <b style={{ fontSize: 13, flex: 1 }}>{story.title}</b>
                                    <span className="pill" style={{
                                        background: story.priority === 'high' ? 'var(--danger-50)' : story.priority === 'medium' ? 'var(--warning-50)' : 'var(--success-50)',
                                        color: story.priority === 'high' ? 'var(--danger-fg)' : story.priority === 'medium' ? 'var(--warning-fg)' : 'var(--success-fg)',
                                    }}>{story.priority}</span>
                                </div>
                                <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-2)' }}>{story.description}</p>
                                <div className="section-label" style={{ marginBottom: 4 }}>Acceptance Criteria</div>
                                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {story.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                {result.gaps.length > 0 && (
                    <div className="card mb-12" style={{ borderColor: 'var(--warning)' }}>
                        <div className="card__hd" style={{ background: 'var(--warning-50)' }}>
                            <I.Alert size={15} style={{ color: 'var(--warning)' }}/><h3>Identified Gaps</h3>
                        </div>
                        <div className="card__bd">
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.gaps.map((g, i) => <li key={i}>{g}</li>)}
                            </ul>
                        </div>
                    </div>
                )}

                {result.ambiguities.length > 0 && (
                    <div className="card mb-12" style={{ borderColor: 'var(--warning)' }}>
                        <div className="card__hd" style={{ background: 'var(--warning-50)' }}>
                            <I.Question size={15} style={{ color: 'var(--warning)' }}/><h3>Ambiguities</h3>
                        </div>
                        <div className="card__bd">
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.ambiguities.map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                        </div>
                    </div>
                )}

                {result.suggestions.length > 0 && (
                    <div className="card mb-12" style={{ borderColor: 'var(--info)' }}>
                        <div className="card__hd" style={{ background: 'var(--info-50)' }}>
                            <I.Sparkles size={15} style={{ color: 'var(--info)' }}/><h3>Suggestions</h3>
                        </div>
                        <div className="card__bd">
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                        </div>
                    </div>
                )}
            </>)}
        </div>
    );
};
