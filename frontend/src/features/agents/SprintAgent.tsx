import React, { useState } from 'react';
import { useSprintAgent } from '../../api/agentApi';
import { I } from '../../icons';

export const SprintAgent: React.FC = () => {
    const { result, loading, error, plan } = useSprintAgent();
    const [epicDescription, setEpicDescription] = useState('');
    const [teamCapacity, setTeamCapacity] = useState(160);
    const [sprintDuration, setSprintDuration] = useState(2);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await plan(epicDescription, teamCapacity, sprintDuration).catch(console.error);
    };

    const riskColor = (risk: string) => ({
        high: { bg: 'var(--danger-50)', fg: 'var(--danger-fg)' },
        medium: { bg: 'var(--warning-50)', fg: 'var(--warning-fg)' },
        low: { bg: 'var(--success-50)', fg: 'var(--success-fg)' },
    }[risk] ?? { bg: 'var(--neutral-50)', fg: 'var(--neutral-fg)' });

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Sprint Planning Agent</h1>
                    <p className="page-header__subtitle">Decompose epics into sprint-sized tasks, identify dependencies, and assess risks.</p>
                </div>
            </div>

            <div className="card mb-12">
                <div className="card__hd"><I.Sprint size={15}/><h3>Input</h3></div>
                <div className="card__bd">
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                            <div className="form-row">
                                <label>Epic Description</label>
                                <textarea className="textarea" value={epicDescription} onChange={e => setEpicDescription(e.target.value)}
                                    rows={6} placeholder="Describe the epic to be planned..." required />
                            </div>
                            <div className="form-grid">
                                <div className="form-row">
                                    <label>Team Capacity (hours)</label>
                                    <input className="input" type="number" value={teamCapacity} onChange={e => setTeamCapacity(Number(e.target.value))} min={1} required />
                                </div>
                                <div className="form-row">
                                    <label>Sprint Duration (weeks)</label>
                                    <input className="input" type="number" value={sprintDuration} onChange={e => setSprintDuration(Number(e.target.value))} min={1} max={4} required />
                                </div>
                            </div>
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={loading}>
                            <I.Sparkles size={14}/>{loading ? 'Planning…' : 'Plan Sprint'}
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
                        <I.Sprint size={15}/><h3>Tasks</h3>
                        <span className="pill ml-auto">{result.tasks.length} tasks</span>
                    </div>
                    <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {result.tasks.map(task => {
                            const rc = riskColor(task.risk);
                            return (
                                <div key={task.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', padding: '10px 12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <b style={{ fontSize: 13, flex: 1 }}>{task.title}</b>
                                        <span className="pill" style={{ background: rc.bg, color: rc.fg }}>{task.risk} risk</span>
                                        <span className="pill">{task.estimatedHours}h</span>
                                    </div>
                                    <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--text-2)' }}>{task.description}</p>
                                    {task.dependencies.length > 0 && (
                                        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                                            <b>Depends on:</b> {task.dependencies.join(', ')}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {result.criticalPath.length > 0 && (
                    <div className="card mb-12">
                        <div className="card__hd"><I.Lightning size={15}/><h3>Critical Path</h3></div>
                        <div className="card__bd">
                            <ol style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.criticalPath.map((t, i) => <li key={i}>{t}</li>)}
                            </ol>
                        </div>
                    </div>
                )}

                {result.riskAssessment.length > 0 && (
                    <div className="card mb-12" style={{ borderColor: 'var(--warning)' }}>
                        <div className="card__hd" style={{ background: 'var(--warning-50)' }}>
                            <I.Alert size={15} style={{ color: 'var(--warning)' }}/><h3>Risk Assessment</h3>
                        </div>
                        <div className="card__bd">
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.riskAssessment.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                        </div>
                    </div>
                )}

                <div className="card mb-12" style={{ borderColor: 'var(--info)' }}>
                    <div className="card__hd" style={{ background: 'var(--info-50)' }}>
                        <I.CheckCircle size={15} style={{ color: 'var(--info)' }}/><h3>Recommended Sprint Scope</h3>
                    </div>
                    <div className="card__bd" style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
                        {result.recommendedSprintScope}
                    </div>
                </div>
            </>)}
        </div>
    );
};
