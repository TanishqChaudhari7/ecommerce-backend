import request from 'supertest';
import { app } from '../../src/app';
import { uniqueEmail } from '../helpers/auth';

describe('Auth API', () => {
  it('registers with valid data and returns 201', async () => {
    const email = uniqueEmail('register');
    const response = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'Sup3rSecret!',
      firstName: 'Test',
      lastName: 'User',
    });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(email);
    expect(response.body.user.password_hash).toBeUndefined();
  });

  it('returns 409 for a duplicate email', async () => {
    const email = uniqueEmail('dup');
    const payload = { email, password: 'Sup3rSecret!', firstName: 'A', lastName: 'B' };

    await request(app).post('/api/v1/auth/register').send(payload);
    const response = await request(app).post('/api/v1/auth/register').send(payload);

    expect(response.status).toBe(409);
  });

  it('returns 422 for an invalid body', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short' });

    expect(response.status).toBe(422);
  });

  it('logs in with correct credentials and returns a token pair', async () => {
    const email = uniqueEmail('login-ok');
    await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'Sup3rSecret!',
      firstName: 'A',
      lastName: 'B',
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Sup3rSecret!' });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('returns 401 for wrong password', async () => {
    const email = uniqueEmail('login-bad');
    await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'Sup3rSecret!',
      firstName: 'A',
      lastName: 'B',
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1!' });

    expect(response.status).toBe(401);
  });

  it('refreshes a valid refresh token for a new token pair', async () => {
    const email = uniqueEmail('refresh-ok');
    await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'Sup3rSecret!',
      firstName: 'A',
      lastName: 'B',
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Sup3rSecret!' });

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).not.toBe(login.body.refreshToken);
  });

  it('returns 401 for an invalid refresh token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'garbage-refresh-token' });

    expect(response.status).toBe(401);
  });

  it('logs out and invalidates the refresh token', async () => {
    const email = uniqueEmail('logout');
    await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'Sup3rSecret!',
      firstName: 'A',
      lastName: 'B',
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Sup3rSecret!' });

    const logoutResponse = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: login.body.refreshToken });
    expect(logoutResponse.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
