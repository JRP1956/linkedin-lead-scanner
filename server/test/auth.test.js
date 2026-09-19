const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { initDatabase } = require('../db/queries');
const { authenticate } = require('../auth/authMiddleware');

process.env.JWT_SECRET = 'test-secret';
initDatabase(':memory:');

// Same wiring as index.js
const app = express();
app.use(express.json());
app.use('/api/auth', require('../auth/authRoutes'));
app.use('/api', authenticate);
app.get('/api/leads', (req, res) => res.json({ ok: true }));

let base;
const server = app.listen(0);
test.before(() => { base = `http://localhost:${server.address().port}/api`; });
test.after(() => server.close());

const post = (path, body, token) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
});

test('auth flow: protected routes, first-user signup, admin-only signups, login', async () => {
  assert.equal((await fetch(`${base}/leads`)).status, 401);

  const first = await post('/auth/signup', { email: 'admin@x.io', password: 'secret1' });
  assert.equal(first.status, 200);
  const { token, user } = await first.json();
  assert.equal(user.role, 'admin');

  assert.equal((await post('/auth/signup', { email: 'rando@x.io', password: 'secret1' })).status, 401);

  const member = await post('/auth/signup', { email: 'm@x.io', password: 'secret1' }, token);
  assert.equal((await member.json()).user.role, 'member');
  const memberToken = (await (await post('/auth/login', { email: 'm@x.io', password: 'secret1' })).json()).token;
  assert.equal((await post('/auth/signup', { email: 'y@x.io', password: 'secret1' }, memberToken)).status, 403);

  assert.equal((await post('/auth/login', { email: 'admin@x.io', password: 'wrong' })).status, 401);
  const login = await post('/auth/login', { email: 'admin@x.io', password: 'secret1' });
  const res = await fetch(`${base}/leads`, { headers: { Authorization: `Bearer ${(await login.json()).token}` } });
  assert.equal(res.status, 200);

  assert.equal((await fetch(`${base}/leads`, { headers: { Authorization: 'Bearer forged' } })).status, 401);
});
