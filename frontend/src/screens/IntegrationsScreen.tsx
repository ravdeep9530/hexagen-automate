import React from 'react';
import { I } from '../icons';
import { useIntegrations, useNotificationSettings, IntegrationConnection, NotificationSettings, NotificationTrigger, NotificationContextField, TeamsNotifConfig, EmailNotifConfig } from '../api/agentApi';
import { useOrgProject } from '../contexts/OrgProjectContext';

const GithubLogo: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#0d1117">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .3.2.66.8.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
  </svg>
);

const SharePointLogo: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle cx="9" cy="9" r="6.5" fill="#036C70"/>
    <circle cx="15.5" cy="13.5" r="5.5" fill="#1A9BA1"/>
    <circle cx="13" cy="18" r="3.5" fill="#37C6D0"/>
    <text x="6.4" y="11.4" fontFamily="-apple-system,Segoe UI,sans-serif" fontWeight="700" fontSize="6" fill="white">S</text>
  </svg>
);

const TeamsLogo: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <rect width="24" height="24" rx="4" fill="#5059C9"/>
    <text x="5" y="17" fontFamily="-apple-system,Segoe UI,sans-serif" fontWeight="800" fontSize="13" fill="white">T</text>
  </svg>
);

const EmailLogo: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="M2 7l10 7 10-7"/>
  </svg>
);

function typeLabel(type: IntegrationConnection['type']): string {
  const map: Record<string, string> = {
    github: 'GitHub App', sharepoint: 'SharePoint Online',
    azure_devops: 'Azure DevOps', slack: 'Slack', teams: 'Microsoft Teams',
  };
  return map[type] ?? type;
}

function typeLogo(type: IntegrationConnection['type'], size = 20) {
  if (type === 'github')     return <GithubLogo size={size}/>;
  if (type === 'sharepoint') return <SharePointLogo size={size}/>;
  return <I.Plug size={size}/>;
}

function relDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

const IntegrationCard: React.FC<{
  conn: IntegrationConnection;
  onTest: () => void;
  onRemove: () => void;
  testing: boolean;
}> = ({ conn, onTest, onRemove, testing }) => (
  <div className="int-card">
    <div className="int-card__hd">
      <div className="int-card__logo">{typeLogo(conn.type)}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div className="int-card__name">{conn.name}</div>
        <div className="int-card__type">{typeLabel(conn.type)}</div>
      </div>
      {conn.status === 'active'
        ? <span className="pill pill--approved"><span className="pill__dot"/> Connected</span>
        : conn.status === 'error'
          ? <span className="pill pill--failed"><span className="pill__dot"/> Error</span>
          : <span className="pill pill--skipped"><span className="pill__dot"/> Inactive</span>}
    </div>

    <dl className="int-card__meta">
      <dt>Type</dt><dd>{typeLabel(conn.type)}</dd>
      <dt>Added</dt><dd>{relDate(conn.createdAt)}</dd>
      {conn.lastSyncAt && <><dt>Last sync</dt><dd>{relDate(conn.lastSyncAt)}</dd></>}
    </dl>

    <div className="int-card__actions">
      <button className="btn btn--sm" onClick={onTest} disabled={testing}>
        <I.Refresh size={12}/> {testing ? 'Testing…' : 'Test'}
      </button>
      <button className="btn btn--sm"><I.Cog size={12}/> Configure</button>
      <button className="btn btn--ghost btn--sm" onClick={onRemove}>Disconnect</button>
    </div>
  </div>
);

// ── Notification Channel Card ─────────────────────────────────────────────

const TRIGGERS: Array<{ id: NotificationTrigger; label: string }> = [
  { id: 'stage_approval',    label: 'Stage awaiting approval' },
  { id: 'pipeline_complete', label: 'Pipeline completed' },
  { id: 'pipeline_rejected', label: 'Pipeline rejected' },
];

const CONTEXT_FIELDS: Array<{ id: NotificationContextField; label: string }> = [
  { id: 'artifact_summary', label: 'Artifact summary' },
  { id: 'stage_details',    label: 'Stage details' },
  { id: 'run_id',           label: 'Run ID' },
  { id: 'pr_link',          label: 'PR / artifact link' },
];

const DEFAULT_TRIGGERS: NotificationTrigger[]      = ['stage_approval', 'pipeline_complete', 'pipeline_rejected'];
const DEFAULT_CONTEXT:  NotificationContextField[] = ['artifact_summary', 'run_id'];

interface NotifDraft {
  enabled: boolean;
  config: TeamsNotifConfig | EmailNotifConfig;
  triggers: NotificationTrigger[];
  context_fields: NotificationContextField[];
}

function draftFromSettings(s: NotificationSettings | null, channel: 'teams' | 'email'): NotifDraft {
  return {
    enabled:        s?.enabled        ?? false,
    config:         s?.config         ?? (channel === 'email' ? { smtp_port: 587, smtp_secure: false, recipients: [] } : {}),
    triggers:       s?.triggers       ?? DEFAULT_TRIGGERS,
    context_fields: s?.context_fields ?? DEFAULT_CONTEXT,
  };
}

const NotifChannelCard: React.FC<{
  channel: 'teams' | 'email';
  settings: NotificationSettings | null;
  onSave: (patch: Partial<NotificationSettings>) => Promise<NotificationSettings>;
  onTest: (cfg: TeamsNotifConfig | EmailNotifConfig) => Promise<{ success: boolean; message: string }>;
}> = ({ channel, settings, onSave, onTest }) => {
  const [open,    setOpen]    = React.useState(false);
  const [draft,   setDraft]   = React.useState<NotifDraft>(() => draftFromSettings(settings, channel));
  const [saving,  setSaving]  = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testMsg, setTestMsg] = React.useState<{ ok: boolean; msg: string } | null>(null);

  // Sync draft when server settings arrive
  React.useEffect(() => {
    setDraft(draftFromSettings(settings, channel));
  }, [settings, channel]);

  const toggleTrigger = (id: NotificationTrigger) => {
    setDraft(d => ({
      ...d,
      triggers: d.triggers.includes(id)
        ? d.triggers.filter(t => t !== id)
        : [...d.triggers, id],
    }));
  };

  const toggleContextField = (id: NotificationContextField) => {
    setDraft(d => ({
      ...d,
      context_fields: d.context_fields.includes(id)
        ? d.context_fields.filter(f => f !== id)
        : [...d.context_fields, id],
    }));
  };

  const setConfig = (patch: Partial<TeamsNotifConfig & EmailNotifConfig>) => {
    setDraft(d => ({ ...d, config: { ...d.config, ...patch } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(draft); setTestMsg(null); }
    catch { setTestMsg({ ok: false, msg: 'Save failed — check console' }); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const result = await onTest(draft.config);
      setTestMsg({ ok: result.success, msg: result.message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      setTestMsg({ ok: false, msg });
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = channel === 'teams'
    ? Boolean((draft.config as TeamsNotifConfig).webhook_url)
    : Boolean((draft.config as EmailNotifConfig).smtp_host);

  const teamsCfg  = draft.config as TeamsNotifConfig;
  const emailCfg  = draft.config as EmailNotifConfig;

  return (
    <div className="int-card">
      <div className="int-card__hd">
        <div className="int-card__logo">
          {channel === 'teams' ? <TeamsLogo/> : <EmailLogo/>}
        </div>
        <div style={{flex: 1, minWidth: 0}}>
          <div className="int-card__name">
            {channel === 'teams' ? 'Microsoft Teams' : 'Email (SMTP)'}
          </div>
          <div className="int-card__type">Notification channel</div>
        </div>
        {draft.enabled && isConfigured
          ? <span className="pill pill--approved"><span className="pill__dot"/> Enabled</span>
          : <span className="pill pill--skipped"><span className="pill__dot"/> Disabled</span>}
      </div>

      <dl className="int-card__meta">
        <dt>Triggers</dt>
        <dd>{draft.triggers.length === 0 ? 'None' : draft.triggers.map(t => t.replace('_', ' ')).join(', ')}</dd>
        <dt>Context</dt>
        <dd>{draft.context_fields.length === 0 ? 'None' : draft.context_fields.map(f => f.replace('_', ' ')).join(', ')}</dd>
      </dl>

      <div className="int-card__actions">
        <button className="btn btn--sm" onClick={() => setOpen(o => !o)}>
          <I.Cog size={12}/> Configure {open ? '▲' : '▼'}
        </button>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>

          {/* Enable toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, marginBottom: 14, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))}
            />
            Enable {channel === 'teams' ? 'Teams' : 'Email'} notifications
          </label>

          {/* Connection fields */}
          {channel === 'teams' ? (
            <div className="form-row mb-12" style={{ flexDirection: 'column' }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>Webhook URL</label>
              <input
                className="input"
                type="url"
                placeholder="https://outlook.office.com/webhook/…"
                value={teamsCfg.webhook_url ?? ''}
                onChange={e => setConfig({ webhook_url: e.target.value })}
              />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 12 }}>
              <div className="form-row" style={{ flexDirection: 'column', gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>SMTP Host</label>
                <input className="input" placeholder="smtp.gmail.com" value={emailCfg.smtp_host ?? ''} onChange={e => setConfig({ smtp_host: e.target.value })}/>
              </div>
              <div className="form-row" style={{ flexDirection: 'column' }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>Port</label>
                <input className="input" type="number" placeholder="587" value={emailCfg.smtp_port ?? 587} onChange={e => setConfig({ smtp_port: parseInt(e.target.value) || 587 })}/>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20, fontSize: 13 }}>
                <input type="checkbox" checked={emailCfg.smtp_secure ?? false} onChange={e => setConfig({ smtp_secure: e.target.checked })}/>
                <span>TLS/SSL (port 465)</span>
              </div>
              <div className="form-row" style={{ flexDirection: 'column' }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>Username</label>
                <input className="input" placeholder="user@example.com" value={emailCfg.smtp_user ?? ''} onChange={e => setConfig({ smtp_user: e.target.value })}/>
              </div>
              <div className="form-row" style={{ flexDirection: 'column' }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>Password</label>
                <input className="input" type="password" placeholder={emailCfg.smtp_pass === '[set]' ? '(saved)' : ''} value={emailCfg.smtp_pass === '[set]' ? '' : (emailCfg.smtp_pass ?? '')} onChange={e => setConfig({ smtp_pass: e.target.value })}/>
              </div>
              <div className="form-row" style={{ flexDirection: 'column', gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 4 }}>Recipients (one per line)</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="alice@example.com&#10;bob@example.com"
                  value={(emailCfg.recipients ?? []).join('\n')}
                  onChange={e => setConfig({ recipients: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>
          )}

          {/* Triggers */}
          <div className="section-label" style={{ marginBottom: 8 }}>Notify on</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {TRIGGERS.map(t => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.triggers.includes(t.id)}
                  onChange={() => toggleTrigger(t.id)}
                />
                {t.label}
              </label>
            ))}
          </div>

          {/* Context fields */}
          <div className="section-label" style={{ marginBottom: 8 }}>Include in message</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {CONTEXT_FIELDS.map(f => (
              <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.context_fields.includes(f.id)}
                  onChange={() => toggleContextField(f.id)}
                />
                {f.label}
              </label>
            ))}
          </div>

          {/* Test result */}
          {testMsg && (
            <div style={{
              padding: '8px 12px', fontSize: 12, borderRadius: 6, marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
              color:      testMsg.ok ? 'var(--success-fg)' : 'var(--danger-fg)',
              background: testMsg.ok ? 'var(--success-50, #dcfce7)' : 'var(--danger-50, #fee2e2)',
              border:     `1px solid ${testMsg.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)'}`,
            }}>
              {testMsg.ok ? <I.CheckCircle size={12}/> : <I.Alert size={12}/>}
              {testMsg.msg}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn--sm" onClick={handleTest} disabled={testing || !isConfigured}>
              <I.Refresh size={12}/> {testing ? 'Testing…' : 'Test'}
            </button>
            <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Screen ───────────────────────────────────────────────────────────────

export const IntegrationsScreen: React.FC = () => {
  const { activeOrg } = useOrgProject();
  const { connections, loading, createConnection, deleteConnection, testConnection } = useIntegrations(activeOrg?.id);
  const { settings: notifSettings, save: saveNotif, test: testNotif } = useNotificationSettings();
  const [showForm, setShowForm] = React.useState(false);
  const [kind, setKind]         = React.useState<'github' | 'sharepoint'>('github');
  const [formName, setFormName] = React.useState('');
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ id: string; ok: boolean; msg: string } | null>(null);

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await testConnection(id);
      setTestResult({ id, ok: res.success, msg: res.message });
    } finally {
      setTestingId(null);
    }
  };

  const handleConnect = async () => {
    if (!formName.trim()) return;
    await createConnection({ type: kind, name: formName.trim(), config: {}, status: 'inactive' });
    setShowForm(false);
    setFormName('');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Integrations</h1>
          <p className="page-header__subtitle">
            Connect source control, document stores, and notification channels.
            Agents read context from connected sources.
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--primary" onClick={() => setShowForm(true)}>
            <I.Plus size={14}/> Add integration
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-12">
          <div className="card__hd">
            <h3>Add a new integration</h3>
            <button className="btn btn--ghost btn--sm btn--icon ml-auto" onClick={() => setShowForm(false)}>
              <I.X size={14}/>
            </button>
          </div>
          <div className="card__bd">
            <div className="section-label">Connection type</div>
            <div className="form-grid form-grid--3 mb-12">
              {[
                { k: 'github'     as const, name: 'GitHub',     desc: 'Repos, branches, PRs', logo: <GithubLogo size={18}/> },
                { k: 'sharepoint' as const, name: 'SharePoint', desc: 'Specs & wikis',         logo: <SharePointLogo size={18}/> },
              ].map(t => (
                <div key={t.k} className={'preset-card ' + (kind === t.k ? 'is-active' : '')} onClick={() => setKind(t.k)}>
                  <div className="preset-card__icon">{t.logo}</div>
                  <div className="preset-card__body"><b>{t.name}</b><small>{t.desc}</small></div>
                  <div className="preset-card__check"><I.CheckCircle size={16}/></div>
                </div>
              ))}
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label>Display name</label>
                <input className="input" placeholder="e.g. acme-org" value={formName} onChange={e => setFormName(e.target.value)}/>
              </div>
              <div className="form-row">
                <label>Authentication</label>
                <select className="select">
                  <option>GitHub App (recommended)</option>
                  <option>Personal access token</option>
                </select>
              </div>
            </div>
            <div className="row mt-12" style={{justifyContent: 'flex-end'}}>
              <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleConnect} disabled={!formName.trim()}>
                <I.Link size={14}/> Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {testResult && (
        <div className={'card mb-12'} style={{
          padding: '10px 14px', fontSize: 13,
          color: testResult.ok ? 'var(--success-fg)' : 'var(--danger-fg)',
          borderColor: testResult.ok ? 'var(--success)' : 'var(--danger)',
        }}>
          {testResult.ok ? <I.CheckCircle size={14}/> : <I.Alert size={14}/>} {testResult.msg}
        </div>
      )}

      {loading && connections.length === 0 && (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '20px 0' }}>Loading integrations…</div>
      )}

      {connections.length > 0 && (
        <>
          <div className="section-label">Source Connections ({connections.length})</div>
          <div className="int-grid">
            {connections.map(conn => (
              <IntegrationCard
                key={conn.id}
                conn={conn}
                onTest={() => handleTest(conn.id)}
                onRemove={() => deleteConnection(conn.id)}
                testing={testingId === conn.id}
              />
            ))}
          </div>
        </>
      )}

      {!loading && connections.length === 0 && !showForm && (
        <div style={{ color: 'var(--text-3)', fontSize: 13, paddingBottom: 24 }}>
          <I.Plug size={18} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.4 }}/>
          No source connections yet. Click <b>Add integration</b> to connect a repo or document store.
        </div>
      )}

      {/* Notification Channels */}
      <div className="section-label" style={{ marginTop: 28 }}>Notification Channels</div>
      <div className="int-grid">
        <NotifChannelCard
          channel="teams"
          settings={notifSettings['teams'] ?? null}
          onSave={patch => saveNotif('teams', patch)}
          onTest={cfg  => testNotif('teams', cfg)}
        />
        <NotifChannelCard
          channel="email"
          settings={notifSettings['email'] ?? null}
          onSave={patch => saveNotif('email', patch)}
          onTest={cfg  => testNotif('email', cfg)}
        />
      </div>
    </div>
  );
};
