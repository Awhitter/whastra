import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const mindsdbQuery = createTool({
  id: 'mindsdb.query',
  description: 'Run SQL against MindsDB for ML predictions and data insights. Use for student pass probability, job fit scores, market trends.',
  inputSchema: z.object({ sql: z.string() }),
  execute: async ({ context }) => {
    if (!process.env.MINDSDB_URL) {
      return { ok: false, skipped: true, reason: 'MINDSDB_URL not set' };
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.MINDSDB_KEY) headers.Authorization = `Bearer ${process.env.MINDSDB_KEY}`;
    const response = await fetch(`${process.env.MINDSDB_URL}/api/sql/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: context.sql }),
    });
    if (!response.ok) return { ok: false, status: response.status, reason: await response.text() };
    const data = await response.json() as any;
    return {
      ok: true,
      rows: data.data || [],
      columnNames: data.column_names || [],
      rowCount: data.data?.length || 0,
    };
  },
});
