import React, { useState } from 'react';
import { useIntegrations } from '../../api/agentApi';

export const IntegrationsManager: React.FC = () => {
    const { connections, loading, error, createConnection, deleteConnection, testConnection } = useIntegrations();
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        type: 'github' as 'github' | 'sharepoint',
        name: '',
        token: '',
        tenantId: '',
        clientId: '',
        clientSecret: '',
    });
    const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const config = formData.type === 'github'
            ? { token: formData.token }
            : { tenantId: formData.tenantId, clientId: formData.clientId, clientSecret: formData.clientSecret };

        await createConnection({
            type: formData.type,
            name: formData.name,
            config,
            status: 'active',
        });
        setShowForm(false);
        setFormData({ type: 'github', name: '', token: '', tenantId: '', clientId: '', clientSecret: '' });
    };

    const handleTest = async (id: string) => {
        const result = await testConnection(id);
        setTestResult({ id, ...result });
        setTimeout(() => setTestResult(null), 5000);
    };

    return (
        <div className="integrations-manager">
            <h2>Integrations</h2>
            <p>Connect your development tools to enable AI-powered workflows across GitHub, SharePoint, and more.</p>

            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
                {showForm ? 'Cancel' : '+ Add Integration'}
            </button>

            {showForm && (
                <form onSubmit={handleSubmit} className="agent-form">
                    <div className="form-group">
                        <label>Type</label>
                        <select
                            value={formData.type}
                            onChange={e => setFormData({ ...formData, type: e.target.value as 'github' | 'sharepoint' })}
                        >
                            <option value="github">GitHub</option>
                            <option value="sharepoint">SharePoint</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            placeholder="My GitHub Connection"
                            required
                        />
                    </div>
                    {formData.type === 'github' ? (
                        <div className="form-group">
                            <label>Personal Access Token</label>
                            <input
                                type="password"
                                value={formData.token}
                                onChange={e => setFormData({ ...formData, token: e.target.value })}
                                placeholder="ghp_xxxxxxxxxxxx"
                                required
                            />
                        </div>
                    ) : (
                        <>
                            <div className="form-group">
                                <label>Tenant ID</label>
                                <input
                                    type="text"
                                    value={formData.tenantId}
                                    onChange={e => setFormData({ ...formData, tenantId: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Client ID</label>
                                <input
                                    type="text"
                                    value={formData.clientId}
                                    onChange={e => setFormData({ ...formData, clientId: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Client Secret</label>
                                <input
                                    type="password"
                                    value={formData.clientSecret}
                                    onChange={e => setFormData({ ...formData, clientSecret: e.target.value })}
                                    required
                                />
                            </div>
                        </>
                    )}
                    <button type="submit">Save Integration</button>
                </form>
            )}

            {loading && <div className="loading">Loading integrations...</div>}
            {error && <div className="error">{error}</div>}

            <div className="agent-grid" style={{ marginTop: '2rem' }}>
                {connections.map(conn => (
                    <div key={conn.id} className="agent-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>{conn.name}</h3>
                            <span className={`status-badge ${conn.status}`}>{conn.status}</span>
                        </div>
                        <p style={{ color: '#718096', fontSize: '0.875rem', margin: '0.5rem 0' }}>
                            Type: <strong>{conn.type}</strong>
                        </p>
                        <p style={{ color: '#718096', fontSize: '0.875rem', margin: '0.5rem 0' }}>
                            Created: {new Date(conn.createdAt).toLocaleDateString()}
                        </p>
                        {testResult?.id === conn.id && (
                            <div className={testResult.success ? 'suggestion-card' : 'gap-card'} style={{ margin: '0.75rem 0' }}>
                                {testResult.message}
                            </div>
                        )}
                        <div className="doc-actions" style={{ marginTop: '1rem' }}>
                            <button onClick={() => handleTest(conn.id)}>Test</button>
                            <button onClick={() => deleteConnection(conn.id)} style={{ color: '#e53e3e' }}>
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {connections.length === 0 && !loading && (
                <div className="empty-state">
                    <h3>No integrations configured</h3>
                    <p>Add your first integration to connect GitHub or SharePoint.</p>
                </div>
            )}
        </div>
    );
};
