# SDL Agentic Platform - Integrations Architecture

## Overview

Extend the SDL Agentic AI Platform with deep integrations into enterprise development tools:

- **GitHub** - Code repositories, PRs, issues, actions
- **SharePoint** - Requirements documents, design specs, project documentation
- **Azure DevOps** - Boards, sprints, pipelines, repos
- **Jira** - Issue tracking, sprint management
- **Confluence** - Technical documentation, ADRs
- **Slack/Teams** - Notifications, approvals, collaboration

## Integration Patterns

### 1. GitHub Integration

**Use Cases:**

- Code Review Agent: Auto-review PRs, post comments, suggest fixes
- Test Automation Agent: Trigger test runs on PR, report coverage
- Documentation Agent: Update README/API docs on merge
- Sprint Agent: Link PRs to sprint tasks, track velocity

**APIs:**

- GitHub REST API v3
- GitHub GraphQL API v4
- GitHub Apps (webhooks for PR events)

**Data Flow:**

```
PR Created → Webhook → Backend → Code Review Agent → Post Comments
```

### 2. SharePoint Integration

**Use Cases:**

- Requirements Agent: Read requirements docs from SharePoint libraries
- Documentation Agent: Publish generated docs to SharePoint
- Sprint Agent: Read project timelines from SharePoint lists

**APIs:**

- Microsoft Graph API (/sites, /drives, /lists)
- SharePoint REST API

**Data Flow:**

```
User selects SharePoint doc → Graph API fetch → Requirements Agent → Structured stories
```

### 3. Azure DevOps Integration

**Use Cases:**

- Sprint Agent: Create work items, plan sprints in Azure Boards
- Test Automation Agent: Publish test results to Azure Test Plans
- Mock Generation Agent: Link design specs to work items

**APIs:**

- Azure DevOps REST API 7.1
- Service Hooks (webhooks)

**Data Flow:**

```
Sprint planned → Create PBIs/Tasks in Azure Boards → Link to GitHub PRs
```

### 4. Slack/Teams Integration

**Use Cases:**

- All agents: Send notifications on completion/failure
- Code Review Agent: Request human review for critical issues
- Sprint Agent: Daily standup summaries

**APIs:**

- Slack Bolt SDK
- Microsoft Teams Bot Framework

## Authentication

All integrations use OAuth 2.0 / Managed Identity:

- **GitHub**: GitHub App authentication (JWT + installation tokens)
- **SharePoint**: Microsoft Graph with Delegated/App permissions
- **Azure DevOps**: Azure AD OAuth + PAT fallback
- **Slack**: Bot tokens + user OAuth

## Implementation Plan

### Phase 1: GitHub Integration (Week 1)

- [ ] GitHub App setup service
- [ ] PR webhook handler
- [ ] Auto-code review on PR
- [ ] Comment posting API

### Phase 2: SharePoint Integration (Week 2)

- [ ] Microsoft Graph client
- [ ] Document library browser
- [ ] Requirements extraction from Word/PDF
- [ ] Generated docs publishing

### Phase 3: Azure DevOps Integration (Week 3)

- [ ] ADO REST client
- [ ] Work item creation/sync
- [ ] Sprint board integration
- [ ] Build pipeline triggers

### Phase 4: Notifications (Week 4)

- [ ] Slack bot setup
- [ ] Teams bot setup
- [ ] Notification templates
- [ ] Approval workflows

## Data Model Extensions

### Integration Connections

```sql
CREATE TABLE integration_connections (
    id UUID PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- github, sharepoint, azure_devops, slack
    name VARCHAR(255),
    config JSONB NOT NULL, -- encrypted credentials
    status VARCHAR(20) DEFAULT 'active',
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Integration Jobs

```sql
CREATE TABLE integration_jobs (
    id UUID PRIMARY KEY,
    connection_id UUID REFERENCES integration_connections(id),
    agent_type VARCHAR(50),
    action VARCHAR(100), -- e.g., "review_pr", "create_work_item"
    payload JSONB,
    status VARCHAR(20),
    external_id VARCHAR(255), -- e.g., GitHub PR number
    result JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```
