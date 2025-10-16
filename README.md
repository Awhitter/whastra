# AgentBox V1 - Production Agent Platform

**4-Hub Architecture:** Intake → Insight → Agents → Workflows

## Quick Start

```bash
# 1. Copy environment template
cp infrastructure/.env.example infrastructure/.env

# 2. Add your API keys to .env
# 3. Start infrastructure
cd infrastructure
docker compose up -d

# 4. Health check
./scripts/health-check.sh

# 5. Launch agent
./ai mastery research
```

## Architecture

```
Intake Hub    → Apify scrapers + canonical normalization
Insight Hub   → MindsDB (ML predictions + analytics via SQL)
Agent Hub     → Mastra agents (5 premium + 12 standard)
Workflow Hub  → n8n (20-format repurposer + recruiting autopilot)
```

## Definition of Done (V1)

### Infrastructure ✅
- [ ] `docker compose up -d` starts all services
- [ ] Health endpoints return 200

### Intake ✅
- [ ] Apify actor runs → `raw_jobs` table
- [ ] Normalizer fills `canonical_jobs` with state/specialty/comp

### Insight ✅
- [ ] MindsDB models: `student_success_predictor_v1`, `job_fit_predictor`
- [ ] `mindsdb.query` tool works

### Agents ✅
- [ ] 5 premium agents live: Coordinator, Researcher, Content, Growth, Recruiting
- [ ] 3+ shared tools: mindsdb.query, qdrant.retrieve, n8n.trigger

### Workflows ✅
- [ ] Repurposer: 1 input → 10+ assets with brand KB
- [ ] Recruiting: 1 outreach batch driven by FPA+COL+comp

### Surfaces ✅
- [ ] `/api/agents/content/chat` works
- [ ] 1 public insight widget (MindsDB-backed)

## Next: Implementation

See `/docs/IMPLEMENTATION.md` for step-by-step build guide.
