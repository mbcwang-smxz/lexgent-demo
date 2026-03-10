import { Router, Request, Response } from 'express';
import http from 'http';

export function createProxyRoutes(agentUrl: string, dataUrl: string, yamlUrl: string): Router {
    const router = Router();

    // Config endpoint - expose server URLs to frontend
    router.get('/config', (_req, res) => {
        res.json({ dataServerUrl: dataUrl, yamlServerUrl: yamlUrl });
    });

    // --- Agent Engine proxies ---

    // GET proxies
    const agentGetPaths = [
        '/agents',
        '/agent/:agentId/skills',
        '/agent/:agentId/functions',
        '/agent/:agentId/tasks',
    ];
    for (const p of agentGetPaths) {
        router.get(p, (req, res) => proxyJson(agentUrl, req, res));
    }

    // POST proxies
    const agentPostPaths = [
        '/session',
        '/session/:sessionId/task',
        '/session/:sessionId/reply',
        '/agent/:agentId/execute_command',
        '/agent/:agentId/clear-cache',
    ];
    for (const p of agentPostPaths) {
        router.post(p, (req, res) => proxyJson(agentUrl, req, res, 'POST'));
    }

    // SSE proxy
    router.get('/session/:sessionId/events', (req, res) => {
        const targetUrl = `${agentUrl}/session/${req.params.sessionId}/events`;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const proxyReq = http.get(targetUrl, (proxyRes) => {
            proxyRes.on('data', (chunk: Buffer) => {
                res.write(chunk);
            });
            proxyRes.on('end', () => {
                res.end();
            });
        });

        proxyReq.on('error', () => {
            res.end();
        });

        req.on('close', () => {
            proxyReq.destroy();
        });
    });

    // --- Data Server proxies ---
    router.post('/cases/init', (req, res) => proxyJson(dataUrl, req, res, 'POST'));

    router.get('/cases/:caseId/files/:filename', (req, res) => {
        const targetPath = `/cases/${req.params.caseId}/files/${encodeURIComponent(req.params.filename)}`;
        proxyJson(dataUrl, req, res, 'GET', targetPath);
    });

    return router;
}

function proxyJson(baseUrl: string, req: Request, res: Response, method?: string, overridePath?: string) {
    const targetUrl = new URL(overridePath || req.originalUrl.replace(/^\/api/, ''), baseUrl);
    const isPost = (method || req.method) === 'POST';

    const body = isPost ? JSON.stringify(req.body) : undefined;
    const headers: Record<string, string> = {};
    if (isPost) {
        headers['Content-Type'] = 'application/json';
    }

    const proxyReq = http.request(targetUrl, { method: method || req.method, headers }, (proxyRes) => {
        res.status(proxyRes.statusCode || 500);
        let data = '';
        proxyRes.on('data', (chunk) => { data += chunk; });
        proxyRes.on('end', () => {
            try {
                res.json(JSON.parse(data));
            } catch {
                res.send(data);
            }
        });
    });

    proxyReq.on('error', (err) => {
        res.status(502).json({ error: `Proxy error: ${err.message}` });
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
}
