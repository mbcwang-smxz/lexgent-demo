/**
 * YAML Server - Request Handler
 *
 * REST API for Agent configurations:
 *   GET  /agents                              - List all available agents
 *   GET  /agents/:agentId                     - Get agent configuration
 *   GET  /agents/:agentId/skills              - List agent's skills
 *   GET  /agents/:agentId/skills/:skillId     - Get skill configuration
 *   GET  /agents/:agentId/functions            - List agent's functions
 *   GET  /agents/:agentId/functions/:funcId    - Get function configuration
 *   GET  /agents/:agentId/tasks               - List agent's tasks
 *   GET  /agents/:agentId/tasks/:taskId       - Get task configuration
 *   GET  /agents/:agentId/types               - Get document types
 *   GET  /agents/:agentId/prompts/:name       - Get prompt template
 *   GET  /agents/:agentId/source/:name        - Get JS source for code-based functions
 *   GET  /agents/:agentId/dir/:subdir         - List files in a subdirectory
 *   GET  /health                              - Health check
 */

import http from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs-extra';
import { parse as parseYaml } from 'yaml';
import { CONFIG } from '@/config/settings';

// Base directory for YAML configurations
const YAML_BASE_DIR = path.join(CONFIG.system.dataDir, 'yaml');

// Cache for loaded configurations (loaded on startup)
interface AgentCache {
    manifest: any;
    skills: Map<string, any>;           // Indexed by skill ID (e.g., "Skill_当事人提取")
    skillsByFile: Map<string, any>;     // Indexed by file name (e.g., "s01_party_extraction")
    functions: Map<string, any>;        // Indexed by function ID
    functionsByFile: Map<string, any>;  // Indexed by file name
    tasks: Map<string, any>;           // Indexed by task ID
    tasksByFile: Map<string, any>;     // Indexed by file name
    configs: Map<string, any>;         // Indexed by config ID (e.g., "local")
    configsByFile: Map<string, any>;   // Indexed by file name
    documentTypes: any;
    prompts: Map<string, string>;
    sources: Map<string, string>;       // sourceName → JS source (from functions dir)
}

const agentCache = new Map<string, AgentCache>();

/**
 * Initialize cache by loading all agent configurations
 */
async function initCache(): Promise<void> {
    console.log(`[YamlServer] Loading configurations from ${YAML_BASE_DIR}`);

    try {
        const entries = await fs.readdir(YAML_BASE_DIR, { withFileTypes: true });
        const agentDirs = entries.filter(e => e.isDirectory());

        for (const dir of agentDirs) {
            const agentId = dir.name;
            const agentPath = path.join(YAML_BASE_DIR, agentId);
            const agentFile = path.join(agentPath, 'agent.yaml');

            if (await fs.pathExists(agentFile)) {
                await loadAgentToCache(agentId, agentPath);
            } else {
                // Non-agent directories (e.g., framework/) — load prompts only
                await loadPromptsOnlyToCache(agentId, agentPath);
            }
        }

        console.log(`[YamlServer] Loaded ${agentCache.size} agent(s): ${[...agentCache.keys()].join(', ')}`);
    } catch (error) {
        console.error(`[YamlServer] Failed to initialize cache:`, error);
    }
}

/**
 * Load a single agent and all its resources to cache
 */
async function loadAgentToCache(agentId: string, agentPath: string): Promise<void> {
    const cache: AgentCache = {
        manifest: null,
        skills: new Map(),
        skillsByFile: new Map(),
        functions: new Map(),
        functionsByFile: new Map(),
        tasks: new Map(),
        tasksByFile: new Map(),
        configs: new Map(),
        configsByFile: new Map(),
        documentTypes: null,
        prompts: new Map(),
        sources: new Map()
    };

    // Load agent manifest
    const agentFile = path.join(agentPath, 'agent.yaml');
    cache.manifest = await loadYamlFile(agentFile);

    // Load skills
    const skillsDir = path.join(agentPath, 'skills');
    if (await fs.pathExists(skillsDir)) {
        const skillFiles = await fs.readdir(skillsDir);
        for (const file of skillFiles) {
            if (file.endsWith('.yaml')) {
                const skillPath = path.join(skillsDir, file);
                const skill = await loadYamlFile(skillPath);
                if (skill && skill.id) {
                    // Index by skill ID
                    cache.skills.set(skill.id, skill);
                    // Also index by file name (without extension) for resolver compatibility
                    const fileName = file.replace('.yaml', '');
                    cache.skillsByFile.set(fileName, skill);
                }
            }
        }
    }

    // Load functions
    const functionsDir = path.join(agentPath, 'functions');
    if (await fs.pathExists(functionsDir)) {
        const funcFiles = await fs.readdir(functionsDir);
        for (const file of funcFiles) {
            if (file.endsWith('.yaml')) {
                const funcPath = path.join(functionsDir, file);
                const func = await loadYamlFile(funcPath);
                if (func && func.id) {
                    cache.functions.set(func.id, func);
                    const fileName = file.replace('.yaml', '');
                    cache.functionsByFile.set(fileName, func);
                }
            }
        }
    }

    // Load tasks
    const tasksDir = path.join(agentPath, 'tasks');
    if (await fs.pathExists(tasksDir)) {
        const taskFiles = await fs.readdir(tasksDir);
        for (const file of taskFiles) {
            if (file.endsWith('.yaml')) {
                const taskPath = path.join(tasksDir, file);
                const task = await loadYamlFile(taskPath);
                if (task && task.id) {
                    cache.tasks.set(task.id, task);
                    const fileName = file.replace('.yaml', '');
                    cache.tasksByFile.set(fileName, task);
                }
            }
        }
    }

    // Load configs
    const configsDir = path.join(agentPath, 'configs');
    if (await fs.pathExists(configsDir)) {
        const configFiles = await fs.readdir(configsDir);
        for (const file of configFiles) {
            if (file.endsWith('.yaml')) {
                const configPath = path.join(configsDir, file);
                const config = await loadYamlFile(configPath);
                if (config && config.id) {
                    cache.configs.set(config.id, config);
                    const fileName = file.replace('.yaml', '');
                    cache.configsByFile.set(fileName, config);
                }
            }
        }
    }

    // Load document types (types.yaml file, not types/ directory)
    const typesFile = path.join(agentPath, 'types.yaml');
    if (await fs.pathExists(typesFile)) {
        cache.documentTypes = await loadYamlFile(typesFile);
    }

    // Load prompts
    const promptsDir = path.join(agentPath, 'prompts');
    if (await fs.pathExists(promptsDir)) {
        const promptFiles = await fs.readdir(promptsDir);
        for (const file of promptFiles) {
            if (file.endsWith('.hbs')) {
                const promptName = file.replace('.hbs', '');
                const promptPath = path.join(promptsDir, file);
                const content = await fs.readFile(promptPath, 'utf-8');
                cache.prompts.set(promptName, content);
            }
        }
    }

    // Load JS sources from functions dir (for code-based functions)
    if (await fs.pathExists(functionsDir)) {
        const allFuncFiles = await fs.readdir(functionsDir);
        for (const file of allFuncFiles) {
            if (file.endsWith('.js')) {
                const sourceName = file.replace('.js', '');
                const sourcePath = path.join(functionsDir, file);
                const content = await fs.readFile(sourcePath, 'utf-8');
                cache.sources.set(sourceName, content);
            }
        }
    }

    agentCache.set(agentId, cache);
    console.log(`[YamlServer] Loaded agent '${agentId}': ${cache.skills.size} skills, ${cache.functions.size} functions, ${cache.tasks.size} tasks, ${cache.configs.size} configs, ${cache.prompts.size} prompts, ${cache.sources.size} js sources`);
}

/**
 * Load prompts from a non-agent directory (e.g., framework/)
 * Creates a minimal cache entry with only prompts populated.
 */
async function loadPromptsOnlyToCache(dirId: string, dirPath: string): Promise<void> {
    const cache: AgentCache = {
        manifest: null,
        skills: new Map(),
        skillsByFile: new Map(),
        functions: new Map(),
        functionsByFile: new Map(),
        tasks: new Map(),
        tasksByFile: new Map(),
        configs: new Map(),
        configsByFile: new Map(),
        documentTypes: null,
        prompts: new Map(),
        sources: new Map()
    };

    // Scan .hbs files directly in the directory (no prompts/ subdirectory)
    const files = await fs.readdir(dirPath);
    for (const file of files) {
        if (file.endsWith('.hbs')) {
            const promptName = file.replace('.hbs', '');
            const promptPath = path.join(dirPath, file);
            const content = await fs.readFile(promptPath, 'utf-8');
            cache.prompts.set(promptName, content);
        }
    }

    if (cache.prompts.size > 0) {
        agentCache.set(dirId, cache);
        console.log(`[YamlServer] Loaded prompts-only dir '${dirId}': ${cache.prompts.size} prompts`);
    }
}

/**
 * Load and parse a YAML file
 */
async function loadYamlFile(filePath: string): Promise<any> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return parseYaml(content);
    } catch (error) {
        console.error(`[YamlServer] Failed to load ${filePath}:`, error);
        return null;
    }
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, data: any, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
}

/**
 * Send text response
 */
function sendText(res: http.ServerResponse, text: string, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
}

/**
 * Send error response
 */
function sendError(res: http.ServerResponse, message: string, status = 404): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
}

/**
 * Parse URL path to extract route components
 */
function parseRoute(pathname: string): { parts: string[], agentId?: string } {
    const parts = pathname.split('/').filter(p => p).map(p => decodeURIComponent(p));
    const agentId = parts[0] === 'agents' && parts[1] ? parts[1] : undefined;
    return { parts, agentId };
}

// Initialize cache on module load
let cacheInitialized = false;

/**
 * Main request handler
 */
export const handleRequest: http.RequestListener = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    // Initialize cache on first request
    if (!cacheInitialized) {
        await initCache();
        cacheInitialized = true;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const { parts, agentId } = parseRoute(url.pathname);

    // Only GET requests are supported
    if (req.method !== 'GET') {
        sendError(res, 'Method not allowed', 405);
        return;
    }

    // Route: GET /health
    if (url.pathname === '/health') {
        sendJson(res, {
            status: 'ok',
            agents: [...agentCache.keys()],
            timestamp: new Date().toISOString()
        });
        return;
    }

    // Route: GET /agents
    if (url.pathname === '/agents') {
        const agents = [...agentCache.entries()].map(([id, cache]) => ({
            id,
            name: cache.manifest?.name,
            version: cache.manifest?.version,
            description: cache.manifest?.description,
            skillCount: cache.skills.size
        }));
        sendJson(res, agents);
        return;
    }

    // All other routes require agentId
    if (!agentId) {
        sendError(res, 'Not found', 404);
        return;
    }

    const cache = agentCache.get(agentId);
    if (!cache) {
        sendError(res, `Agent '${agentId}' not found`, 404);
        return;
    }

    // Route: GET /agents/:agentId
    if (parts.length === 2) {
        sendJson(res, cache.manifest);
        return;
    }

    // Route: GET /agents/:agentId/skills
    if (parts[2] === 'skills' && parts.length === 3) {
        const skills = [...cache.skills.entries()].map(([id, skill]) => ({
            id,
            name: skill.name,
            execution_type: skill.execution_type,
            description: skill.description
        }));
        sendJson(res, skills);
        return;
    }

    // Route: GET /agents/:agentId/skills/:skillId
    // Supports lookup by skill ID (e.g., "Skill_当事人提取") or file name (e.g., "s01_party_extraction")
    if (parts[2] === 'skills' && parts[3]) {
        const skillKey = parts[3];
        // Try lookup by skill ID first, then by file name
        const skill = cache.skills.get(skillKey) || cache.skillsByFile.get(skillKey);
        if (!skill) {
            sendError(res, `Skill '${skillKey}' not found in agent '${agentId}'`, 404);
            return;
        }
        sendJson(res, skill);
        return;
    }

    // Route: GET /agents/:agentId/types
    if (parts[2] === 'types' && parts.length === 3) {
        if (!cache.documentTypes) {
            sendError(res, `Document types not found for agent '${agentId}'`, 404);
            return;
        }
        sendJson(res, cache.documentTypes);
        return;
    }

    // Route: GET /agents/:agentId/functions
    if (parts[2] === 'functions' && parts.length === 3) {
        const functions = [...cache.functions.entries()].map(([id, func]) => ({
            id,
            name: func.name,
            description: func.description
        }));
        sendJson(res, functions);
        return;
    }

    // Route: GET /agents/:agentId/functions/:funcId
    if (parts[2] === 'functions' && parts[3]) {
        const funcKey = parts[3];
        const func = cache.functions.get(funcKey) || cache.functionsByFile.get(funcKey);
        if (!func) {
            sendError(res, `Function '${funcKey}' not found in agent '${agentId}'`, 404);
            return;
        }
        sendJson(res, func);
        return;
    }

    // Route: GET /agents/:agentId/tasks
    if (parts[2] === 'tasks' && parts.length === 3) {
        const tasks = [...cache.tasks.entries()].map(([id, task]) => ({
            id,
            name: task.name,
            description: task.description
        }));
        sendJson(res, tasks);
        return;
    }

    // Route: GET /agents/:agentId/tasks/:taskId
    if (parts[2] === 'tasks' && parts[3]) {
        const taskKey = parts[3];
        const task = cache.tasks.get(taskKey) || cache.tasksByFile.get(taskKey);
        if (!task) {
            sendError(res, `Task '${taskKey}' not found in agent '${agentId}'`, 404);
            return;
        }
        sendJson(res, task);
        return;
    }

    // Route: GET /agents/:agentId/configs/:configId
    if (parts[2] === 'configs' && parts[3]) {
        const configKey = parts[3];
        const config = cache.configs.get(configKey) || cache.configsByFile.get(configKey);
        if (!config) {
            sendError(res, `Config '${configKey}' not found in agent '${agentId}'`, 404);
            return;
        }
        sendJson(res, config);
        return;
    }

    // Route: GET /agents/:agentId/prompts/:name
    if (parts[2] === 'prompts' && parts[3]) {
        const promptName = parts[3];
        const prompt = cache.prompts.get(promptName);
        if (!prompt) {
            sendError(res, `Prompt '${promptName}' not found in agent '${agentId}'`, 404);
            return;
        }
        sendText(res, prompt);
        return;
    }

    // Route: GET /agents/:agentId/source/:name — JS source for code-based functions
    if (parts[2] === 'source' && parts[3]) {
        const sourceName = parts[3];
        const source = cache.sources.get(sourceName);
        if (!source) {
            sendError(res, `JS source '${sourceName}' not found in agent '${agentId}'`, 404);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(source);
        return;
    }

    // Route: GET /agents/:agentId/dir/:subdir — List files in a subdirectory
    // Optional query param: ?pattern=s*.yaml
    if (parts[2] === 'dir' && parts[3]) {
        const subdir = parts[3];
        const dirPath = path.join(YAML_BASE_DIR, agentId, subdir);

        if (!(await fs.pathExists(dirPath))) {
            sendJson(res, []);
            return;
        }

        const files = await fs.readdir(dirPath);
        const pattern = url.searchParams.get('pattern');

        if (pattern) {
            // Convert simple glob pattern (e.g., "s*.yaml") to regex
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            sendJson(res, files.filter((f: string) => regex.test(f)));
        } else {
            sendJson(res, files);
        }
        return;
    }

    sendError(res, 'Not found', 404);
};
