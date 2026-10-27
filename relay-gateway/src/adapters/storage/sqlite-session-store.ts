/**
 * SQLite implementation of SessionStore using Node 22 native `node:sqlite`.
 * Zero-ops, zero external daemon, ACID durability.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SessionStore, SubscriptionSession } from '../../domain/subscription/types.js';

export class SqliteSessionStore implements SessionStore {
  private db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_sessions (
        session_id TEXT PRIMARY KEY,
        user_wallet TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON subscription_sessions(expires_at);
    `);
  }

  async get(sessionId: string): Promise<SubscriptionSession | null> {
    const query = this.db.prepare(
      'SELECT data_json, expires_at FROM subscription_sessions WHERE session_id = ?',
    );
    const row = query.get(sessionId) as { data_json: string; expires_at: number } | undefined;

    if (!row) {
      return null;
    }

    if (Date.now() >= row.expires_at) {
      await this.delete(sessionId);
      return null;
    }

    try {
      return JSON.parse(row.data_json) as SubscriptionSession;
    } catch {
      return null;
    }
  }

  async set(session: SubscriptionSession, ttlSeconds: number = 300): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const stmt = this.db.prepare(`
      INSERT INTO subscription_sessions (session_id, user_wallet, plan_id, status, data_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        status = excluded.status,
        data_json = excluded.data_json,
        expires_at = excluded.expires_at
    `);

    stmt.run(
      session.sessionId,
      session.buyerPubkey,
      session.planId,
      session.status,
      JSON.stringify(session),
      session.createdAt,
      expiresAt,
    );
  }

  async update(sessionId: string, patch: Partial<SubscriptionSession>): Promise<void> {
    const existing = await this.get(sessionId);
    if (!existing) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const merged = { ...existing, ...patch, sessionId };
    await this.set(merged);
  }

  async delete(sessionId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM subscription_sessions WHERE session_id = ?');
    stmt.run(sessionId);
  }

  async pruneExpired(nowMs: number = Date.now()): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM subscription_sessions WHERE expires_at <= ?');
    const result = stmt.run(nowMs);
    return Number(result.changes);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
