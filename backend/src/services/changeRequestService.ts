import { Pool } from 'pg';
import { sharepointService, getDefaultSharePointConfig } from './sharepointService';
import { STAGES, type Stage } from './pipelineService';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentic',
});

export interface ChangeRequest {
    id: string;
    run_id: string;
    stage: Stage;
    status: 'pending' | 'applied' | 'dismissed';
    proposed_artifact: unknown;
    stage_snapshots: Record<string, unknown>;
    sharepoint_url: string | null;
    applied_run_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

const EDITABLE_STAGES: Stage[] = ['requirements', 'plan', 'design'];

export const changeRequestService = {

    async createChangeRequest(
        runId: string,
        stage: Stage,
        proposedArtifact: unknown,
        createdBy?: string,
    ): Promise<ChangeRequest> {
        if (!EDITABLE_STAGES.includes(stage)) {
            throw Object.assign(new Error(`Stage '${stage}' does not support change requests`), { code: 'invalid_stage' });
        }

        const stageRow = await pool.query(
            `SELECT status FROM pipeline_stage_status WHERE run_id = $1 AND stage = $2`,
            [runId, stage],
        );
        if (!stageRow.rows[0]) {
            throw Object.assign(new Error('Stage not found for this run'), { code: 'stage_not_found' });
        }
        if (stageRow.rows[0].status !== 'approved') {
            throw Object.assign(
                new Error(`Stage '${stage}' is not approved yet. Edit it directly instead.`),
                { code: 'stage_not_approved' },
            );
        }

        // Collect snapshots of all approved stages at or before this stage.
        const stageIndex = STAGES.indexOf(stage);
        const priorStages = STAGES.slice(0, stageIndex + 1);
        const snapshotRows = await pool.query(
            `SELECT stage, artifact_json FROM pipeline_stage_status
              WHERE run_id = $1 AND stage = ANY($2) AND status = 'approved'`,
            [runId, priorStages],
        );
        const stageSnapshots: Record<string, unknown> = {};
        for (const row of snapshotRows.rows) {
            stageSnapshots[row.stage] = row.artifact_json;
        }

        // Insert the change request (without SharePoint URL first so we have the id).
        const insertRes = await pool.query(
            `INSERT INTO change_requests (run_id, stage, proposed_artifact, stage_snapshots, created_by)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
             RETURNING *`,
            [runId, stage, JSON.stringify(proposedArtifact), JSON.stringify(stageSnapshots), createdBy ?? null],
        );
        const cr: ChangeRequest = insertRes.rows[0];

        // Best-effort SharePoint upload — don't fail the CR creation if SP is misconfigured.
        try {
            const cfg = getDefaultSharePointConfig();
            const folderPath = `${cfg.folder}/${runId}/change-requests`;
            const payload = {
                cr_id: cr.id,
                stage,
                created_at: cr.created_at,
                created_by: createdBy ?? null,
                proposed_artifact: proposedArtifact,
                stage_snapshots: stageSnapshots,
            };
            const result = await sharepointService.uploadDocument(
                cfg,
                cfg.driveId,
                folderPath,
                `change-request-${cr.id}.json`,
                JSON.stringify(payload, null, 2),
            );
            await pool.query(
                `UPDATE change_requests SET sharepoint_url = $2, updated_at = now() WHERE id = $1`,
                [cr.id, result.webUrl],
            );
            cr.sharepoint_url = result.webUrl;
        } catch {
            // SP upload failure is non-fatal — the CR is safely in the DB.
        }

        return cr;
    },

    async listChangeRequests(runId: string): Promise<ChangeRequest[]> {
        const result = await pool.query(
            `SELECT id, run_id, stage, status, proposed_artifact, stage_snapshots,
                    sharepoint_url, applied_run_id, created_by, created_at, updated_at
               FROM change_requests WHERE run_id = $1 ORDER BY created_at DESC`,
            [runId],
        );
        return result.rows;
    },

    async getChangeRequest(crId: string): Promise<ChangeRequest> {
        const result = await pool.query(
            `SELECT * FROM change_requests WHERE id = $1`,
            [crId],
        );
        if (!result.rows[0]) throw Object.assign(new Error('Change request not found'), { code: 'not_found' });
        return result.rows[0];
    },

    async dismissChangeRequest(crId: string): Promise<void> {
        const result = await pool.query(
            `UPDATE change_requests SET status = 'dismissed', updated_at = now() WHERE id = $1 AND status = 'pending'`,
            [crId],
        );
        if (result.rowCount === 0) {
            throw Object.assign(new Error('Change request not found or already applied/dismissed'), { code: 'not_found' });
        }
    },

    async applyChangeRequest(crId: string): Promise<{ run_id: string }> {
        const cr = await this.getChangeRequest(crId);
        if (cr.status !== 'pending') {
            throw Object.assign(new Error(`Change request is already ${cr.status}`), { code: 'already_resolved' });
        }

        // Import lazily to avoid circular dep (pipelineService imports pool; same pattern).
        const { pipelineService } = await import('./pipelineService');
        const { run_id: newRunId } = await pipelineService.createRunFromChangeRequest(crId);

        await pool.query(
            `UPDATE change_requests SET status = 'applied', applied_run_id = $2, updated_at = now() WHERE id = $1`,
            [crId, newRunId],
        );

        return { run_id: newRunId };
    },
};
