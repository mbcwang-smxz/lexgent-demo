/**
 * YAML Server - Entry Point
 *
 * Serves Agent/Skill/DocumentType/Prompt configurations via REST API.
 * This server separates configuration management from the Agent Server,
 * making the agent-framework a generic, reusable component.
 */

import http from 'http';
import { handleRequest } from './handler';
import { CONFIG } from '@/shared/config/settings';

const PORT = CONFIG.system.yamlServerPort;

console.log(`[YamlServer] Starting with args: ${process.argv.join(' ')}`);
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`YAML Server running on port ${PORT}`);
    console.log(`  GET  /agents                       - List all agents`);
    console.log(`  GET  /agents/:agentId              - Get agent configuration`);
    console.log(`  GET  /agents/:agentId/skills       - List agent skills`);
    console.log(`  GET  /agents/:agentId/skills/:id   - Get skill configuration`);
    console.log(`  GET  /agents/:agentId/types        - Get document types`);
    console.log(`  GET  /agents/:agentId/prompts/:name - Get prompt template`);
    console.log(`  GET  /health                       - Health check`);
});
