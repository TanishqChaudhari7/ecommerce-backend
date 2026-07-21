import request from 'supertest';
import { app } from '../../src/app';

describe('GET /health', () => {
  it('returns status, uptime, and timestamp', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      }),
    );
  });
});
