import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { validateAzureConfig } from './config/azure';
import { sdlAgentService } from './services/sdlAgentService';
import { integrationService } from './services/integrationService';
import { githubService } from './services/githubService';
import { sharepointService } from './services/sharepointService';
import { pipelineService, STAGES, type Stage } from './services/pipelineService';
import { requirementsService } from './services/requirementsService';
import { pipelineEventBus } from './services/pipelineEvents';
import { finalizeImplementation, implementSprint, validateImplementation, createPRsForRun } from './services/agentImplementationService';
import { listTemplates, openScaffoldPR } from './services/scaffoldService';
import { deployRun, stopDeployment, getDeployment, readDeploymentLog, readSandboxLog, readFixAgentLog, initializeDeploymentTables, getSourceTree, getSourceFile, runVerification, deployEvents } from './services/deploymentService';
import { generatePlanDoc, generatePlanOverviewDoc, generateDesignDoc, generateDesignOverviewDoc, type PlanArtifact, type DesignArtifact } from './services/documentationService';
import { orgsRouter } from './routes/orgsRouter';
import { teamsRouter } from './routes/teamsRouter';
import { notificationsRouter } from './routes/notificationsRouter';
import { initializeNotificationTable } from './services/notificationSettingsService';
import { changeRequestService } from './services/changeRequestService';

dotenv.config();
validateAzureConfig();

// Initialize integration tables
integrationService.initializeTables().catch(console.error);

// Initialize notification settings table
initializeNotificationTable().catch((e) => console.error('[notificationSettings] init failed:', e));

// Initialize deployment tracking table + reconcile orphaned rows after restart.
initializeDeploymentTables().catch((e) => console.error('[deploymentService] init failed:', e));

// Start listening on Postgres `pipeline_event` channel for SSE fan-out.
pipelineEventBus.start().catch((e) => console.error('[pipelineEventBus] failed to start:', e));

// Auto-fix deployments when crash is detected (one fix agent per run at a time)
const activeAutoFixes = new Set<string>();

function startAutoFix(runId: string, crashExcerpt: string) {
    if (activeAutoFixes.has(runId)) {
        console.log(`[server] auto-fix already running for ${runId}, skipping duplicate crash event`);
        return;
    }
    activeAutoFixes.add(runId);
    console.log(`[server] deployment crashed for ${runId}, triggering auto-fix agent`);
    pipelineService.autoFixDeploy(runId, crashExcerpt)
        .catch(e => console.error(`[server] autoFixDeploy failed for ${runId}:`, e))
        .finally(() => activeAutoFixes.delete(runId));
}

deployEvents.on('crashed', startAutoFix);

// On startup, resume any deployments stuck in auto-fixing state (e.g. backend restarted mid-fix)
setTimeout(async () => {
    try {
        const pool2 = new Pool({
            user: process.env.DB_USER, host: process.env.DB_HOST,
            database: process.env.DB_NAME, password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT || '5432'),
        });

        // Resume crashed deployments stuck in auto-fixing
        const res = await pool2.query(
            `SELECT run_id, error FROM pipeline_deployments WHERE status = 'auto-fixing'`
        );
        for (const row of res.rows) {
            console.log(`[server] resuming auto-fix for ${row.run_id} (stuck on restart)`);
            startAutoFix(row.run_id, row.error ?? 'Unknown crash (resumed after restart)');
        }

        // Clear any ticket outcomes stuck as _retrying:true (backend died mid-retry).
        // Reset them back to failed so the user can retry again.
        await pool2.query(`
            UPDATE pipeline_stage_status
               SET artifact_json = jsonb_set(
                   artifact_json,
                   '{sprint,outcomes}',
                   (SELECT jsonb_agg(
                       CASE WHEN (elem->>'_retrying')::boolean = true
                            THEN elem
                                 || jsonb_build_object('_retrying', false)
                                 || jsonb_build_object('final_errors', COALESCE(elem->'final_errors', '[]'::jsonb)
                                    || '[{"code":"retry_interrupted","message":"Retry was interrupted (backend restarted). Click Retry to try again."}]'::jsonb)
                            ELSE elem
                       END
                   ) FROM jsonb_array_elements(artifact_json->'sprint'->'outcomes') elem)
               )
             WHERE stage = 'implementation'
               AND artifact_json->'sprint'->'outcomes' @> '[{"_retrying":true}]'
        `);

        await pool2.end();
    } catch (e) {
        console.error('[server] startup cleanup failed:', e);
    }
}, 5_000); // wait 5s for DB pool to initialize

const app = express();
const port = 5000;

// Enable CORS for all origins (restrict in production)
app.use(cors());

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});

// Initialize database tables if not exists
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agents (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL,
                description TEXT,
                config JSONB DEFAULT '{}',
                last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Backfill any older deployments missing these columns
        await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'code_review'`);
        await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'`);
        await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS description TEXT`);
        await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'`);
        await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

        // Register the built-in GitHub PR Reviewer agent (idempotent)
        await pool.query(`
            INSERT INTO agents (name, type, status, description, config)
            SELECT 'GitHub PR Reviewer', 'code_review', 'active',
                   'Reviews open pull requests on a schedule, posts inline comments on GitHub.',
                   '{"builtin": true, "icon": "🤖"}'::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = 'GitHub PR Reviewer')
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS agent_jobs (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER REFERENCES agents(id),
                job_type VARCHAR(100) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                input JSONB NOT NULL,
                output JSONB,
                logs TEXT[],
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                repo_url VARCHAR(500),
                jira_project_key VARCHAR(50),
                figma_file_key VARCHAR(100),
                config JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sprint planner tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS workspace_members (
                id           SERIAL PRIMARY KEY,
                username     TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                email        TEXT,
                avatar_color TEXT NOT NULL DEFAULT '#2563eb',
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await pool.query(`
            INSERT INTO workspace_members (username, display_name, email, avatar_color)
            VALUES ('system', 'System (AI)', NULL, '#2563eb')
            ON CONFLICT (username) DO NOTHING
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sprint_task_assignments (
                run_id      UUID    NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
                ticket_id   TEXT    NOT NULL,
                assignee    TEXT    NOT NULL DEFAULT 'system',
                notes       TEXT,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (run_id, ticket_id)
            )
        `);

        // ── Organizations & Projects (idempotent migrations) ───────────────────
        await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS organizations (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name        TEXT NOT NULL,
                slug        TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS uuid        UUID UNIQUE DEFAULT gen_random_uuid()`);
        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL`);
        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`);
        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug        TEXT`);
        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now()`);
        await pool.query(`UPDATE projects SET uuid = gen_random_uuid() WHERE uuid IS NULL`);
        await pool.query(`ALTER TABLE agent_repo_registry     ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(uuid) ON DELETE SET NULL`);
        await pool.query(`ALTER TABLE pipeline_runs           ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(uuid) ON DELETE SET NULL`);
        await pool.query(`ALTER TABLE workspace_members       ADD COLUMN IF NOT EXISTS org_id     UUID REFERENCES organizations(id) ON DELETE SET NULL`);
        await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS org_id     UUID REFERENCES organizations(id) ON DELETE SET NULL`);

        // Seed default org + project; backfill all orphaned rows
        await pool.query(`
            INSERT INTO organizations (id, name, slug, description)
            SELECT '00000000-0000-0000-0000-000000000001'::uuid,
                   'Default Organization', 'default', 'Auto-created default organization'
            WHERE NOT EXISTS (SELECT 1 FROM organizations)
        `);
        const orgRes = await pool.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`);
        const orgId = orgRes.rows[0]?.id;
        if (orgId) {
            await pool.query(`
                INSERT INTO projects (name, slug, description, org_id)
                SELECT 'Default Project', 'default', 'Auto-created default project', $1
                WHERE NOT EXISTS (SELECT 1 FROM projects WHERE org_id = $1)
            `, [orgId]);
            const projRes = await pool.query(
                `SELECT uuid FROM projects WHERE org_id = $1 ORDER BY created_at LIMIT 1`, [orgId]
            );
            const projId = projRes.rows[0]?.uuid;
            if (projId) {
                await pool.query(`UPDATE agent_repo_registry     SET project_id = $1 WHERE project_id IS NULL`, [projId]);
                await pool.query(`UPDATE pipeline_runs           SET project_id = $1 WHERE project_id IS NULL`, [projId]);
                await pool.query(`UPDATE workspace_members       SET org_id     = $1 WHERE org_id IS NULL`, [orgId]);
                await pool.query(`UPDATE integration_connections SET org_id     = $1 WHERE org_id IS NULL`, [orgId]);
            }
        }

        // ── Change Requests (010) ──────────────────────────────────────────────
        await pool.query(`
            CREATE TABLE IF NOT EXISTS change_requests (
                id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                run_id            UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
                stage             TEXT NOT NULL,
                status            TEXT NOT NULL DEFAULT 'pending',
                proposed_artifact JSONB NOT NULL,
                stage_snapshots   JSONB NOT NULL DEFAULT '{}',
                sharepoint_url    TEXT,
                applied_run_id    UUID REFERENCES pipeline_runs(run_id) ON DELETE SET NULL,
                created_by        TEXT,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_change_requests_run_id ON change_requests (run_id, stage)`);
        await pool.query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS source_change_request_id UUID REFERENCES change_requests(id) ON DELETE SET NULL`);

        console.log('Database tables initialized');
    } catch (err) {
        console.error('Failed to initialize database:', err);
    }
})();

app.use(express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

app.use('/api', orgsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/notifications', notificationsRouter);

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const agentHealth = await sdlAgentService.healthCheck();
    res.json({
        status: 'ok',
        agents: agentHealth
    });
});

// ============================
// GitHub webhook (Day 3)
// ============================

app.post('/api/github/webhook', async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const secret = process.env.GITHUB_WEBHOOK_SECRET || '';

    if (secret && signature) {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update((req as any).rawBody ?? Buffer.alloc(0));
        const digest = `sha256=${hmac.digest('hex')}`;
        try {
            if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
                res.status(401).json({ error: 'invalid signature' });
                return;
            }
        } catch {
            res.status(401).json({ error: 'invalid signature' });
            return;
        }
    }

    const event = req.headers['x-github-event'] as string;
    const payload = req.body as Record<string, any>;

    res.json({ received: true });

    try {
        const repoFull: string = payload.repository?.full_name;
        if (!repoFull) return;

        if (event === 'issues' && payload.action === 'opened') {
            const issue = payload.issue;
            await pipelineService.createRun({
                repo: repoFull,
                raw_request: `${issue.title}\n\n${issue.body || ''}`.trim(),
                requester_id: issue.user.login,
                github_ref: {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: issue.number,
                    issue_url: issue.html_url,
                    trigger_type: 'issue',
                    title: issue.title,
                },
            });
            console.log(`[github-webhook] Started pipeline for issue #${issue.number} in ${repoFull}`);
        } else if (event === 'pull_request' && payload.action === 'opened') {
            const pr = payload.pull_request;
            await pipelineService.createRun({
                repo: repoFull,
                raw_request: `${pr.title}\n\n${pr.body || ''}`.trim(),
                requester_id: pr.user.login,
                github_ref: {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: pr.number,
                    issue_url: pr.html_url,
                    trigger_type: 'pr',
                    title: pr.title,
                },
            });
            console.log(`[github-webhook] Started pipeline for PR #${pr.number} in ${repoFull}`);
        }
    } catch (err) {
        console.error('[github-webhook] Error processing event:', err);
    }
});

// Create GitHub branch + commit files + open draft PR for implementation stage
app.post('/api/github/create-pr', async (req, res) => {
    const { repo, implementation_json } = req.body || {};
    if (!repo || !implementation_json) {
        res.status(400).json({ error: 'repo and implementation_json are required' });
        return;
    }
    const pat = process.env.GITHUB_PAT;
    if (!pat) {
        res.status(500).json({ error: 'GITHUB_PAT not configured' });
        return;
    }
    const [owner, repoName] = (repo as string).split('/');
    if (!owner || !repoName) {
        res.status(400).json({ error: 'repo must be owner/name format' });
        return;
    }
    try {
        const impl = implementation_json as {
            branch_name?: string;
            commit_message?: string;
            files_changed?: Array<{ path: string; action: string; contents?: string }>;
            pr_title?: string;
            pr_body_markdown?: string;
        };
        if (!impl.branch_name) {
            res.status(400).json({ error: 'implementation_json.branch_name is required' });
            return;
        }
        const result = await githubService.createBranchAndPR(pat, owner, repoName, {
            branchName: impl.branch_name,
            commitMessage: impl.commit_message || 'feat: agentic implementation',
            filesChanged: impl.files_changed || [],
            prTitle: impl.pr_title || impl.branch_name,
            prBody: impl.pr_body_markdown || '',
        });
        console.log(`[github] Created PR #${result.prNumber} for ${repo}: ${result.prUrl}`);
        res.json(result);
    } catch (err) {
        console.error('[github/create-pr] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'PR creation failed' });
    }
});

// Agent loop: validate the initial Dify-generated implementation, retry with
// feedback up to 3 attempts, then create the PR. Returns null pr_url for
// non-implementation stages so n8n can call this generically.
app.post('/api/agent/finalize-implementation', async (req, res) => {
    const { stage_name, repo, ticket, design_excerpt, implementation_json, run_id } = req.body || {};

    if (stage_name !== 'implementation') {
        res.json({
            pr_url: null,
            pr_number: null,
            branch_name: null,
            attempts: 0,
            attempt_history: [],
            final_errors: [],
            skipped: true,
        });
        return;
    }

    if (!repo || typeof repo !== 'string') {
        res.status(400).json({ error: 'repo is required (owner/name)' });
        return;
    }

    // ticket and design_excerpt may arrive as JSON strings from n8n; the agent
    // service handles both. run_id enables live progress streaming through the
    // existing pipeline SSE channel.
    try {
        const result = await finalizeImplementation(
            repo,
            ticket,
            design_excerpt,
            (implementation_json as any) || null,
            typeof run_id === 'string' ? run_id : null,
        );
        res.json(result);
    } catch (err) {
        console.error('[agent/finalize-implementation] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'finalize failed' });
    }
});

// Lightweight validator (debug/testing) — same rules as the agent loop uses.
app.post('/api/agent/validate-implementation', (req, res) => {
    const { implementation_json } = req.body || {};
    const result = validateImplementation(implementation_json);
    res.json(result);
});

// List curated scaffolds available to the agent (debug + frontend display).
app.get('/api/agent/templates', async (_req, res) => {
    try {
        const templates = await listTemplates();
        res.json({ templates });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'failed to list templates' });
    }
});

// Open a scaffold PR for a brand-new project using a curated template.
app.post('/api/agent/scaffold', async (req, res) => {
    const { repo, template_id } = req.body || {};
    if (!repo || typeof repo !== 'string') { res.status(400).json({ error: 'repo is required' }); return; }
    if (!template_id || typeof template_id !== 'string') { res.status(400).json({ error: 'template_id is required' }); return; }
    try {
        const result = await openScaffoldPR(repo, template_id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'scaffold failed' });
    }
});

// Multi-ticket sprint orchestration: takes the entire sprint plan and produces
// one draft PR per ticket, topologically ordered, sandbox-tested with the
// accumulated state from earlier tickets.
app.post('/api/agent/implement-sprint', async (req, res) => {
    const { stage_name, repo, sprint_json, design_excerpt, run_id, tech_stack } = req.body || {};

    if (stage_name && stage_name !== 'implementation') {
        res.json({ pr_urls: [], outcomes: [], skipped: true });
        return;
    }
    if (!repo || typeof repo !== 'string') {
        res.status(400).json({ error: 'repo is required (owner/name)' });
        return;
    }

    // sprint_json may be a parsed object or a JSON string (from n8n). Tolerate both.
    let parsed: { tickets?: unknown } = {};
    try {
        parsed = typeof sprint_json === 'string' ? JSON.parse(sprint_json) : (sprint_json ?? {});
    } catch (e) {
        res.status(400).json({ error: `sprint_json is not valid JSON: ${(e as Error).message}` });
        return;
    }
    const tickets = Array.isArray(parsed.tickets) ? parsed.tickets : [];
    if (tickets.length === 0) {
        res.status(400).json({ error: 'sprint_json.tickets must be a non-empty array' });
        return;
    }

    // Parse tech_stack — may also arrive as a JSON string from n8n
    let stack: { template_id?: string; is_new_project?: boolean } = {};
    try {
        stack = typeof tech_stack === 'string' ? JSON.parse(tech_stack) : (tech_stack ?? {});
    } catch { /* tolerate missing/bad tech_stack */ }

    try {
        // If a curated template is named AND the project is new, open the
        // scaffold PR first. Subsequent ticket PRs build on top of main.
        let scaffold: Awaited<ReturnType<typeof openScaffoldPR>> | null = null;
        if (stack.template_id && stack.is_new_project) {
            scaffold = await openScaffoldPR(repo, stack.template_id);
            console.log(`[implement-sprint] scaffold result:`, scaffold);
        }

        // Load human-assigned tickets so the sprint runner skips them.
        let humanAssignees: Set<string> = new Set();
        if (typeof run_id === 'string' && run_id) {
            try {
                const aRows = await pool.query<{ ticket_id: string }>(
                    `SELECT ticket_id FROM sprint_task_assignments WHERE run_id = $1 AND assignee <> 'system'`,
                    [run_id],
                );
                humanAssignees = new Set(aRows.rows.map(r => r.ticket_id));
            } catch { /* tolerate missing table during migration */ }
        }

        const result = await implementSprint(
            repo,
            design_excerpt,
            tickets as Parameters<typeof implementSprint>[2],
            typeof run_id === 'string' ? run_id : null,
            typeof stack.template_id === 'string' ? stack.template_id : null,
            {},
            humanAssignees,
        );
        res.json({ ...result, scaffold });
    } catch (err) {
        console.error('[agent/implement-sprint] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'implement-sprint failed' });
    }
});

// ─── Sprint Planner ──────────────────────────────────────────────────────────

// List workspace members (system + humans)
app.get('/api/workspace/members', async (_req, res) => {
    try {
        const result = await pool.query<{ id: number; username: string; display_name: string; email: string | null; avatar_color: string }>(
            `SELECT id, username, display_name, email, avatar_color FROM workspace_members ORDER BY id`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list members' });
    }
});

// Add a workspace member
app.post('/api/workspace/members', async (req, res) => {
    const { username, display_name, email, avatar_color } = req.body || {};
    if (!username || !display_name) {
        res.status(400).json({ error: 'username and display_name are required' });
        return;
    }
    try {
        const result = await pool.query<{ id: number; username: string; display_name: string; email: string | null; avatar_color: string }>(
            `INSERT INTO workspace_members (username, display_name, email, avatar_color)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, avatar_color = EXCLUDED.avatar_color
             RETURNING id, username, display_name, email, avatar_color`,
            [username, display_name, email ?? null, avatar_color ?? '#64748b'],
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add member' });
    }
});

// Get sprint tasks for a run — merges ticket list from sprint artifact with stored assignments
app.get('/api/pipelines/:run_id/sprint-tasks', async (req, res) => {
    const { run_id } = req.params;
    try {
        const stageRow = await pool.query<{ artifact_json: unknown }>(
            `SELECT artifact_json FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'sprint'`,
            [run_id],
        );
        if (stageRow.rows.length === 0) {
            res.status(404).json({ error: 'No sprint stage found for this run' });
            return;
        }
        const artifact = stageRow.rows[0].artifact_json as any;
        const tickets: any[] = Array.isArray(artifact?.tickets)
            ? artifact.tickets
            : Array.isArray(artifact?.parsed?.tickets)
                ? artifact.parsed.tickets
                : [];

        // Load assignments for this run
        const assignmentRows = await pool.query<{ ticket_id: string; assignee: string; notes: string | null; updated_at: string }>(
            `SELECT ticket_id, assignee, notes, updated_at FROM sprint_task_assignments WHERE run_id = $1`,
            [run_id],
        );
        const assignmentMap = new Map(assignmentRows.rows.map(r => [r.ticket_id, r]));

        const merged = tickets.map((t: any) => {
            const a = assignmentMap.get(t.id);
            return {
                ...t,
                assignee: a?.assignee ?? 'system',
                notes: a?.notes ?? null,
                assignment_updated_at: a?.updated_at ?? null,
            };
        });

        res.json({ tickets: merged, total: merged.length });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load sprint tasks' });
    }
});

// Update a single ticket's assignee / notes
app.put('/api/pipelines/:run_id/sprint-tasks/:ticket_id', async (req, res) => {
    const { run_id, ticket_id } = req.params;
    const { assignee, notes } = req.body || {};
    if (!assignee || typeof assignee !== 'string') {
        res.status(400).json({ error: 'assignee is required' });
        return;
    }
    try {
        await pool.query(
            `INSERT INTO sprint_task_assignments (run_id, ticket_id, assignee, notes, updated_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (run_id, ticket_id)
             DO UPDATE SET assignee = EXCLUDED.assignee, notes = EXCLUDED.notes, updated_at = now()`,
            [run_id, ticket_id, assignee, notes ?? null],
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update assignment' });
    }
});

// ============================
// SDLC Pipeline APIs (Day 5)
// ============================

// List repos available to start pipelines against (from agent_repo_registry)
app.get('/api/repos', async (req, res) => {
    try {
        const projectId = req.query.project_id as string | undefined;
        const repos = await pipelineService.listRepos(projectId);
        res.json(repos);
    } catch (err) {
        console.error('Failed to list repos:', err);
        res.status(500).json({ error: 'Failed to list repos' });
    }
});

// Start a pipeline run
app.post('/api/pipelines', async (req, res) => {
    try {
        const { repo, raw_request, requester_id, design_preferences, project_id } = req.body || {};
        const result = await pipelineService.createRun({ repo, raw_request, requester_id, design_preferences, project_id });
        res.status(201).json(result);
    } catch (err) {
        console.error('Failed to start pipeline:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start pipeline' });
    }
});

// List recent runs (for PipelineList)
app.get('/api/pipelines', async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const projectId = req.query.project_id as string | undefined;
        const runs = await pipelineService.listRuns(limit, projectId);
        res.json(runs);
    } catch (err) {
        console.error('Failed to list runs:', err);
        res.status(500).json({ error: 'Failed to list runs' });
    }
});

// Snapshot of a single run + all its stages
app.get('/api/pipelines/:run_id', async (req, res) => {
    try {
        const run = await pipelineService.getRun(req.params.run_id);
        if (!run) {
            res.status(404).json({ error: 'run not found' });
            return;
        }
        res.json(run);
    } catch (err) {
        console.error('Failed to get run:', err);
        res.status(500).json({ error: 'Failed to get run' });
    }
});

// SSE stream of per-stage status changes for one run
app.get('/api/pipelines/:run_id/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const unsubscribe = pipelineEventBus.subscribe(req.params.run_id, res);
    req.on('close', () => { unsubscribe(); });
});

// Diagnose a deployment failure and return a structured plan without executing anything.
app.get('/api/pipelines/:run_id/diagnose-deploy', async (req, res) => {
    try {
        const result = await pipelineService.diagnoseDeployError(req.params.run_id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'diagnosis failed' });
    }
});

// Apply a targeted deploy fix.
// Body: { strategy: 'redeploy' | 'patch_files' | 'targeted_reimplementation' | 'full_reimplementation',
//          file_changes?: [{path, new_content, explanation}] }
app.post('/api/pipelines/:run_id/fix-with-deploy-error', async (req, res) => {
    try {
        const strategy: string = req.body?.strategy ?? 'full_reimplementation';
        // Attach file_changes to req so pipelineService can access them for patch_files strategy
        (req as any).fileChanges = req.body?.file_changes ?? [];
        const result = await pipelineService.fixWithDeployError(req.params.run_id, strategy, req as any);
        res.status(202).json(result);
    } catch (err) {
        console.error('Failed to fix with deploy error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fix with deploy error' });
    }
});

// Push GitHub PRs for every successfully-implemented ticket on a run. Used by
// the "ask before creating PR" flow — implementation runs locally first, then
// the user clicks a button which calls this endpoint.
app.post('/api/pipelines/:run_id/create-prs', async (req, res) => {
    try {
        const result = await createPRsForRun(req.params.run_id);
        res.json(result);
    } catch (err) {
        console.error('Failed to create PRs:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create PRs' });
    }
});

// ============================
// Local deployment APIs
// ============================

// Start (or re-start) a local deployment of the run's generated app.
app.post('/api/pipelines/:run_id/deploy', async (req, res) => {
    try {
        const dep = await deployRun(req.params.run_id);
        res.status(202).json(dep);
    } catch (err) {
        console.error('Failed to start deployment:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start deployment' });
    }
});

// Stop the local deployment for a run.
app.delete('/api/pipelines/:run_id/deploy', async (req, res) => {
    try {
        const result = await stopDeployment(req.params.run_id);
        res.json(result);
    } catch (err) {
        console.error('Failed to stop deployment:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stop deployment' });
    }
});

// Stream a poll-able tail of the sandbox log (per-gate stdout/stderr from
// the agent's implementation attempts). Same ?from=N polling contract as
// the deployment log endpoint.
// Source file browser — tree + individual file content.
app.get('/api/pipelines/:run_id/source-tree', async (req, res) => {
    try {
        const tree = await getSourceTree(req.params.run_id);
        res.json(tree);
    } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : 'source tree not found' });
    }
});

app.get('/api/pipelines/:run_id/source-file', async (req, res) => {
    try {
        const filePath = req.query.path as string;
        if (!filePath) return res.status(400).json({ error: 'path query param required' });
        const result = await getSourceFile(req.params.run_id, filePath);
        res.json(result);
    } catch (err) {
        res.status(404).json({ error: err instanceof Error ? err.message : 'file not found' });
    }
});

app.get('/api/pipelines/:run_id/sandbox-logs', async (req, res) => {
    try {
        const from = req.query.from ? parseInt(req.query.from as string, 10) : 0;
        const tail = await readSandboxLog(req.params.run_id, Number.isFinite(from) ? from : 0);
        res.json(tail);
    } catch (err) {
        console.error('Failed to read sandbox log:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read log' });
    }
});

app.get('/api/pipelines/:run_id/deployment/fix-agent-log', async (req, res) => {
    try {
        const from = req.query.from ? parseInt(req.query.from as string, 10) : 0;
        const tail = await readFixAgentLog(req.params.run_id, Number.isFinite(from) ? from : 0);
        res.json(tail);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read log' });
    }
});

// Stream a poll-able tail of the deployment log. Query ?from=N to fetch only
// bytes after offset N (returns the next offset for the next poll).
app.get('/api/pipelines/:run_id/deployment/logs', async (req, res) => {
    try {
        const from = req.query.from ? parseInt(req.query.from as string, 10) : 0;
        const tail = await readDeploymentLog(req.params.run_id, Number.isFinite(from) ? from : 0);
        res.json(tail);
    } catch (err) {
        console.error('Failed to read deployment log:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read log' });
    }
});

// Fetch deployment status (null if never deployed).
app.get('/api/pipelines/:run_id/deployment', async (req, res) => {
    try {
        const dep = await getDeployment(req.params.run_id);
        if (!dep) {
            res.status(404).json({ error: 'no deployment for this run' });
            return;
        }
        res.json(dep);
    } catch (err) {
        console.error('Failed to get deployment:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get deployment' });
    }
});

// Manually (re-)trigger browser verification for a running deployment.
app.post('/api/pipelines/:run_id/deployment/verify', async (req, res) => {
    try {
        const result = await runVerification(req.params.run_id);
        if (!result.queued) {
            res.status(400).json({ error: result.reason ?? 'cannot verify' });
            return;
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'verify failed' });
    }
});

// Serve the screenshot PNG captured by Playwright for a completed verification.
app.get('/api/pipelines/:run_id/deployment/screenshot', async (req, res) => {
    const { createReadStream } = await import('fs');
    const screenshotPath = `${process.env.DEPLOYMENTS_ROOT || '/app/deployments'}/${req.params.run_id}/screenshot.png`;
    try {
        await import('fs').then(m => m.promises.access(screenshotPath));
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(screenshotPath).pipe(res);
    } catch {
        res.status(404).json({ error: 'no screenshot available' });
    }
});

// Rerun an entire pipeline run — clones the original input and fires a fresh
// n8n webhook. Returns the new run_id.
app.post('/api/pipelines/:run_id/rerun', async (req, res) => {
    try {
        const result = await pipelineService.rerunRun(req.params.run_id);
        res.status(201).json(result);
    } catch (err) {
        console.error('Failed to rerun pipeline:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to rerun pipeline' });
    }
});

// Rerun a single stage in place. Today only `implementation` is supported.
app.post('/api/pipelines/:run_id/stages/:stage/rerun', async (req, res) => {
    try {
        const { run_id, stage } = req.params;
        if (!STAGES.includes(stage as Stage)) {
            res.status(400).json({ error: `unknown stage "${stage}"` });
            return;
        }
        const result = await pipelineService.rerunStage(run_id, stage as Stage);
        res.status(202).json(result);
    } catch (err) {
        const code = (err as any)?.code;
        if (code === 'rerun_stage_unsupported') {
            res.status(501).json({ error: err instanceof Error ? err.message : 'rerun not supported' });
            return;
        }
        console.error('Failed to rerun stage:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to rerun stage' });
    }
});

// Retry a single failed implementation ticket without re-running the whole sprint.
app.post('/api/pipelines/:run_id/implementation/retry-ticket/:ticket_id', async (req, res) => {
    try {
        const { run_id, ticket_id } = req.params;
        const result = await pipelineService.retryTicket(run_id, ticket_id);
        res.status(202).json(result);
    } catch (err) {
        const code = (err as any)?.code;
        if (code === 'ticket_not_found' || code === 'run_not_found') {
            res.status(404).json({ error: err instanceof Error ? err.message : 'not found' });
            return;
        }
        if (code === 'already_retrying') {
            res.status(409).json({ error: err instanceof Error ? err.message : 'already retrying' });
            return;
        }
        console.error('Failed to retry ticket:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to retry ticket' });
    }
});

// Stage 1 clarification loop: submit user answers to the open_questions
// produced by the requirements Dify call. If the resulting `open_questions`
// is empty (or `force_proceed` is true), the stage flips to awaiting_approval.
app.post('/api/pipelines/:run_id/stages/requirements/clarify', async (req, res) => {
    try {
        const { answers, force_proceed } = (req.body || {}) as {
            answers?: Record<string, string>;
            force_proceed?: boolean;
        };
        if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
            res.status(400).json({ error: 'answers must be an object of {question: answer}' });
            return;
        }
        const result = await requirementsService.submitClarificationAnswers(
            req.params.run_id,
            answers,
            { force_proceed: force_proceed === true },
        );
        res.json(result);
    } catch (err) {
        console.error('Failed to submit clarification answers:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to clarify' });
    }
});

// Pull the latest requirements.json from SharePoint, validate it, and replace
// the cached artifact. Resets stage to awaiting_approval. No Dify call.
app.post('/api/pipelines/:run_id/stages/requirements/sync-sharepoint', async (req, res) => {
    try {
        const result = await requirementsService.syncFromSharePoint(req.params.run_id);
        res.json(result);
    } catch (err) {
        const code = (err as any)?.code;
        if (code === 'invalid_json' || code === 'invalid_schema') {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid SharePoint content' });
            return;
        }
        console.error('Failed to sync requirements from SharePoint:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to sync' });
    }
});

// Read the clarification round history for a run. Convenience endpoint; the
// same data is also present in artifact_json on the snapshot/SSE feed.
app.get('/api/pipelines/:run_id/stages/requirements/clarification-history', async (req, res) => {
    try {
        const result = await requirementsService.getClarificationHistory(req.params.run_id);
        res.json(result);
    } catch (err) {
        console.error('Failed to load clarification history:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load history' });
    }
});

// Update requirements artifact JSON directly (user edits from the Requirements Editor UI).
app.patch('/api/pipelines/:run_id/stages/requirements/artifact', async (req, res) => {
    try {
        const { run_id } = req.params;
        const { artifact_json } = req.body;
        if (!artifact_json || typeof artifact_json !== 'object' || Array.isArray(artifact_json)) {
            res.status(400).json({ error: 'artifact_json must be an object' });
            return;
        }
        const stageRow = await pool.query(
            `SELECT status FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'requirements'`,
            [run_id],
        );
        if (stageRow.rows[0]?.status === 'approved') {
            res.status(409).json({ error: 'stage_approved', message: 'Stage already approved. Create a Change Request instead.' });
            return;
        }
        const result = await pool.query(
            `UPDATE pipeline_stage_status SET artifact_json = $2::jsonb, updated_at = now()
             WHERE run_id = $1 AND stage = 'requirements'`,
            [run_id, JSON.stringify(artifact_json)],
        );
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Requirements stage not found for this run' });
            return;
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[requirements/artifact PATCH] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'update failed' });
    }
});

// Called by n8n after Stage 3 (Plan) Dify response — generates plan.docx + plan.json in SharePoint.
app.post('/api/pipelines/:run_id/stages/plan/upload-doc', async (req, res) => {
    try {
        const { run_id } = req.params;
        const artifact = req.body as PlanArtifact;
        if (!artifact?.title || !artifact?.summary) {
            res.status(400).json({ error: 'artifact must include title and summary' });
            return;
        }

        const { getDefaultSharePointConfig, sharepointService: sp } = await import('./services/sharepointService');
        const cfg = getDefaultSharePointConfig();
        const folderPath = `${cfg.folder}/${run_id}`;

        await pool.query(
            `UPDATE pipeline_stage_status SET current_activity = 'Uploading plan documents to SharePoint…', updated_at = now() WHERE run_id = $1 AND stage = 'plan'`,
            [run_id],
        );

        await sp.uploadDocument(cfg, cfg.driveId, folderPath, 'plan.json', JSON.stringify(artifact, null, 2));
        const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const [docBuffer, overviewBuffer] = await Promise.all([
            generatePlanDoc(artifact, run_id),
            generatePlanOverviewDoc(artifact, run_id),
        ]);
        const [result] = await Promise.all([
            sp.uploadBinaryDocument(cfg, cfg.driveId, folderPath, 'plan.docx', docBuffer, docxType),
            sp.uploadBinaryDocument(cfg, cfg.driveId, folderPath, 'plan-overview.docx', overviewBuffer, docxType),
        ]);

        await pool.query(
            `UPDATE pipeline_stage_status SET artifact_url = $2, artifact_json = $3::jsonb, current_activity = NULL, updated_at = now() WHERE run_id = $1 AND stage = 'plan'`,
            [run_id, result.webUrl, JSON.stringify(artifact)],
        );
        res.json({ artifact_url: result.webUrl });
    } catch (err) {
        console.error('[plan/upload-doc] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'upload failed' });
    }
});

// Update plan artifact JSON directly (user edits from the Planner UI).
// DB trigger fires pg_notify automatically → SSE fans out to connected clients.
app.patch('/api/pipelines/:run_id/stages/plan/artifact', async (req, res) => {
    try {
        const { run_id } = req.params;
        const { artifact_json } = req.body;
        if (!artifact_json || typeof artifact_json !== 'object' || Array.isArray(artifact_json)) {
            res.status(400).json({ error: 'artifact_json must be an object' });
            return;
        }
        const stageRow = await pool.query(
            `SELECT status FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'plan'`,
            [run_id],
        );
        if (stageRow.rows[0]?.status === 'approved') {
            res.status(409).json({ error: 'stage_approved', message: 'Stage already approved. Create a Change Request instead.' });
            return;
        }
        const result = await pool.query(
            `UPDATE pipeline_stage_status SET artifact_json = $2::jsonb, updated_at = now()
             WHERE run_id = $1 AND stage = 'plan'`,
            [run_id, JSON.stringify(artifact_json)],
        );
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Plan stage not found for this run' });
            return;
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[plan/artifact PATCH] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'update failed' });
    }
});

// Update design artifact JSON directly (user edits from the Design Studio UI).
app.patch('/api/pipelines/:run_id/stages/design/artifact', async (req, res) => {
    try {
        const { run_id } = req.params;
        const { artifact_json } = req.body;
        if (!artifact_json || typeof artifact_json !== 'object' || Array.isArray(artifact_json)) {
            res.status(400).json({ error: 'artifact_json must be an object' });
            return;
        }
        const stageRow = await pool.query(
            `SELECT status FROM pipeline_stage_status WHERE run_id = $1 AND stage = 'design'`,
            [run_id],
        );
        if (stageRow.rows[0]?.status === 'approved') {
            res.status(409).json({ error: 'stage_approved', message: 'Stage already approved. Create a Change Request instead.' });
            return;
        }
        const result = await pool.query(
            `UPDATE pipeline_stage_status SET artifact_json = $2::jsonb, updated_at = now()
             WHERE run_id = $1 AND stage = 'design'`,
            [run_id, JSON.stringify(artifact_json)],
        );
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Design stage not found for this run' });
            return;
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[design/artifact PATCH] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'update failed' });
    }
});

// Update design preferences (UI template, references, ideas) from the Design Studio UI.
app.patch('/api/pipelines/:run_id/design-preferences', async (req, res) => {
    try {
        const { run_id } = req.params;
        const { design_preferences } = req.body;
        if (!design_preferences || typeof design_preferences !== 'object') {
            res.status(400).json({ error: 'design_preferences must be an object' });
            return;
        }
        const result = await pool.query(
            `UPDATE pipeline_runs SET design_preferences = $2::jsonb, updated_at = now() WHERE run_id = $1`,
            [run_id, JSON.stringify(design_preferences)],
        );
        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Pipeline run not found' });
            return;
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[design-preferences PATCH] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'update failed' });
    }
});

// Called by n8n after Stage 4 (Design) Dify response — generates design.docx + design.json in SharePoint.
app.post('/api/pipelines/:run_id/stages/design/upload-doc', async (req, res) => {
    try {
        const { run_id } = req.params;
        const artifact = req.body as DesignArtifact;
        if (!artifact?.title || !artifact?.overview) {
            res.status(400).json({ error: 'artifact must include title and overview' });
            return;
        }

        const { getDefaultSharePointConfig, sharepointService: sp } = await import('./services/sharepointService');
        const cfg = getDefaultSharePointConfig();
        const folderPath = `${cfg.folder}/${run_id}`;

        await pool.query(
            `UPDATE pipeline_stage_status SET current_activity = 'Uploading design documents to SharePoint…', updated_at = now() WHERE run_id = $1 AND stage = 'design'`,
            [run_id],
        );

        await sp.uploadDocument(cfg, cfg.driveId, folderPath, 'design.json', JSON.stringify(artifact, null, 2));
        const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const [docBuffer, overviewBuffer] = await Promise.all([
            generateDesignDoc(artifact, run_id),
            generateDesignOverviewDoc(artifact, run_id),
        ]);
        const [result] = await Promise.all([
            sp.uploadBinaryDocument(cfg, cfg.driveId, folderPath, 'design.docx', docBuffer, docxType),
            sp.uploadBinaryDocument(cfg, cfg.driveId, folderPath, 'design-overview.docx', overviewBuffer, docxType),
        ]);

        await pool.query(
            `UPDATE pipeline_stage_status SET artifact_url = $2, artifact_json = $3::jsonb, current_activity = NULL, updated_at = now() WHERE run_id = $1 AND stage = 'design'`,
            [run_id, result.webUrl, JSON.stringify(artifact)],
        );
        res.json({ artifact_url: result.webUrl });
    } catch (err) {
        console.error('[design/upload-doc] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'upload failed' });
    }
});

// Approve / reject a stage (forwards to n8n's resume webhook)
app.post('/api/pipelines/:run_id/stages/:stage/decision', async (req, res) => {
    try {
        const { run_id, stage } = req.params;
        if (!STAGES.includes(stage as Stage)) {
            res.status(400).json({ error: `unknown stage "${stage}"` });
            return;
        }
        const { decision, reason } = req.body || {};
        if (decision !== 'approved' && decision !== 'rejected') {
            res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
            return;
        }
        await pipelineService.decideStage(run_id, stage as Stage, decision, reason);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to decide stage:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to decide stage' });
    }
});

// ── Change Request endpoints ───────────────────────────────────────────────

// Create a change request for an already-approved stage.
app.post('/api/pipelines/:run_id/change-requests', async (req, res) => {
    try {
        const { run_id } = req.params;
        const { stage, artifact_json, created_by } = req.body || {};
        if (!stage || !artifact_json) {
            res.status(400).json({ error: 'stage and artifact_json are required' });
            return;
        }
        const cr = await changeRequestService.createChangeRequest(run_id, stage as Stage, artifact_json, created_by);
        res.status(201).json(cr);
    } catch (err: any) {
        if (err?.code === 'stage_not_approved') { res.status(409).json({ error: 'stage_not_approved', message: err.message }); return; }
        if (err?.code === 'invalid_stage')      { res.status(400).json({ error: 'invalid_stage', message: err.message }); return; }
        if (err?.code === 'stage_not_found')    { res.status(404).json({ error: err.message }); return; }
        console.error('[change-requests POST] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'failed' });
    }
});

// List change requests for a run.
app.get('/api/pipelines/:run_id/change-requests', async (req, res) => {
    try {
        const crs = await changeRequestService.listChangeRequests(req.params.run_id);
        res.json(crs);
    } catch (err) {
        console.error('[change-requests GET] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'failed' });
    }
});

// Get a single change request (includes full proposed_artifact + stage_snapshots).
app.get('/api/change-requests/:cr_id', async (req, res) => {
    try {
        const cr = await changeRequestService.getChangeRequest(req.params.cr_id);
        res.json(cr);
    } catch (err: any) {
        if (err?.code === 'not_found') { res.status(404).json({ error: 'Change request not found' }); return; }
        console.error('[change-request GET] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'failed' });
    }
});

// Apply a change request — creates a new pipeline run with pre-seeded stages.
app.post('/api/change-requests/:cr_id/apply', async (req, res) => {
    try {
        const result = await changeRequestService.applyChangeRequest(req.params.cr_id);
        res.status(201).json(result);
    } catch (err: any) {
        if (err?.code === 'not_found')        { res.status(404).json({ error: 'Change request not found' }); return; }
        if (err?.code === 'already_resolved') { res.status(409).json({ error: err.message }); return; }
        console.error('[change-request apply] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'failed' });
    }
});

// Dismiss a change request.
app.patch('/api/change-requests/:cr_id', async (req, res) => {
    try {
        const { status } = req.body || {};
        if (status !== 'dismissed') {
            res.status(400).json({ error: 'only status=dismissed is supported' });
            return;
        }
        await changeRequestService.dismissChangeRequest(req.params.cr_id);
        res.json({ ok: true });
    } catch (err: any) {
        if (err?.code === 'not_found') { res.status(404).json({ error: 'Change request not found or already resolved' }); return; }
        console.error('[change-request PATCH] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'failed' });
    }
});

// Agent management endpoints
app.get('/api/agents', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM agents');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/agents', async (req, res) => {
    try {
        const { name, type, description, config } = req.body;
        const result = await pool.query(
            'INSERT INTO agents (name, type, status, description, config) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name, type, 'active', description, JSON.stringify(config || {})]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create agent' });
    }
});

// Requirements Agent endpoints
app.post('/api/requirements/optimize', async (req, res) => {
    try {
        const { rawRequirements, projectContext, existingFeatures } = req.body;
        const result = await sdlAgentService.optimizeRequirements({
            rawRequirements,
            projectContext,
            existingFeatures
        });
        res.json(result);
    } catch (err) {
        console.error('Requirements optimization failed:', err);
        res.status(500).json({ error: 'Failed to optimize requirements' });
    }
});

// Sprint Agent endpoints
app.post('/api/sprints/plan', async (req, res) => {
    try {
        const { epicDescription, teamCapacity, sprintDuration, teamVelocity, existingTasks } = req.body;
        const result = await sdlAgentService.planSprint({
            epicDescription,
            teamCapacity,
            sprintDuration,
            teamVelocity,
            existingTasks
        });
        res.json(result);
    } catch (err) {
        console.error('Sprint planning failed:', err);
        res.status(500).json({ error: 'Failed to plan sprint' });
    }
});

// Test Automation Agent endpoints
app.post('/api/tests/generate', async (req, res) => {
    try {
        const { codeSnippet, apiSpec, userStory, testFramework, coverageTarget } = req.body;
        const result = await sdlAgentService.generateTests({
            codeSnippet,
            apiSpec,
            userStory,
            testFramework,
            coverageTarget
        });
        res.json(result);
    } catch (err) {
        console.error('Test generation failed:', err);
        res.status(500).json({ error: 'Failed to generate tests' });
    }
});

// Mock Generation Agent endpoints
app.post('/api/mocks/generate', async (req, res) => {
    try {
        const { description, designSystem, existingComponents, platform, framework } = req.body;
        const result = await sdlAgentService.generateMocks({
            description,
            designSystem,
            existingComponents,
            platform,
            framework
        });
        res.json(result);
    } catch (err) {
        console.error('Mock generation failed:', err);
        res.status(500).json({ error: 'Failed to generate mocks' });
    }
});

// Code Review Agent endpoints
app.post('/api/review/analyze', async (req, res) => {
    try {
        const { code, language, filePath, standards } = req.body;
        const result = await sdlAgentService.reviewCode({
            code,
            language,
            filePath,
            standards
        });
        res.json(result);
    } catch (err) {
        console.error('Code review failed:', err);
        res.status(500).json({ error: 'Failed to review code' });
    }
});

// Documentation Agent endpoints
app.post('/api/docs/generate', async (req, res) => {
    try {
        const { code, apiSpec, type, audience } = req.body;
        const result = await sdlAgentService.generateDocumentation({
            code,
            apiSpec,
            type,
            audience
        });
        res.json(result);
    } catch (err) {
        console.error('Documentation generation failed:', err);
        res.status(500).json({ error: 'Failed to generate documentation' });
    }
});

// ============================
// Integration Management APIs
// ============================

// List all integrations
app.get('/api/integrations', async (req, res) => {
    try {
        const connections = await integrationService.getConnections();
        res.json(connections);
    } catch (err) {
        console.error('Failed to list integrations:', err);
        res.status(500).json({ error: 'Failed to list integrations' });
    }
});

// Create integration
app.post('/api/integrations', async (req, res) => {
    try {
        const connection = await integrationService.createConnection(req.body);
        res.status(201).json(connection);
    } catch (err) {
        console.error('Failed to create integration:', err);
        res.status(500).json({ error: 'Failed to create integration' });
    }
});

// Test integration
app.post('/api/integrations/:id/test', async (req, res) => {
    try {
        const result = await integrationService.testConnection(req.params.id);
        res.json(result);
    } catch (err) {
        console.error('Integration test failed:', err);
        res.status(500).json({ error: 'Integration test failed' });
    }
});

// Delete integration
app.delete('/api/integrations/:id', async (req, res) => {
    try {
        const success = await integrationService.deleteConnection(req.params.id);
        if (success) {
            res.status(204).send();
        } else {
            res.status(404).json({ error: 'Integration not found' });
        }
    } catch (err) {
        console.error('Failed to delete integration:', err);
        res.status(500).json({ error: 'Failed to delete integration' });
    }
});

// GitHub: List repositories
app.get('/api/integrations/github/:id/repos', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const repos = await githubService.listRepositories(connection.config as { token: string });
        res.json(repos);
    } catch (err) {
        console.error('Failed to list repositories:', err);
        res.status(500).json({ error: 'Failed to list repositories' });
    }
});

// GitHub: List pull requests
app.get('/api/integrations/github/:id/repos/:owner/:repo/pulls', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const { owner, repo } = req.params;
        const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
        const prs = await githubService.listPullRequests(connection.config as { token: string }, owner, repo, state);
        res.json(prs);
    } catch (err) {
        console.error('Failed to list pull requests:', err);
        res.status(500).json({ error: 'Failed to list pull requests' });
    }
});

// GitHub: Review pull request with AI
app.post('/api/integrations/github/:id/repos/:owner/:repo/pulls/:number/review', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const { owner, repo, number } = req.params;
        const pullNumber = parseInt(number);

        // Fetch PR files
        const files = await githubService.getPullRequestFiles(
            connection.config as { token: string },
            owner,
            repo,
            pullNumber
        );

        // Get file contents and build code for review
        let codeToReview = '';
        for (const file of files.slice(0, 5)) {
            if (file.patch) {
                codeToReview += `\n// File: ${file.filename}\n${file.patch}\n`;
            }
        }

        // Run AI code review
        const reviewResult = await sdlAgentService.reviewCode({
            code: codeToReview,
            language: 'typescript',
        });

        // Post review comments
        const comments = reviewResult.issues.map(issue => ({
            path: files[0]?.filename || 'src/index.ts',
            line: issue.line || 1,
            body: `**[${issue.severity.toUpperCase()}]** ${issue.message}\n\nSuggestion: ${issue.suggestion}`,
        }));

        if (comments.length > 0) {
            await githubService.createPullRequestReview(
                connection.config as { token: string },
                owner,
                repo,
                pullNumber,
                comments,
                'COMMENT'
            );
        }

        // Create summary comment
        const summaryBody = `## AI Code Review Summary\n\n**Score:** ${reviewResult.score}/100\n\n${reviewResult.summary}\n\n*Generated by SDL Agentic AI Platform*`;
        await githubService.createIssueComment(
            connection.config as { token: string },
            owner,
            repo,
            pullNumber,
            summaryBody
        );

        res.json({
            success: true,
            review: reviewResult,
            commentsPosted: comments.length,
        });
    } catch (err) {
        console.error('Failed to review pull request:', err);
        res.status(500).json({ error: 'Failed to review pull request' });
    }
});

// GitHub: Sync pull requests from GitHub to local tracking
app.post('/api/integrations/github/:id/repos/:owner/:repo/sync-prs', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const { owner, repo } = req.params;
        const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';

        const prs = await githubService.listPullRequests(
            connection.config as { token: string },
            owner,
            repo,
            state
        );

        await integrationService.syncPullRequests(
            req.params.id,
            owner,
            repo,
            prs.map(pr => ({
                number: pr.number,
                title: pr.title,
                author: pr.user.login,
                branch: pr.head.ref,
                baseBranch: pr.base.ref,
                state: pr.state,
                htmlUrl: pr.html_url,
                sha: pr.head.sha,
            }))
        );

        res.json({
            success: true,
            synced: prs.length,
            pullRequests: prs,
        });
    } catch (err) {
        console.error('Failed to sync pull requests:', err);
        res.status(500).json({ error: 'Failed to sync pull requests' });
    }
});

// GitHub: Get locally tracked pull requests
app.get('/api/integrations/github/:id/tracked-prs', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const { owner, repo } = req.query;
        const trackedPRs = await integrationService.getTrackedPullRequests(
            req.params.id,
            owner as string | undefined,
            repo as string | undefined
        );
        res.json(trackedPRs);
    } catch (err) {
        console.error('Failed to get tracked pull requests:', err);
        res.status(500).json({ error: 'Failed to get tracked pull requests' });
    }
});

// GitHub: Run AI review on a tracked PR and save locally
// Given a patch (unified diff) and a 0-based index into its lines, return
// the actual file line number (on the "new" side) that line corresponds to.
// Returns null for context-only diff metadata (file header, hunk header).
function patchIndexToFileLine(patchLines: string[], localIdx: number): number | null {
    let currentNewLine = 0;
    for (let i = 0; i <= localIdx && i < patchLines.length; i++) {
        const line = patchLines[i];
        const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
        if (hunk) {
            currentNewLine = parseInt(hunk[1], 10) - 1; // -1 because we advance below for the next non-meta line
            if (i === localIdx) return null;
            continue;
        }
        if (line.startsWith('-')) continue; // line removed, doesn't exist on new side
        // additions (+) and context ( ) both occupy a new-side line
        currentNewLine++;
        if (i === localIdx) return currentNewLine;
    }
    return currentNewLine > 0 ? currentNewLine : null;
}

// Reusable: run AI review for a tracked PR, persist diff + comments with code snippets.
async function runReviewForTrackedPR(connectionId: string, prId: string): Promise<{ review: any; commentsSaved: number }> {
    const connection = await integrationService.getConnection(connectionId);
    if (!connection || connection.type !== 'github') throw new Error('GitHub integration not found');

    const trackedPR = await integrationService.getTrackedPRById(prId);
    if (!trackedPR) throw new Error('Tracked PR not found');

    const owner = trackedPR.repo_owner as string;
    const repo = trackedPR.repo_name as string;
    const pullNumber = trackedPR.pr_number as number;

    const files = await githubService.getPullRequestFiles(
        connection.config as { token: string },
        owner,
        repo,
        pullNumber
    );

    // Build diff with line-offset tracking and keep per-file patch text.
    let codeToReview = '';
    let lineOffset = 0;
    const fileLineRanges: Array<{ filename: string; startLine: number; endLine: number; patchLines: string[] }> = [];
    for (const file of files.slice(0, 5)) {
        if (file.patch) {
            const patchLines = file.patch.split('\n');
            const startLine = lineOffset + 2;
            lineOffset += patchLines.length + 2;
            fileLineRanges.push({ filename: file.filename, startLine, endLine: lineOffset, patchLines });
            codeToReview += `\n// File: ${file.filename}\n${file.patch}\n`;
        }
    }

    // Pull recent human feedback so the AI learns team preferences over time
    const teamPreferences = await integrationService.getFeedbackContext();

    const reviewResult = await sdlAgentService.reviewCode({
        code: codeToReview,
        language: 'typescript',
        filePath: files.map(f => f.filename).join(', '),
        teamPreferences,
    });

    await integrationService.updatePRReview(prId, reviewResult as unknown as Record<string, unknown>, 'completed');
    await integrationService.savePRDiff(prId, codeToReview);
    await integrationService.deleteUnpostedComments(prId);

    for (const issue of reviewResult.issues) {
        let filePath = files[0]?.filename || 'unknown';
        let fileLine: number | null = null;
        let startFileLine: number | null = null;
        let codeSnippet: string | undefined;
        if (issue.line != null && fileLineRanges.length > 0) {
            const match = fileLineRanges.find(r => issue.line! >= r.startLine && issue.line! <= r.endLine);
            if (match) {
                filePath = match.filename;
                const localIdx = issue.line! - match.startLine;
                fileLine = patchIndexToFileLine(match.patchLines, localIdx);
                if (issue.start_line != null) {
                    const localStartIdx = issue.start_line - match.startLine;
                    startFileLine = patchIndexToFileLine(match.patchLines, localStartIdx);
                }
                const from = Math.max(0, localIdx - 3);
                const to = Math.min(match.patchLines.length, localIdx + 4);
                codeSnippet = match.patchLines.slice(from, to).join('\n');
            }
        }
        await integrationService.saveReviewComment(prId, {
            filePath,
            lineNumber: fileLine ?? undefined,
            body: `${issue.message}\n\nSuggestion: ${issue.suggestion}`,
            severity: issue.severity,
            codeSnippet,
            replacementCode: issue.replacement_code || undefined,
            startLine: startFileLine ?? undefined,
        });
    }

    return { review: reviewResult, commentsSaved: reviewResult.issues.length };
}

app.post('/api/integrations/github/:id/tracked-prs/:prId/review', async (req, res) => {
    try {
        const { id, prId } = req.params;
        const { review, commentsSaved } = await runReviewForTrackedPR(id, prId);
        res.json({ success: true, review, commentsSaved });
    } catch (err) {
        console.error('Failed to review tracked PR:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to review tracked PR' });
    }
});

// Feedback on an individual AI review comment — feeds the learning loop.
app.post('/api/integrations/github/comments/:commentId/feedback', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { feedback, notes } = req.body || {};
        if (feedback !== null && feedback !== 'accepted' && feedback !== 'rejected') {
            res.status(400).json({ error: 'feedback must be "accepted", "rejected", or null' });
            return;
        }
        await integrationService.setCommentFeedback(commentId, feedback, notes);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save feedback:', err);
        res.status(500).json({ error: 'Failed to save feedback' });
    }
});

// GitHub: Toggle save-for-later on a tracked PR
app.post('/api/integrations/github/:id/tracked-prs/:prId/save', async (req, res) => {
    try {
        const { prId } = req.params;
        const { saved } = req.body || {};
        await integrationService.setSavedForLater(prId, !!saved);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save PR:', err);
        res.status(500).json({ error: 'Failed to save PR' });
    }
});

// GitHub: Get all open tracked PRs across all connections/repos
app.get('/api/integrations/github/all-open-prs', async (req, res) => {
    try {
        const savedOnly = req.query.savedOnly === 'true';
        const prs = await integrationService.getAllOpenPRs(savedOnly);
        res.json(prs);
    } catch (err) {
        console.error('Failed to list all open PRs:', err);
        res.status(500).json({ error: 'Failed to list all open PRs' });
    }
});

// GitHub: Sync all repos across all GitHub connections (pulls latest open PRs)
app.post('/api/integrations/github/sync-all', async (_req, res) => {
    try {
        const connections = await integrationService.getConnections();
        const githubConns = connections.filter(c => c.type === 'github');
        let repoCount = 0;
        let prCount = 0;
        const errors: string[] = [];

        for (const conn of githubConns) {
            const token = (conn.config as { token?: string }).token;
            if (!token) continue;
            // Fetch all accessible repos from GitHub API
            let liveRepos: Array<{ full_name: string }> = [];
            try {
                liveRepos = await githubService.listRepositories({ token });
            } catch (e) {
                errors.push(`${conn.name}: failed to list repos — ${e instanceof Error ? e.message : 'unknown'}`);
                continue;
            }

            for (const repoObj of liveRepos) {
                const fullName = repoObj.full_name;
                const [owner, repo] = fullName.split('/');
                try {
                    const livePRs = await githubService.listPullRequests({ token }, owner, repo, 'open');
                    await integrationService.syncPullRequests(conn.id, owner, repo, livePRs.map((p: any) => ({
                        number: p.number,
                        title: p.title,
                        author: p.user.login,
                        branch: p.head.ref,
                        baseBranch: p.base.ref,
                        state: p.state,
                        htmlUrl: p.html_url,
                        sha: p.head.sha,
                    })));
                    prCount += livePRs.length;
                    repoCount++;
                } catch (e) {
                    errors.push(`${fullName}: ${e instanceof Error ? e.message : 'failed'}`);
                }
            }
        }
        res.json({ success: true, repoCount, prCount, errors });
    } catch (err) {
        console.error('Failed to sync all:', err);
        res.status(500).json({ error: 'Failed to sync all repositories' });
    }
});

// Scheduled reviews CRUD
app.get('/api/integrations/scheduled-reviews', async (req, res) => {
    try {
        const connectionId = req.query.connectionId as string | undefined;
        const schedules = await integrationService.listSchedules(connectionId);
        res.json(schedules);
    } catch (err) {
        console.error('Failed to list schedules:', err);
        res.status(500).json({ error: 'Failed to list schedules' });
    }
});

app.post('/api/integrations/scheduled-reviews', async (req, res) => {
    try {
        const { connectionId, repoOwner, repoName, intervalMinutes, enabled, scope, repos } = req.body;
        if (!connectionId || !intervalMinutes) {
            res.status(400).json({ error: 'connectionId and intervalMinutes are required' });
            return;
        }
        const schedule = await integrationService.upsertSchedule({
            connectionId,
            repoOwner: repoOwner || null,
            repoName: repoName || null,
            intervalMinutes,
            enabled: enabled !== false,
            scope: scope || (repoOwner && repoName ? 'repo' : 'connection'),
            repos: Array.isArray(repos) ? repos : [],
        });
        res.status(201).json(schedule);
    } catch (err) {
        console.error('Failed to upsert schedule:', err);
        res.status(500).json({ error: 'Failed to upsert schedule' });
    }
});

app.delete('/api/integrations/scheduled-reviews/:id', async (req, res) => {
    try {
        const ok = await integrationService.deleteSchedule(req.params.id);
        res.json({ success: ok });
    } catch (err) {
        console.error('Failed to delete schedule:', err);
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

// Scheduler activity log
app.get('/api/integrations/scheduler-runs', async (req, res) => {
    try {
        const scheduleId = req.query.scheduleId as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
        const runs = await integrationService.getSchedulerRuns(scheduleId, limit);
        res.json(runs);
    } catch (err) {
        console.error('Failed to list scheduler runs:', err);
        res.status(500).json({ error: 'Failed to list scheduler runs' });
    }
});

// GitHub: Add a local review comment to a tracked PR
app.post('/api/integrations/github/:id/tracked-prs/:prId/comments', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const { prId } = req.params;
        const { filePath, lineNumber, body, severity } = req.body;

        await integrationService.saveReviewComment(prId, {
            filePath,
            lineNumber,
            body,
            severity: severity || 'info',
        });

        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Failed to save review comment:', err);
        res.status(500).json({ error: 'Failed to save review comment' });
    }
});

// GitHub: Get local review comments for a tracked PR
app.get('/api/integrations/github/:id/tracked-prs/:prId/comments', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'github') {
            res.status(404).json({ error: 'GitHub integration not found' });
            return;
        }
        const { prId } = req.params;
        const comments = await integrationService.getReviewComments(prId);
        res.json(comments);
    } catch (err) {
        console.error('Failed to get review comments:', err);
        res.status(500).json({ error: 'Failed to get review comments' });
    }
});

// Build a nicely formatted comment body for GitHub: badge + issue + optional ```suggestion patch + code link
function formatGitHubCommentBody(comment: {
    file_path: string | null;
    line_number: number | null;
    body: string;
    severity: string;
    replacement_code?: string | null;
}, owner: string, repoName: string, sha: string, isInline: boolean): string {
    const SEVERITY_EMOJI: Record<string, string> = { critical: '🔴', warning: '🟡', info: '🔵' };
    const emoji = SEVERITY_EMOJI[comment.severity] || '🔵';
    const sevLabel = comment.severity.toUpperCase();

    let issueText = comment.body;
    let suggestion = '';
    const idx = comment.body.search(/\n\nSuggestion:\s*/);
    if (idx !== -1) {
        issueText = comment.body.slice(0, idx).trim();
        suggestion = comment.body.slice(idx).replace(/^\n\nSuggestion:\s*/i, '').trim();
    }

    const parts: string[] = [];
    parts.push(`> ${emoji} **AI Review · ${sevLabel}**`);
    parts.push('');
    parts.push(issueText);

    // If we have replacement_code, emit a ```suggestion block — GitHub renders an
    // "Apply suggestion" button on inline review comments.
    if (comment.replacement_code && isInline) {
        parts.push('');
        if (suggestion) parts.push(suggestion);
        parts.push('');
        parts.push('```suggestion');
        parts.push(comment.replacement_code.replace(/\r\n/g, '\n'));
        parts.push('```');
    } else if (suggestion) {
        parts.push('');
        parts.push('### 💡 Suggested change');
        parts.push('> ' + suggestion.split('\n').join('\n> '));
        if (comment.replacement_code) {
            // Suggestion blocks only work on inline review comments; on conversation
            // comments we fall back to a plain fenced code block.
            parts.push('');
            parts.push('```');
            parts.push(comment.replacement_code);
            parts.push('```');
        }
    }

    if (!isInline && comment.file_path) {
        const link = comment.line_number
            ? `https://github.com/${owner}/${repoName}/blob/${sha}/${comment.file_path}#L${comment.line_number}`
            : `https://github.com/${owner}/${repoName}/blob/${sha}/${comment.file_path}`;
        parts.push('');
        parts.push(`📍 **Location:** [\`${comment.file_path}${comment.line_number ? ':' + comment.line_number : ''}\`](${link})`);
    }

    parts.push('');
    parts.push('<sub>Generated by AI Review · please verify before applying</sub>');
    return parts.join('\n');
}

// GitHub: Publish local review comments to GitHub
async function publishReviewComments(connectionId: string, prId: string, opts?: { summaryComment?: boolean }): Promise<{ published: number; inlinePosted: number; fallbackPosted: number }> {
    const connection = await integrationService.getConnection(connectionId);
    if (!connection || connection.type !== 'github') throw new Error('GitHub integration not found');

    const trackedPR = await integrationService.getTrackedPRById(prId);
    if (!trackedPR) throw new Error('Tracked PR not found');

    const owner = trackedPR.repo_owner as string;
    const repo = trackedPR.repo_name as string;
    const pullNumber = trackedPR.pr_number as number;
    const sha = trackedPR.github_sha as string;

    const comments = await integrationService.getReviewComments(prId);
    const unpublishedComments = comments.filter((c: any) => !c.is_posted);

    let inlinePosted = 0;
    let fallbackPosted = 0;

    for (const comment of unpublishedComments) {
        const filePath = comment.file_path as string | null;
        const line = comment.line_number as number | null;
        const startLine = comment.start_line as number | null;

        let posted = false;
        if (filePath && line && sha) {
            const inlineBody = formatGitHubCommentBody(comment as any, owner, repo, sha, true);
            try {
                const result = await githubService.createReviewComment(
                    connection.config as { token: string },
                    owner, repo, pullNumber,
                    { commitId: sha, path: filePath, line, startLine: startLine || undefined, body: inlineBody, side: 'RIGHT' }
                );
                if (result) {
                    await pool.query(
                        `UPDATE pr_review_comments SET is_posted = true, github_comment_id = $1 WHERE id = $2`,
                        [String(result.id), comment.id]
                    );
                    inlinePosted++;
                    posted = true;
                }
            } catch (e) {
                console.warn(`[Publish] Inline failed for ${filePath}:${line}, falling back:`, e instanceof Error ? e.message : e);
            }
        }

        if (!posted) {
            const body = formatGitHubCommentBody(comment as any, owner, repo, sha || '', false);
            await githubService.createIssueComment(
                connection.config as { token: string },
                owner, repo, pullNumber, body
            );
            await pool.query(
                `UPDATE pr_review_comments SET is_posted = true WHERE id = $1`,
                [comment.id]
            );
            fallbackPosted++;
        }
    }

    if (opts?.summaryComment && (inlinePosted + fallbackPosted) > 0) {
        const summary = `🤖 **AI Code Review Complete**\n\n` +
            `This PR was automatically reviewed by the PR Reviewer Agent.\n` +
            `• ${inlinePosted + fallbackPosted} comment(s) posted\n` +
            `• ${inlinePosted} inline review comment(s)\n` +
            `• ${fallbackPosted} general comment(s)\n\n` +
            `You can view the full review details in the [Agentic Platform](${process.env.FRONTEND_URL || ''}).`;
        await githubService.createIssueComment(
            connection.config as { token: string },
            owner, repo, pullNumber, summary
        );
    }

    return { published: inlinePosted + fallbackPosted, inlinePosted, fallbackPosted };
}

app.post('/api/integrations/github/:id/tracked-prs/:prId/publish', async (req, res) => {
    try {
        const result = await publishReviewComments(req.params.id, req.params.prId);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Failed to publish review comments:', err);
        res.status(500).json({ error: 'Failed to publish review comments' });
    }
});


// SharePoint: List sites
app.get('/api/integrations/sharepoint/:id/sites', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'sharepoint') {
            res.status(404).json({ error: 'SharePoint integration not found' });
            return;
        }
        const sites = await sharepointService.listSites(connection.config as { tenantId: string; clientId: string; clientSecret: string });
        res.json(sites);
    } catch (err) {
        console.error('Failed to list SharePoint sites:', err);
        res.status(500).json({ error: 'Failed to list SharePoint sites' });
    }
});

// SharePoint: List documents
app.get('/api/integrations/sharepoint/:id/drives/:driveId/documents', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'sharepoint') {
            res.status(404).json({ error: 'SharePoint integration not found' });
            return;
        }
        const { driveId } = req.params;
        const folderPath = req.query.folder as string | undefined;
        const docs = await sharepointService.listDocuments(
            connection.config as { tenantId: string; clientId: string; clientSecret: string },
            driveId,
            folderPath
        );
        res.json(docs);
    } catch (err) {
        console.error('Failed to list documents:', err);
        res.status(500).json({ error: 'Failed to list documents' });
    }
});

// SharePoint: Extract requirements from document
app.post('/api/integrations/sharepoint/:id/drives/:driveId/items/:itemId/extract-requirements', async (req, res) => {
    try {
        const connection = await integrationService.getConnection(req.params.id);
        if (!connection || connection.type !== 'sharepoint') {
            res.status(404).json({ error: 'SharePoint integration not found' });
            return;
        }
        const { driveId, itemId } = req.params;

        // Download document content
        const content = await sharepointService.downloadDocument(
            connection.config as { tenantId: string; clientId: string; clientSecret: string },
            driveId,
            itemId
        );

        // Run requirements optimization
        const result = await sdlAgentService.optimizeRequirements({
            rawRequirements: content,
            projectContext: req.body.projectContext,
        });

        res.json(result);
    } catch (err) {
        console.error('Failed to extract requirements:', err);
        res.status(500).json({ error: 'Failed to extract requirements' });
    }
});

// Integration jobs
app.get('/api/integrations/jobs', async (req, res) => {
    try {
        const jobs = await integrationService.getJobs();
        res.json(jobs);
    } catch (err) {
        console.error('Failed to list jobs:', err);
        res.status(500).json({ error: 'Failed to list jobs' });
    }
});

// ===== Scheduled-review worker =====
// Runs every 60 seconds, finds due schedules, syncs the repo(s), reviews open PRs.
async function processScheduledReviews(): Promise<void> {
    try {
        const due = await integrationService.getDueSchedules();
        if (due.length === 0) return;

        for (const schedule of due) {
            const scheduleId = schedule.id as string;
            const connectionId = schedule.connection_id as string;
            const interval = (schedule.interval_minutes as number) || 360;
            const owner = schedule.repo_owner as string | null;
            const repoName = schedule.repo_name as string | null;
            const reposList = (schedule.repos as Array<{ owner: string; name: string }> | undefined) || [];
            console.log(`[Scheduler] Running schedule ${scheduleId} (${owner || '*'}/${repoName || '*'})`);

            try {
                const connection = await integrationService.getConnection(connectionId);
                if (!connection || connection.type !== 'github') {
                    await integrationService.markScheduleRan(scheduleId, interval);
                    continue;
                }
                const token = (connection.config as { token: string }).token;

                // Determine repos in scope
                let repos: Array<{ owner: string; name: string }> = [];
                if (reposList.length > 0) {
                    repos = reposList;
                } else if (owner && repoName) {
                    repos = [{ owner, name: repoName }];
                } else {
                    // Connection-wide: pull existing tracked PR repos
                    const tracked = await integrationService.getTrackedPullRequests(connectionId);
                    const seen = new Set<string>();
                    for (const t of tracked) {
                        const key = `${t.repo_owner}/${t.repo_name}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            repos.push({ owner: t.repo_owner as string, name: t.repo_name as string });
                        }
                    }
                }

                for (const r of repos) {
                    try {
                        const livePRs = await githubService.listPullRequests({ token }, r.owner, r.name, 'open');
                        await integrationService.syncPullRequests(connectionId, r.owner, r.name, livePRs.map((p: any) => ({
                            number: p.number,
                            title: p.title,
                            author: p.user.login,
                            branch: p.head.ref,
                            baseBranch: p.base.ref,
                            state: p.state,
                            htmlUrl: p.html_url,
                            sha: p.head.sha,
                        })));
                        await integrationService.logSchedulerRun({
                            scheduleId,
                            connectionId,
                            repoOwner: r.owner,
                            repoName: r.name,
                            action: 'sync',
                            status: 'success',
                            message: `Synced ${livePRs.length} open PRs`,
                        });
                        // Review every open tracked PR in this repo
                        const tracked = await integrationService.getTrackedPullRequests(connectionId, r.owner, r.name);
                        for (const t of tracked) {
                            if (t.state !== 'open') continue;
                            try {
                                await runReviewForTrackedPR(connectionId, t.id as string);
                                const pub = await publishReviewComments(connectionId, t.id as string, { summaryComment: true });
                                await integrationService.logSchedulerRun({
                                    scheduleId,
                                    connectionId,
                                    repoOwner: r.owner,
                                    repoName: r.name,
                                    prNumber: t.pr_number as number,
                                    action: 'review',
                                    status: 'success',
                                    message: `Reviewed PR #${t.pr_number} · published ${pub.published} comment(s)`,
                                });
                            } catch (e) {
                                console.error(`[Scheduler] Review failed for PR ${t.id}:`, e);
                                await integrationService.logSchedulerRun({
                                    scheduleId,
                                    connectionId,
                                    repoOwner: r.owner,
                                    repoName: r.name,
                                    prNumber: t.pr_number as number,
                                    action: 'review',
                                    status: 'failed',
                                    message: e instanceof Error ? e.message : 'Review failed',
                                });
                            }
                        }
                    } catch (e) {
                        console.error(`[Scheduler] Repo ${r.owner}/${r.name} failed:`, e);
                        await integrationService.logSchedulerRun({
                            scheduleId,
                            connectionId,
                            repoOwner: r.owner,
                            repoName: r.name,
                            action: 'sync',
                            status: 'failed',
                            message: e instanceof Error ? e.message : 'Sync failed',
                        });
                    }
                }
            } finally {
                await integrationService.markScheduleRan(scheduleId, interval);
            }
        }
    } catch (err) {
        console.error('[Scheduler] error:', err);
    }
}
setInterval(() => { processScheduledReviews().catch(console.error); }, 60_000);
// Run once on boot so the queue catches up after restarts
setTimeout(() => { processScheduledReviews().catch(console.error); }, 15_000);

app.listen(port, '0.0.0.0', () => {
    console.log(`SDL Agentic AI Platform running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});