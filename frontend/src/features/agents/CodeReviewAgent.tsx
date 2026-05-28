import React, { useState } from 'react';
import { useCodeReviewAgent } from '../../api/agentApi';
import { I } from '../../icons';

export const CodeReviewAgent: React.FC = () => {
    const { result, loading, error, analyze } = useCodeReviewAgent();
    const [code, setCode] = useState('');
    const [language, setLanguage] = useState('typescript');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await analyze(code, language).catch(console.error);
    };

    const sevStyle = (sev: string) => ({
        critical: { bg: 'var(--danger-50)', fg: 'var(--danger-fg)', border: 'var(--danger)' },
        warning:  { bg: 'var(--warning-50)', fg: 'var(--warning-fg)', border: 'var(--warning)' },
        info:     { bg: 'var(--info-50)', fg: 'var(--info-fg)', border: 'var(--info)' },
    }[sev] ?? { bg: 'var(--neutral-50)', fg: 'var(--neutral-fg)', border: 'var(--border)' });

    const scoreColor = (score: number) =>
        score >= 80 ? 'var(--success-fg)' : score >= 60 ? 'var(--warning-fg)' : 'var(--danger-fg)';

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-header__title">Code Review Agent</h1>
                    <p className="page-header__subtitle">Automated code review for security, performance, style, and maintainability issues.</p>
                </div>
            </div>

            <div className="card mb-12">
                <div className="card__hd"><I.Review size={15}/><h3>Input</h3></div>
                <div className="card__bd">
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
                            <div className="form-row">
                                <label>Programming Language</label>
                                <select className="select" value={language} onChange={e => setLanguage(e.target.value)}>
                                    <option value="typescript">TypeScript</option>
                                    <option value="javascript">JavaScript</option>
                                    <option value="python">Python</option>
                                    <option value="csharp">C#</option>
                                    <option value="java">Java</option>
                                    <option value="go">Go</option>
                                </select>
                            </div>
                            <div className="form-row">
                                <label>Code to Review</label>
                                <textarea className="textarea" value={code} onChange={e => setCode(e.target.value)}
                                    rows={12} placeholder="Paste code snippet here..." required />
                            </div>
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={loading}>
                            <I.Sparkles size={14}/>{loading ? 'Analyzing…' : 'Review Code'}
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
                        <I.Review size={15}/><h3>Quality Score</h3>
                        <span className="ml-auto" style={{ fontSize: 22, fontWeight: 700, color: scoreColor(result.score) }}>
                            {result.score}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-3)' }}>/100</span>
                        </span>
                    </div>
                    {result.summary && (
                        <div className="card__bd" style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                            {result.summary}
                        </div>
                    )}
                </div>

                {result.issues.length > 0 && (
                    <div className="card mb-12">
                        <div className="card__hd">
                            <I.Alert size={15}/><h3>Issues Found</h3>
                            <span className="pill ml-auto">{result.issues.length}</span>
                        </div>
                        <div className="card__bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {result.issues.map((issue, i) => {
                                const ss = sevStyle(issue.severity);
                                return (
                                    <div key={i} style={{ background: ss.bg, border: `1px solid ${ss.border}`, borderRadius: 'var(--r-3)', padding: '10px 12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                            <span className="pill" style={{ background: ss.bg, color: ss.fg }}>{issue.severity}</span>
                                            <span className="pill" style={{ background: 'var(--neutral-50)', color: 'var(--text-2)' }}>{issue.category}</span>
                                        </div>
                                        <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-1)' }}>{issue.message}</p>
                                        {issue.suggestion && (
                                            <div style={{ fontSize: 12.5, color: 'var(--text-2)', background: 'rgba(255,255,255,0.6)', borderRadius: 'var(--r-2)', padding: '6px 8px' }}>
                                                <b style={{ color: ss.fg }}>Suggestion:</b> {issue.suggestion}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </>)}
        </div>
    );
};
