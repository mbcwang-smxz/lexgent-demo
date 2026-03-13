import { setupTestServer, request, initTestCase, TestServerHandle, CASE_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('POST /cases/init', () => {
  it('should initialize a known case template', async () => {
    const res = await initTestCase(server.baseUrl);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('initialized');
    expect(res.body.caseId).toBe(CASE_ID);
    expect(res.body.dataRoot).toBeDefined();
  });

  it('should return warning for non-existent caseNumber', async () => {
    const res = await request(server.baseUrl, 'POST', '/cases/init', {
      caseNumber: 'nonexistent-case-xyz',
      reset: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.warning).toBeDefined();
    expect(res.body.warning).toContain('不存在');
  });

  it('should clear created files on reset=true', async () => {
    // Init first
    await initTestCase(server.baseUrl);

    // Create a new file
    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/files/ops`, {
      action: 'create',
      filename: 'temp_reset_test.txt',
      content: 'temporary content',
    });

    // Verify file exists
    let res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/temp_reset_test.txt`);
    expect(res.status).toBe(200);

    // Re-init with reset
    await initTestCase(server.baseUrl);

    // File should be gone
    res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/files/temp_reset_test.txt`);
    expect(res.status).toBe(404);
  });

  it('should respond to CORS OPTIONS with 204', async () => {
    const res = await request(server.baseUrl, 'OPTIONS', '/cases/init');
    expect(res.status).toBe(204);
  });
});
