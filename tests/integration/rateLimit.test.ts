import request from 'supertest';
import { app } from '../../src/app';

const LOGIN_LIMIT = 5;

describe('Rate limiting', () => {
  it('admits exactly the limit when a burst of logins arrives at once', async () => {
    const responses = await Promise.all(
      Array.from({ length: LOGIN_LIMIT * 3 }, () =>
        request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'nobody@test.com', password: 'wrong-password' }),
      ),
    );

    const limited = responses.filter((response) => response.status === 429);
    expect(responses.length - limited.length).toBe(LOGIN_LIMIT);
    expect(limited[0].headers['retry-after']).toBeDefined();
  });
});
