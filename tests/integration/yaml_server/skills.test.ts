import { setupTestServer, request, TestServerHandle, AGENT_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('Skills API', () => {
  it('GET /skills should return skill list with summary fields', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/skills`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toEqual({
      id: 'Skill_测试技能',
      name: '测试技能',
      execution_type: 'task',
      description: '用于集成测试的技能。',
    });
  });

  it('GET /skills/:skillId should return full skill by ID', async () => {
    const encoded = encodeURIComponent('Skill_测试技能');
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/skills/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('Skill_测试技能');
    expect(res.body.inputs).toBeDefined();
    expect(res.body.task).toBeDefined();
  });

  it('GET /skills/:filename should return skill by filename', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/skills/s_test_skill`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('Skill_测试技能');
  });

  it('GET /skills/nonexistent should return 404', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/skills/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});
