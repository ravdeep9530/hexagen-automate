import React from 'react';
import { I } from '../icons';
import { useRepos, useStartPipeline, DesignPreferences } from '../api/pipelinesApi';
import { PriorityDot } from './PipelinesScreen';
import { useOrgProject } from '../contexts/OrgProjectContext';

const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <section className="card">
    <div className="card__hd">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
    <div className="card__bd">{children}</div>
  </section>
);

interface NewPipelineScreenProps {
  onBack: () => void;
  onLaunch: (runId: string) => void;
}

export const NewPipelineScreen: React.FC<NewPipelineScreenProps> = ({ onBack, onLaunch }) => {
  const { repos, loading: reposLoading } = useRepos();
  const { start, loading: launching, error: launchError } = useStartPipeline();
  const { activeProject } = useOrgProject();

  const [state, setState] = React.useState({
    repo: '',
    branch: 'main',
    changeType: 'feature',
    title: '',
    description: '',
    priority: 'medium',
    requester: '',
    stakeholders: '',
    velocity: '32',
    capacity: '28',
    targetSprint: 'Sprint 47 (Jun 2 – Jun 13)',
    deadline: '2026-06-13',
    preset: 'tailwind' as 'material-ui' | 'tailwind-shadcn' | 'custom' | '',
    designNotes: '',
    refs: '',
  });

  // Pre-select first repo when repos load
  React.useEffect(() => {
    if (repos.length > 0 && !state.repo) {
      setState(s => ({ ...s, repo: repos[0].repo_full_name }));
    }
  }, [repos, state.repo]);

  const set = (k: string, v: string) => setState(s => ({ ...s, [k]: v }));

  const handleLaunch = async () => {
    const repoName = state.repo || (repos[0]?.repo_full_name ?? '');
    if (!repoName) return;

    const raw_request = [state.title, state.description].filter(Boolean).join('\n\n') || state.title;
    if (!raw_request.trim()) return;

    const design_preferences: DesignPreferences = {};
    if (state.preset === 'tailwind-shadcn') design_preferences.preset = 'tailwind-shadcn';
    else if (state.preset === 'material-ui') design_preferences.preset = 'material-ui';
    else if (state.preset === 'custom') design_preferences.preset = 'custom';
    if (state.designNotes) design_preferences.ideas = state.designNotes;
    if (state.refs) {
      design_preferences.references = state.refs.split('\n').filter(Boolean).map(url => ({ kind: 'website' as const, url: url.trim() }));
    }

    try {
      const result = await start({
        repo: repoName,
        raw_request,
        requester_id: state.requester || undefined,
        design_preferences: Object.keys(design_preferences).length > 0 ? design_preferences : null,
        project_id: activeProject?.id,
      });
      onLaunch(result.run_id);
    } catch {
      // error is shown from launchError state
    }
  };

  return (
    <div className="page" style={{maxWidth: 1080}}>
      <div className="page-header">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          <I.ArrowLeft size={14}/> Back
        </button>
        <div>
          <h1 className="page-header__title">New SDLC pipeline</h1>
          <p className="page-header__subtitle">
            Submit a change request — AI agents will draft requirements, plan, design, sprint &amp; implement.
            You stay in control between each stage.
          </p>
        </div>
      </div>

      <div className="col" style={{gap: 14}}>
        <Section title="What & where" subtitle="Pick the codebase the agents will work in.">
          <div className="form-grid form-grid--3">
            <div className="form-row form-row--full">
              <label>Repository</label>
              {reposLoading ? (
                <div className="input" style={{color: 'var(--text-3)'}}>Loading repos…</div>
              ) : (
                <select className="select" value={state.repo} onChange={e => set('repo', e.target.value)}>
                  {repos.map(r => (
                    <option key={r.repo_full_name} value={r.repo_full_name}>{r.repo_full_name}</option>
                  ))}
                  {repos.length === 0 && <option value="">No repos connected</option>}
                </select>
              )}
              <div className="hint">Only connected GitHub repos are listed. <button className="crumbs__link" onClick={onBack}>Manage integrations</button>.</div>
            </div>
            <div className="form-row">
              <label>Branch</label>
              <div className="field">
                <I.Branch size={13}/>
                <input value={state.branch} onChange={e => set('branch', e.target.value)} placeholder="main"/>
              </div>
            </div>
            <div className="form-row">
              <label>Change type</label>
              <select className="select" value={state.changeType} onChange={e => set('changeType', e.target.value)}>
                <option value="feature">Feature</option>
                <option value="bug">Bug fix</option>
                <option value="refactor">Refactor</option>
                <option value="chore">Chore / maintenance</option>
                <option value="infra">Infrastructure</option>
              </select>
            </div>
            <div className="form-row">
              <label>Pipeline template</label>
              <select className="select" defaultValue="standard">
                <option value="standard">Standard (all 7 stages)</option>
                <option value="fast">Fast track (skip Sprint)</option>
                <option value="docs">Documentation only</option>
              </select>
            </div>
          </div>
        </Section>

        <Section title="The ask" subtitle="Describe what should change and why.">
          <div className="form-grid">
            <div className="form-row form-row--full">
              <label>Title</label>
              <input className="input"
                placeholder="e.g. Add 3-D Secure 2 authentication to checkout flow"
                value={state.title}
                onChange={e => set('title', e.target.value)}
              />
            </div>
            <div className="form-row form-row--full">
              <label>Description</label>
              <textarea className="textarea" rows={4}
                placeholder="Customers in EU markets need SCA-compliant authentication during card payment."
                value={state.description}
                onChange={e => set('description', e.target.value)}
              />
              <div className="hint">Markdown supported. Link Jira tickets, Linear issues, or Slack threads.</div>
            </div>
            <div className="form-row">
              <label>Priority</label>
              <div className="chip-row">
                {['low', 'medium', 'high', 'urgent'].map(p => (
                  <span key={p}
                    className={'chip ' + (state.priority === p ? 'is-active' : '')}
                    onClick={() => set('priority', p)}>
                    <PriorityDot p={p === 'urgent' ? 'high' : p}/>
                    {p[0].toUpperCase() + p.slice(1)}
                  </span>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>Requested by</label>
              <input className="input"
                placeholder="Name or user ID"
                value={state.requester}
                onChange={e => set('requester', e.target.value)}
              />
            </div>
          </div>
        </Section>

        <Section title="Planning" subtitle="Optional — informs the Sprint stage.">
          <div className="form-grid">
            <div className="form-row form-row--full">
              <label>Stakeholders <span className="opt">(comma-separated)</span></label>
              <input className="input"
                value={state.stakeholders}
                onChange={e => set('stakeholders', e.target.value)}
                placeholder="Marcus Chen, Sofia Restrepo"/>
            </div>
            <div className="form-row">
              <label>Team velocity <span className="opt">(points/sprint)</span></label>
              <input className="input" type="number" value={state.velocity} onChange={e => set('velocity', e.target.value)}/>
            </div>
            <div className="form-row">
              <label>Sprint capacity <span className="opt">(points free)</span></label>
              <input className="input" type="number" value={state.capacity} onChange={e => set('capacity', e.target.value)}/>
            </div>
            <div className="form-row">
              <label>Target sprint</label>
              <select className="select" value={state.targetSprint} onChange={e => set('targetSprint', e.target.value)}>
                <option>Sprint 47 (Jun 2 – Jun 13)</option>
                <option>Sprint 48 (Jun 16 – Jun 27)</option>
                <option>Sprint 49 (Jun 30 – Jul 11)</option>
              </select>
            </div>
            <div className="form-row">
              <label>Deadline</label>
              <div className="field">
                <I.Calendar size={13}/>
                <input type="date" value={state.deadline} onChange={e => set('deadline', e.target.value)}/>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Design preferences" subtitle="Optional — guides the Design stage agent.">
          <div className="section-label">Component library</div>
          <div className="form-grid form-grid--3" style={{marginBottom: 14}}>
            {[
              { k: 'material-ui',     name: 'Material UI v5',    desc: 'MUI + Emotion, light theme',  icon: 'Box' },
              { k: 'tailwind-shadcn', name: 'Tailwind + shadcn', desc: 'shadcn/ui, neutral tokens',   icon: 'Brush' },
              { k: 'custom',          name: 'Internal DS @ 4.2', desc: 'Our design system',            icon: 'Layers' },
              { k: '',                name: 'Detect from repo',  desc: 'Let the agent decide',          icon: 'Sparkles' },
            ].map(p => {
              const IconEl = I[p.icon];
              return (
                <div key={p.k}
                  className={'preset-card ' + (state.preset === p.k ? 'is-active' : '')}
                  onClick={() => set('preset', p.k)}>
                  <div className="preset-card__icon">{IconEl && <IconEl size={18}/>}</div>
                  <div className="preset-card__body">
                    <b>{p.name}</b>
                    <small>{p.desc}</small>
                  </div>
                  <div className="preset-card__check"><I.CheckCircle size={16}/></div>
                </div>
              );
            })}
          </div>

          <div className="form-grid">
            <div className="form-row form-row--full">
              <label>Freeform design ideas <span className="opt">optional</span></label>
              <textarea className="textarea" rows={3}
                placeholder='"Make the challenge modal feel native to our checkout — minimal chrome, blue accent."'
                value={state.designNotes}
                onChange={e => set('designNotes', e.target.value)}
              />
            </div>
            <div className="form-row form-row--full">
              <label>Reference links <span className="opt">websites, GitHub repos, Figma — one per line</span></label>
              <textarea className="textarea" rows={3}
                placeholder={"https://stripe.com/docs/payments/3d-secure\nhttps://github.com/adyen/adyen-web"}
                value={state.refs}
                onChange={e => set('refs', e.target.value)}/>
            </div>
          </div>
        </Section>

        {launchError && (
          <div className="card" style={{borderColor: 'var(--danger)', padding: '10px 14px', fontSize: 13, color: 'var(--danger-fg)'}}>
            <I.Alert size={14}/> {launchError}
          </div>
        )}

        <div className="row" style={{justifyContent: 'flex-end', marginTop: 4}}>
          <button className="btn btn--ghost" onClick={onBack} disabled={launching}>Cancel</button>
          <button className="btn btn--primary" onClick={handleLaunch} disabled={launching || !state.title.trim()}>
            {launching ? <><I.Sparkles size={14}/> Launching…</> : <><I.Play size={14}/> Launch pipeline</>}
          </button>
        </div>
      </div>
    </div>
  );
};
