import { setupTestServer, request, initTestCase, TestServerHandle, CASE_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
  await initTestCase(server.baseUrl);
});

afterAll(async () => {
  await server.cleanup();
});

describe('POST /cases/:caseId/files/ops', () => {
  it('create should write file and register as 用户文档', async () => {
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
      filename: 'ops_created.txt',
      content: '通过ops创建的文件',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.action).toBe('create');

    // Verify content
    const fileRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/ops_created.txt`);
    expect(fileRes.raw).toBe('通过ops创建的文件');

    // Verify registered as 用户文档
    const metaRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/metadata`);
    const file = metaRes.body.files.find((f: any) => f.filename === 'ops_created.txt');
    expect(file).toBeDefined();
    expect(file.type).toBe('用户文档');
  });

  it('copy should duplicate file content and support content override', async () => {
    // Plain copy
    let res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'copy',
      filename: 'evidence_copy.txt',
      source: 'evidence.txt',
    });
    expect(res.status).toBe(200);
    let fileRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/evidence_copy.txt`);
    expect(fileRes.raw).toBe('测试证据内容');

    // Copy with content override
    res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'copy',
      filename: 'evidence_modified.txt',
      source: 'evidence.txt',
      content: '修改后的内容',
    });
    expect(res.status).toBe(200);
    fileRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/evidence_modified.txt`);
    expect(fileRes.raw).toBe('修改后的内容');
  });

  it('copy non-existent source should return 404', async () => {
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'copy',
      filename: 'target.txt',
      source: 'nonexistent_source.txt',
    });
    expect(res.status).toBe(404);
  });

  it('modify should overwrite file content', async () => {
    // Create first
    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
      filename: 'to_modify.txt',
      content: '原始内容',
    });

    // Modify
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'modify',
      filename: 'to_modify.txt',
      content: '修改后内容',
    });
    expect(res.status).toBe(200);

    const fileRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/to_modify.txt`);
    expect(fileRes.raw).toBe('修改后内容');
  });

  it('remove should delete file', async () => {
    // Create a file to remove
    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
      filename: 'to_remove.txt',
      content: 'will be removed',
    });

    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'remove',
      filename: 'to_remove.txt',
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('remove');

    const fileRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/to_remove.txt`);
    expect(fileRes.status).toBe(404);
  });

  it('should reject writing to metadata.json', async () => {
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
      filename: 'metadata.json',
      content: '{}',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('protected');
  });

  it('should reject invalid action and missing filename', async () => {
    // Invalid action
    let res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'invalid_action',
      filename: 'test.txt',
    });
    expect(res.status).toBe(400);

    // Missing filename for create
    res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
    });
    expect(res.status).toBe(400);
  });
});
