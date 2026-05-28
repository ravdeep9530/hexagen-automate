import { Pool } from 'pg';
import {
    getDefaultSharePointConfig,
    sharepointService,
} from './sharepointService';
import {
    validateRequirements,
    type ClarificationRound,
    type RequirementsArtifact,
    REQUIREMENTS_SCHEMA_VERSION,
} from './requirementsSchema';
import { generateRequirementsDoc, generateRequirementsOverviewDoc } from './documentationService';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentic',
});

const DIFY_URL = process.env.DIFY_BASE_URL || 'http://dify-nginx';

// The n8n requirements stage template enters a single Wait node right after
// writing the status row. That Wait stays alive across clarification rounds
// and SharePoint syncs — the backend mutates the DB freely; only the eventual
// approve/reject decision needs to hit the n8n resume webhook (which
// decideStage handles via pipelineService.rewriteResumeUrl).
// We therefore do NOT need a continuation webhook for the happy path.
// Sync is only supported while the Wait is still alive (awaiting_approval
// or awaiting_clarification).

interface StoredArtifact {
    answer?: string | null;
    parsed?: RequirementsArtifact | null;
    usage?: unknown;
    source?: 'dify' | 'sharepoint' | 'manual';
    version?: number;
    clarification_rounds?: ClarificationRound[];
    proceeded_anyway?: boolean;
}

interface RequirementsStageRow {
    run_id: string;
    repo_full_name: string;
    status: string;
    dify_conversation_id: string | null;
    artifact_json: StoredArtifact | null;
    artifact_url: string | null;
    resume_webhook_url: string | null;
    requirements_resume_url: string | null;
}

async function getDifyApiKeyForRequirements(): Promise<string> {
    const r = await pool.query<{ api_key: string }>(
        'SELECT api_key FROM dify_app_keys WHERE stage = $1',
        ['requirements'],
    );
    if (r.rowCount === 0) throw new Error('No dify_app_keys row for stage=requirements');
    return r.rows[0].api_key;
}

async function loadRequirementsRow(runId: string, client: Pool | { query: Pool['query'] } = pool): Promise<RequirementsStageRow> {
    const r = await client.query(
        `SELECT s.run_id, s.status, s.dify_conversation_id, s.artifact_json, s.artifact_url, s.resume_webhook_url,
                r.repo_full_name, r.requirements_resume_url
           FROM pipeline_stage_status s
           JOIN pipeline_runs r ON r.run_id = s.run_id
          WHERE s.run_id = $1 AND s.stage = 'requirements'`,
        [runId],
    );
    if (r.rowCount === 0) throw new Error(`No requirements stage row for run ${runId}`);
    return r.rows[0] as RequirementsStageRow;
}

function stripFences(answer: string): string {
    return answer
        .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
}

async function callDifyContinuation(
    apiKey: string,
    conversationId: string | null,
    query: string,
    runId: string,
): Promise<{ answer: string; parsed: RequirementsArtifact | null; messageId: string | null; conversationId: string | null; usage: unknown }> {
    const body: Record<string, unknown> = {
        inputs: {},
        query,
        response_mode: 'blocking',
        // Must match the `user` n8n used on the initial call ('n8n-' + run_id)
        // so Dify treats the follow-up as the same conversation owner.
        user: `n8n-${runId}`,
    };
    if (conversationId) body.conversation_id = conversationId;

    const resp = await fetch(`${DIFY_URL}/v1/chat-messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Dify clarification call failed (${resp.status}): ${txt.slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
        answer?: string;
        id?: string;
        message_id?: string;
        conversation_id?: string;
        metadata?: { usage?: unknown };
    };
    const answer = stripFences((data.answer || '').toString());
    let parsed: RequirementsArtifact | null = null;
    try {
        const obj = JSON.parse(answer);
        const v = validateRequirements(obj);
        if (v.valid) parsed = v.value;
    } catch {
        // Leave parsed = null; caller will surface the raw answer.
    }
    return {
        answer,
        parsed,
        messageId: data.message_id || data.id || null,
        conversationId: data.conversation_id || conversationId,
        usage: data.metadata?.usage ?? null,
    };
}

function formatClarificationQuery(qa: Array<{ q: string; a: string }>): string {
    const lines = qa.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join('\n\n');
    return [
        'The user has answered some of your previous open_questions. Please update the requirements JSON accordingly.',
        '',
        'Q&A:',
        lines,
        '',
        'Re-emit the FULL requirements JSON using the same schema as before. Remove answered items from open_questions. Add any NEW ambiguities you notice to open_questions. Do not include prose or markdown fences.',
    ].join('\n');
}

class RequirementsService {
    /**
     * Submit user answers to the current open_questions. Calls Dify with the
     * stored conversation_id, appends a clarification round to artifact_json,
     * and either stays in awaiting_clarification (if new questions emerge) or
     * flips to awaiting_approval (triggering the n8n continuation webhook).
     */
    async submitClarificationAnswers(
        runId: string,
        answers: Record<string, string>,
        opts: { force_proceed?: boolean } = {},
    ): Promise<{ status: 'awaiting_clarification' | 'awaiting_approval'; open_questions: string[]; round: number }> {
        const apiKey = await getDifyApiKeyForRequirements();

        // 1. Read current state. No FOR UPDATE because we don't want to hold
        //    a lock across the (slow) Dify call. Concurrency is enforced via
        //    a CAS in step 2 — flipping status atomically claims the slot.
        const readRes = await pool.query(
            `SELECT status, dify_conversation_id, artifact_json
               FROM pipeline_stage_status
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId],
        );
        if (readRes.rowCount === 0) throw new Error(`No requirements stage row for run ${runId}`);
        const current = readRes.rows[0] as { status: string; dify_conversation_id: string | null; artifact_json: StoredArtifact | null };

        if (current.status !== 'awaiting_clarification') {
            throw new Error(`Stage status is ${current.status}, cannot accept clarification answers`);
        }

        const existing: StoredArtifact = current.artifact_json || {};
        const openQuestions = existing.parsed?.open_questions || [];
        const rounds: ClarificationRound[] = existing.clarification_rounds || [];
        const askedAt = new Date().toISOString();

        // Build Q&A pairs in the order Dify listed them. Skip empty answers.
        const qa = openQuestions
            .map((q) => ({ q, a: (answers[q] || '').trim() }))
            .filter(({ a }) => a.length > 0);

        if (qa.length === 0 && !opts.force_proceed) {
            throw new Error('No answers provided. Submit at least one answer or use force_proceed.');
        }

        let newParsed: RequirementsArtifact | null = existing.parsed || null;
        let answer = existing.answer || '';
        let messageId: string | null = null;
        let conversationId = current.dify_conversation_id;
        let usage: unknown = existing.usage ?? null;

        if (qa.length > 0) {
            // 2. CAS: flip status to 'running' + write the activity ticker
            //    text only if no one else has moved on. This is visible to
            //    the SSE stream the instant it commits, so the UI shows
            //    "Calling Dify…" while we block on the LLM.
            const casRes = await pool.query(
                `UPDATE pipeline_stage_status
                    SET status = 'running',
                        current_activity = $2,
                        updated_at = now()
                  WHERE run_id = $1 AND stage = 'requirements'
                    AND status = 'awaiting_clarification'`,
                [runId, `Calling Dify for clarification (round ${rounds.length + 1})…`],
            );
            if (casRes.rowCount === 0) {
                throw new Error('Another clarification submit is already in flight or the stage has moved on.');
            }

            try {
                const query = formatClarificationQuery(qa);
                const difyResult = await callDifyContinuation(apiKey, conversationId, query, runId);
                answer = difyResult.answer;
                newParsed = difyResult.parsed ?? newParsed;
                messageId = difyResult.messageId;
                conversationId = difyResult.conversationId;
                usage = difyResult.usage;
            } catch (e) {
                // Restore so the user can retry without being stuck in 'running'.
                await pool.query(
                    `UPDATE pipeline_stage_status
                        SET status = 'awaiting_clarification', current_activity = NULL, updated_at = now()
                      WHERE run_id = $1 AND stage = 'requirements'`,
                    [runId],
                ).catch(() => { /* swallow — original error is what the caller needs */ });
                throw e;
            }
        }

        const openQuestionsAfter = opts.force_proceed
            ? []
            : (newParsed?.open_questions || []);

        const newRound: ClarificationRound = {
            round: rounds.length + 1,
            asked_at: rounds[rounds.length - 1]?.answered_at || askedAt,
            answered_at: askedAt,
            questions: openQuestions,
            answers: Object.fromEntries(qa.map(({ q, a }) => [q, a])),
            dify_message_id: messageId,
            open_questions_after: openQuestionsAfter,
        };
        const updatedRounds = [...rounds, newRound];

        const nextStatus: 'awaiting_clarification' | 'awaiting_approval' =
            openQuestionsAfter.length === 0 ? 'awaiting_approval' : 'awaiting_clarification';

        const updatedArtifact: StoredArtifact = {
            answer,
            parsed: newParsed
                ? { ...newParsed, open_questions: openQuestionsAfter }
                : null,
            usage,
            source: 'dify',
            version: (existing.version ?? 0) + 1,
            clarification_rounds: updatedRounds,
            proceeded_anyway: opts.force_proceed === true || existing.proceeded_anyway === true,
        };

        // 3. Final write — clears current_activity and commits the result.
        await pool.query(
            `UPDATE pipeline_stage_status
                SET status = $2,
                    artifact_json = $3::jsonb,
                    dify_conversation_id = COALESCE($4, dify_conversation_id),
                    dify_run_id = COALESCE($5, dify_run_id),
                    current_activity = NULL,
                    updated_at = now()
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId, nextStatus, JSON.stringify(updatedArtifact), conversationId, messageId],
        );

        // No webhook fire needed: the n8n Wait node from the initial stage 1
        // execution is still alive. The user's eventual Approve hits its
        // resume URL through the existing decideStage flow.

        return { status: nextStatus, open_questions: openQuestionsAfter, round: newRound.round };
    }

    /**
     * Upload the currently-stored requirements JSON to SharePoint under
     * `{folder}/{run_id}/requirements.json`. Called by pipelineService.decideStage
     * when stage='requirements' is approved.
     */
    async uploadApprovedRequirementsToSharePoint(runId: string): Promise<{ artifact_url: string }> {
        const row = await loadRequirementsRow(runId);
        if (!row.artifact_json?.parsed) {
            throw new Error('Cannot upload to SharePoint: requirements artifact has no parsed JSON');
        }

        // Announce activity so the user sees the upload happening in the ticker.
        await pool.query(
            `UPDATE pipeline_stage_status
                SET current_activity = 'Uploading approved requirements to SharePoint…',
                    updated_at = now()
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId],
        );

        const cfg = getDefaultSharePointConfig();
        const payload: RequirementsArtifact = {
            ...row.artifact_json.parsed,
            source: row.artifact_json.source || 'dify',
            version: row.artifact_json.version ?? REQUIREMENTS_SCHEMA_VERSION,
        };
        const folderPath = `${cfg.folder}/${runId}`;

        // Upload machine-readable JSON
        await sharepointService.uploadDocument(
            cfg,
            cfg.driveId,
            folderPath,
            'requirements.json',
            JSON.stringify(payload, null, 2),
        );

        // Upload human-readable Word documents (technical + stakeholder overview)
        await pool.query(
            `UPDATE pipeline_stage_status
                SET current_activity = 'Generating Word documents…', updated_at = now()
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId],
        );
        const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const [docBuffer, overviewBuffer] = await Promise.all([
            generateRequirementsDoc(payload, runId),
            generateRequirementsOverviewDoc(payload, runId),
        ]);
        const [docResult] = await Promise.all([
            sharepointService.uploadBinaryDocument(cfg, cfg.driveId, folderPath, 'requirements.docx', docBuffer, docxType),
            sharepointService.uploadBinaryDocument(cfg, cfg.driveId, folderPath, 'requirements-overview.docx', overviewBuffer, docxType),
        ]);

        await pool.query(
            `UPDATE pipeline_stage_status
                SET artifact_url = $2, current_activity = NULL, updated_at = now()
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId, docResult.webUrl],
        );
        return { artifact_url: docResult.webUrl };
    }

    /**
     * Pull the latest requirements.json from SharePoint, validate it, and
     * replace artifact_json. Resets status to awaiting_approval so the user
     * can review the synced version. No Dify call.
     */
    async syncFromSharePoint(runId: string): Promise<{ artifact_url: string | null; open_questions_count: number; version: number }> {
        const row = await loadRequirementsRow(runId);
        // Sync only works while the n8n Wait is still alive. After approval
        // or rejection the workflow has resumed and stages 2-7 may already be
        // running — re-syncing then would leave stale stage 1 content in the
        // DB but no way to re-enter the gate. Direct the user to a full rerun.
        if (!['awaiting_approval', 'awaiting_clarification'].includes(row.status)) {
            throw new Error(
                `Cannot sync from SharePoint while stage status is "${row.status}". Use Rerun Pipeline to start a fresh run.`,
            );
        }
        // Announce we're pulling — the UI ticker flips to "Pulling…" while
        // the Graph download runs.
        await pool.query(
            `UPDATE pipeline_stage_status
                SET current_activity = 'Pulling latest requirements from SharePoint…',
                    updated_at = now()
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId],
        );

        const cfg = getDefaultSharePointConfig();
        const folderPath = `${cfg.folder}/${runId}`;

        const raw = await sharepointService.downloadDocumentByPath(cfg, cfg.driveId, folderPath, 'requirements.json');
        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(raw);
        } catch (e) {
            const err = new Error(`SharePoint requirements.json is not valid JSON: ${(e as Error).message}`);
            (err as Error & { code?: string }).code = 'invalid_json';
            throw err;
        }
        const validation = validateRequirements(parsedJson);
        if (!validation.valid) {
            const err = new Error(`SharePoint requirements.json failed schema validation: ${validation.errors.join('; ')}`);
            (err as Error & { code?: string }).code = 'invalid_schema';
            throw err;
        }

        const existing: StoredArtifact = row.artifact_json || {};
        const nextVersion = (existing.version ?? 0) + 1;
        const updatedArtifact: StoredArtifact = {
            answer: null,
            parsed: { ...validation.value, source: 'sharepoint', version: nextVersion },
            usage: null,
            source: 'sharepoint',
            version: nextVersion,
            clarification_rounds: existing.clarification_rounds || [],
            proceeded_anyway: existing.proceeded_anyway === true,
        };

        await pool.query(
            `UPDATE pipeline_stage_status
                SET artifact_json = $2::jsonb,
                    status = 'awaiting_approval',
                    current_activity = NULL,
                    error = NULL,
                    updated_at = now()
              WHERE run_id = $1 AND stage = 'requirements'`,
            [runId, JSON.stringify(updatedArtifact)],
        );

        return {
            artifact_url: row.artifact_url,
            open_questions_count: validation.value.open_questions.length,
            version: nextVersion,
        };
    }

    async getClarificationHistory(runId: string): Promise<{ rounds: ClarificationRound[] }> {
        const row = await loadRequirementsRow(runId);
        return { rounds: row.artifact_json?.clarification_rounds || [] };
    }
}

export const requirementsService = new RequirementsService();
