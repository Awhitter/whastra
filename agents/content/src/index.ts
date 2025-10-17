import express from 'express';
import cors from 'cors';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { contentAgent } from './mastra/agent.js';

const app = express();
const PORT = process.env.PORT || 3104;

// Initialize Mastra with content agent
const mastra = new Mastra({
  agents: {
    contentAgent,
  },
  logger: new PinoLogger(),
  observability: {
    default: { enabled: true },
  },
  telemetry: {
    enabled: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    agent: 'content',
    timestamp: new Date().toISOString(),
  });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Invalid request format',
        expected: { messages: [{ role: 'user', content: 'message' }] },
      });
    }

    const agent = mastra.getAgent('contentAgent');
    const result = await agent.generate(messages);

    res.json({
      response: result.text,
      metadata: {
        agent: 'content',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Failed to process chat request',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Content generation endpoint (specialized)
app.post('/generate', async (req, res) => {
  try {
    const { initiatorId, baseId } = req.body;

    if (!initiatorId) {
      return res.status(400).json({
        error: 'Missing required field: initiatorId',
      });
    }

    const agent = mastra.getAgent('contentAgent');

    // Build prompt for content generation
    const prompt = `Generate content for Content Initiator: ${initiatorId}${baseId ? ` in base ${baseId}` : ''}.

Follow these steps:
1. Use airtableGetContentBundle to fetch the XML bundle
2. Parse the bundle to understand the goal, persona, and domain constraints
3. Generate content that matches the requirements
4. Use airtableUpdateContentOutput to save the result
5. Return a summary of what was generated`;

    const result = await agent.generate([
      { role: 'user', content: prompt }
    ]);

    res.json({
      response: result.text,
      metadata: {
        agent: 'content',
        initiatorId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({
      error: 'Failed to generate content',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✍️  Content Agent running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`💬 Chat: http://localhost:${PORT}/chat`);
  console.log(`🎨 Generate: http://localhost:${PORT}/generate`);
});
