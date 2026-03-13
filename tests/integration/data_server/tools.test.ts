import { setupTestServer, request, TestServerHandle } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
});

afterAll(async () => {
  await server.cleanup();
});

describe('Tool APIs', () => {
  it('echo tool should return message', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/tools/echo', {
      message: 'hello world',
    });
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe('hello world');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.server).toBe('data_server');
  });

  it('law_lookup should find exact article', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/tools/law_lookup', {
      law_name: '中华人民共和国民法典',
      article_number: '第一百八十八条',
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.results[0].content).toContain('诉讼时效');
  });

  it('law_lookup should find by keyword', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/tools/law_lookup', {
      law_name: '中华人民共和国民法典',
      keywords: '违约',
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.results.every((r: any) => r.content.includes('违约'))).toBe(true);
  });
});
