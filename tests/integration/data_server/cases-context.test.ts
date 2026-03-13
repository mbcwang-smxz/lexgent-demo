import { setupTestServer, request, initTestCase, TestServerHandle, CASE_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
  await initTestCase(server.baseUrl);
});

afterAll(async () => {
  await server.cleanup();
});

describe('GET /cases/:caseId/context', () => {
  it('should return auto-registered file list with at least 5 files', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/context`);
    expect(res.status).toBe(200);
    expect(res.body.caseId).toBe(CASE_ID);
    expect(res.body.files.length).toBeGreaterThanOrEqual(5);
  });

  it('should register D01_测试分析.txt with id=D01 and type=测试分析', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/context`);
    const file = res.body.files.find((f: any) => f.filename === 'D01_测试分析.txt');
    expect(file).toBeDefined();
    expect(file.id).toBe('D01');
    expect(file.type).toBe('测试分析');
  });

  it('should register sample.pdf as P01 with type=待转换文档', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/context`);
    const file = res.body.files.find((f: any) => f.filename === 'sample.pdf');
    expect(file).toBeDefined();
    expect(file.id).toBe('P01');
    expect(file.type).toBe('待转换文档');
  });

  it('should register evidence.txt, 测试中文文件.txt, R01_起诉状.txt as U## id', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/context`);
    for (const filename of ['evidence.txt', '测试中文文件.txt', 'R01_起诉状.txt']) {
      const file = res.body.files.find((f: any) => f.filename === filename);
      expect(file).toBeDefined();
      expect(file.id).toMatch(/^U\d{2}$/);
      expect(file.type).toBe('未分类文档');
    }
  });

  it('should support GET /metadata and PUT /metadata read/write', async () => {
    // GET metadata
    let res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/metadata`);
    expect(res.status).toBe(200);
    expect(res.body.caseId).toBe(CASE_ID);

    // PUT metadata with custom field
    const updated = { ...res.body, metadata: { ...res.body.metadata, customField: 'test-value' } };
    res = await request(server.baseUrl, 'PUT', `/cases/${CASE_ID}/metadata`, updated);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    // GET and verify
    res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/metadata`);
    expect(res.body.metadata.customField).toBe('test-value');
  });
});
