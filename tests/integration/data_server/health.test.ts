import { setupTestServer, request, TestServerHandle } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('GET /health', () => {
  it('should return 200 OK', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.raw).toBe('OK');
  });
});
