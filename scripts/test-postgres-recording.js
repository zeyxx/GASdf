#!/usr/bin/env node
/**
 * Test PostgreSQL recording for transactions and burns
 * Run: node scripts/test-postgres-recording.js
 */

require('dotenv').config();

const db = require('../src/utils/db');
const { v4: uuidv4 } = require('uuid');

async function testRecording() {
  console.log('Testing PostgreSQL recording...\n');

  // Wait for DB to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check connection
  const status = db.getCircuitStatus();
  console.log('Circuit Status:', status);

  if (!status.isConnected) {
    console.error('PostgreSQL not connected!');
    process.exit(1);
  }

  // Test 1: Record a test transaction
  console.log('\n--- Test 1: Record Transaction ---');
  const testQuoteId = `test-${uuidv4().slice(0, 8)}`;
  const testTx = {
    quoteId: testQuoteId,
    signature: `TestSig${Date.now()}`,
    userWallet: 'TestWallet1111111111111111111111111111111111',
    paymentToken: 'USDC',
    feeAmount: 1000000, // 1 USDC
    feeSolEquivalent: 5000000, // 0.005 SOL
    status: 'submitted',
    ipAddress: '127.0.0.1',
  };

  const txResult = await db.recordTransaction(testTx);
  console.log('Transaction recorded:', txResult ? 'SUCCESS' : 'FAILED (or duplicate)');
  if (txResult) {
    console.log('  Quote ID:', txResult.quote_id);
    console.log('  Status:', txResult.status);
  }

  // Test 2: Update transaction status
  console.log('\n--- Test 2: Update Transaction Status ---');
  testTx.status = 'confirmed';
  const updateResult = await db.recordTransaction(testTx);
  console.log('Transaction updated:', updateResult ? 'SUCCESS' : 'FAILED');
  if (updateResult) {
    console.log('  New Status:', updateResult.status);
    console.log('  Completed At:', updateResult.completed_at);
  }

  // Test 3: Record a test burn
  console.log('\n--- Test 3: Record Burn ---');
  const testBurn = {
    signature: `TestBurnSig${Date.now()}`,
    amountBurned: 1000000, // 1 ASDF
    method: 'test',
    treasuryAmount: 200000, // 0.2 ASDF retained
  };

  const burnResult = await db.recordBurn(testBurn);
  console.log('Burn recorded:', burnResult ? 'SUCCESS' : 'FAILED (or duplicate)');
  if (burnResult) {
    console.log('  Signature:', burnResult.signature.slice(0, 20) + '...');
    console.log('  Amount:', burnResult.amount_burned);
  }

  // Test 4: Query transactions
  console.log('\n--- Test 4: Query Transactions ---');
  const transactions = await db.getTransactions({ limit: 5 });
  console.log('Total transactions in DB:', transactions?.total || 0);
  if (transactions?.transactions?.length > 0) {
    console.log('Latest:', transactions.transactions[0].quote_id);
  }

  // Test 5: Query burns
  console.log('\n--- Test 5: Query Burns ---');
  const burns = await db.getBurnHistory(5);
  console.log('Total burns in DB:', burns?.total || 0);
  if (burns?.burns?.length > 0) {
    console.log('Latest:', burns.burns[0].signature?.slice(0, 20) + '...');
  }

  console.log('\n✅ PostgreSQL recording test complete!');
  process.exit(0);
}

testRecording().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
