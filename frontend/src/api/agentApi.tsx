import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

// Agent Types
export type AgentType =
    | 'requirements'
    | 'sprint'
    | 'test-automation'
    | 'mock-generation'
    | 'code-review'
    | 'documentation';

export interface Agent {
    id: string;
    name: string;
    type: AgentType;
    status: 'active' | 'inactive' | 'error';
    description: string;
    lastPing: string;
}

// Requirements Agent
export interface RequirementsResponse {
    userStories: Array<{
        id: string;
        title: string;
        description: string;
        acceptanceCriteria: string[];
        priority: 'high' | 'medium' | 'low';
    }>;
    gaps: string[];
    ambiguities: string[];
    suggestions: string[];
}

// Sprint Agent
export interface SprintPlanResponse {
    tasks: Array<{
        id: string;
        title: string;
        description: string;
        estimatedHours: number;
        dependencies: string[];
        risk: 'low' | 'medium' | 'high';
    }>;
    criticalPath: string[];
    riskAssessment: string[];
    recommendedSprintScope: string;
}

// Test Agent
export interface TestGenerationResponse {
    testCases: Array<{
        name: string;
        code: string;
        type: 'unit' | 'integration' | 'e2e';
        description: string;
    }>;
    coverageEstimate: number;
    edgeCases: string[];
}

// Mock Agent
export interface MockGenerationResponse {
    html: string;
    css: string;
    components: Array<{
        name: string;
        code: string;
    }>;
}

// Code Review Agent
export interface CodeReviewResponse {
    issues: Array<{
        severity: 'critical' | 'warning' | 'info';
        message: string;
        suggestion: string;
        category: string;
    }>;
    score: number;
    summary: string;
}

// Documentation Agent
export interface DocumentationResponse {
    content: string;
    format: string;
    sections: string[];
}

// API Hooks
export const useAgents = () => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchAgents = useCallback(async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/api/agents`);
            setAgents(response.data);
            setError(null);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAgents();
        const interval = setInterval(fetchAgents, 10000);
        return () => clearInterval(interval);
    }, [fetchAgents]);

    return { agents, loading, error, refetch: fetchAgents };
};

export const useRequirementsAgent = () => {
    const [result, setResult] = useState<RequirementsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const optimize = useCallback(async (rawRequirements: string, projectContext?: string) => {
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/api/requirements/optimize`, {
                rawRequirements,
                projectContext
            });
            setResult(response.data);
            setError(null);
            return response.data;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { result, loading, error, optimize };
};

export const useSprintAgent = () => {
    const [result, setResult] = useState<SprintPlanResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const plan = useCallback(async (epicDescription: string, teamCapacity: number, sprintDuration: number) => {
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/api/sprints/plan`, {
                epicDescription,
                teamCapacity,
                sprintDuration
            });
            setResult(response.data);
            setError(null);
            return response.data;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { result, loading, error, plan };
};

export const useTestAgent = () => {
    const [result, setResult] = useState<TestGenerationResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const generate = useCallback(async (codeSnippet: string, testFramework: string) => {
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/api/tests/generate`, {
                codeSnippet,
                testFramework
            });
            setResult(response.data);
            setError(null);
            return response.data;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { result, loading, error, generate };
};

export const useMockAgent = () => {
    const [result, setResult] = useState<MockGenerationResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const generate = useCallback(async (description: string, platform: string, framework: string) => {
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/api/mocks/generate`, {
                description,
                platform,
                framework
            });
            setResult(response.data);
            setError(null);
            return response.data;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { result, loading, error, generate };
};

export const useCodeReviewAgent = () => {
    const [result, setResult] = useState<CodeReviewResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const analyze = useCallback(async (code: string, language: string) => {
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/api/review/analyze`, {
                code,
                language
            });
            setResult(response.data);
            setError(null);
            return response.data;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { result, loading, error, analyze };
};

export const useDocsAgent = () => {
    const [result, setResult] = useState<DocumentationResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const generate = useCallback(async (code: string, type: string, audience: string) => {
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/api/docs/generate`, {
                code,
                type,
                audience
            });
            setResult(response.data);
            setError(null);
            return response.data;
        } catch (err) {
            setError(err as Error);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { result, loading, error, generate };
};

// Integration Types
export interface IntegrationConnection {
    id: string;
    type: 'github' | 'sharepoint' | 'azure_devops' | 'slack' | 'teams';
    name: string;
    config: Record<string, unknown>;
    status: 'active' | 'inactive' | 'error';
    lastSyncAt?: string;
    createdAt: string;
}

export interface GitHubRepo {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    default_branch: string;
    language: string | null;
}

export interface GitHubPR {
    number: number;
    title: string;
    state: string;
    html_url: string;
    user: { login: string };
    created_at: string;
    head: { ref: string; sha: string };
    base: { ref: string };
}

export interface SharePointSite {
    id: string;
    name: string;
    webUrl: string;
    displayName: string;
}

export interface SharePointDocument {
    id: string;
    name: string;
    webUrl: string;
    size: number;
    lastModifiedDateTime: string;
}

// Integration Hooks
export const useIntegrations = (orgId?: string | null) => {
    const [connections, setConnections] = useState<IntegrationConnection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchConnections = useCallback(async () => {
        if (!orgId) { setConnections([]); return; }
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/orgs/${orgId}/integrations`);
            setConnections(response.data);
        } catch (err) {
            setError('Failed to fetch integrations');
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    const createConnection = useCallback(async (connection: Omit<IntegrationConnection, 'id' | 'createdAt'>) => {
        if (!orgId) throw new Error('No active organization');
        const response = await axios.post(`${API_URL}/orgs/${orgId}/integrations`, connection);
        setConnections(prev => [response.data, ...prev]);
        return response.data;
    }, [orgId]);

    const deleteConnection = useCallback(async (id: string) => {
        if (!orgId) throw new Error('No active organization');
        await axios.delete(`${API_URL}/orgs/${orgId}/integrations/${id}`);
        setConnections(prev => prev.filter(c => c.id !== id));
    }, [orgId]);

    const testConnection = useCallback(async (id: string) => {
        if (!orgId) throw new Error('No active organization');
        const response = await axios.post(`${API_URL}/orgs/${orgId}/integrations/${id}/test`);
        return response.data as { success: boolean; message: string };
    }, [orgId]);

    useEffect(() => {
        fetchConnections();
    }, [fetchConnections]);

    return { connections, loading, error, fetchConnections, createConnection, deleteConnection, testConnection };
};

export interface TrackedPR {
    id: string;
    connection_id: string;
    connection_name?: string;
    repo_owner: string;
    repo_name: string;
    pr_number: number;
    title: string;
    author: string;
    branch: string;
    base_branch: string;
    state: string;
    html_url: string;
    github_sha: string;
    ai_review: any;
    ai_review_status: string;
    last_sync_at: string;
    created_at: string;
    saved_for_later?: boolean;
    diff_patch?: string | null;
    last_reviewed_at?: string | null;
}

export interface PRReviewComment {
    id: string;
    tracked_pr_id: string;
    file_path: string | null;
    line_number: number | null;
    start_line?: number | null;
    body: string;
    severity: string;
    is_posted: boolean;
    github_comment_id: string | null;
    code_snippet?: string | null;
    replacement_code?: string | null;
    feedback?: 'accepted' | 'rejected' | null;
    feedback_at?: string | null;
    created_at: string;
}

export interface ScheduledReview {
    id: string;
    connection_id: string;
    connection_name?: string;
    repo_owner: string | null;
    repo_name: string | null;
    interval_minutes: number;
    enabled: boolean;
    scope: string;
    repos: Array<{ owner: string; name: string }>;
    last_run_at: string | null;
    next_run_at: string | null;
    created_at: string;
    agent_id?: number;
    agent_name?: string;
}

export interface SchedulerRun {
    id: string;
    schedule_id: string;
    connection_id: string;
    connection_name?: string;
    repo_owner: string | null;
    repo_name: string | null;
    pr_number: number | null;
    action: string;
    status: string;
    message: string | null;
    created_at: string;
}

export const useGitHubIntegration = (connectionId?: string) => {
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [prs, setPrs] = useState<GitHubPR[]>([]);
    const [trackedPRs, setTrackedPRs] = useState<TrackedPR[]>([]);
    const [reviewComments, setReviewComments] = useState<PRReviewComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchRepos = useCallback(async () => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/integrations/github/${connectionId}/repos`);
            setRepos(response.data);
        } catch (err) {
            setError('Failed to fetch repositories');
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const fetchPRs = useCallback(async (owner: string, repo: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/integrations/github/${connectionId}/repos/${owner}/${repo}/pulls`);
            setPrs(response.data);
        } catch (err) {
            setError('Failed to fetch pull requests');
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const reviewPR = useCallback(async (owner: string, repo: string, pullNumber: number) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.post(
                `${API_URL}/integrations/github/${connectionId}/repos/${owner}/${repo}/pulls/${pullNumber}/review`
            );
            return response.data;
        } catch (err) {
            setError('Failed to review pull request');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const syncPRs = useCallback(async (owner: string, repo: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.post(
                `${API_URL}/integrations/github/${connectionId}/repos/${owner}/${repo}/sync-prs`
            );
            return response.data;
        } catch (err) {
            setError('Failed to sync pull requests');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const fetchTrackedPRs = useCallback(async (owner?: string, repo?: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (owner) params.append('owner', owner);
            if (repo) params.append('repo', repo);
            const response = await axios.get(
                `${API_URL}/integrations/github/${connectionId}/tracked-prs?${params.toString()}`
            );
            setTrackedPRs(response.data);
        } catch (err) {
            setError('Failed to fetch tracked pull requests');
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const reviewTrackedPR = useCallback(async (prId: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.post(
                `${API_URL}/integrations/github/${connectionId}/tracked-prs/${prId}/review`
            );
            return response.data;
        } catch (err) {
            setError('Failed to review tracked PR');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const addReviewComment = useCallback(async (prId: string, comment: { filePath?: string; lineNumber?: number; body: string; severity?: string }) => {
        if (!connectionId) return;
        try {
            const response = await axios.post(
                `${API_URL}/integrations/github/${connectionId}/tracked-prs/${prId}/comments`,
                comment
            );
            return response.data;
        } catch (err) {
            setError('Failed to add review comment');
            throw err;
        }
    }, [connectionId]);

    const fetchReviewComments = useCallback(async (prId: string) => {
        if (!connectionId) return;
        setReviewComments([]);
        try {
            const response = await axios.get(
                `${API_URL}/integrations/github/${connectionId}/tracked-prs/${prId}/comments`
            );
            setReviewComments(response.data);
        } catch (err) {
            setError('Failed to fetch review comments');
        }
    }, [connectionId]);

    const publishComments = useCallback(async (prId: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.post(
                `${API_URL}/integrations/github/${connectionId}/tracked-prs/${prId}/publish`
            );
            return response.data;
        } catch (err) {
            setError('Failed to publish comments');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const toggleSavedForLater = useCallback(async (prId: string, saved: boolean) => {
        if (!connectionId) return;
        try {
            await axios.post(
                `${API_URL}/integrations/github/${connectionId}/tracked-prs/${prId}/save`,
                { saved }
            );
            setTrackedPRs(prev => prev.map(p => p.id === prId ? { ...p, saved_for_later: saved } : p));
        } catch (err) {
            setError('Failed to update save state');
        }
    }, [connectionId]);

    return {
        repos, prs, trackedPRs, reviewComments,
        loading, error,
        fetchRepos, fetchPRs, reviewPR,
        syncPRs, fetchTrackedPRs, reviewTrackedPR,
        addReviewComment, fetchReviewComments, publishComments,
        toggleSavedForLater,
    };
};

// Global hook: open PRs across all connections + scheduled reviews CRUD
export const useGlobalPRView = () => {
    const [allOpenPRs, setAllOpenPRs] = useState<TrackedPR[]>([]);
    const [schedules, setSchedules] = useState<ScheduledReview[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchAllOpenPRs = useCallback(async (savedOnly = false) => {
        setLoading(true);
        try {
            const response = await axios.get(
                `${API_URL}/integrations/github/all-open-prs${savedOnly ? '?savedOnly=true' : ''}`
            );
            setAllOpenPRs(response.data);
        } finally {
            setLoading(false);
        }
    }, []);

    const syncAll = useCallback(async () => {
        const response = await axios.post(`${API_URL}/integrations/github/sync-all`);
        await fetchAllOpenPRs(false);
        return response.data as { repoCount: number; prCount: number; errors: string[] };
    }, [fetchAllOpenPRs]);

    const fetchReposForConnection = useCallback(async (connectionId: string): Promise<GitHubRepo[]> => {
        const response = await axios.get(`${API_URL}/integrations/github/${connectionId}/repos`);
        return response.data;
    }, []);

    const reviewPRByConnection = useCallback(async (pr: TrackedPR) => {
        const response = await axios.post(
            `${API_URL}/integrations/github/${pr.connection_id}/tracked-prs/${pr.id}/review`
        );
        return response.data;
    }, []);

    const fetchCommentsForPR = useCallback(async (pr: TrackedPR): Promise<PRReviewComment[]> => {
        const response = await axios.get(
            `${API_URL}/integrations/github/${pr.connection_id}/tracked-prs/${pr.id}/comments`
        );
        return response.data;
    }, []);

    const publishPRComments = useCallback(async (pr: TrackedPR) => {
        const response = await axios.post(
            `${API_URL}/integrations/github/${pr.connection_id}/tracked-prs/${pr.id}/publish`
        );
        return response.data;
    }, []);

    const addCommentToPR = useCallback(async (pr: TrackedPR, comment: { filePath?: string; lineNumber?: number; body: string; severity?: string }) => {
        const response = await axios.post(
            `${API_URL}/integrations/github/${pr.connection_id}/tracked-prs/${pr.id}/comments`,
            comment
        );
        return response.data;
    }, []);

    const submitCommentFeedback = useCallback(async (commentId: string, feedback: 'accepted' | 'rejected' | null, notes?: string) => {
        await axios.post(
            `${API_URL}/integrations/github/comments/${commentId}/feedback`,
            { feedback, notes }
        );
    }, []);

    const fetchSchedules = useCallback(async () => {
        const response = await axios.get(`${API_URL}/integrations/scheduled-reviews`);
        setSchedules(response.data);
    }, []);

    const saveSchedule = useCallback(async (input: {
        connectionId: string;
        repoOwner?: string;
        repoName?: string;
        intervalMinutes: number;
        enabled: boolean;
        scope?: string;
        repos?: Array<{ owner: string; name: string }>;
    }) => {
        await axios.post(`${API_URL}/integrations/scheduled-reviews`, input);
        await fetchSchedules();
    }, [fetchSchedules]);

    const deleteSchedule = useCallback(async (id: string) => {
        await axios.delete(`${API_URL}/integrations/scheduled-reviews/${id}`);
        await fetchSchedules();
    }, [fetchSchedules]);

    const toggleSavedGlobal = useCallback(async (pr: TrackedPR, saved: boolean) => {
        await axios.post(
            `${API_URL}/integrations/github/${pr.connection_id}/tracked-prs/${pr.id}/save`,
            { saved }
        );
        setAllOpenPRs(prev => prev.map(p => p.id === pr.id ? { ...p, saved_for_later: saved } : p));
    }, []);

    const fetchSchedulerRuns = useCallback(async (scheduleId?: string, limit = 100): Promise<SchedulerRun[]> => {
        const params = new URLSearchParams();
        if (scheduleId) params.append('scheduleId', scheduleId);
        params.append('limit', String(limit));
        const response = await axios.get(`${API_URL}/integrations/scheduler-runs?${params.toString()}`);
        return response.data;
    }, []);

    return {
        allOpenPRs, schedules, loading,
        fetchAllOpenPRs, syncAll, fetchReposForConnection,
        reviewPRByConnection, fetchCommentsForPR, publishPRComments, addCommentToPR,
        submitCommentFeedback,
        fetchSchedules, saveSchedule, deleteSchedule, toggleSavedGlobal,
        fetchSchedulerRuns,
    };
};
export const useSharePointIntegration = (connectionId?: string) => {
    const [sites, setSites] = useState<SharePointSite[]>([]);
    const [documents, setDocuments] = useState<SharePointDocument[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchSites = useCallback(async () => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/integrations/sharepoint/${connectionId}/sites`);
            setSites(response.data);
        } catch (err) {
            setError('Failed to fetch SharePoint sites');
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const fetchDocuments = useCallback(async (driveId: string, folderPath?: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const params = folderPath ? `?folder=${encodeURIComponent(folderPath)}` : '';
            const response = await axios.get(
                `${API_URL}/integrations/sharepoint/${connectionId}/drives/${driveId}/documents${params}`
            );
            setDocuments(response.data);
        } catch (err) {
            setError('Failed to fetch documents');
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    const extractRequirements = useCallback(async (driveId: string, itemId: string, projectContext?: string) => {
        if (!connectionId) return;
        setLoading(true);
        try {
            const response = await axios.post(
                `${API_URL}/integrations/sharepoint/${connectionId}/drives/${driveId}/items/${itemId}/extract-requirements`,
                { projectContext }
            );
            return response.data as RequirementsResponse;
        } catch (err) {
            setError('Failed to extract requirements');
            throw err;
        } finally {
            setLoading(false);
        }
    }, [connectionId]);

    return { sites, documents, loading, error, fetchSites, fetchDocuments, extractRequirements };
};

// ── Notification Settings ────────────────────────────────────────────────────

export type NotificationTrigger =
    | 'stage_approval'
    | 'pipeline_complete'
    | 'pipeline_rejected';

export type NotificationContextField =
    | 'artifact_summary'
    | 'stage_details'
    | 'run_id'
    | 'pr_link';

export interface TeamsNotifConfig {
    webhook_url?: string;
}

export interface EmailNotifConfig {
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    smtp_user?: string;
    smtp_pass?: string;
    recipients?: string[];
}

export interface NotificationSettings {
    channel: 'teams' | 'email';
    enabled: boolean;
    config: TeamsNotifConfig | EmailNotifConfig;
    triggers: NotificationTrigger[];
    context_fields: NotificationContextField[];
    updated_at?: string;
}

export const useNotificationSettings = () => {
    const [settings, setSettings] = useState<Record<string, NotificationSettings | null>>({ teams: null, email: null });
    const [loading, setLoading]   = useState(false);
    const [error,   setError]     = useState<string | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get<Record<string, NotificationSettings | null>>(
                `${API_URL}/notifications/settings`
            );
            setSettings(res.data);
        } catch {
            setError('Failed to load notification settings');
        } finally {
            setLoading(false);
        }
    }, []);

    const save = useCallback(async (
        channel: 'teams' | 'email',
        patch: Partial<NotificationSettings>
    ) => {
        const res = await axios.put<NotificationSettings>(
            `${API_URL}/notifications/settings/${channel}`, patch
        );
        setSettings(prev => ({ ...prev, [channel]: res.data }));
        return res.data;
    }, []);

    const test = useCallback(async (
        channel: 'teams' | 'email',
        configOverride: TeamsNotifConfig | EmailNotifConfig
    ) => {
        const res = await axios.post<{ success: boolean; message: string }>(
            `${API_URL}/notifications/settings/${channel}/test`,
            { config: configOverride }
        );
        return res.data;
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    return { settings, loading, error, save, test, fetchAll };
};
