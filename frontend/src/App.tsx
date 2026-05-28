import React from 'react';
import { Sidebar, Topbar, Route } from './components/Shell';
import { PipelinesScreen } from './screens/PipelinesScreen';
import { NewPipelineScreen } from './screens/NewPipelineScreen';
import { PipelineDetailScreen } from './screens/PipelineDetailScreen';
import { PlannerScreen } from './screens/PlannerScreen';
import { DesignerScreen } from './screens/DesignerScreen';
import { SprintPlannerScreen } from './screens/SprintPlannerScreen';
import { RequirementsEditorScreen } from './screens/RequirementsEditorScreen';
import { IntegrationsScreen } from './screens/IntegrationsScreen';
import { StubScreen } from './screens/StubScreen';
import { OrgsScreen } from './screens/OrgsScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ProjectOverviewScreen } from './screens/ProjectOverviewScreen';
import { OrgProjectProvider, useOrgProject } from './contexts/OrgProjectContext';

// Real feature screens — wired to live API hooks
import { RequirementsAgent } from './features/agents/RequirementsAgent';
import { SprintAgent }        from './features/agents/SprintAgent';
import { TestAutomationAgent } from './features/agents/TestAutomationAgent';
import { MockGenerationAgent } from './features/agents/MockGenerationAgent';
import { CodeReviewAgent }    from './features/agents/CodeReviewAgent';
import { DocumentationAgent } from './features/agents/DocumentationAgent';
import { GitHubPRReview }     from './features/integrations/GitHubPRReview';

const NAV_ITEMS = [
  { key: 'orgs',        label: 'Organizations' },
  { key: 'projects',    label: 'Projects' },
  { key: 'overview',    label: 'Overview' },
  { key: 'pipelines',   label: 'SDLC Pipelines' },
  { key: 'requirements',label: 'Requirements' },
  { key: 'sprint',      label: 'Sprint Planning' },
  { key: 'tests',       label: 'Test Automation' },
  { key: 'mocks',       label: 'Mock Generation' },
  { key: 'review',      label: 'Code Review' },
  { key: 'docs',        label: 'Documentation' },
  { key: 'prs',         label: 'GitHub PR Review' },
  { key: 'integrations',label: 'Integrations' },
  { key: 'settings',    label: 'Settings' },
];

function AppInner() {
  const [route, setRoute] = React.useState<Route>({ screen: 'pipelines' });
  const { setActiveOrg, setActiveProject, activeOrg, activeProject } = useOrgProject();
  const [teamsBanner, setTeamsBanner] = React.useState<{ decision: string; stage: string } | null>(null);

  // Handle deep-links from Teams approval cards: ?teams_nav=detail&run_id=...&stage=...&teams_decided=...
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nav     = params.get('teams_nav');
    const runId   = params.get('run_id');
    const stage   = params.get('stage');
    const decided = params.get('teams_decided');
    if (nav === 'detail' && runId) {
      setRoute({ screen: 'detail', runId });
      if (decided && stage) setTeamsBanner({ decision: decided, stage });
      // Clean query string without full reload
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
  }, []);

  const renderScreen = () => {
    switch (route.screen) {
      case 'orgs':
        return (
          <OrgsScreen
            onSelectOrg={org => { setActiveOrg(org); setRoute({ screen: 'projects' }); }}
          />
        );
      case 'projects':
        return (
          <ProjectsScreen
            onSelectProject={proj => { setActiveProject(proj); setRoute({ screen: 'overview' }); }}
          />
        );
      case 'overview':
        return (
          <ProjectOverviewScreen
            projectId={activeProject?.id ?? ''}
            orgId={activeOrg?.id ?? ''}
            onOpenPipelines={() => setRoute({ screen: 'pipelines' })}
          />
        );
      case 'pipelines':
      case 'dashboard':
        return (
          <PipelinesScreen
            onOpen={(runId: string) => setRoute({ screen: 'detail', runId })}
            onNew={() => setRoute({ screen: 'new' })}
          />
        );
      case 'new':
        return (
          <NewPipelineScreen
            onBack={() => setRoute({ screen: 'pipelines' })}
            onLaunch={(runId: string) => setRoute({ screen: 'detail', runId })}
          />
        );
      case 'detail':
        return (
          <PipelineDetailScreen
            runId={route.runId ?? ''}
            onBack={() => setRoute({ screen: 'pipelines' })}
            onOpenPlanner={() => setRoute({ screen: 'planner', runId: route.runId })}
            onOpenDesigner={() => setRoute({ screen: 'designer', runId: route.runId })}
            onOpenSprintPlanner={() => setRoute({ screen: 'sprint-planner', runId: route.runId })}
            onOpenRequirementsEditor={() => setRoute({ screen: 'requirements-editor', runId: route.runId })}
            onNavigate={(newRunId) => setRoute({ screen: 'detail', runId: newRunId })}
          />
        );
      case 'planner':
        return (
          <PlannerScreen
            runId={route.runId ?? ''}
            onBack={() => setRoute({ screen: 'detail', runId: route.runId })}
          />
        );
      case 'designer':
        return (
          <DesignerScreen
            runId={route.runId ?? ''}
            onBack={() => setRoute({ screen: 'detail', runId: route.runId })}
          />
        );
      case 'sprint-planner':
        return (
          <SprintPlannerScreen
            runId={route.runId ?? ''}
            onBack={() => setRoute({ screen: 'detail', runId: route.runId })}
          />
        );
      case 'requirements-editor':
        return (
          <RequirementsEditorScreen
            runId={route.runId ?? ''}
            onBack={() => setRoute({ screen: 'detail', runId: route.runId })}
          />
        );
      case 'integrations':
        return <IntegrationsScreen/>;
      case 'requirements':
        return <RequirementsAgent/>;
      case 'sprint':
        return <SprintAgent/>;
      case 'tests':
        return <TestAutomationAgent/>;
      case 'mocks':
        return <MockGenerationAgent/>;
      case 'review':
        return <CodeReviewAgent/>;
      case 'docs':
        return <DocumentationAgent/>;
      case 'prs':
        return <GitHubPRReview/>;
      case 'settings':
        return <StubScreen title="Settings" icon="Settings" description="Workspace, model defaults, and security."/>;
      default:
        return null;
    }
  };

  const crumbs = (() => {
    const navItem = NAV_ITEMS.find(i => i.key === route.screen);
    const home = { label: 'Workspace', onClick: () => setRoute({ screen: 'pipelines' }) };
    if (route.screen === 'overview') return [home, { label: 'Overview' }];
    if (route.screen === 'new')     return [home, { label: 'SDLC Pipelines', onClick: () => setRoute({ screen: 'pipelines' }) }, { label: 'New pipeline' }];
    if (route.screen === 'detail')  return [home, { label: 'SDLC Pipelines', onClick: () => setRoute({ screen: 'pipelines' }) }, { label: route.runId || '…' }];
    if (route.screen === 'planner') return [home, { label: 'SDLC Pipelines', onClick: () => setRoute({ screen: 'pipelines' }) }, { label: route.runId || '…', onClick: () => setRoute({ screen: 'detail', runId: route.runId }) }, { label: 'Plan Editor' }];
    if (route.screen === 'designer') return [home, { label: 'SDLC Pipelines', onClick: () => setRoute({ screen: 'pipelines' }) }, { label: route.runId || '…', onClick: () => setRoute({ screen: 'detail', runId: route.runId }) }, { label: 'Design Studio' }];
    if (route.screen === 'sprint-planner') return [home, { label: 'SDLC Pipelines', onClick: () => setRoute({ screen: 'pipelines' }) }, { label: route.runId || '…', onClick: () => setRoute({ screen: 'detail', runId: route.runId }) }, { label: 'Sprint Planner' }];
    if (route.screen === 'requirements-editor') return [home, { label: 'SDLC Pipelines', onClick: () => setRoute({ screen: 'pipelines' }) }, { label: route.runId || '…', onClick: () => setRoute({ screen: 'detail', runId: route.runId }) }, { label: 'Requirements Editor' }];
    return [home, { label: navItem?.label || 'Overview' }];
  })();

  return (
    <div className="app">
      <Sidebar route={route} onRoute={setRoute}/>
      <main className="main">
        <Topbar crumbs={crumbs}/>
        {teamsBanner && (
          <div style={{
            position: 'fixed', top: 52, left: 0, right: 0, zIndex: 1000,
            background: teamsBanner.decision === 'approved' ? 'var(--success, #16a34a)' : 'var(--danger-fg, #dc2626)',
            color: '#fff', padding: '10px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 13, fontWeight: 500,
          }}>
            <span>
              {teamsBanner.decision === 'approved' ? '✓' : '✗'}&nbsp;
              Stage <b>{teamsBanner.stage}</b> {teamsBanner.decision} via Microsoft Teams
            </span>
            <button
              onClick={() => setTeamsBanner(null)}
              style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            >×</button>
          </div>
        )}
        <div className="scroll-area" key={route.screen + (route.runId || '')}>
          {renderScreen()}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <OrgProjectProvider>
      <AppInner/>
    </OrgProjectProvider>
  );
}

export default App;
