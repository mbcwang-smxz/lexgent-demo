import { setupTestServer, request, TestServerHandle, AGENT_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('Agent manifest & types', () => {
  it('GET /agents/:id should return agent manifest', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('agent');
    expect(res.body.name).toBe('集成测试 Agent');
    expect(res.body.model_name).toBe('test/test-model');
    expect(res.body.default_config).toBe('dev');
  });

  it('GET /agents/nonexistent should return 404', async () => {
    const res = await request(server.baseUrl, 'GET', '/agents/nonexistent-agent');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('GET /agents/:id/types should return document types', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/types`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('document_type');
    expect(res.body.types.length).toBe(2);
    expect(res.body.types[0].id).toBe('测试类型A');
    expect(res.body.types[1].category).toBe('derived');
  });
});
