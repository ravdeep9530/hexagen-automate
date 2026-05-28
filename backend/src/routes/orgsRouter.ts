import { Router } from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { githubService } from '../services/githubService';
import { repoAnalysisService, parseOwnerRepo } from '../services/repoAnalysisService';
import { integrationService } from '../services/integrationService';

dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});

export const orgsRouter = Router();

interface Organization {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    project_count?: number;
}

interface Project {
    id: string; // uuid column
    org_id: string;
    name: string;
    slug: string | null;
    description: string | null;
    repo_url: string | null;
    github_connection_id: string | null;
    project_type: 'new' | 'existing';
    jira_project_key: string | null;
    figma_file_key: string | null;
    config: Record<string, unknown>;
    created_at: string;
    updated_at: string | null;
    pipeline_count?: number;
    repo_count?: number;
}

function toSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── Organizations ────────────────────────────────────────────────────────────

orgsRouter.get('/orgs', async (_req, res) => {
    try {
        const r = await pool.query<Organization & { project_count: string }>(`
            SELECT o.id, o.name, o.slug, o.description, o.created_at, o.updated_at,
                   COUNT(p.uuid)::int AS project_count
            FROM organizations o
            LEFT JOIN projects p ON p.org_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at ASC
        `);
        res.json(r.rows.map(row => ({ ...row, project_count: Number(row.project_count) })));
    } catch (err) {
        console.error('[orgsRouter] GET /orgs', err);
        res.status(500).json({ error: 'Failed to fetch organizations' });
    }
});

orgsRouter.post('/orgs', async (req, res) => {
    const { name, slug, description } = req.body as { name?: string; slug?: string; description?: string };
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const finalSlug = slug?.trim() || toSlug(name.trim());
    try {
        const r = await pool.query<Organization>(
            `INSERT INTO organizations (name, slug, description)
             VALUES ($1, $2, $3) RETURNING *`,
            [name.trim(), finalSlug, description?.trim() || null]
        );
        res.status(201).json(r.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') return res.status(409).json({ error: `Slug "${finalSlug}" is already taken` });
        console.error('[orgsRouter] POST /orgs', err);
        res.status(500).json({ error: 'Failed to create organization' });
    }
});

orgsRouter.get('/orgs/:orgId', async (req, res) => {
    try {
        const r = await pool.query<Organization>(
            `SELECT id, name, slug, description, created_at, updated_at FROM organizations WHERE id = $1`,
            [req.params.orgId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Organization not found' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[orgsRouter] GET /orgs/:orgId', err);
        res.status(500).json({ error: 'Failed to fetch organization' });
    }
});

orgsRouter.patch('/orgs/:orgId', async (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    try {
        const r = await pool.query<Organization>(
            `UPDATE organizations
             SET name = COALESCE($1, name),
                 description = COALESCE($2, description),
                 updated_at = now()
             WHERE id = $3 RETURNING *`,
            [name?.trim() || null, description !== undefined ? (description.trim() || null) : null, req.params.orgId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Organization not found' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[orgsRouter] PATCH /orgs/:orgId', err);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

orgsRouter.delete('/orgs/:orgId', async (req, res) => {
    try {
        const check = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM projects WHERE org_id = $1`, [req.params.orgId]
        );
        if (Number(check.rows[0].cnt) > 0) {
            return res.status(409).json({ error: 'Cannot delete organization with existing projects' });
        }
        const r = await pool.query(`DELETE FROM organizations WHERE id = $1 RETURNING id`, [req.params.orgId]);
        if (!r.rows.length) return res.status(404).json({ error: 'Organization not found' });
        res.json({ deleted: true });
    } catch (err) {
        console.error('[orgsRouter] DELETE /orgs/:orgId', err);
        res.status(500).json({ error: 'Failed to delete organization' });
    }
});

// ── Projects ─────────────────────────────────────────────────────────────────

orgsRouter.get('/orgs/:orgId/projects', async (req, res) => {
    try {
        const r = await pool.query<Project>(`
            SELECT p.uuid AS id, p.org_id, p.name, p.slug, p.description,
                   p.repo_url, p.github_connection_id, COALESCE(p.project_type,'new') AS project_type,
                   p.jira_project_key, p.figma_file_key,
                   COALESCE(p.config, '{}')::jsonb AS config,
                   p.created_at, p.updated_at,
                   COUNT(DISTINCT pr.run_id)::int AS pipeline_count,
                   COUNT(DISTINCT r.id)::int AS repo_count
            FROM projects p
            LEFT JOIN pipeline_runs pr ON pr.project_id = p.uuid
            LEFT JOIN agent_repo_registry r ON r.project_id = p.uuid
            WHERE p.org_id = $1
            GROUP BY p.id
            ORDER BY p.created_at ASC
        `, [req.params.orgId]);
        res.json(r.rows);
    } catch (err) {
        console.error('[orgsRouter] GET /orgs/:orgId/projects', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

orgsRouter.post('/orgs/:orgId/projects', async (req, res) => {
    const { name, slug, description, repo_url, github_connection_id, project_type, jira_project_key, figma_file_key } =
        req.body as { name?: string; slug?: string; description?: string; repo_url?: string; github_connection_id?: string; project_type?: string; jira_project_key?: string; figma_file_key?: string };

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!repo_url?.trim()) return res.status(400).json({ error: 'repo_url is required — all projects must be linked to a GitHub repository' });
    if (!github_connection_id?.trim()) return res.status(400).json({ error: 'github_connection_id is required' });

    const orgCheck = await pool.query(`SELECT id FROM organizations WHERE id = $1`, [req.params.orgId]);
    if (!orgCheck.rows.length) return res.status(404).json({ error: 'Organization not found' });

    // Verify the GitHub connection exists and belongs to this org
    const connResult = await pool.query<{ config: { token?: string } }>(
        `SELECT config FROM integration_connections WHERE id = $1 AND type = 'github' AND org_id = $2`,
        [github_connection_id.trim(), req.params.orgId]
    );
    if (!connResult.rows.length) return res.status(400).json({ error: 'GitHub connection not found or does not belong to this organization.' });

    const token = connResult.rows[0].config?.token;
    if (!token) return res.status(400).json({ error: 'GitHub connection has no token configured' });

    // Validate GitHub access
    const validation = await githubService.testConnection({ token });
    if (!validation.success) {
        return res.status(400).json({ error: `GitHub access validation failed: ${validation.message}` });
    }

    const finalSlug = slug?.trim() || toSlug(name.trim());
    const finalType = (project_type === 'existing' ? 'existing' : 'new') as 'new' | 'existing';

    try {
        const r = await pool.query<Project>(`
            INSERT INTO projects (name, slug, description, org_id, repo_url, github_connection_id, project_type, jira_project_key, figma_file_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING uuid AS id, org_id, name, slug, description, repo_url,
                      github_connection_id, COALESCE(project_type,'new') AS project_type,
                      jira_project_key, figma_file_key,
                      COALESCE(config, '{}')::jsonb AS config, created_at, updated_at
        `, [name.trim(), finalSlug, description?.trim() || null, req.params.orgId,
            repo_url.trim(), github_connection_id.trim(), finalType,
            jira_project_key?.trim() || null, figma_file_key?.trim() || null]);

        const newProject = r.rows[0];

        // Fire async analysis for existing projects
        if (finalType === 'existing') {
            const parsed = parseOwnerRepo(repo_url.trim());
            if (parsed) {
                repoAnalysisService.analyzeRepo(newProject.id, token, parsed.owner, parsed.repo)
                    .catch(err => console.error('[orgsRouter] analyzeRepo error', err));
            }
        }

        res.status(201).json(newProject);
    } catch (err: any) {
        console.error('[orgsRouter] POST /orgs/:orgId/projects', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

orgsRouter.get('/orgs/:orgId/projects/:projId', async (req, res) => {
    try {
        const r = await pool.query<Project>(`
            SELECT p.uuid AS id, p.org_id, p.name, p.slug, p.description,
                   p.repo_url, p.github_connection_id, COALESCE(p.project_type,'new') AS project_type,
                   p.jira_project_key, p.figma_file_key,
                   COALESCE(p.config, '{}')::jsonb AS config,
                   p.created_at, p.updated_at,
                   COUNT(DISTINCT pr.run_id)::int AS pipeline_count,
                   COUNT(DISTINCT r.id)::int AS repo_count
            FROM projects p
            LEFT JOIN pipeline_runs pr ON pr.project_id = p.uuid
            LEFT JOIN agent_repo_registry r ON r.project_id = p.uuid
            WHERE p.uuid = $1 AND p.org_id = $2
            GROUP BY p.id
        `, [req.params.projId, req.params.orgId]);
        if (!r.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[orgsRouter] GET /orgs/:orgId/projects/:projId', err);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

orgsRouter.patch('/orgs/:orgId/projects/:projId', async (req, res) => {
    const { name, description, repo_url, jira_project_key, figma_file_key } =
        req.body as { name?: string; description?: string; repo_url?: string; jira_project_key?: string; figma_file_key?: string };
    try {
        const r = await pool.query<Project>(`
            UPDATE projects
            SET name             = COALESCE($1, name),
                description      = COALESCE($2, description),
                repo_url         = COALESCE($3, repo_url),
                jira_project_key = COALESCE($4, jira_project_key),
                figma_file_key   = COALESCE($5, figma_file_key),
                updated_at       = now()
            WHERE uuid = $6 AND org_id = $7
            RETURNING uuid AS id, org_id, name, slug, description, repo_url,
                      jira_project_key, figma_file_key,
                      COALESCE(config, '{}')::jsonb AS config, created_at, updated_at
        `, [name?.trim() || null, description !== undefined ? (description.trim() || null) : null,
            repo_url !== undefined ? (repo_url.trim() || null) : null,
            jira_project_key !== undefined ? (jira_project_key.trim() || null) : null,
            figma_file_key !== undefined ? (figma_file_key.trim() || null) : null,
            req.params.projId, req.params.orgId]);
        if (!r.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[orgsRouter] PATCH /orgs/:orgId/projects/:projId', err);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

orgsRouter.delete('/orgs/:orgId/projects/:projId', async (req, res) => {
    try {
        const check = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM pipeline_runs WHERE project_id = $1`, [req.params.projId]
        );
        if (Number(check.rows[0].cnt) > 0) {
            return res.status(409).json({ error: 'Cannot delete project with existing pipeline runs' });
        }
        const r = await pool.query(
            `DELETE FROM projects WHERE uuid = $1 AND org_id = $2 RETURNING uuid`,
            [req.params.projId, req.params.orgId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json({ deleted: true });
    } catch (err) {
        console.error('[orgsRouter] DELETE /orgs/:orgId/projects/:projId', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// GET overview — lightweight fetch (no join counts) for the Overview page
orgsRouter.get('/orgs/:orgId/projects/:projId/overview', async (req, res) => {
    try {
        const r = await pool.query<Project>(
            `SELECT uuid AS id, org_id, name, slug, description, repo_url,
                    github_connection_id, COALESCE(project_type,'new') AS project_type,
                    jira_project_key, figma_file_key,
                    COALESCE(config, '{}')::jsonb AS config, created_at, updated_at
             FROM projects WHERE uuid = $1 AND org_id = $2`,
            [req.params.projId, req.params.orgId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[orgsRouter] GET /orgs/:orgId/projects/:projId/overview', err);
        res.status(500).json({ error: 'Failed to fetch project overview' });
    }
});

// POST analyze — re-trigger async repo analysis for existing projects
orgsRouter.post('/orgs/:orgId/projects/:projId/analyze', async (req, res) => {
    try {
        const r = await pool.query<{ id: string; repo_url: string; project_type: string; github_connection_id: string }>(
            `SELECT uuid AS id, repo_url, COALESCE(project_type,'new') AS project_type, github_connection_id
             FROM projects WHERE uuid = $1 AND org_id = $2`,
            [req.params.projId, req.params.orgId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Project not found' });

        const proj = r.rows[0];
        if (proj.project_type !== 'existing') {
            return res.status(400).json({ error: 'Analysis is only available for existing projects' });
        }
        if (!proj.github_connection_id) {
            return res.status(400).json({ error: 'No GitHub connection linked to this project' });
        }
        if (!proj.repo_url) {
            return res.status(400).json({ error: 'No repository URL set for this project' });
        }

        const connResult = await pool.query<{ config: { token?: string } }>(
            `SELECT config FROM integration_connections WHERE id = $1 AND type = 'github' AND org_id = $2`,
            [proj.github_connection_id, req.params.orgId]
        );
        if (!connResult.rows.length) return res.status(400).json({ error: 'GitHub connection not found' });

        const token = connResult.rows[0].config?.token;
        if (!token) return res.status(400).json({ error: 'GitHub connection has no token' });

        const parsed = parseOwnerRepo(proj.repo_url);
        if (!parsed) return res.status(400).json({ error: 'Could not parse owner/repo from repo URL' });

        repoAnalysisService.analyzeRepo(proj.id, token, parsed.owner, parsed.repo)
            .catch(err => console.error('[orgsRouter] re-analyze error', err));

        res.status(202).json({ status: 'analysis_started' });
    } catch (err) {
        console.error('[orgsRouter] POST /orgs/:orgId/projects/:projId/analyze', err);
        res.status(500).json({ error: 'Failed to trigger analysis' });
    }
});

// ── Org-scoped Integration Routes ────────────────────────────────────────────

orgsRouter.get('/orgs/:orgId/integrations', async (req, res) => {
    try {
        const connections = await integrationService.getConnections(req.params.orgId);
        res.json(connections);
    } catch (err) {
        console.error('[orgsRouter] GET /orgs/:orgId/integrations', err);
        res.status(500).json({ error: 'Failed to list integrations' });
    }
});

orgsRouter.post('/orgs/:orgId/integrations', async (req, res) => {
    try {
        const orgCheck = await pool.query(`SELECT id FROM organizations WHERE id = $1`, [req.params.orgId]);
        if (!orgCheck.rows.length) return res.status(404).json({ error: 'Organization not found' });
        const connection = await integrationService.createConnection(req.body, req.params.orgId);
        res.status(201).json(connection);
    } catch (err) {
        console.error('[orgsRouter] POST /orgs/:orgId/integrations', err);
        res.status(500).json({ error: 'Failed to create integration' });
    }
});

orgsRouter.post('/orgs/:orgId/integrations/:id/test', async (req, res) => {
    try {
        const check = await pool.query(
            `SELECT id FROM integration_connections WHERE id = $1 AND org_id = $2`,
            [req.params.id, req.params.orgId]
        );
        if (!check.rows.length) return res.status(404).json({ error: 'Integration not found' });
        const result = await integrationService.testConnection(req.params.id);
        res.json(result);
    } catch (err) {
        console.error('[orgsRouter] POST /orgs/:orgId/integrations/:id/test', err);
        res.status(500).json({ error: 'Integration test failed' });
    }
});

orgsRouter.delete('/orgs/:orgId/integrations/:id', async (req, res) => {
    try {
        const success = await integrationService.deleteConnection(req.params.id, req.params.orgId);
        if (success) {
            res.status(204).send();
        } else {
            res.status(404).json({ error: 'Integration not found or does not belong to this organization' });
        }
    } catch (err) {
        console.error('[orgsRouter] DELETE /orgs/:orgId/integrations/:id', err);
        res.status(500).json({ error: 'Failed to delete integration' });
    }
});
