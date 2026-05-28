import React, { useEffect } from 'react';
import { I } from '../icons';
import { useProjectOverview, useTriggerAnalysis, type ProjectAnalysis } from '../api/orgsApi';

interface Props {
    projectId: string;
    orgId: string;
    onOpenPipelines: () => void;
}

function Skeleton() {
    return (
        <div className="int-card" style={{ marginBottom: 16 }}>
            <div className="int-card__bd">
                {[80, 60, 90, 50].map((w, i) => (
                    <div key={i} style={{
                        height: 14,
                        width: `${w}%`,
                        background: 'var(--neutral-100)',
                        borderRadius: 4,
                        marginBottom: 10,
                        animation: 'pulse 1.5s ease-in-out infinite',
                    }}/>
                ))}
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="int-card" style={{ marginBottom: 16 }}>
            <div className="int-card__hd" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 14 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-1)' }}>{children}</div>
        </div>
    );
}

function AnalysisView({ analysis, onRetry, retrying }: {
    analysis: ProjectAnalysis;
    onRetry: () => void;
    retrying: boolean;
}) {
    if (analysis.status === 'failed') {
        return (
            <div className="alert alert--error" style={{ marginBottom: 16 }}>
                <strong>Analysis failed:</strong> {analysis.error ?? 'Unknown error'}
                <button
                    className="btn btn--sm"
                    style={{ marginLeft: 12 }}
                    onClick={onRetry}
                    disabled={retrying}
                >
                    {retrying ? 'Retrying…' : 'Retry Analysis'}
                </button>
            </div>
        );
    }

    return (
        <>
            {analysis.purpose && (
                <Section title="About">
                    <p style={{ margin: 0 }}>{analysis.purpose}</p>
                </Section>
            )}

            {analysis.summary && (
                <div style={{
                    background: 'var(--primary-50, #eff6ff)',
                    border: '1px solid var(--primary-200, #bfdbfe)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    fontSize: 14,
                    lineHeight: 1.7,
                    color: 'var(--text-1)',
                    marginBottom: 16,
                }}>
                    {analysis.summary}
                </div>
            )}

            {analysis.tech_stack && analysis.tech_stack.length > 0 && (
                <Section title="Tech Stack">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {analysis.tech_stack.map(t => (
                            <span key={t} className="pill pill--skipped" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {t}
                            </span>
                        ))}
                    </div>
                </Section>
            )}

            {analysis.architecture && (
                <Section title="Architecture">
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{analysis.architecture}</p>
                </Section>
            )}

            {analysis.design && (
                <Section title="Design Patterns">
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{analysis.design}</p>
                </Section>
            )}

            {analysis.key_files && analysis.key_files.length > 0 && (
                <Section title="Key Files">
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {analysis.key_files.map((kf, i) => (
                            <li key={i} style={{ padding: '6px 0', borderBottom: i < analysis.key_files.length - 1 ? '1px solid var(--border)' : undefined }}>
                                <code style={{
                                    background: 'var(--neutral-100)',
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    fontSize: 12,
                                    fontFamily: 'monospace',
                                    marginRight: 8,
                                }}>{kf.path}</code>
                                <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{kf.description}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
        </>
    );
}

export const ProjectOverviewScreen: React.FC<Props> = ({ projectId, orgId, onOpenPipelines }) => {
    const { project, loading, error, refetch } = useProjectOverview(orgId, projectId);
    const { trigger, triggering } = useTriggerAnalysis(orgId);

    useEffect(() => {
        if (projectId && orgId) refetch();
    }, [projectId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (loading && !project) {
        return (
            <div className="page">
                <div className="empty-state"><p>Loading…</p></div>
            </div>
        );
    }

    if (error && !project) {
        return (
            <div className="page">
                <div className="alert alert--error">{error}</div>
            </div>
        );
    }

    if (!project) return null;

    const analysisStatus = (project.config as any)?.analysis_status as string | undefined;
    const analysis = (project.config as any)?.analysis as ProjectAnalysis | undefined;
    const isPending = analysisStatus === 'pending' || analysisStatus === 'running';

    const handleRetry = async () => {
        await trigger(projectId);
        setTimeout(refetch, 1000);
    };

    return (
        <div className="page">
            {/* Header */}
            <div className="page-header" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <h1 className="page-header__title" style={{ margin: 0 }}>{project.name}</h1>
                        <span className={`pill ${project.project_type === 'existing' ? 'pill--skipped' : 'pill--approved'}`}>
                            {project.project_type === 'existing' ? 'Existing Project' : 'New Project'}
                        </span>
                    </div>
                    {project.description && (
                        <p className="page-header__subtitle" style={{ marginTop: 4 }}>{project.description}</p>
                    )}
                    {project.repo_url && (
                        <a
                            href={project.repo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 13, color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}
                        >
                            <I.Github size={13}/> {project.repo_url.replace('https://github.com/', '')}
                        </a>
                    )}
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary btn--sm" onClick={onOpenPipelines}>
                        <I.Pipeline size={13}/> View Pipelines
                    </button>
                </div>
            </div>

            {/* Project metadata */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 20, fontSize: 13, color: 'var(--text-2)' }}>
                <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
                {project.slug && <span>Slug: <code style={{ fontFamily: 'monospace' }}>{project.slug}</code></span>}
            </div>

            {/* New project: guidance */}
            {project.project_type === 'new' && (
                <div className="int-card">
                    <div className="int-card__hd">
                        <div className="int-card__logo" style={{ background: 'var(--neutral-50)', color: 'var(--text-2)' }}>
                            <I.Plus size={18}/>
                        </div>
                        <div>
                            <div className="int-card__name">Ready to build</div>
                            <div className="int-card__type">Your project is linked to GitHub</div>
                        </div>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '12px 0 0', lineHeight: 1.7 }}>
                        This is a new project. Launch a pipeline to generate your first feature — Claude will write requirements, design a plan, and open a pull request on your linked repository.
                    </p>
                    <div className="int-card__actions" style={{ marginTop: 14 }}>
                        <button className="btn btn--primary btn--sm" onClick={onOpenPipelines}>
                            <I.Pipeline size={13}/> Launch First Pipeline
                        </button>
                    </div>
                </div>
            )}

            {/* Existing project: analysis states */}
            {project.project_type === 'existing' && (
                <>
                    {isPending && (
                        <>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                marginBottom: 16, padding: '12px 16px',
                                background: 'var(--neutral-50)', borderRadius: 8,
                                fontSize: 14, color: 'var(--text-2)',
                            }}>
                                <div className="ghpr-spinner dark" style={{ width: 16, height: 16, flexShrink: 0 }}/>
                                Analyzing repository structure and codebase…
                            </div>
                            <Skeleton/>
                            <Skeleton/>
                        </>
                    )}

                    {!isPending && !analysis && (
                        <div className="empty-state">
                            <I.Code size={32} style={{ opacity: 0.3, marginBottom: 8 }}/>
                            <p>No analysis yet.</p>
                            <button
                                className="btn btn--primary btn--sm"
                                onClick={handleRetry}
                                disabled={triggering}
                                style={{ marginTop: 8 }}
                            >
                                {triggering ? 'Starting…' : 'Analyze Repository'}
                            </button>
                        </div>
                    )}

                    {!isPending && analysis && (
                        <AnalysisView analysis={analysis} onRetry={handleRetry} retrying={triggering}/>
                    )}
                </>
            )}
        </div>
    );
};
