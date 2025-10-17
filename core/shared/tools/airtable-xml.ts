import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * XML-Aware Airtable Tools
 *
 * These tools understand the XML bundling architecture:
 * Content Initiators → Bundles → XML context flow
 */

function airtableHeadersOrNull() {
  const token = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  } as const;
}

/**
 * Get Content Bundle - Fetches master XML bundle for a Content Initiator
 *
 * Checks for prebuilt bundle, otherwise assembles from linked resources
 */
export const airtableGetContentBundle = createTool({
  id: 'airtable.getContentBundle',
  description: 'Fetch master XML bundle for Content Initiator. Returns aggregated context from Personas, Domains, Entities, References.',
  inputSchema: z.object({
    baseId: z.string().optional().describe('Airtable Base ID (defaults to env)'),
    initiatorId: z.string().describe('Content Initiator record ID (rec...)'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const baseId = context.baseId || process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_CONTENT_BASE_ID;
    if (!baseId) {
      return { ok: false, skipped: true, reason: 'No Airtable Base ID configured' };
    }

    const initiatorTable = process.env.AIRTABLE_TABLE_CONTENT_INITIATORS || 'Content Initiators';
    const bundleField = process.env.AIRTABLE_FIELD_XML_BUNDLE || 'BUNDLE of the XML BUNDLES';

    try {
      // Fetch the Content Initiator record
      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(initiatorTable)}/${context.initiatorId}`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        return { ok: false, status: res.status, reason: await res.text() };
      }

      const record: any = await res.json();

      // Check for prebuilt XML bundle
      const prebuiltXml = record.fields[bundleField];
      if (prebuiltXml && typeof prebuiltXml === 'string' && prebuiltXml.trim()) {
        return {
          ok: true,
          mode: 'prebuilt',
          initiatorId: context.initiatorId,
          xml: prebuiltXml,
          source: 'Content Initiator bundle field'
        };
      }

      // Assemble from linked resources
      const personas = record.fields['Personas'] || [];
      const domains = record.fields['Content Domains'] || [];
      const entities = record.fields['Entity'] || [];
      const references = record.fields['References'] || [];

      const xmlParts = [`<bundle>`, `  <initiator id="${context.initiatorId}">`];

      if (record.fields['Goal']) xmlParts.push(`    <goal>${record.fields['Goal']}</goal>`);
      if (record.fields['Content Type']) xmlParts.push(`    <contentType>${record.fields['Content Type']}</contentType>`);
      if (record.fields['Output Type']) xmlParts.push(`    <outputType>${record.fields['Output Type']}</outputType>`);

      xmlParts.push(`  </initiator>`);

      // Add linked resources (IDs only - actual XML would require additional fetches)
      if (personas.length > 0) {
        xmlParts.push(`  <personas linkedIds="${personas.join(',')}" />`);
      }
      if (domains.length > 0) {
        xmlParts.push(`  <domains linkedIds="${domains.join(',')}" />`);
      }
      if (entities.length > 0) {
        xmlParts.push(`  <entities linkedIds="${entities.join(',')}" />`);
      }
      if (references.length > 0) {
        xmlParts.push(`  <references linkedIds="${references.join(',')}" />`);
      }

      xmlParts.push(`</bundle>`);

      return {
        ok: true,
        mode: 'assembled',
        initiatorId: context.initiatorId,
        xml: xmlParts.join('\n'),
        linkedResources: { personas, domains, entities, references }
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
});

/**
 * Create Content Request - Creates a new Content Initiator
 */
export const airtableCreateContentRequest = createTool({
  id: 'airtable.createContentRequest',
  description: 'Create a new Content Initiator with persona/domain links. Returns created record ID.',
  inputSchema: z.object({
    baseId: z.string().optional().describe('Airtable Base ID (defaults to env)'),
    goal: z.string().describe('Content goal/objective'),
    contentType: z.string().optional().describe('Type of content (blog, social, video, etc.)'),
    outputType: z.string().optional().describe('Output format'),
    personaSlugs: z.array(z.string()).optional().describe('Persona slugs to link'),
    domainSlugs: z.array(z.string()).optional().describe('Domain slugs to link'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const baseId = context.baseId || process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_CONTENT_BASE_ID;
    if (!baseId) {
      return { ok: false, skipped: true, reason: 'No Airtable Base ID configured' };
    }

    const initiatorTable = process.env.AIRTABLE_TABLE_CONTENT_INITIATORS || 'Content Initiators';

    const fields: Record<string, any> = {
      Goal: context.goal,
    };

    if (context.contentType) fields['Content Type'] = context.contentType;
    if (context.outputType) fields['Output Type'] = context.outputType;

    // Note: Linking requires record IDs, not slugs. In production, you'd query first to get IDs
    // For now, we'll include slugs in a note field
    if (context.personaSlugs && context.personaSlugs.length > 0) {
      fields['Persona Slugs (Note)'] = context.personaSlugs.join(', ');
    }
    if (context.domainSlugs && context.domainSlugs.length > 0) {
      fields['Domain Slugs (Note)'] = context.domainSlugs.join(', ');
    }

    try {
      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(initiatorTable)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [{ fields }],
          typecast: true
        })
      });

      if (!res.ok) {
        return { ok: false, status: res.status, reason: await res.text() };
      }

      const result: any = await res.json();
      return {
        ok: true,
        recordId: result.records[0].id,
        fields: result.records[0].fields
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
});

/**
 * Get Persona Context - Returns persona XML by slug
 */
export const airtableGetPersonaContext = createTool({
  id: 'airtable.getPersonaContext',
  description: 'Fetch persona XML by slug. Returns persona voice, style, and constraints.',
  inputSchema: z.object({
    baseId: z.string().optional().describe('Airtable Base ID (defaults to env)'),
    slug: z.string().describe('Persona slug'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const baseId = context.baseId || process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_CONTENT_BASE_ID;
    if (!baseId) {
      return { ok: false, skipped: true, reason: 'No Airtable Base ID configured' };
    }

    const personaTable = process.env.AIRTABLE_TABLE_PERSONAS || 'Personas';
    const xmlField = process.env.AIRTABLE_FIELD_PERSONA_XML || 'XML Bundle';

    try {
      const slug = context.slug.toLowerCase().replace(/"/g, '\\"');
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(personaTable)}`);
      url.searchParams.set('filterByFormula', `LOWER({Slug})="${slug}"`);

      const res = await fetch(url.toString(), { headers });

      if (!res.ok) {
        return { ok: false, status: res.status, reason: await res.text() };
      }

      const data: any = await res.json();
      const records = data.records || [];

      if (records.length === 0) {
        return { ok: false, reason: `No persona found with slug: ${context.slug}` };
      }

      const persona = records[0];
      return {
        ok: true,
        slug: context.slug,
        xml: persona.fields[xmlField] || '',
        name: persona.fields['Name'] || '',
        recordId: persona.id
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
});

/**
 * Get Domain Knowledge - Returns domain XML by slug
 */
export const airtableGetDomainKnowledge = createTool({
  id: 'airtable.getDomainKnowledge',
  description: 'Fetch domain expertise XML by slug. Returns domain-specific knowledge and constraints.',
  inputSchema: z.object({
    baseId: z.string().optional().describe('Airtable Base ID (defaults to env)'),
    slug: z.string().describe('Domain slug'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const baseId = context.baseId || process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_CONTENT_BASE_ID;
    if (!baseId) {
      return { ok: false, skipped: true, reason: 'No Airtable Base ID configured' };
    }

    const domainTable = process.env.AIRTABLE_TABLE_DOMAINS || 'Content Domains';
    const xmlField = process.env.AIRTABLE_FIELD_DOMAIN_XML || 'XML Bundle';

    try {
      const slug = context.slug.toLowerCase().replace(/"/g, '\\"');
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(domainTable)}`);
      url.searchParams.set('filterByFormula', `LOWER({Slug})="${slug}"`);

      const res = await fetch(url.toString(), { headers });

      if (!res.ok) {
        return { ok: false, status: res.status, reason: await res.text() };
      }

      const data: any = await res.json();
      const records = data.records || [];

      if (records.length === 0) {
        return { ok: false, reason: `No domain found with slug: ${context.slug}` };
      }

      const domain = records[0];
      return {
        ok: true,
        slug: context.slug,
        xml: domain.fields[xmlField] || '',
        name: domain.fields['Name'] || '',
        recordId: domain.id
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
});

/**
 * Update Content Output - Writes generated content back to Content Initiator
 */
export const airtableUpdateContentOutput = createTool({
  id: 'airtable.updateContentOutput',
  description: 'Update Content Initiator with generated content and metadata.',
  inputSchema: z.object({
    baseId: z.string().optional().describe('Airtable Base ID (defaults to env)'),
    initiatorId: z.string().describe('Content Initiator record ID'),
    output: z.string().describe('Generated content'),
    status: z.string().optional().describe('Status (e.g., "Generated", "Ready for Review")'),
    metadata: z.record(z.any()).optional().describe('Additional metadata to store'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const baseId = context.baseId || process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_CONTENT_BASE_ID;
    if (!baseId) {
      return { ok: false, skipped: true, reason: 'No Airtable Base ID configured' };
    }

    const initiatorTable = process.env.AIRTABLE_TABLE_CONTENT_INITIATORS || 'Content Initiators';

    const fields: Record<string, any> = {
      Output: context.output,
    };

    if (context.status) fields['Status'] = context.status;
    if (context.metadata) {
      fields['Metadata (JSON)'] = JSON.stringify(context.metadata);
    }

    try {
      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(initiatorTable)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          records: [{
            id: context.initiatorId,
            fields
          }],
          typecast: true
        })
      });

      if (!res.ok) {
        return { ok: false, status: res.status, reason: await res.text() };
      }

      const result: any = await res.json();
      return {
        ok: true,
        updated: true,
        recordId: context.initiatorId,
        fields: result.records[0].fields
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
});

/**
 * Get Hydrated Content Context - Fully hydrated XML bundle with embedded context
 *
 * Fetches initiator and ALL linked resources (Personas, Domains, Entities, References)
 * in one deterministic call, embedding actual XML instead of just IDs.
 */
export const airtableGetHydratedContentContext = createTool({
  id: 'airtable.getHydratedContentContext',
  description: 'Return fully hydrated XML bundle for Content Initiator: includes goal, content+output types, and embedded XML from linked Personas, Domains, Entities, References.',
  inputSchema: z.object({
    initiatorId: z.string().describe('Content Initiator record ID'),
    baseId: z.string().optional().describe('Airtable Base ID (defaults to env)'),
  }),
  execute: async ({ context }) => {
    const headers = airtableHeadersOrNull();
    if (!headers) {
      return { ok: false, skipped: true, reason: 'Airtable not configured (no PAT/API key)' };
    }

    const baseId = context.baseId || process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_CONTENT_BASE_ID;
    if (!baseId) {
      return { ok: false, skipped: true, reason: 'No Airtable Base ID configured' };
    }

    try {
      // 1) Fetch initiator by ID
      const initiatorTable = process.env.AIRTABLE_TABLE_CONTENT_INITIATORS || 'Content Initiators';
      const initUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(initiatorTable)}/${context.initiatorId}`;
      const initRes = await fetch(initUrl, { headers });
      if (!initRes.ok) {
        return { ok: false, status: initRes.status, reason: await initRes.text() };
      }
      const init: any = await initRes.json();

      // 2) Gather linked IDs
      const personas: string[] = init.fields['Personas'] || [];
      const domains: string[] = init.fields['Content Domains'] || [];
      const entities: string[] = init.fields['Entity'] || [];
      const references: string[] = init.fields['References'] || [];

      // 3) Helper to fetch XML by record IDs
      async function fetchByIds(table: string, ids: string[], xmlField = 'XML Bundle'): Promise<string[]> {
        const results: any[] = [];
        for (const id of ids) {
          const u = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${id}`;
          // headers is guaranteed non-null by check above
          const r = await fetch(u, { headers: headers! });
          if (r.ok) {
            const record = await r.json();
            results.push(record);
          }
        }
        return results
          .map(r => (r?.fields?.[xmlField] || '') as string)
          .filter(Boolean);
      }

      // 4) Fetch XML snippets from linked resources
      const personaXml = await fetchByIds(
        process.env.AIRTABLE_TABLE_PERSONAS || 'Personas',
        personas,
        'XML Bundle'
      );
      const domainXml = await fetchByIds(
        process.env.AIRTABLE_TABLE_DOMAINS || 'Content Domains',
        domains,
        'XML Bundle'
      );
      const entityXml = await fetchByIds(
        process.env.AIRTABLE_TABLE_ENTITIES || 'Entity',
        entities,
        'XML'
      );
      const referenceXml = await fetchByIds(
        process.env.AIRTABLE_TABLE_REFERENCES || 'References',
        references,
        'XML'
      );

      // 5) Assemble bundle with embedded XML content
      const xmlParts = [
        `<bundle>`,
        `  <initiator id="${context.initiatorId}">`,
      ];

      if (init.fields['Goal']) {
        xmlParts.push(`    <goal>${init.fields['Goal']}</goal>`);
      }
      if (init.fields['Content Type']) {
        xmlParts.push(`    <contentType>${init.fields['Content Type']}</contentType>`);
      }
      if (init.fields['Output Type']) {
        xmlParts.push(`    <outputType>${init.fields['Output Type']}</outputType>`);
      }

      xmlParts.push(`  </initiator>`);

      // Embed persona XML
      if (personaXml.length > 0) {
        xmlParts.push(`  <personas>`);
        personaXml.forEach(xml => {
          xmlParts.push(`    ${xml}`);
        });
        xmlParts.push(`  </personas>`);
      }

      // Embed domain XML
      if (domainXml.length > 0) {
        xmlParts.push(`  <domains>`);
        domainXml.forEach(xml => {
          xmlParts.push(`    ${xml}`);
        });
        xmlParts.push(`  </domains>`);
      }

      // Embed entity XML
      if (entityXml.length > 0) {
        xmlParts.push(`  <entities>`);
        entityXml.forEach(xml => {
          xmlParts.push(`    ${xml}`);
        });
        xmlParts.push(`  </entities>`);
      }

      // Embed reference XML
      if (referenceXml.length > 0) {
        xmlParts.push(`  <references>`);
        referenceXml.forEach(xml => {
          xmlParts.push(`    ${xml}`);
        });
        xmlParts.push(`  </references>`);
      }

      xmlParts.push(`</bundle>`);

      const xml = xmlParts.filter(Boolean).join('\n');

      return {
        ok: true,
        mode: 'hydrated',
        initiatorId: context.initiatorId,
        xml,
        linkedCounts: {
          personas: personaXml.length,
          domains: domainXml.length,
          entities: entityXml.length,
          references: referenceXml.length,
        }
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
});
