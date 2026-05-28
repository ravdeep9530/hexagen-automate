import { Router } from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';

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
                   p.repo_url, p.jira_project_key, p.figma_file_key,
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
    const { name, slug, description, repo_url, jira_project_key, figma_file_key } =
        req.body as { name?: string; slug?: string; description?: string; repo_url?: string; jira_project_key?: string; figma_file_key?: string };
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const orgCheck = await pool.query(`SELECT id FROM organizations WHERE id = $1`, [req.params.orgId]);
    if (!orgCheck.rows.length) return res.status(404).json({ error: 'Organization not found' });
    const finalSlug = slug?.trim() || toSlug(name.trim());
    try {
        const r = await pool.query<{ uuid: string } & Omit<Project, 'id'>>(`
            INSERT INTO projects (name, slug, description, org_id, repo_url, jira_project_key, figma_file_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING uuid AS id, org_id, name, slug, description, repo_url,
                      jira_project_key, figma_file_key,
                      COALESCE(config, '{}')::jsonb AS config, created_at, updated_at
        `, [name.trim(), finalSlug, description?.trim() || null, req.params.orgId,
            repo_url?.trim() || null, jira_project_key?.trim() || null, figma_file_key?.trim() || null]);
        res.status(201).json(r.rows[0]);
    } catch (err: any) {
        console.error('[orgsRouter] POST /orgs/:orgId/projects', err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

orgsRouter.get('/orgs/:orgId/projects/:projId', async (req, res) => {
    try {
        const r = await pool.query<Project>(`
            SELECT p.uuid AS id, p.org_id, p.name, p.slug, p.description,
                   p.repo_url, p.jira_project_key, p.figma_file_key,
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
