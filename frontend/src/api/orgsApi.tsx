import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

export interface Organization {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    project_count?: number;
}

export interface Project {
    id: string; // uuid
    org_id: string;
    name: string;
    slug: string | null;
    description: string | null;
    repo_url: string | null;
    jira_project_key: string | null;
    figma_file_key: string | null;
    config: Record<string, unknown>;
    created_at: string;
    updated_at: string | null;
    pipeline_count?: number;
    repo_count?: number;
}

// ── Orgs ─────────────────────────────────────────────────────────────────────

export function useOrgs() {
    const [orgs, setOrgs] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const r = await axios.get(`${API_URL}/orgs`);
            setOrgs(r.data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load organizations');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { fetch(); }, [fetch]);
    return { orgs, loading, error, refetch: fetch };
}

export function useCreateOrg() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const create = useCallback(async (input: { name: string; description?: string; slug?: string }) => {
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/orgs`, input);
            setError(null);
            return r.data as Organization;
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Failed to create organization');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { create, loading, error };
}

export function useUpdateOrg() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const update = useCallback(async (orgId: string, input: { name?: string; description?: string }) => {
        setLoading(true);
        try {
            const r = await axios.patch(`${API_URL}/orgs/${orgId}`, input);
            setError(null);
            return r.data as Organization;
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Failed to update organization');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { update, loading, error };
}

export function useDeleteOrg() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const remove = useCallback(async (orgId: string) => {
        setLoading(true);
        try {
            await axios.delete(`${API_URL}/orgs/${orgId}`);
            setError(null);
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Failed to delete organization');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, []);
    return { remove, loading, error };
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function useProjects(orgId: string | null) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetch = useCallback(async () => {
        if (!orgId) { setProjects([]); return; }
        setLoading(true);
        try {
            const r = await axios.get(`${API_URL}/orgs/${orgId}/projects`);
            setProjects(r.data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    }, [orgId]);
    useEffect(() => { fetch(); }, [fetch]);
    return { projects, loading, error, refetch: fetch };
}

export function useCreateProject(orgId: string | null) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const create = useCallback(async (input: {
        name: string;
        description?: string;
        slug?: string;
        repo_url?: string;
        jira_project_key?: string;
        figma_file_key?: string;
    }) => {
        if (!orgId) throw new Error('No active organization');
        setLoading(true);
        try {
            const r = await axios.post(`${API_URL}/orgs/${orgId}/projects`, input);
            setError(null);
            return r.data as Project;
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Failed to create project');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, [orgId]);
    return { create, loading, error };
}

export function useUpdateProject(orgId: string | null) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const update = useCallback(async (projId: string, input: {
        name?: string;
        description?: string;
        repo_url?: string;
        jira_project_key?: string;
        figma_file_key?: string;
    }) => {
        if (!orgId) throw new Error('No active organization');
        setLoading(true);
        try {
            const r = await axios.patch(`${API_URL}/orgs/${orgId}/projects/${projId}`, input);
            setError(null);
            return r.data as Project;
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Failed to update project');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, [orgId]);
    return { update, loading, error };
}

export function useDeleteProject(orgId: string | null) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const remove = useCallback(async (projId: string) => {
        if (!orgId) throw new Error('No active organization');
        setLoading(true);
        try {
            await axios.delete(`${API_URL}/orgs/${orgId}/projects/${projId}`);
            setError(null);
        } catch (e) {
            const msg = (e as any)?.response?.data?.error || (e instanceof Error ? e.message : 'Failed to delete project');
            setError(msg);
            throw new Error(msg);
        } finally {
            setLoading(false);
        }
    }, [orgId]);
    return { remove, loading, error };
}
