import {
  setupTestServers,
  request,
  connectSSE,
  TestServersHandle,
  AGENT_ID,
  CASE_ID,
} from './helpers';

let server: TestServersHandle;

beforeAll(async () => {
  server = await setupTestServers();
}, 30000);

afterAll(async () => {
  await server.cleanup();
}, 10000);

describe('Engine health & info', () => {
  it('GET /health should return 200 OK', async () => {
    const res = await request(server.engineUrl, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.raw).toBe('OK');
  });

  it('GET /info should return API documentation', async () => {
    const res = await request(server.engineUrl, 'GET', '/info');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('OPTIONS should return 204 CORS', async () => {
    const res = await request(server.engineUrl, 'OPTIONS', '/health');
    expect(res.status).toBe(204);
  });
});

describe('Agent metadata', () => {
  it('GET /agent/:id/skills should return skill map', async () => {
    const res = await request(server.engineUrl, 'GET', `/agent/${AGENT_ID}/skills`);
    expect(res.status).toBe(200);
    const skill = res.body['Skill_测试技能'];
    expect(skill).toBeDefined();
    expect(skill.desc).toBe('测试技能');
  });

  it('GET /agent/:id/functions should return function map', async () => {
    const res = await request(server.engineUrl, 'GET', `/agent/${AGENT_ID}/functions`);
    expect(res.status).toBe(200);
    const func = res.body['Func_测试函数'];
    expect(func).toBeDefined();
    expect(func.desc).toBe('测试函数');
  });

  it('GET /agent/:id/tasks should return task map', async () => {
    const res = await request(server.engineUrl, 'GET', `/agent/${AGENT_ID}/tasks`);
    expect(res.status).toBe(200);
    const task = res.body['Task_测试任务'];
    expect(task).toBeDefined();
    expect(task.desc).toBe('测试任务');
  });
});

describe('Session lifecycle', () => {
  let sessionId: string;

  it('POST /session should create a new session', async () => {
    const res = await request(server.engineUrl, 'POST', '/session', {
      caseNumber: CASE_ID,
      caseId: CASE_ID,
      agentId: AGENT_ID,
      ...(server.dataUrl ? { dataServerUrl: server.dataUrl } : {}),
    });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.caseId).toBe(CASE_ID);
    expect(res.body.agentId).toBe(AGENT_ID);
    expect(res.body.status).toBe('ready');
    sessionId = res.body.sessionId;
  });

  it('GET /session/:id/events should return SSE connected event', async () => {
    const sse = await connectSSE(server.engineUrl, `/session/${sessionId}/events`);
    expect(sse.status).toBe(200);
    expect(sse.headers['content-type']).toBe('text/event-stream');
    expect(sse.data).toContain('event: connected');
    expect(sse.data).toContain(sessionId);
    sse.close();
  });

  it('POST /session/:id/reply without pending ask should return error', async () => {
    const res = await request(server.engineUrl, 'POST', `/session/${sessionId}/reply`, {
      askId: 'fake-ask-id',
      input: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No pending ask');
  });

  it('DELETE /session/:id should return ok true', async () => {
    const res = await request(server.engineUrl, 'DELETE', `/session/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('DELETE nonexistent session should return ok false', async () => {
    const res = await request(server.engineUrl, 'DELETE', '/session/nonexistent-session');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});
