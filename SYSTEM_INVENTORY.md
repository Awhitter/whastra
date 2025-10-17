# AgentBox V1 - Complete System Inventory & Schema Documentation

## Executive Summary

**AgentBox** is a production-ready, Docker-based multi-agent system built with Mastra primitives. This document covers the complete architecture, schemas, and data flows across all development phases.

**Base ID**: `appEBG1Kx43n1hwv8`
**Current Agents**: Research Agent (Port 3001), Content Agent (Port 3104)
**Gateway**: Port 8000
**Infrastructure**: PostgreSQL, Redis, Qdrant, MindsDB, n8n

---

## Phase Timeline

### Phase 1: Initial Setup & GitHub Repository
- Copied AgentBox V1 structure from `agents-main`
- Initialized git repository
- Pushed to GitHub: `whastra` (learning/backup version)
- Separated from production `ultrathink` version

### Phase 2: Content Agent XML Integration
- Analyzed Airtable XML bundling architecture
- Implemented 6 XML-aware Airtable tools
- Created complete Content Agent with XML processing
- Built and tested successfully

### Phase 3: Critical Fixes from ultrathink Review
- Fixed entrypoint paths (research & content agents)
- Implemented optional-first pattern (no throwing on missing config)
- Added `airtableGetHydratedContentContext` for deterministic XML retrieval
- Fixed model defaults to real models (gpt-4o, claude-3-5-sonnet-20240620)
- Removed unused Redis deps from gateway
- Added .dockerignore for faster builds

### Phase 4: Server Refactoring
- Updated Content Agent `/generate` to use hydrated tool explicitly
- Standardized validation patterns across agents
- Consistent error handling with `[agent-name]` prefixes
- Matched logging patterns

---

## 1. Infrastructure Layer

### Docker Services (infrastructure/docker-compose.yml)

| Service | Container Name | Port | Purpose | Profile |
|---------|----------------|------|---------|---------|
| **PostgreSQL** | agentbox-postgres | 5432 | Agent memory, workflows, user data | base |
| **Redis** | agentbox-redis | 6379 | Caching, pub/sub events | base |
| **Qdrant** | agentbox-qdrant | 6333 | Vector embeddings (1536-dim) | base |
| **MindsDB** | agentbox-mindsdb | 47334 | SQL interface to ML models | optional |
| **n8n** | agentbox-n8n | 5678 | Workflow automation | base |
| **Gateway** | agentbox-gateway | 8000 | Single entry point, routing | base |
| **Research Agent** | agentbox-research | 3001 | Research & fact-checking | agents, research |
| **Content Agent** | agentbox-content | 3104 | Content generation with XML | agents, content |

### Network
- **External Network**: `agentbox_net` - Shared network for inter-service communication

### Volumes
- `postgres_data` - Persistent database storage
- `redis_data` - Persistent cache storage
- `qdrant_data` - Persistent vector storage
- `n8n_data` - Persistent workflow storage

---

## 2. Database Schemas (PostgreSQL)

### Schema: agent_memory
**Purpose**: Agent conversation history and context

#### Table: threads
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Thread identifier |
| agent_name | VARCHAR(255) | NOT NULL | Agent that owns this thread |
| user_id | VARCHAR(255) | | User identifier |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Last update (auto-trigger) |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |

#### Table: messages
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Message identifier |
| thread_id | UUID | FK → threads(id) CASCADE | Parent thread |
| role | VARCHAR(50) | CHECK IN ('user','assistant','system','tool') | Message role |
| content | TEXT | NOT NULL | Message content |
| tool_calls | JSONB | | Tool invocations |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |
| embedding | vector(1536) | | OpenAI embedding (pgvector) |

**Indexes**: `idx_messages_thread_id`, `idx_messages_created_at`

---

### Schema: workflow_state
**Purpose**: Multi-step workflow tracking

#### Table: executions
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Execution identifier |
| workflow_name | VARCHAR(255) | NOT NULL | Workflow name |
| status | VARCHAR(50) | CHECK IN ('queued','running','completed','failed','paused') | Execution status |
| current_step | INTEGER | DEFAULT 0 | Current step number |
| total_steps | INTEGER | NOT NULL | Total steps in workflow |
| input_data | JSONB | NOT NULL | Workflow input |
| output_data | JSONB | | Workflow output |
| error_message | TEXT | | Error details |
| started_at | TIMESTAMPTZ | DEFAULT now() | Start timestamp |
| completed_at | TIMESTAMPTZ | | Completion timestamp |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |

#### Table: steps
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Step identifier |
| execution_id | UUID | FK → executions(id) CASCADE | Parent execution |
| step_number | INTEGER | NOT NULL | Step sequence number |
| step_name | VARCHAR(255) | NOT NULL | Step name |
| agent_name | VARCHAR(255) | | Agent that executed step |
| status | VARCHAR(50) | CHECK IN ('pending','running','completed','failed','skipped') | Step status |
| input_data | JSONB | | Step input |
| output_data | JSONB | | Step output |
| error_message | TEXT | | Error details |
| started_at | TIMESTAMPTZ | | Start timestamp |
| completed_at | TIMESTAMPTZ | | Completion timestamp |
| duration_ms | INTEGER | | Execution duration |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |

**Indexes**: `idx_executions_status`, `idx_executions_workflow_name`, `idx_steps_execution_id`, `idx_steps_step_number`

---

### Schema: user_data
**Purpose**: User profiles and authentication

#### Table: users
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | User identifier |
| external_id | VARCHAR(255) | UNIQUE | External system ID |
| email | VARCHAR(255) | | Email address |
| name | VARCHAR(255) | | Display name |
| preferences | JSONB | DEFAULT '{}' | User preferences |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Last update (auto-trigger) |

#### Table: api_keys
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | API key identifier |
| user_id | UUID | FK → users(id) CASCADE | Key owner |
| key_hash | VARCHAR(255) | NOT NULL UNIQUE | Hashed API key |
| name | VARCHAR(255) | | Key description |
| scopes | JSONB | DEFAULT '[]' | Permission scopes |
| last_used_at | TIMESTAMPTZ | | Last usage timestamp |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| expires_at | TIMESTAMPTZ | | Expiration timestamp |

**Indexes**: `idx_users_external_id`, `idx_api_keys_key_hash`, `idx_api_keys_user_id`

---

### Schema: rag_knowledge
**Purpose**: RAG knowledge base and embeddings

#### Table: documents
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Document identifier |
| source | VARCHAR(255) | NOT NULL | Source system |
| source_id | VARCHAR(255) | | Source record ID |
| title | TEXT | | Document title |
| content | TEXT | NOT NULL | Full document content |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |
| embedding | vector(1536) | | OpenAI embedding |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Last update (auto-trigger) |

#### Table: chunks
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Chunk identifier |
| document_id | UUID | FK → documents(id) CASCADE | Parent document |
| chunk_index | INTEGER | NOT NULL | Chunk sequence number |
| content | TEXT | NOT NULL | Chunk content |
| embedding | vector(1536) | | OpenAI embedding |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes**: `idx_documents_source`, `idx_chunks_document_id`

---

### Schema: analytics
**Purpose**: Performance tracking and monitoring

#### Table: agent_metrics
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Metric identifier |
| agent_name | VARCHAR(255) | NOT NULL | Agent name |
| metric_type | VARCHAR(100) | NOT NULL | Metric type |
| value | NUMERIC | NOT NULL | Metric value |
| timestamp | TIMESTAMPTZ | DEFAULT now() | Metric timestamp |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |

#### Table: api_calls
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Call identifier |
| agent_name | VARCHAR(255) | | Agent name |
| endpoint | VARCHAR(255) | NOT NULL | API endpoint |
| method | VARCHAR(10) | NOT NULL | HTTP method |
| status_code | INTEGER | | Response status |
| duration_ms | INTEGER | | Call duration |
| user_id | UUID | FK → users(id) | Calling user |
| timestamp | TIMESTAMPTZ | DEFAULT now() | Call timestamp |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |

**Indexes**: `idx_agent_metrics_agent_name`, `idx_agent_metrics_timestamp`, `idx_api_calls_timestamp`, `idx_api_calls_agent_name`

---

## 3. Shared Tools (core/shared/tools/)

### 3.1 Web Tools (web.ts)

#### webSearch
**ID**: `web.search`
**Description**: Search the web for current information using Tavily API

**Input Schema**:
```typescript
{
  query: string;              // Search query
  maxResults?: number;        // Max results (default: 5)
  searchDepth?: 'basic' | 'advanced';  // Search depth (default: 'advanced')
}
```

**Output**:
```typescript
{
  query: string;
  answer: string | null;      // Tavily AI answer
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    score: number | null;     // Relevance score
  }>;
  citations: string[];        // Array of URLs
  source: 'tavily';
}
```

**Dependencies**: `TAVILY_API_KEY`
**Behavior**: Returns `{results: [], note: '...'}` if API key missing

---

#### webScrape
**ID**: `web.scrape`
**Description**: Scrape content from a specific URL (static HTML)

**Input Schema**:
```typescript
{
  url: string;                // URL to scrape
  selector?: string;          // Optional CSS selector
}
```

**Output**:
```typescript
{
  url: string;
  title: string;              // og:title or <title>
  content: string;            // Extracted content
  note: string;               // Method notes
}
```

**Dependencies**: `cheerio` (npm package)
**Behavior**: Throws on fetch/parse errors

---

#### extractCitation
**ID**: `web.extractCitation`
**Description**: Extract citation information from a URL

**Input Schema**:
```typescript
{
  url: string;                // URL to extract citation from
}
```

**Output**:
```typescript
{
  url: string;
  source: string;             // Domain name
  title: string;
  author: string;
  date: string;               // ISO 8601
  accessDate: string;         // ISO 8601
  citationMLA: string;        // Formatted MLA citation
}
```

**Dependencies**: `cheerio`
**Behavior**: Returns defaults if metadata unavailable

---

### 3.2 Airtable Tools (airtable.ts)

#### airtableQuery
**ID**: `airtable.query`
**Description**: Query Airtable table with filterByFormula, view, fields, sort

**Input Schema**:
```typescript
{
  baseId: string;             // Base ID (appXXXXXXXXXXXXXX)
  table: string;              // Table name
  filterByFormula?: string;   // Airtable formula
  view?: string;              // View name
  maxRecords?: number;        // Default: 100
  pageSize?: number;          // Default: 50
  fields?: string[];          // Specific fields to return
  sort?: Array<{
    field: string;
    direction?: 'asc' | 'desc';
  }>;
}
```

**Output (Success)**:
```typescript
{
  ok: true;
  baseId: string;
  table: string;
  records: Array<{
    id: string;               // Record ID (rec...)
    fields: Record<string, any>;
    createdTime: string;
  }>;
}
```

**Output (Skipped)**:
```typescript
{
  ok: false;
  skipped: true;
  reason: string;             // e.g., "Airtable not configured"
}
```

**Dependencies**: `AIRTABLE_PAT` or `AIRTABLE_API_KEY` or `AIRTABLE_TOKEN`
**Behavior**: Optional-first pattern, returns skipped response if no credentials

---

#### airtableCreate
**ID**: `airtable.create`
**Description**: Create one or many records in an Airtable table

**Input Schema**:
```typescript
{
  baseId: string;
  table: string;
  records: Array<Record<string, any>>;  // [{Name:"X", Status:"New"}]
  typecast?: boolean;         // Default: true
}
```

**Output**:
```typescript
{
  ok: true;
  records: Array<{
    id: string;
    fields: Record<string, any>;
    createdTime: string;
  }>;
}
```

---

#### airtableUpdate
**ID**: `airtable.update`
**Description**: Update records by ID with partial fields

**Input Schema**:
```typescript
{
  baseId: string;
  table: string;
  updates: Array<{
    id: string;               // Record ID (rec...)
    fields: Record<string, any>;
  }>;
  typecast?: boolean;         // Default: true
}
```

**Output**:
```typescript
{
  ok: true;
  records: Array<{
    id: string;
    fields: Record<string, any>;
  }>;
}
```

---

#### airtableFetchPersona
**ID**: `airtable.fetchPersona`
**Description**: Fetch persona by slug (legacy, use airtable.query for new code)

**Input Schema**:
```typescript
{
  baseId?: string;            // Defaults to env vars
  table: string;
  view?: string;
  slug: string;
}
```

**Output**:
```typescript
{
  ok: true;
  records: Array<{
    id: string;
    fields: Record<string, any>;
  }>;
}
```

---

### 3.3 Airtable XML Tools (airtable-xml.ts)

#### airtableGetContentBundle (LEGACY)
**ID**: `airtable.getContentBundle`
**Description**: Fetch master XML bundle for Content Initiator (returns IDs, not embedded XML)

**Input Schema**:
```typescript
{
  baseId?: string;
  initiatorId: string;        // Content Initiator record ID
}
```

**Output (Prebuilt)**:
```typescript
{
  ok: true;
  mode: 'prebuilt';
  initiatorId: string;
  xml: string;                // Full XML bundle
  source: 'Content Initiator bundle field';
}
```

**Output (Assembled)**:
```typescript
{
  ok: true;
  mode: 'assembled';
  initiatorId: string;
  xml: string;                // XML with linkedIds attributes
  linkedResources: {
    personas: string[];       // Array of record IDs
    domains: string[];
    entities: string[];
    references: string[];
  };
}
```

**Note**: Returns IDs only, not embedded XML. Use `airtableGetHydratedContentContext` instead.

---

#### airtableGetHydratedContentContext ⭐ **RECOMMENDED**
**ID**: `airtable.getHydratedContentContext`
**Description**: Return fully hydrated XML bundle with EMBEDDED XML from all linked resources

**Input Schema**:
```typescript
{
  initiatorId: string;        // Content Initiator record ID
  baseId?: string;
}
```

**Output**:
```typescript
{
  ok: true;
  mode: 'hydrated';
  initiatorId: string;
  xml: string;                // Complete XML bundle with embedded content
  linkedCounts: {
    personas: number;
    domains: number;
    entities: number;
    references: number;
  };
}
```

**XML Structure**:
```xml
<bundle>
  <initiator id="rec...">
    <goal>...</goal>
    <contentType>...</contentType>
    <outputType>...</outputType>
  </initiator>
  <personas>
    <persona>...full XML...</persona>
    <persona>...full XML...</persona>
  </personas>
  <domains>
    <domain>...full XML...</domain>
  </domains>
  <entities>
    <entity>...full XML...</entity>
  </entities>
  <references>
    <reference>...full XML...</reference>
  </references>
</bundle>
```

**Dependencies**:
- `AIRTABLE_PAT` / `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID` or `AIRTABLE_CONTENT_BASE_ID`
- `AIRTABLE_TABLE_CONTENT_INITIATORS` (default: "Content Initiators")
- `AIRTABLE_TABLE_PERSONAS` (default: "Personas")
- `AIRTABLE_TABLE_DOMAINS` (default: "Content Domains")
- `AIRTABLE_TABLE_ENTITIES` (default: "Entity")
- `AIRTABLE_TABLE_REFERENCES` (default: "References")

**Behavior**: Fetches initiator + ALL linked records in one call, returns fully embedded XML

---

#### airtableCreateContentRequest
**ID**: `airtable.createContentRequest`
**Description**: Create a new Content Initiator record

**Input Schema**:
```typescript
{
  baseId?: string;
  goal: string;
  contentType?: string;       // e.g., "blog", "social", "video"
  outputType?: string;        // e.g., "markdown", "html"
  personaSlugs?: string[];    // Note: Currently stores as text, not linked records
  domainSlugs?: string[];
}
```

**Output**:
```typescript
{
  ok: true;
  recordId: string;           // New record ID (rec...)
  fields: Record<string, any>;
}
```

---

#### airtableGetPersonaContext
**ID**: `airtable.getPersonaContext`
**Description**: Fetch persona XML by slug

**Input Schema**:
```typescript
{
  baseId?: string;
  slug: string;
}
```

**Output**:
```typescript
{
  ok: true;
  slug: string;
  xml: string;                // Persona XML bundle
  name: string;
  recordId: string;
}
```

**Dependencies**:
- `AIRTABLE_TABLE_PERSONAS` (default: "Personas")
- `AIRTABLE_FIELD_PERSONA_XML` (default: "XML Bundle")

---

#### airtableGetDomainKnowledge
**ID**: `airtable.getDomainKnowledge`
**Description**: Fetch domain expertise XML by slug

**Input Schema**:
```typescript
{
  baseId?: string;
  slug: string;
}
```

**Output**:
```typescript
{
  ok: true;
  slug: string;
  xml: string;                // Domain XML bundle
  name: string;
  recordId: string;
}
```

**Dependencies**:
- `AIRTABLE_TABLE_DOMAINS` (default: "Content Domains")
- `AIRTABLE_FIELD_DOMAIN_XML` (default: "XML Bundle")

---

#### airtableUpdateContentOutput
**ID**: `airtable.updateContentOutput`
**Description**: Update Content Initiator with generated content

**Input Schema**:
```typescript
{
  baseId?: string;
  initiatorId: string;
  output: string;             // Generated content
  status?: string;            // e.g., "Generated", "Ready for Review"
  metadata?: Record<string, any>;
}
```

**Output**:
```typescript
{
  ok: true;
  updated: true;
  recordId: string;
  fields: Record<string, any>;
}
```

---

### 3.4 MindsDB Tools (mindsdb.ts)

#### mindsdbQuery
**ID**: `mindsdb.query`
**Description**: Run SQL against MindsDB for ML predictions

**Input Schema**:
```typescript
{
  sql: string;                // SQL query
}
```

**Output (Success)**:
```typescript
{
  ok: true;
  rows: any[];
  columnNames: string[];
  rowCount: number;
}
```

**Output (Skipped)**:
```typescript
{
  ok: false;
  skipped: true;
  reason: 'MINDSDB_URL not set';
}
```

**Dependencies**:
- `MINDSDB_URL` (required)
- `MINDSDB_KEY` (optional bearer token)

---

### 3.5 n8n Tools (n8n.ts)

#### n8nTrigger
**ID**: `n8n.trigger`
**Description**: Trigger an n8n workflow via webhook

**Input Schema**:
```typescript
{
  scenario: string;           // Webhook path segment (e.g., "repurposer" or UUID)
  payload: any;               // JSON payload to send
}
```

**Output (Success)**:
```typescript
{
  ok: true;
  data: any;                  // Response JSON or null
}
```

**Output (Skipped)**:
```typescript
{
  ok: false;
  skipped: true;
  reason: 'N8N_WEBHOOK_BASE not set';
}
```

**Dependencies**: `N8N_WEBHOOK_BASE` (e.g., "http://n8n:5678" or "http://n8n:5678/webhook")
**Behavior**: Automatically normalizes URLs with/without `/webhook` suffix

---

## 4. Agent Configurations

### 4.1 Research Agent

**Location**: `agents/research/src/agent.ts`
**Port**: 3001
**Container**: agentbox-research

#### Configuration
```typescript
{
  name: 'researchAgent',
  model: pickModel(),  // OpenAI GPT-4o or Anthropic Claude 3.5 Sonnet
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
  }
}
```

#### Model Selection
```typescript
function pickModel() {
  const vendor = process.env.LLM_VENDOR?.toLowerCase();
  const modelId = process.env.MODEL?.trim();

  if (vendor === 'openai') return openai(modelId || 'gpt-4o');
  if (vendor === 'anthropic') return anthropic(modelId || 'claude-3-5-sonnet-20240620');
  return openai(modelId || 'gpt-4o');  // Default
}
```

#### API Endpoints

**POST /chat**
```typescript
// Request
{
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

// Response
{
  response: string;         // Agent's text response
  metadata: {
    agent: 'research';
    timestamp: string;
  };
}

// Error Response
{
  error: string;
  message: string;
}
```

**GET /health**
```typescript
// Response
{
  status: 'healthy';
  agent: 'research';
  timestamp: string;
}
```

#### Dependencies
```json
{
  "@mastra/core": "latest",
  "@mastra/loggers": "latest",
  "@ai-sdk/anthropic": "^2.0.0",
  "@ai-sdk/openai": "^2.0.0",
  "ai": "^5.0.0",
  "express": "^4.18.2",
  "cors": "^2.8.5",
  "dotenv": "^16.3.1",
  "zod": "^3.23.8",
  "pg": "^8.11.3",
  "cheerio": "^1.0.0-rc.12"
}
```

---

### 4.2 Content Agent

**Location**: `agents/content/src/mastra/agent.ts`
**Port**: 3104
**Container**: agentbox-content

#### Configuration
```typescript
{
  name: 'content-agent',
  instructions: `You are a Content Generation Agent with expertise in creating high-quality content following specific personas and domain constraints.

## Your Role
You consume XML bundles from Airtable that contain:
- Content goals and objectives
- Persona voice and style guidelines
- Domain-specific knowledge and constraints
- Related entities and references

## Workflow
1. **Fetch Context**: Use airtableGetHydratedContentContext to retrieve FULLY HYDRATED XML bundle
2. **Parse Constraints**: Extract persona voice, domain expertise, content requirements
3. **Generate Content**: Create content matching persona's voice and domain's constraints
4. **Write Back**: Use airtableUpdateContentOutput to save generated content
5. **Trigger Repurposer**: Optionally use n8nTrigger for multi-format distribution

## Quality Standards
- **Voice Accuracy**: Match persona tone, vocabulary, and style exactly
- **Domain Compliance**: Follow domain-specific guidelines and constraints
- **Goal Alignment**: Ensure content achieves the stated objective
- **Format Precision**: Deliver in the requested output type

## XML Bundle Structure
The hydrated bundle contains EMBEDDED XML content (not just IDs):
- <initiator>: Goal, content type, output type
- <personas>: Full persona XML with voice guidelines and style rules
- <domains>: Full domain XML with expertise areas and constraints
- <entities>: Full entity XML with related people, companies, concepts
- <references>: Full reference XML with source materials and citations`,
  model: openai('gpt-4o'),
  tools: {
    airtableGetHydratedContentContext,
    airtableCreateContentRequest,
    airtableUpdateContentOutput,
    n8nTrigger,
  }
}
```

#### API Endpoints

**POST /chat**
```typescript
// Request
{
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

// Response
{
  response: string;
  metadata: {
    agent: 'content';
    timestamp: string;
  };
}
```

**POST /generate** ⭐ **SPECIALIZED ENDPOINT**
```typescript
// Request
{
  initiatorId: string;        // Content Initiator record ID (required)
  baseId?: string;            // Optional base override
}

// Response
{
  response: string;           // Summary of generated content
  metadata: {
    agent: 'content';
    initiatorId: string;
    timestamp: string;
  };
}

// Error Response (400)
{
  error: 'Missing required field: initiatorId (string)';
}

// Error Response (500)
{
  error: 'Failed to generate content';
  message: string;
}
```

**Behavior**: Constructs explicit prompt instructing LLM to:
1. Call `airtableGetHydratedContentContext` with `{initiatorId, baseId?}`
2. Parse XML to extract goal, persona voice, domain constraints
3. Generate content matching exact requirements
4. Save with `airtableUpdateContentOutput`
5. Return one-paragraph summary

**GET /health**
```typescript
// Response
{
  status: 'healthy';
  agent: 'content';
  timestamp: string;
}
```

#### Dependencies
```json
{
  "@mastra/core": "latest",
  "@mastra/loggers": "latest",
  "@ai-sdk/openai": "^2.0.0",
  "ai": "^5.0.0",
  "express": "^4.18.2",
  "cors": "^2.8.5",
  "dotenv": "^16.3.1",
  "zod": "^3.23.8",
  "cheerio": "^1.0.0-rc.12"
}
```

---

## 5. Gateway (core/gateway/)

**Location**: `core/gateway/src/index.ts`
**Port**: 8000
**Container**: agentbox-gateway

### Configuration

#### Agent Registry
```typescript
const AGENTS: Record<string, string> = {
  research: process.env.AGENT_RESEARCH_URL || 'http://agentbox-research:3001',
  content: process.env.AGENT_CONTENT_URL || 'http://agentbox-content:3104',
};
```

#### Authentication
```typescript
// Optional API key guard for /agents endpoints
app.use('/agents', (req, res, next) => {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) return next();  // No auth if secret not set
  if (req.header('x-api-key') !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

### API Endpoints

**GET /health**
```typescript
// Response
{
  status: 'healthy';
  service: 'agentbox-gateway';
  timestamp: string;
}
```

**GET /agents**
```typescript
// Response
{
  agents: Array<{
    name: string;             // 'research', 'content'
    endpoint: string;         // '/agents/research/chat'
    status: 'available';
  }>;
}
```

**POST /agents/:agentName/chat**
```typescript
// Request
{
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

// Response (proxied from agent)
{
  response: string;
  metadata: {
    agent: string;
    timestamp: string;
  };
}

// Error Responses
// 400 - Invalid request
{
  error: 'Invalid request';
  expected: { messages: [{ role: 'user', content: 'message' }] };
}

// 404 - Unknown agent
{
  error: "Unknown agent 'agentName'";
}

// 502 - Agent unavailable
{
  error: 'Agent unavailable';
  agent: string;
  details: string;
}
```

**POST /agents/content/generate**
```typescript
// Request (proxied to content agent /generate)
{
  initiatorId: string;
  baseId?: string;
}

// Response (proxied from content agent)
{
  response: string;
  metadata: {
    agent: 'content';
    initiatorId: string;
    timestamp: string;
  };
}

// Error Responses
// 404 - Content agent not configured
{
  error: 'Content agent not configured';
}

// 502 - Content generation failed
{
  error: 'Content generation failed';
  details: string;
}
```

### Dependencies
```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5",
  "dotenv": "^16.3.1"
}
```

---

## 6. Airtable Schema: Complete Content Operations & Workflow Management Platform

### 6.1 Overview

**Base ID**: `appEBG1Kx43n1hwv8`
**Total Tables**: 12
**Total Records**: ~220 across all tables
**Architecture**: XML-driven knowledge amplification system

#### Table Summary
| Table | Records | XML Fields | Purpose |
|-------|---------|------------|---------|
| Content Initiators | 37 | 2 | Entry point for content requests |
| Bundles | 8 | 7+ | Central XML orchestration |
| References | 14 | 10 | Knowledge repository with AI curation |
| Personas | 14 | 2 | AI personality templates |
| Entity | 10 | 1 | Brand knowledge base |
| Tools | 16 | 1 | Integration registry (MCP servers) |
| Content Styles | 5 | 1 | Voice and tone guidelines |
| Content Domains | 5 | 1 | Subject expertise definitions |
| Workflows | 33 | 1 | Multi-step process orchestration |
| Prompts | 61 | 2 | Reusable AI instruction templates |
| Projects | 12 | 1 | Content organization |
| Output Types | 5 | 1 | Format definitions and schemas |

---

### 6.2 Content Initiators (Entry Point - 37 records)

**Env Variable**: `AIRTABLE_TABLE_CONTENT_INITIATORS`
**Default Name**: "Content Initiators"
**Core Purpose**: Content request processing and workflow orchestration

#### Workflow
```
Raw User Input → Distilled Intent → Bundle Selection → XML Context Assembly → AI Processing → Generated Output
```

#### Key Fields

**Input Processing**:
| Field Name | Type | Description |
|------------|------|-------------|
| Raw User Input | Long text | Original content request |
| Distilled Intent | AI text | Parsed and clarified objectives |
| Goal | Single line text | Content objective |
| Content Type | Single select | e.g., "blog", "social", "video" |
| Output Type | Single select | e.g., "markdown", "html", "plain text" |

**Context Links**:
| Field Name | Type | Description |
|------------|------|-------------|
| Personas | Linked records | → Personas table |
| Content Domains | Linked records | → Content Domains table |
| Entity | Linked records | → Entity table (Brand IDs) |
| References | Linked records | → References table |
| Bundles | Linked records | → Bundles table (XML orchestrator) |

**XML & Output**:
| Field Name | Type | Description |
|------------|------|-------------|
| BUNDLE of the XML BUNDLES | AI text, lookup | Master XML from linked Bundles |
| Generated Output | Long text | AI-generated content |
| Status | Single select | e.g., "New", "Processing", "Generated", "Published" |
| Metadata (JSON) | Long text | Additional metadata |

**XML Field**: `AIRTABLE_FIELD_XML_BUNDLE` (default: "BUNDLE of the XML BUNDLES")

---

### 6.3 Bundles (XML Orchestrator - 8 records)

**Env Variable**: `AIRTABLE_TABLE_BUNDLES`
**Default Name**: "Bundles"
**Core Purpose**: Central XML aggregation system - creates comprehensive context packages

#### XML Architecture

**Master Aggregator Field**:
- **BUNDLE of the XML BUNDLES** (AI text): The central XML compilation field
  - Concatenates XML from all linked sources
  - Creates comprehensive context packages
  - Feeds into Content Initiators via lookup

#### Lookup Fields (pulling XML from other tables)

| Field Name | Type | Source Table | Purpose |
|------------|------|--------------|---------|
| Ditilled Reference KB | Lookup | References | Knowledge snippets |
| Entity Knowledge Base | Lookup | Entity (Brand IDs) | Brand knowledge |
| AI Generated Persona Summary | Lookup | Personas | Persona profiles |
| XML Context Bundle | Lookup | Content Styles | Style guidelines |
| XML Formatted Data | Lookup | Content Domains | Subject expertise |
| XML Tool Data | Lookup | Tools | Integration capabilities |

**Pattern**: Bundles act as the XML aggregation layer, pulling structured knowledge from specialized tables and packaging it for AI consumption.

---

### 6.4 References (Knowledge Repository - 14 records)

**Env Variable**: `AIRTABLE_TABLE_REFERENCES`
**Default Name**: "References"
**Core Purpose**: Research and knowledge curation with heavy AI processing

#### XML/AI Fields (10 total)

| Field Name | Type | Purpose |
|------------|------|---------|
| Few Word Description | AI text | Concise 5-10 word titles |
| When to consider Using This Reference | AI text | Use case bullets |
| Creator | AI text | Author identification |
| Primary URL | AI text | Source URL extraction |
| Enriched Content | AI text | Enhanced content analysis |
| Key Takeaways | AI text | Core insights |
| Initial Outline and Analysis | AI text | Structured analysis |
| Research web for more sources | AI text | Additional insights |
| **Ditilled Reference KB** | **AI text** | **Primary XML output** - actionable knowledge for AI agents |
| xml actionableinight nippet | AI text | Focused insight snippets |

**XML Field**: `Ditilled Reference KB` - Contains distilled, actionable knowledge formatted as XML for AI consumption

**XML Structure**:
```xml
<reference>
  <title>...</title>
  <creator>...</creator>
  <url>...</url>
  <useCase>...</useCase>
  <keyTakeaways>
    <takeaway>...</takeaway>
  </keyTakeaways>
  <insights>...</insights>
  <relatedSources>...</relatedSources>
</reference>
```

---

### 6.5 Personas (AI Personality Templates - 14 records)

**Env Variable**: `AIRTABLE_TABLE_PERSONAS`
**Default Name**: "Personas"
**Core Purpose**: Define AI agent personalities and expertise

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Persona name |
| Slug | Single line text | Unique identifier |
| AI Generated Profile Photo | Attachment, on-demand | Visual persona representation |
| **AI Generated Persona Summary** | **AI text, on-demand** | **Primary XML output** |

**XML Field**: `AIRTABLE_FIELD_PERSONA_XML` (default: "AI Generated Persona Summary")

**XML Structure** (can be directly included in system prompts):
```xml
<persona>
  <name>...</name>
  <voice>
    <tone>...</tone>
    <style>...</style>
    <vocabulary>...</vocabulary>
  </voice>
  <thinkingStyle>...</thinkingStyle>
  <expertise>...</expertise>
  <guidelines>
    <do>...</do>
    <avoid>...</avoid>
  </guidelines>
  <examplePhrases>...</examplePhrases>
</persona>
```

**Note**: Persona XML is designed for direct inclusion in system prompts without heavy parsing.

---

### 6.6 Entity (Brand Knowledge Base - 10 records)

**Env Variable**: `AIRTABLE_TABLE_ENTITIES`
**Default Name**: "Entity"
**Core Purpose**: Brand/company context and domain expertise

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Entity name (brand/company) |
| Type | Single select | e.g., "Brand", "Company", "Product" |
| **XML Rollup** | **AI text, on-demand** | **Primary XML output** |

**XML Field**: `XML Rollup`

**XML Structure**:
```xml
<entity type="brand">
  <name>...</name>
  <voiceGuidelines>...</voiceGuidelines>
  <audienceData>...</audienceData>
  <productKnowledge>...</productKnowledge>
  <marketingKnowledge>...</marketingKnowledge>
  <personalization>...</personalization>
  <constraints>...</constraints>
</entity>
```

---

### 6.7 Tools (Integration Registry - 16 records)

**Env Variable**: `AIRTABLE_TABLE_TOOLS`
**Default Name**: "Tools"
**Core Purpose**: MCP servers, APIs, and automation capabilities

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Tool name |
| Type | Single select | e.g., "MCP Server", "API", "Automation" |
| **XML Tool Data** | **AI text, on-demand** | **Primary XML output** |

**XML Field**: `XML Tool Data`

**XML Structure**:
```xml
<tool>
  <name>...</name>
  <type>...</type>
  <capabilities>
    <capability>...</capability>
  </capabilities>
  <usage>
    <description>...</description>
    <example>...</example>
  </usage>
  <connection>
    <connectionString>...</connectionString>
    <authentication>...</authentication>
  </connection>
  <integration>...</integration>
</tool>
```

---

### 6.8 Content Styles (Writing Guidelines - 5 records)

**Env Variable**: `AIRTABLE_TABLE_CONTENT_STYLES`
**Default Name**: "Content Styles"
**Core Purpose**: Voice and tone definitions

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Style name |
| **XML Context Bundle** | **AI text, on-demand** | **Primary XML output** |

**XML Field**: `AIRTABLE_FIELD_CONTENT_STYLE_XML` (default: "XML Context Bundle")

**XML Structure**:
```xml
<contentStyle>
  <tone>...</tone>
  <engagementStrategy>...</engagementStrategy>
  <sentenceStructure>...</sentenceStructure>
  <readingLevel>...</readingLevel>
  <examplePhrases>
    <phrase>...</phrase>
  </examplePhrases>
  <avoidPatterns>
    <pattern>...</pattern>
  </avoidPatterns>
</contentStyle>
```

---

### 6.9 Content Domains (Subject Expertise - 5 records)

**Env Variable**: `AIRTABLE_TABLE_DOMAINS`
**Default Name**: "Content Domains"
**Core Purpose**: Topic area knowledge and terminology

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Domain name |
| Slug | Single line text | Unique identifier |
| **XML Formatted Data** | **AI text, on-demand** | **Primary XML output** |

**XML Field**: `AIRTABLE_FIELD_DOMAIN_XML` (default: "XML Formatted Data")

**XML Structure**:
```xml
<domain>
  <name>...</name>
  <targetAudience>...</targetAudience>
  <subjectFocus>...</subjectFocus>
  <keyTerminology>
    <term>...</term>
  </keyTerminology>
  <painPoints>...</painPoints>
  <knowledgeRequirements>...</knowledgeRequirements>
  <researchSources>...</researchSources>
  <constraints>...</constraints>
</domain>
```

---

### 6.10 Workflows (Process Orchestration - 33 records)

**Env Variable**: `AIRTABLE_TABLE_WORKFLOWS`
**Default Name**: "Workflows"
**Core Purpose**: Multi-step content generation processes

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Workflow name |
| Description | Long text | Workflow description |
| **XML Workflow Package** | **AI text, on-demand** | **Complete workflow configuration** |

**XML Field**: `XML Workflow Package`

**XML Structure**:
```xml
<workflow>
  <name>...</name>
  <processingPhases>
    <phase order="1">
      <name>...</name>
      <agent>...</agent>
      <model>...</model>
      <tools>...</tools>
    </phase>
  </processingPhases>
  <successCriteria>...</successCriteria>
  <errorHandling>...</errorHandling>
  <retryLogic>...</retryLogic>
</workflow>
```

---

### 6.11 Prompts (Template Library - 61 records)

**Env Variable**: `AIRTABLE_TABLE_PROMPTS`
**Default Name**: "Prompts"
**Core Purpose**: Reusable AI instruction templates

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Prompt name |
| Category | Single select | Prompt category |
| Prompt Image | AI text, on-demand | Visual design descriptions |
| **XML Packaged Prompt** | **AI text, on-demand** | **Primary XML output** - complete prompt data |

**XML Field**: `XML Packaged Prompt`

**XML Structure**:
```xml
<prompt>
  <name>...</name>
  <category>...</category>
  <template>...</template>
  <variables>
    <variable>...</variable>
  </variables>
  <context>...</context>
  <examples>...</examples>
</prompt>
```

---

### 6.12 Projects (Content Organization - 12 records)

**Env Variable**: `AIRTABLE_TABLE_PROJECTS`
**Default Name**: "Projects"
**Core Purpose**: Content organization and campaign management

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Project name |
| Status | Single select | Project status |
| **projects xml** | **AI text, on-demand** | **Project data packaged for AI integration** |

**XML Field**: `projects xml`

---

### 6.13 Output Types (Format Definitions - 5 records)

**Env Variable**: `AIRTABLE_TABLE_OUTPUT_TYPES`
**Default Name**: "Output Types"
**Core Purpose**: Format definitions and validation rules

#### Fields

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | Output type name (e.g., "Markdown", "HTML") |
| **XML Package** | **AI text, on-demand** | **Output format schemas and validation rules** |

**XML Field**: `XML Package`

**XML Structure**:
```xml
<outputType>
  <name>...</name>
  <format>...</format>
  <schema>...</schema>
  <validationRules>...</validationRules>
  <conversionInstructions>...</conversionInstructions>
</outputType>
```

---

### 6.14 XML Flow Architecture

```
DATA SOURCES → XML GENERATION → BUNDLE AGGREGATION → CONTENT PROCESSING
     ↓               ↓                  ↓                    ↓
References  →  Ditilled KB    →                →  Content      →  Generated
Personas    →  Persona XML    →  BUNDLE OF   →  Initiator    →  Output
Entity      →  Brand XML      →  XML BUNDLES →               →
Tools       →  Tool XML       →                →               →
Styles      →  Style XML      →                →               →
Domains     →  Domain XML     →                →               →
Workflows   →  Workflow XML   →                →               →
Prompts     →  Prompt XML     →                →               →
```

#### Data Flow Details

1. **Source Tables** (References, Personas, Entity, Tools, Styles, Domains, Workflows, Prompts)
   - Each table has AI-generated XML fields
   - XML contains structured, actionable knowledge

2. **Bundles Table** (XML Orchestrator)
   - Pulls XML from linked source tables via lookup fields
   - Aggregates into master `BUNDLE of the XML BUNDLES` field
   - Creates comprehensive context packages

3. **Content Initiators** (Processing Engine)
   - Links to Bundles to receive master XML via lookup
   - Receives fully hydrated context in `BUNDLE of the XML BUNDLES` field
   - Processes with AI agents
   - Outputs generated content

---

### 6.15 Knowledge Amplification Loop

The system creates a **knowledge amplification loop** where structured data becomes rich XML context that powers AI-driven content generation:

```
1. KNOWLEDGE CAPTURE
   └─ References curated with AI analysis
   └─ Personas defined with voice/style
   └─ Entities populated with brand knowledge
   └─ Tools documented with capabilities

2. XML PACKAGING
   └─ Each source table generates XML fields
   └─ AI processes and structures information
   └─ Knowledge packaged for machine consumption

3. BUNDLE ORCHESTRATION
   └─ Bundles pull XML from multiple sources
   └─ Master XML created with full context
   └─ Dynamic context assembly based on links

4. CONTENT GENERATION
   └─ Content Initiators receive hydrated XML
   └─ AI agents consume rich context
   └─ Generated content matches exact requirements
   └─ Output reflects persona voice, domain expertise, brand guidelines

5. FEEDBACK & REFINEMENT
   └─ Generated outputs analyzed
   └─ Knowledge base updated
   └─ Persona/style definitions refined
   └─ Loop continues with improved context
```

#### Key Benefits

1. **Deterministic Context**: XML bundling ensures consistent, complete context delivery
2. **Knowledge Reuse**: Same personas/domains/references used across multiple content requests
3. **Modular Architecture**: Update one persona → affects all content using that persona
4. **Scalability**: Add new bundles without changing agent code
5. **Observability**: XML structure makes context visible and debuggable
6. **Persona Simplicity**: XML can be directly included in system prompts without parsing

---

### 6.16 Hydrated Bundle Example

```xml
<bundle>
  <initiator id="rec123">
    <goal>Write a technical blog post about API design</goal>
    <contentType>blog</contentType>
    <outputType>markdown</outputType>
  </initiator>

  <personas>
    <persona>
      <name>Tech Educator</name>
      <voice>
        <tone>friendly, authoritative, patient</tone>
        <style>practical examples, clear explanations</style>
        <vocabulary>accessible technical terms, minimal jargon</vocabulary>
      </voice>
      <thinkingStyle>Start with concepts, then examples, then application</thinkingStyle>
      <expertise>Software engineering, API design, developer education</expertise>
    </persona>
  </personas>

  <domains>
    <domain>
      <name>Software Engineering</name>
      <targetAudience>Mid-level developers</targetAudience>
      <subjectFocus>API design patterns, REST, GraphQL</subjectFocus>
      <keyTerminology>
        <term>RESTful</term>
        <term>endpoints</term>
        <term>resource modeling</term>
      </keyTerminology>
      <constraints>Avoid framework-specific examples</constraints>
    </domain>
  </domains>

  <entities>
    <entity type="Technology">
      <name>REST API</name>
      <description>Representational State Transfer architectural style</description>
      <attributes>Stateless, cacheable, uniform interface</attributes>
    </entity>
  </entities>

  <references>
    <reference>
      <title>REST API Design Best Practices</title>
      <creator>Roy Fielding</creator>
      <url>https://example.com/rest-best-practices</url>
      <keyTakeaways>
        <takeaway>Use HTTP methods semantically</takeaway>
        <takeaway>Design resources, not actions</takeaway>
      </keyTakeaways>
    </reference>
  </references>

  <tools>
    <tool>
      <name>OpenAPI Spec Generator</name>
      <capabilities>
        <capability>Generate API documentation</capability>
        <capability>Validate request/response schemas</capability>
      </capabilities>
    </tool>
  </tools>

  <styles>
    <contentStyle>
      <tone>conversational yet authoritative</tone>
      <sentenceStructure>Mix of short and medium sentences</sentenceStructure>
      <readingLevel>Grade 10-12</readingLevel>
      <examplePhrases>
        <phrase>Let's explore how...</phrase>
        <phrase>Here's what you need to know...</phrase>
      </examplePhrases>
    </contentStyle>
  </styles>
</bundle>
```

---

## 7. Data Flows

### 7.1 Research Workflow
```
User Request
  ↓
Gateway (/agents/research/chat)
  ↓
Research Agent
  ↓ web.search (Tavily API)
  ↓ web.scrape (Cheerio)
  ↓ extractCitation (metadata)
  ↓ createEvidencePack (bundle)
  ↓ airtableCreate (optional log)
  ↓
Response: Executive Summary + Evidence Pack
```

### 7.2 Content Generation Workflow (via /chat)
```
User Request
  ↓
Gateway (/agents/content/chat)
  ↓
Content Agent (LLM decides tool calls)
  ↓ airtableGetHydratedContentContext(initiatorId)
  ↓ Parse XML bundle
  ↓ Generate content matching persona + domain
  ↓ airtableUpdateContentOutput(initiatorId, output, status)
  ↓ n8nTrigger('repurposer', {initiatorId}) [optional]
  ↓
Response: Summary
```

### 7.3 Content Generation Workflow (via /generate)
```
Direct API Call
  ↓
Gateway (/agents/content/generate)
  ↓
Content Agent with EXPLICIT prompt
  ↓ "Call airtableGetHydratedContentContext with {initiatorId}"
  ↓ "Parse XML to extract goal, persona, domain"
  ↓ "Generate content matching requirements"
  ↓ "Save with airtableUpdateContentOutput"
  ↓ "Return summary"
  ↓
Content Agent executes deterministic workflow
  ↓
Response: Summary
```

**Key Difference**: `/generate` endpoint constructs explicit step-by-step prompt to ensure deterministic tool usage, while `/chat` allows LLM to decide strategy.

### 7.4 n8n Repurposing Workflow
```
Content Agent generates content
  ↓ n8nTrigger('repurposer', {initiatorId, output})
  ↓
n8n Workflow
  ↓ Fetch Content Initiator
  ↓ Parse output type requirements
  ↓ Generate 10+ format variations:
      - Twitter thread
      - LinkedIn post
      - Instagram caption
      - Email newsletter
      - Video script
      - etc.
  ↓ Update Airtable with variations
  ↓ Optional: Post to social media
  ↓ Optional: Send notifications
```

---

## 8. Environment Configuration

### Required Variables

```bash
# === LLM Providers (at least one required) ===
OPENAI_API_KEY=sk-...                    # OpenAI GPT models
ANTHROPIC_API_KEY=sk-ant-...             # Anthropic Claude models

# === Model Selection ===
LLM_VENDOR=openai                        # 'openai' or 'anthropic'
MODEL=gpt-4o                             # Override model ID

# === Database ===
POSTGRES_USER=agentbox
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=agentbox
DATABASE_URL=postgresql://agentbox:password@postgres:5432/agentbox

# === Redis ===
REDIS_URL=redis://redis:6379

# === Qdrant ===
QDRANT_URL=http://qdrant:6333

# === MindsDB (optional) ===
MINDSDB_URL=http://mindsdb:47334
MINDSDB_KEY=your_api_key
MINDSDB_PASSWORD=your_password

# === n8n ===
N8N_USER=admin
N8N_PASSWORD=your_n8n_password
N8N_WEBHOOK_BASE=http://n8n:5678        # Accepts with or without /webhook suffix

# === Airtable ===
AIRTABLE_PAT=patXXXXXXXXXXXXXX          # Personal Access Token (preferred)
AIRTABLE_API_KEY=keyXXXXXXXXXXXXXX      # Alternative: API Key
AIRTABLE_BASE_ID=appEBG1Kx43n1hwv8      # Main base
AIRTABLE_CONTENT_BASE_ID=appEBG1Kx43n1hwv8  # Content base (can be same)

# Airtable Table Names (customize if different)
AIRTABLE_TABLE_CONTENT_INITIATORS=Content Initiators
AIRTABLE_TABLE_PERSONAS=Personas
AIRTABLE_TABLE_DOMAINS=Content Domains
AIRTABLE_TABLE_BUNDLES=Bundles
AIRTABLE_TABLE_ENTITIES=Entity
AIRTABLE_TABLE_REFERENCES=References

# Airtable Field Names (customize if different)
AIRTABLE_FIELD_XML_BUNDLE=BUNDLE of the XML BUNDLES
AIRTABLE_FIELD_PERSONA_XML=XML Bundle
AIRTABLE_FIELD_DOMAIN_XML=XML Bundle

# === Web Search ===
TAVILY_API_KEY=tvly-...                  # For real-time web search

# === Gateway ===
GATEWAY_PORT=8000
GATEWAY_SECRET=your_api_secret           # Optional: API key for /agents routes

# === Agent URLs (Docker DNS, usually defaults are fine) ===
AGENT_RESEARCH_URL=http://agentbox-research:3001
AGENT_CONTENT_URL=http://agentbox-content:3104

# === Mastra Observability (optional) ===
MASTRA_CLOUD_ACCESS_TOKEN=...
```

### Optional-First Pattern Summary
Tools that return `{ok: false, skipped: true, reason: '...'}` when config missing:
- All Airtable tools (no PAT/API key)
- `mindsdbQuery` (no MINDSDB_URL)
- `n8nTrigger` (no N8N_WEBHOOK_BASE)
- `webSearch` (no TAVILY_API_KEY - returns `{results: [], note: '...'}`)

---

## 9. Build & Deployment

### Docker Configuration

#### .dockerignore
```
node_modules
dist
.git
.env
*.log
.DS_Store
coverage
*.md
.vscode
.idea
```

#### Research Agent Dockerfile
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY agents/research/package*.json ./
RUN npm install
COPY core/shared /app/core/shared
COPY agents/research /app/agents/research
RUN cd /app/agents/research && npm run build
EXPOSE 3001
CMD ["node", "/app/agents/research/dist/src/index.js"]
```

#### Content Agent Dockerfile
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY agents/content/package*.json ./
RUN npm install
COPY core/shared /app/core/shared
COPY agents/content /app/agents/content
RUN cd /app/agents/content && npm run build
EXPOSE 3104
CMD ["node", "/app/agents/content/dist/src/index.js"]
```

#### Gateway Dockerfile
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY core/gateway/package*.json ./
RUN npm install
COPY core/gateway /app/core/gateway
RUN cd /app/core/gateway && npm run build
EXPOSE 8000
CMD ["node", "/app/core/gateway/dist/index.js"]
```

### Build Commands

```bash
# Build specific agent
docker compose build research-agent
docker compose build content-agent

# Build all services
docker compose build

# Start infrastructure + agents
docker compose --profile base up -d        # Core services only
docker compose --profile agents up -d      # All agents
docker compose --profile research up -d    # Research agent only
docker compose --profile content up -d     # Content agent only

# Health check
curl http://localhost:8000/health
curl http://localhost:3001/health
curl http://localhost:3104/health

# View logs
docker compose logs -f research-agent
docker compose logs -f content-agent
docker compose logs -f gateway

# Stop services
docker compose --profile agents down
docker compose --profile base down
```

---

## 10. Testing & Validation

### Health Check Commands
```bash
# All services
curl http://localhost:8000/health
curl http://localhost:3001/health
curl http://localhost:3104/health

# Gateway agent list
curl http://localhost:8000/agents
```

### Research Agent Test
```bash
curl -X POST http://localhost:8000/agents/research/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What are the latest trends in API design?"}
    ]
  }'
```

### Content Agent Test (via /chat)
```bash
curl -X POST http://localhost:8000/agents/content/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Generate content for Content Initiator rec123456789"
      }
    ]
  }'
```

### Content Agent Test (via /generate)
```bash
curl -X POST http://localhost:8000/agents/content/generate \
  -H "Content-Type: application/json" \
  -d '{
    "initiatorId": "rec123456789",
    "baseId": "appEBG1Kx43n1hwv8"
  }'
```

---

## 11. Key Files Reference

### Infrastructure
- `infrastructure/docker-compose.yml` - Multi-container orchestration
- `infrastructure/.env.example` - Configuration template
- `infrastructure/postgres/init.sql` - Database schemas

### Core Shared Tools
- `core/shared/tools/web.ts` - Web search & scraping (3 tools)
- `core/shared/tools/airtable.ts` - Generic Airtable CRUD (4 tools)
- `core/shared/tools/airtable-xml.ts` - XML-aware Airtable (6 tools)
- `core/shared/tools/mindsdb.ts` - MindsDB SQL interface (1 tool)
- `core/shared/tools/n8n.ts` - n8n webhook trigger (1 tool)

### Gateway
- `core/gateway/src/index.ts` - Gateway routing & auth
- `core/gateway/package.json` - Gateway dependencies
- `core/gateway/Dockerfile` - Gateway container

### Research Agent
- `agents/research/src/agent.ts` - Agent definition & model selection
- `agents/research/src/index.ts` - Express server (PORT 3001)
- `agents/research/package.json` - Agent dependencies
- `agents/research/Dockerfile` - Agent container

### Content Agent
- `agents/content/src/mastra/agent.ts` - Agent definition
- `agents/content/src/index.ts` - Express server (PORT 3104)
- `agents/content/package.json` - Agent dependencies
- `agents/content/Dockerfile` - Agent container

### Build Configuration
- `.dockerignore` - Docker build exclusions
- `README.md` - Quick start guide
- `CLAUDE.md` - Development guidance for Claude Code

---

## 12. Summary Statistics

### Component Counts
- **Infrastructure Services**: 8 (PostgreSQL, Redis, Qdrant, MindsDB, n8n, Gateway, Research, Content)
- **Database Schemas**: 5 (agent_memory, workflow_state, user_data, rag_knowledge, analytics)
- **Database Tables**: 15 total
- **Shared Tools**: 15 tools across 5 files
- **Agents**: 2 (Research, Content)
- **API Endpoints**: 9 total
  - Gateway: 4 (/health, /agents, /agents/:name/chat, /agents/content/generate)
  - Research Agent: 2 (/health, /chat)
  - Content Agent: 3 (/health, /chat, /generate)

### Code Metrics
- **TypeScript Files**: 11 (agents + tools + gateway)
- **Package.json Files**: 3 (gateway, research, content)
- **Dockerfiles**: 3 (gateway, research, content)
- **Docker Compose Profiles**: 5 (base, agents, research, content, optional)

### Airtable Integration
- **Base ID**: appEBG1Kx43n1hwv8
- **Tables**: 12 (Content Initiators, Bundles, References, Personas, Entity, Tools, Content Styles, Content Domains, Workflows, Prompts, Projects, Output Types)
- **Total Records**: ~220 across all tables
- **XML Fields**: 27+ AI-generated XML fields across tables
- **XML-Aware Tools**: 6
- **Generic Tools**: 4
- **Architecture**: XML-driven knowledge amplification system with central Bundle orchestration

### Environment Variables
- **Required**: 3 (OPENAI_API_KEY or ANTHROPIC_API_KEY, POSTGRES_PASSWORD, AIRTABLE_PAT)
- **Recommended**: 2 (TAVILY_API_KEY, GATEWAY_SECRET)
- **Optional**: 20+ (service URLs, table names, field names, etc.)

---

**Document Version**: 2.0
**Last Updated**: 2025-01-17
**System Status**: Production-ready with complete XML bundling architecture (12 Airtable tables, 220 records, knowledge amplification loop)
