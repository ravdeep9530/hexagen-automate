import React, { useState } from 'react';
import { useTestAgent } from '../../api/agentApi';
import { I } from '../../icons';

export const TestAutomationAgent: React.FC = () => {
    const { result, loading, error, generate } = useTestAgent();
    const [codeSnippet, setCodeSnippet] = useState('');
    const [testFramework, setTestFramework] = useState('jest');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await generate(codeSnippet, testFramework).catch(console.error);
    };

    const typeColor = (type: string) => ({
        unit: { bg: 'var(--primary-50)', fg: 'var(--primary-700)' },
        integration: { bg: 'var(--success-50)', fg: 'var(--success-fg)' },
        e2e: { bg: 'var(--clarify-50)', fg: 'var(--clarify-fg)' },
    }[type] ?? { bg: 'var(--neutral-50)', fg: 'var(--neutral-fg)' });

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Test Automation Agent</h1>
                    <p className="page-header__subtitle">Generate comprehensive test suites from code, API specs, or user stories.</p>
                </div>
            </div>

            <div className="card mb-12">
                <div className="card__hd"><I.Test size={15}/><h3>Input</h3></div>
                <div className="card__bd">
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                            <div className="form-row">
                                <label>Test Framework</label>
                                <select className="select" value={testFramework} onChange={e => setTestFramework(e.target.value)}>
                                    <option value="jest">Jest (JavaScript/TypeScript)</option>
                                    <option value="pytest">Pytest (Python)</option>
                                    <option value="mocha">Mocha (JavaScript)</option>
                                    <option value="nunit">NUnit (C#)</option>
                                </select>
                            </div>
                            <div className="form-row">
                                <label>Code / API Spec / User Story</label>
                                <textarea className="textarea" value={codeSnippet} onChange={e => setCodeSnippet(e.target.value)}
                                    rows={10} placeholder="Paste code, API specification, or user story here..." required />
                            </div>
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={loading}>
                            <I.Sparkles size={14}/>{loading ? 'Generating…' : 'Generate Tests'}
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
                <div className="card mb-12" style={{ borderColor: 'var(--success)' }}>
                    <div className="card__hd" style={{ background: 'var(--success-50)' }}>
                        <I.CheckCircle size={15} style={{ color: 'var(--success)' }}/>
                        <h3>Coverage Estimate</h3>
                        <span className="pill ml-auto" style={{ background: 'var(--success-100)', color: 'var(--success-fg)', fontSize: 14 }}>
                            {result.coverageEstimate}%
                        </span>
                    </div>
                </div>

                <div className="card mb-12">
                    <div className="card__hd">
                        <I.Test size={15}/><h3>Test Cases</h3>
                        <span className="pill ml-auto">{result.testCases.length}</span>
                    </div>
                    <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {result.testCases.map((tc, i) => {
                            const tc_ = typeColor(tc.type);
                            return (
                                <div key={i} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', overflow: 'hidden' }}>
                                    <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)' }}>
                                        <b style={{ fontSize: 13, flex: 1 }}>{tc.name}</b>
                                        <span className="pill" style={{ background: tc_.bg, color: tc_.fg }}>{tc.type}</span>
                                    </div>
                                    <div style={{ padding: '8px 12px' }}>
                                        <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-2)' }}>{tc.description}</p>
                                        <pre style={{ margin: 0, padding: '8px 10px', background: '#0d1117', color: '#c9d1d9', borderRadius: 'var(--r-2)', fontSize: 11.5, overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
                                            <code>{tc.code}</code>
                                        </pre>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {result.edgeCases.length > 0 && (
                    <div className="card mb-12" style={{ borderColor: 'var(--warning)' }}>
                        <div className="card__hd" style={{ background: 'var(--warning-50)' }}>
                            <I.Alert size={15} style={{ color: 'var(--warning)' }}/><h3>Edge Cases to Consider</h3>
                        </div>
                        <div className="card__bd">
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {result.edgeCases.map((ec, i) => <li key={i}>{ec}</li>)}
                            </ul>
                        </div>
                    </div>
                )}
            </>)}
        </div>
    );
};
