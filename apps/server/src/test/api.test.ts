import request from 'supertest';
import { app } from '../app';
import { registerServices } from '@services/di/register';
import { pool } from '@db/db';

registerServices();

describe('User API', () => {
  it('should return 404 for non-existent user', async () => {
    const response = await request(app).get('/api/user/non-existent-id');
    expect(response.status).toBe(404);
  });
});

afterAll(async () => {
  await pool.end();
}); 