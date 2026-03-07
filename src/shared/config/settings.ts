import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

export const CONFIG = {
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-pro',
        baseUrl: process.env.GEMINI_API_URL,
        thinkingLevel: process.env.GEMINI_THINKING_LEVEL || 'off'  // off, low, medium, high
    },
    llm: {
        cache: {
            enabled: process.env.LLM_CACHE_ENABLED !== 'false',
            dir: process.env.LLM_CACHE_DIR || path.join(process.cwd(), '.runs'),
        }
    },
    get system() {
        return {
            defaultAgent: process.env.DEFAULT_AGENT || 'law_agent',
            workspaceDir: process.cwd(),
            dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data'),
            dataServerPort: parseInt(process.env.DATA_SERVER_PORT || '3000', 10),
            agentServerPort: parseInt(process.env.AGENT_SERVER_PORT || '3001', 10),
            dataServerUrl: process.env.DATA_SERVER_URL || `http://localhost:${process.env.DATA_SERVER_PORT || 3000}`,
            yamlServerPort: parseInt(process.env.YAML_SERVER_PORT || '3003', 10),
            yamlServerUrl: process.env.YAML_SERVER_URL || `http://localhost:${process.env.YAML_SERVER_PORT || 3003}`,
            useRemoteConfig: process.env.USE_REMOTE_CONFIG === 'true',
            systemPromptPath: process.env.SYSTEM_PROMPT_PATH || 'framework/system_prompt'
        };
    }
};