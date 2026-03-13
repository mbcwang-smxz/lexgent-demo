import http from 'http';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

export const AGENT_ID = 'int-test-agent';

const isRemote = !!process.env.YAML_SERVER_URL;

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
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
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
    req.end();
  });
}

export interface TestServerHandle {
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export async function setupTestServer(): Promise<TestServerHandle> {
  if (isRemote) {
    return {
      baseUrl: process.env.YAML_SERVER_URL!.replace(/\/+$/, ''),
      cleanup: async () => {},
    };
  }

  const originalCwd = process.cwd();
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const tmpDir = path.join(
    os.tmpdir(),
    `yaml-server-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // Create directory structure with fixture data
  await fs.ensureDir(path.join(tmpDir, 'data', 'yaml'));
  await fs.copy(
    path.join(projectRoot, 'data', 'yaml', 'int-test-agent'),
    path.join(tmpDir, 'data', 'yaml', 'int-test-agent'),
  );

  // Change working directory so CONFIG.system.dataDir picks up tmpDir
  process.chdir(tmpDir);

  // Clear jest module cache and re-require handler with new cwd
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { handleRequest } = require('../../../src/yaml_server/handler');

  const server = http.createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.chdir(originalCwd);
      await fs.remove(tmpDir);
    },
  };
}
