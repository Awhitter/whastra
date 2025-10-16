-- AgentBox Database Initialization
-- Creates schemas and tables for multi-agent system

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;    -- For vector embeddings

-- Schema: agent_memory (for agent conversation history and context)
CREATE SCHEMA IF NOT EXISTS agent_memory;

CREATE TABLE IF NOT EXISTS agent_memory.threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(255) NOT NULL,
    user_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS agent_memory.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES agent_memory.threads(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1536)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON agent_memory.messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON agent_memory.messages(created_at DESC);

-- Schema: workflow_state (for multi-step workflow tracking)
CREATE SCHEMA IF NOT EXISTS workflow_state;

CREATE TABLE IF NOT EXISTS workflow_state.executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'paused')),
    current_step INTEGER DEFAULT 0,
    total_steps INTEGER NOT NULL,
    input_data JSONB NOT NULL,
    output_data JSONB,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS workflow_state.steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES workflow_state.executions(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    agent_name VARCHAR(255),
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_executions_status ON workflow_state.executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_workflow_name ON workflow_state.executions(workflow_name);
CREATE INDEX IF NOT EXISTS idx_steps_execution_id ON workflow_state.steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_steps_step_number ON workflow_state.steps(step_number);

-- Schema: user_data (for user profiles and preferences)
CREATE SCHEMA IF NOT EXISTS user_data;

CREATE TABLE IF NOT EXISTS user_data.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(255) UNIQUE,
    email VARCHAR(255),
    name VARCHAR(255),
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_data.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_data.users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    scopes JSONB DEFAULT '[]'::jsonb,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_external_id ON user_data.users(external_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON user_data.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON user_data.api_keys(user_id);

-- Schema: rag_knowledge (for RAG knowledge base and embeddings)
CREATE SCHEMA IF NOT EXISTS rag_knowledge;

CREATE TABLE IF NOT EXISTS rag_knowledge.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(255) NOT NULL,
    source_id VARCHAR(255),
    title TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rag_knowledge.chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES rag_knowledge.documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON rag_knowledge.documents(source);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON rag_knowledge.chunks(document_id);

-- Schema: analytics (for performance tracking and monitoring)
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.agent_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(255) NOT NULL,
    metric_type VARCHAR(100) NOT NULL,
    value NUMERIC NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS analytics.api_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(255),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER,
    duration_ms INTEGER,
    user_id UUID REFERENCES user_data.users(id),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_name ON analytics.agent_metrics(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_timestamp ON analytics.agent_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON analytics.api_calls(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_agent_name ON analytics.api_calls(agent_name);

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA agent_memory TO agentbox;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA agent_memory TO agentbox;
GRANT ALL PRIVILEGES ON SCHEMA workflow_state TO agentbox;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA workflow_state TO agentbox;
GRANT ALL PRIVILEGES ON SCHEMA user_data TO agentbox;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA user_data TO agentbox;
GRANT ALL PRIVILEGES ON SCHEMA rag_knowledge TO agentbox;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA rag_knowledge TO agentbox;
GRANT ALL PRIVILEGES ON SCHEMA analytics TO agentbox;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA analytics TO agentbox;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_agent_memory_threads_updated_at BEFORE UPDATE ON agent_memory.threads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_data_users_updated_at BEFORE UPDATE ON user_data.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rag_knowledge_documents_updated_at BEFORE UPDATE ON rag_knowledge.documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user for testing
INSERT INTO user_data.users (external_id, email, name, preferences)
VALUES (
    'admin',
    'admin@agentbox.local',
    'AgentBox Admin',
    '{"theme": "dark", "notifications": true}'::jsonb
) ON CONFLICT (external_id) DO NOTHING;
