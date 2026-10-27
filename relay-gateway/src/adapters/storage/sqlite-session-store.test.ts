import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteSessionStore } from './sqlite-session-store.js';
import { SessionStatus, type SubscriptionSession } from '../../domain/subscription/types.js';

test('sqlite store: sets, gets, updates, and deletes sessions in memory', async () => {
  const store = new SqliteSessionStore(':memory:');

  const session: SubscriptionSession = {
    schema: 'https://gasdf.org/schemas/session-v1.json',
    sessionId: 'sess_123',
    appId: 'trenchscanner',
    planId: 'pro-monthly',
    buyerPubkey: '4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt',
    inputTokenMint: null,
    status: SessionStatus.Open,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
    settledAt: null,
  };

  await store.set(session, 60);

  const fetched = await store.get('sess_123');
  assert.ok(fetched);
  assert.equal(fetched.sessionId, 'sess_123');
  assert.equal(fetched.status, SessionStatus.Open);

  // Update session
  await store.update('sess_123', { status: SessionStatus.Quoted });
  const updated = await store.get('sess_123');
  assert.ok(updated);
  assert.equal(updated.status, SessionStatus.Quoted);

  // Delete session
  await store.delete('sess_123');
  const deleted = await store.get('sess_123');
  assert.equal(deleted, null);

  await store.close();
});

test('sqlite store: respects TTL and prunes expired sessions', async () => {
  const store = new SqliteSessionStore(':memory:');

  const session: SubscriptionSession = {
    schema: 'https://gasdf.org/schemas/session-v1.json',
    sessionId: 'sess_expiring',
    appId: 'trenchscanner',
    planId: 'pro-monthly',
    buyerPubkey: '4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt',
    inputTokenMint: null,
    status: SessionStatus.Open,
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000,
    settledAt: null,
  };

  // Set with 1s TTL
  await store.set(session, 1);

  // Still active
  assert.ok(await store.get('sess_expiring'));

  // Wait 1.1s
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // Should return null (lazy expiration on get)
  assert.equal(await store.get('sess_expiring'), null);

  // Re-add and test pruneExpired batch
  await store.set({ ...session, sessionId: 'sess_batch' }, 1);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const pruned = await store.pruneExpired();
  assert.equal(pruned >= 1, true);

  await store.close();
});
