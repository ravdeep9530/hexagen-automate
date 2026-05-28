import { Pool } from 'pg';
import { githubService } from './githubService';
import { sharepointService } from './sharepointService';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentic_platform',
});

export interface IntegrationConnection {
    id: string;
    type: 'github' | 'sharepoint' | 'azure_devops' | 'slack' | 'teams';
    name: string;
    config: Record<string, unknown>;
    status: 'active' | 'inactive' | 'error';
    lastSyncAt?: Date;
    createdAt: Date;
}

export interface IntegrationJob {
    id: string;
    connectionId: string;
    agentType: string;
    action: string;
    payload: Record<string, unknown>;
    status: 'pending' | 'running' | 'completed' | 'failed';
    externalId?: string;
    result?: Record<string, unknown>;
    createdAt: Date;
    completedAt?: Date;
}

class IntegrationService {
    async initializeTables(): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS integration_connections (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    type VARCHAR(50) NOT NULL,
                    name VARCHAR(255),
                    config JSONB NOT NULL DEFAULT '{}',
                    status VARCHAR(20) DEFAULT 'active',
                    last_sync_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS integration_jobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    connection_id UUID REFERENCES integration_connections(id),
                    agent_type VARCHAR(50),
                    action VARCHAR(100),
                    payload JSONB,
                    status VARCHAR(20) DEFAULT 'pending',
                    external_id VARCHAR(255),
                    result JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS tracked_pull_requests (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    connection_id UUID REFERENCES integration_connections(id),
                    repo_owner VARCHAR(100) NOT NULL,
                    repo_name VARCHAR(100) NOT NULL,
                    pr_number INTEGER NOT NULL,
                    title VARCHAR(500),
                    author VARCHAR(100),
                    branch VARCHAR(200),
                    base_branch VARCHAR(200),
                    state VARCHAR(20) DEFAULT 'open',
                    html_url VARCHAR(500),
                    github_sha VARCHAR(100),
                    ai_review JSONB,
                    ai_review_status VARCHAR(20) DEFAULT 'pending',
                    last_sync_at TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(connection_id, repo_owner, repo_name, pr_number)
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS pr_review_comments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tracked_pr_id UUID REFERENCES tracked_pull_requests(id),
                    file_path VARCHAR(500),
                    line_number INTEGER,
                    body TEXT NOT NULL,
                    severity VARCHAR(20) DEFAULT 'info',
                    is_posted BOOLEAN DEFAULT false,
                    github_comment_id VARCHAR(100),
                    code_snippet TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Migrations for new columns
            await client.query(`ALTER TABLE pr_review_comments ADD COLUMN IF NOT EXISTS code_snippet TEXT`);
            await client.query(`ALTER TABLE pr_review_comments ADD COLUMN IF NOT EXISTS replacement_code TEXT`);
            await client.query(`ALTER TABLE pr_review_comments ADD COLUMN IF NOT EXISTS start_line INTEGER`);
            await client.query(`ALTER TABLE pr_review_comments ADD COLUMN IF NOT EXISTS feedback VARCHAR(20)`);
            await client.query(`ALTER TABLE pr_review_comments ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMP`);
            await client.query(`ALTER TABLE pr_review_comments ADD COLUMN IF NOT EXISTS feedback_notes TEXT`);
            await client.query(`ALTER TABLE tracked_pull_requests ADD COLUMN IF NOT EXISTS saved_for_later BOOLEAN DEFAULT false`);
            await client.query(`ALTER TABLE tracked_pull_requests ADD COLUMN IF NOT EXISTS diff_patch TEXT`);
            await client.query(`ALTER TABLE tracked_pull_requests ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP`);
            await client.query(`ALTER TABLE scheduled_reviews ADD COLUMN IF NOT EXISTS repos JSONB DEFAULT '[]'`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS scheduler_runs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    schedule_id UUID REFERENCES scheduled_reviews(id) ON DELETE CASCADE,
                    connection_id UUID REFERENCES integration_connections(id),
                    repo_owner VARCHAR(100),
                    repo_name VARCHAR(100),
                    pr_number INTEGER,
                    action VARCHAR(50) NOT NULL,
                    status VARCHAR(20) DEFAULT 'success',
                    message TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS scheduled_reviews (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    connection_id UUID REFERENCES integration_connections(id) ON DELETE CASCADE,
                    repo_owner VARCHAR(100),
                    repo_name VARCHAR(100),
                    interval_minutes INTEGER NOT NULL DEFAULT 360,
                    enabled BOOLEAN DEFAULT true,
                    scope VARCHAR(20) DEFAULT 'repo',
                    last_run_at TIMESTAMP,
                    next_run_at TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(connection_id, repo_owner, repo_name)
                )
            `);
        } finally {
            client.release();
        }
    }

    async getConnections(): Promise<IntegrationConnection[]> {
        const result = await pool.query(
            'SELECT * FROM integration_connections ORDER BY created_at DESC'
        );
        return result.rows.map(this.mapConnection);
    }

    async getConnection(id: string): Promise<IntegrationConnection | null> {
        const result = await pool.query(
            'SELECT * FROM integration_connections WHERE id = $1',
            [id]
        );
        return result.rows[0] ? this.mapConnection(result.rows[0]) : null;
    }

    async createConnection(connection: Omit<IntegrationConnection, 'id' | 'createdAt'>): Promise<IntegrationConnection> {
        const result = await pool.query(
            `INSERT INTO integration_connections (type, name, config, status)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [connection.type, connection.name, JSON.stringify(connection.config), connection.status]
        );
        return this.mapConnection(result.rows[0]);
    }

    async updateConnection(id: string, updates: Partial<IntegrationConnection>): Promise<IntegrationConnection | null> {
        const sets: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.name) { sets.push(`name = $${idx++}`); values.push(updates.name); }
        if (updates.config) { sets.push(`config = $${idx++}`); values.push(JSON.stringify(updates.config)); }
        if (updates.status) { sets.push(`status = $${idx++}`); values.push(updates.status); }
        if (updates.lastSyncAt) { sets.push(`last_sync_at = $${idx++}`); values.push(updates.lastSyncAt); }

        values.push(id);
        const result = await pool.query(
            `UPDATE integration_connections SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return result.rows[0] ? this.mapConnection(result.rows[0]) : null;
    }

    async deleteConnection(id: string): Promise<boolean> {
        const result = await pool.query(
            'DELETE FROM integration_connections WHERE id = $1',
            [id]
        );
        return (result.rowCount ?? 0) > 0;
    }

    async testConnection(id: string): Promise<{ success: boolean; message: string }> {
        const connection = await this.getConnection(id);
        if (!connection) {
            return { success: false, message: 'Connection not found' };
        }

        try {
            switch (connection.type) {
                case 'github':
                    return await githubService.testConnection(connection.config as { token: string });
                case 'sharepoint':
                    return await sharepointService.testConnection(connection.config as { tenantId: string; clientId: string; clientSecret: string });
                default:
                    return { success: false, message: `Testing not implemented for ${connection.type}` };
            }
        } catch (error) {
            return { success: false, message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }

    async createJob(job: Omit<IntegrationJob, 'id' | 'createdAt'>): Promise<IntegrationJob> {
        const result = await pool.query(
            `INSERT INTO integration_jobs (connection_id, agent_type, action, payload, status, external_id)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [job.connectionId, job.agentType, job.action, JSON.stringify(job.payload), job.status, job.externalId]
        );
        return this.mapJob(result.rows[0]);
    }

    async getJobs(connectionId?: string): Promise<IntegrationJob[]> {
        const query = connectionId
            ? 'SELECT * FROM integration_jobs WHERE connection_id = $1 ORDER BY created_at DESC LIMIT 50'
            : 'SELECT * FROM integration_jobs ORDER BY created_at DESC LIMIT 50';
        const result = await pool.query(query, connectionId ? [connectionId] : []);
        return result.rows.map(this.mapJob);
    }

    async updateJob(id: string, updates: Partial<IntegrationJob>): Promise<IntegrationJob | null> {
        const sets: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (updates.status) { sets.push(`status = $${idx++}`); values.push(updates.status); }
        if (updates.result) { sets.push(`result = $${idx++}`); values.push(JSON.stringify(updates.result)); }
        if (updates.externalId) { sets.push(`external_id = $${idx++}`); values.push(updates.externalId); }
        if (updates.completedAt) { sets.push(`completed_at = $${idx++}`); values.push(updates.completedAt); }

        values.push(id);
        const result = await pool.query(
            `UPDATE integration_jobs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return result.rows[0] ? this.mapJob(result.rows[0]) : null;
    }

    // PR Tracking Methods
    async syncPullRequests(connectionId: string, repoOwner: string, repoName: string, prs: Array<{
        number: number; title: string; author: string; branch: string; baseBranch: string;
        state: string; htmlUrl: string; sha: string;
    }>): Promise<void> {
        for (const pr of prs) {
            await pool.query(
                `INSERT INTO tracked_pull_requests (connection_id, repo_owner, repo_name, pr_number, title, author, branch, base_branch, state, html_url, github_sha, last_sync_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                 ON CONFLICT (connection_id, repo_owner, repo_name, pr_number)
                 DO UPDATE SET title = $5, author = $6, branch = $7, base_branch = $8, state = $9, html_url = $10, github_sha = $11, last_sync_at = NOW()`,
                [connectionId, repoOwner, repoName, pr.number, pr.title, pr.author, pr.branch, pr.baseBranch, pr.state, pr.htmlUrl, pr.sha]
            );
        }
        // Mark any previously open PRs that are no longer in the live list as closed
        const numbers = prs.map(p => p.number);
        await pool.query(
            `UPDATE tracked_pull_requests
             SET state = 'closed', last_sync_at = NOW()
             WHERE connection_id = $1 AND repo_owner = $2 AND repo_name = $3
               AND state = 'open' AND pr_number <> ALL($4)`,
            [connectionId, repoOwner, repoName, numbers]
        );
    }

    async getTrackedPullRequests(connectionId?: string, repoOwner?: string, repoName?: string): Promise<Array<Record<string, unknown>>> {
        let query = 'SELECT * FROM tracked_pull_requests WHERE 1=1';
        const params: unknown[] = [];
        let idx = 1;
        if (connectionId) { query += ` AND connection_id = $${idx++}`; params.push(connectionId); }
        if (repoOwner) { query += ` AND repo_owner = $${idx++}`; params.push(repoOwner); }
        if (repoName) { query += ` AND repo_name = $${idx++}`; params.push(repoName); }
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query, params);
        return result.rows;
    }

    async updatePRReview(id: string, review: Record<string, unknown>, status: string): Promise<void> {
        await pool.query(
            'UPDATE tracked_pull_requests SET ai_review = $1, ai_review_status = $2 WHERE id = $3',
            [JSON.stringify(review), status, id]
        );
    }

    async saveReviewComment(trackedPrId: string, comment: {
        filePath?: string; lineNumber?: number; body: string; severity?: string;
        codeSnippet?: string; replacementCode?: string; startLine?: number;
    }): Promise<void> {
        await pool.query(
            `INSERT INTO pr_review_comments (tracked_pr_id, file_path, line_number, body, severity, code_snippet, replacement_code, start_line)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                trackedPrId,
                comment.filePath || null,
                comment.lineNumber || null,
                comment.body,
                comment.severity || 'info',
                comment.codeSnippet || null,
                comment.replacementCode || null,
                comment.startLine || null,
            ]
        );
    }

    async setCommentFeedback(commentId: string, feedback: 'accepted' | 'rejected' | null, notes?: string): Promise<void> {
        await pool.query(
            `UPDATE pr_review_comments
             SET feedback = $1, feedback_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END,
                 feedback_notes = $2
             WHERE id = $3`,
            [feedback, notes || null, commentId]
        );
    }

    // Returns a compact summary of recent feedback so the AI can learn from it.
    async getFeedbackContext(limit = 12): Promise<{ accepted: string[]; rejected: string[] }> {
        const result = await pool.query(
            `SELECT body, severity, feedback FROM pr_review_comments
             WHERE feedback IS NOT NULL
             ORDER BY feedback_at DESC NULLS LAST
             LIMIT $1`,
            [limit * 2]
        );
        const accepted: string[] = [];
        const rejected: string[] = [];
        for (const row of result.rows) {
            const summary = (row.body as string).split('\n')[0].slice(0, 200);
            if (row.feedback === 'accepted' && accepted.length < limit) accepted.push(summary);
            else if (row.feedback === 'rejected' && rejected.length < limit) rejected.push(summary);
        }
        return { accepted, rejected };
    }

    async savePRDiff(trackedPrId: string, diffPatch: string): Promise<void> {
        await pool.query(
            `UPDATE tracked_pull_requests SET diff_patch = $1, last_reviewed_at = NOW() WHERE id = $2`,
            [diffPatch, trackedPrId]
        );
    }

    async setSavedForLater(trackedPrId: string, saved: boolean): Promise<void> {
        await pool.query(
            `UPDATE tracked_pull_requests SET saved_for_later = $1 WHERE id = $2`,
            [saved, trackedPrId]
        );
    }

    async getAllOpenPRs(savedOnly?: boolean): Promise<Array<Record<string, unknown>>> {
        let query = `
            SELECT tpr.*, ic.name AS connection_name
            FROM tracked_pull_requests tpr
            LEFT JOIN integration_connections ic ON tpr.connection_id = ic.id
            WHERE ${savedOnly ? `tpr.saved_for_later = true` : `(tpr.state = 'open' OR tpr.saved_for_later = true)`}
        `;
        query += ` ORDER BY tpr.last_sync_at DESC NULLS LAST, tpr.created_at DESC`;
        const result = await pool.query(query);
        return result.rows;
    }

    async getTrackedPRById(trackedPrId: string): Promise<Record<string, unknown> | null> {
        const result = await pool.query(
            `SELECT * FROM tracked_pull_requests WHERE id = $1`,
            [trackedPrId]
        );
        return result.rows[0] || null;
    }

    // Scheduled reviews
    async listSchedules(connectionId?: string): Promise<Array<Record<string, unknown>>> {
        let query = `
            SELECT sr.*, ic.name AS connection_name,
                   (SELECT id   FROM agents WHERE name = 'GitHub PR Reviewer' LIMIT 1) AS agent_id,
                   (SELECT name FROM agents WHERE name = 'GitHub PR Reviewer' LIMIT 1) AS agent_name
            FROM scheduled_reviews sr
            LEFT JOIN integration_connections ic ON sr.connection_id = ic.id
        `;
        const params: unknown[] = [];
        if (connectionId) { query += ` WHERE sr.connection_id = $1`; params.push(connectionId); }
        query += ` ORDER BY sr.created_at DESC`;
        const result = await pool.query(query, params);
        return result.rows;
    }

    async upsertSchedule(input: {
        connectionId: string;
        repoOwner?: string | null;
        repoName?: string | null;
        intervalMinutes: number;
        enabled: boolean;
        scope?: string;
        repos?: Array<{ owner: string; name: string }>;
    }): Promise<Record<string, unknown>> {
        const reposJson = input.repos && input.repos.length > 0 ? JSON.stringify(input.repos) : '[]';
        const result = await pool.query(
            `INSERT INTO scheduled_reviews (connection_id, repo_owner, repo_name, interval_minutes, enabled, scope, repos, next_run_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (connection_id, repo_owner, repo_name)
             DO UPDATE SET interval_minutes = $4, enabled = $5, scope = $6, repos = $7
             RETURNING *`,
            [input.connectionId, input.repoOwner || null, input.repoName || null, input.intervalMinutes, input.enabled, input.scope || 'repo', reposJson]
        );
        return result.rows[0];
    }

    async deleteSchedule(id: string): Promise<boolean> {
        const result = await pool.query(`DELETE FROM scheduled_reviews WHERE id = $1`, [id]);
        return (result.rowCount ?? 0) > 0;
    }

    async getDueSchedules(): Promise<Array<Record<string, unknown>>> {
        const result = await pool.query(
            `SELECT * FROM scheduled_reviews WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= NOW())`
        );
        return result.rows;
    }

    async markScheduleRan(id: string, intervalMinutes: number): Promise<void> {
        await pool.query(
            `UPDATE scheduled_reviews SET last_run_at = NOW(), next_run_at = NOW() + ($1 || ' minutes')::interval WHERE id = $2`,
            [intervalMinutes, id]
        );
    }

    async logSchedulerRun(input: {
        scheduleId: string;
        connectionId: string;
        repoOwner?: string | null;
        repoName?: string | null;
        prNumber?: number | null;
        action: string;
        status?: string;
        message?: string;
    }): Promise<void> {
        await pool.query(
            `INSERT INTO scheduler_runs (schedule_id, connection_id, repo_owner, repo_name, pr_number, action, status, message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [input.scheduleId, input.connectionId, input.repoOwner || null, input.repoName || null, input.prNumber || null, input.action, input.status || 'success', input.message || null]
        );
    }

    async getSchedulerRuns(scheduleId?: string, limit = 100): Promise<Array<Record<string, unknown>>> {
        let query = `
            SELECT sr.*, ic.name AS connection_name, s.repo_owner AS schedule_repo_owner, s.repo_name AS schedule_repo_name
            FROM scheduler_runs sr
            LEFT JOIN integration_connections ic ON sr.connection_id = ic.id
            LEFT JOIN scheduled_reviews s ON sr.schedule_id = s.id
            WHERE 1=1
        `;
        const params: unknown[] = [];
        if (scheduleId) {
            query += ` AND sr.schedule_id = $1`;
            params.push(scheduleId);
        }
        query += ` ORDER BY sr.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await pool.query(query, params);
        return result.rows;
    }

    async getReviewComments(trackedPrId: string): Promise<Array<Record<string, unknown>>> {
        const result = await pool.query(
            'SELECT * FROM pr_review_comments WHERE tracked_pr_id = $1 ORDER BY created_at DESC',
            [trackedPrId]
        );
        return result.rows;
    }

    async deleteUnpostedComments(trackedPrId: string): Promise<void> {
        await pool.query(
            'DELETE FROM pr_review_comments WHERE tracked_pr_id = $1 AND is_posted = false',
            [trackedPrId]
        );
    }

    private mapConnection(row: Record<string, unknown>): IntegrationConnection {
        return {
            id: row.id as string,
            type: row.type as IntegrationConnection['type'],
            name: row.name as string,
            config: (row.config as Record<string, unknown>) || {},
            status: row.status as IntegrationConnection['status'],
            lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string) : undefined,
            createdAt: new Date(row.created_at as string),
        };
    }

    private mapJob(row: Record<string, unknown>): IntegrationJob {
        return {
            id: row.id as string,
            connectionId: row.connection_id as string,
            agentType: row.agent_type as string,
            action: row.action as string,
            payload: (row.payload as Record<string, unknown>) || {},
            status: row.status as IntegrationJob['status'],
            externalId: row.external_id as string | undefined,
            result: (row.result as Record<string, unknown>) || undefined,
            createdAt: new Date(row.created_at as string),
            completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
        };
    }
}

export const integrationService = new IntegrationService();
