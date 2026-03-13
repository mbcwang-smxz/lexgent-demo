import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

export const AGENT_ID = 'int-test-agent';
export const CASE_ID = 'int-test-case';

const isRemote = !!process.env.ENGINE_SERVER_URL;

export interface TestResponse {
  status: number;
  body: any;
  headers: http.IncomingHttpHeaders;
  raw: string;
}

export function request(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: any,
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const postData = body !== undefined ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: postData
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode!, body: parsed, headers: res.headers, raw: data });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

export function connectSSE(
  baseUrl: string,
  urlPath: string,
  timeoutMs = 3000,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET' },
      (res) => {
        let data = '';
        const timer = setTimeout(() => {
          resolve({ status: res.statusCode!, headers: res.headers, data, close: () => req.destroy() });
        }, timeoutMs);

        res.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('event: connected') && data.includes('\n\n')) {
            clearTimeout(timer);
            resolve({ status: res.statusCode!, headers: res.headers, data, close: () => req.destroy() });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request(baseUrl, 'GET', '/health');
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Engine at ${baseUrl} did not become ready within ${timeoutMs}ms`);
}

export interface TestServersHandle {
  engineUrl: string;
  dataUrl: string;
  cleanup: () => Promise<void>;
}

export async function setupTestServers(): Promise<TestServersHandle> {
  if (isRemote) {
    const dataUrl = process.env.DATA_SERVER_URL || '';
    // Init test case on data server if URL is available
    if (dataUrl) {
      await request(dataUrl, 'POST', '/cases/init', { caseNumber: CASE_ID, reset: true });
    }
    return {
      engineUrl: process.env.ENGINE_SERVER_URL!.replace(/\/+$/, ''),
      dataUrl,
      cleanup: async () => {},
    };
  }

  const originalCwd = process.cwd();
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const engineRoot = path.resolve(projectRoot, '..', 'lexgent-engine');

  if (!(await fs.pathExists(engineRoot))) {
    throw new Error(
      `Engine project not found at ${engineRoot}. ` +
        'Place lexgent-engine alongside lexgent-demo, or use remote mode (ENGINE_SERVER_URL).',
    );
  }

  const tmpDir = path.join(
    os.tmpdir(),
    `engine-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // Copy fixtures for Data Server and YAML Server
  await fs.ensureDir(path.join(tmpDir, 'data', 'case-data'));
  await fs.ensureDir(path.join(tmpDir, 'data', 'yaml'));
  await fs.copy(
    path.join(projectRoot, 'data', 'case-data', 'int-test-case'),
    path.join(tmpDir, 'data', 'case-data', 'int-test-case'),
  );
  await fs.copy(
    path.join(projectRoot, 'data', 'yaml', 'int-test-agent'),
    path.join(tmpDir, 'data', 'yaml', 'int-test-agent'),
  );

  // Start Data Server in-process
  process.chdir(tmpDir);
  jest.resetModules();
  const dataHandler = require('../../../src/data_server/handler');
  const dataServer = http.createServer(dataHandler.handleRequest);
  await new Promise<void>((r) => dataServer.listen(0, '127.0.0.1', r));
  const dataPort = (dataServer.address() as any).port;
  const dataUrl = `http://127.0.0.1:${dataPort}`;

  // Start YAML Server in-process
  jest.resetModules();
  const yamlHandler = require('../../../src/yaml_server/handler');
  const yamlServer = http.createServer(yamlHandler.handleRequest);
  await new Promise<void>((r) => yamlServer.listen(0, '127.0.0.1', r));
  const yamlPort = (yamlServer.address() as any).port;
  const yamlUrl = `http://127.0.0.1:${yamlPort}`;

  // Init test case on data server
  await request(dataUrl, 'POST', '/cases/init', { caseNumber: CASE_ID, reset: true });

  // Start Engine as child process
  const enginePort = await getFreePort();
  const engineUrl = `http://127.0.0.1:${enginePort}`;

  const engineProcess: ChildProcess = spawn(
    'npx',
    ['ts-node', 'src/agent_server/index.ts'],
    {
      cwd: engineRoot,
      env: {
        ...process.env,
        YAML_SERVER_URL: yamlUrl,
        DATA_SERVER_URL: dataUrl,
        AGENT_SERVER_PORT: String(enginePort),
        LLM_CACHE_ENABLED: 'false',
      },
      stdio: 'pipe',
      detached: true,
    },
  );

  // Drain output to prevent backpressure
  engineProcess.stdout?.resume();
  engineProcess.stderr?.resume();

  // Wait for engine to be ready
  await waitForHealth(engineUrl, 20000);

  return {
    engineUrl,
    dataUrl,
    cleanup: async () => {
      // Kill engine process tree (npx spawns child processes)
      const pid = engineProcess.pid;
      if (pid) {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          engineProcess.kill('SIGTERM');
        }
      }
      await new Promise<void>((r) => {
        const fallback = setTimeout(() => {
          if (pid) {
            try { process.kill(-pid, 'SIGKILL'); } catch {}
          }
          r();
        }, 3000);
        engineProcess.on('exit', () => {
          clearTimeout(fallback);
          r();
        });
      });
      await new Promise<void>((r) => dataServer.close(() => r()));
      await new Promise<void>((r) => yamlServer.close(() => r()));
      process.chdir(originalCwd);
      await fs.remove(tmpDir);
    },
  };
}
