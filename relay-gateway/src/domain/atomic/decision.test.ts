import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAtomicPlan,
  evaluateAccountLifespanPolicy,
  type AtomicTxSpec,
} from './decision.js';

test('atomic domain: validates valid plan spec', () => {
  const spec: AtomicTxSpec = {
    userWallet: '4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt',
    userAta: '789...ata',
    asdfMint: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inputAmountBaseUnits: 4_540_000n,
    burnAsdfBaseUnits: 30_000_000_000n,
    feePayer: 'Bcuw4Xb9wmjDUpTsADn8ZM9Rigdhehaf5jfbJndH4rcC',
    recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
  };

  const plan = validateAtomicPlan(spec);
  assert.equal(plan.valid, true);
  assert.equal(plan.burnAmountBaseUnits, '30000000000');
  assert.equal(plan.feePayer, spec.feePayer);
});

test('atomic domain: rejects plan with zero burn amount', () => {
  const spec: AtomicTxSpec = {
    userWallet: '4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt',
    userAta: '789...ata',
    asdfMint: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inputAmountBaseUnits: 4_540_000n,
    burnAsdfBaseUnits: 0n,
    feePayer: 'Bcuw4Xb9wmjDUpTsADn8ZM9Rigdhehaf5jfbJndH4rcC',
    recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
  };

  const plan = validateAtomicPlan(spec);
  assert.equal(plan.valid, false);
  assert.match(plan.reason!, /strictly positive/i);
});

test('atomic domain: account lifespan policy enforces ASDF ATA preservation', () => {
  // Existing ASDF ATA, paying with USDC -> no rent charge, preserve ATA
  const policy1 = evaluateAccountLifespanPolicy({
    isInputNativeSol: false,
    userAsdfAtaExists: true,
  });
  assert.equal(policy1.preserveAsdfAta, true);
  assert.equal(policy1.allowEphemeralWsolCleanup, false);
  assert.equal(policy1.chargeAtaCreationRent, false);
  assert.equal(policy1.requiredRentLamports, 0n);

  // Missing ASDF ATA, paying with SOL -> charges 1,488,440 lamports rent, allows WSOL cleanup
  const policy2 = evaluateAccountLifespanPolicy({
    isInputNativeSol: true,
    userAsdfAtaExists: false,
  });
  assert.equal(policy2.preserveAsdfAta, true);
  assert.equal(policy2.allowEphemeralWsolCleanup, true);
  assert.equal(policy2.chargeAtaCreationRent, true);
  assert.equal(policy2.requiredRentLamports, 1_488_440n);
});
