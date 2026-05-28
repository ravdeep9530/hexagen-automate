import type { Response } from 'express';
import { Client, Pool } from 'pg';
import { pipelineService, type PipelineRun } from './pipelineService';
import { githubService } from './githubService';
import { sendStageApprovalCard, sendPipelineCompleteCard } from './teamsService';
import { sendStageApprovalEmail, sendPipelineCompleteEmail } from './emailService';
import { getSettings } from './notificationSettingsService';
import type { NotificationTrigger } from './notificationTypes';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentic',
});

/**
 * Pipeline SSE broadcaster.
 *
 * Subscribes once to Postgres `pipeline_event` NOTIFY channel and fans out per
 * `run_id` to any HTTP/SSE clients currently listening for that run. Triggered
 * by the database triggers in infra/sql/002_pipeline_runs.sql.
 */

type ClientId = string;

interface Subscriber {
    id: ClientId;
    run_id: string;
    res: Response;
}

class PipelineEventBus {
    private subs = new Map<ClientId, Subscriber>();
    private byRun = new Map<string, Set<ClientId>>();
    private listenClient: Client | null = null;
    private started = false;
    private notifiedRuns = new Set<string>();
    private notifiedApprovalStages = new Set<string>(); // "{run_id}:{stage}"

    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        // Dedicated Client so the LISTEN connection isn't returned to the pool.
        this.listenClient = new Client({
            host: process.env.DB_HOST || 'postgres',
            port: parseInt(process.env.DB_PORT || '5432'),
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'agentic',
        });
        await this.listenClient.connect();
        await this.listenClient.query('LISTEN pipeline_event');
        this.listenClient.on('notification', (msg) => {
            const run_id = (msg.payload || '').trim();
            if (!run_id) return;
            void this.fanOut(run_id);
        });
        this.listenClient.on('error', (err) => {
            console.error('[pipelineEvents] LISTEN client error:', err);
            this.started = false;
            // try to reconnect after a short delay
            setTimeout(() => { this.start().catch(console.error); }, 3000);
        });
        console.log('[pipelineEvents] Listening on Postgres channel pipeline_event');
    }

    private async fanOut(run_id: string): Promise<void> {
        let snapshot;
        try {
            snapshot = await pipelineService.getRun(run_id);
        } catch (e) {
            console.error('[pipelineEvents] getRun failed:', e);
            return;
        }
        if (!snapshot) return;

        const ids = this.byRun.get(run_id);
        if (ids && ids.size > 0) {
            const frame = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
            for (const id of ids) {
                const sub = this.subs.get(id);
                if (sub) {
                    try { sub.res.write(frame); } catch { /* dead client; cleanup on close */ }
                }
            }
        }

        // Load notification channel settings once per fanOut (parallel DB reads)
        const [teamsSettings, emailSettings] = await Promise.all([
            getSettings('teams').catch(() => null),
            getSettings('email').catch(() => null),
        ]);

        // Dispatch approval notifications for any stage newly entering awaiting_approval
        for (const stage of snapshot.stages) {
            if (stage.status === 'awaiting_approval') {
                const key = `${run_id}:${stage.stage}`;
                if (!this.notifiedApprovalStages.has(key)) {
                    this.notifiedApprovalStages.add(key);

                    // Teams: null settings = env-var fallback (backward-compat)
                    if (!teamsSettings || (teamsSettings.enabled && teamsSettings.triggers.includes('stage_approval'))) {
                        void sendStageApprovalCard(snapshot, stage, teamsSettings).catch(e => {
                            console.error('[pipelineEvents] Teams approval card failed:', e);
                        });
                    }

                    if (emailSettings?.enabled && emailSettings.triggers.includes('stage_approval')) {
                        void sendStageApprovalEmail(snapshot, stage, emailSettings).catch(e => {
                            console.error('[pipelineEvents] Email approval notification failed:', e);
                        });
                    }
                }
            }
        }

        if ((snapshot.status === 'completed' || snapshot.status === 'rejected') &&
            !this.notifiedRuns.has(run_id)) {
            this.notifiedRuns.add(run_id);
            void this.postGitHubComment(run_id, snapshot);

            const trigger: NotificationTrigger = snapshot.status === 'completed'
                ? 'pipeline_complete'
                : 'pipeline_rejected';

            // Teams: null settings = env-var fallback (backward-compat)
            if (!teamsSettings || (teamsSettings.enabled && teamsSettings.triggers.includes(trigger))) {
                void sendPipelineCompleteCard(snapshot, teamsSettings).catch(e => {
                    console.error('[pipelineEvents] Teams completion card failed:', e);
                });
            }

            if (emailSettings?.enabled && emailSettings.triggers.includes(trigger)) {
                void sendPipelineCompleteEmail(snapshot, emailSettings).catch(e => {
                    console.error('[pipelineEvents] Email completion notification failed:', e);
                });
            }
        }
    }

    private async postGitHubComment(run_id: string, snapshot: PipelineRun): Promise<void> {
        try {
            const pat = process.env.GITHUB_PAT;
            if (!pat) return;

            const result = await pool.query(
                `SELECT pr.github_ref,
                        impl.artifact_url  AS impl_pr_url,
                        test_s.artifact_json AS test_artifact
                 FROM pipeline_runs pr
                 LEFT JOIN pipeline_stage_status impl ON impl.run_id = pr.run_id AND impl.stage = 'implementation'
                 LEFT JOIN pipeline_stage_status test_s ON test_s.run_id = pr.run_id AND test_s.stage = 'test'
                 WHERE pr.run_id = $1`,
                [run_id]
            );
            const row = result.rows[0];
            if (!row) return;

            const ref = row.github_ref as Record<string, unknown> | null;
            const implPrUrl: string | null = row.impl_pr_url;
            const testArtifact = row.test_artifact as Record<string, unknown> | null;
            const frontendUrl = process.env.FRONTEND_URL || 'http://52.139.40.16:3001';

            // 1. Post pipeline completion summary to the triggering issue/PR
            if (ref?.issue_number) {
                const icon = snapshot.status === 'completed' ? '✅' : '❌';
                const stageRows = snapshot.stages.map(s => {
                    const si = s.status === 'approved' ? '✅' : s.status === 'awaiting_approval' ? '⏳' : s.status === 'running' ? '🔄' : '❌';
                    const artifact = s.artifact_url ? ` — [artifact](${s.artifact_url})` : '';
                    return `| ${s.stage} | ${si} ${s.status}${artifact} |`;
                }).join('\n');

                const body = [
                    `## 🤖 SDLC Pipeline ${icon} ${snapshot.status}`,
                    '',
                    `**Run ID:** \`${run_id}\``,
                    '',
                    '| Stage | Status |',
                    '|---|---|',
                    stageRows,
                    '',
                    implPrUrl ? `**Draft PR created:** ${implPrUrl}` : '',
                    '',
                    `[View full pipeline →](${frontendUrl}/pipelines/${run_id})`,
                ].filter(l => l !== undefined).join('\n');

                await githubService.createIssueComment(
                    { token: pat },
                    ref.owner as string,
                    ref.repo as string,
                    ref.issue_number as number,
                    body
                );
                console.log(`[pipelineEvents] Posted pipeline summary to issue #${ref.issue_number}`);
            }

            // 2. Post test report as a comment on the implementation PR.
            // artifact_json shape: { answer, parsed: { ci_status, summary_markdown, ... }, usage, agent }
            // The test report fields live under `.parsed`, not at the top level.
            if (implPrUrl && testArtifact) {
                const prMatch = implPrUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
                if (prMatch) {
                    const [, prOwner, prRepo, prNumStr] = prMatch;
                    const parsed = (testArtifact.parsed as Record<string, unknown> | null) || {};
                    const summaryMd = (parsed.summary_markdown as string) || '';
                    const ciStatus = (parsed.ci_status as string) || 'unknown';
                    const ciIcon = ciStatus === 'passed' ? '✅' : ciStatus === 'failed' ? '❌' : '⚠️';

                    const testComment = [
                        `## ${ciIcon} Test Report — Stage 7`,
                        '',
                        `CI status: **${ciStatus}**`,
                        '',
                        summaryMd,
                        '',
                        `[View pipeline →](${frontendUrl}/pipelines/${run_id})`,
                    ].filter(l => l !== undefined && l !== null).join('\n');

                    await githubService.createIssueComment(
                        { token: pat },
                        prOwner,
                        prRepo,
                        parseInt(prNumStr, 10),
                        testComment
                    );
                    console.log(`[pipelineEvents] Posted test report to PR #${prNumStr}`);
                }
            }
        } catch (err) {
            console.error('[pipelineEvents] Failed to post GitHub comment:', err);
        }
    }

    subscribe(run_id: string, res: Response): () => void {
        const id = `${run_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sub: Subscriber = { id, run_id, res };
        this.subs.set(id, sub);
        let set = this.byRun.get(run_id);
        if (!set) {
            set = new Set();
            this.byRun.set(run_id, set);
        }
        set.add(id);

        // Push the current state immediately so the client paints right away.
        void pipelineService.getRun(run_id).then((snap) => {
            if (snap) res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
        });

        // Heartbeat every 25s to keep proxies from closing idle connections.
        const hb = setInterval(() => {
            try { res.write(': keep-alive\n\n'); } catch { /* closed */ }
        }, 25000);

        return () => {
            clearInterval(hb);
            this.subs.delete(id);
            const s = this.byRun.get(run_id);
            if (s) {
                s.delete(id);
                if (s.size === 0) this.byRun.delete(run_id);
            }
        };
    }
}

export const pipelineEventBus = new PipelineEventBus();
