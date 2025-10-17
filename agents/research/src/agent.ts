import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

// ESM requires explicit .js extensions; compiled shared tools live at /core/shared/tools/*.js
import { mindsdbQuery } from '../../../core/shared/tools/mindsdb.js';
import { webSearch, webScrape, extractCitation } from '../../../core/shared/tools/web.js';
import { airtableQuery, airtableCreate, airtableUpdate, airtableFetchPersona } from '../../../core/shared/tools/airtable.js';

/**
 * Research Agent
 * PURPOSE: Source-grounded briefings, evidence packs, citation-heavy research
 * MODELS: Claude 4.5 Sonnet or GPT-5 (picked via env below)
 */

// Mini tool to bundle findings for later indexing
const createEvidencePack = createTool({
  id: 'research.createEvidencePack',
  description: 'Compile research findings into a structured evidence pack for RAG indexing',
  inputSchema: z.object({
    topic: z.string(),
    findings: z.array(z.object({
      claim: z.string(),
      evidence: z.string(),
      source: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    })),
  }),
  execute: async ({ context }) => {
    return {
      topic: context.topic,
      created: new Date().toISOString(),
      findings: context.findings,
      summary: context.findings.map(f => f.claim).join('\n'),
      citations: context.findings.map(f => f.source),
    };
  },
});

// Pick provider + model from env with sensible defaults
function pickModel() {
  const vendor = (process.env.LLM_VENDOR || '').toLowerCase();
  const modelId = process.env.MODEL?.trim();

  if (vendor === 'openai') {
    return openai((modelId || 'gpt-4o') as any);
  }
  if (vendor === 'anthropic') {
    return anthropic((modelId || 'claude-3-5-sonnet-20240620') as any);
  }
  // default to OpenAI if not specified
  return openai((modelId || 'gpt-4o') as any);
}

export const researchAgent = new Agent({
  name: 'researchAgent',
  model: pickModel(),
  instructions: `You are a rigorous researcher and fact-checker.

PRINCIPLES
- Every claim has a source.
- Prefer primary sources and official statistics.
- Tag confidence: high / medium / low.

WORKFLOW
1) Search authoritative sources (web.search).
2) Extract key findings with quotes/data.
3) Cross-check and note disagreements.
4) Query data sources (MindsDB SQL, Airtable).
5) Log findings to Airtable when appropriate.
6) Return executive summary + evidence pack.

OUTPUT
- Executive summary (2–3 sentences)
- Key findings (bulleted, each with citation)
- Actionable recommendations
- Evidence pack for RAG`,
  tools: {
    webSearch,
    webScrape,
    extractCitation,
    mindsdbQuery,
    createEvidencePack,
    airtableQuery,
    airtableCreate,
    airtableUpdate,
  },
});
