import { Router } from 'express';
import { verifyApprovalToken, sendDecisionConfirmedCard } from '../services/teamsService';
import { pipelineService } from '../services/pipelineService';

export const teamsRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3001';

/**
 * GET /api/teams/decide?token=<signed-token>
 *
 * Called when an approver clicks Approve or Reject in a Teams Adaptive Card.
 * Validates the HMAC-signed token, applies the decision, sends a confirmation
 * card back to Teams, then redirects to the frontend pipeline view.
 */
teamsRouter.get('/decide', async (req, res) => {
    const token = req.query.token as string | undefined;

    if (!token) {
        res.status(400).send('<h2>Missing approval token.</h2><p>Use the buttons in the Teams card.</p>');
        return;
    }

    const payload = verifyApprovalToken(token);
    if (!payload) {
        res.status(400).send(
            '<h2>Invalid or expired approval link.</h2>' +
            '<p>Approval links expire after 15 minutes. Ask the pipeline to re-send the card, ' +
            'or approve directly from the pipeline view.</p>'
        );
        return;
    }

    const { runId, stage, decision } = payload;

    try {
        await pipelineService.decideStage(runId, stage as any, decision);
    } catch (err: any) {
        // decideStage is idempotent — if already decided it returns early.
        // Any other error is logged but we still redirect so the user isn't stranded.
        console.warn('[teamsRouter] decideStage error (may already be decided):', err?.message);
    }

    void sendDecisionConfirmedCard(runId, stage, decision).catch(e => {
        console.error('[teamsRouter] Failed to send Teams confirmation card:', e);
    });

    const redirectUrl =
        `${FRONTEND_URL}` +
        `?teams_nav=detail` +
        `&run_id=${encodeURIComponent(runId)}` +
        `&stage=${encodeURIComponent(stage)}` +
        `&teams_decided=${encodeURIComponent(decision)}`;

    res.redirect(redirectUrl);
});
