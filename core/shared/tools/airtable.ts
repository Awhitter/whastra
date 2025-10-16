import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const airtableFetchPersona = createTool({
  id: 'airtable.fetchPersona',
  description: 'Fetch persona by slug from Airtable (skips if not configured)',
  inputSchema: z.object({
    baseId: z.string().optional(),        // allow caller to choose base; else fallback
    table: z.string(),
    view: z.string().optional(),
    slug: z.string(),
  }),
  execute: async ({ context }) => {
    const key = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;
    const base =
      context.baseId ||
      process.env.AIRTABLE_BASE_ID ||
      process.env.AIRTABLE_CRM_BASE_ID ||
      process.env.AIRTABLE_CONTENT_HUB_BASE_ID ||
      process.env.AIRTABLE_AUTOMATION_BASE_ID ||
      process.env.AIRTABLE_SOCIAL_MEDIA_BASE_ID ||
      process.env.AIRTABLE_NEWSLETTER_BASE_ID;

    if (!key || !base) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (missing key or baseId)' };
    }

    const apiBase = process.env.AIRTABLE_API_BASE_URL || 'https://api.airtable.com/v0';
    const url = new URL(`${apiBase}/${base}/${encodeURIComponent(context.table)}`);

    // Case-insensitive match on {slug}
    const slug = context.slug.toLowerCase().replace(/"/g, '\\"');
    url.searchParams.set('filterByFormula', `LOWER({slug})="${slug}"`);
    if (context.view) url.searchParams.set('view', context.view);

    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return { ok: false, status: r.status, reason: await r.text() };

    const json = await r.json();
    return { ok: true, records: json.records ?? [] };
  },
});
