import { setupTestServer, request, TestServerHandle, AGENT_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('Prompts API', () => {
  it('GET /prompts/:name should return template as text/plain', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/prompts/p_test_prompt`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.raw).toContain('# 测试提示模板');
    expect(res.raw).toContain('{{instruction}}');
  });

  it('GET /prompts/nonexistent should return 404', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/prompts/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});

describe('Sources API', () => {
  it('GET /source/:name should return JS code as application/javascript', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/source/w_test_worker`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.raw).toContain('function execute');
    expect(res.raw).toContain('module.exports');
  });

  it('GET /source/nonexistent should return 404', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/source/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});
