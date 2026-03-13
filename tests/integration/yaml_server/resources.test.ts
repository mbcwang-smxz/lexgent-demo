import { setupTestServer, request, TestServerHandle, AGENT_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('Functions API', () => {
  it('GET /functions should return function list', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/functions`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe('Func_测试函数');
    expect(res.body[0].name).toBe('测试函数');
  });

  it('GET /functions/:funcId should return function by ID', async () => {
    const encoded = encodeURIComponent('Func_测试函数');
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/functions/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('Func_测试函数');
    expect(res.body.calling_name).toBe('test_function');
    expect(res.body.endpoint).toBe('/api/tools/echo');
    expect(res.body.parameters).toBeDefined();
  });

  it('GET /functions/nonexistent should return 404', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/functions/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe('Tasks API', () => {
  it('GET /tasks should return task list', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/tasks`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe('Task_测试任务');
    expect(res.body[0].name).toBe('测试任务');
  });

  it('GET /tasks/:taskId should return task by ID', async () => {
    const encoded = encodeURIComponent('Task_测试任务');
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/tasks/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('Task_测试任务');
    expect(res.body.prompt).toContain('测试任务');
    expect(res.body.inputs).toBeDefined();
  });
});

describe('Configs API', () => {
  it('GET /configs/:configId should return config by ID', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/configs/dev`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('dev');
    expect(res.body.name).toBe('测试开发环境');
    expect(res.body.data_server.url).toBe('http://localhost:3000');
    expect(res.body.llm).toBeDefined();
  });

  it('GET /configs/:filename should return config by filename', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/configs/dev`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('dev');
  });

  it('GET /configs/nonexistent should return 404', async () => {
    const res = await request(server.baseUrl, 'GET', `/agents/${AGENT_ID}/configs/nonexistent`);
    expect(res.status).toBe(404);
  });
});
