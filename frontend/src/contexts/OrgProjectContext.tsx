import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import type { Organization, Project } from '../api/orgsApi';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const LS_ORG_KEY  = 'sdlc_active_org_id';
const LS_PROJ_KEY = 'sdlc_active_project_id';

interface OrgProjectContextValue {
    orgs: Organization[];
    projects: Project[];
    activeOrg: Organization | null;
    activeProject: Project | null;
    setActiveOrg: (org: Organization) => void;
    setActiveProject: (project: Project) => void;
    loading: boolean;
    refetchOrgs: () => Promise<void>;
    refetchProjects: () => Promise<void>;
}

const OrgProjectContext = createContext<OrgProjectContextValue>({
    orgs: [],
    projects: [],
    activeOrg: null,
    activeProject: null,
    setActiveOrg: () => {},
    setActiveProject: () => {},
    loading: true,
    refetchOrgs: async () => {},
    refetchProjects: async () => {},
});

export const OrgProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [orgs, setOrgs] = useState<Organization[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeOrg, setActiveOrgState] = useState<Organization | null>(null);
    const [activeProject, setActiveProjectState] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchProjects = useCallback(async (org: Organization | null): Promise<Project[]> => {
        if (!org) return [];
        const r = await axios.get(`${API_URL}/orgs/${org.id}/projects`);
        const data: Project[] = r.data;
        return data;
    }, []);

    const fetchOrgs = useCallback(async (): Promise<Organization[]> => {
        const r = await axios.get(`${API_URL}/orgs`);
        const data: Organization[] = r.data;
        return data;
    }, []);

    const refetchOrgs = useCallback(async () => {
        const data = await fetchOrgs();
        setOrgs(data);
        const savedOrgId = localStorage.getItem(LS_ORG_KEY);
        const org = data.find(o => o.id === savedOrgId) ?? data[0] ?? null;
        setActiveOrgState(org);
        if (org) {
            const projs = await fetchProjects(org);
            setProjects(projs);
            const savedProjId = localStorage.getItem(LS_PROJ_KEY);
            const proj = projs.find(p => p.id === savedProjId) ?? projs[0] ?? null;
            setActiveProjectState(proj);
        }
    }, [fetchOrgs, fetchProjects]);

    const refetchProjects = useCallback(async () => {
        if (!activeOrg) return;
        const projs = await fetchProjects(activeOrg);
        setProjects(projs);
        const savedProjId = localStorage.getItem(LS_PROJ_KEY);
        const proj = projs.find(p => p.id === savedProjId) ?? projs[0] ?? null;
        setActiveProjectState(proj);
    }, [activeOrg, fetchProjects]);

    useEffect(() => {
        setLoading(true);
        refetchOrgs().finally(() => setLoading(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const setActiveOrg = useCallback((org: Organization) => {
        setActiveOrgState(org);
        localStorage.setItem(LS_ORG_KEY, org.id);
        fetchProjects(org).then(projs => {
            setProjects(projs);
            const first = projs[0] ?? null;
            setActiveProjectState(first);
            if (first) localStorage.setItem(LS_PROJ_KEY, first.id);
            else localStorage.removeItem(LS_PROJ_KEY);
        }).catch(console.error);
    }, [fetchProjects]);

    const setActiveProject = useCallback((project: Project) => {
        setActiveProjectState(project);
        localStorage.setItem(LS_PROJ_KEY, project.id);
    }, []);

    return (
        <OrgProjectContext.Provider value={{
            orgs, projects,
            activeOrg, activeProject,
            setActiveOrg, setActiveProject,
            loading,
            refetchOrgs,
            refetchProjects,
        }}>
            {children}
        </OrgProjectContext.Provider>
    );
};

export const useOrgProject = () => useContext(OrgProjectContext);
