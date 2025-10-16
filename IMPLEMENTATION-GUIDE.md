# AgentBox v1 Implementation Guide

## Overview

This guide documents the pragmatic fixes applied to make AgentBox v1 production-ready. These changes address critical issues with Docker builds, gateway routing, and integration patterns.

---

## What Was Fixed

### 1. Docker Build Context ✅
**Problem**: Build context was scoped to individual agent directories, preventing access to `core/shared` tools.

**Solution**:
- Changed build context to repository root in `docker-compose.yml`
- Updated `agents/research/Dockerfile` to work with root context
- Added TypeScript compilation step: `npx tsc -p core/shared/tsconfig.json`
- Runtime copies compiled JS from `core/shared/dist` instead of TypeScript sources

**Files Modified**:
- `infrastructure/docker-compose.yml` - Set `context: ..` (repo root)
- `agents/research/Dockerfile` - Added compilation step, updated COPY paths
- `core/shared/tsconfig.json` - Created for tool compilation

### 2. Gateway Proxy Routing ✅
**Problem**: Gateway returned placeholder responses instead of routing to actual agents.

**Solution**: Implemented real HTTP proxy using `fetch()` to forward requests to agent containers.

**Files Modified**:
- `core/gateway/src/index.ts` - Added real proxy implementation

**Key Implementation**:
```typescript
const AGENTS: Record<string, string> = {
  research: process.env.AGENT_RESEARCH_URL || 'http://agentbox-research:3001',
};

app.post('/agents/:agentName/chat', async (req, res) => {
  const { agentName } = req.params;
  const base = AGENTS[agentName];
  const { messages } = req.body || {};

  if (!base) {
    return res.status(404).json({ error: `Unknown agent '${agentName}'` });
  }

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
    return res.status(502).json({
      error: 'Agent unavailable',
      agent: agentName,
      details: err?.message
    });
  }
});
```

### 3. PostgreSQL Extensions ✅
**Problem**: `init.sql` was missing the `pgcrypto` extension required for `gen_random_uuid()`.

**Solution**: Added `CREATE EXTENSION IF NOT EXISTS pgcrypto;`

**Files Modified**:
- `infrastructure/postgres/init.sql` - Added pgcrypto extension

### 4. Docker Network Configuration ✅
**Problem**: Containers couldn't communicate with external MindsDB stack.

**Solution**:
- Added external network `agentbox_net` to `docker-compose.yml`
- Gateway and agents now connect to this shared network
- MindsDB stack can join same network for cross-stack communication

**Files Modified**:
- `infrastructure/docker-compose.yml` - Added `networks: [default, agentbox_net]`

### 5. Non-Existent Agent References ✅
**Problem**: `docker-compose.yml` referenced coordinator and content agents that don't exist yet.

**Solution**:
- Removed references to `coordinator-agent` and `content-agent`
- Added comment explaining they're removed until implemented
- Kept research agent with proper profiles for selective startup

**Files Modified**:
- `infrastructure/docker-compose.yml` - Removed non-existent agents

### 6. Optional-First Integration Pattern ✅
**Problem**: Tools would crash if optional services (n8n, Airtable, Qdrant) weren't configured.

**Solution**: Implemented graceful degradation pattern - tools return `{ ok: false, skipped: true, reason: '...' }` when env vars not set.

**Files Modified**:
- `core/shared/tools/n8n.ts` - Added N8N_WEBHOOK_BASE check

**Pattern Example**:
```typescript
execute: async ({ context }) => {
  if (!process.env.N8N_WEBHOOK_BASE) {
    return {
      ok: false,
      skipped: true,
      reason: 'N8N_WEBHOOK_BASE not configured. Set this env var to enable n8n workflow automation.'
    };
  }
  // ... rest of implementation
}
```

---

## Setup Instructions

### Prerequisites
- Docker and Docker Compose installed
- Node.js 20+ (for local development)
- PostgreSQL client (optional, for database inspection)

### Step 1: Create External Docker Network

This network allows AgentBox containers to communicate with your separate MindsDB stack:

```bash
docker network create agentbox_net
```

### Step 2: Configure Environment Variables

Navigate to infrastructure directory:
```bash
cd agentbox-v1/infrastructure
```

Create/verify `.env` file with required variables:

**Required**:
```env
# PostgreSQL
PG_USER=agentbox
PG_PASSWORD=your_secure_password
POSTGRES_DB=agentbox

# MindsDB
MINDSDB_PASSWORD=your_mindsdb_password

# n8n
N8N_USER=admin
N8N_PASSWORD=your_n8n_password

# AI Providers (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

**Optional** (for enhanced functionality):
```env
# n8n Workflow Automation (optional)
N8N_WEBHOOK_BASE=http://agentbox-n8n:5678/webhook

# Airtable Integration (optional)
AIRTABLE_API_KEY=key...
AIRTABLE_BASE_ID=app...

# Qdrant Vector DB (optional)
QDRANT_URL=http://agentbox-qdrant:6333
QDRANT_API_KEY=your_key
```

### Step 3: Build Infrastructure Services

Start core infrastructure (PostgreSQL, Redis, Qdrant, MindsDB, n8n, Gateway):

```bash
cd agentbox-v1/infrastructure
docker compose up -d
```

This starts:
- `agentbox-postgres` (port 5432) - PostgreSQL with pgvector
- `agentbox-redis` (port 6379) - Redis cache
- `agentbox-qdrant` (ports 6333, 6334) - Vector database
- `agentbox-mindsdb` (port 47334) - AI model predictor
- `agentbox-n8n` (port 5678) - Workflow automation
- `agentbox-gateway` (port 8000) - API gateway

**Verify services are healthy**:
```bash
docker compose ps
docker compose logs gateway
```

Expected output: All services should show "healthy" or "running" status.

### Step 4: Build Research Agent

The research agent uses the `research` profile for selective startup:

```bash
docker compose --profile research up -d research-agent
```

This builds from repo root context, compiles shared tools, and starts the agent.

**Verify research agent is running**:
```bash
docker compose --profile research ps research-agent
docker compose logs research-agent
```

Expected output:
```
🤖 Research Agent running on port 3001
Health: http://localhost:3001/health
```

---

## Smoke Testing

### Test 1: Infrastructure Health Checks

```bash
# Gateway health
curl http://localhost:8000/health

# Expected response:
{
  "status": "healthy",
  "service": "agentbox-gateway",
  "timestamp": "2025-01-14T...",
  "uptime": 123.45
}

# List available agents
curl http://localhost:8000/agents

# Expected response:
{
  "agents": [
    {
      "name": "research",
      "endpoint": "/agents/research/chat",
      "status": "available"
    }
  ]
}
```

### Test 2: Research Agent Direct Access

```bash
# Test research agent directly (bypassing gateway)
curl -X POST http://localhost:3001/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are the top states with Full Practice Authority for nurse practitioners?"
      }
    ]
  }'
```

Expected: JSON response with research agent's answer about FPA states.

### Test 3: Gateway Proxy Routing

```bash
# Test gateway routing to research agent
curl -X POST http://localhost:8000/agents/research/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Research cost of living adjusted wages for nurses in Oregon vs Texas"
      }
    ]
  }'
```

Expected: Gateway should proxy request to research agent and return response.

### Test 4: Optional Tool Degradation

If n8n is not configured (N8N_WEBHOOK_BASE not set), the agent should still respond but skip n8n tools:

```bash
# In .env, comment out N8N_WEBHOOK_BASE
# Rebuild agent: docker compose --profile research up -d --build research-agent

curl -X POST http://localhost:8000/agents/research/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Trigger a recruiting campaign"
      }
    ]
  }'
```

Expected: Agent responds explaining n8n is not configured, but doesn't crash.

### Test 5: PostgreSQL Schema Verification

```bash
# Connect to PostgreSQL
docker exec -it agentbox-postgres psql -U agentbox -d agentbox

# Verify extensions
SELECT * FROM pg_extension WHERE extname IN ('vector', 'pgcrypto');

# Expected: Both extensions should be listed

# Verify schemas
\dn

# Expected schemas:
# - agent_memory
# - workflow_state
# - user_data
# - rag_knowledge
# - analytics

# Test UUID generation
SELECT gen_random_uuid();

# Expected: Returns a UUID (verifies pgcrypto works)

\q
```

---

## Troubleshooting

### Problem: "Cannot access core/shared" during Docker build

**Symptom**:
```
ERROR [builder 5/6] COPY core/shared ./core/shared/
failed to compute cache key: "/core/shared" not found
```

**Solution**:
- Ensure docker-compose.yml has `context: ..` (repo root, not agent directory)
- Run build from `infrastructure/` directory: `docker compose --profile research build research-agent`

### Problem: Gateway returns 502 "Agent unavailable"

**Symptom**:
```json
{
  "error": "Agent unavailable",
  "agent": "research",
  "details": "fetch failed"
}
```

**Diagnosis**:
```bash
# Check if research agent is running
docker compose --profile research ps research-agent

# Check research agent logs
docker compose logs research-agent

# Check if containers are on same network
docker network inspect agentbox_net
```

**Common Causes**:
1. Research agent not started with `--profile research`
2. Research agent container crashed (check logs)
3. Research agent not on `agentbox_net` network

### Problem: PostgreSQL "function gen_random_uuid() does not exist"

**Symptom**:
```
ERROR: function gen_random_uuid() does not exist
```

**Solution**:
```bash
# Verify pgcrypto extension is installed
docker exec -it agentbox-postgres psql -U agentbox -d agentbox -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# If init.sql wasn't run, manually execute it:
docker exec -i agentbox-postgres psql -U agentbox -d agentbox < infrastructure/postgres/init.sql
```

### Problem: n8n tool crashes agent

**Symptom**: Agent crashes when trying to trigger n8n workflow.

**Solution**:
- Verify `N8N_WEBHOOK_BASE` is set in `.env` (or remove it for optional behavior)
- Ensure n8n.ts has optional-first pattern (should be fixed in latest version)
- Check n8n logs: `docker compose logs n8n`

### Problem: MindsDB not accessible from agents

**Symptom**: Agents can't connect to MindsDB on port 47334.

**Solution**:
```bash
# Ensure MindsDB stack is on agentbox_net network
docker network connect agentbox_net mindsdb-container-name

# Verify network connectivity
docker exec agentbox-research ping agentbox-mindsdb

# Check MindsDB logs
docker logs agentbox-mindsdb
```

### Problem: Build fails with TypeScript errors

**Symptom**:
```
error TS2307: Cannot find module '@mastra/core'
```

**Solution**:
```bash
# Ensure package.json has correct dependencies
cd agents/research
npm install

# Rebuild with no cache
docker compose --profile research build --no-cache research-agent
```

---

## Next Steps

### 1. Add More Agents

To add content or coordinator agents:

1. Create agent directory: `agents/content/` or `agents/coordinator/`
2. Copy structure from `agents/research/` (package.json, tsconfig.json, src/, Dockerfile)
3. Add agent entry to `docker-compose.yml`:
```yaml
content-agent:
  build:
    context: ..
    dockerfile: agents/content/Dockerfile
  container_name: agentbox-content
  env_file: .env
  profiles: ["agents", "content"]
  networks: [default, agentbox_net]
```
4. Add route to gateway `core/gateway/src/index.ts`:
```typescript
const AGENTS: Record<string, string> = {
  research: process.env.AGENT_RESEARCH_URL || 'http://agentbox-research:3001',
  content: process.env.AGENT_CONTENT_URL || 'http://agentbox-content:3002',
};
```

### 2. Add Optional Tools

Create tools following the optional-first pattern:

**Airtable Tool** (`core/shared/tools/airtable.ts`):
```typescript
export const airtableSearch = createTool({
  id: 'airtable.search',
  description: 'Search Airtable base for nurse candidates',
  inputSchema: z.object({
    filter: z.string(),
  }),
  execute: async ({ context }) => {
    if (!process.env.AIRTABLE_API_KEY) {
      return {
        ok: false,
        skipped: true,
        reason: 'AIRTABLE_API_KEY not configured'
      };
    }
    // ... implementation
  }
});
```

**Qdrant Tool** (`core/shared/tools/qdrant.ts`):
```typescript
export const qdrantSearch = createTool({
  id: 'qdrant.search',
  description: 'Semantic search over knowledge base',
  inputSchema: z.object({
    query: z.string(),
    collection: z.string(),
  }),
  execute: async ({ context }) => {
    if (!process.env.QDRANT_URL) {
      return {
        ok: false,
        skipped: true,
        reason: 'QDRANT_URL not configured'
      };
    }
    // ... implementation
  }
});
```

### 3. Integrate MindsDB Predictors

Update research agent to use MindsDB for predictions:

```typescript
import { MindsDB } from '@mastra/core/integrations/mindsdb';

const mindsdb = new MindsDB({
  host: process.env.MINDSDB_HOST || 'agentbox-mindsdb',
  port: 47334,
});

// Example: Predict nurse candidate quality score
const prediction = await mindsdb.query(`
  SELECT
    candidate_id,
    quality_score,
    likelihood_to_accept
  FROM nurse_quality_predictor
  WHERE state IN ('OR', 'MN', 'NM')
  AND specialty = 'ICU'
`);
```

### 4. Set Up n8n Workflows

Create n8n workflows for automation:

1. Access n8n UI: `http://localhost:5678`
2. Login with credentials from `.env` (N8N_USER, N8N_PASSWORD)
3. Create workflows:
   - **Repurposer**: Webhook → Content Transformation → Multi-Platform Post
   - **Recruiting Autopilot**: Webhook → Candidate Search → Outreach Sequence
4. Copy webhook URLs and set `N8N_WEBHOOK_BASE` in `.env`
5. Restart agents to pick up new webhook URLs

### 5. Production Deployment with TLS

This section provides the **one clear path** from local development to production with HTTPS.

#### Prerequisites

1. **VPS or Cloud Server** - DigitalOcean, AWS EC2, Hetzner, etc.
2. **Domain Name** - Registered and ready to point
3. **Docker & Docker Compose** - Installed on server
4. **Ports Open** - 80 (HTTP), 443 (HTTPS), 8000 (optional for direct gateway access)

#### Step 1: DNS Configuration

Point your domain to your server's IP address:

```
# Add these DNS records at your domain registrar
A     api.yourdomain.com    →  your.server.ip.address
A     n8n.yourdomain.com    →  your.server.ip.address  (if exposing n8n)
```

**Verify DNS propagation:**
```bash
dig api.yourdomain.com +short
# Should return your server IP
```

#### Step 2: Choose Reverse Proxy

**Option A: Caddy (Recommended - Automatic HTTPS)**

Create `/etc/caddy/Caddyfile` on your server:

```caddy
# AgentBox Gateway - Main API
api.yourdomain.com {
    # Automatic HTTPS with Let's Encrypt
    reverse_proxy localhost:8000

    # Optional: Rate limiting
    @api path /agents/*
    rate_limit @api {
        zone api_limit
        rate 100r/m
    }

    # Logging
    log {
        output file /var/log/caddy/api.log
        format json
    }
}

# n8n Workflow Automation (optional)
n8n.yourdomain.com {
    reverse_proxy localhost:5678

    # Basic auth (Caddy level, in addition to n8n auth)
    basicauth {
        admin $2a$14$your_bcrypt_hash_here
    }
}
```

**Install & Start Caddy:**
```bash
# Install Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Start Caddy
sudo systemctl enable caddy
sudo systemctl start caddy
sudo systemctl status caddy

# Caddy automatically obtains Let's Encrypt certificates!
```

**Option B: Nginx with Certbot**

Create `/etc/nginx/sites-available/agentbox`:

```nginx
# AgentBox Gateway
server {
    listen 80;
    server_name api.yourdomain.com;

    # Certbot will add HTTPS config here
    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long agent requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**Install & Configure:**
```bash
# Install Nginx and Certbot
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx

# Enable site
sudo ln -s /etc/nginx/sites-available/agentbox /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Obtain TLS certificate
sudo certbot --nginx -d api.yourdomain.com
# Follow prompts, certbot automatically configures HTTPS

# Enable auto-renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

#### Step 3: Deploy AgentBox

**1. Clone repository on server:**
```bash
cd /opt
git clone <your-repo-url> agentbox
cd agentbox/agentbox-v1
```

**2. Create Docker network:**
```bash
# CRITICAL: Create this network before docker compose up
docker network create agentbox_net
```

**3. Configure production environment:**
```bash
cd infrastructure
cp .env.example .env
nano .env
```

**Update for production:**
```bash
# Set NODE_ENV to production
NODE_ENV=production

# Generate new GATEWAY_SECRET
GATEWAY_SECRET=$(openssl rand -base64 32)

# Use strong passwords (generate with: openssl rand -base64 24)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
REDIS_PASSWORD=$(openssl rand -base64 24)
MINDSDB_PASSWORD=$(openssl rand -base64 24)

# LLM providers
ANTHROPIC_API_KEY=sk-ant-...  # Your Anthropic key for Claude Sonnet 4.5
OPENAI_API_KEY=sk-...         # Your OpenAI key (if using GPT-5)

# Airtable (if using)
AIRTABLE_PAT=pat...           # Your Airtable Personal Access Token
AIRTABLE_CONTENT_HUB_BASE_ID=app...
# ... other Airtable config
```

**4. Start infrastructure:**
```bash
docker compose up -d postgres redis qdrant mindsdb n8n gateway
```

**5. Verify services:**
```bash
docker compose ps
# All services should show "healthy" or "running"

# Check gateway logs
docker compose logs gateway
```

**6. Test local access:**
```bash
curl http://localhost:8000/health
# Should return: {"status":"healthy","service":"agentbox-gateway",...}
```

**7. Test public HTTPS access:**
```bash
curl https://api.yourdomain.com/health
# Should return same healthy response

# Test with authentication
curl https://api.yourdomain.com/agents \
  -H "x-api-key: your_gateway_secret_from_env"
```

#### Step 4: Launch Agents

```bash
# From agentbox-v1/infrastructure directory
docker compose --profile research up -d research-agent

# View logs
docker compose logs -f research-agent
```

#### Step 5: Test End-to-End

```bash
# Test research agent via public HTTPS gateway
curl -X POST https://api.yourdomain.com/agents/research/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_gateway_secret" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are the top 3 states for nurse practitioners with Full Practice Authority and best cost-of-living adjusted wages?"
      }
    ]
  }'
```

**Expected Response:**
```json
{
  "response": "Based on current data, the top 3 states are:\n\n1. **Oregon**...",
  "sources": [...],
  "processingTime": 3421
}
```

#### Production Environment Variables

**Minimal required for production:**
```bash
# Core
NODE_ENV=production
GATEWAY_PORT=8000
GATEWAY_SECRET=<your-secure-secret>

# Database
POSTGRES_USER=agentbox
POSTGRES_PASSWORD=<secure-password>
POSTGRES_DB=agentbox

# Redis
REDIS_URL=redis://redis:6379
REDIS_PASSWORD=<secure-password>

# LLM Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-...  # For Claude Sonnet 4.5
# OR
OPENAI_API_KEY=sk-...         # For GPT-5

# MindsDB
MINDSDB_PASSWORD=<secure-password>
MINDSDB_URL=http://mindsdb:47334

# Qdrant
QDRANT_URL=http://qdrant:6333
```

**Optional but recommended:**
```bash
# Observability
MASTRA_CLOUD_ACCESS_TOKEN=eyJ...  # For traces/logs

# Web search (for research agent)
TAVILY_API_KEY=tvly-...

# n8n Workflows
N8N_USER=admin
N8N_PASSWORD=<secure-password>
N8N_WEBHOOK_BASE=http://n8n:5678/webhook

# Airtable (personas, content, CRM)
AIRTABLE_PAT=pat...
AIRTABLE_CONTENT_HUB_BASE_ID=app...
```

#### Security Hardening

**1. Firewall Configuration:**
```bash
# Allow only necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (for certbot)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

**2. Docker Security:**
```bash
# Don't expose ports directly to internet
# Use reverse proxy (Caddy/Nginx) instead
# In docker-compose.yml, bind to localhost only:
ports: ["127.0.0.1:8000:8000"]  # NOT 0.0.0.0:8000
```

**3. Regular Updates:**
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Docker images
cd /opt/agentbox/agentbox-v1/infrastructure
docker compose pull
docker compose up -d
```

**4. Monitoring:**
```bash
# Install fail2ban for SSH protection
sudo apt install fail2ban

# Setup log monitoring (optional)
sudo apt install logwatch
```

#### Rollback Plan

If deployment fails, rollback quickly:

```bash
# Stop all services
cd /opt/agentbox/agentbox-v1/infrastructure
docker compose down

# Check logs for errors
docker compose logs > /tmp/agentbox-error.log

# Restart with previous version
git checkout <previous-commit>
docker compose up -d
```

#### Maintenance Commands

```bash
# View all logs
docker compose logs -f

# Restart specific service
docker compose restart gateway

# Update to latest code
git pull origin main
docker compose up -d --build

# Backup database
docker exec agentbox-postgres pg_dump -U agentbox agentbox > backup-$(date +%Y%m%d).sql

# Restore database
cat backup-20251014.sql | docker exec -i agentbox-postgres psql -U agentbox agentbox
```

### 6. Monitoring and Analytics

**Log Aggregation**:
```bash
# Aggregate logs to external service
docker compose logs -f | docker run -i --rm my-log-forwarder
```

**Metrics**:
- Use `analytics.agent_metrics` table for performance tracking
- Set up Grafana dashboards for agent response times
- Monitor `analytics.api_calls` for usage patterns

**Alerting**:
- Set up healthcheck monitoring (UptimeRobot, Pingdom)
- Alert on container crashes or 502 errors
- Monitor PostgreSQL connection pool saturation

---

## Architecture Diagrams

### Request Flow

```
User Request
    ↓
Frontend (Next.js)
    ↓
API Gateway (port 8000)
    ↓
Agent Router
    ↓
┌─────────┬─────────┬────────────┐
│Research │ Content │Coordinator │
│ :3001   │ :3002   │   :3200    │
└────┬────┴────┬────┴──────┬─────┘
     │         │           │
     └─────────┴───────────┘
               ↓
    ┌──────────────────────┐
    │  Shared Services     │
    │  - PostgreSQL        │
    │  - Redis (cache)     │
    │  - Qdrant (vectors)  │
    │  - MindsDB (ML)      │
    │  - n8n (workflows)   │
    └──────────────────────┘
```

### Database Schemas

```
agentbox (database)
├── agent_memory (schema)
│   ├── threads (conversations)
│   └── messages (with embeddings)
├── workflow_state (schema)
│   ├── executions (workflow runs)
│   └── steps (individual steps)
├── user_data (schema)
│   ├── users
│   └── api_keys
├── rag_knowledge (schema)
│   ├── documents
│   └── chunks (with embeddings)
└── analytics (schema)
    ├── agent_metrics
    └── api_calls
```

---

## Support and Resources

**Documentation**:
- Mastra Framework: https://mastra.ai/docs
- pgvector: https://github.com/pgvector/pgvector
- n8n: https://docs.n8n.io
- MindsDB: https://docs.mindsdb.com

**Common Commands**:
```bash
# Start all services
docker compose up -d

# Start with specific agent
docker compose --profile research up -d

# View logs
docker compose logs -f gateway
docker compose logs -f research-agent

# Rebuild after code changes
docker compose --profile research build research-agent
docker compose --profile research up -d

# Stop all services
docker compose down

# Stop and remove volumes (CAUTION: deletes data)
docker compose down -v

# Exec into container
docker exec -it agentbox-gateway sh
docker exec -it agentbox-postgres psql -U agentbox -d agentbox
```

---

## Implementation Checklist

Use this checklist to verify your setup:

- [ ] External network created: `docker network create agentbox_net`
- [ ] `.env` file configured with required variables
- [ ] Infrastructure services started: `docker compose up -d`
- [ ] All services show "healthy" status: `docker compose ps`
- [ ] PostgreSQL extensions verified (pgcrypto, vector)
- [ ] Research agent built and running: `docker compose --profile research up -d`
- [ ] Gateway health check passes: `curl localhost:8000/health`
- [ ] Gateway lists research agent: `curl localhost:8000/agents`
- [ ] Research agent direct access works: `curl -X POST localhost:3001/chat ...`
- [ ] Gateway proxy routing works: `curl -X POST localhost:8000/agents/research/chat ...`
- [ ] Optional tools degrade gracefully (test with missing env vars)
- [ ] MindsDB accessible from agents (if using separate stack)
- [ ] n8n workflows created and webhook URLs configured (if using n8n)

---

## Changelog

**2025-01-14** - Initial pragmatic fixes
- Fixed Docker build context to repo root
- Implemented real gateway proxy routing
- Added pgcrypto extension to PostgreSQL
- Created external network for cross-stack communication
- Removed non-existent agent references
- Implemented optional-first pattern for n8n tools
- Created comprehensive implementation documentation

---

*This guide reflects the current pragmatic, working state of AgentBox v1. Future enhancements should maintain backward compatibility and optional-first patterns for integrations.*
