import express from 'express';
import path from 'path';
import { CONFIG } from '@/config/settings';
import { createProxyRoutes } from './routes';

const PORT = parseInt(process.env.WEB_SERVER_PORT || '3002', 10);
const AGENT_SERVER_URL = CONFIG.system.agentServerUrl;
const DATA_SERVER_URL = CONFIG.system.dataServerUrl;
const YAML_SERVER_URL = CONFIG.system.yamlServerUrl;

const app = express();
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API proxy routes
app.use('/api', createProxyRoutes(AGENT_SERVER_URL, DATA_SERVER_URL, YAML_SERVER_URL));

// SPA fallback
app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Server:    http://0.0.0.0:${PORT}`);
    console.log(`Agent Engine:  ${AGENT_SERVER_URL}`);
    console.log(`Data Server:   ${DATA_SERVER_URL}`);
    console.log(`YAML Server:   ${YAML_SERVER_URL}`);
});
