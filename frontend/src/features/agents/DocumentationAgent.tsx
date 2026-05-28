import React, { useState } from 'react';
import { useDocsAgent } from '../../api/agentApi';
import { I } from '../../icons';

export const DocumentationAgent: React.FC = () => {
    const { result, loading, error, generate } = useDocsAgent();
    const [code, setCode] = useState('');
    const [docType, setDocType] = useState('api');
    const [audience, setAudience] = useState('developer');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await generate(code, docType, audience).catch(console.error);
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Documentation Agent</h1>
                    <p className="page-header__subtitle">Generate comprehensive documentation from code, API specs, and feature descriptions.</p>
                </div>
            </div>

            <div className="card mb-12">
                <div className="card__hd"><I.Docs size={15}/><h3>Input</h3></div>
                <div className="card__bd">
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                            <div className="form-grid">
                                <div className="form-row">
                                    <label>Documentation Type</label>
                                    <select className="select" value={docType} onChange={e => setDocType(e.target.value)}>
                                        <option value="api">API Documentation</option>
                                        <option value="adr">Architecture Decision Record</option>
                                        <option value="guide">User Guide</option>
                                        <option value="runbook">Operational Runbook</option>
                                    </select>
                                </div>
                                <div className="form-row">
                                    <label>Target Audience</label>
                                    <select className="select" value={audience} onChange={e => setAudience(e.target.value)}>
                                        <option value="developer">Developers</option>
                                        <option value="user">End Users</option>
                                        <option value="ops">Operations Team</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <label>Code / API Spec / Description</label>
                                <textarea className="textarea" value={code} onChange={e => setCode(e.target.value)}
                                    rows={10} placeholder="Paste code, API specification, or feature description..." required />
                            </div>
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={loading}>
                            <I.Sparkles size={14}/>{loading ? 'Generating…' : 'Generate Documentation'}
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
                {result.sections.length > 0 && (
                    <div className="card mb-12">
                        <div className="card__hd"><I.Layers size={15}/><h3>Sections</h3></div>
                        <div className="card__bd">
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.sections.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                        </div>
                    </div>
                )}

                <div className="card mb-12">
                    <div className="card__hd"><I.Docs size={15}/><h3>Generated Content</h3></div>
                    <div className="card__bd" style={{ padding: 0 }}>
                        <pre style={{
                            margin: 0, padding: '14px 16px',
                            background: 'var(--surface-2)', color: 'var(--text-1)',
                            fontSize: 12.5, lineHeight: 1.7, overflowX: 'auto',
                            fontFamily: 'var(--font-mono)',
                            borderRadius: '0 0 var(--r-4) var(--r-4)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                            {result.content}
                        </pre>
                    </div>
                </div>
            </>)}
        </div>
    );
};
