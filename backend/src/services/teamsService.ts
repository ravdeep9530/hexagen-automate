import { createHmac, timingSafeEqual } from 'crypto';
import type { PipelineRun, StageStatus } from './pipelineService';
import type { NotificationSettings, TeamsChannelConfig } from './notificationTypes';

const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL ?? '';
const TEAMS_SIGNING_SECRET = process.env.TEAMS_SIGNING_SECRET ?? 'teams-default-secret-change-me';
const BACKEND_URL = process.env.BACKEND_URL ?? (process.env.FRONTEND_URL ?? 'http://localhost:3001').replace(':3001', ':5000');
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3001';

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface ApprovalTokenPayload {
    runId: string;
    stage: string;
    decision: 'approved' | 'rejected';
    exp: number;
}

function b64url(s: string): string {
    return Buffer.from(s).toString('base64url');
}

function fromB64url(s: string): string {
    return Buffer.from(s, 'base64url').toString('utf8');
}

export function signApprovalToken(payload: ApprovalTokenPayload): string {
    const header = b64url(JSON.stringify(payload));
    const sig = createHmac('sha256', TEAMS_SIGNING_SECRET).update(header).digest('base64url');
    return `${header}.${sig}`;
}

export function verifyApprovalToken(token: string): ApprovalTokenPayload | null {
    try {
        const dot = token.lastIndexOf('.');
        if (dot < 1) return null;
        const header = token.slice(0, dot);
        const sig = token.slice(dot + 1);
        const expected = createHmac('sha256', TEAMS_SIGNING_SECRET).update(header).digest('base64url');
        const sigBuf = Buffer.from(sig, 'base64url');
        const expBuf = Buffer.from(expected, 'base64url');
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
        const payload = JSON.parse(fromB64url(header)) as ApprovalTokenPayload;
        if (Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

function stageLabel(stage: string): string {
    const labels: Record<string, string> = {
        requirements: '1 · Requirements',
        optimize: '2 · Optimize',
        plan: '3 · Plan',
        design: '4 · Design',
        sprint: '5 · Sprint Planning',
        implementation: '6 · Implementation',
        test: '7 · Test',
    };
    return labels[stage] ?? stage;
}

function artifactSummary(stageStatus: StageStatus): string {
    if (!stageStatus.artifact_json) return '';
    const a = stageStatus.artifact_json as Record<string, unknown>;
    const parsed = (a.parsed ?? a) as Record<string, unknown>;
    if (typeof parsed.title === 'string') return parsed.title;
    if (Array.isArray(parsed.user_stories)) return `${(parsed.user_stories as unknown[]).length} user stories`;
    if (typeof parsed.summary_markdown === 'string') return (parsed.summary_markdown as string).slice(0, 200);
    return '';
}

async function sendCard(card: object, webhookUrlOverride?: string): Promise<void> {
    const url = webhookUrlOverride || TEAMS_WEBHOOK_URL;
    if (!url) {
        console.log('[teamsService] No webhook URL configured — skipping card send');
        return;
    }
    const body = {
        type: 'message',
        attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: card,
        }],
    };
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            console.error('[teamsService] Webhook POST failed:', resp.status, await resp.text().catch(() => ''));
        }
    } catch (err) {
        console.error('[teamsService] Webhook fetch error:', err);
    }
}

export async function sendStageApprovalCard(
    run: PipelineRun,
    stageStatus: StageStatus,
    settings?: NotificationSettings | null,
): Promise<void> {
    // When settings provided, respect trigger list
    if (settings && !settings.triggers.includes('stage_approval')) return;

    const webhookUrl = settings
        ? (settings.config as TeamsChannelConfig).webhook_url
        : undefined;

    const ctx = settings?.context_fields ?? ['artifact_summary', 'stage_details', 'run_id', 'pr_link'];

    const approveToken = signApprovalToken({
        runId: run.run_id, stage: stageStatus.stage, decision: 'approved', exp: Date.now() + TOKEN_TTL_MS,
    });
    const rejectToken = signApprovalToken({
        runId: run.run_id, stage: stageStatus.stage, decision: 'rejected', exp: Date.now() + TOKEN_TTL_MS,
    });

    const approveUrl = `${BACKEND_URL}/api/teams/decide?token=${encodeURIComponent(approveToken)}`;
    const rejectUrl  = `${BACKEND_URL}/api/teams/decide?token=${encodeURIComponent(rejectToken)}`;
    const viewUrl    = `${FRONTEND_URL}?teams_nav=detail&run_id=${encodeURIComponent(run.run_id)}&stage=${encodeURIComponent(stageStatus.stage)}`;

    const summary = ctx.includes('artifact_summary') ? artifactSummary(stageStatus) : '';

    const facts = [
        ctx.includes('stage_details') ? { title: 'Stage', value: stageLabel(stageStatus.stage) } : null,
        ctx.includes('run_id')        ? { title: 'Pipeline', value: run.run_id.slice(0, 8) + '…' } : null,
        ctx.includes('stage_details') ? { title: 'Repo', value: run.repo_full_name } : null,
        ctx.includes('stage_details') ? { title: 'Request', value: run.raw_request.split('\n')[0].slice(0, 80) } : null,
        ctx.includes('pr_link') && stageStatus.artifact_url ? { title: 'Artifact', value: stageStatus.artifact_url } : null,
    ].filter((f): f is { title: string; value: string } => f !== null && Boolean(f.value));

    const card = {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
            {
                type: 'Container',
                style: 'warning',
                items: [{
                    type: 'TextBlock',
                    text: '🔔  Stage awaiting approval',
                    weight: 'Bolder',
                    size: 'Medium',
                    color: 'Warning',
                }],
            },
            ...(facts.length > 0 ? [{ type: 'FactSet', facts }] : []),
            ...(summary ? [{
                type: 'TextBlock',
                text: summary,
                wrap: true,
                isSubtle: true,
            }] : []),
            {
                type: 'TextBlock',
                text: '⏱ Approval link expires in 15 minutes.',
                isSubtle: true,
                size: 'Small',
            },
        ],
        actions: [
            { type: 'Action.OpenUrl', title: '✓ Approve & advance', url: approveUrl, style: 'positive' },
            { type: 'Action.OpenUrl', title: '✗ Reject',            url: rejectUrl,  style: 'destructive' },
            { type: 'Action.OpenUrl', title: '↗ View pipeline',     url: viewUrl },
        ],
    };

    await sendCard(card, webhookUrl);
    console.log(`[teamsService] Sent approval card run=${run.run_id} stage=${stageStatus.stage}`);
}

export async function sendPipelineCompleteCard(
    run: PipelineRun,
    settings?: NotificationSettings | null,
): Promise<void> {
    // When settings provided, respect trigger list
    if (settings) {
        const trigger = run.status === 'completed' ? 'pipeline_complete' : 'pipeline_rejected';
        if (!settings.triggers.includes(trigger)) return;
    }

    const webhookUrl = settings
        ? (settings.config as TeamsChannelConfig).webhook_url
        : undefined;

    const ctx = settings?.context_fields ?? ['artifact_summary', 'stage_details', 'run_id', 'pr_link'];

    const icon = run.status === 'completed' ? '✅' : '❌';
    const approved = run.stages.filter(s => s.status === 'approved').length;
    const viewUrl = `${FRONTEND_URL}?teams_nav=detail&run_id=${encodeURIComponent(run.run_id)}`;

    const facts = [
        ctx.includes('run_id')        ? { title: 'Pipeline', value: run.run_id.slice(0, 8) + '…' } : null,
        ctx.includes('stage_details') ? { title: 'Repo', value: run.repo_full_name } : null,
        ctx.includes('stage_details') ? { title: 'Request', value: run.raw_request.split('\n')[0].slice(0, 80) } : null,
        ctx.includes('stage_details') ? { title: 'Stages done', value: `${approved}/7` } : null,
    ].filter((f): f is { title: string; value: string } => f !== null && Boolean(f.value));

    const card = {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
            {
                type: 'Container',
                style: run.status === 'completed' ? 'good' : 'attention',
                items: [{
                    type: 'TextBlock',
                    text: `${icon}  Pipeline ${run.status}`,
                    weight: 'Bolder',
                    size: 'Medium',
                }],
            },
            ...(facts.length > 0 ? [{ type: 'FactSet', facts }] : []),
        ],
        actions: [
            { type: 'Action.OpenUrl', title: '↗ View pipeline', url: viewUrl },
        ],
    };

    await sendCard(card, webhookUrl);
    console.log(`[teamsService] Sent completion card run=${run.run_id} status=${run.status}`);
}

export async function sendDecisionConfirmedCard(
    runId: string,
    stage: string,
    decision: 'approved' | 'rejected',
): Promise<void> {
    const icon = decision === 'approved' ? '✅' : '❌';
    const viewUrl = `${FRONTEND_URL}?teams_nav=detail&run_id=${encodeURIComponent(runId)}&stage=${encodeURIComponent(stage)}`;

    const card = {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
            {
                type: 'Container',
                style: decision === 'approved' ? 'good' : 'attention',
                items: [{
                    type: 'TextBlock',
                    text: `${icon}  Stage ${decision}`,
                    weight: 'Bolder',
                    size: 'Medium',
                }],
            },
            {
                type: 'FactSet',
                facts: [
                    { title: 'Stage',      value: stageLabel(stage) },
                    { title: 'Decision',   value: decision },
                    { title: 'Decided at', value: new Date().toUTCString() },
                ],
            },
        ],
        actions: [
            { type: 'Action.OpenUrl', title: '↗ View pipeline', url: viewUrl },
        ],
    };

    await sendCard(card);
}
