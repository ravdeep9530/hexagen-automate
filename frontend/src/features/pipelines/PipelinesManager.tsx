import React, { useEffect, useState } from 'react';
import { PipelineLaunch } from './PipelineLaunch';
import { PipelineDetail } from './PipelineDetail';
import { PipelineList } from './PipelineList';
import { PIPELINE_CSS, tokens } from './design';
import { PlannerScreen } from '../../screens/PlannerScreen';

type View = { kind: 'list' } | { kind: 'launch' } | { kind: 'detail'; runId: string } | { kind: 'planner'; runId: string };

export function PipelinesManager() {
    const [view, setView] = useState<View>({ kind: 'list' });

    // Inject the shared CSS once (covers animations, hover states, focus rings)
    useEffect(() => {
        if (document.getElementById('pl-shared-css')) return;
        const s = document.createElement('style');
        s.id = 'pl-shared-css';
        s.textContent = PIPELINE_CSS;
        document.head.appendChild(s);
    }, []);

    let content: React.ReactNode;
    if (view.kind === 'launch') {
        content = (
            <div>
                <div style={{ padding: '14px 24px 0 24px' }}>
                    <button
                        className="pl-btn-ghost"
                        onClick={() => setView({ kind: 'list' })}
                        style={{
                            background: 'transparent', border: 'none',
                            color: tokens.color.primary, cursor: 'pointer',
                            fontSize: 13, padding: '4px 8px', borderRadius: tokens.radius.sm,
                        }}
                    >
                        ← All runs
                    </button>
                </div>
                <PipelineLaunch onStarted={(run_id) => setView({ kind: 'detail', runId: run_id })} />
            </div>
        );
    } else if (view.kind === 'detail') {
        content = (
            <PipelineDetail
                runId={view.runId}
                onBack={() => setView({ kind: 'list' })}
                onNavigate={(run_id) => setView({ kind: 'detail', runId: run_id })}
                onOpenPlanner={() => setView({ kind: 'planner', runId: view.runId })}
            />
        );
    } else if (view.kind === 'planner') {
        content = (
            <PlannerScreen
                runId={view.runId}
                onBack={() => setView({ kind: 'detail', runId: view.runId })}
            />
        );
    } else {
        content = (
            <PipelineList
                onSelect={(run_id) => setView({ kind: 'detail', runId: run_id })}
                onStartNew={() => setView({ kind: 'launch' })}
            />
        );
    }

    return (
        <div style={{
            minHeight: 'calc(100vh - 200px)',
            background: tokens.color.bg,
            fontFamily: tokens.font.body,
            color: tokens.color.text,
            paddingBottom: 40,
        }}>
            {content}
        </div>
    );
}
