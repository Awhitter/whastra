import express from 'express';
import cors from 'cors';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { contentAgent } from './mastra/agent.js';

const app = express();
const PORT = Number(process.env.PORT || 3104);

// Initialize Mastra with content agent
const mastra = new Mastra({
  agents: { contentAgent },
  logger: new PinoLogger(),
  observability: { default: { enabled: true } },
  telemetry: { enabled: true }, // harmless warning in current Mastra, safe to keep
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    agent: 'content',
    timestamp: new Date().toISOString(),
  });
});

// Chat endpoint (LLM-directed tool use)
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: expected { messages: [{ role, content }] }',
        example: { messages: [{ role: 'user', content: 'Generate for rec123...' }] },
      });
    }

    const agent = mastra.getAgent('contentAgent');
    const result = await agent.generate(messages);

    return res.json({
      response: result.text,
      metadata: {
        agent: 'content',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[content] /chat error:', error);
    return res.status(500).json({
      error: 'Failed to process chat request',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Direct content generation endpoint (guides the LLM to the single hydrated tool)
app.post('/generate', async (req, res) => {
  try {
    const { initiatorId, baseId } = req.body ?? {};

    if (typeof initiatorId !== 'string' || initiatorId.trim() === '') {
      return res.status(400).json({ error: 'Missing required field: initiatorId (string)' });
    }

    const agent = mastra.getAgent('contentAgent');

    // Updated instructions: use the HYDRATED tool, not the old bundle fetcher
    const prompt = `Generate content for Content Initiator: ${initiatorId}${
      baseId ? ` in base ${baseId}` : ''
    }.

Follow these steps carefully:
1) Call **airtableGetHydratedContentContext** with { initiatorId${baseId ? ', baseId' : ''} } to fetch the FULLY HYDRATED XML bundle (initiator + linked Personas/Domains/Entities/References with embedded XML).
2) Parse the XML to extract the goal, contentType, outputType, persona voice/style, and domain constraints.
3) Generate the content to exactly match the persona voice and domain rules.
4) Save the generated content back with **airtableUpdateContentOutput** { initiatorId, output, status: "Generated" }.
5) Return a one-paragraph summary of what was generated (not the full content).`;

    const result = await agent.generate([{ role: 'user', content: prompt }]);

    return res.json({
      response: result.text,
      metadata: {
        agent: 'content',
        initiatorId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[content] /generate error:', error);
    return res.status(500).json({
      error: 'Failed to generate content',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✍️  Content Agent running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`💬 Chat:   http://localhost:${PORT}/chat`);
  console.log(`🎨 Generate: http://localhost:${PORT}/generate`);
});
