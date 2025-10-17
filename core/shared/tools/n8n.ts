import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Helper: Normalize n8n webhook URL construction
 * Handles base URLs with or without /webhook suffix, sanitizes slashes
 */
function joinWebhookUrl(base: string, scenario: string) {
  // Strip trailing slashes
  const b = base.replace(/\/+$/, '');
  // Ensure exactly one '/webhook' segment
  const hasWebhook = /\/webhook$/.test(b);
  const root = hasWebhook ? b : `${b}/webhook`;
  // Strip leading slashes from scenario
  const path = scenario.replace(/^\/+/, '');
  return `${root}/${path}`;
}

export const n8nTrigger = createTool({
  id: 'n8n.trigger',
  description: 'Trigger an n8n workflow via webhook. Provide scenario as the path segment after /webhook, e.g., "<uuid>" or "<uuid>/test" or a named path.',
  inputSchema: z.object({
    scenario: z.string().describe('Webhook path segment (e.g., "repurposer" or UUID)'),
    payload: z.any().describe('JSON payload to send to workflow'),
  }),
  execute: async ({ context }) => {
    const base = process.env.N8N_WEBHOOK_BASE;
    if (!base) {
      return { ok: false, skipped: true, reason: 'N8N_WEBHOOK_BASE not set' };
    }

    const webhookUrl = joinWebhookUrl(base, context.scenario);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context.payload),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, reason: await response.text() };
    }

    try {
      return { ok: true, data: await response.json() };
    } catch {
      return { ok: true, data: null };
    }
  },
});
