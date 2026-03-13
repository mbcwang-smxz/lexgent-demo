import { setupTestServer, request, initTestCase, TestServerHandle, CASE_ID } from './helpers';

let server: TestServerHandle;

beforeAll(async () => {
  server = await setupTestServer();
  await initTestCase(server.baseUrl);
});

afterAll(async () => {
  await server.cleanup();
});

describe('Events and Replies', () => {
  it('POST event should return timestamp', async () => {
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/events`, {
      id: 'evt-1',
      type: 'LOG',
      payload: { message: 'test event' },
    });
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.timestamp).toBe('number');
  });

  it('GET events should return events and support after filter', async () => {
    // Post first event
    const evt1 = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/events`, {
      id: 'evt-filter-1',
      type: 'LOG',
      payload: { seq: 1 },
    });
    const afterTs = evt1.body.timestamp;

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    // Post second event
    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/events`, {
      id: 'evt-filter-2',
      type: 'LOG',
      payload: { seq: 2 },
    });

    // GET all events
    let res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/events`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    // GET with after filter
    res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/events?after=${afterTs}`);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((e: any) => e.timestamp > afterTs)).toBe(true);
  });

  it('POST reply should return with timestamp and id', async () => {
    const res = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/reply`, {
      confirmed: true,
      input: 'test reply',
    });
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.id).toBeDefined();
  });

  it('GET replies should return replies and support after filter', async () => {
    const reply1 = await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/reply`, {
      input: 'reply filter 1',
    });
    const afterTs = reply1.body.timestamp;

    await new Promise((r) => setTimeout(r, 10));

    await request(server.baseUrl, 'POST', `/cases/${CASE_ID}/reply`, {
      input: 'reply filter 2',
    });

    // GET all
    let res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/reply`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    // GET with after filter
    res = await request(server.baseUrl, 'GET', `/cases/${CASE_ID}/reply?after=${afterTs}`);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((r: any) => r.timestamp > afterTs)).toBe(true);
  });
});
