/**
 * Tests for Jupiter executeSwap (quote in, signed+confirmed swap out).
 */

jest.mock('../../../src/utils/redis', () => ({
  getCachedJupiterQuote: jest.fn(async () => null),
  cacheJupiterQuote: jest.fn(async () => {}),
  getJupiterCacheStats: jest.fn(() => ({})),
}));

const {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');

const jupiter = require('../../../src/services/jupiter');

function makeSwapTransactionBase64(payer) {
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

function makeHarness({ statusErr = null } = {}) {
  const signer = Keypair.generate();
  const calls = { sent: 0, confirmed: [] };
  const connection = {
    sendRawTransaction: jest.fn(async () => {
      calls.sent += 1;
      return 'SIG_EXEC_TEST';
    }),
    confirmTransaction: jest.fn(async (sig) => {
      calls.confirmed.push(sig);
    }),
    getSignatureStatuses: jest.fn(async () => ({ value: [{ err: statusErr }] })),
  };
  return { signer, connection, calls };
}

const QUOTE = { inAmount: '1000000', outAmount: '500000' };

describe('executeSwap()', () => {
  let txPayer;
  beforeEach(() => {
    txPayer = Keypair.generate().publicKey;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ swapTransaction: makeSwapTransactionBase64(txPayer) }),
    }));
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('signs, sends, confirms and verifies a quoted swap', async () => {
    const { signer, connection, calls } = makeHarness();
    txPayer = signer.publicKey;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ swapTransaction: makeSwapTransactionBase64(txPayer) }),
    }));
    const result = await jupiter.executeSwap({
      quoteResponse: QUOTE,
      signer,
      connection,
      minOutAmount: 100,
    });
    expect(result.signature).toBe('SIG_EXEC_TEST');
    expect(result.inAmount).toBe('1000000');
    expect(result.outAmountQuote).toBe('500000');
    expect(calls.sent).toBe(1);
    expect(calls.confirmed).toEqual(['SIG_EXEC_TEST']);
  });

  it('refuses before signing when quoted output is below minimum', async () => {
    const { signer, connection, calls } = makeHarness();
    await expect(
      jupiter.executeSwap({ quoteResponse: QUOTE, signer, connection, minOutAmount: 999999 })
    ).rejects.toThrow('below minimum');
    expect(calls.sent).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when the swap tx fails onchain', async () => {
    const { signer, connection } = makeHarness({ statusErr: { InstructionError: [0, 'Custom'] } });
    txPayer = signer.publicKey;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ swapTransaction: makeSwapTransactionBase64(txPayer) }),
    }));
    await expect(jupiter.executeSwap({ quoteResponse: QUOTE, signer, connection })).rejects.toThrow(
      'failed onchain'
    );
  });

  it('throws when Jupiter returns no swapTransaction', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    const { signer, connection, calls } = makeHarness();
    await expect(jupiter.executeSwap({ quoteResponse: QUOTE, signer, connection })).rejects.toThrow(
      'missing swapTransaction'
    );
    expect(calls.sent).toBe(0);
  });
});
