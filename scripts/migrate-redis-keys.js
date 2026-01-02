#!/usr/bin/env node
/**
 * Migrate old Redis keys to new prefixed format
 * Run: node scripts/migrate-redis-keys.js
 *
 * Or via admin endpoint: POST /admin/migrate-redis
 */

require('dotenv').config();

const { createClient } = require('redis');

const KEY_PREFIX = 'gasdf:';

// Keys that need to be migrated (old -> new)
const KEY_PATTERNS = [
  // Stats
  'stats:burn_total',
  'stats:tx_count',
  'stats:treasury_total',
  // Pending
  'pending:swap_amount',
  // Treasury
  'treasury:history',
  // Burn data
  'burn:leaderboard',
  'burn:proofs',
  'burn:proof:count',
  // Audit
  'audit:log',
];

// Pattern-based keys (need to scan)
const PATTERN_KEYS = [
  'quote:*',
  'txhash:*',
  'burn:wallet:*',
  'burn:proof:*',
  'ratelimit:wallet:*',
  'anomaly:*',
  'lock:*',
  'velocity:*',
  'jup:quote:*',
];

async function migrateRedisKeys(dryRun = true) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('REDIS_URL not set');
    return { success: false, error: 'REDIS_URL not set' };
  }

  console.log(`Connecting to Redis...`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will migrate keys)'}`);

  const client = createClient({ url: redisUrl });
  await client.connect();

  const stats = {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    keys: [],
  };

  try {
    // Migrate specific keys
    console.log('\n--- Migrating specific keys ---');
    for (const oldKey of KEY_PATTERNS) {
      const newKey = `${KEY_PREFIX}${oldKey}`;
      stats.scanned++;

      // Check if old key exists
      const exists = await client.exists(oldKey);
      if (!exists) {
        console.log(`  SKIP: ${oldKey} (not found)`);
        stats.skipped++;
        continue;
      }

      // Check if new key already exists
      const newExists = await client.exists(newKey);
      if (newExists) {
        console.log(`  SKIP: ${oldKey} -> ${newKey} (already exists)`);
        stats.skipped++;
        continue;
      }

      // Get the key type
      const type = await client.type(oldKey);
      console.log(`  MIGRATE: ${oldKey} -> ${newKey} (type: ${type})`);

      if (!dryRun) {
        // Copy based on type
        if (type === 'string') {
          const value = await client.get(oldKey);
          const ttl = await client.ttl(oldKey);
          if (ttl > 0) {
            await client.setEx(newKey, ttl, value);
          } else {
            await client.set(newKey, value);
          }
        } else if (type === 'list') {
          const values = await client.lRange(oldKey, 0, -1);
          if (values.length > 0) {
            await client.rPush(newKey, values);
          }
        } else if (type === 'zset') {
          const members = await client.zRangeWithScores(oldKey, 0, -1);
          if (members.length > 0) {
            const args = members.flatMap(m => ({ score: m.score, value: m.value }));
            await client.zAdd(newKey, args);
          }
        } else if (type === 'hash') {
          const hash = await client.hGetAll(oldKey);
          if (Object.keys(hash).length > 0) {
            await client.hSet(newKey, hash);
          }
        } else if (type === 'set') {
          const members = await client.sMembers(oldKey);
          if (members.length > 0) {
            await client.sAdd(newKey, members);
          }
        }
      }

      stats.migrated++;
      stats.keys.push({ old: oldKey, new: newKey, type });
    }

    // Scan for pattern-based keys
    console.log('\n--- Scanning pattern-based keys ---');
    for (const pattern of PATTERN_KEYS) {
      console.log(`  Scanning: ${pattern}`);

      let cursor = 0;
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;

        for (const oldKey of result.keys) {
          // Skip if already prefixed
          if (oldKey.startsWith(KEY_PREFIX)) {
            continue;
          }

          stats.scanned++;
          const newKey = `${KEY_PREFIX}${oldKey}`;

          // Check if new key already exists
          const newExists = await client.exists(newKey);
          if (newExists) {
            stats.skipped++;
            continue;
          }

          const type = await client.type(oldKey);
          console.log(`    MIGRATE: ${oldKey} -> ${newKey} (type: ${type})`);

          if (!dryRun) {
            // Copy based on type (same logic as above)
            if (type === 'string') {
              const value = await client.get(oldKey);
              const ttl = await client.ttl(oldKey);
              if (ttl > 0) {
                await client.setEx(newKey, ttl, value);
              } else {
                await client.set(newKey, value);
              }
            } else if (type === 'list') {
              const values = await client.lRange(oldKey, 0, -1);
              if (values.length > 0) {
                await client.rPush(newKey, values);
              }
            } else if (type === 'zset') {
              const members = await client.zRangeWithScores(oldKey, 0, -1);
              if (members.length > 0) {
                const args = members.flatMap(m => ({ score: m.score, value: m.value }));
                await client.zAdd(newKey, args);
              }
            } else if (type === 'hash') {
              const hash = await client.hGetAll(oldKey);
              if (Object.keys(hash).length > 0) {
                await client.hSet(newKey, hash);
              }
            } else if (type === 'set') {
              const members = await client.sMembers(oldKey);
              if (members.length > 0) {
                await client.sAdd(newKey, members);
              }
            }
          }

          stats.migrated++;
          stats.keys.push({ old: oldKey, new: newKey, type });
        }
      } while (cursor !== 0);
    }

    console.log('\n--- Migration Summary ---');
    console.log(`  Scanned: ${stats.scanned}`);
    console.log(`  Migrated: ${stats.migrated}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Errors: ${stats.errors}`);

    if (dryRun && stats.migrated > 0) {
      console.log('\nRun with --live to perform actual migration');
    }

    return { success: true, stats };
  } catch (error) {
    console.error('Migration error:', error);
    return { success: false, error: error.message, stats };
  } finally {
    await client.quit();
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--live');

  migrateRedisKeys(dryRun)
    .then(result => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { migrateRedisKeys };
