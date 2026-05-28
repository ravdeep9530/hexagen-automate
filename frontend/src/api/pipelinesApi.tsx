import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

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

export type RunStatus =
    | 'queued' | 'running' | 'awaiting_clarification' | 'awaiting_approval' | 'approved' | 'rejected' | 'completed' | 'failed';
export type StageStatusName =
    | 'pending' | 'running' | 'awaiting_clarification' | 'awaiting_approval' | 'approved' | 'rejected' | 'failed' | 'skipped';

export interface ClarificationRound {
    round: number;
    asked_at: string;
    answered_at: string;
    questions: string[];
    answers: Record<string, string>;
    dify_message_id: string | null;
    open_questions_after: string[];
}

export interface RequirementsArtifact {
    title?: string;
    user_stories?: string[];
    functional_requirements?: string[];
    non_functional_requirements?: string[];
    acceptance_criteria?: string[];
    open_questions?: string[];
    assumptions?: string[];
    out_of_scope?: string[];
    source?: 'dify' | 'sharepoint' | 'manual';
    version?: number;
}

export interface RequirementsStageArtifact {
    answer?: string | null;
    parsed?: RequirementsArtifact | null;
    usage?: unknown;
    source?: 'dify' | 'sharepoint' | 'manual';
    version?: number;
    clarification_rounds?: ClarificationRound[];
    proceeded_anyway?: boolean;
}

export interface RegistryRepo {
    repo_full_name: string;
    repo_url: string | null;
    default_branch: string;
    dify_workflow_app_ids: Record<string, string>;
    sharepoint_drive_id: string | null;
    slack_channel_id: string | null;
}

export interface StageStatus {
    stage: Stage;
    status: StageStatusName;
    dify_run_id: string | null;
    resume_webhook_url: string | null;
    artifact_url: string | null;
    artifact_json: unknown;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    current_activity: string | null;
}

export type DeploymentStatus = 'starting' | 'installing' | 'running' | 'stopped' | 'failed' | 'crashed' | 'auto-fixing';
export type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface VerificationError {
    code: string;
    message: string;
}

export interface VerificationResult {
    passed: boolean;
    status: number | null;
    load_time_ms: number | null;
    errors: VerificationError[];
    warnings: VerificationError[];
    screenshot_path: string | null;
    ran_at: string;
    duration_ms: number;
}

export interface Deployment {
    run_id: string;
    status: DeploymentStatus;
    port: number | null;
    pid: number | null;
    url: string | null;
    work_dir: string | null;
    log_path: string | null;
    start_command: string | null;
    error: string | null;
    started_at: string;
    stopped_at: string | null;
    updated_at: string;
    verification_status: VerificationStatus | null;
    verification_result: VerificationResult | null;
}

export interface PipelineRun {
    run_id: string;
    repo_full_name: string;
    raw_request: string;
    requester_id: string | null;
    status: RunStatus;
    current_stage: Stage | null;
    created_at: string;
    updated_at: string;
    stages: StageStatus[];
    deployment?: Deployment | null;
    design_preferences?: DesignPreferences | null;
    source_change_request_id?: string | null;
}

export interface PipelineRunSummary {
    run_id: string;
    repo_full_name: string;
    raw_request: string;
    requester_id: string | null;
    status: RunStatus;
    current_stage: Stage | null;
    created_at: string;
    updated_at: string;
}

// ---- hooks ----

export function useRepos() {
    const [repos, setRepos] = useState<RegistryRepo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetchRepos = useCallback(async () => {
        setLoading(true);
        try {
            const r = await axios.get(`${API_URL}/repos`);
            setRepos(r.data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'failed to load repos');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { fetchRepos(); }, [fetchRepos]);
    return { repos, loading, error, refetch: fetchRepos };
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

export interface DesignField { name: string; type: string; description?: string; }
export interface DesignEntity { name: string; fields: DesignField[]; relationships: string[]; }
export interface ApiContract {
    method: string;
    path: string;
    request_body?: string;
    response_schema?: string;
    errors?: string[];
}
export interface SequenceDiagram { title: string; diagram: string; }
export interface DesignAdr { title: string; context: string; decision: string; consequences: string; }
export interface DesignArtifactShape {
    architecture_diagram_mermaid: string;
    data_model: DesignEntity[];
    api_contracts: ApiContract[];
    sequence_diagrams_mermaid: SequenceDiagram[];
    security_considerations: string[];
    adrs: DesignAdr[];
}

export function useStartPipeline() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const start = useCallback(async (input: {
        repo: string;
        raw_request: string;
        requester_id?: string;
        design_preferences?: DesignPreferences | null;
        project_id?: string;
    }) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines`, input);
            setError(null);
            return r.data as { run_id: string };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to start');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { start, loading, error };
}

export function usePipelineList(autoRefreshMs = 0, projectId?: string) {
    const [runs, setRuns] = useState<PipelineRunSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const fetchRuns = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: '100' });
            if (projectId) params.set('project_id', projectId);
            const r = await axios.get(`${API_URL}/pipelines?${params}`);
            setRuns(r.data);
        } finally {
            setLoading(false);
        }
    }, [projectId]);
    useEffect(() => {
        fetchRuns();
        if (autoRefreshMs > 0) {
            const t = setInterval(fetchRuns, autoRefreshMs);
            return () => clearInterval(t);
        }
    }, [fetchRuns, autoRefreshMs]);
    return { runs, loading, refetch: fetchRuns };
}

/**
 * Generic incremental log poller. `path` is the endpoint relative to a run
 * (e.g. 'deployment/logs' or 'sandbox-logs'). Resets when run_id or path
 * changes.
 */
function useIncrementalLog(runId: string | null, path: string, enabled: boolean) {
    const [content, setContent] = useState('');
    const offsetRef = useRef(0);
    useEffect(() => {
        if (!runId || !enabled) return;
        offsetRef.current = 0;
        setContent('');
        let cancelled = false;
        async function tick() {
            if (cancelled) return;
            try {
                const r = await axios.get(`${API_URL}/pipelines/${runId}/${path}`, {
                    params: { from: offsetRef.current },
                });
                if (cancelled) return;
                const data = r.data as { content: string; offset: number; size: number };
                if (data.content) {
                    setContent(prev => (prev + data.content).slice(-200_000));
                }
                offsetRef.current = data.offset;
            } catch { /* keep polling */ }
        }
        tick();
        const t = setInterval(tick, 1500);
        return () => { cancelled = true; clearInterval(t); };
    }, [runId, path, enabled]);
    return content;
}

export function useDeploymentLogs(runId: string | null, enabled: boolean) {
    return useIncrementalLog(runId, 'deployment/logs', enabled);
}

export function useSandboxLogs(runId: string | null, enabled: boolean) {
    return useIncrementalLog(runId, 'sandbox-logs', enabled);
}

export function useFixAgentLog(runId: string | null, enabled: boolean) {
    return useIncrementalLog(runId, 'deployment/fix-agent-log', enabled);
}

export interface CreatePRsResult {
    created: Array<{ ticket_id: string; title: string; pr_url: string; pr_number: number; branch_name: string; reused: boolean }>;
    skipped: Array<{ ticket_id: string; reason: string }>;
    failed: Array<{ ticket_id: string; error: string }>;
}

export interface DeployFileChange {
    path: string;
    new_content: string;
    explanation: string;
}

export interface DeployDiagnosis {
    error_type: string;
    summary: string;
    detail: string;
    strategy: string;
    strategy_label: string;
    strategy_description: string;
    file_changes: DeployFileChange[];
    log_excerpt: string;
}

export function useDiagnoseDeployError() {
    const [loading, setLoading] = useState(false);
    const diagnose = useCallback(async (runId: string): Promise<DeployDiagnosis> => {
        setLoading(true);
        try {
            const r = await axios.get(`${API_URL}/pipelines/${runId}/diagnose-deploy`);
            return r.data as DeployDiagnosis;
        } finally {
            setLoading(false);
        }
    }, []);
    return { diagnose, loading };
}

export function useFixWithDeployError() {
    const [loading, setLoading] = useState(false);
    const fix = useCallback(async (runId: string, strategy: string, fileChanges?: DeployFileChange[]) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/fix-with-deploy-error`, {
                strategy,
                file_changes: fileChanges ?? [],
            });
            return r.data as { status: 'started'; log_excerpt: string };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to fix');
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { fix, loading };
}

export function useCreatePRs() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const createPRs = useCallback(async (runId: string) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/create-prs`);
            setError(null);
            return r.data as CreatePRsResult;
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to create PRs');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { createPRs, loading, error };
}

export function useDeployControls() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const deploy = useCallback(async (runId: string) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/deploy`);
            setError(null);
            return r.data as Deployment;
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to deploy');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    const stop = useCallback(async (runId: string) => {
        setLoading(true);
        try {
            await axios.delete(`${API_URL}/pipelines/${runId}/deploy`);
            setError(null);
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to stop');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { deploy, stop, loading, error };
}

export function useRunVerification() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const verify = useCallback(async (runId: string) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/deployment/verify`);
            setError(null);
            return r.data as { queued: boolean };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to verify');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { verify, loading, error };
}

export function useRerunPipeline() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rerun = useCallback(async (runId: string) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/rerun`);
            setError(null);
            return r.data as { run_id: string };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to rerun');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { rerun, loading, error };
}

export function useRerunStage() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rerunStage = useCallback(async (runId: string, stage: Stage) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/stages/${stage}/rerun`);
            setError(null);
            return r.data as { status: 'started' };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to rerun stage');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { rerunStage, loading, error };
}

export function useRetryTicket() {
    const [loading, setLoading] = useState<string | null>(null); // stores ticket_id while loading
    const retryTicket = useCallback(async (runId: string, ticketId: string) => {
        setLoading(ticketId);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/implementation/retry-ticket/${ticketId}`);
            return r.data as { status: 'started' };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to retry');
            throw new Error(msg);
        } finally {
            setLoading(null);
        }
    }, []);
    return { retryTicket, loading };
}

export function useRequirementsClarify() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = useCallback(async (
        runId: string,
        answers: Record<string, string>,
        opts: { force_proceed?: boolean } = {},
    ) => {
        setLoading(true);
        try {
            const r = await axios.post(
                `${API_URL}/pipelines/${runId}/stages/requirements/clarify`,
                { answers, force_proceed: opts.force_proceed === true },
            );
            setError(null);
            return r.data as { status: StageStatusName; open_questions: string[]; round: number };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to submit clarification');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { submit, loading, error };
}

export function useSyncRequirementsFromSharePoint() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const sync = useCallback(async (runId: string) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/pipelines/${runId}/stages/requirements/sync-sharepoint`);
            setError(null);
            return r.data as { artifact_url: string | null; open_questions_count: number; version: number };
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'failed to sync from SharePoint');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { sync, loading, error };
}

/** Subscribes to the SSE stream and exposes the live run snapshot. */
export function usePipelineRun(runId: string | null) {
    const [run, setRun] = useState<PipelineRun | null>(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const esRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!runId) {
            setRun(null);
            return;
        }
        const url = `${API_URL}/pipelines/${runId}/events`;
        const es = new EventSource(url);
        esRef.current = es;
        es.addEventListener('snapshot', (e: MessageEvent) => {
            try { setRun(JSON.parse(e.data)); } catch { /* ignore */ }
        });
        es.onopen = () => { setConnected(true); setError(null); };
        es.onerror = () => {
            setConnected(false);
            setError('SSE connection error');
            // browser auto-reconnects; we just surface state
        };
        return () => {
            es.close();
            esRef.current = null;
            setConnected(false);
        };
    }, [runId]);

    const decide = useCallback(async (stage: Stage, decision: 'approved' | 'rejected', reason?: string) => {
        if (!runId) return;
        await axios.post(`${API_URL}/pipelines/${runId}/stages/${stage}/decision`, { decision, reason });
    }, [runId]);

    return { run, connected, error, decide };
}

export class StageApprovedError extends Error {
    code = 'stage_approved' as const;
    constructor(message: string) {
        super(message);
        this.name = 'StageApprovedError';
    }
}

function throwIfApproved(err: unknown): never {
    if (axios.isAxiosError(err) && err.response?.status === 409 && err.response.data?.error === 'stage_approved') {
        throw new StageApprovedError(err.response.data.message ?? 'Stage already approved');
    }
    throw err;
}

export async function updatePlanArtifact(runId: string, artifactJson: object): Promise<void> {
    try {
        await axios.patch(`${API_URL}/pipelines/${runId}/stages/plan/artifact`, { artifact_json: artifactJson });
    } catch (err) { throwIfApproved(err); }
}

export async function updateDesignArtifact(runId: string, artifactJson: object): Promise<void> {
    try {
        await axios.patch(`${API_URL}/pipelines/${runId}/stages/design/artifact`, { artifact_json: artifactJson });
    } catch (err) { throwIfApproved(err); }
}

export async function updateRequirementsArtifact(runId: string, artifactJson: object): Promise<void> {
    try {
        await axios.patch(`${API_URL}/pipelines/${runId}/stages/requirements/artifact`, { artifact_json: artifactJson });
    } catch (err) { throwIfApproved(err); }
}

// ── Change Requests ────────────────────────────────────────────────────────

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

export async function createChangeRequest(
    runId: string,
    stage: Stage,
    artifactJson: object,
    createdBy?: string,
): Promise<ChangeRequest> {
    const res = await axios.post(`${API_URL}/pipelines/${runId}/change-requests`, {
        stage,
        artifact_json: artifactJson,
        created_by: createdBy,
    });
    return res.data;
}

export function useChangeRequests(runId: string | null) {
    const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(false);

    const fetch = useCallback(async () => {
        if (!runId) return;
        setLoading(true);
        try {
            const res = await axios.get<ChangeRequest[]>(`${API_URL}/pipelines/${runId}/change-requests`);
            setChangeRequests(res.data);
        } catch {
            // non-fatal
        } finally {
            setLoading(false);
        }
    }, [runId]);

    useEffect(() => { fetch(); }, [fetch]);

    return { changeRequests, loading, refetch: fetch };
}

export async function applyChangeRequest(crId: string): Promise<{ run_id: string }> {
    const res = await axios.post(`${API_URL}/change-requests/${crId}/apply`);
    return res.data;
}

export async function dismissChangeRequest(crId: string): Promise<void> {
    await axios.patch(`${API_URL}/change-requests/${crId}`, { status: 'dismissed' });
}

export async function updateDesignPreferences(runId: string, prefs: DesignPreferences): Promise<void> {
    await axios.patch(`${API_URL}/pipelines/${runId}/design-preferences`, { design_preferences: prefs });
}
