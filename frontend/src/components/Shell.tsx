import React from 'react';
import { I } from '../icons';
import { useOrgProject } from '../contexts/OrgProjectContext';

export interface Route {
  screen: string;
  runId?: string;
}

const NAV = [
  { group: 'Workspace', items: [
    { key: 'orgs',        label: 'Organizations',   icon: 'Layers' },
    { key: 'projects',    label: 'Projects',        icon: 'Folder' },
    { key: 'overview',    label: 'Overview',        icon: 'Dashboard' },
    { key: 'pipelines',   label: 'SDLC Pipelines',  icon: 'Pipeline',     count: 12 },
    { key: 'requirements',label: 'Requirements',    icon: 'Requirements' },
    { key: 'sprint',      label: 'Sprint Planning', icon: 'Sprint' },
  ]},
  { group: 'Agents', items: [
    { key: 'tests',       label: 'Test Automation', icon: 'Test' },
    { key: 'mocks',       label: 'Mock Generation', icon: 'Mock' },
    { key: 'review',      label: 'Code Review',     icon: 'Review',       count: 3 },
    { key: 'docs',        label: 'Documentation',   icon: 'Docs' },
    { key: 'prs',         label: 'GitHub PR Review',icon: 'PR',           count: 7 },
  ]},
  { group: 'Platform', items: [
    { key: 'integrations',label: 'Integrations',    icon: 'Plug' },
    { key: 'settings',    label: 'Settings',        icon: 'Settings' },
  ]},
];

interface SidebarProps {
  route: Route;
  onRoute: (r: Route) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ route, onRoute }) => {
  const { activeOrg, activeProject, orgs, projects, setActiveOrg, setActiveProject } = useOrgProject();

  return (
  <aside className="sidebar">
    <div className="sidebar__brand">
      <div className="sidebar__mark">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 7l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className="sidebar__name">
        SDL<small>Agentic AI Platform</small>
      </div>
    </div>

    <div className="sidebar__context">
      <div className="ctx-switcher">
        <div className="ctx-switcher__label">Project</div>
        <select
          className="ctx-select"
          value={activeProject?.id ?? ''}
          onChange={e => {
            const proj = projects.find(p => p.id === e.target.value);
            if (proj) setActiveProject(proj);
          }}
        >
          {projects.map(p => {
            const status = (p.config as any)?.analysis_status as string | undefined;
            const syncing = status === 'pending' || status === 'running';
            return <option key={p.id} value={p.id}>{syncing ? `⟳ ${p.name}` : p.name}</option>;
          })}
          {projects.length === 0 && <option value="">No projects</option>}
        </select>
      </div>
    </div>

    <nav className="sidebar__nav">
      {NAV.map((grp, gi) => (
        <div key={gi}>
          <div className="sidebar__group-label">{grp.group}</div>
          {grp.items.map(item => {
            const IconEl = I[item.icon];
            const active = route.screen === item.key
              || (item.key === 'pipelines' && route.screen === 'detail')
              || (item.key === 'pipelines' && route.screen === 'new');
            return (
              <div
                key={item.key}
                className={'nav-item' + (active ? ' is-active' : '')}
                onClick={() => onRoute({ screen: item.key })}
              >
                {IconEl && <IconEl size={15}/>}
                <span>{item.label}</span>
                {item.count != null && <span className="nav-item__count">{item.count}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </nav>

    <div className="sidebar__footer">
      <button
        className="sidebar__org-row"
        onClick={() => onRoute({ screen: 'orgs' })}
        title="Organization settings"
      >
        <I.Layers size={14} style={{ flexShrink: 0 }}/>
        <span className="sidebar__org-name">{activeOrg?.name ?? 'No org'}</span>
        <I.ChevronRight size={12} style={{ marginLeft: 'auto', flexShrink: 0, opacity: 0.4 }}/>
      </button>
      <div className="sidebar__user-row">
        <div className="avatar">MC</div>
        <div className="sidebar__footer-info">
          <b>Marcus Chen</b>
          <small>Engineering Lead</small>
        </div>
        <I.ChevronDown size={14}/>
      </div>
    </div>
  </aside>
  );
};

interface Crumb {
  label: string;
  onClick?: () => void;
}

interface TopbarProps {
  crumbs?: Crumb[];
  right?: React.ReactNode;
}

export const Topbar: React.FC<TopbarProps> = ({ crumbs = [], right }) => (
  <header className="topbar">
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <I.ChevronRight size={12} className="crumbs__sep"/>}
          {c.onClick && i < crumbs.length - 1
            ? <button onClick={c.onClick} className="crumbs__link">{c.label}</button>
            : <span className={i === crumbs.length - 1 ? 'crumbs__current' : ''}>{c.label}</span>}
        </React.Fragment>
      ))}
    </div>
    <div className="topbar__spacer"/>
    <div className="topbar__env">
      <span className="topbar__env-dot"/>
      prod · us-east-1
    </div>
    <button className="btn btn--icon btn--sm" title="Notifications">
      <I.Bell size={14}/>
    </button>
    {right}
  </header>
);
