# Content Agent

XML-aware content generation agent that consumes Airtable bundles and generates persona-driven, domain-specific content.

## Purpose

The Content Agent bridges Airtable's XML bundling architecture with AI-powered content generation. It:

- Fetches master XML bundles from Content Initiators
- Parses persona voice and domain constraints
- Generates content matching exact specifications
- Writes results back to Airtable
- Optionally triggers n8n workflows for multi-format distribution

## Architecture

### XML Bundle Flow
```
Content Initiator → Bundle Fetch → XML Parse → Content Generation → Airtable Update → n8n Trigger
```

### Tools Available
- `airtableGetContentBundle` - Fetch master XML bundle
- `airtableCreateContentRequest` - Create new Content Initiator
- `airtableGetPersonaContext` - Get persona XML by slug
- `airtableGetDomainKnowledge` - Get domain XML by slug
- `airtableUpdateContentOutput` - Write generated content back
- `n8nTrigger` - Trigger repurposer workflows

## API Endpoints

### Health Check
```bash
GET /health
```

### Chat Interface
```bash
POST /chat
{
  "messages": [
    { "role": "user", "content": "Generate content for rec123..." }
  ]
}
```

### Direct Content Generation
```bash
POST /generate
{
  "initiatorId": "rec123...",
  "baseId": "appXXX..." # optional
}
```

## Environment Variables

Required:
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` - LLM provider
- `AIRTABLE_PAT` or `AIRTABLE_API_KEY` - Airtable access
- `AIRTABLE_BASE_ID` or `AIRTABLE_CONTENT_BASE_ID` - Base ID

Optional (with defaults):
- `AIRTABLE_TABLE_CONTENT_INITIATORS` (default: "Content Initiators")
- `AIRTABLE_TABLE_PERSONAS` (default: "Personas")
- `AIRTABLE_TABLE_DOMAINS` (default: "Content Domains")
- `AIRTABLE_FIELD_XML_BUNDLE` (default: "BUNDLE of the XML BUNDLES")
- `N8N_WEBHOOK_BASE` - For triggering repurposer workflows
- `PORT` (default: 3104)

## Usage Examples

### Generate Content from Initiator
```bash
curl -X POST http://localhost:3104/generate \
  -H "Content-Type: application/json" \
  -d '{
    "initiatorId": "recXXXXXXXXXXXXXX"
  }'
```

### Create New Content Request
```bash
curl -X POST http://localhost:3104/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": "Create a new content request: Write a blog post about AI in marketing, use the tech-blogger persona and marketing-ai domain"
    }]
  }'
```

## Development

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Docker

```bash
# Build
docker build -t content-agent .

# Run
docker run -p 3104:3104 \
  -e OPENAI_API_KEY=sk-... \
  -e AIRTABLE_PAT=pat... \
  -e AIRTABLE_BASE_ID=app... \
  content-agent
```

## Integration with n8n

After generating content, the agent can trigger n8n workflows for repurposing:

1. Content generated → Airtable updated
2. Agent calls `n8nTrigger` with scenario ID
3. n8n workflow creates 10+ format variations
4. Results distributed to channels

## Quality Standards

The agent enforces:
- **Voice Accuracy**: Exact persona tone and vocabulary matching
- **Domain Compliance**: Adherence to domain-specific guidelines
- **Goal Alignment**: Content achieves stated objectives
- **Format Precision**: Delivers in requested output type
