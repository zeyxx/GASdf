import test from 'node:test';
import assert from 'node:assert/strict';

import {
  address,
  type Blockhash,
  generateKeyPairSigner,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  pipe,
} from '@solana/kit';
import { getBurnCheckedInstruction } from '@solana-program/token';

import { verifyAtomicSubscriptionTxIntegrity } from './atomic-tx-builder.js';

const ASDF_MINT = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';
const BURN_AMOUNT = 30_000_000_000n;

async function buildValidTx(overrides?: {
  feePayer?: string;
  burnAmount?: bigint;
  mint?: string;
  authority?: string;
}) {
  const feePayerSigner = await generateKeyPairSigner();
  const buyerSigner = await generateKeyPairSigner();

  const feePayer = overrides?.feePayer ?? feePayerSigner.address;
  const buyer = buyerSigner.address;
  const burnAmount = overrides?.burnAmount ?? BURN_AMOUNT;
  const mint = overrides?.mint ?? ASDF_MINT;
  const authority = overrides?.authority ?? buyer;

  const tokenAccount = address('11111111111111111111111111111111');

  const ix = getBurnCheckedInstruction({
    account: tokenAccount,
    mint: address(mint),
    authority: address(authority),
    amount: burnAmount,
    decimals: 6,
  });

  const blockhash = {
    blockhash: '11111111111111111111111111111111' as Blockhash,
    lastValidBlockHeight: 1000n,
  };

  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayerSigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(ix, m),
  );

  const compiled = compileTransaction(msg);
  const base64 = getBase64EncodedWireTransaction(compiled);

  return {
    base64,
    feePayer,
    buyer,
    burnAmount,
    feePayerSigner,
    buyerSigner,
  };
}

test('atomic tx integrity: valid transaction passes verification', async () => {
  const { base64, feePayer, buyer, burnAmount } = await buildValidTx();
  const result = verifyAtomicSubscriptionTxIntegrity({
    base64WireTx: base64,
    expectedBuyerPubkey: buyer,
    expectedFeePayer: feePayer,
    expectedBurnAmountBaseUnits: burnAmount,
  });
  assert.equal(result.valid, true);
  assert.equal(result.burnFound, true);
  assert.equal(result.burnAmount, burnAmount);
});

test('atomic tx integrity: tampered fee payer is rejected', async () => {
  const { base64, buyer, burnAmount } = await buildValidTx();
  const result = verifyAtomicSubscriptionTxIntegrity({
    base64WireTx: base64,
    expectedBuyerPubkey: buyer,
    expectedFeePayer: 'Bcuw4Xb9wmjDUpTsADn8ZM9Rigdhehaf5jfbJndH4rcC',
    expectedBurnAmountBaseUnits: burnAmount,
  });
  assert.equal(result.valid, false);
  assert.match(result.reason ?? '', /Fee payer mismatch/i);
});

test('atomic tx integrity: transaction without burn is rejected', async () => {
  const feePayerSigner = await generateKeyPairSigner();
  const buyerSigner = await generateKeyPairSigner();
  const blockhash = {
    blockhash: '11111111111111111111111111111111' as Blockhash,
    lastValidBlockHeight: 1000n,
  };
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayerSigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  );
  const base64 = getBase64EncodedWireTransaction(compileTransaction(msg));

  const result = verifyAtomicSubscriptionTxIntegrity({
    base64WireTx: base64,
    expectedBuyerPubkey: buyerSigner.address,
    expectedFeePayer: feePayerSigner.address,
    expectedBurnAmountBaseUnits: BURN_AMOUNT,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid, false);
});

test('atomic tx integrity: insufficient burn amount is rejected', async () => {
  const { base64, feePayer, buyer } = await buildValidTx({ burnAmount: 1000n });
  const result = verifyAtomicSubscriptionTxIntegrity({
    base64WireTx: base64,
    expectedBuyerPubkey: buyer,
    expectedFeePayer: feePayer,
    expectedBurnAmountBaseUnits: BURN_AMOUNT,
  });
  assert.equal(result.valid, false);
  assert.match(result.reason ?? '', /Burn amount mismatch/i);
});

test('atomic tx integrity: wrong mint burn is rejected', async () => {
  const { base64, feePayer, buyer, burnAmount } = await buildValidTx({
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC instead of ASDF
  });
  const result = verifyAtomicSubscriptionTxIntegrity({
    base64WireTx: base64,
    expectedBuyerPubkey: buyer,
    expectedFeePayer: feePayer,
    expectedBurnAmountBaseUnits: burnAmount,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid, false);
});
