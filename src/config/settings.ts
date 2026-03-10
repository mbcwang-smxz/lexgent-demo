import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

export const CONFIG = {
    get system() {
        const dataServerUrl = process.env.DATA_SERVER_URL || 'http://localhost:3000';
        const yamlServerUrl = process.env.YAML_SERVER_URL || 'http://localhost:3003';
        const agentServerUrl = process.env.AGENT_SERVER_URL || 'http://localhost:3001';

        return {
            defaultAgent: process.env.DEFAULT_AGENT || 'law_agent',
            workspaceDir: process.cwd(),
            dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data'),
            dataServerUrl,
            dataServerPort: new URL(dataServerUrl).port ? parseInt(new URL(dataServerUrl).port) : 3000,
            yamlServerUrl,
            yamlServerPort: new URL(yamlServerUrl).port ? parseInt(new URL(yamlServerUrl).port) : 3003,
            agentServerUrl,
            agentServerPort: new URL(agentServerUrl).port ? parseInt(new URL(agentServerUrl).port) : 3001,
            useRemoteConfig: process.env.USE_REMOTE_CONFIG === 'true',
            systemPromptPath: process.env.SYSTEM_PROMPT_PATH || 'framework/system_prompt'
        };
    }
};