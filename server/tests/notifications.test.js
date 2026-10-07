import test from 'node:test';
import assert from 'node:assert/strict';

import { createComplaintStatusHandler } from '../src/services/complaint-status.js';
import {
  createTokenRegistrationHandler,
  fcmTokenDocumentId,
  sendComplaintStatusNotification
} from '../src/services/notifications.js';

function makeResponse() {
  return {
    statusCode:200,
    body:null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function validToken(fill = 'a') {
  return `${fill.repeat(150)}:suffix_token-123`;
}

function createFakeDb({ownerUid = 'citizen-1', tokens = []} = {}) {
  const state = {status:'PENDING', ownerUid, tokenDocuments:tokens, deletedTokenIds:[]};
  const db = {
    collection(name) {
      if (name === 'complaints') {
        return {doc:() => ({
          get:async () => ({exists:true, data:() => ({citizenId:state.ownerUid, status:state.status})}),
          update:async (updates) => { state.status = updates.status; }
        })};
      }
      if (name === 'fcmTokens') {
        return {
          doc(id) {
            return {set:async (value) => {
              const existing = state.tokenDocuments.find((entry) => entry.id === id);
              if (existing) existing.value = value;
              else state.tokenDocuments.push({id, value, ref:{delete:async () => { state.deletedTokenIds.push(id); }}});
            }};
          },
          where(field, operator, value) {
            assert.equal(field, 'uid');
            assert.equal(operator, '==');
            return {get:async () => ({docs:state.tokenDocuments
              .filter((entry) => entry.value.uid === value)
              .map((entry) => ({
                data:() => entry.value,
                ref:entry.ref || {delete:async () => { state.deletedTokenIds.push(entry.id); }}
              }))})};
          }
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }
  };
  return {db, state};
}

test('unauthenticated token registration is rejected', async () => {
  const handler = createTokenRegistrationHandler({db:{}});
  const response = makeResponse();
  await handler({body:{token:validToken()}}, response);
  assert.equal(response.statusCode, 401);
});

test('authenticated citizen registers token under verified UID, ignoring supplied user ID', async () => {
  const {db, state} = createFakeDb();
  const token = validToken();
  const response = makeResponse();
  await createTokenRegistrationHandler({db})({user:{uid:'citizen-1'}, body:{token, userId:'victim'}}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(state.tokenDocuments.length, 1);
  assert.equal(state.tokenDocuments[0].value.uid, 'citizen-1');
  assert.equal(state.tokenDocuments[0].value.token, token);
  assert.equal(state.tokenDocuments[0].value.platform, 'android');
  assert.match(state.tokenDocuments[0].id, /^[a-f0-9]{64}$/);
});

test('invalid FCM token input is rejected', async () => {
  const response = makeResponse();
  await createTokenRegistrationHandler({db:{}})({user:{uid:'citizen-1'}, body:{token:'not-a-valid-token'}}, response);
  assert.equal(response.statusCode, 400);
});

test('admin status update selects tokens from persisted complaint owner and ignores recipient input', async () => {
  const token = validToken();
  const {db, state} = createFakeDb({tokens:[
    {id:'owner-token', value:{uid:'citizen-1', token}},
    {id:'attacker-token', value:{uid:'victim', token:validToken('b')}}
  ]});
  const sentMessages = [];
  const messaging = {sendEachForMulticast:async (message) => {
    sentMessages.push(message);
    return {successCount:1, responses:[{success:true}]};
  }};
  const response = makeResponse();
  const handler = createComplaintStatusHandler({
    db,
    notifyStatus:({complaintId, status}) => sendComplaintStatusNotification({db, messaging, complaintId, status, logger:{warn(){}}})
  });

  await handler({
    user:{uid:'admin-1', admin:true},
    params:{id:'CP-12345678'},
    body:{status:'RESOLVED', recipientUid:'victim', token:validToken('c'), message:'arbitrary'}
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(state.status, 'RESOLVED');
  assert.deepEqual(sentMessages[0].tokens, [token]);
  assert.deepEqual(sentMessages[0].data, {complaintId:'CP-12345678', status:'RESOLVED'});
});

test('citizen cannot invoke admin status notification flow', async () => {
  const {db, state} = createFakeDb();
  let notificationCalled = false;
  const response = makeResponse();
  await createComplaintStatusHandler({db, notifyStatus:async () => { notificationCalled = true; }})({
    user:{uid:'citizen-1', admin:false}, params:{id:'CP-12345678'}, body:{status:'RESOLVED'}
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(notificationCalled, false);
  assert.equal(state.status, 'PENDING');
});

test('notification send failure does not roll back status update', async () => {
  const token = validToken();
  const {db, state} = createFakeDb({tokens:[{id:'owner-token', value:{uid:'citizen-1', token}}]});
  const response = makeResponse();
  const handler = createComplaintStatusHandler({
    db,
    notifyStatus:({complaintId, status}) => sendComplaintStatusNotification({
      db,
      complaintId,
      status,
      messaging:{sendEachForMulticast:async () => { throw Object.assign(new Error('private provider detail'), {code:'messaging/unavailable'}); }},
      logger:{warn(){}}
    })
  });
  await handler({user:{uid:'admin-1', admin:true}, params:{id:'CP-12345678'}, body:{status:'IN_PROGRESS'}}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(state.status, 'IN_PROGRESS');
});

test('status update succeeds when citizen has no registered tokens', async () => {
  const {db, state} = createFakeDb();
  const response = makeResponse();
  const handler = createComplaintStatusHandler({
    db,
    notifyStatus:({complaintId, status}) => sendComplaintStatusNotification({db, messaging:{}, complaintId, status, logger:{warn(){}}})
  });
  await handler({user:{uid:'admin-1', admin:true}, params:{id:'CP-12345678'}, body:{status:'REJECTED'}}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(state.status, 'REJECTED');
});

test('unregistered FCM tokens are deleted after provider rejection', async () => {
  const token = validToken();
  const {db, state} = createFakeDb({tokens:[{id:'stale-token', value:{uid:'citizen-1', token}}]});
  await sendComplaintStatusNotification({
    db,
    complaintId:'CP-12345678',
    status:'RESOLVED',
    messaging:{sendEachForMulticast:async () => ({
      successCount:0,
      responses:[{success:false, error:{code:'messaging/registration-token-not-registered'}}]
    })},
    logger:{warn(){}}
  });
  assert.deepEqual(state.deletedTokenIds, ['stale-token']);
});

test('token document IDs are deterministic hashes, not raw tokens', () => {
  const token = validToken();
  assert.equal(fcmTokenDocumentId(token), fcmTokenDocumentId(token));
  assert.notEqual(fcmTokenDocumentId(token), token);
});