import test from 'node:test';
import assert from 'node:assert/strict';

import { requireAuth, requireAdmin, getBearerToken } from '../src/middleware/auth.js';

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('TEST A: valid citizen token passes auth', async () => {
  const req = { headers: { authorization: 'Bearer valid-token' } };
  const res = makeResponse();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireAuth(req, res, next, {
    verifyIdToken: async () => ({ uid: 'citizen-1', admin: false })
  });

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(req.user.uid, 'citizen-1');
});

test('TEST B: citizen token is forbidden on admin endpoint', async () => {
  const req = { user: { uid: 'citizen-1', admin: false } };
  const res = makeResponse();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireAdmin(req, res, next, req.user);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(nextCalled, false);
});

test('TEST C: authenticated admin with custom claim is allowed', async () => {
  const req = { user: { uid: 'admin-1', admin: true } };
  const res = makeResponse();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireAdmin(req, res, next, req.user);

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
});

test('TEST D: missing Firebase token returns 401', async () => {
  const req = { headers: {} };
  const res = makeResponse();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireAuth(req, res, next, {
    verifyIdToken: async () => ({ uid: 'citizen-1' })
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Missing Firebase ID token');
  assert.equal(nextCalled, false);
});

test('TEST E: invalid Firebase token returns 401', async () => {
  const req = { headers: { authorization: 'Bearer invalid-token' } };
  const res = makeResponse();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireAuth(req, res, next, {
    verifyIdToken: async () => {
      throw new Error('bad token');
    }
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid or expired authentication token');
  assert.equal(nextCalled, false);
});

test('TEST F: frontend local boolean is ignored for admin checks', async () => {
  const req = { user: { uid: 'citizen-1', admin: false, isAdmin: true } };
  const res = makeResponse();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireAdmin(req, res, next, req.user);

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('Bearer token extraction ignores malformed headers', () => {
  assert.equal(getBearerToken(''), null);
  assert.equal(getBearerToken('Token abc'), null);
  assert.equal(getBearerToken('Bearer abc123'), 'abc123');
});
