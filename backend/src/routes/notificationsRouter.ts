import { Router } from 'express';
import { getAllSettings, getSettings, upsertSettings } from '../services/notificationSettingsService';
import { sendEmail } from '../services/emailService';
import type { NotificationChannel, NotificationTrigger, NotificationContextField, EmailChannelConfig, TeamsChannelConfig } from '../services/notificationTypes';

export const notificationsRouter = Router();

function redactPass(settings: ReturnType<typeof Object.assign>): void {
    const cfg = settings.config as Record<string, unknown>;
    if (cfg?.smtp_pass) cfg.smtp_pass = '[set]';
}

// GET /api/notifications/settings
notificationsRouter.get('/settings', async (_req, res) => {
    try {
        const all = await getAllSettings();
        for (const ch of Object.keys(all) as NotificationChannel[]) {
            const s = all[ch];
            if (s && ch === 'email') redactPass(s as unknown as Record<string, unknown>);
        }
        res.json(all);
    } catch (err) {
        console.error('[notificationsRouter] GET /settings error:', err);
        res.status(500).json({ error: 'Failed to load notification settings' });
    }
});

// PUT /api/notifications/settings/:channel
notificationsRouter.put('/settings/:channel', async (req, res) => {
    const channel = req.params.channel as NotificationChannel;
    if (channel !== 'teams' && channel !== 'email') {
        res.status(400).json({ error: 'Invalid channel. Must be "teams" or "email".' });
        return;
    }

    try {
        const body = req.body as {
            enabled?: boolean;
            config?: Record<string, unknown>;
            triggers?: string[];
            context_fields?: string[];
        };

        // Preserve existing smtp_pass when client sends '[set]' or empty
        let mergedConfig = body.config;
        if (channel === 'email' && body.config) {
            const existing = await getSettings('email');
            const existingPass = (existing?.config as EmailChannelConfig | undefined)?.smtp_pass ?? '';
            const incomingPass = (body.config.smtp_pass as string | undefined) ?? '';
            if (!incomingPass || incomingPass === '[set]') {
                mergedConfig = { ...body.config, smtp_pass: existingPass };
            }
        }

        const saved = await upsertSettings(channel, {
            enabled:        body.enabled,
            config:         mergedConfig as TeamsChannelConfig | EmailChannelConfig | undefined,
            triggers:       body.triggers as NotificationTrigger[] | undefined,
            context_fields: body.context_fields as NotificationContextField[] | undefined,
        });

        if (channel === 'email') redactPass(saved as unknown as Record<string, unknown>);
        res.json(saved);
    } catch (err) {
        console.error('[notificationsRouter] PUT /settings/:channel error:', err);
        res.status(500).json({ error: 'Failed to save notification settings' });
    }
});

// POST /api/notifications/settings/:channel/test
notificationsRouter.post('/settings/:channel/test', async (req, res) => {
    const channel = req.params.channel as NotificationChannel;
    if (channel !== 'teams' && channel !== 'email') {
        res.status(400).json({ error: 'Invalid channel.' });
        return;
    }

    try {
        if (channel === 'teams') {
            const cfg = req.body.config as TeamsChannelConfig;
            if (!cfg?.webhook_url) {
                res.status(400).json({ success: false, message: 'webhook_url is required' });
                return;
            }
            await sendCardViaUrl({
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                type: 'AdaptiveCard',
                version: '1.4',
                body: [{
                    type: 'TextBlock',
                    text: '✅ SDLC Platform — Teams notification test successful',
                    weight: 'Bolder',
                    size: 'Medium',
                }],
            }, cfg.webhook_url);
            res.json({ success: true, message: 'Test card sent to Teams channel' });
        } else {
            const cfg = req.body.config as EmailChannelConfig;
            if (!cfg?.smtp_host || !cfg?.recipients?.length) {
                res.status(400).json({ success: false, message: 'smtp_host and at least one recipient are required' });
                return;
            }
            // Restore real password if client sent '[set]' placeholder
            if (!cfg.smtp_pass || cfg.smtp_pass === '[set]') {
                const stored = await getSettings('email');
                cfg.smtp_pass = (stored?.config as EmailChannelConfig | undefined)?.smtp_pass ?? '';
            }
            await sendEmail(
                cfg,
                'SDLC Platform — Email notification test',
                '<h2>&#x2705; Email notification test successful</h2><p>Your SDLC Platform email integration is working correctly.</p>',
                'Email notification test successful — your SDLC Platform email integration is working correctly.',
            );
            res.json({ success: true, message: `Test email sent to ${cfg.recipients.join(', ')}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[notificationsRouter] test error:', err);
        res.status(500).json({ success: false, message: `Send failed: ${msg}` });
    }
});

async function sendCardViaUrl(card: object, webhookUrl: string): Promise<void> {
    const body = {
        type: 'message',
        attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: card,
        }],
    };
    const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`Teams webhook responded ${resp.status}: ${await resp.text().catch(() => '')}`);
    }
}
