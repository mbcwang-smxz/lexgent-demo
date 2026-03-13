import { setupTestServer, request, initTestCase, TestServerHandle, CASE_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('File deletion', () => {
  beforeEach(async () => {
    await initTestCase(server.baseUrl);
  });

  it('DELETE should delete exact match file', async () => {
    const res = await request(
      server.baseUrl,
      'DELETE',
      `/cases/${CASE_ID}/files?pattern=evidence.txt`,
    );
    expect(res.status).toBe(200);
    expect(res.body.deleted).toContain('evidence.txt');

    const fileRes = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/evidence.txt`);
    expect(fileRes.status).toBe(404);
  });

  it('DELETE should support wildcard pattern', async () => {
    // Create an extra D-prefixed file
    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
      filename: 'D02_extra.txt',
      content: 'extra',
    });

    const res = await request(server.baseUrl, 'DELETE', `/cases/${CASE_ID}/files?pattern=D*`);
    expect(res.status).toBe(200);
    expect(res.body.deleted.length).toBeGreaterThanOrEqual(1);
    expect(res.body.deleted).toContain('D01_测试分析.txt');
  });

  it('DELETE should protect R-prefixed files and metadata.json', async () => {
    // Try to delete R-prefixed file
    let res = await request(server.baseUrl, 'DELETE', `/cases/${CASE_ID}/files?pattern=R*`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(0);

    // R01 file should still exist
    const fileRes = await request(
      server.baseUrl,
      'GET',
      `/cases/${CASE_ID}/files/${encodeURIComponent('R01_起诉状.txt')}`,
    );
    expect(fileRes.status).toBe(200);

    // Try to delete metadata.json
    res = await request(
      server.baseUrl,
      'DELETE',
      `/cases/${CASE_ID}/files?pattern=metadata.json`,
    );
    expect(res.body.deleted).not.toContain('metadata.json');
  });

  it('POST batch-delete should delete multiple patterns', async () => {
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/batch-delete`, {
      patterns: ['evidence.txt', 'D*'],
    });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toContain('evidence.txt');
    expect(res.body.deleted).toContain('D01_测试分析.txt');
  });

  it('DELETE without pattern should return 400', async () => {
    const res = await request(server.baseUrl, 'DELETE', `/cases/${CASE_ID}/files`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('pattern');
  });
});
