import express from 'express';
import cors from 'cors';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { researchAgent } from './agent.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Mastra with research agent
const mastra = new Mastra({
  agents: {
    researchAgent,
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
    agent: 'research',
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

    const agent = mastra.getAgent('researchAgent');
    const result = await agent.generate(messages);

    res.json({
      response: result.text,
      metadata: {
        agent: 'research',
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

// Start server
app.listen(PORT, () => {
  console.log(`🔬 Research Agent running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`💬 Chat: http://localhost:${PORT}/chat`);
});
