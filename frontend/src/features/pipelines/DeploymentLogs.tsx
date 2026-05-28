import React, { useEffect, useRef, useState } from 'react';
import { useDeploymentLogs, useSandboxLogs, useFixAgentLog } from '../../api/pipelinesApi';
import { tokens } from './design';

interface Props {
    runId: string;
    enabled: boolean;
    height?: number;
    onClose?: () => void;
    /** Which log stream to render. Defaults to 'deployment'. */
    source?: 'deployment' | 'sandbox' | 'fix-agent';
    /** Label shown in the header. Defaults based on `source`. */
    label?: string;
    /** Start expanded (height × 3). Default false. */
    defaultExpanded?: boolean;
}

/**
 * Streaming view of a per-run log endpoint. Polls every 1.5s while `enabled`
 * is true, appends new bytes, auto-scrolls to bottom when the user hasn't
 * manually scrolled up.
 */
export function DeploymentLogs({ runId, enabled, height = 280, onClose, source = 'deployment', label, defaultExpanded = false }: Props) {
    // Hooks must run unconditionally; pick the right content via flags.
    const deployContent = useDeploymentLogs(runId, enabled && source === 'deployment');
    const sandboxContent = useSandboxLogs(runId, enabled && source === 'sandbox');
    const fixAgentContent = useFixAgentLog(runId, enabled && source === 'fix-agent');
    const content = source === 'sandbox' ? sandboxContent : source === 'fix-agent' ? fixAgentContent : deployContent;
    const displayLabel = label ?? (source === 'sandbox' ? 'Sandbox logs' : source === 'fix-agent' ? 'Fix agent log' : 'Deployment logs');
    const preRef = useRef<HTMLPreElement | null>(null);
    const userScrolledUpRef = useRef(false);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [copied, setCopied] = useState(false);

    const displayHeight = expanded ? Math.max(height * 3, 600) : height;

    useEffect(() => {
        const el = preRef.current;
        if (!el) return;
        if (!userScrolledUpRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [content]);

    function onScroll(e: React.UIEvent<HTMLPreElement>) {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 40;
        userScrolledUpRef.current = !atBottom;
    }

    function handleCopy() {
        if (!content) return;
        navigator.clipboard.writeText(content).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        }).catch(() => {});
    }

    const btnStyle: React.CSSProperties = {
        background: 'transparent', border: 'none',
        color: tokens.color.textMuted, fontSize: 12,
        cursor: 'pointer', padding: '0 4px',
        borderRadius: 3, lineHeight: 1,
    };

    return (
        <div style={{
            marginTop: 10, borderRadius: tokens.radius.md, overflow: 'hidden',
            border: `1px solid ${tokens.color.border}`,
        }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: tokens.color.bg,
                borderBottom: `1px solid ${tokens.color.border}`,
                fontSize: 11, color: tokens.color.textMuted,
            }}>
                <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: enabled ? tokens.color.success : tokens.color.textSubtle,
                }} className={enabled ? 'pl-pulse' : ''} />
                <span style={{ fontWeight: 600, color: tokens.color.text }}>{displayLabel}</span>
                <span style={{ fontFamily: tokens.font.mono }}>· {content.length.toLocaleString()} chars</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
                    {content ? (
                        <button
                            onClick={handleCopy}
                            title="Copy log to clipboard"
                            style={btnStyle}
                        >
                            {copied ? '✓ copied' : '⎘'}
                        </button>
                    ) : null}
                    <button
                        onClick={() => {
                            setExpanded(v => !v);
                            // reset scroll-lock so it snaps to bottom on expand
                            userScrolledUpRef.current = false;
                        }}
                        title={expanded ? 'Collapse log' : 'Expand log'}
                        style={btnStyle}
                    >
                        {expanded ? '⊟' : '⊞'}
                    </button>
                    {onClose ? (
                        <button
                            onClick={onClose}
                            title="Close"
                            style={btnStyle}
                        >✕</button>
                    ) : null}
                </div>
            </div>
            <pre
                ref={preRef}
                onScroll={onScroll}
                style={{
                    margin: 0, padding: 12, height: displayHeight,
                    background: '#0f172a', color: '#e2e8f0',
                    fontSize: 11, lineHeight: 1.5,
                    fontFamily: tokens.font.mono,
                    overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    transition: 'height 0.25s ease',
                }}
            >{content || (enabled ? '(waiting for log output…)' : '(no log output)')}</pre>
        </div>
    );
}
