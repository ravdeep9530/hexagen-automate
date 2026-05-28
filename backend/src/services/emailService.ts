import nodemailer from 'nodemailer';
import type { PipelineRun, StageStatus } from './pipelineService';
import type { EmailChannelConfig, NotificationSettings, NotificationContextField } from './notificationTypes';

function createTransport(cfg: EmailChannelConfig): nodemailer.Transporter {
    return nodemailer.createTransport({
        host: cfg.smtp_host,
        port: cfg.smtp_port || 587,
        secure: cfg.smtp_secure || false,
        auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
    });
}

export async function sendEmail(
    cfg: EmailChannelConfig,
    subject: string,
    htmlBody: string,
    textBody: string
): Promise<void> {
    if (!cfg.smtp_host || !cfg.recipients?.length) {
        console.log('[emailService] Skipping send — smtp_host or recipients not configured');
        return;
    }
    const transporter = createTransport(cfg);
    await transporter.sendMail({
        from: cfg.smtp_user || 'noreply@sdlc-platform',
        to: cfg.recipients.join(', '),
        subject,
        text: textBody,
        html: htmlBody,
    });
}

export async function sendStageApprovalEmail(
    run: PipelineRun,
    stageStatus: StageStatus,
    settings: NotificationSettings
): Promise<void> {
    const cfg = settings.config as EmailChannelConfig;
    const ctx = settings.context_fields;

    const subject = `[SDLC Pipeline] Stage "${stageStatus.stage}" awaiting approval — ${run.repo_full_name || run.run_id}`;

    const artifactSection = ctx.includes('artifact_summary') && stageStatus.artifact_json
        ? buildArtifactSection(stageStatus.artifact_json as Record<string, unknown>)
        : '';

    const stageSection = ctx.includes('stage_details')
        ? `<p><strong>Stage:</strong> ${stageStatus.stage}<br/><strong>Status:</strong> ${stageStatus.status}</p>`
        : '';

    const runIdSection = ctx.includes('run_id')
        ? `<p><strong>Run ID:</strong> <code>${run.run_id}</code></p>`
        : '';

    const prSection = ctx.includes('pr_link') && stageStatus.artifact_url
        ? `<p><strong>Artifact:</strong> <a href="${stageStatus.artifact_url}">${stageStatus.artifact_url}</a></p>`
        : '';

    const backendUrl = process.env.BACKEND_URL || (process.env.FRONTEND_URL || '').replace('3001', '5000') || 'http://localhost:5000';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

    const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b">
  <h2 style="color:#2563eb">&#9201; Stage Awaiting Approval</h2>
  <p><strong>Pipeline:</strong> ${run.repo_full_name || run.run_id}</p>
  ${stageSection}
  ${runIdSection}
  ${artifactSection}
  ${prSection}
  <div style="margin:24px 0">
    <a href="${backendUrl}/api/teams/decide?token=approve_placeholder" style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">Approve</a>
    <a href="${backendUrl}/api/teams/decide?token=reject_placeholder" style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:8px">Reject</a>
    <a href="${frontendUrl}?teams_nav=detail&run_id=${encodeURIComponent(run.run_id)}" style="background:#64748b;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">View Pipeline</a>
  </div>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
  <p style="font-size:12px;color:#94a3b8">SDLC Agentic Platform &mdash; automated notification</p>
</body>
</html>`;

    const textBody = [
        `Stage "${stageStatus.stage}" is awaiting approval for pipeline ${run.repo_full_name || run.run_id}.`,
        ctx.includes('run_id') ? `Run ID: ${run.run_id}` : '',
        `View pipeline: ${frontendUrl}?teams_nav=detail&run_id=${encodeURIComponent(run.run_id)}`,
    ].filter(Boolean).join('\n');

    await sendEmail(cfg, subject, htmlBody, textBody);
    console.log(`[emailService] Sent stage approval email for ${run.run_id}:${stageStatus.stage}`);
}

export async function sendPipelineCompleteEmail(
    run: PipelineRun,
    settings: NotificationSettings
): Promise<void> {
    const cfg = settings.config as EmailChannelConfig;
    const ctx = settings.context_fields;

    const icon = run.status === 'completed' ? '✅' : '❌';
    const subject = `[SDLC Pipeline] ${icon} Pipeline ${run.status} — ${run.repo_full_name || run.run_id}`;

    const stageRows = ctx.includes('stage_details')
        ? run.stages.map(s => {
            const si = s.status === 'approved' ? '✅' : s.status === 'rejected' ? '❌' : s.status === 'running' ? '🔄' : '⏭';
            return `<tr><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${s.stage}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${si} ${s.status}</td></tr>`;
          }).join('')
        : '';

    const runIdSection = ctx.includes('run_id')
        ? `<p><strong>Run ID:</strong> <code>${run.run_id}</code></p>`
        : '';

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

    const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b">
  <h2 style="color:${run.status === 'completed' ? '#16a34a' : '#dc2626'}">${icon} Pipeline ${run.status}</h2>
  <p><strong>Pipeline:</strong> ${run.repo_full_name || run.run_id}</p>
  ${runIdSection}
  ${stageRows ? `
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead><tr style="background:#f1f5f9">
      <th style="text-align:left;padding:8px 12px">Stage</th>
      <th style="text-align:left;padding:8px 12px">Status</th>
    </tr></thead>
    <tbody>${stageRows}</tbody>
  </table>` : ''}
  <p><a href="${frontendUrl}?teams_nav=detail&run_id=${encodeURIComponent(run.run_id)}" style="color:#2563eb">View full pipeline →</a></p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
  <p style="font-size:12px;color:#94a3b8">SDLC Agentic Platform &mdash; automated notification</p>
</body>
</html>`;

    const textBody = [
        `Pipeline ${run.status}: ${run.repo_full_name || run.run_id}`,
        ctx.includes('run_id') ? `Run ID: ${run.run_id}` : '',
        `View pipeline: ${frontendUrl}?teams_nav=detail&run_id=${encodeURIComponent(run.run_id)}`,
    ].filter(Boolean).join('\n');

    await sendEmail(cfg, subject, htmlBody, textBody);
    console.log(`[emailService] Sent pipeline ${run.status} email for ${run.run_id}`);
}

function buildArtifactSection(artifactJson: Record<string, unknown>): string {
    const title   = (artifactJson.title   as string | undefined) || '';
    const summary = (artifactJson.summary as string | undefined) || (artifactJson.answer as string | undefined) || '';
    if (!title && !summary) return '';
    return `
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px;margin:12px 0">
  ${title   ? `<p style="font-weight:600;margin:0 0 6px">${title}</p>` : ''}
  ${summary ? `<p style="margin:0;font-size:14px;color:#475569">${summary.slice(0, 500)}${summary.length > 500 ? '…' : ''}</p>` : ''}
</div>`;
}
