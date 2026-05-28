import { Client } from '@microsoft/microsoft-graph-client';

export interface SharePointConfig {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    siteUrl?: string;
}

export interface SharePointSite {
    id: string;
    name: string;
    webUrl: string;
    displayName: string;
}

export interface SharePointDrive {
    id: string;
    name: string;
    webUrl: string;
}

export interface SharePointDocument {
    id: string;
    name: string;
    webUrl: string;
    size: number;
    lastModifiedDateTime: string;
    downloadUrl?: string;
}

class SharePointService {
    private async getAccessToken(config: SharePointConfig): Promise<string> {
        const tokenEndpoint = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
        const params = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
        });

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params,
        });

        if (!response.ok) {
            throw new Error(`Token request failed: ${response.statusText}`);
        }

        const data = await response.json();
        return data.access_token;
    }

    private getClient(accessToken: string): Client {
        return Client.init({
            authProvider: (done) => done(null, accessToken),
        });
    }

    async testConnection(config: SharePointConfig): Promise<{ success: boolean; message: string }> {
        try {
            const token = await this.getAccessToken(config);
            const client = this.getClient(token);
            const sites = await client.api('/sites').top(1).get();
            return {
                success: true,
                message: `Connected to Microsoft Graph. Found ${sites.value?.length || 0} accessible sites.`,
            };
        } catch (error) {
            return {
                success: false,
                message: `SharePoint connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }

    async listSites(config: SharePointConfig): Promise<SharePointSite[]> {
        const token = await this.getAccessToken(config);
        const client = this.getClient(token);
        const response = await client.api('/sites').top(50).get();
        return (response.value || []).map((site: Record<string, unknown>) => ({
            id: site.id as string,
            name: site.name as string,
            webUrl: site.webUrl as string,
            displayName: site.displayName as string,
        }));
    }

    async listDrives(config: SharePointConfig, siteId: string): Promise<SharePointDrive[]> {
        const token = await this.getAccessToken(config);
        const client = this.getClient(token);
        const response = await client.api(`/sites/${siteId}/drives`).top(50).get();
        return (response.value || []).map((drive: Record<string, unknown>) => ({
            id: drive.id as string,
            name: drive.name as string,
            webUrl: drive.webUrl as string,
        }));
    }

    async listDocuments(config: SharePointConfig, driveId: string, folderPath?: string): Promise<SharePointDocument[]> {
        const token = await this.getAccessToken(config);
        const client = this.getClient(token);
        const path = folderPath
            ? `/drives/${driveId}/root:/${folderPath}:/children`
            : `/drives/${driveId}/root/children`;
        const response = await client.api(path).top(100).get();
        return (response.value || [])
            .filter((item: Record<string, unknown>) => item.file)
            .map((item: Record<string, unknown>) => ({
                id: item.id as string,
                name: item.name as string,
                webUrl: item.webUrl as string,
                size: item.size as number,
                lastModifiedDateTime: item.lastModifiedDateTime as string,
                downloadUrl: (item['@microsoft.graph.downloadUrl'] as string) || undefined,
            }));
    }

    async downloadDocument(config: SharePointConfig, driveId: string, itemId: string): Promise<string> {
        const token = await this.getAccessToken(config);
        const client = this.getClient(token);
        const response = await client.api(`/drives/${driveId}/items/${itemId}/content`).get();
        return typeof response === 'string' ? response : JSON.stringify(response);
    }

    /**
     * Download by drive + folder + filename (we don't know the itemId for
     * artifacts we wrote ourselves). Uses the path-addressable Graph route.
     */
    async downloadDocumentByPath(
        config: SharePointConfig,
        driveId: string,
        folderPath: string,
        fileName: string,
    ): Promise<string> {
        const token = await this.getAccessToken(config);
        // Graph's SDK returns a ReadableStream / object for /content. We bypass
        // it and hit the REST endpoint directly so we get the raw body string.
        const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderPath}/${fileName}:/content`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`SharePoint download failed (${resp.status}): ${txt.slice(0, 300)}`);
        }
        return await resp.text();
    }

    async uploadDocument(config: SharePointConfig, driveId: string, folderPath: string, fileName: string, content: string): Promise<SharePointDocument> {
        const token = await this.getAccessToken(config);
        const client = this.getClient(token);
        const response = await client
            .api(`/drives/${driveId}/root:/${folderPath}/${fileName}:/content`)
            .put(content);
        return {
            id: response.id as string,
            name: response.name as string,
            webUrl: response.webUrl as string,
            size: response.size as number,
            lastModifiedDateTime: response.lastModifiedDateTime as string,
        };
    }

    /**
     * Upload a binary file (e.g. .docx) to SharePoint via the Graph REST API.
     * The SDK's .put() serialises Buffer as JSON; we bypass it and use fetch
     * with the correct Content-Type so Word opens the file without corruption.
     */
    async uploadBinaryDocument(
        config: SharePointConfig,
        driveId: string,
        folderPath: string,
        fileName: string,
        content: Buffer,
        contentType: string,
    ): Promise<SharePointDocument> {
        const token = await this.getAccessToken(config);
        const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderPath}/${fileName}:/content`;
        const resp = await fetch(url, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': contentType,
            },
            body: new Uint8Array(content),
        });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error(`SharePoint binary upload failed (${resp.status}): ${txt.slice(0, 300)}`);
        }
        const data = await resp.json() as Record<string, unknown>;
        return {
            id: data.id as string,
            name: data.name as string,
            webUrl: data.webUrl as string,
            size: data.size as number,
            lastModifiedDateTime: data.lastModifiedDateTime as string,
        };
    }
}

export const sharepointService = new SharePointService();

/**
 * Single-tenant SharePoint config read from env. Mirrors what n8n already
 * uses for stages 2-7, so the backend uploads/downloads land in the same
 * drive + folder.
 */
export interface DefaultSharePointConfig extends SharePointConfig {
    driveId: string;
    folder: string;
}

export function getDefaultSharePointConfig(): DefaultSharePointConfig {
    const required = {
        SHAREPOINT_TENANT_ID: process.env.SHAREPOINT_TENANT_ID,
        SHAREPOINT_CLIENT_ID: process.env.SHAREPOINT_CLIENT_ID,
        SHAREPOINT_CLIENT_SECRET: process.env.SHAREPOINT_CLIENT_SECRET,
        SHAREPOINT_DRIVE_ID: process.env.SHAREPOINT_DRIVE_ID,
        SHAREPOINT_FOLDER: process.env.SHAREPOINT_FOLDER,
    };
    const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) throw new Error(`SharePoint env vars not set: ${missing.join(', ')}`);
    return {
        tenantId: required.SHAREPOINT_TENANT_ID!,
        clientId: required.SHAREPOINT_CLIENT_ID!,
        clientSecret: required.SHAREPOINT_CLIENT_SECRET!,
        driveId: required.SHAREPOINT_DRIVE_ID!,
        folder: required.SHAREPOINT_FOLDER!,
    };
}
