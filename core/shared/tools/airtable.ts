import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Helper function for Airtable API headers (optional-first pattern)
 */
function airtableHeadersOrNull() {
  const token =
    process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  } as const;
}

/**
 * Query Tool - Flexible Airtable querying
 *
 * Supports: filtering, views, field selection, sorting, pagination
 */
export const airtableQuery = createTool({
  id: 'airtable.query',
  description: 'Query Airtable table with filterByFormula, view, fields, sort. Returns matching records.',
  inputSchema: z.object({
    baseId: z.string().describe('Airtable Base ID (e.g., appXXXXXXXXXXXXXX)'),
    table: z.string().describe('Table name'),
    filterByFormula: z.string().optional().describe('Airtable formula for filtering'),
    view: z.string().optional().describe('View name to use'),
    maxRecords: z.number().optional().default(100).describe('Maximum records to return'),
    pageSize: z.number().optional().default(50).describe('Page size for pagination'),
    fields: z.array(z.string()).optional().describe('Specific fields to return'),
    sort: z.array(z.object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']).optional()
    })).optional().describe('Sort configuration')
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const { baseId, table, filterByFormula, view, maxRecords = 100, pageSize = 50, fields, sort } = context;
    const params = new URLSearchParams();

    if (filterByFormula) params.set('filterByFormula', filterByFormula);
    if (view) params.set('view', view);
    if (maxRecords) params.set('maxRecords', String(maxRecords));
    if (pageSize) params.set('pageSize', String(pageSize));
    (fields ?? []).forEach(f => params.append('fields[]', f));
    (sort ?? []).forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
    });

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      return { ok: false, status: res.status, reason: await res.text() };
    }

    const data: any = await res.json();
    return { ok: true, baseId, table, records: data.records ?? [] };
  }
});

/**
 * Create Tool - Bulk record creation
 *
 * Creates one or many records in a table
 */
export const airtableCreate = createTool({
  id: 'airtable.create',
  description: 'Create one or many records in an Airtable table. Returns created records with IDs.',
  inputSchema: z.object({
    baseId: z.string().describe('Airtable Base ID'),
    table: z.string().describe('Table name'),
    records: z.array(z.record(z.any())).describe('Array of field maps, e.g., [{Name:"X", Status:"New"}]'),
    typecast: z.boolean().optional().default(true).describe('Auto-convert field types'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const { baseId, table, records, typecast = true } = context;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const payload = {
      records: records.map(fields => ({ fields })),
      typecast
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return { ok: false, status: res.status, reason: await res.text() };
    }

    const data: any = await res.json();
    return { ok: true, ...data };
  }
});

/**
 * Update Tool - Partial field updates
 *
 * Updates specific fields on existing records by ID
 */
export const airtableUpdate = createTool({
  id: 'airtable.update',
  description: 'Update records by ID with partial fields. Preserves fields not mentioned.',
  inputSchema: z.object({
    baseId: z.string().describe('Airtable Base ID'),
    table: z.string().describe('Table name'),
    updates: z.array(z.object({
      id: z.string().describe('Record ID (starts with rec...)'),
      fields: z.record(z.any()).describe('Fields to update')
    })).describe('Array of updates with record IDs and fields'),
    typecast: z.boolean().optional().default(true).describe('Auto-convert field types'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const { baseId, table, updates, typecast = true } = context;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ records: updates, typecast })
    });

    if (!res.ok) {
      return { ok: false, status: res.status, reason: await res.text() };
    }

    const data: any = await res.json();
    return { ok: true, ...data };
  }
});

/**
 * Legacy: Fetch Persona (kept for backwards compatibility)
 *
 * Specialized tool for fetching personas by slug
 */
export const airtableFetchPersona = createTool({
  id: 'airtable.fetchPersona',
  description: 'Fetch persona by slug from Airtable (legacy - use airtable.query for new code)',
  inputSchema: z.object({
    baseId: z.string().optional(),
    table: z.string(),
    view: z.string().optional(),
    slug: z.string(),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    const base =
      context.baseId ||
      process.env.AIRTABLE_BASE_ID ||
      process.env.AIRTABLE_CRM_BASE_ID ||
      process.env.AIRTABLE_CONTENT_HUB_BASE_ID ||
      process.env.AIRTABLE_AUTOMATION_BASE_ID ||
      process.env.AIRTABLE_SOCIAL_MEDIA_BASE_ID ||
      process.env.AIRTABLE_NEWSLETTER_BASE_ID;

    if (!headers || !base) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (missing key or baseId)' };
    }

    const apiBase = process.env.AIRTABLE_API_BASE_URL || 'https://api.airtable.com/v0';
    const url = new URL(`${apiBase}/${base}/${encodeURIComponent(context.table)}`);

    // Case-insensitive match on {Slug}
    const slug = context.slug.toLowerCase().replace(/"/g, '\\"');
    url.searchParams.set('filterByFormula', `LOWER({Slug})="${slug}"`);
    if (context.view) url.searchParams.set('view', context.view);

    const r = await fetch(url, { headers });
    if (!r.ok) return { ok: false, status: r.status, reason: await r.text() };

    const json: any = await r.json();
    return { ok: true, records: json.records ?? [] };
  },
});
