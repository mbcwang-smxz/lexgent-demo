import { setupTestServer, request, initTestCase, TestServerHandle, CASE_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
  await initTestCase(server.baseUrl);
});

afterAll(async () => {
  await server.cleanup();
});

describe('File CRUD operations', () => {
  it('GET should return file content', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/evidence.txt`);
    expect(res.status).toBe(200);
    expect(res.raw).toBe('测试证据内容');
  });

  it('GET should handle Chinese filename (URL encoded)', async () => {
    const encoded = encodeURIComponent('测试中文文件.txt');
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.raw).toBe('中文文件名测试内容');
  });

  it('GET should return 404 for non-existent file', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/nonexistent.txt`);
    expect(res.status).toBe(404);
  });

  it('POST should create new file and GET should verify content', async () => {
    const content = '新文件内容';
    let res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/new_crud_file.txt`, {
      content,
    });
    expect(res.status).toBe(200);

    res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/new_crud_file.txt`);
    expect(res.status).toBe(200);
    expect(res.raw).toBe(content);
  });

  it('POST with id/type_ref should register metadata entry', async () => {
    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/typed_file.txt`, {
      content: 'typed content',
      id: 'T01',
      type_ref: '测试类型',
    });

    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/metadata`);
    const file = res.body.files.find((f: any) => f.id === 'T01');
    expect(file).toBeDefined();
    expect(file.type).toBe('测试类型');
    expect(file.filename).toBe('typed_file.txt');
  });

  it('GET /files/scan should return file list excluding system files', async () => {
    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/scan`);
    expect(res.status).toBe(200);
    expect(res.body.files).toBeDefined();
    expect(res.body.files.length).toBeGreaterThan(0);

    // Should not include system files
    const filenames = res.body.files.map((f: any) => f.filename);
    expect(filenames).not.toContain('metadata.json');
    expect(filenames).toContain('evidence.txt');
  });

  it('PATCH should update file metadata', async () => {
    await request(server.baseUrl, 'PATCH', `/cases/${CASE_ID}/files/evidence.txt/metadata`, {
      type: '更新类型',
      metadata: { custom: true },
    });

    const res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/metadata`);
    const file = res.body.files.find((f: any) => f.filename === 'evidence.txt');
    expect(file).toBeDefined();
    expect(file.type).toBe('更新类型');
  });
});
