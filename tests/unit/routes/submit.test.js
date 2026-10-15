/**
 * Tests for Submit Route (Phase 0 Sender adapter).
 * Route must read `transaction` from the body, fail closed without it,
 * respect the fee-payer circuit breaker, co-sign, submit via Helius,
 * and append one JSONL proof line per accepted submission.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const {
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
} = require('@solana/web3.js');

const LEDGER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gasdf-ledger-')), 'submit.jsonl');
process.env.GASDF_LEDGER_PATH = LEDGER;

jest.mock('../../../src/utils/config', () => ({
  NETWORK: 'devnet',
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../../src/constants', () => ({
  EXPLORER_BASE: 'https://orbmarkets.io',
}));

const mockUser = Keypair.generate();
const mockPayer = Keypair.generate();

jest.mock('../../../src/services/fee-payer', () => ({
  getFeePayer: jest.fn(() => mockPayer),
  isCircuitOpen: jest.fn(() => false),
}));
jest.mock('../../../src/services/helius', () => ({
  sendAndConfirmTransaction: jest.fn(async () => ({
    signature: 'SIG_PHASE0_TEST',
    confirmation: { value: { err: null } },
  })),
}));

const feePayer = require('../../../src/services/fee-payer');
const helius = require('../../../src/services/helius');
const route = require('../../../src/routes/submit');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/v1/submit', route);
  return a;
}

function signedUserTxBase64() {
  const message = new TransactionMessage({
    payerKey: mockPayer.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      SystemProgram.transfer({
        fromPubkey: mockUser.publicKey,
        toPubkey: mockPayer.publicKey,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([mockUser]);
  return Buffer.from(tx.serialize()).toString('base64');
}

beforeEach(() => {
  jest.clearAllMocks();
  feePayer.isCircuitOpen.mockReturnValue(false);
});

test('missing transaction fails closed with 400, never touches Helius', async () => {
  const res = await request(app()).post('/v1/submit').send({});
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('INVALID_INPUT');
  expect(helius.sendAndConfirmTransaction).not.toHaveBeenCalled();
});

test('open circuit breaker rejects with 503 before co-sign', async () => {
  feePayer.isCircuitOpen.mockReturnValue(true);
  const res = await request(app()).post('/v1/submit').send({ transaction: signedUserTxBase64() });
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('CIRCUIT_OPEN');
  expect(helius.sendAndConfirmTransaction).not.toHaveBeenCalled();
});

test('valid submission co-signs, sends, and appends one JSONL proof line', async () => {
  const res = await request(app()).post('/v1/submit').send({ transaction: signedUserTxBase64() });
  expect(res.status).toBe(200);
  expect(res.body.signature).toBe('SIG_PHASE0_TEST');
  expect(res.body.explorer).toContain('SIG_PHASE0_TEST');
  expect(helius.sendAndConfirmTransaction).toHaveBeenCalledTimes(1);

  const lines = fs.readFileSync(LEDGER, 'utf8').trim().split('\n');
  const proof = JSON.parse(lines[lines.length - 1]);
  expect(proof.signature).toBe('SIG_PHASE0_TEST');
  expect(proof.network).toBe('devnet');
  expect(typeof proof.ts).toBe('string');
  expect(JSON.stringify(proof)).not.toMatch(/PRIVATE|SECRET/i);
});
