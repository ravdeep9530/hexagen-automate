import React, { useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    type Node,
    type Edge,
    Position,
    Handle,
    type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { type PipelineRun, type StageStatus } from '../../api/pipelinesApi';
import { tokens } from './design';

interface Props {
    run: PipelineRun;
    onSelectStage?: (stage: 'implementation') => void;
}

const ROOT_X = 40;
const ROOT_Y = 40;
const COL_TICKETS_X = 320;
const TICKET_Y_BASE = 0;
const TICKET_Y_GAP = 72;

type RootNodeData = {
    label: string;
    sub: string;
    succeeded: number;
    failed: number;
    skipped: number;
    onClick?: () => void;
};

type TicketNodeData = {
    label: string;
    ticketId: string;
    status: 'shipped' | 'ready' | 'failed' | 'blocked';
    attempts: number;
    prUrl?: string | null;
    prNumber?: number | null;
    errorSummary?: string | null;
    blockedReason?: string | null;
};

function RootNode({ data }: NodeProps<RootNodeData>) {
    return (
        <div
            onClick={data.onClick}
            style={{
                padding: '14px 18px',
                background: tokens.color.card,
                border: `2px solid ${tokens.color.primary}`,
                borderRadius: tokens.radius.lg,
                minWidth: 220,
                cursor: data.onClick ? 'pointer' : 'default',
                boxShadow: tokens.shadow.md,
                fontFamily: tokens.font.body,
            }}
        >
            <div style={{ fontSize: 11, color: tokens.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Implementation
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: tokens.color.text, marginTop: 2 }}>
                {data.label}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11 }}>
                <span style={{ color: tokens.color.success }}>✓ {data.succeeded} shipped</span>
                <span style={{ color: data.failed > 0 ? tokens.color.danger : tokens.color.textMuted }}>✕ {data.failed} failed</span>
                <span style={{ color: tokens.color.textMuted }}>⊘ {data.skipped} blocked</span>
            </div>
            <Handle type="source" position={Position.Right} style={{ background: tokens.color.primary }} />
        </div>
    );
}

function TicketNode({ data }: NodeProps<TicketNodeData>) {
    const palette = data.status === 'shipped'
        ? { bg: tokens.color.successSoft, border: '#86efac', fg: '#166534', label: 'shipped' }
        : data.status === 'ready'
        ? { bg: tokens.color.primarySoft, border: '#93c5fd', fg: '#1e40af', label: 'ready' }
        : data.status === 'blocked'
        ? { bg: tokens.color.slateSoft, border: tokens.color.border, fg: tokens.color.slate, label: 'blocked' }
        : { bg: tokens.color.dangerSoft, border: '#fca5a5', fg: '#991b1b', label: 'failed' };
    return (
        <div
            style={{
                padding: '8px 12px',
                background: palette.bg,
                border: `1px solid ${palette.border}`,
                borderRadius: tokens.radius.md,
                minWidth: 240, maxWidth: 320,
                fontFamily: tokens.font.body,
            }}
            title={data.errorSummary || data.blockedReason || ''}
        >
            <Handle type="target" position={Position.Left} style={{ background: palette.border }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                    fontSize: 10, fontFamily: tokens.font.mono,
                    color: tokens.color.primary, background: 'white',
                    padding: '1px 5px', borderRadius: tokens.radius.sm,
                    border: `1px solid ${tokens.color.border}`,
                }}>
                    {data.ticketId}
                </span>
                <span style={{
                    fontSize: 10, fontWeight: 700, color: palette.fg,
                    background: 'white', padding: '1px 6px',
                    borderRadius: tokens.radius.pill,
                    border: `1px solid ${palette.border}`,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                    {palette.label}
                </span>
                <span style={{ fontSize: 10, color: tokens.color.textMuted, marginLeft: 'auto' }}>
                    {data.attempts} {data.attempts === 1 ? 'try' : 'tries'}
                </span>
            </div>
            <div style={{ fontSize: 12, color: palette.fg, marginTop: 4, lineHeight: 1.3 }}>
                {data.label}
            </div>
            {data.status === 'failed' && data.errorSummary ? (
                <div style={{
                    marginTop: 4, fontSize: 10, color: palette.fg,
                    fontFamily: tokens.font.mono, opacity: 0.85,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {data.errorSummary}
                </div>
            ) : null}
            {data.status === 'blocked' && data.blockedReason ? (
                <div style={{
                    marginTop: 4, fontSize: 10, color: tokens.color.textMuted,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {data.blockedReason}
                </div>
            ) : null}
            {data.prUrl ? (
                <a
                    href={data.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        display: 'inline-block', marginTop: 4,
                        fontSize: 11, color: tokens.color.primary, textDecoration: 'none',
                    }}
                >
                    PR #{data.prNumber} ↗
                </a>
            ) : null}
        </div>
    );
}

const nodeTypes = { root: RootNode, ticket: TicketNode };

/**
 * Implementation-focused graph: root is the implementation stage; children are
 * one node per sprint ticket (shipped / failed / blocked). The 7-stage linear
 * flow is intentionally not shown — that's the Stepper view's job.
 */
export function PipelineGraph({ run, onSelectStage }: Props) {
    const { nodes, edges, isEmpty } = useMemo(() => buildGraph(run, onSelectStage), [run, onSelectStage]);

    if (isEmpty) {
        return (
            <div style={{
                padding: 32, textAlign: 'center',
                color: tokens.color.textMuted, fontSize: 13,
                background: tokens.color.card,
                borderRadius: tokens.radius.lg,
                border: `1px dashed ${tokens.color.border}`,
            }}>
                Graph view will populate once the <strong>implementation</strong> stage runs and produces sprint outcomes.
            </div>
        );
    }

    return (
        <div style={{
            width: '100%', height: 520,
            background: tokens.color.card,
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.border}`,
            overflow: 'hidden',
        }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
                nodesDraggable={false}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={20} color={tokens.color.borderStrong} />
                <Controls showInteractive={false} />
            </ReactFlow>
        </div>
    );
}

function buildGraph(run: PipelineRun, onSelectStage?: (stage: 'implementation') => void): { nodes: Node[]; edges: Edge[]; isEmpty: boolean } {
    const impl: StageStatus | undefined = run.stages.find(s => s.stage === 'implementation');
    const artifact: any = impl?.artifact_json ?? null;
    const sprint = artifact?.sprint;
    const outcomes: any[] = Array.isArray(sprint?.outcomes) ? sprint.outcomes : [];
    if (outcomes.length === 0) {
        return { nodes: [], edges: [], isEmpty: true };
    }

    const succeeded = sprint?.succeeded_count ?? outcomes.filter(o => !!o?.pr_url).length;
    const failed = sprint?.failed_count ?? outcomes.filter(o => !o?.pr_url && !o?.skipped).length;
    const skipped = sprint?.skipped_count ?? outcomes.filter(o => !!o?.skipped).length;

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    nodes.push({
        id: 'root',
        type: 'root',
        position: { x: ROOT_X, y: ROOT_Y + (outcomes.length * TICKET_Y_GAP) / 2 - 30 },
        data: {
            label: run.repo_full_name,
            sub: '',
            succeeded, failed, skipped,
            onClick: onSelectStage ? () => onSelectStage('implementation') : undefined,
        } satisfies RootNodeData,
        sourcePosition: Position.Right,
    });

    outcomes.forEach((o, i) => {
        const id = `ticket:${o.ticket_id || i}`;
        const hasImpl = !!o.implementation_json;
        const errs = Array.isArray(o.final_errors) ? o.final_errors : [];
        const status: TicketNodeData['status'] = o.pr_url ? 'shipped'
            : o.skipped ? 'blocked'
            : hasImpl && errs.length === 0 ? 'ready'
            : 'failed';
        const errorSummary = Array.isArray(o.final_errors) && o.final_errors.length > 0
            ? `${o.final_errors[0]?.code || 'error'}: ${String(o.final_errors[0]?.message || '').replace(/\s+/g, ' ').slice(0, 140)}`
            : null;
        nodes.push({
            id,
            type: 'ticket',
            position: { x: COL_TICKETS_X, y: ROOT_Y + i * TICKET_Y_GAP },
            data: {
                label: o.title || o.ticket_id || `Ticket ${i + 1}`,
                ticketId: o.ticket_id || `T${i + 1}`,
                status,
                attempts: o.attempts ?? 0,
                prUrl: o.pr_url ?? null,
                prNumber: o.pr_number ?? null,
                errorSummary,
                blockedReason: o.skipped || null,
            } satisfies TicketNodeData,
            targetPosition: Position.Left,
        });
        edges.push({
            id: `e:root->${id}`,
            source: 'root',
            target: id,
            animated: status === 'failed',
            style: {
                stroke: status === 'shipped' ? '#86efac' : status === 'failed' ? '#fca5a5' : tokens.color.borderStrong,
                strokeWidth: 1.5,
            },
        });
    });

    return { nodes, edges, isEmpty: false };
}
