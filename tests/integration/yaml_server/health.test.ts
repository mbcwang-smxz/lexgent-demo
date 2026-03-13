import { setupTestServer, request, TestServerHandle, AGENT_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('YAML Server health & agents list', () => {
  it('GET /health should return status ok with agents list', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.agents).toContain(AGENT_ID);
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /agents should return agent list with metadata', async () => {
    const res = await request(server.baseUrl, 'GET', '/agents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const agent = res.body.find((a: any) => a.id === AGENT_ID);
    expect(agent).toBeDefined();
    expect(agent.name).toBe('集成测试 Agent');
    expect(agent.version).toBe('1.0.0');
    expect(agent.skillCount).toBe(1);
  });

  it('OPTIONS should return 204 and POST should return 405', async () => {
    let res = await request(server.baseUrl, 'OPTIONS', '/health');
    expect(res.status).toBe(204);

    res = await request(server.baseUrl, 'POST', '/health');
    expect(res.status).toBe(405);
  });
});
