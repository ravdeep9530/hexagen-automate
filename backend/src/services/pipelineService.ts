import { Pool } from 'pg';
import { promises as fs } from 'fs';
import * as path from 'path';
import { implementSprint, finalizeImplementation, type SprintTicket } from './agentImplementationService';
import { getDeployment, readDeploymentLog, deployRun, getSourceTree, getSourceFile, markDeploymentAutoFixing, listImplementationVersions, type Deployment } from './deploymentService';
import { callAzureChat, isAzureConfigured } from '../config/azure';
import { requirementsService } from './requirementsService';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentic',
});

// The n8n container's WEBHOOK_URL is `http://localhost:5678/`, so resume URLs
// stored in pipeline_stage_status have `localhost`. From the backend container
// on agentic-net we reach n8n at `http://agentic-n8n:5678`.
const N8N_INTERNAL_BASE = process.env.N8N_INTERNAL_BASE || 'http://agentic-n8n:5678';
const N8N_PIPELINE_WEBHOOK_URL =
    process.env.N8N_PIPELINE_WEBHOOK_URL || `${N8N_INTERNAL_BASE}/webhook/pipeline/start`;

export const STAGES = [
    'requirements',
    'optimize',
    'plan',
    'design',
    'sprint',
    'implementation',
    'test',
] as const;
export type Stage = typeof STAGES[number];

export interface PipelineRun {
    run_id: string;
    repo_full_name: string;
    raw_request: string;
    requester_id: string | null;
    status: string;
    current_stage: string | null;
    created_at: string;
    updated_at: string;
    stages: StageStatus[];
    deployment?: Deployment | null;
    design_preferences?: DesignPreferences | null;
    source_change_request_id?: string | null;
}

export interface StageStatus {
    stage: Stage;
    status: string;
    dify_run_id: string | null;
    resume_webhook_url: string | null;
    artifact_url: string | null;
    artifact_json: unknown;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    current_activity: string | null;
}

export interface RegistryRepo {
    repo_full_name: string;
    repo_url: string | null;
    default_branch: string;
    dify_workflow_app_ids: Record<string, string>;
    sharepoint_drive_id: string | null;
    slack_channel_id: string | null;
}

function rewriteResumeUrl(url: string): string {
    // Convert n8n's container-internal `http://localhost:5678/...` to a host we can reach.
    return url.replace(/^https?:\/\/localhost:5678/, N8N_INTERNAL_BASE);
}

export interface DesignReference {
    kind: 'website' | 'github';
    url: string;
    note?: string;
}

export interface DesignPreferences {
    preset?: 'material-ui' | 'tailwind-shadcn' | 'custom' | null;
    ideas?: string;
    references?: DesignReference[];
}

export class PipelineService {
    /** Kick off a new pipeline run by POSTing to n8n's webhook. */
    async createRun(input: {
        repo: string;
        raw_request: string;
        requester_id?: string;
        github_ref?: Record<string, unknown>;
        design_preferences?: DesignPreferences | null;
        project_id?: string;
    }): Promise<{ run_id: string }> {
        if (!input.repo) throw new Error('repo is required');
        if (!input.raw_request) throw new Error('raw_request is required');

        const resp = await fetch(N8N_PIPELINE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repo: input.repo,
                raw_request: input.raw_request,
                requester_id: input.requester_id || 'ui',
                // Forward design preferences so n8n can pass them into every
                // stage as an `inputs.design_preferences` field. Stage 1/4/6
                // Dify prompts can consume them; stages that ignore them
                // pay no cost.
                design_preferences: input.design_preferences || null,
            }),
        });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`n8n webhook returned ${resp.status}: ${txt.slice(0, 300)}`);
        }
        const body = (await resp.json()) as { run_id?: string };
        if (!body.run_id) throw new Error('n8n webhook did not return a run_id');

        // Persist design_preferences so the UI can render them back on the run
        // page even after the n8n payload is forgotten.
        if (input.design_preferences) {
            await pool.query(
                'UPDATE pipeline_runs SET design_preferences = $1::jsonb WHERE run_id = $2',
                [JSON.stringify(input.design_preferences), body.run_id]
            );
        }

        if (input.github_ref) {
            await pool.query(
                'UPDATE pipeline_runs SET github_ref = $1 WHERE run_id = $2',
                [JSON.stringify(input.github_ref), body.run_id]
            );
        }

        if (input.project_id) {
            await pool.query(
                'UPDATE pipeline_runs SET project_id = $1 WHERE run_id = $2',
                [input.project_id, body.run_id]
            );
        }

        return { run_id: body.run_id };
    }

    /** Return a full snapshot: run row + all stage statuses, ordered by stage. */
    async getRun(run_id: string): Promise<PipelineRun | null> {
        const runRes = await pool.query(
            `SELECT run_id, repo_full_name, raw_request, requester_id, status, current_stage,
                    created_at, updated_at, design_preferences, source_change_request_id
             FROM pipeline_runs WHERE run_id = $1`,
            [run_id]
        );
        if (runRes.rowCount === 0) return null;

        const stageRes = await pool.query(
            `SELECT stage, status, dify_run_id, resume_webhook_url, artifact_url, artifact_json,
                    started_at, finished_at, error, current_activity
             FROM pipeline_stage_status WHERE run_id = $1
             ORDER BY array_position(ARRAY['requirements','optimize','plan','design','sprint','implementation','test']::text[], stage)`,
            [run_id]
        );
        const row = runRes.rows[0];
        const deployment = await getDeployment(run_id).catch(() => null);
        return {
            run_id: row.run_id,
            repo_full_name: row.repo_full_name,
            raw_request: row.raw_request,
            requester_id: row.requester_id,
            status: row.status,
            current_stage: row.current_stage,
            created_at: row.created_at,
            updated_at: row.updated_at,
            stages: stageRes.rows as StageStatus[],
            deployment,
            design_preferences: row.design_preferences || null,
            source_change_request_id: row.source_change_request_id || null,
        };
    }

    /** List recent runs (lightweight — no stage details). */
    async listRuns(limit = 50, projectId?: string): Promise<Array<Omit<PipelineRun, 'stages'>>> {
        const params: unknown[] = [limit];
        const where = projectId ? `WHERE project_id = $2` : '';
        if (projectId) params.push(projectId);
        const r = await pool.query(
            `SELECT run_id, repo_full_name, raw_request, requester_id, status, current_stage, created_at, updated_at
             FROM pipeline_runs ${where} ORDER BY created_at DESC LIMIT $1`,
            params
        );
        return r.rows as Array<Omit<PipelineRun, 'stages'>>;
    }

    /** Approve or reject a stage — forwards to n8n's resume webhook. */
    async decideStage(run_id: string, stage: Stage, decision: 'approved' | 'rejected', reason?: string): Promise<void> {
        const r = await pool.query(
            `SELECT resume_webhook_url, status FROM pipeline_stage_status WHERE run_id = $1 AND stage = $2`,
            [run_id, stage]
        );
        if (r.rowCount === 0) throw new Error('stage not found for this run');
        const row = r.rows[0];
        if (row.status === 'awaiting_clarification') {
            throw new Error(
                'Stage is awaiting_clarification — submit clarification answers (or force_proceed) before approving.',
            );
        }
        if (row.status !== 'awaiting_approval') {
            // Idempotent: if Slack already approved, skip.
            return;
        }
        if (!row.resume_webhook_url) throw new Error('stage has no resume_webhook_url yet');

        // Stage 1: persist the approved requirements to SharePoint BEFORE
        // resuming n8n. We treat SP failure as a hard error so the user can
        // fix env/credentials and retry, rather than silently advancing past
        // an unrecorded approval.
        if (stage === 'requirements' && decision === 'approved') {
            await requirementsService.uploadApprovedRequirementsToSharePoint(run_id);
        }

        const url = rewriteResumeUrl(row.resume_webhook_url);
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, reason: reason || null }),
        });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`n8n resume returned ${resp.status}: ${txt.slice(0, 300)}`);
        }
    }

    /**
     * Rerun an entire pipeline by cloning the original run's input and firing
     * a fresh n8n webhook. Returns the new run_id.
     */
    async rerunRun(run_id: string): Promise<{ run_id: string }> {
        const r = await pool.query(
            `SELECT repo_full_name, raw_request, requester_id, design_preferences
               FROM pipeline_runs WHERE run_id = $1`,
            [run_id]
        );
        if (r.rowCount === 0) throw new Error('original run not found');
        const orig = r.rows[0];
        return this.createRun({
            repo: orig.repo_full_name,
            raw_request: orig.raw_request,
            requester_id: orig.requester_id || 'ui-rerun',
            design_preferences: orig.design_preferences || null,
        });
    }

    /**
     * Re-run a single stage in place. Currently only `implementation` is
     * supported — it re-executes implementSprint with the sprint stage's cached
     * tickets and the design stage's cached output. Returns immediately; the
     * actual work runs asynchronously and progress streams via SSE.
     */
    async rerunStage(run_id: string, stage: Stage): Promise<{ status: 'started' }> {
        // Stage 1: "rerun" is a pull from SharePoint. The user is treating
        // their edited requirements.json as the new source of truth.
        if (stage === 'requirements') {
            await requirementsService.syncFromSharePoint(run_id);
            return { status: 'started' };
        }
        if (stage !== 'implementation') {
            const err = new Error(
                `Stage "${stage}" cannot be rerun in place yet. Rerun the whole pipeline, or extend the n8n workflow to honor a start_stage parameter.`
            );
            (err as any).code = 'rerun_stage_unsupported';
            throw err;
        }

        const runRes = await pool.query(
            `SELECT repo_full_name FROM pipeline_runs WHERE run_id = $1`,
            [run_id]
        );
        if (runRes.rowCount === 0) throw new Error('run not found');
        const repo = runRes.rows[0].repo_full_name as string;

        const stageRes = await pool.query(
            `SELECT stage, artifact_json FROM pipeline_stage_status
               WHERE run_id = $1 AND stage IN ('sprint','design')`,
            [run_id]
        );
        const byStage = new Map<string, any>(stageRes.rows.map((r: any) => [r.stage, r.artifact_json]));
        const sprintArtifact = byStage.get('sprint');
        const designArtifact = byStage.get('design');
        const sprintParsed = sprintArtifact?.parsed ?? sprintArtifact;
        const designParsed = designArtifact?.parsed ?? designArtifact ?? '';
        const tickets: SprintTicket[] = Array.isArray(sprintParsed?.tickets) ? sprintParsed.tickets : [];
        if (tickets.length === 0) {
            throw new Error('cannot rerun implementation: sprint stage has no tickets cached');
        }

        // ── Archive current sprint + source before clearing ──────────────────
        const curImpl = await pool.query(
            `SELECT artifact_json FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'implementation'`,
            [run_id]
        );
        const curArtifact = curImpl.rows[0]?.artifact_json ?? {};
        const curSprint = curArtifact.sprint;
        const existingHistory: unknown[] = Array.isArray(curArtifact.sprint_history) ? curArtifact.sprint_history : [];
        const archiveVersion = existingHistory.length + 1;

        let newHistory = existingHistory;
        if (curSprint) {
            const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
            const srcDir = path.join(DEPLOYMENTS_ROOT, run_id, 'source');
            const archiveDir = path.join(DEPLOYMENTS_ROOT, run_id, `source_v${archiveVersion}`);
            // Best-effort copy — if source doesn't exist yet, skip
            await fs.cp(srcDir, archiveDir, { recursive: true }).catch(() => {});
            newHistory = [
                ...existingHistory,
                {
                    version: archiveVersion,
                    archived_at: new Date().toISOString(),
                    sprint: curSprint,
                    source_dir: `source_v${archiveVersion}`,
                },
            ];
        }

        // Reset the implementation row. Preserve sprint_history so previous
        // versions remain accessible while the new run is in progress.
        await pool.query(
            `UPDATE pipeline_stage_status
               SET status = 'running',
                   started_at = now(),
                   finished_at = NULL,
                   error = NULL,
                   artifact_json = jsonb_build_object('sprint_history', $2::jsonb)
             WHERE run_id = $1 AND stage = 'implementation'`,
            [run_id, JSON.stringify(newHistory)]
        );

        // Fire-and-forget: implementSprint can run for minutes. Progress is
        // pushed back via pushAgentProgress -> pipeline_event NOTIFY -> SSE.
        pool.query<{ ticket_id: string }>(
            `SELECT ticket_id FROM sprint_task_assignments WHERE run_id = $1 AND assignee <> 'system'`,
            [run_id],
        ).catch(() => ({ rows: [] as { ticket_id: string }[] })).then(({ rows }) => {
            const humanAssignees = new Set(rows.map(r => r.ticket_id));
            return implementSprint(repo, designParsed, tickets, run_id, null, {}, humanAssignees);
        }).then((result) => {
                // Mark the stage as awaiting_approval (matches n8n's normal
                // flow) once the loop completes. The user can then approve/reject.
                pool.query(
                    `UPDATE pipeline_stage_status
                       SET status = 'awaiting_approval', finished_at = now()
                     WHERE run_id = $1 AND stage = 'implementation'`,
                    [run_id]
                ).catch((e) => console.error('[rerunStage] failed to mark awaiting_approval:', e));
                console.log(`[rerunStage] implementation rerun complete for ${run_id}: ${result.succeeded_count}/${tickets.length} succeeded`);
            })
            .catch((e) => {
                console.error(`[rerunStage] implementSprint failed for ${run_id}:`, e);
                pool.query(
                    `UPDATE pipeline_stage_status
                       SET status = 'failed', finished_at = now(), error = $2
                     WHERE run_id = $1 AND stage = 'implementation'`,
                    [run_id, e instanceof Error ? e.message : 'rerun failed']
                ).catch(() => { /* swallow */ });
            });

        return { status: 'started' };
    }

    /**
     * Retry a single failed ticket without re-running the whole sprint.
     * Merges the previously-accumulated tree from the artifact, reruns only
     * this ticket, then patches its outcome back into artifact_json.
     */
    async retryTicket(run_id: string, ticket_id: string): Promise<{ status: string }> {
        // Load repo + sprint + design + current implementation artifact
        const runRes = await pool.query(`SELECT repo_full_name FROM pipeline_runs WHERE run_id = $1`, [run_id]);
        if (runRes.rows.length === 0) throw Object.assign(new Error(`run ${run_id} not found`), { code: 'run_not_found' });
        const repo = runRes.rows[0].repo_full_name as string;

        const stageRes = await pool.query(
            `SELECT stage, artifact_json FROM pipeline_stage_status
               WHERE run_id = $1 AND stage IN ('sprint','design','implementation')`,
            [run_id]
        );
        const byStage = new Map<string, any>(stageRes.rows.map((r: any) => [r.stage, r.artifact_json]));
        const sprintParsed = byStage.get('sprint')?.parsed ?? byStage.get('sprint');
        const designParsed = byStage.get('design')?.parsed ?? byStage.get('design') ?? '';
        const implArtifact = byStage.get('implementation') ?? {};

        const tickets: SprintTicket[] = Array.isArray(sprintParsed?.tickets) ? sprintParsed.tickets : [];
        const ticket = tickets.find(t => t.id === ticket_id);
        if (!ticket) throw Object.assign(new Error(`ticket ${ticket_id} not found in sprint`), { code: 'ticket_not_found' });

        // Build accumulatedTree from all previously-succeeded outcomes
        // Outcomes live at artifact_json.sprint.outcomes (written by pushSprintProgress)
        const outcomes: any[] = Array.isArray(implArtifact.sprint?.outcomes) ? implArtifact.sprint.outcomes : [];

        // Guard: refuse if this ticket is already being retried (prevents double-click / stuck state)
        const existing = outcomes.find(o => o.ticket_id === ticket_id);
        if (existing?._retrying) {
            throw Object.assign(new Error(`ticket ${ticket_id} is already being retried`), { code: 'already_retrying' });
        }
        const accumulatedTree: Record<string, string> = {};
        for (const o of outcomes) {
            if (o.ticket_id === ticket_id) continue; // skip the one we're retrying
            for (const f of (o.implementation_json?.files_changed ?? [])) {
                if ((f.action === 'create' || f.action === 'modify') && f.contents) {
                    accumulatedTree[f.path] = f.contents;
                } else if (f.action === 'delete') {
                    delete accumulatedTree[f.path];
                }
            }
        }

        // Mark as retrying in the artifact so the UI shows it immediately
        const patchOutcome = (status: string, extra: object = {}) => {
            const current = outcomes.find(o => o.ticket_id === ticket_id) ?? { ticket_id, title: ticket.title };
            const updated = { ...current, _retrying: status === 'running', ...extra };
            const newOutcomes = outcomes.some(o => o.ticket_id === ticket_id)
                ? outcomes.map(o => o.ticket_id === ticket_id ? updated : o)
                : [...outcomes, updated];
            return pool.query(
                `UPDATE pipeline_stage_status
                    SET artifact_json = jsonb_set(
                        COALESCE(artifact_json, '{}'),
                        '{sprint,outcomes}',
                        $2::jsonb
                    )
                  WHERE run_id = $1 AND stage = 'implementation'`,
                [run_id, JSON.stringify(newOutcomes)]
            );
        };

        await patchOutcome('running');

        // Fire-and-forget
        (async () => {
            try {
                const result = await finalizeImplementation(
                    repo,
                    ticket,
                    designParsed,
                    null,
                    run_id,
                    { existingTree: accumulatedTree, skipPR: true }
                );
                const succeeded = result.final_errors.length === 0 && !!result.final_implementation_json;
                await patchOutcome('done', {
                    _retrying: false,
                    pr_url: result.pr_url,
                    pr_number: result.pr_number,
                    branch_name: result.branch_name,
                    attempts: result.attempts,
                    final_errors: result.final_errors,
                    implementation_json: result.final_implementation_json,
                });
                console.log(`[retryTicket] ${ticket_id} retry ${succeeded ? 'succeeded' : 'failed'} for ${run_id}`);

                // If retry succeeded, cascade into any tickets that were blocked by this one.
                if (succeeded && result.final_implementation_json) {
                    await this.runUnblockedDependents(run_id, repo, designParsed, tickets);
                }
            } catch (e) {
                await patchOutcome('error', {
                    _retrying: false,
                    final_errors: [{ code: 'retry_failed', message: (e as Error).message }],
                });
                console.error(`[retryTicket] ${ticket_id} retry threw for ${run_id}:`, e);
            }
        })();

        return { status: 'started' };
    }

    /**
     * After a successful ticket retry, find tickets that were blocked solely by
     * that ticket (or others that are now resolved) and run them in dependency order.
     * Called recursively so a chain A→B→C all unblocks after A is fixed.
     */
    private async runUnblockedDependents(
        run_id: string,
        repo: string,
        designParsed: unknown,
        allTickets: SprintTicket[],
    ): Promise<void> {
        // Re-read the current artifact to get the latest outcomes
        const implRes = await pool.query(
            `SELECT artifact_json FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'implementation'`,
            [run_id]
        );
        const artifact = implRes.rows[0]?.artifact_json ?? {};
        const outcomes: any[] = Array.isArray(artifact.sprint?.outcomes) ? artifact.sprint.outcomes : [];

        // Build sets of succeeded and failed ticket ids from current outcomes.
        // A ticket is "failed" only if it has explicit final_errors AND is not
        // currently retrying — NOT just because it lacks an implementation_json.
        // This prevents in-progress retries and "blocked" tickets from being
        // misclassified as failed and incorrectly blocking their dependents.
        const succeededIds = new Set<string>();
        const failedIds = new Set<string>();
        for (const o of outcomes) {
            const hasImpl = !!o.implementation_json;
            const noErrors = !o.final_errors?.length;
            const isRetrying = !!o._retrying;
            const isBlocked = typeof o.skipped === 'string' && o.skipped.startsWith('blocked');
            const hasFinalErrors = Array.isArray(o.final_errors) && o.final_errors.length > 0;

            if (hasImpl && noErrors && !isRetrying) succeededIds.add(o.ticket_id);
            else if (hasFinalErrors && !isRetrying && !isBlocked) failedIds.add(o.ticket_id);
            // tickets that are retrying, blocked, or have no data yet → neither succeeded nor failed
        }

        // Find tickets that were blocked but now have all deps succeeded
        const nowUnblocked: SprintTicket[] = [];
        for (const o of outcomes) {
            if (typeof o.skipped !== 'string' || !o.skipped.startsWith('blocked')) continue;
            const ticket = allTickets.find(t => t.id === o.ticket_id);
            if (!ticket) continue;
            const deps = ticket.dependencies ?? [];
            const allDepsDone = deps.every(d => succeededIds.has(d));
            const anyDepFailed = deps.some(d => failedIds.has(d));
            if (allDepsDone && !anyDepFailed) nowUnblocked.push(ticket);
        }

        if (nowUnblocked.length === 0) return;
        console.log(`[cascade] unblocking ${nowUnblocked.map(t => t.id).join(', ')} for ${run_id}`);

        // Sort by dependency order (simple: tickets whose deps are all satisfied first)
        nowUnblocked.sort((a, b) => {
            const aBlocksB = (b.dependencies ?? []).includes(a.id);
            return aBlocksB ? -1 : 1;
        });

        // Build accumulated tree from all succeeded outcomes
        const accTree: Record<string, string> = {};
        for (const o of outcomes) {
            if (!succeededIds.has(o.ticket_id)) continue;
            for (const f of (o.implementation_json?.files_changed ?? [])) {
                if ((f.action === 'create' || f.action === 'modify') && f.contents) accTree[f.path] = f.contents;
                else if (f.action === 'delete') delete accTree[f.path];
            }
        }

        // Run each unblocked ticket sequentially, folding its output into accTree
        for (const ticket of nowUnblocked) {
            // Mark as retrying in the artifact
            const currentOutcomes: any[] = (() => {
                const a = pool.query(
                    `SELECT artifact_json FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'implementation'`,
                    [run_id]
                );
                return [];
            })();
            // Optimistic patch: mark this ticket as running
            await pool.query(
                `UPDATE pipeline_stage_status
                    SET artifact_json = jsonb_set(
                        COALESCE(artifact_json, '{}'),
                        '{sprint,outcomes}',
                        (SELECT jsonb_agg(
                            CASE WHEN elem->>'ticket_id' = $2
                                 THEN elem || '{"_retrying":true,"skipped":null}'::jsonb
                                 ELSE elem
                            END
                        ) FROM jsonb_array_elements(COALESCE(artifact_json->'sprint'->'outcomes', '[]'::jsonb)) elem)
                    )
                  WHERE run_id = $1 AND stage = 'implementation'`,
                [run_id, ticket.id]
            );

            try {
                const result = await finalizeImplementation(
                    repo, ticket, designParsed, null, run_id,
                    { existingTree: { ...accTree }, skipPR: true }
                );
                const ok = result.final_errors.length === 0 && !!result.final_implementation_json;

                // Patch outcome back
                await pool.query(
                    `UPDATE pipeline_stage_status
                        SET artifact_json = jsonb_set(
                            COALESCE(artifact_json, '{}'),
                            '{sprint,outcomes}',
                            (SELECT jsonb_agg(
                                CASE WHEN elem->>'ticket_id' = $2
                                     THEN $3::jsonb
                                     ELSE elem
                                END
                            ) FROM jsonb_array_elements(COALESCE(artifact_json->'sprint'->'outcomes', '[]'::jsonb)) elem)
                        )
                      WHERE run_id = $1 AND stage = 'implementation'`,
                    [run_id, ticket.id, JSON.stringify({
                        ticket_id: ticket.id,
                        title: ticket.title,
                        _retrying: false,
                        skipped: null,
                        pr_url: result.pr_url,
                        pr_number: result.pr_number,
                        branch_name: result.branch_name,
                        attempts: result.attempts,
                        final_errors: result.final_errors,
                        implementation_json: result.final_implementation_json,
                    })]
                );

                if (ok && result.final_implementation_json) {
                    // Fold files into accTree for next dependents
                    for (const f of (result.final_implementation_json.files_changed ?? [])) {
                        if ((f.action === 'create' || f.action === 'modify') && f.contents) accTree[f.path] = f.contents;
                        else if (f.action === 'delete') delete accTree[f.path];
                    }
                    // Update succeededIds and recurse in case this unblocks more
                    succeededIds.add(ticket.id);
                    console.log(`[cascade] ${ticket.id} succeeded, checking for further unblocked tickets`);
                    await this.runUnblockedDependents(run_id, repo, designParsed, allTickets);
                } else {
                    failedIds.add(ticket.id);
                    console.log(`[cascade] ${ticket.id} still failed after cascade run`);
                }
            } catch (e) {
                console.error(`[cascade] ${ticket.id} threw:`, e);
                failedIds.add(ticket.id);
            }
        }
    }

    /**
     * Re-run the implementation stage using the latest deploy log as additional
     * Dify context. Used when an app crashes on deploy and the user wants the
     * agent to regenerate the code with that crash trace in scope.
     */

    /** Analyse the deployment failure using AI, read relevant source files, and return
     *  a structured diagnosis with specific file changes to apply. */
    async diagnoseDeployError(run_id: string): Promise<{
        error_type: string;
        summary: string;
        detail: string;
        strategy: string;
        strategy_label: string;
        strategy_description: string;
        file_changes: Array<{ path: string; new_content: string; explanation: string }>;
        log_excerpt: string;
    }> {
        const dep = await getDeployment(run_id);
        if (!dep) throw new Error('no deployment exists for this run yet');

        const tail = await readDeploymentLog(run_id, 0, 16 * 1024);
        const logExcerpt = (tail.content || '').slice(-6000);

        // Collect relevant source files to give AI full context
        let sourceContext = '';
        try {
            const tree = await getSourceTree(run_id);
            // Priority files the AI must see
            const PRIORITY = ['Dockerfile', 'package.json', 'requirements.txt', 'pyproject.toml',
                               'tsconfig.json', 'next.config.mjs', 'next.config.js', 'vite.config.ts',
                               '.env.example', 'docker-compose.yml', 'main.py', 'app.py', 'server.ts',
                               'index.ts', 'src/app/layout.tsx', 'src/index.ts'];

            const flatFiles: string[] = [];
            function flatten(nodes: any[]) {
                for (const n of nodes) {
                    if (n.type === 'file') flatFiles.push(n.path);
                    else if (n.children) flatten(n.children);
                }
            }
            flatten(tree);

            const toRead = [
                ...PRIORITY.filter(p => flatFiles.includes(p)),
                ...flatFiles.filter(f => !PRIORITY.includes(f)).slice(0, 5),
            ].slice(0, 12);

            const parts: string[] = [];
            for (const filePath of toRead) {
                try {
                    const { content } = await getSourceFile(run_id, filePath);
                    parts.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
                } catch {}
            }
            sourceContext = parts.join('\n\n');
        } catch {}

        // If AI isn't configured, fall back to fast pattern-match
        if (!isAzureConfigured()) {
            return this._patternDiagnose(logExcerpt);
        }

        const systemPrompt = `You are a senior DevOps engineer diagnosing why a Dockerized web application failed to deploy.
You are given:
1. The full deployment log (docker build + docker run output)
2. The source files of the generated app

Your job is to:
- Identify the root cause precisely
- Propose the MINIMAL set of file edits needed to fix it (prefer changing 1-2 files over running all sprint tickets again)
- If it is a Docker infrastructure issue (stale container name, port conflict) rather than a code problem, say so and recommend just redeploying

Return ONLY valid JSON with this exact schema:
{
  "error_type": "docker_daemon|port_conflict|dockerfile_error|missing_module|code_error|startup_timeout|unknown",
  "summary": "one line description of what went wrong",
  "detail": "2-3 sentence plain-English explanation suitable for a developer",
  "strategy": "redeploy|patch_files|full_reimplementation",
  "strategy_label": "short label for the apply button (< 8 words)",
  "strategy_description": "one sentence explaining what will happen",
  "file_changes": [
    {
      "path": "relative/path/to/file",
      "new_content": "full new content of the file",
      "explanation": "what changed and why"
    }
  ]
}

Rules:
- "redeploy" strategy = Docker infrastructure problem, no file changes needed. file_changes must be [].
- "patch_files" strategy = fix 1-3 specific files. Include full new_content for each.
- "full_reimplementation" strategy = only if the problem requires regenerating many files. file_changes must be [].
- Do not invent file paths. Only reference files that appear in the source files section.
- Keep new_content complete and correct — it will be written to disk directly.`;

        const userPrompt = `## Deployment Log\n\`\`\`\n${logExcerpt}\n\`\`\`\n\n## Source Files\n${sourceContext || '(no source files available)'}`;

        let result: any;
        try {
            const raw = await callAzureChat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ], 0.15);
            // Strip markdown fences if present
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            result = JSON.parse(cleaned);
        } catch (e) {
            console.warn('[diagnoseDeployError] AI response parse failed, falling back to pattern match:', e);
            return this._patternDiagnose(logExcerpt);
        }

        return {
            error_type:           result.error_type ?? 'unknown',
            summary:              result.summary ?? 'Deployment failed',
            detail:               result.detail ?? '',
            strategy:             result.strategy ?? 'full_reimplementation',
            strategy_label:       result.strategy_label ?? 'Apply fix',
            strategy_description: result.strategy_description ?? '',
            file_changes:         Array.isArray(result.file_changes) ? result.file_changes : [],
            log_excerpt:          logExcerpt.slice(-2000),
        };
    }

    private _patternDiagnose(log: string) {
        const l = log.toLowerCase();
        if (/exit(ed)? (with )?code[:\s]+125|docker run exited 125/.test(l)) {
            return { error_type: 'docker_daemon', summary: 'Docker daemon error (exit 125)', detail: 'Docker failed to start the container — container name conflict or port already in use. A redeploy is usually enough.', strategy: 'redeploy', strategy_label: 'Redeploy (retry)', strategy_description: 'Stop stale container and retry docker run.', file_changes: [], log_excerpt: log.slice(-2000) };
        }
        if (/modulenotfounderror|cannot find module|no module named/.test(l)) {
            return { error_type: 'missing_module', summary: 'Missing module at startup', detail: 'App crashed because a required module is not installed.', strategy: 'full_reimplementation', strategy_label: 'Rerun all sprint tickets', strategy_description: 'Regenerate the codebase with the error as context.', file_changes: [], log_excerpt: log.slice(-2000) };
        }
        return { error_type: 'unknown', summary: 'Deployment failed', detail: 'Could not auto-diagnose. Check the log for details.', strategy: 'full_reimplementation', strategy_label: 'Rerun all sprint tickets', strategy_description: 'Regenerate the codebase with the crash log as context.', file_changes: [], log_excerpt: log.slice(-2000) };
    }

    async fixWithDeployError(run_id: string, strategy: string = 'full_reimplementation', req?: any): Promise<{ status: 'started'; log_excerpt: string }> {
        const dep = await getDeployment(run_id);
        if (!dep) throw new Error('no deployment exists for this run yet');

        const tail = await readDeploymentLog(run_id, 0, 8 * 1024);
        const logExcerpt = (tail.content || '').slice(-4000);

        // 'redeploy': no code changes — just stop stale container and retry docker run.
        if (strategy === 'redeploy') {
            await deployRun(run_id);
            return { status: 'started', log_excerpt: logExcerpt.slice(-500) };
        }

        // 'patch_files': apply AI-proposed file changes to source dir, then redeploy.
        // The caller must pass the file_changes array from the diagnosis response in req.body.
        if (strategy === 'patch_files') {
            const fileChanges: Array<{ path: string; new_content: string }> = (req as any)?.fileChanges ?? [];
            if (fileChanges.length === 0) throw new Error('patch_files strategy requires file_changes in request body');
            const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
            const sourceDir = path.join(DEPLOYMENTS_ROOT, run_id, 'source');
            for (const change of fileChanges) {
                const safe = path.normalize(change.path).replace(/^(\.\.(\/|\\|$))+/, '');
                const abs = path.join(sourceDir, safe);
                if (!abs.startsWith(sourceDir + path.sep)) throw new Error(`path traversal rejected: ${change.path}`);
                await fs.mkdir(path.dirname(abs), { recursive: true });
                await fs.writeFile(abs, change.new_content, 'utf8');
                console.log(`[patch_files] wrote ${safe} for ${run_id}`);
            }
            await deployRun(run_id);
            return { status: 'started', log_excerpt: logExcerpt.slice(-500) };
        }

        if (!logExcerpt.trim()) {
            throw new Error('deployment log is empty — nothing to feed back to the agent');
        }

        const runRes = await pool.query(
            `SELECT repo_full_name FROM pipeline_runs WHERE run_id = $1`,
            [run_id]
        );
        if (runRes.rowCount === 0) throw new Error('run not found');
        const repo = runRes.rows[0].repo_full_name as string;

        const stageRes = await pool.query(
            `SELECT stage, artifact_json FROM pipeline_stage_status
               WHERE run_id = $1 AND stage IN ('sprint','design','implementation')`,
            [run_id]
        );
        const byStage = new Map<string, any>(stageRes.rows.map((r: any) => [r.stage, r.artifact_json]));
        const sprintParsed = byStage.get('sprint')?.parsed ?? byStage.get('sprint');
        const designParsed = byStage.get('design')?.parsed ?? byStage.get('design') ?? '';
        const allTickets: SprintTicket[] = Array.isArray(sprintParsed?.tickets) ? sprintParsed.tickets : [];
        if (allTickets.length === 0) {
            throw new Error('cannot re-implement: sprint stage has no tickets cached');
        }

        // For targeted strategy, pick only tickets that likely own the failing files.
        // We look at files_likely_touched for tickets and cross-reference with any
        // file paths mentioned in the crash log.
        let tickets = allTickets;
        if (strategy === 'targeted_reimplementation') {
            const logLines = logExcerpt.toLowerCase();
            const targeted = allTickets.filter(t => {
                const files: string[] = Array.isArray(t.files_likely_touched) ? t.files_likely_touched : [];
                // Check if any file this ticket owns is mentioned in the crash log
                return files.some(f => logLines.includes(f.toLowerCase().split('/').pop() ?? f));
            });
            // Fall back to tickets that own startup/config if none matched by filename
            if (targeted.length === 0) {
                const configKeywords = ['dockerfile', 'package.json', 'requirements.txt', 'main.py', 'index.ts', 'server.ts', 'app.ts'];
                const configTargeted = allTickets.filter(t => {
                    const files: string[] = Array.isArray(t.files_likely_touched) ? t.files_likely_touched : [];
                    return files.some(f => configKeywords.some(k => f.toLowerCase().includes(k)));
                });
                tickets = configTargeted.length > 0 ? configTargeted : allTickets.slice(0, 2);
            } else {
                tickets = targeted;
            }
        }

        const augmentedDesign = (
            typeof designParsed === 'string' ? designParsed : JSON.stringify(designParsed)
        ) + `\n\n# RUNTIME FAILURE FROM PREVIOUS DEPLOY\n` +
        `The previous build of this codebase crashed when started. ` +
        `Fix the underlying cause when re-implementing — do not just suppress the error. ` +
        `Last 4 KB of the deploy log:\n\n\`\`\`\n${logExcerpt}\n\`\`\``;

        // For targeted re-implementation, preserve existing successful outcomes and only
        // replace the targeted ones so the rest of the implementation is kept.
        const existingArtifact = byStage.get('implementation') ?? {};
        const existingOutcomes: any[] = existingArtifact?.sprint?.outcomes ?? [];
        const targetedIds = new Set(tickets.map((t: any) => t.id));

        await pool.query(
            `UPDATE pipeline_stage_status
               SET status = 'running',
                   started_at = now(),
                   finished_at = NULL,
                   error = NULL
             WHERE run_id = $1 AND stage = 'implementation'`,
            [run_id]
        );

        pool.query<{ ticket_id: string }>(
            `SELECT ticket_id FROM sprint_task_assignments WHERE run_id = $1 AND assignee <> 'system'`,
            [run_id],
        ).catch(() => ({ rows: [] as { ticket_id: string }[] })).then(({ rows }) => {
            const humanAssignees = new Set(rows.map(r => r.ticket_id));
            return implementSprint(repo, augmentedDesign, tickets, run_id, null, {}, humanAssignees);
        }).then(async (result) => {
                // Merge new outcomes back into any preserved outcomes
                if (strategy === 'targeted_reimplementation' && existingOutcomes.length > 0) {
                    const mergedOutcomes = [
                        ...existingOutcomes.filter((o: any) => !targetedIds.has(o.ticket_id)),
                        ...result.outcomes,
                    ];
                    await pool.query(
                        `UPDATE pipeline_stage_status
                           SET status = 'awaiting_approval', finished_at = now(),
                               artifact_json = jsonb_set(
                                   COALESCE(artifact_json, '{}'::jsonb),
                                   '{sprint,outcomes}', $2::jsonb
                               )
                         WHERE run_id = $1 AND stage = 'implementation'`,
                        [run_id, JSON.stringify(mergedOutcomes)]
                    );
                } else {
                    await pool.query(
                        `UPDATE pipeline_stage_status
                           SET status = 'awaiting_approval', finished_at = now()
                         WHERE run_id = $1 AND stage = 'implementation'`,
                        [run_id]
                    );
                }
                console.log(`[fixWithDeployError:${strategy}] complete for ${run_id}: ${result.succeeded_count}/${tickets.length} re-implemented`);
            })
            .catch((e) => {
                console.error(`[fixWithDeployError] implementSprint failed for ${run_id}:`, e);
                pool.query(
                    `UPDATE pipeline_stage_status
                       SET status = 'failed', finished_at = now(), error = $2
                     WHERE run_id = $1 AND stage = 'implementation'`,
                    [run_id, e instanceof Error ? e.message : 'fix-with-deploy-error failed']
                ).catch(() => { /* */ });
            });

        return { status: 'started', log_excerpt: logExcerpt.slice(-500) };
    }

    /**
     * Triggered automatically when a deployment crash is detected.
     * Runs a focused agent against the source files to fix the error, then redeploys.
     * Does NOT re-run the full sprint — only patches the broken files.
     */
    async autoFixDeploy(run_id: string, crashExcerpt: string): Promise<void> {
        const DEPLOYMENTS_ROOT = process.env.DEPLOYMENTS_ROOT || '/app/deployments';
        const sourceDir = path.join(DEPLOYMENTS_ROOT, run_id, 'source');

        console.log(`[autoFixDeploy] starting for ${run_id}, crash: ${crashExcerpt.slice(0, 120)}`);

        try {
            await markDeploymentAutoFixing(run_id);

            // Push status update so the frontend shows "auto-fixing"
            await pool.query(
                `UPDATE pipeline_stage_status
                    SET artifact_json = jsonb_set(
                        COALESCE(artifact_json, '{}'),
                        '{agent}',
                        jsonb_build_object(
                            'status', 'agent:exploring',
                            'auto_fix', true,
                            'auto_fix_error', $2::text
                        )
                    )
                  WHERE run_id = $1 AND stage = 'implementation'`,
                [run_id, crashExcerpt.slice(0, 500)]
            );

            // Walk source directory to build existing tree
            const existingTree: Record<string, string> = {};
            async function walkDir(dir: string, rel = '') {
                const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    const skip = new Set(['node_modules', '.next', 'dist', '.git', 'coverage']);
                    if (skip.has(e.name) || e.name.startsWith('.')) continue;
                    const entryRel = rel ? `${rel}/${e.name}` : e.name;
                    if (e.isDirectory()) {
                        await walkDir(path.join(dir, e.name), entryRel);
                    } else {
                        const content = await fs.readFile(path.join(dir, e.name), 'utf8').catch(() => null);
                        if (content !== null && content.length < 256 * 1024) {
                            existingTree[entryRel] = content;
                        }
                    }
                }
            }
            await walkDir(sourceDir);

            const { runAzureAgentForTicket } = await import('./openAICodeAgentService');

            const logPath = path.join(DEPLOYMENTS_ROOT, run_id, 'fix-agent.log');
            const ticket = {
                id: `fix-${run_id.slice(0, 8)}`,
                title: 'Fix deployment crash',
                description: `The deployed application crashed. Fix the error so the app builds and runs successfully.\n\nCrash log:\n${crashExcerpt}`,
                files_likely_touched: Object.keys(existingTree).filter(f =>
                    crashExcerpt.split('\n').some(line => f && line.toLowerCase().includes(f.split('/').pop()!.toLowerCase()))
                ).slice(0, 10),
            };

            const fixPrompt = `Fix a deployment crash. The error from the deployment log is:\n\n${crashExcerpt.slice(0, 2000)}\n\nFocus: read the failing files, understand the error, apply the minimal fix. Run \`npm run build 2>&1 | tail -20\` to verify. Call finish() when build succeeds.`;

            const result = await runAzureAgentForTicket(
                '', ticket, fixPrompt, existingTree, run_id,
                {
                    liveLogPath: logPath,
                    systemPromptSuffix: `## CRASH-FIX RUN — SPECIAL RULES
- This is a targeted crash fix. Do NOT run \`npx tsc --noEmit\` (too slow; test files have pre-existing errors unrelated to the crash).
- ONLY verify with: \`npm run build 2>&1 | tail -30\`
- If build succeeds (no "Failed to compile" / "Module not found" lines), call finish() immediately.
- Do NOT write new tests. Do NOT fix pre-existing TypeScript errors in test files.
- Focus only on the files named in the crash log excerpt above.`,
                    onProgress: async (turn, phase) => {
                        await pool.query(
                            `UPDATE pipeline_stage_status
                                SET artifact_json = jsonb_set(
                                    COALESCE(artifact_json, '{}'),
                                    '{agent}',
                                    jsonb_build_object(
                                        'status', $3::text,
                                        'auto_fix', true,
                                        'current_turn', $4::int,
                                        'auto_fix_error', $2::text
                                    )
                                )
                              WHERE run_id = $1 AND stage = 'implementation'`,
                            [run_id, crashExcerpt.slice(0, 300),
                             `agent:${phase}`, turn]
                        );
                    },
                }
            );

            // Write fixed files back to source directory
            let fixedCount = 0;
            for (const f of (result.files_changed ?? [])) {
                if (f.action === 'delete') continue;
                const abs = path.join(sourceDir, f.path);
                await fs.mkdir(path.dirname(abs), { recursive: true });
                await fs.writeFile(abs, f.contents ?? '', 'utf8');
                fixedCount++;
            }
            console.log(`[autoFixDeploy] agent fixed ${fixedCount} files for ${run_id}, redeploying`);

            // Redeploy with fixed files
            await deployRun(run_id);

            await pool.query(
                `UPDATE pipeline_stage_status
                    SET artifact_json = jsonb_set(
                        COALESCE(artifact_json, '{}'),
                        '{agent}',
                        jsonb_build_object('status', 'done', 'auto_fix', true, 'auto_fix_files_changed', $2::int)
                    )
                  WHERE run_id = $1 AND stage = 'implementation'`,
                [run_id, fixedCount]
            );
        } catch (e) {
            console.error(`[autoFixDeploy] failed for ${run_id}:`, e);
            await pool.query(
                `UPDATE pipeline_deployments SET status = 'failed', error = $2
                   WHERE run_id = $1`,
                [run_id, `Auto-fix failed: ${e instanceof Error ? e.message : String(e)}`]
            ).catch(() => { /* */ });
        }
    }

    /**
     * Create a new pipeline run from a change request.
     * Stages before the CR stage are pre-seeded as approved so n8n skips them.
     * The CR stage itself is seeded with the proposed artifact at awaiting_approval
     * so the user reviews it before the pipeline continues.
     */
    async createRunFromChangeRequest(crId: string): Promise<{ run_id: string }> {
        const crRes = await pool.query(
            `SELECT cr.*, pr.repo_full_name, pr.raw_request, pr.requester_id, pr.design_preferences
               FROM change_requests cr
               JOIN pipeline_runs pr ON pr.run_id = cr.run_id
              WHERE cr.id = $1`,
            [crId],
        );
        if (crRes.rowCount === 0) throw new Error('Change request not found');
        const cr = crRes.rows[0];

        if (cr.status !== 'pending') {
            throw Object.assign(new Error(`Change request is already ${cr.status}`), { code: 'already_resolved' });
        }

        // Spin up a new pipeline run via n8n.
        const { run_id: newRunId } = await this.createRun({
            repo: cr.repo_full_name,
            raw_request: cr.raw_request,
            requester_id: cr.requester_id || 'change-request',
            design_preferences: cr.design_preferences || null,
        });

        // Tag the new run as originating from this CR.
        await pool.query(
            `UPDATE pipeline_runs SET source_change_request_id = $2 WHERE run_id = $1`,
            [newRunId, crId],
        );

        // Pre-seed all stages before the CR stage as approved with their snapshot data.
        const crStageIndex = STAGES.indexOf(cr.stage as Stage);
        const stageSnapshots = (cr.stage_snapshots as Record<string, unknown>) ?? {};

        for (let i = 0; i < crStageIndex; i++) {
            const stageName = STAGES[i];
            const snapshotArtifact = stageSnapshots[stageName] ?? {};
            await pool.query(
                `INSERT INTO pipeline_stage_status (run_id, stage, status, artifact_json, started_at, finished_at)
                 VALUES ($1, $2, 'approved', $3::jsonb, now(), now())
                 ON CONFLICT (run_id, stage) DO UPDATE
                   SET status = 'approved',
                       artifact_json = EXCLUDED.artifact_json,
                       started_at = EXCLUDED.started_at,
                       finished_at = EXCLUDED.finished_at,
                       updated_at = now()`,
                [newRunId, stageName, JSON.stringify(snapshotArtifact)],
            );
        }

        // Seed the CR stage itself with the proposed artifact at awaiting_approval
        // so the user can review and approve before n8n continues past it.
        await pool.query(
            `INSERT INTO pipeline_stage_status (run_id, stage, status, artifact_json, started_at, finished_at)
             VALUES ($1, $2, 'awaiting_approval', $3::jsonb, now(), now())
             ON CONFLICT (run_id, stage) DO UPDATE
               SET status = 'awaiting_approval',
                   artifact_json = EXCLUDED.artifact_json,
                   started_at = EXCLUDED.started_at,
                   finished_at = EXCLUDED.finished_at,
                   updated_at = now()`,
            [newRunId, cr.stage, JSON.stringify(cr.proposed_artifact)],
        );

        return { run_id: newRunId };
    }

    /** Return repos available in the registry. */
    async listRepos(projectId?: string): Promise<RegistryRepo[]> {
        const params: unknown[] = [];
        const where = projectId ? `WHERE project_id = $1` : '';
        if (projectId) params.push(projectId);
        const r = await pool.query(
            `SELECT repo_full_name, repo_url, default_branch, dify_workflow_app_ids,
                    sharepoint_drive_id, slack_channel_id
             FROM agent_repo_registry ${where} ORDER BY repo_full_name`,
            params
        );
        return r.rows as RegistryRepo[];
    }
}

export const pipelineService = new PipelineService();
