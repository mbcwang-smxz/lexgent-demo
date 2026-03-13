import { setupTestServer, request, TestServerHandle, AGENT_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('Directory listing API', () => {
  it('GET /dir/:subdir should return file list', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/dir/skills`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain('s_test_skill.yaml');
  });

  it('GET /dir/:subdir?pattern= should filter by glob', async () => {
    const res = await request(
      server.baseUrl,
      'GET',
      `/agents/${AGENT_ID}/dir/functions?pattern=f*.yaml`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain('f_test_func.yaml');
    expect(res.body).not.toContain('w_test_worker.js');
  });

  it('GET /dir/nonexistent should return empty array', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/dir/nonexistent`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
