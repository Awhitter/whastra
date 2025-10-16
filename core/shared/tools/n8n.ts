import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const n8nTrigger = createTool({
  id: 'n8n.trigger',
  description: 'Trigger an n8n workflow. Use for content repurposing, recruiting outreach, etc.',
  inputSchema: z.object({
    scenario: z.string(),
    payload: z.any(),
  }),
  execute: async ({ context }) => {
    if (!process.env.N8N_WEBHOOK_BASE) {
      return { ok: false, skipped: true, reason: 'N8N_WEBHOOK_BASE not set' };
    }
    const webhookUrl = `${process.env.N8N_WEBHOOK_BASE}/${context.scenario}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context.payload),
    });
    if (!response.ok) return { ok: false, status: response.status, reason: await response.text() };
    try { return { ok: true, data: await response.json() }; } catch { return { ok: true, data: null }; }
  },
});
