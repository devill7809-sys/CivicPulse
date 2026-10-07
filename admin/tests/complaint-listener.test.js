import test from 'node:test';
import assert from 'node:assert/strict';

import {subscribeToAdminComplaints} from '../src/complaint-listener.js';

function createFirestoreApi() {
  const state = {subscriptions:0, unsubscriptions:0, next:null, error:null};
  return {
    state,
    collection:(_db, name) => ({name}),
    orderBy:(field, direction) => ({field, direction}),
    limit:(count) => ({count}),
    query:(...parts) => ({parts}),
    onSnapshot:(_query, next, error) => {
      state.subscriptions += 1;
      state.next = next;
      state.error = error;
      return () => { state.unsubscriptions += 1; };
    }
  };
}

function complaintSnapshot(ids) {
  return {docs:ids.map((id) => ({id, data:() => ({description:`Complaint ${id}`, status:'PENDING'})}))};
}

test('admin listener loads initial and subsequent snapshots without duplicate complaints', async () => {
  const firestoreApi = createFirestoreApi();
  const updates = [];
  const unsubscribe = await subscribeToAdminComplaints({
    user:{getIdTokenResult:async (forceRefresh) => {
      assert.equal(forceRefresh, true);
      return {claims:{admin:true}};
    }},
    db:{},
    firestoreApi,
    onComplaints:(complaints) => updates.push(complaints),
    onError:assert.fail
  });

  assert.equal(firestoreApi.state.subscriptions, 1);
  firestoreApi.state.next(complaintSnapshot(['CP-1', 'CP-1', 'CP-2']));
  firestoreApi.state.next(complaintSnapshot(['CP-1', 'CP-2', 'CP-3']));
  assert.deepEqual(updates[0].map((complaint) => complaint.id), ['CP-1', 'CP-2']);
  assert.deepEqual(updates[1].map((complaint) => complaint.id), ['CP-1', 'CP-2', 'CP-3']);
  assert.equal(updates[1][2].description, 'Complaint CP-3');

  unsubscribe();
  unsubscribe();
  assert.equal(firestoreApi.state.unsubscriptions, 1);
});

test('non-admin user is rejected before any Firestore subscription', async () => {
  const firestoreApi = createFirestoreApi();
  const errors = [];
  const unsubscribe = await subscribeToAdminComplaints({
    user:{getIdTokenResult:async () => ({claims:{admin:false}})},
    db:{},
    firestoreApi,
    onComplaints:assert.fail,
    onError:(error) => errors.push(error)
  });

  assert.deepEqual(errors, [{code:'permission-denied'}]);
  assert.equal(firestoreApi.state.subscriptions, 0);
  unsubscribe();
  assert.equal(firestoreApi.state.unsubscriptions, 0);
});

test('unmounted component does not create a late Firestore subscription', async () => {
  const firestoreApi = createFirestoreApi();
  const unsubscribe = await subscribeToAdminComplaints({
    user:{getIdTokenResult:async () => ({claims:{admin:true}})},
    db:{},
    firestoreApi,
    onComplaints:assert.fail,
    onError:assert.fail,
    isActive:() => false
  });

  assert.equal(firestoreApi.state.subscriptions, 0);
  unsubscribe();
});
