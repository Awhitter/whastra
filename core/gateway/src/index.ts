import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

const app = express();
const PORT = Number(process.env.GATEWAY_PORT || 8000);

app.use(cors());
app.use(express.json());

// Optional API key guard for /agents
app.use('/agents', (req, res, next) => {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) return next();
  if (req.header('x-api-key') !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// Map agent service URLs (Docker DNS)
const AGENTS: Record<string, string> = {
  research: process.env.AGENT_RESEARCH_URL || 'http://agentbox-research:3001',
  content: process.env.AGENT_CONTENT_URL || 'http://agentbox-content:3104',
};

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'agentbox-gateway', timestamp: new Date().toISOString() });
});

app.get('/agents', (_req, res) => {
  res.json({ agents: Object.keys(AGENTS).map(name => ({ name, endpoint: `/agents/${name}/chat`, status: 'available' })) });
});

app.post('/agents/:agentName/chat', async (req, res) => {
  const { agentName } = req.params;
  const base = AGENTS[agentName];
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request', expected: { messages: [{ role: 'user', content: 'message' }] } });
  }
  if (!base) return res.status(404).json({ error: `Unknown agent '${agentName}'` });

  try {
    const r = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (err: any) {
    console.error(`[gateway] proxy error → ${agentName}:`, err?.message || err);
    return res.status(502).json({ error: 'Agent unavailable', agent: agentName, details: err?.message });
  }
});

// Content Agent specific: direct generation endpoint
app.post('/agents/content/generate', async (req, res) => {
  const base = AGENTS['content'];
  if (!base) return res.status(404).json({ error: 'Content agent not configured' });

  try {
    const r = await fetch(`${base}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (err: any) {
    console.error('[gateway] content generate error:', err?.message || err);
    return res.status(502).json({ error: 'Content generation failed', details: err?.message });
  }
});

const server = createServer(app);
server.listen(PORT, () => {
  console.log(`🌐 AgentBox Gateway on :${PORT}`);
});
