import React, { useState } from 'react';
import { useMockAgent } from '../../api/agentApi';
import { I } from '../../icons';

export const MockGenerationAgent: React.FC = () => {
    const { result, loading, error, generate } = useMockAgent();
    const [description, setDescription] = useState('');
    const [platform, setPlatform] = useState('web');
    const [framework, setFramework] = useState('react');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await generate(description, platform, framework).catch(console.error);
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Mock & Prototype Agent</h1>
                    <p className="page-header__subtitle">Generate UI mockups, React components, and interactive prototypes from descriptions.</p>
                </div>
            </div>

            <div className="card mb-12">
                <div className="card__hd"><I.Mock size={15}/><h3>Input</h3></div>
                <div className="card__bd">
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                            <div className="form-row">
                                <label>Component Description</label>
                                <textarea className="textarea" value={description} onChange={e => setDescription(e.target.value)}
                                    rows={6} placeholder="Describe the UI component or page to generate..." required />
                            </div>
                            <div className="form-grid">
                                <div className="form-row">
                                    <label>Platform</label>
                                    <select className="select" value={platform} onChange={e => setPlatform(e.target.value)}>
                                        <option value="web">Web</option>
                                        <option value="mobile">Mobile</option>
                                        <option value="desktop">Desktop</option>
                                    </select>
                                </div>
                                <div className="form-row">
                                    <label>Framework</label>
                                    <select className="select" value={framework} onChange={e => setFramework(e.target.value)}>
                                        <option value="react">React</option>
                                        <option value="vue">Vue</option>
                                        <option value="angular">Angular</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={loading}>
                            <I.Sparkles size={14}/>{loading ? 'Generating…' : 'Generate Mock'}
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
                {result.html && (
                    <div className="card mb-12">
                        <div className="card__hd"><I.Code size={15}/><h3>HTML</h3></div>
                        <div className="card__bd" style={{ padding: 0 }}>
                            <pre style={{ margin: 0, padding: '12px 14px', background: '#0d1117', color: '#c9d1d9', fontSize: 11.5, overflowX: 'auto', fontFamily: 'var(--font-mono)', borderRadius: '0 0 var(--r-4) var(--r-4)' }}>
                                <code>{result.html}</code>
                            </pre>
                        </div>
                    </div>
                )}

                {result.css && (
                    <div className="card mb-12">
                        <div className="card__hd"><I.Brush size={15}/><h3>CSS</h3></div>
                        <div className="card__bd" style={{ padding: 0 }}>
                            <pre style={{ margin: 0, padding: '12px 14px', background: '#0d1117', color: '#c9d1d9', fontSize: 11.5, overflowX: 'auto', fontFamily: 'var(--font-mono)', borderRadius: '0 0 var(--r-4) var(--r-4)' }}>
                                <code>{result.css}</code>
                            </pre>
                        </div>
                    </div>
                )}

                {result.components.length > 0 && (
                    <div className="card mb-12">
                        <div className="card__hd">
                            <I.Box size={15}/><h3>Components</h3>
                            <span className="pill ml-auto">{result.components.length}</span>
                        </div>
                        <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {result.components.map((comp, i) => (
                                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-3)', overflow: 'hidden' }}>
                                    <div style={{ padding: '7px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 12.5, fontWeight: 600 }}>
                                        {comp.name}
                                    </div>
                                    <pre style={{ margin: 0, padding: '10px 12px', background: '#0d1117', color: '#c9d1d9', fontSize: 11.5, overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
                                        <code>{comp.code}</code>
                                    </pre>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>)}
        </div>
    );
};
