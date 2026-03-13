import http from 'http';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

export const CASE_ID = 'int-test-case';

const isRemote = !!process.env.DATA_SERVER_URL;

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

export interface TestServerHandle {
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export async function setupTestServer(): Promise<TestServerHandle> {
  if (isRemote) {
    return {
      baseUrl: process.env.DATA_SERVER_URL!.replace(/\/+$/, ''),
      cleanup: async () => {},
    };
  }

  const originalCwd = process.cwd();
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const tmpDir = path.join(
    os.tmpdir(),
    `data-server-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // Create directory structure with fixture data
  await fs.ensureDir(path.join(tmpDir, 'data', 'case-data'));
  await fs.copy(
    path.join(projectRoot, 'data', 'case-data', 'int-test-case'),
    path.join(tmpDir, 'data', 'case-data', 'int-test-case'),
  );

  // Change working directory so FileSystem picks up tmpDir
  process.chdir(tmpDir);

  // Clear jest module cache and re-require handler with new cwd
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { handleRequest } = require('../../../src/data_server/handler');

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

export async function initTestCase(baseUrl: string): Promise<TestResponse> {
  return request(baseUrl, 'POST', '/cases/init', {
    caseNumber: 'int-test-case',
    reset: true,
  });
}
